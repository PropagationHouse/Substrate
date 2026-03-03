import sys
import os
import time
import shutil
import requests
import wave
import numpy as np
import pygame
import torch
import threading
import re
import json
import base64

# Import XGO integration (optional — hardware-specific, not shipped with installer)
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
try:
    from XGO_Audio_Bridge.direct_xgo_integration import xgo_integration
except ImportError:
    xgo_integration = None
from src.voice.elevenlabs_client import ElevenLabsClient
# Initialize pygame mixer
pygame.mixer.init(frequency=24000, size=-16, channels=1)

# Create a lock for audio playback
audio_lock = threading.Lock()
playback_lock = threading.Lock()

# Global variables for playback control
current_playback = None
current_playback_thread = None
current_playback_energy = None

# Create a temporary directory for audio files
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

# Try to import Kokoro, but provide a fallback if not available
try:
    import torch
    from kokoro import KPipeline
    
    # Check for CUDA availability and use GPU if possible
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"[KOKORO] Initializing on device: {device}")
    if device == 'cuda':
        print(f"[KOKORO] GPU: {torch.cuda.get_device_name(0)}")
    
    pipeline = KPipeline(lang_code='a', device=device)  # 'a' for American English
    print(f"[KOKORO] Module loaded successfully on {device.upper()}")
except ImportError as e:
    print(f"Kokoro not available, using fallback: {e}")
    pipeline = None
except Exception as e:
    print(f"Error initializing Kokoro: {str(e)}")
    pipeline = None

# Voice settings with defaults
voice_settings = {
    "voice": "af_heart",      # Default voice
    "speed": 1.0,             # Speaking rate
    "pitch": 0.0,             # Voice pitch adjustment
    "temperature": 0.5,       # Generation randomness
    "top_p": 0.9,             # Sampling diversity
    "enhance_speech": True,   # Apply audio enhancement
    "enabled": True,          # Whether voice is enabled
    "use_elevenlabs_tts": False,  # Use ElevenLabs for all TTS
    "voice_volume": 80,       # Voice reply volume (0-100)
    "sfx_volume": 80,         # SFX volume (0-100)
}

# Function to initialize voice settings from config
def init_from_config(config):
    """Initialize voice settings from the provided config"""
    global voice_settings
    
    print(f"[VOICE INIT] init_from_config called")
    print(f"[VOICE INIT] Config has voice_settings: {'voice_settings' in config if config else False}")
    
    if config and 'voice_settings' in config:
        print(f"[VOICE INIT] voice_settings from config: {config['voice_settings']}")
        update_voice_settings(config['voice_settings'])
        print(f"[VOICE INIT] After update, use_elevenlabs_tts = {voice_settings.get('use_elevenlabs_tts')}")
    else:
        print(f"[VOICE INIT] No voice_settings in config, using defaults")
    
    return voice_settings.copy()

