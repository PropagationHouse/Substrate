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

# Global variables
audio_buffer = np.zeros(0, dtype=np.float32)
buffer_lock = threading.Lock()
processing_queue = queue.Queue()
# Initialize model at module level to avoid delay during speech
print("Pre-loading whisper model... this may take a few seconds")
model = WhisperModel("tiny", device="cpu", compute_type="int8")  # Use int8 for faster loading
print("Model pre-loaded successfully")
is_running = True
last_voice_time = 0
voice_cooldown = 0.2  # Cooldown period in seconds after system speaks (reduced from 0.3)
energy_threshold = 0.004  # Energy threshold to detect speech (slightly more sensitive)
silence_timeout = 0.3  # Seconds of silence before processing (reduced from 0.5)
last_transcription = ""  # Store the last transcription to avoid duplicates
is_processing = False  # Flag to indicate if we're currently processing audio
last_speech_time = 0  # Track when we last detected speech
max_buffer_size = 16000 * 3  # Maximum buffer size (3 seconds) to prevent excessive memory usage

def print_json(data):
    """Print JSON data to stdout and flush"""
    print(json.dumps(data))
    sys.stdout.flush()

def process_audio_thread():
    """Thread function to process audio from the queue"""
    global is_running, last_transcription, is_processing
    
    while is_running:
        try:
            # Get audio from queue with a timeout to allow checking is_running
            try:
                audio_data = processing_queue.get(timeout=0.2)  # Reduced timeout for faster response
            except queue.Empty:
                # Queue is empty, just continue
                continue
            
            # Set processing flag
            is_processing = True
            
            try:
                # Process the audio data with optimized parameters
                segments, info = model.transcribe(
                    audio_data, 
                    beam_size=3,  # Reduced beam size for faster processing
                    language="en",
                    vad_filter=True,  # Enable voice activity detection
                    vad_parameters={"min_silence_duration_ms": 300}  # Detect silence after 300ms
                )
                
                # Convert generator to list
                segments_list = list(segments)
                
                # Extract text from segments
                text = ""
                for segment in segments_list:
                    text += segment.text
                
                # Clean up the text
                text = text.strip()
                
                # Only send if we have text and it's not a duplicate
                if text and text != last_transcription:
                    # Update last transcription
                    last_transcription = text
                    
                    # Send as a direct message to the LLM - use the format expected by main.js
                    print_json({
                        "text": text, 
                        "source": "speech"
                    })
                    
                    # Log success
                    print_json({
                        "status": "info", 
                        "message": f"Sent transcription: {text}"
                    })
                    
                    # Clear the processing queue to avoid backlog
                    while not processing_queue.empty():
                        try:
                            processing_queue.get_nowait()
                            processing_queue.task_done()
                        except:
                            break
                elif text == last_transcription:
                    # Log that we skipped a duplicate
                    print_json({
                        "status": "info", 
                        "message": f"Skipped duplicate transcription: {text}"
                    })
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
    global audio_buffer, last_voice_time, last_speech_time
    
    if status:
        print_json({"status": "warning", "message": f"Audio status: {status}"})
    
    # Convert to mono and float32
    audio_data = indata[:, 0].copy().astype(np.float32)
    
    # Check if we're in the cooldown period after system voice output
    current_time = time.time()
    if current_time - last_voice_time < voice_cooldown:
        return
    
    # Calculate energy level
    energy = np.mean(np.abs(audio_data))
    
    # Only process if energy is above threshold
    if energy < energy_threshold:
        # Check if we should process due to silence timeout
        current_time = time.time()
        if len(audio_buffer) > 0 and current_time - last_speech_time > silence_timeout:
            # Process what we have after silence timeout
            if not is_processing and len(audio_buffer) > 16000 * 0.2:  # At least 0.2 seconds of audio (reduced)
                with buffer_lock:
                    audio_to_process = audio_buffer.copy()
                    audio_buffer = np.zeros(0, dtype=np.float32)
                processing_queue.put(audio_to_process)
                print_json({"status": "info", "message": "Processing after silence detected"})
        return
    
    # Update last speech time when we detect speech
    last_speech_time = time.time()
    
    # Append to buffer with lock
    with buffer_lock:
        audio_buffer = np.concatenate((audio_buffer, audio_data))
        
        # Limit buffer size to prevent memory issues
        if len(audio_buffer) > max_buffer_size:
            audio_buffer = audio_buffer[-max_buffer_size:]
    
    # If buffer is large enough, process it
    if len(audio_buffer) > 16000 * 0.3:  # 0.3 seconds of audio (reduced from 0.4 seconds)
        # Only add to queue if not already processing
        if not is_processing:
            with buffer_lock:
                # Make a copy and clear the buffer
                audio_to_process = audio_buffer.copy()
                audio_buffer = np.zeros(0, dtype=np.float32)
            
            # Add to processing queue
            processing_queue.put(audio_to_process)
        else:
            # If already processing, just clear the buffer to avoid backlog
            with buffer_lock:
                audio_buffer = np.zeros(0, dtype=np.float32)

def main():
    """Main function"""
    global model, is_running, last_voice_time
    
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
        
        # Keep running until interrupted
        while True:
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
                                        
                                print_json({"status": "info", "message": "System speaking - cleared audio buffers"})
                            
                            elif data.get("command") == "start":
                                print_json({"status": "info", "message": "Microphone activated"})
                            
                            elif data.get("command") == "stop":
                                print_json({"status": "info", "message": "Microphone deactivated"})
                                
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
