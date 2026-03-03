#!/usr/bin/env python3
"""
XGO Audio Receiver
-----------------
This script runs on the XGO device to receive audio data via UDP
and play it using the device's audio system.
"""

import socket
import os
import time
import threading
import logging
from datetime import datetime

# Configure logging to user's home directory
HOME_DIR = os.path.expanduser("~")
LOG_FILE = os.path.join(HOME_DIR, "xgo_audio_receiver.log")

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
AUDIO_DIR = os.path.join(HOME_DIR, "audio")
MAX_PACKET_SIZE = 65536  # Max UDP packet size

# Ensure audio directory exists
os.makedirs(AUDIO_DIR, exist_ok=True)

def play_audio(audio_file):
    """Play audio file using aplay"""
    try:
        logger.info(f"Playing audio file: {audio_file}")
        print(f"Playing audio file: {audio_file}")
        os.system(f"aplay {audio_file}")
        logger.info(f"Finished playing: {audio_file}")
        print(f"Finished playing: {audio_file}")
    except Exception as e:
        logger.error(f"Error playing audio: {e}")
        print(f"Error playing audio: {e}")

def receive_audio():
    """Receive audio data via UDP and save to file"""
    # Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    logger.info(f"UDP server listening on {UDP_IP}:{UDP_PORT}")
    print(f"UDP server listening on {UDP_IP}:{UDP_PORT}")
    
    # Variables to track file reception
    current_file = None
    file_size = 0
    received_bytes = 0
    file_data = bytearray()
    
    while True:
        try:
            # Receive data
            data, addr = sock.recvfrom(MAX_PACKET_SIZE)
            
            # Check if this is a new file notification
            if data.startswith(b"FILE_SIZE:"):
                # Close previous file if any
                if current_file:
                    logger.warning(f"Incomplete file reception: {current_file}")
                
                # Parse file size
                file_size = int(data[10:].decode('utf-8').split(':')[0])
                file_name = data[10:].decode('utf-8').split(':')[1]
                current_file = os.path.join(AUDIO_DIR, file_name)
                file_data = bytearray()
                received_bytes = 0
                
                logger.info(f"New file notification: {file_name}, size: {file_size} bytes")
                print(f"New file notification: {file_name}, size: {file_size} bytes")
                
                # Send acknowledgment
                sock.sendto(b"ACK", addr)
                
            # Regular data packet
            else:
                if current_file:
                    file_data.extend(data)
                    received_bytes += len(data)
                    
                    # Check if file is complete
                    if received_bytes >= file_size:
                        logger.info(f"File complete: {current_file}, {received_bytes}/{file_size} bytes")
                        print(f"File complete: {current_file}, {received_bytes}/{file_size} bytes")
                        
                        # Save file
                        with open(current_file, 'wb') as f:
                            f.write(file_data)
                        
                        # Play audio in a separate thread
                        threading.Thread(target=play_audio, args=(current_file,)).start()
                        
                        # Reset for next file
                        current_file = None
                        file_data = bytearray()
                        received_bytes = 0
                        file_size = 0
                else:
                    logger.warning(f"Received {len(data)} bytes without file notification")
                    
        except Exception as e:
            logger.error(f"Error receiving data: {e}")
            print(f"Error: {e}")

if __name__ == "__main__":
    logger.info("XGO Audio Receiver starting")
    print("XGO Audio Receiver starting")
    print(f"Log file: {LOG_FILE}")
    print(f"Audio directory: {AUDIO_DIR}")
    
    # Check if aplay is available
    if os.system("which aplay > /dev/null 2>&1") != 0:
        logger.error("aplay not found, audio playback may not work")
        print("WARNING: aplay not found, audio playback may not work")
    else:
        aplay_path = os.popen("which aplay").read().strip()
        print(f"aplay found at: {aplay_path}")
    
    try:
        receive_audio()
    except KeyboardInterrupt:
        logger.info("XGO Audio Receiver stopped by user")
        print("XGO Audio Receiver stopped by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        print(f"ERROR: {e}")