# Function to update voice settings from config
def update_voice_settings(settings):
    """Update voice settings from config and apply directly to Kokoro TTS engine"""
    global voice_settings, pipeline
    
    # Voice settings update received
    
    # Track if critical settings changed (those that Kokoro actually uses)
    voice_changed = False
    speed_changed = False
    settings_changed = False
    
    # Map UI settings to Kokoro settings
    # UI uses 'preset' for voice and 'speaking_rate' for speed
    if settings:
        # Map preset to voice if present
        if 'preset' in settings and settings['preset'] != voice_settings.get('voice'):
            voice_settings['voice'] = settings['preset']
            voice_changed = True
            settings_changed = True
            print(f"Voice changed to: {settings['preset']}")
            
        # Map speaking_rate to speed if present
        if 'speaking_rate' in settings and settings['speaking_rate'] != voice_settings.get('speed'):
            voice_settings['speed'] = settings['speaking_rate']
            speed_changed = True
            settings_changed = True
            print(f"Speed changed to: {settings['speaking_rate']}")
            
        # Handle direct settings too (for backward compatibility)
        # Check all keys in settings, not just existing voice_settings keys
        for key in settings:
            if key not in ['preset', 'speaking_rate']:  # Skip already-handled keys
                if key not in voice_settings or voice_settings[key] != settings[key]:
                    # Track which specific settings changed
                    if key == 'voice':
                        voice_changed = True
                    elif key == 'speed':
                        speed_changed = True
                        
                    # Update the setting
                    old_value = voice_settings.get(key, 'NOT_SET')
                    voice_settings[key] = settings[key]
                    settings_changed = True
                    
                    # Log important settings changes
                    if key == 'use_elevenlabs_tts':
                        pass  # ElevenLabs TTS setting changed
        
        if not settings_changed:
            return voice_settings.copy()
        
        # Only reinitialize if voice or speed changed - these are the only parameters
        # that Kokoro actually uses during synthesis
        if voice_changed or speed_changed:
            print(f"Critical Kokoro settings changed: voice={voice_changed}, speed={speed_changed}")
            
            # If voice changed, we need to completely reinitialize the pipeline
            # If only speed changed, we can just update the setting
            if voice_changed:
                try:
                    import torch
                    from kokoro import KPipeline
                    print("Reinitializing Kokoro pipeline for voice change")
                    
                    # Use GPU if available
                    device = 'cuda' if torch.cuda.is_available() else 'cpu'
                    
                    # Create a brand new pipeline instance
                    pipeline = KPipeline(lang_code='a', device=device)  # 'a' for American English
                    print(f"New Kokoro pipeline initialized on {device.upper()}")
                except Exception as e:
                    print(f"Error reinitializing Kokoro pipeline: {str(e)}")
            
            # Test the new settings by generating a small audio sample
            if pipeline:
                try:
                    # Generate a test audio with the current settings
                    test_text = "Voice settings updated."
                    
                    # This will force the pipeline to load the voice
                    generator = pipeline(
                        test_text, 
                        voice=voice_settings["voice"], 
                        speed=voice_settings["speed"]
                    )
                    
                    # Process the first segment to verify settings
                    audio_generated = False
                    for i, (gs, ps, audio) in enumerate(generator):
                        if i == 0:  # Only process the first segment
                            if audio is not None:
                                audio_generated = True
                            break
                        
                except Exception as e:
                    pass  # Voice test error
        
        # Send status update to frontend
        send_voice_status('settings_updated')
        
        # Return copy of updated settings
        return voice_settings.copy()
    
    # Return current settings if no update provided
    return voice_settings.copy()

# Reference to the message buffer for sending status updates
message_buffer = None
proxy_server = None

# ElevenLabs configuration - loaded from config, no hardcoded keys
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_AGENT_ID = os.environ.get("ELEVENLABS_AGENT_ID", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "")

elevenlabs_client = None
elevenlabs_active = False
elevenlabs_lock = threading.Lock()
elevenlabs_transcripts = []

def update_elevenlabs_credentials(config):
    """Update ElevenLabs credentials from config dict."""
    global ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_VOICE_ID
    if not config:
        return
    keys = config.get('remote_api_keys', {})
    if keys.get('elevenlabs_api_key'):
        ELEVENLABS_API_KEY = keys['elevenlabs_api_key']
        os.environ['ELEVENLABS_API_KEY'] = ELEVENLABS_API_KEY
    if keys.get('elevenlabs_voice_id'):
        ELEVENLABS_VOICE_ID = keys['elevenlabs_voice_id']
    if keys.get('elevenlabs_agent_id'):
        ELEVENLABS_AGENT_ID = keys['elevenlabs_agent_id']
    print(f"[VOICE] ElevenLabs credentials updated: key={'set' if ELEVENLABS_API_KEY else 'empty'}, voice={'set' if ELEVENLABS_VOICE_ID else 'empty'}, agent={'set' if ELEVENLABS_AGENT_ID else 'empty'}")

def set_message_buffer(buffer):
    """Set the message buffer for sending status updates"""
    global message_buffer
    message_buffer = buffer

def set_proxy_server(server):
    """Set the proxy server for sending status updates"""
    global proxy_server
    proxy_server = server

