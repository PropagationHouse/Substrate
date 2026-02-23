#!/usr/bin/env python3
"""
XGO Audio Receiver - Compatible with standalone_xgo_bridge_220.py
----------------------------------------------------------------
This script runs on the XGO device to receive audio data via UDP
using the same protocol as standalone_xgo_bridge_220.py
"""

import socket
import os
import time
import threading
import logging
import json
import binascii
from datetime import datetime

# Configure logging to user's home directory
HOME_DIR = os.path.expanduser("~")
LOG_FILE = os.path.join(HOME_DIR, "xgo_audio_receiver.log")
AUDIO_DIR = os.path.join(HOME_DIR, "audio")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    filename=LOG_FILE,
    filemode='a'
)
logger = logging.getLogger(__name__)

# Configuration
UDP_IP = "0.0.0.0"  # Listen on all interfaces
UDP_PORT = 12345
MAX_PACKET_SIZE = 65536  # Max UDP packet size

# Ensure audio directory exists
os.makedirs(AUDIO_DIR, exist_ok=True)

def play_audio(audio_file):
    """Play audio file using aplay"""
    try:
        logger.info(f"Playing audio file: {audio_file}")
        print(f"Playing audio file: {audio_file}")
        
        # Try multiple methods to play audio
        methods = [
            f"aplay {audio_file}",
            f"aplay -D plughw:0,0 {audio_file}",
            f"aplay -D plughw:0,0 -f S16_LE -r 44100 {audio_file}",
            f"speaker-test -t wav -c 2 -w {audio_file} -l 1"
        ]
        
        for i, cmd in enumerate(methods, 1):
            print(f"Trying method {i}: {cmd}")
            result = os.system(cmd)
            print(f"Method {i} result: {result}")
            
            if result == 0:
                print(f"Method {i} succeeded!")
                break
        
        logger.info(f"Finished playing: {audio_file}")
        print(f"Finished playing: {audio_file}")
    except Exception as e:
        logger.error(f"Error playing audio: {e}")
        print(f"Error playing audio: {e}")

def receive_audio():
    """Receive audio data via UDP using the protocol from standalone_xgo_bridge_220.py"""
    # Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    logger.info(f"UDP server listening on {UDP_IP}:{UDP_PORT}")
    print(f"UDP server listening on {UDP_IP}:{UDP_PORT}")
    
    # Variables to track file reception
    current_file_data = bytearray()
    current_file_size = 0
    current_chunks = {}
    total_chunks = 0
    current_filename = None
    
    while True:
        try:
            # Receive data
            data, addr = sock.recvfrom(MAX_PACKET_SIZE)
            
            try:
                # Parse JSON message
                message = json.loads(data.decode('utf-8'))
                message_type = message.get('type')
                
                # Handle different message types
                if message_type == 'size':
                    # New file size notification
                    current_file_size = message.get('size', 0)
                    current_chunks = {}
                    current_file_data = bytearray()
                    total_chunks = 0
                    
                    logger.info(f"New file notification, size: {current_file_size} bytes")
                    print(f"New file notification, size: {current_file_size} bytes")
                    
                    # Send acknowledgment
                    sock.sendto(b"ACK", addr)
                
                elif message_type == 'data':
                    # Data chunk
                    seq = message.get('seq', -1)
                    total_chunks = message.get('total', 0)
                    chunk_data = binascii.unhexlify(message.get('data', ''))
                    
                    # Store chunk
                    current_chunks[seq] = chunk_data
                    
                    # Print progress occasionally
                    if seq % 10 == 0 or len(current_chunks) == total_chunks:
                        print(f"Received chunk {seq+1}/{total_chunks} ({len(current_chunks)}/{total_chunks} chunks)")
                
                elif message_type == 'end':
                    # End of file
                    current_filename = message.get('filename', f"audio_{int(time.time())}.wav")
                    
                    # Check if we have all chunks
                    if len(current_chunks) == total_chunks:
                        # Reassemble file
                        for i in range(total_chunks):
                            if i in current_chunks:
                                current_file_data.extend(current_chunks[i])
                        
                        # Save file
                        output_file = os.path.join(AUDIO_DIR, current_filename)
                        with open(output_file, 'wb') as f:
                            f.write(current_file_data)
                        
                        logger.info(f"File complete: {output_file}, {len(current_file_data)} bytes")
                        print(f"File complete: {output_file}, {len(current_file_data)} bytes")
                        
                        # Play audio in a separate thread
                        threading.Thread(target=play_audio, args=(output_file,)).start()
                    else:
                        logger.warning(f"Incomplete file: {len(current_chunks)}/{total_chunks} chunks received")
                        print(f"Incomplete file: {len(current_chunks)}/{total_chunks} chunks received")
                    
                    # Reset for next file
                    current_chunks = {}
                    current_file_data = bytearray()
                    current_file_size = 0
                    total_chunks = 0
                    current_filename = None
                
            except json.JSONDecodeError:
                logger.warning(f"Received non-JSON data: {data[:20]}...")
                print(f"Received non-JSON data: {data[:20]}...")
                
        except Exception as e:
            logger.error(f"Error receiving data: {e}")
            print(f"Error: {e}")

def check_audio_devices():
    """Check available audio devices"""
    try:
        print("Checking audio devices:")
        os.system("aplay -l")
        print("\nChecking audio mixer settings:")
        os.system("amixer")
        print("\nChecking if audio files exist:")
        os.system(f"ls -la {AUDIO_DIR}")
    except Exception as e:
        print(f"Error checking audio devices: {e}")

if __name__ == "__main__":
    logger.info("XGO Audio Receiver starting")
    print("XGO Audio Receiver starting")
    print(f"Log file: {LOG_FILE}")
    print(f"Audio directory: {AUDIO_DIR}")
    
    # Check audio configuration
    check_audio_devices()
    
    try:
        receive_audio()
    except KeyboardInterrupt:
        logger.info("XGO Audio Receiver stopped by user")
        print("XGO Audio Receiver stopped by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        print(f"ERROR: {e}")
