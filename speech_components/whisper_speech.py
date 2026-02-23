#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Speech Recognition for Substrate
---------------------------------
A clean, efficient implementation using faster-whisper for offline speech recognition.
Focuses on:
1. Minimal code with no extra features
2. Only sending final transcriptions (no partials)
3. Proper message formatting for main.js
4. Deduplication to prevent repetitive transcriptions
"""

import json
import sys
import threading
import time
import queue
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
import os
import base64
import io
import struct
import requests
import re

# Google Cloud v2 service account auth
try:
    from google.oauth2 import service_account as _sa
    from google.auth.transport.requests import Request as _AuthRequest
except ImportError:
    _sa = None
    _AuthRequest = None

# STT provider: "whisper" (local), "gemini" (cloud), "google-cloud" (cloud)
stt_provider = "google-cloud"  # Default to Google Cloud STT
google_api_key = ""  # Loaded from custom_settings.json or stdin command
gcloud_credentials = None  # Service account credentials for v2 API
gcloud_project_id = ""  # GCP project ID from service account

# Global variables
audio_buffer = np.zeros(0, dtype=np.float32)
buffer_lock = threading.Lock()
processing_queue = queue.Queue()
_muted = False  # Toggled by stop/start commands from mute button

# Directory to monitor for XGO audio files
XGO_AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xgo_audio_input')
os.makedirs(XGO_AUDIO_DIR, exist_ok=True)
print(f"Monitoring for XGO audio files in: {XGO_AUDIO_DIR}")
# Initialize model at module level to avoid delay during speech
print("Pre-loading whisper model... this may take a few seconds")
# Try to use GPU if available, otherwise fall back to CPU
try:
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    print(f"Using device: {device} with compute_type: {compute_type}")
    model = WhisperModel("small", device=device, compute_type=compute_type)
    # Run a quick inference to fully initialize the model and keep it warm
    model.transcribe(np.zeros(1600, dtype=np.float32), beam_size=1)
    print("Model pre-loaded and warmed up successfully on " + device)
except Exception as e:
    print(f"Error initializing model on GPU, falling back to CPU: {e}")
    model = WhisperModel("small", device="cpu", compute_type="int8")
    model.transcribe(np.zeros(1600, dtype=np.float32), beam_size=1)
    print("Model pre-loaded and warmed up successfully on CPU")
is_running = True
last_voice_time = 0
voice_cooldown = 0.2  # Cooldown period in seconds after system speaks
energy_threshold = 0.01  # Energy threshold for speech detection trigger (raised to reduce noise hallucinations)
mic_gain = 1.0  # Software mic gain/sensitivity multiplier (1.0 = no change)
silence_timeout = 1.2  # Seconds of silence before processing (wait for sentence to finish)
chunk_trigger_samples = int(16000 * 3.0)  # Only send for transcription after ~3s of audio (or on silence)
min_chunk_samples = int(16000 * 1.0)  # Need at least 1.0s of audio to bother processing (reduces noise hallucinations)
overlap_samples = int(16000 * 0.1)  # Keep small overlap for context
last_transcription = ""  # Store the last final transcription to avoid duplicates
last_partial_text = ""  # Track most recent partial to prevent repeats
is_processing = False  # Flag to indicate if we're currently processing audio
last_speech_time = 0  # Track when we last detected speech
max_buffer_size = int(16000 * 8)  # Maximum buffer size (~8 seconds)
no_buffer_limit = False  # When True, disables chunk trigger and raises max buffer to ~10 min
_nbl_sent_samples = 0  # Track how many samples we've already sent during no_buffer_limit mode

# Load Google API key from custom_settings.json at startup
try:
    settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'custom_settings.json')
    if os.path.exists(settings_path):
        with open(settings_path, 'r') as f:
            settings = json.load(f)
        google_api_key = settings.get('remote_api_keys', {}).get('google_api_key', '')
        if google_api_key:
            print(f"Loaded Google API key from custom_settings.json (length: {len(google_api_key)})")
        else:
            print("No Google API key found in custom_settings.json")
    else:
        print(f"custom_settings.json not found at {settings_path}")
except Exception as e:
    print(f"Error loading Google API key: {e}")

# Load service account credentials for Google Cloud STT v2 API
try:
    sa_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'service_account.json')
    if os.path.exists(sa_path) and _sa is not None:
        gcloud_credentials = _sa.Credentials.from_service_account_file(
            sa_path, scopes=['https://www.googleapis.com/auth/cloud-platform'])
        # Read project ID from the service account file
        with open(sa_path, 'r') as f:
            sa_data = json.load(f)
        gcloud_project_id = sa_data.get('project_id', '')
        print(f"Loaded service account for Cloud STT v2 (project: {gcloud_project_id})")
    else:
        if _sa is None:
            print("google-auth not installed, Cloud STT v2 unavailable")
        else:
            print(f"service_account.json not found at {sa_path}, Cloud STT v2 unavailable")
except Exception as e:
    print(f"Error loading service account: {e}")


def audio_to_wav_bytes(audio_data, sample_rate=16000):
    """Convert float32 numpy audio to WAV bytes for API upload"""
    buf = io.BytesIO()
    # Convert float32 [-1,1] to int16
    audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
    # Write WAV header + data
    num_samples = len(audio_int16)
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + data_size))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))  # chunk size
    buf.write(struct.pack('<H', 1))   # PCM format
    buf.write(struct.pack('<H', 1))   # mono
    buf.write(struct.pack('<I', sample_rate))
    buf.write(struct.pack('<I', sample_rate * 2))  # byte rate
    buf.write(struct.pack('<H', 2))   # block align
    buf.write(struct.pack('<H', 16))  # bits per sample
    buf.write(b'data')
    buf.write(struct.pack('<I', data_size))
    buf.write(audio_int16.tobytes())
    return buf.getvalue()


def transcribe_with_gemini(audio_data, sample_rate=16000):
    """Transcribe audio using Gemini API (multimodal audio input)"""
    global google_api_key
    if not google_api_key:
        return ""
    
    try:
        wav_bytes = audio_to_wav_bytes(audio_data, sample_rate)
        audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
        
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={google_api_key}"
        
        payload = {
            "contents": [{
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": "audio/wav",
                            "data": audio_b64
                        }
                    },
                    {
                        "text": "Transcribe this audio exactly as spoken. Output ONLY the transcribed text, nothing else. If the audio is silence or unintelligible, output nothing."
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 500
            }
        }
        
        response = requests.post(endpoint, json=payload, timeout=15)
        
        if response.status_code != 200:
            print(json.dumps({"status": "error", "message": f"Gemini STT error: {response.status_code} {response.text[:200]}"}))
            sys.stdout.flush()
            return ""
        
        result = response.json()
        candidates = result.get('candidates', [])
        if candidates:
            parts = candidates[0].get('content', {}).get('parts', [])
            text = ''.join(p.get('text', '') for p in parts).strip()
            return text
        return ""
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Gemini STT exception: {str(e)}"}))
        sys.stdout.flush()
        return ""


def transcribe_with_google_cloud(audio_data, sample_rate=16000):
    """Transcribe audio using Google Cloud Speech-to-Text v2 API with Chirp 2 model"""
    global gcloud_credentials, gcloud_project_id, google_api_key
    
    try:
        # Build WAV bytes for autoDecodingConfig
        wav_bytes = audio_to_wav_bytes(audio_data, sample_rate)
        audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
        
        # Prefer v2 API with service account (chirp_2)
        if gcloud_credentials and gcloud_project_id and _AuthRequest is not None:
            # Refresh token if expired
            if not gcloud_credentials.valid:
                gcloud_credentials.refresh(_AuthRequest())
            
            endpoint = f"https://us-central1-speech.googleapis.com/v2/projects/{gcloud_project_id}/locations/us-central1/recognizers/_:recognize"
            headers = {"Authorization": f"Bearer {gcloud_credentials.token}"}
            
            payload = {
                "config": {
                    "autoDecodingConfig": {},
                    "languageCodes": ["en-US"],
                    "model": "chirp_2",
                    "features": {
                        "enableAutomaticPunctuation": True
                    }
                },
                "content": audio_b64
            }
            
            response = requests.post(endpoint, headers=headers, json=payload, timeout=15)
        elif google_api_key:
            # Fallback to v1 API with API key
            endpoint = f"https://speech.googleapis.com/v1/speech:recognize?key={google_api_key}"
            audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
            audio_b64_v1 = base64.b64encode(audio_int16.tobytes()).decode('utf-8')
            
            payload = {
                "config": {
                    "encoding": "LINEAR16",
                    "sampleRateHertz": sample_rate,
                    "languageCode": "en-US",
                    "model": "latest_short",
                    "enableAutomaticPunctuation": True,
                    "useEnhanced": True
                },
                "audio": {
                    "content": audio_b64_v1
                }
            }
            
            response = requests.post(endpoint, json=payload, timeout=15)
        else:
            print(json.dumps({"status": "error", "message": "No Google Cloud credentials available"}))
            sys.stdout.flush()
            return ""
        
        if response.status_code != 200:
            print(json.dumps({"status": "error", "message": f"Google Cloud STT error: {response.status_code} {response.text[:200]}"}))
            sys.stdout.flush()
            return ""
        
        result = response.json()
        results = result.get('results', [])
        if results:
            alt = results[0].get('alternatives', [{}])[0]
            text = alt.get('transcript', '').strip()
            confidence = alt.get('confidence', 0)
            # Reject low-confidence results (likely hallucinations from noise)
            if text and confidence > 0 and confidence < 0.6:
                print_json({"status": "debug", "message": f"Rejected low-confidence STT ({confidence:.2f}): '{text}'"})
                return ""
            return text
        return ""
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Google Cloud STT exception: {str(e)}"}))
        sys.stdout.flush()
        return ""


def transcribe_audio(audio_data, sample_rate=16000):
    """Route transcription to the active STT provider"""
    global stt_provider
    
    if stt_provider == "gemini":
        text = transcribe_with_gemini(audio_data, sample_rate)
        if not text:
            print(json.dumps({"status": "debug", "message": "Gemini STT returned empty (silence or unintelligible)"}))
            sys.stdout.flush()
        return text or ""
    elif stt_provider == "google-cloud":
        text = transcribe_with_google_cloud(audio_data, sample_rate)
        if not text:
            print(json.dumps({"status": "debug", "message": "Google Cloud STT returned empty (silence or unintelligible)"}))
            sys.stdout.flush()
        return text or ""
    
    # whisper (local fallback)
    segments, info = model.transcribe(
        audio_data,
        beam_size=5,
        language="en",
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 200,
            "threshold": 0.5
        }
    )
    segments_list = list(segments)
    text = ""
    for segment in segments_list:
        text += segment.text
    return text.strip()


def print_json(data):
    """Print JSON data to stdout and flush"""
    print(json.dumps(data))
    sys.stdout.flush()



def enqueue_audio(audio_chunk, is_final=False):
    """Place audio plus metadata onto the processing queue."""
    if audio_chunk is None or len(audio_chunk) == 0:
        return
    processing_queue.put({
        "audio": audio_chunk,
        "is_final": is_final,
        "ts": time.time()
    })


def process_audio_thread():
    """Thread function to process audio from the queue"""
    global is_running, last_transcription, last_partial_text, is_processing, _muted
    
    while is_running:
        try:
            # Get audio from queue with a timeout to allow checking is_running
            try:
                item = processing_queue.get(timeout=0.2)  # Reduced timeout for faster response
            except queue.Empty:
                # Queue is empty, just continue
                continue
            if isinstance(item, dict):
                audio_data = item.get('audio')
                is_final_chunk = item.get('is_final', False)
            else:
                # Backwards compatibility if raw audio was queued
                audio_data = item
                is_final_chunk = True

            # Set processing flag
            is_processing = True
            
            # Skip transcription entirely when muted (saves API calls)
            if _muted:
                is_processing = False
                continue
            
            # Debug audio data properties
            print_json({"status": "debug", "message": f"Processing audio: shape={audio_data.shape}, min={np.min(audio_data):.4f}, max={np.max(audio_data):.4f}, mean={np.mean(audio_data):.4f}"})
            
            # Calculate audio energy — skip if buffer is mostly silence (noise spike triggered it)
            energy = np.sqrt(np.mean(audio_data**2))
            print_json({"status": "debug", "message": f"Audio energy: {energy:.6f}"})
            if energy < energy_threshold * 0.5:
                print_json({"status": "debug", "message": f"Skipping transcription — buffered audio energy ({energy:.6f}) too low (threshold: {energy_threshold * 0.5:.6f})"})
                is_processing = False
                continue
            
            # Normalize audio if needed for better transcription
            max_amplitude = np.max(np.abs(audio_data))
            if max_amplitude > 1.0:
                print_json({"status": "debug", "message": f"Normalizing audio with max amplitude {max_amplitude:.4f}"})
                audio_data = audio_data / max_amplitude
            elif max_amplitude < 0.1 and max_amplitude > 0:
                print_json({"status": "debug", "message": f"Audio amplitude very low ({max_amplitude:.4f}), amplifying"})
                audio_data = audio_data * (0.5 / max_amplitude)  # Amplify to half of maximum
            
            try:
                # Transcribe using the active STT provider (whisper/gemini/google-cloud)
                t_start = time.time()
                text = transcribe_audio(audio_data, sample_rate=16000)
                t_elapsed = time.time() - t_start
                print_json({"status": "debug", "message": f"Transcription via [{stt_provider}] took {t_elapsed:.2f}s: '{text[:80]}'"})
                
                
                # Filter out garbage transcriptions (random punctuation, single chars, etc.)
                if text and len(re.sub(r'[^a-zA-Z0-9]', '', text)) < 2:
                    print_json({"status": "debug", "message": f"Filtered garbage transcription: '{text}'"})
                    text = ""
                
                # Only send final transcriptions (no partials — wait for full utterance)
                if text and is_final_chunk:
                    if text == last_transcription:
                        print_json({"status": "info", "message": f"Skipped duplicate transcription: {text}"})
                    else:
                        last_transcription = text
                        last_partial_text = ""
                        payload = {
                            "text": text,
                            "source": "speech"
                        }
                        print_json(payload)
                        print_json({"status": "info", "message": f"Sent transcription: {text}"})
                        # Let any queued audio process normally (don't flush)
                elif text and not is_final_chunk:
                    # Just log that we're still listening, don't send anything
                    last_partial_text = text
                    print_json({"status": "debug", "message": f"Buffering speech (not sending yet): {text}"})
            finally:
                # Reset processing flag
                is_processing = False
            
            # Mark task as done
            processing_queue.task_done()
            
        except Exception as e:
            is_processing = False
            print_json({"status": "error", "message": f"Error processing audio: {str(e)}"})
            if processing_queue.unfinished_tasks > 0:
                processing_queue.task_done()

def audio_callback(indata, frames, time_info, status):
    """Callback for audio stream"""
    global audio_buffer, last_voice_time, last_speech_time, _nbl_sent_samples
    
    if status:
        print_json({"status": "warning", "message": f"Audio status: {status}"})
    
    # Convert to mono and float32
    audio_data = indata[:, 0].copy().astype(np.float32)
    
    # Apply software mic gain
    if mic_gain != 1.0:
        audio_data = audio_data * mic_gain
    
    # Check if we're in the cooldown period after system voice output
    current_time = time.time()
    if current_time - last_voice_time < voice_cooldown:
        return
    
    # Calculate energy level (after gain)
    energy = np.mean(np.abs(audio_data))
    
    # Send energy level for UI meter (~10% of frames for smooth display)
    if np.random.random() < 0.10:
        print_json({"type": "energy_level", "energy": round(float(energy), 6), "threshold": round(float(energy_threshold), 6), "active": bool(energy >= energy_threshold)})
    
    # If energy is below threshold, still append audio to buffer (captures trailing words)
    # but check if silence timeout has elapsed to trigger processing
    if energy < energy_threshold:
        # Keep appending audio during silence window so we don't lose trailing words
        if len(audio_buffer) > 0:
            with buffer_lock:
                audio_buffer = np.concatenate((audio_buffer, audio_data))
                # Cap buffer size
                effective_max = int(16000 * 600) if no_buffer_limit else max_buffer_size
                if len(audio_buffer) > effective_max:
                    audio_buffer = audio_buffer[-effective_max:]
        # When no_buffer_limit is active (brainstorm mode), send partial transcriptions
        # on silence so main.js can accumulate text in recordingBuffer.
        # The buffer is NOT cleared — audio keeps accumulating for the final flush.
        if no_buffer_limit:
            current_time = time.time()
            if len(audio_buffer) >= min_chunk_samples and last_speech_time > 0 and current_time - last_speech_time > silence_timeout:
                with buffer_lock:
                    audio_to_send = audio_buffer[_nbl_sent_samples:].copy() if _nbl_sent_samples < len(audio_buffer) else None
                    if audio_to_send is not None and len(audio_to_send) >= min_chunk_samples:
                        _nbl_sent_samples = len(audio_buffer)
                        enqueue_audio(audio_to_send, is_final=True)
                last_speech_time = 0
            return
        current_time = time.time()
        if len(audio_buffer) >= min_chunk_samples and last_speech_time > 0 and current_time - last_speech_time > silence_timeout:
            with buffer_lock:
                audio_to_process = audio_buffer.copy()
                audio_buffer = np.zeros(0, dtype=np.float32)
            last_speech_time = 0  # Reset so we don't re-trigger
            enqueue_audio(audio_to_process, is_final=True)
        return
    
    # Update last speech time when we detect speech
    last_speech_time = time.time()
    
    # Append to buffer with lock
    with buffer_lock:
        audio_buffer = np.concatenate((audio_buffer, audio_data))
        
        # Limit buffer size to prevent memory issues
        effective_max = int(16000 * 600) if no_buffer_limit else max_buffer_size
        if len(audio_buffer) > effective_max:
            audio_buffer = audio_buffer[-effective_max:]
    
    # If buffer is very large, send what we have (prevents unbounded growth)
    # Skip chunk trigger when no_buffer_limit is active — only send on silence or explicit stop
    if not no_buffer_limit and len(audio_buffer) >= chunk_trigger_samples:
        with buffer_lock:
            audio_to_process = audio_buffer.copy()
            if overlap_samples > 0 and len(audio_buffer) > overlap_samples:
                audio_buffer = audio_buffer[-overlap_samples:].copy()
            else:
                audio_buffer = np.zeros(0, dtype=np.float32)
        enqueue_audio(audio_to_process, is_final=True)  # Always final — we only send complete utterances

def process_audio_bytes(audio_bytes):
    """Process audio bytes directly by sending to the same processing queue as microphone audio"""
    try:
        print_json({"status": "info", "message": f"Processing XGO audio bytes directly ({len(audio_bytes)/1024:.2f} KB)"})
        
        # Load the audio from bytes
        import io
        import soundfile as sf
        
        # Create a BytesIO object from the bytes
        audio_io = io.BytesIO(audio_bytes)
        
        # Read audio data using soundfile
        audio_data, sample_rate = sf.read(audio_io)
        
        # Debug audio properties
        print_json({"status": "debug", "message": f"XGO audio properties: shape={audio_data.shape}, dtype={audio_data.dtype}, sample_rate={sample_rate}, min={np.min(audio_data)}, max={np.max(audio_data)}, mean={np.mean(audio_data)}"})
        
        # Convert to mono if needed
        if len(audio_data.shape) > 1:
            print_json({"status": "debug", "message": f"Converting stereo to mono"})
            audio_data = audio_data[:, 0]
        
        # Convert to float32 if needed
        if audio_data.dtype != np.float32:
            print_json({"status": "debug", "message": f"Converting {audio_data.dtype} to float32"})
            audio_data = audio_data.astype(np.float32)
        
        # Normalize audio if needed (ensure values are between -1 and 1)
        if np.max(np.abs(audio_data)) > 1.0:
            print_json({"status": "debug", "message": f"Normalizing audio with max amplitude {np.max(np.abs(audio_data))}"})
            audio_data = audio_data / np.max(np.abs(audio_data))
        
        # Resample to 16kHz if needed
        if sample_rate != 16000:
            print_json({"status": "debug", "message": f"Resampling from {sample_rate}Hz to 16000Hz"})
            from scipy import signal
            audio_data = signal.resample(audio_data, int(len(audio_data) * 16000 / sample_rate))
        
        # Check if audio has actual content (not just silence)
        energy = np.sqrt(np.mean(audio_data**2))
        print_json({"status": "debug", "message": f"XGO audio energy: {energy}"})
        
        if energy < 0.001:  # Very low energy threshold
            print_json({"status": "warning", "message": f"XGO audio appears to be silence (energy: {energy}), but processing anyway"})
        
        # Send to the same processing queue as microphone audio
        print_json({"status": "info", "message": f"Sending XGO audio to main processing queue (length: {len(audio_data)/16000:.2f}s)"})
        enqueue_audio(audio_data, is_final=True)
        
        print_json({"status": "info", "message": f"XGO audio queued for processing"})
        return True
    
    except Exception as e:
        print_json({"status": "error", "message": f"Error processing XGO audio bytes: {str(e)}"})
        return False

def process_audio_file(file_path):
    """Process an audio file by sending it to the same processing queue as microphone audio
    
    Returns:
        bool: True if processing was successful, False otherwise
    """
    try:
        print_json({"status": "info", "message": f"Loading XGO audio file: {file_path}"})
        
        # Load the audio file
        import soundfile as sf
        audio_data, sample_rate = sf.read(file_path)
        
        # Debug audio properties
        print_json({"status": "debug", "message": f"XGO audio properties: shape={audio_data.shape}, dtype={audio_data.dtype}, sample_rate={sample_rate}, min={np.min(audio_data)}, max={np.max(audio_data)}, mean={np.mean(audio_data)}"})
        
        # Convert to mono if needed
        if len(audio_data.shape) > 1:
            print_json({"status": "debug", "message": f"Converting stereo to mono"})
            audio_data = audio_data[:, 0]
        
        # Convert to float32 if needed
        if audio_data.dtype != np.float32:
            print_json({"status": "debug", "message": f"Converting {audio_data.dtype} to float32"})
            audio_data = audio_data.astype(np.float32)
        
        # Normalize audio if needed (ensure values are between -1 and 1)
        if np.max(np.abs(audio_data)) > 1.0:
            print_json({"status": "debug", "message": f"Normalizing audio with max amplitude {np.max(np.abs(audio_data))}"})
            audio_data = audio_data / np.max(np.abs(audio_data))
        
        # Resample to 16kHz if needed
        if sample_rate != 16000:
            print_json({"status": "debug", "message": f"Resampling from {sample_rate}Hz to 16000Hz"})
            from scipy import signal
            audio_data = signal.resample(audio_data, int(len(audio_data) * 16000 / sample_rate))
        
        # Check if audio has actual content (not just silence)
        energy = np.sqrt(np.mean(audio_data**2))
        print_json({"status": "debug", "message": f"XGO audio energy: {energy}"})
        
        if energy < 0.001:  # Very low energy threshold
            print_json({"status": "warning", "message": f"XGO audio appears to be silence (energy: {energy}), but processing anyway"})
        
        # Send to the same processing queue as microphone audio
        print_json({"status": "info", "message": f"Sending XGO audio to main processing queue (length: {len(audio_data)/16000:.2f}s)"})
        processing_queue.put(audio_data)
        
        # Output a special message to stdout that will be captured by the main system
        # This ensures the transcription will be processed as a regular chat input
        print_json({"status": "info", "message": f"XGO audio queued for processing", "source": "xgo_audio", "timestamp": time.time()})
        
        # Delete the processed file to avoid reprocessing
        try:
            os.remove(file_path)
            print_json({"status": "info", "message": f"Deleted processed XGO audio file: {file_path}"})
        except Exception as e:
            print_json({"status": "warning", "message": f"Failed to delete XGO audio file: {e}"})
        
        return True
    
    except Exception as e:
        print_json({"status": "error", "message": f"Error processing XGO audio file: {str(e)}"})
        # Try to delete the file even if processing failed
        try:
            os.remove(file_path)
            print_json({"status": "info", "message": f"Deleted failed XGO audio file: {file_path}"})
        except:
            pass
        
        return False

def check_xgo_audio_files():
    """Check for new XGO audio files to process"""
    try:
        # Make sure directory exists
        if not os.path.exists(XGO_AUDIO_DIR):
            print_json({"status": "warning", "message": f"XGO audio directory does not exist: {XGO_AUDIO_DIR}"})
            try:
                os.makedirs(XGO_AUDIO_DIR, exist_ok=True)
                print_json({"status": "info", "message": f"Created XGO audio directory: {XGO_AUDIO_DIR}"})
            except Exception as e:
                print_json({"status": "error", "message": f"Failed to create XGO audio directory: {e}"})
            return
        
        # List files
        files = [f for f in os.listdir(XGO_AUDIO_DIR) if f.endswith('.wav')]
        
        # Always log the check, even when no files are found
        print_json({"status": "debug", "message": f"Checking XGO audio directory: {XGO_AUDIO_DIR}, found {len(files)} files"})
        
        # Process any files found immediately
        if files:
            print_json({"status": "info", "message": f"Found {len(files)} XGO audio files to process"})
        
        for file_name in files:
            file_path = os.path.join(XGO_AUDIO_DIR, file_name)
            print_json({"status": "info", "message": f"Found XGO audio file: {file_path}"})
            
            # Process files more aggressively - don't wait too long for stability
            try:
                # Get initial size
                size1 = os.path.getsize(file_path)
                
                # Only wait a very short time to check stability
                time.sleep(0.05)  # Reduced wait time
                
                # Check size again
                try:
                    size2 = os.path.getsize(file_path)
                except FileNotFoundError:
                    # File might have been deleted by another process
                    print_json({"status": "warning", "message": f"File disappeared during processing: {file_path}"})
                    continue
                
                print_json({"status": "debug", "message": f"File size check: {size1} vs {size2} bytes"})
                
                # Process the file even if it's still growing, as long as it has some content
                if size2 > 0:  # Just make sure it has some content
                    print_json({"status": "info", "message": f"Processing XGO audio file: {file_path}"})
                    
                    # Process the file and capture the result
                    result = process_audio_file(file_path)
                    
                    # Log the result with high visibility
                    if result:
                        print_json({"status": "info", "message": f"✅ XGO audio processed successfully: {file_path}"})
                    else:
                        print_json({"status": "warning", "message": f"❌ XGO audio processing failed: {file_path}"})
                else:
                    print_json({"status": "warning", "message": f"Empty file, skipping: {file_path}"})
                    # Delete empty files
                    try:
                        os.remove(file_path)
                        print_json({"status": "info", "message": f"Deleted empty file: {file_path}"})
                    except Exception as e:
                        print_json({"status": "warning", "message": f"Failed to delete empty file: {e}"})
            except Exception as e:
                print_json({"status": "warning", "message": f"Error processing XGO audio file: {str(e)}"})
                import traceback
                print_json({"status": "debug", "message": f"Traceback: {traceback.format_exc()}"})
                
                # Try to delete problematic files
                try:
                    os.remove(file_path)
                    print_json({"status": "info", "message": f"Deleted problematic file: {file_path}"})
                except:
                    pass
    except Exception as e:
        print_json({"status": "warning", "message": f"Error scanning XGO audio directory: {str(e)}"})
        import traceback
        print_json({"status": "debug", "message": f"Traceback: {traceback.format_exc()}"})
        
    # Return True to indicate the function completed successfully
    return True

def main():
    """Main function"""
    global model, is_running, last_voice_time, stt_provider, google_api_key, gcloud_credentials, gcloud_project_id, energy_threshold, mic_gain, last_transcription, silence_timeout, chunk_trigger_samples, min_chunk_samples, voice_cooldown, _muted, no_buffer_limit, _nbl_sent_samples
    
    try:
        # Check if another instance is running by creating a lock file
        lock_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tp_speech.lock')
        
        # Check if the lock file exists and is recent (less than 10 seconds old)
        if os.path.exists(lock_file):
            file_age = time.time() - os.path.getmtime(lock_file)
            if file_age < 10:
                print_json({"status": "error", "message": "Another speech recognition instance is already running"})
                return 1
            else:
                # Lock file is old, we can remove it
                try:
                    os.remove(lock_file)
                except:
                    pass
        
        # Create the lock file
        with open(lock_file, 'w') as f:
            f.write(str(os.getpid()))
        
        print_json({"status": "info", "message": "Starting speech recognition"})
        
        # Model is already initialized at module level
        print_json({"status": "info", "message": "Using pre-initialized whisper model"})
        
        # Start processing thread
        processing_thread = threading.Thread(target=process_audio_thread)
        processing_thread.daemon = True
        processing_thread.start()
        
        # Start audio stream
        print_json({"status": "info", "message": "Starting audio stream..."})
        
        # Use default input device
        stream = sd.InputStream(
            samplerate=16000,
            channels=1,
            callback=audio_callback,
            dtype='float32'
        )
        
        stream.start()
        print_json({"status": "info", "message": "Audio stream started"})
        print_json({"status": "info", "message": "Microphone activated"})
        print_json({"status": "info", "message": f"Also monitoring XGO audio directory: {XGO_AUDIO_DIR}"})
        
        # Last time we checked for XGO audio files
        last_xgo_check = 0
        
        # Keep running until interrupted
        while True:
            # Check for XGO audio files very frequently (every 0.2 seconds)
            current_time = time.time()
            if current_time - last_xgo_check > 0.2:  # Check 5 times per second
                check_xgo_audio_files()
                last_xgo_check = current_time
            
            # Check for commands from stdin
            if sys.stdin.isatty():
                cmd = input().strip()
                if cmd == "stop":
                    break
            else:
                line = sys.stdin.readline().strip()
                if line:
                    try:
                        data = json.loads(line)
                        # Check for voice status messages
                        if isinstance(data, dict):
                            if data.get("command") == "speaking_start" or (data.get("type") == "voice" and data.get("status") == "speaking"):
                                # System is speaking, update last voice time
                                last_voice_time = time.time()
                                # Clear the buffer to avoid processing while system is speaking
                                with buffer_lock:
                                    audio_buffer = np.zeros(0, dtype=np.float32)
                                # Reset last transcription when system speaks
                                last_transcription = ""
                                
                                # Clear the processing queue
                                while not processing_queue.empty():
                                    try:
                                        processing_queue.get_nowait()
                                        processing_queue.task_done()
                                    except:
                                        break
                                        
                                # Keep the model warm with a quick inference
                                threading.Thread(target=lambda: model.transcribe(np.zeros(1600, dtype=np.float32), beam_size=1)).start()
                                        
                                print_json({"status": "info", "message": "System speaking - cleared audio buffers"})
                            
                            elif data.get("command") == "start":
                                _muted = False
                                print_json({"status": "info", "message": "Microphone activated (unmuted)"})
                            
                            elif data.get("command") == "stop":
                                _muted = True
                                print_json({"status": "info", "message": "Microphone deactivated (muted)"})
                                
                            elif data.get("command") == "set_threshold":
                                new_val = float(data.get("value", energy_threshold))
                                energy_threshold = max(0.0001, min(0.1, new_val))
                                print_json({"status": "info", "message": f"Energy threshold updated to {energy_threshold:.6f}"})
                                print_json({"type": "threshold_updated", "threshold": round(float(energy_threshold), 6)})
                            
                            elif data.get("command") == "get_threshold":
                                print_json({"type": "threshold_updated", "threshold": round(float(energy_threshold), 6)})
                            
                            elif data.get("command") == "set_gain":
                                new_gain = float(data.get("value", mic_gain))
                                mic_gain = max(0.1, min(10.0, new_gain))
                                print_json({"status": "info", "message": f"Mic gain updated to {mic_gain:.2f}x"})
                                print_json({"type": "gain_updated", "gain": round(float(mic_gain), 2)})
                            
                            elif data.get("command") == "get_gain":
                                print_json({"type": "gain_updated", "gain": round(float(mic_gain), 2)})
                            
                            elif data.get("command") == "set_stt_provider":
                                new_provider = data.get("value", "whisper").lower().strip()
                                if new_provider in ("whisper", "gemini", "google-cloud"):
                                    stt_provider = new_provider
                                    print_json({"status": "info", "message": f"STT provider switched to: {stt_provider}"})
                                    print_json({"type": "stt_provider_updated", "provider": stt_provider})
                                else:
                                    print_json({"status": "error", "message": f"Unknown STT provider: {new_provider}. Use whisper, gemini, or google-cloud"})
                            
                            elif data.get("command") == "get_stt_provider":
                                print_json({"type": "stt_provider_updated", "provider": stt_provider})
                            
                            elif data.get("command") == "set_silence_timeout":
                                new_val = float(data.get("value", silence_timeout))
                                silence_timeout = max(0.3, min(10.0, new_val))
                                print_json({"status": "info", "message": f"Silence timeout updated to {silence_timeout:.1f}s"})
                                print_json({"type": "mic_timing_updated", "silence_timeout": round(silence_timeout, 1), "chunk_trigger": round(chunk_trigger_samples / 16000, 1), "min_chunk": round(min_chunk_samples / 16000, 1), "voice_cooldown": round(voice_cooldown, 1)})
                            
                            elif data.get("command") == "set_chunk_trigger":
                                new_val = float(data.get("value", chunk_trigger_samples / 16000))
                                chunk_trigger_samples = int(16000 * max(1.0, min(600.0, new_val)))
                                print_json({"status": "info", "message": f"Chunk trigger updated to {chunk_trigger_samples / 16000:.1f}s"})
                                print_json({"type": "mic_timing_updated", "silence_timeout": round(silence_timeout, 1), "chunk_trigger": round(chunk_trigger_samples / 16000, 1), "min_chunk": round(min_chunk_samples / 16000, 1), "voice_cooldown": round(voice_cooldown, 1)})
                            
                            elif data.get("command") == "set_min_chunk":
                                new_val = float(data.get("value", min_chunk_samples / 16000))
                                min_chunk_samples = int(16000 * max(0.2, min(5.0, new_val)))
                                print_json({"status": "info", "message": f"Min chunk updated to {min_chunk_samples / 16000:.1f}s"})
                                print_json({"type": "mic_timing_updated", "silence_timeout": round(silence_timeout, 1), "chunk_trigger": round(chunk_trigger_samples / 16000, 1), "min_chunk": round(min_chunk_samples / 16000, 1), "voice_cooldown": round(voice_cooldown, 1)})
                            
                            elif data.get("command") == "set_voice_cooldown":
                                new_val = float(data.get("value", voice_cooldown))
                                voice_cooldown = max(0.0, min(5.0, new_val))
                                print_json({"status": "info", "message": f"Voice cooldown updated to {voice_cooldown:.1f}s"})
                                print_json({"type": "mic_timing_updated", "silence_timeout": round(silence_timeout, 1), "chunk_trigger": round(chunk_trigger_samples / 16000, 1), "min_chunk": round(min_chunk_samples / 16000, 1), "voice_cooldown": round(voice_cooldown, 1)})
                            
                            elif data.get("command") == "set_no_buffer_limit":
                                was_on = no_buffer_limit
                                no_buffer_limit = bool(data.get("value", False))
                                _nbl_sent_samples = 0  # Reset tracking for new session
                                print_json({"status": "info", "message": f"No-buffer-limit mode: {'ON' if no_buffer_limit else 'OFF'}"})
                                print_json({"type": "no_buffer_limit_updated", "enabled": no_buffer_limit})
                                # Flush remaining unsent audio when turning OFF (brainstorm stop)
                                if was_on and not no_buffer_limit and len(audio_buffer) >= min_chunk_samples:
                                    with buffer_lock:
                                        audio_to_process = audio_buffer.copy()
                                        audio_buffer = np.zeros(0, dtype=np.float32)
                                    last_speech_time = 0
                                    enqueue_audio(audio_to_process, is_final=True)
                                    print_json({"status": "info", "message": f"Flushed {len(audio_to_process)/16000:.1f}s of buffered audio"})
                            
                            elif data.get("command") == "get_mic_timing":
                                print_json({"type": "mic_timing_updated", "silence_timeout": round(silence_timeout, 1), "chunk_trigger": round(chunk_trigger_samples / 16000, 1), "min_chunk": round(min_chunk_samples / 16000, 1), "voice_cooldown": round(voice_cooldown, 1)})
                            
                            elif data.get("command") == "set_google_api_key":
                                google_api_key = data.get("value", "")
                                print_json({"status": "info", "message": f"Google API key updated (length: {len(google_api_key)})"})
                            
                            elif data.get("command") == "exit":
                                break
                    except:
                        pass
                time.sleep(0.1)
    
    except KeyboardInterrupt:
        print_json({"status": "info", "message": "Interrupted by user"})
    except Exception as e:
        print_json({"status": "error", "message": f"Error: {str(e)}"})
    finally:
        # Clean up
        is_running = False
        if 'stream' in locals() and stream.active:
            stream.stop()
            stream.close()
        print_json({"status": "info", "message": "Speech recognition stopped"})

if __name__ == "__main__":
    main()