def _elevenlabs_agent_audio_handler(pcm_bytes: bytes, sample_rate: int):
    try:
        timestamp = int(time.time() * 1000)
        filename = os.path.join(TEMP_DIR, f'elevenlabs_{timestamp}.wav')
        with wave.open(filename, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        with playback_lock:
            global current_playback
            current_playback = filename
        play_audio_segment(filename)
    except Exception as exc:
        print(f"ElevenLabs audio playback error: {exc}")

def _elevenlabs_transcript_handler(text: str, is_final: bool, speaker: str = "agent"):
    elevenlabs_transcripts.append({
        "text": text,
        "final": is_final,
        "speaker": speaker,
        "ts": time.time()
    })

    # Ignore user transcripts; they are already visible via the local UI
    if speaker != "agent":
        return

    # Only send final agent transcripts to chat UI to avoid spam
    if is_final:
        payload = {
            "type": "transcript",
            "source": "elevenlabs",
            "speaker": speaker,
            "text": text,
            "final": is_final
        }
        print(f"[TRANSCRIPT] Sending agent transcript to frontend: {text[:50]}...")
        try:
            if proxy_server:
                print(f"[TRANSCRIPT] Using proxy_server.send_message_to_frontend")
                proxy_server.send_message_to_frontend(payload)
            elif message_buffer:
                print(f"[TRANSCRIPT] Using message_buffer.send")
                message_buffer.send(payload)
            else:
                print(f"[TRANSCRIPT] ERROR: No proxy_server or message_buffer available!")
        except Exception as exc:
            print(f"[TRANSCRIPT] Failed to forward ElevenLabs transcript: {exc}")

def _elevenlabs_status_handler(status: str):
    global elevenlabs_active
    payload = {
        "type": "voice",
        "status": f"elevenlabs:{status}",
        "suppress_chat": True
    }
    if status == "disconnected" or status.startswith("error"):
        with elevenlabs_lock:
            elevenlabs_active = False
    try:
        if proxy_server:
            proxy_server.send_message_to_frontend(payload)
        elif message_buffer:
            message_buffer.send(payload)
    except Exception:
        pass

def activate_elevenlabs_mode():
    global elevenlabs_client, elevenlabs_active
    with elevenlabs_lock:
        if elevenlabs_active:
            return True
        elevenlabs_client = ElevenLabsClient(
            api_key=ELEVENLABS_API_KEY,
            agent_id=ELEVENLABS_AGENT_ID,
            voice_id=ELEVENLABS_VOICE_ID,
            on_agent_audio=_elevenlabs_agent_audio_handler,
            on_transcript=_elevenlabs_transcript_handler,
            on_status=_elevenlabs_status_handler,
        )
        elevenlabs_client.start()
        elevenlabs_active = True
        return True

def deactivate_elevenlabs_mode():
    """Stop the ElevenLabs session and release resources."""
    global elevenlabs_client, elevenlabs_active
    with elevenlabs_lock:
        if not elevenlabs_active:
            return False
        client = elevenlabs_client
        elevenlabs_client = None
        elevenlabs_active = False
    if client:
        try:
            client.stop()
        except Exception as exc:
            print(f"ElevenLabs stop error: {exc}")
    send_voice_status('elevenlabs_inactive')
    return True

def start_elevenlabs_conversation():
    started = activate_elevenlabs_mode()
    if started:
        send_voice_status('elevenlabs_active')
    else:
        send_voice_status('elevenlabs_failed')
    return started

def stop_elevenlabs_conversation():
    return deactivate_elevenlabs_mode()

def is_elevenlabs_mode_active():
    return elevenlabs_active
def send_voice_status(status):
    """Send voice status update to frontend"""
    try:
        print(f"Sending voice status: {status}")
        # Format message for frontend
        message = {
            'type': 'voice',
            'status': status
        }
        # Convert to JSON and send to frontend
        if proxy_server:
            proxy_server.send_message_to_frontend(message)
        elif message_buffer:
            # Fallback to message buffer if proxy_server not set
            message_buffer.send(message)
    except Exception as e:
        print(f"Error sending voice status: {str(e)}")

def send_avatar_energy(value):
    """Emit a lightweight avatar energy sample to frontend/feed (0..1)."""
    try:
        value = max(0.0, min(1.0, float(value)))
        message = {
            'type': 'avatar',
            'state': 'talking',
            'energy': value,
            'suppress_chat': True
        }
        if proxy_server:
            proxy_server.send_message_to_frontend(message, silent=True)
        elif message_buffer:
            message_buffer.send(message)
    except Exception:
        pass  # Suppress avatar energy errors to reduce log spam

def stop_current_playback():
    """Stop any currently playing audio"""
    global current_playback, current_playback_thread
    
    with playback_lock:
        if pygame.mixer.music.get_busy():
            pygame.mixer.music.stop()
            print("Stopped current audio playback")
        current_playback = None
        if current_playback_thread and current_playback_thread.is_alive():
            current_playback_thread.join(timeout=0.1)  # Give it a short time to finish
            current_playback_thread = None
ENERGY_MAP = {}  # filename -> list/np.array of 0..1 energy samples at 20ms

def clean_text(text):
    """Clean text for speech synthesis"""
    # Remove URLs
    text = re.sub(r'https?://\S+', '', text)
    # Remove markdown code blocks
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    # Remove inline code
    text = re.sub(r'`[^`]+`', '', text)
    # Remove JSON-like error blocks (curly brace blocks with "error" or "status")
    text = re.sub(r'\{[^}]*"(?:error|status|code|message)"[^}]*\}', '', text, flags=re.DOTALL)
    # Remove raw error/stack trace lines
    text = re.sub(r'(?:Error calling|INVALID_ARGUMENT|status_code|traceback|Traceback|raise |Exception:).*', '', text, flags=re.IGNORECASE)
    return text

def play_audio_segment(filename):
    """Play a single audio segment"""
    if os.path.exists(filename) and os.path.getsize(filename) > 0:
        try:
            # Send status update that audio playback is starting
            send_voice_status('speaking')
            # Prepare energy stream if available
            local_vu = None
            try:
                local_vu = ENERGY_MAP.get(filename)
            except Exception:
                local_vu = None
            last_energy_idx = -1
            
            print(f"Playing audio file: {filename}")
            pygame.mixer.music.load(filename)
            vol = voice_settings.get('voice_volume', 80)
            pygame.mixer.music.set_volume(max(0.0, min(1.0, vol / 100.0)))
            pygame.mixer.music.play()
            
            # Track if we're interrupted
            interrupted = False
            
            # Start playback but don't block indefinitely
            # Check for interruption in small intervals
            start_time = time.time()
            while pygame.mixer.music.get_busy():
                # Very short sleep to allow for immediate interruption
                time.sleep(0.01)  
                
                # Check if we've been interrupted by a new message
                with playback_lock:
                    if not current_playback or current_playback != filename:
                        pygame.mixer.music.stop()
                        interrupted = True
                        print("Audio playback interrupted by new message")
                        break
                # Emit energy sample every ~20ms if available
                if local_vu is not None and len(local_vu) > 0:
                    elapsed = time.time() - start_time
                    idx = int(elapsed / 0.02)
                    if idx >= len(local_vu):
                        idx = len(local_vu) - 1
                    if idx != last_energy_idx and idx >= 0:
                        last_energy_idx = idx
                        try:
                            send_avatar_energy(float(local_vu[idx]))
                        except Exception:
                            pass
                
            # If we weren't interrupted, make sure playback has stopped
            if not interrupted:
                pygame.mixer.music.stop()
            
            # Send status update that audio playback has stopped
            send_voice_status('stopped')
            # Send a silence energy to close mouth
            try:
                send_avatar_energy(0.0)
            except Exception:
                pass
            # Cleanup stored energy
            try:
                if filename in ENERGY_MAP:
                    del ENERGY_MAP[filename]
            except Exception:
                pass
            if not interrupted:
                print("Audio playback completed normally")
                
        except Exception as e:
            print(f"Error playing audio: {str(e)}")
            send_voice_status('stopped')  # Make sure we send stopped if there's an error

def create_silent_wav(duration=1.0, filename=None):
    """Create a silent WAV file as a fallback"""
    if filename is None:
        timestamp = int(time.time() * 1000)
        filename = os.path.join(TEMP_DIR, f'silent_{timestamp}.wav')
    
    # Create a silent audio sample
    sample_rate = 24000
    num_samples = int(duration * sample_rate)
    silence = np.zeros(num_samples, dtype=np.int16)
    
    # Write to WAV file
    with wave.open(filename, 'wb') as wav_file:
        wav_file.setnchannels(1)  # mono
        wav_file.setsampwidth(2)  # 2 bytes per sample (16-bit)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(silence.tobytes())
    
    # Stream audio to XGO Rider
    try:
        # Copy the audio file to XGO audio directory
        xgo_audio_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../XGO_Audio_Bridge/xgo_audio")
        os.makedirs(xgo_audio_dir, exist_ok=True)
        xgo_filename = os.path.join(xgo_audio_dir, f"xgo_{int(time.time())}.wav")
        shutil.copy2(filename, xgo_filename)
        
        # Stream the audio file to XGO Rider
        if xgo_integration is not None:
            threading.Thread(target=xgo_integration.stream_audio_file, args=(xgo_filename,), daemon=True).start()
    except Exception as e:
        print(f"Error streaming audio to XGO: {str(e)}")
    
    return filename

def speak_elevenlabs_rest(text):
    """Use ElevenLabs REST API for TTS with optional streaming to WebUI"""
    try:
        print(f"[ElevenLabs REST] Starting TTS for text: {text[:50]}...")
        
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}?output_format=pcm_16000"
        headers = {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }

        # Check if WebUI streaming is available
        can_stream_ws = proxy_server and hasattr(proxy_server, 'tts_stream_chunk')

        response = requests.post(url, json=payload, headers=headers, timeout=30, stream=can_stream_ws)
        
        if response.status_code == 200:
            timestamp = int(time.time() * 1000)
            filename = os.path.join(TEMP_DIR, f'elevenlabs_tts_{timestamp}.wav')
            sample_rate = 16000

            if can_stream_ws:
                # Streaming mode: push chunks to WebUI as they arrive
                try:
                    proxy_server.tts_stream_start(sample_rate)
                except Exception:
                    pass

                all_pcm = bytearray()
                for chunk in response.iter_content(chunk_size=4096):
                    if chunk:
                        all_pcm.extend(chunk)
                        try:
                            proxy_server.tts_stream_chunk(chunk, sample_rate=sample_rate)
                        except Exception:
                            pass

                try:
                    proxy_server.tts_stream_end()
                except Exception:
                    pass

                pcm_data = bytes(all_pcm)
            else:
                # Non-streaming fallback
                pcm_data = response.content

            # Save WAV file for local playback + XGO
            with wave.open(filename, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm_data)
            
            print(f"[ElevenLabs REST] Saved {len(pcm_data)/1024:.1f} KB audio to {filename}")
            return filename
        else:
            print(f"[ElevenLabs REST] Error: status {response.status_code}")
            print(f"[ElevenLabs REST] Response text: {response.text[:200]}")
    except requests.exceptions.RequestException as e:
        print(f"[ElevenLabs REST] Request exception: {e}")
    except Exception as e:
        print(f"[ElevenLabs REST] Exception: {e}")
        import traceback
        traceback.print_exc()
    return None

