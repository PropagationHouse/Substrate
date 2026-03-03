#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Basic Speech Recognition for Substrate
---------------------------------------
A simple, reliable implementation using the speech_recognition library.
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
import speech_recognition as sr
import os
import platform

# Global variables
recognizer = sr.Recognizer()
is_running = True
is_listening = True
last_transcription = ""
last_voice_time = 0
voice_cooldown = 1.5  # Cooldown period in seconds after system speaks

def print_json(data):
    """Print JSON data to stdout and flush"""
    print(json.dumps(data))
    sys.stdout.flush()

def list_microphones():
    """List all available microphones"""
    try:
        mics = sr.Microphone.list_microphone_names()
        print_json({"status": "info", "message": f"Available microphones: {len(mics)}"})
        for i, mic in enumerate(mics):
            print_json({"status": "info", "message": f"Mic {i}: {mic}"})
        return mics
    except Exception as e:
        print_json({"status": "error", "message": f"Error listing microphones: {str(e)}"})
        return []

def listen_for_speech():
    """Listen for speech and convert to text"""
    global is_running, is_listening, last_transcription, last_voice_time
    
    print_json({"status": "info", "message": "Starting speech recognition"})
    
    # List available microphones
    mics = list_microphones()
    if not mics:
        print_json({"status": "error", "message": "No microphones found"})
        return
    
    # Try to use the default microphone
    try:
        with sr.Microphone() as source:
            print_json({"status": "info", "message": "Using default microphone"})
            print_json({"status": "info", "message": "Adjusting for ambient noise..."})
            recognizer.adjust_for_ambient_noise(source, duration=2)
            print_json({"status": "info", "message": f"Energy threshold set to {recognizer.energy_threshold}"})
    except Exception as e:
        print_json({"status": "error", "message": f"Error with default microphone: {str(e)}"})
        
        # Try to use a specific microphone
        try:
            # Try to find a microphone with "microphone" or "mic" in the name
            mic_index = None
            for i, mic in enumerate(mics):
                if "microphone" in mic.lower() or "mic" in mic.lower():
                    mic_index = i
                    break
            
            if mic_index is not None:
                print_json({"status": "info", "message": f"Trying microphone {mic_index}: {mics[mic_index]}"})
                with sr.Microphone(device_index=mic_index) as source:
                    print_json({"status": "info", "message": "Adjusting for ambient noise..."})
                    recognizer.adjust_for_ambient_noise(source, duration=2)
                    print_json({"status": "info", "message": f"Energy threshold set to {recognizer.energy_threshold}"})
            else:
                print_json({"status": "error", "message": "No suitable microphone found"})
                return
        except Exception as e:
            print_json({"status": "error", "message": f"Error with alternate microphone: {str(e)}"})
            return
    
    # Set a lower energy threshold for better sensitivity
    recognizer.energy_threshold = 300
    print_json({"status": "info", "message": f"Energy threshold manually set to {recognizer.energy_threshold}"})
    
    # Set dynamic energy threshold for better adaptation
    recognizer.dynamic_energy_threshold = True
    
    # Print system information
    print_json({"status": "info", "message": f"System: {platform.system()} {platform.release()}"})
    print_json({"status": "info", "message": f"Python: {platform.python_version()}"})
    print_json({"status": "info", "message": f"SpeechRecognition version: {sr.__version__}"})
    
    print_json({"status": "info", "message": "Ready to listen for speech"})
    
    while is_running:
        # Check if we're in listening mode
        if not is_listening:
            time.sleep(0.1)
            continue
            
        # Check if we're in the voice cooldown period
        if time.time() - last_voice_time < voice_cooldown:
            time.sleep(0.1)
            continue
        
        try:
            with sr.Microphone() as source:
                print_json({"status": "info", "message": "Listening..."})
                
                # Set a comfortable pause threshold to prevent cutting off mid-sentence
                recognizer.pause_threshold = 2.5  # Wait 2.5 seconds of silence before considering speech complete
                
                # Listen for audio with a timeout but NO phrase time limit
                audio = recognizer.listen(source, timeout=5)
                
                print_json({"status": "info", "message": "Processing audio..."})
                
                # Convert audio to text using Google Speech Recognition
                text = recognizer.recognize_google(audio)
                
                print_json({"status": "info", "message": f"Recognized text: {text}"})
                
                # Only send if it's not a duplicate
                if text and text.strip() != last_transcription:
                    # Update last transcription
                    last_transcription = text.strip()
                    
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
                elif text.strip() == last_transcription:
                    # Log that we skipped a duplicate
                    print_json({
                        "status": "info", 
                        "message": f"Skipped duplicate transcription: {text}"
                    })
                
        except sr.WaitTimeoutError:
            # Timeout is normal, just continue
            pass
        except sr.UnknownValueError:
            # Speech was unintelligible
            print_json({"status": "info", "message": "Could not understand audio"})
        except sr.RequestError as e:
            # API was unreachable or unresponsive
            print_json({"status": "error", "message": f"API error: {str(e)}"})
        except Exception as e:
            # Other errors
            print_json({"status": "error", "message": f"Error: {str(e)}"})
            time.sleep(1)  # Prevent rapid error loops

def handle_commands():
    """Handle commands from stdin"""
    global is_running, is_listening, last_voice_time
    
    while is_running:
        try:
            if sys.stdin.isatty():
                cmd = input().strip()
                if cmd == "exit":
                    is_running = False
                    break
            else:
                line = sys.stdin.readline().strip()
                if line:
                    try:
                        data = json.loads(line)
                        if isinstance(data, dict):
                            if data.get("command") == "exit":
                                is_running = False
                                break
                            elif data.get("command") == "start":
                                is_listening = True
                                print_json({"status": "info", "message": "Microphone activated"})
                            elif data.get("command") == "stop":
                                is_listening = False
                                print_json({"status": "info", "message": "Microphone deactivated"})
                            elif data.get("command") == "speaking_start" or (data.get("type") == "voice" and data.get("status") == "speaking"):
                                # System is speaking, update last voice time
                                last_voice_time = time.time()
                                print_json({"status": "info", "message": "System speaking - paused recognition"})
                            elif data.get("command") == "speaking_stop" or (data.get("type") == "voice" and data.get("status") == "stopped"):
                                # Reset last transcription when system stops speaking
                                last_transcription = ""
                                print_json({"status": "info", "message": "System stopped speaking - resumed recognition"})
                    except json.JSONDecodeError:
                        # Not JSON, ignore
                        pass
                time.sleep(0.1)
        except KeyboardInterrupt:
            is_running = False
            break
        except Exception as e:
            print_json({"status": "error", "message": f"Command handler error: {str(e)}"})
            time.sleep(1)

def main():
    """Main function"""
    global is_running
    
    try:
        # Start command handler thread
        command_thread = threading.Thread(target=handle_commands)
        command_thread.daemon = True
        command_thread.start()
        
        # Start speech recognition in the main thread
        listen_for_speech()
    except KeyboardInterrupt:
        is_running = False
        print_json({"status": "info", "message": "Interrupted by user"})
    except Exception as e:
        print_json({"status": "error", "message": f"Error: {str(e)}"})
    finally:
        is_running = False
        print_json({"status": "info", "message": "Speech recognition stopped"})

if __name__ == "__main__":
    main()
