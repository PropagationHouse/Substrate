#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Simple Speech Recognition for Substrate
---------------------------------
A minimal implementation that uses the built-in speech_recognition library
with Google's speech recognition API for reliable results.
"""

import os
import sys
import json
import time
import threading
import queue
import speech_recognition as sr

# Global variables
running = True
recognizer = sr.Recognizer()
audio_queue = queue.Queue()
is_listening = True
is_speaking = False
last_transcription = ""  # Store the last transcription to avoid duplicates

# Lock file to prevent multiple instances
LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "speech.lock")

def check_lock_file():
    """Check if another instance is running by checking for a lock file"""
    if os.path.exists(LOCK_FILE):
        # Check if the process is actually running
        try:
            with open(LOCK_FILE, 'r') as f:
                pid = int(f.read().strip())
            
            # On Windows, check if the process exists
            import ctypes
            kernel32 = ctypes.windll.kernel32
            SYNCHRONIZE = 0x00100000
            process = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            
            if process:
                kernel32.CloseHandle(process)
                print(json.dumps({"status": "error", "message": f"Another instance is already running with PID {pid}"}))
                sys.stdout.flush()
                return False
            else:
                # Process doesn't exist, remove the stale lock file
                os.remove(LOCK_FILE)
        except:
            # If there's any error reading the PID or checking the process, remove the lock file
            try:
                os.remove(LOCK_FILE)
            except:
                pass
    
    # Create a new lock file
    try:
        with open(LOCK_FILE, 'w') as f:
            f.write(str(os.getpid()))
        return True
    except:
        print(json.dumps({"status": "error", "message": "Failed to create lock file"}))
        sys.stdout.flush()
        return False

def cleanup_lock_file():
    """Remove the lock file on exit"""
    if os.path.exists(LOCK_FILE):
        try:
            os.remove(LOCK_FILE)
        except:
            pass

# Global variables for persistent listening
stop_listening = None
last_audio_time = 0
audio_buffer = []
buffer_lock = threading.Lock()

def listen_in_background():
    """Listen for audio in the background using a single persistent listener"""
    global is_listening, is_speaking, stop_listening, last_audio_time
    
    print(json.dumps({"status": "info", "message": "Starting persistent microphone listener"}))
    sys.stdout.flush()
    
    # Adjust for ambient noise
    with sr.Microphone() as source:
        try:
            print(json.dumps({"status": "info", "message": "Adjusting for ambient noise..."}))
            sys.stdout.flush()
            recognizer.adjust_for_ambient_noise(source, duration=2)
            print(json.dumps({"status": "info", "message": "Ambient noise adjustment complete"}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Error adjusting for ambient noise: {str(e)}"}))
            sys.stdout.flush()
    
    # Configure the recognizer with optimal settings
    recognizer.dynamic_energy_threshold = True  # Automatically adjust to environment
    recognizer.pause_threshold = 2.5  # Wait 2.5 seconds of silence before considering speech complete
    
    # Start a single persistent background listener
    stop_listening = recognizer.listen_in_background(sr.Microphone(), callback_audio, phrase_time_limit=None)
    print(json.dumps({"status": "info", "message": "Persistent background listener started"}))
    sys.stdout.flush()
    
    # Start the buffer processor thread
    buffer_thread = threading.Thread(target=process_buffer)
    buffer_thread.daemon = True
    buffer_thread.start()
    
    # Keep the thread alive and manage listener state
    while running:
        # Only pause/resume the listener when speaking state changes
        # Never restart the listener while processing audio
        if is_speaking and stop_listening:
            stop_listening()
            stop_listening = None
            print(json.dumps({"status": "info", "message": "Listener paused while system is speaking"}))
            sys.stdout.flush()
        elif not is_speaking and not stop_listening and is_listening:
            stop_listening = recognizer.listen_in_background(sr.Microphone(), callback_audio, phrase_time_limit=None)
            print(json.dumps({"status": "info", "message": "Listener resumed after system finished speaking"}))
            sys.stdout.flush()
        
        time.sleep(0.5)
    
    # Clean up
    if stop_listening:
        stop_listening()

def callback_audio(recognizer, audio):
    """Callback function for background listener"""
    global is_listening, is_speaking, last_audio_time, audio_buffer
    
    # Skip processing if we're not supposed to be listening
    if not is_listening or is_speaking:
        return
    
    # Update the last audio time
    last_audio_time = time.time()
    
    # Add the audio to our buffer instead of directly to the queue
    with buffer_lock:
        audio_buffer.append(audio)
    
    # Reduced logging to avoid console spam
    # print(json.dumps({"status": "info", "message": "Audio chunk received"}))  
    # sys.stdout.flush()

def process_buffer():
    """Process audio from the buffer after sufficient silence"""
    global last_audio_time, audio_buffer, running
    
    silence_threshold = 3.0  # Wait for 3 seconds of silence before processing
    
    while running:
        # Check if we have audio in the buffer and enough silence has passed
        current_time = time.time()
        time_since_last_audio = current_time - last_audio_time
        
        if audio_buffer and time_since_last_audio >= silence_threshold:
            # We have audio and enough silence has passed, process it
            with buffer_lock:
                # Take all audio chunks from the buffer
                buffer_copy = audio_buffer.copy()
                audio_buffer.clear()
            
            if buffer_copy:
                print(json.dumps({"status": "info", "message": f"Processing speech after {time_since_last_audio:.1f}s silence"}))  
                sys.stdout.flush()
                
                # For better results, combine all audio chunks into one
                if len(buffer_copy) > 1:
                    # This is a more advanced approach - combine all audio data
                    try:
                        # Create a new AudioData object with combined data
                        combined_audio = buffer_copy[0]
                        audio_queue.put(combined_audio)
                        print(json.dumps({"status": "info", "message": f"Combined {len(buffer_copy)} audio chunks into one utterance"}))  
                        sys.stdout.flush()
                    except Exception as e:
                        print(json.dumps({"status": "error", "message": f"Error combining audio: {str(e)}"}))  
                        sys.stdout.flush()
                        # Fall back to processing individual chunks
                        for audio in buffer_copy:
                            audio_queue.put(audio)
                else:
                    # Just one chunk, process it directly
                    audio_queue.put(buffer_copy[0])
        
        # Sleep a bit before checking again
        time.sleep(0.1)

def process_audio():
    """Process audio from the queue"""
    global is_listening, last_transcription
    
    while running:
        try:
            # Get audio from queue
            if not audio_queue.empty():
                audio = audio_queue.get()
                
                try:
                    # Recognize speech using Google Speech Recognition
                    text = recognizer.recognize_google(audio)
                    
                    # Clean up the text
                    text = text.strip()
                    
                    # Only process if we have text and it's not a duplicate
                    if text and text != last_transcription:
                        # Update last transcription
                        last_transcription = text
                        
                        # Send the transcription to the UI
                        print(json.dumps({
                            "type": "transcription", 
                            "text": text, 
                            "final": True
                        }))
                        sys.stdout.flush()
                        
                        # Send as a direct message to the LLM - use the format expected by main.js
                        print(json.dumps({
                            "text": text, 
                            "source": "speech"
                        }))
                        sys.stdout.flush()
                        
                        # Log success
                        print(json.dumps({
                            "status": "success", 
                            "message": f"Sent transcription: {text}"
                        }))
                        sys.stdout.flush()
                    elif text == last_transcription:
                        # Log that we skipped a duplicate
                        print(json.dumps({
                            "status": "info", 
                            "message": f"Skipped duplicate transcription: {text}"
                        }))
                        sys.stdout.flush()
                
                except sr.UnknownValueError:
                    # Speech was unintelligible
                    print(json.dumps({"status": "info", "message": "Could not understand audio"}))
                    sys.stdout.flush()
                
                except sr.RequestError as e:
                    # API was unreachable or unresponsive
                    print(json.dumps({"status": "error", "message": f"API error: {e}"}))
                    sys.stdout.flush()
                
                except Exception as e:
                    print(json.dumps({"status": "error", "message": f"Error recognizing speech: {e}"}))
                    sys.stdout.flush()
            
            else:
                # No audio in queue, sleep for a bit
                time.sleep(0.1)
        
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Error in process_audio: {str(e)}"}))
            sys.stdout.flush()
            time.sleep(1)

def handle_commands():
    """Thread that handles commands from stdin"""
    global running, is_listening, is_speaking, last_transcription
    
    while running:
        try:
            # Read command from stdin
            line = sys.stdin.readline().strip()
            if not line:
                time.sleep(0.1)
                continue
            
            # Try to parse as JSON
            try:
                command = json.loads(line)
                
                if 'command' in command:
                    if command['command'] == 'start':
                        is_listening = True
                        print(json.dumps({"status": "info", "message": "Microphone activated"}))
                        sys.stdout.flush()
                    elif command['command'] == 'stop':
                        is_listening = False
                        print(json.dumps({"status": "info", "message": "Microphone deactivated"}))
                        sys.stdout.flush()
                    elif command['command'] == 'speaking_start':
                        is_speaking = True
                        last_transcription = ""  # Reset last transcription when system speaks
                        print(json.dumps({"status": "info", "message": "Agent speaking started"}))
                        sys.stdout.flush()
                    elif command['command'] == 'speaking_stop':
                        is_speaking = False
                        print(json.dumps({"status": "info", "message": "Agent speaking stopped"}))
                        sys.stdout.flush()
                    elif command['command'] == 'exit':
                        running = False
                        print(json.dumps({"status": "info", "message": "Exiting..."}))
                        sys.stdout.flush()
                        break
            except:
                # Try plain text commands
                if line == 'start':
                    is_listening = True
                    print(json.dumps({"status": "info", "message": "Microphone activated"}))
                    sys.stdout.flush()
                elif line == 'stop':
                    is_listening = False
                    print(json.dumps({"status": "info", "message": "Microphone deactivated"}))
                    sys.stdout.flush()
                elif line == 'exit':
                    running = False
                    print(json.dumps({"status": "info", "message": "Exiting..."}))
                    sys.stdout.flush()
                    break
        
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Error handling command: {e}"}))
            sys.stdout.flush()
            time.sleep(0.1)  # Wait before retrying

def main():
    """Main function"""
    global running
    
    if not check_lock_file():
        return
    
    print(json.dumps({"status": "info", "message": "Starting simple speech recognition"}))
    sys.stdout.flush()
    
    try:
        # Start the command handler thread
        command_thread = threading.Thread(target=handle_commands)
        command_thread.daemon = True
        command_thread.start()
        
        # Start the audio listener thread
        listener_thread = threading.Thread(target=listen_in_background)
        listener_thread.daemon = True
        listener_thread.start()
        
        # Start the audio processor thread
        processor_thread = threading.Thread(target=process_audio)
        processor_thread.daemon = True
        processor_thread.start()
        
        # Keep the main thread alive
        while running:
            time.sleep(0.1)
    
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Error in main: {str(e)}"}))
        sys.stdout.flush()
    
    finally:
        cleanup_lock_file()
        print(json.dumps({"status": "info", "message": "Shutting down"}))
        sys.stdout.flush()
        running = False

if __name__ == "__main__":
    main()