def speak(text):
    """Convert text to speech and play it asynchronously"""
    global current_playback, current_playback_thread

    print(f"[SPEAK] speak() called with text: {text[:50] if text else 'None'}...")
    print(f"[SPEAK] elevenlabs_active: {elevenlabs_active}")
    print(f"[SPEAK] voice_settings: {voice_settings}")

    if elevenlabs_active:
        print("Skipping TTS playback while ElevenLabs session is active")
        return

    if not text or not isinstance(text, str):
        print(f"[SPEAK] Returning early - text is None or not string")
        return
    
    # Clean the text before processing
    text = clean_text(text)
    if not text.strip():
        return
        
    # This is critical: First forcibly stop any current playback
    stop_current_playback()
    
    # If there's a current playback thread, forcibly terminate it by setting current_playback to None
    with playback_lock:
        current_playback = None
        
    # Small delay to ensure previous audio has stopped
    time.sleep(0.05)
    
    # Store the complete text for audio generation
    # Create a unique identifier for this speech request
    speech_id = f"speech_{int(time.time() * 1000)}"
    
    def play_speech():
        global current_playback
        # Acquire lock to prevent multiple simultaneous playbacks
        with audio_lock:
            try:
                # Early check - if another audio started since this thread was created, exit
                with playback_lock:
                    if current_playback != speech_id:
                        print(f"Another speech started, cancelling {speech_id}")
                        return
                
                # Try ElevenLabs REST TTS if enabled
                use_elevenlabs = voice_settings.get("use_elevenlabs_tts", False)
                print(f"[SPEAK] use_elevenlabs_tts flag: {use_elevenlabs}")
                print(f"[SPEAK] Full voice_settings dict: {voice_settings}")
                print(f"[SPEAK] Type of use_elevenlabs_tts: {type(use_elevenlabs)}")
                if use_elevenlabs:
                    print(f"Attempting ElevenLabs REST TTS for: {speech_id}")
                    filename = speak_elevenlabs_rest(text)
                    if filename and os.path.exists(filename):
                        with playback_lock:
                            current_playback = filename
                        
                        # Send audio URL to web UI for remote playback (mobile, etc.)
                        try:
                            url = f"/audio/{os.path.basename(filename)}"
                            if proxy_server:
                                proxy_server.send_message_to_frontend({
                                    "type": "voice-audio",
                                    "url": url
                                })
                            elif message_buffer:
                                message_buffer.send({
                                    "type": "voice-audio",
                                    "url": url
                                })
                        except Exception as _e:
                            print(f"Error announcing ElevenLabs audio URL to WebUI: {_e}")
                        
                        # Copy to XGO audio directory for robot playback
                        try:
                            xgo_audio_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../XGO_Audio_Bridge/xgo_audio")
                            os.makedirs(xgo_audio_dir, exist_ok=True)
                            xgo_filename = os.path.join(xgo_audio_dir, os.path.basename(filename))
                            shutil.copy2(filename, xgo_filename)
                            threading.Thread(target=xgo_integration.send_audio, args=(xgo_filename,), daemon=True).start()
                        except Exception as e:
                            print(f"Error streaming ElevenLabs to XGO: {str(e)}")
                        
                        # Play locally on PC
                        play_audio_segment(filename)
                        
                        # Schedule cleanup outside the lock so next TTS isn't blocked
                        def _cleanup_el(f=filename):
                            try:
                                time.sleep(30)
                                if os.path.exists(f): os.remove(f)
                            except Exception: pass
                        threading.Thread(target=_cleanup_el, daemon=True).start()
                        return
                    else:
                        print("ElevenLabs REST TTS failed, falling back to Kokoro")
                        
                # Check if Kokoro is available
                if pipeline:
                    print(f"Using Kokoro for speech synthesis: {speech_id}")
                    
                    try:
                        # According to Kokoro documentation, only voice and speed are supported parameters
                        generator = pipeline(
                            text, 
                            voice=voice_settings["voice"], 
                            speed=voice_settings["speed"]
                        )
                        
                    except Exception as e:
                        print(f"Error creating speech generator: {str(e)}")
                        send_voice_status('stopped')
                        return
                    
                    # Check if WebUI streaming is available
                    _can_stream = proxy_server and hasattr(proxy_server, 'tts_stream_chunk')
                    if _can_stream:
                        try: proxy_server.tts_stream_start(24000)
                        except Exception: pass

                    # Process audio segments — stream each to WebUI as generated
                    audio_segments = []
                    for i, (gs, ps, audio) in enumerate(generator):
                        # Early exit if we've been interrupted
                        with playback_lock:
                            if current_playback != speech_id:
                                print(f"Speech generation interrupted, cancelling {speech_id}")
                                if _can_stream:
                                    try: proxy_server.tts_stream_end()
                                    except Exception: pass
                                return
                                
                        # Convert PyTorch tensor to numpy array and then to int16
                        if isinstance(audio, torch.Tensor):
                            audio = audio.detach().cpu().numpy()
                        audio_int16 = (audio * 32767).astype(np.int16)
                        
                        # Stream this segment to WebUI in real-time
                        if _can_stream:
                            try: proxy_server.tts_stream_chunk(audio_int16.tobytes(), sample_rate=24000)
                            except Exception: pass
                        
                        # Store the audio segment
                        audio_segments.append(audio_int16)
                    
                    # Notify WebUI that all TTS segments have been streamed
                    if _can_stream:
                        try: proxy_server.tts_stream_end()
                        except Exception: pass

                    # Combine all audio segments into a single file
                    if audio_segments:
                        combined_audio = np.concatenate(audio_segments)
                        timestamp = int(time.time() * 1000)
                        filename = os.path.join(TEMP_DIR, f'combined_audio_{timestamp}.wav')
                        
                        # Write WAV file with combined audio
                        with wave.open(filename, 'wb') as wav_file:
                            wav_file.setnchannels(1)  # mono
                            wav_file.setsampwidth(2)  # 2 bytes per sample (16-bit)
                            wav_file.setframerate(24000)
                            wav_file.writeframes(combined_audio.tobytes())
                        
                        # Prepare voice energy stream from combined_audio (RMS over 20ms windows)
                        try:
                            win = int(0.02 * 24000)  # 20ms at 24kHz
                            if win <= 0: win = 480
                            # Normalize to [-1,1] float then compute RMS
                            f = combined_audio.astype(np.float32) / 32767.0
                            # Pad to multiple of win
                            pad = (win - (len(f) % win)) % win
                            if pad:
                                f = np.pad(f, (0, pad))
                            frames = f.reshape(-1, win)
                            rms = np.sqrt((frames ** 2).mean(axis=1))
                            # Smooth a bit
                            if len(rms) > 2:
                                rms = np.convolve(rms, np.ones(3)/3.0, mode='same')
                            # Normalize to 0..1
                            maxv = float(rms.max()) if rms.size else 1.0
                            if maxv <= 1e-6: maxv = 1.0
                            vu = (rms / maxv).clip(0.0, 1.0)
                            # Store energy timeline for this file so UI can animate mouth
                            try:
                                ENERGY_MAP[filename] = vu
                            except Exception:
                                pass
                            
                            # Notify WebUI with a local URL to this audio for browser playback
                            try:
                                # Emit a relative URL so WebUI can prefix with proxyBase (correct host/port)
                                url = f"/audio/{os.path.basename(filename)}"
                                if proxy_server:
                                    proxy_server.send_message_to_frontend({
                                        "type": "voice-audio",
                                        "url": url
                                    })
                                elif message_buffer:
                                    message_buffer.send({
                                        "type": "voice-audio",
                                        "url": url
                                    })
                            except Exception as _e:
                                print(f"Error announcing WebUI audio URL: {_e}")

                            # Copy file to XGO audio directory (guard path)
                            xgo_audio_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../XGO_Audio_Bridge/xgo_audio")
                            os.makedirs(xgo_audio_dir, exist_ok=True)
                            xgo_filename = os.path.join(xgo_audio_dir, os.path.basename(filename))
                            shutil.copy2(filename, xgo_filename)
                            print(f"Copied to XGO audio directory: {xgo_filename}")
                            
                            # Stream audio file to XGO
                            threading.Thread(target=xgo_integration.send_audio, args=(xgo_filename,), daemon=True).start()
                        except Exception as e:
                            print(f"Error streaming to XGO: {str(e)}")
                        
                        # Play the combined audio locally
                        # IMPORTANT: set current_playback to filename so interruption check passes
                        with playback_lock:
                            current_playback = filename
                        play_audio_segment(filename)
                        
                        # Schedule cleanup outside the lock so next TTS isn't blocked
                        def _cleanup_ko(f=filename):
                            try:
                                time.sleep(30)
                                if os.path.exists(f): os.remove(f)
                            except Exception: pass
                        threading.Thread(target=_cleanup_ko, daemon=True).start()
                else:
                    # Fallback: create a silent WAV file if Kokoro is not available
                    print("Using fallback silent audio")
                    filename = create_silent_wav(duration=len(text) * 0.1)  # Rough estimate of speech duration
                    
                    # Update current playback and play the segment
                    with playback_lock:
                        if current_playback != speech_id:
                            return
                        current_playback = filename
                    
                    # Play this segment
                    play_audio_segment(filename)
                    
                    # Clean up the temporary file
                    try:
                        if os.path.exists(filename):
                            os.remove(filename)
                    except Exception as e:
                        print(f"Error removing temp file: {str(e)}")
                
            except Exception as e:
                print(f"Error in speech synthesis: {str(e)}")
                send_voice_status('stopped')  # Make sure we send stopped if there's an error
            finally:
                with playback_lock:
                    # Only reset if this thread's audio was playing
                    if current_playback == speech_id or (isinstance(current_playback, str) and 
                                                        "combined_audio" in current_playback):
                        current_playback = None
    
    # Set the current playback to this speech ID
    with playback_lock:
        current_playback = speech_id
    
    # Start playback in a new thread
    current_playback_thread = threading.Thread(target=play_speech)
    current_playback_thread.daemon = True  # Thread will be terminated when main program exits
    current_playback_thread.start()

class VoiceHandler:
    """Handler for voice synthesis and playback"""
    
    def __init__(self):
        """Initialize the voice handler"""
        # Make sure pygame mixer is initialized
        if not pygame.mixer.get_init():
            pygame.mixer.init(frequency=24000, size=-16, channels=1)
        print("Voice handler initialized")
        
    def speak(self, text):
        """Speak the given text"""
        speak(text)
        
    def stop(self):
        """Stop current playback"""
        stop_current_playback()

# Example usage
if __name__ == '__main__':
    voice_handler = VoiceHandler()
    voice_handler.speak("Hello, I am your assistant.")
