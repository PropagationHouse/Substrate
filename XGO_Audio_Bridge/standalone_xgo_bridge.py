import os
import time
import sys
import shutil
import logging
import threading
import socket
import json
import wave
from datetime import datetime
from flask import Flask, jsonify
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global variables
DEFAULT_XGO_IP = "10.147.17.147"  # XGO ZeroTier IP (primary — works on any network)
XGO_LOCAL_IP = "10.0.0.144"       # XGO local WiFi IP (fallback)
PROXY_SERVER_URL = "http://localhost:8765"  # proxy_server base URL
UDP_PORT = 12345  # UDP port for XGO communication
DEFAULT_MONITOR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'voice', 'temp')
XGO_AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xgo_audio')

# Create XGO audio directory if it doesn't exist
if not os.path.exists(XGO_AUDIO_DIR):
    os.makedirs(XGO_AUDIO_DIR)
    logger.info(f"Created XGO audio directory: {XGO_AUDIO_DIR}")

# Flask app for status and control
app = Flask(__name__)
xgo_ip = DEFAULT_XGO_IP
monitor_dir = DEFAULT_MONITOR_DIR
is_running = True

def resolve_xgo_ip():
    """Resolve the best XGO IP: probe ZeroTier first, local WiFi as fallback."""
    global xgo_ip
    for candidate in [DEFAULT_XGO_IP, XGO_LOCAL_IP]:
        try:
            s = socket.create_connection((candidate, 22), timeout=2)
            s.close()
            xgo_ip = candidate
            logger.info(f"XGO reachable at {candidate}")
            return xgo_ip
        except (OSError, socket.timeout):
            continue
    logger.warning(f"Could not reach XGO on any IP, keeping: {xgo_ip}")
    return xgo_ip

def is_valid_wav(file_path):
    """Check if the WAV file is valid"""
    try:
        with wave.open(file_path, 'rb') as wf:
            if wf.getnchannels() == 0 or wf.getsampwidth() == 0 or wf.getframerate() == 0:
                return False
            return True
    except Exception as e:
        logger.error(f"Invalid WAV file {file_path}: {e}")
        return False

def send_audio_file(file_path, target_ip=None):
    """Send audio file to XGO Rider via UDP"""
    if target_ip is None:
        target_ip = xgo_ip
        
    if not os.path.exists(file_path) or not is_valid_wav(file_path):
        logger.error(f"File does not exist or is invalid: {file_path}")
        return False
    
    try:
        # Read file in binary mode
        with open(file_path, 'rb') as f:
            data = f.read()
        
        # Create UDP socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        # Set a timeout for socket operations
        sock.settimeout(5)
        
        # Send file size first
        file_size = len(data)
        size_msg = json.dumps({"type": "size", "size": file_size}).encode('utf-8')
        sock.sendto(size_msg, (target_ip, UDP_PORT))
        
        # Wait for acknowledgment
        try:
            sock.recvfrom(1024)
        except socket.timeout:
            logger.warning("No acknowledgment received for file size message")
        
        # Send file in chunks
        chunk_size = 1024
        total_chunks = (file_size + chunk_size - 1) // chunk_size
        
        for i in range(total_chunks):
            start_idx = i * chunk_size
            end_idx = min(start_idx + chunk_size, file_size)
            chunk = data[start_idx:end_idx]
            
            # Create packet with sequence number
            packet = {
                "type": "data",
                "seq": i,
                "total": total_chunks,
                "data": chunk.hex()
            }
            packet_json = json.dumps(packet).encode('utf-8')
            
            # Send packet
            sock.sendto(packet_json, (target_ip, UDP_PORT))
            
            # Small delay to prevent network congestion
            time.sleep(0.001)
        
        # Send end message
        end_msg = json.dumps({"type": "end", "filename": os.path.basename(file_path)}).encode('utf-8')
        sock.sendto(end_msg, (target_ip, UDP_PORT))
        
        logger.info(f"Sent audio file: {os.path.basename(file_path)} to {target_ip}")
        return True
    
    except Exception as e:
        logger.error(f"Error sending file {file_path}: {e}")
        return False

def test_connection(ip=None):
    """Test connection to XGO"""
    if ip is None:
        ip = xgo_ip
        
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2)
        test_msg = json.dumps({"type": "test"}).encode('utf-8')
        sock.sendto(test_msg, (ip, UDP_PORT))
        
        try:
            data, addr = sock.recvfrom(1024)
            logger.info(f"Connection test successful: {addr}")
            return True
        except socket.timeout:
            logger.warning(f"Connection test failed: No response from {ip}")
            return False
    except Exception as e:
        logger.error(f"Connection test error: {e}")
        return False

class AudioFileHandler(FileSystemEventHandler):
    """Handler for audio file events"""
    
    def on_created(self, event):
        """Handle file creation events"""
        if not is_running:
            return
            
        if not event.is_directory:
            file_path = event.src_path
            # Check if it's a WAV file and not a temporary file
            if file_path.endswith('.wav') and os.path.exists(file_path):
                logger.info(f"New audio file detected: {file_path}")
                
                # Wait a moment to ensure file is completely written
                time.sleep(0.5)
                
                # Resolve XGO IP before sending (handles WiFi ↔ ZeroTier transitions)
                resolve_xgo_ip()
                
                # Copy to XGO audio directory
                try:
                    filename = os.path.basename(file_path)
                    xgo_file = os.path.join(XGO_AUDIO_DIR, filename)
                    shutil.copy2(file_path, xgo_file)
                    logger.info(f"Copied to XGO audio directory: {xgo_file}")
                    
                    # Send to XGO
                    threading.Thread(target=send_audio_file, args=(xgo_file,), daemon=True).start()
                except Exception as e:
                    logger.error(f"Error processing file {file_path}: {e}")

def start_monitoring():
    """Start monitoring the voice temp directory"""
    global is_running
    
    logger.info(f"Starting to monitor directory: {monitor_dir}")
    event_handler = AudioFileHandler()
    observer = Observer()
    observer.schedule(event_handler, monitor_dir, recursive=False)
    observer.start()
    
    try:
        while is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Stopping monitoring")
        is_running = False
    finally:
        observer.stop()
        observer.join()

# Flask routes for status and control
@app.route('/status')
def status():
    """Get the current status"""
    return jsonify({
        'status': 'running' if is_running else 'stopped',
        'xgo_ip': xgo_ip,
        'monitor_dir': monitor_dir,
        'xgo_audio_dir': XGO_AUDIO_DIR
    })

@app.route('/set_ip/<ip>')
def set_ip(ip):
    """Set the XGO IP address"""
    global xgo_ip
    xgo_ip = ip
    logger.info(f"XGO IP set to: {ip}")
    return jsonify({'status': 'success', 'xgo_ip': xgo_ip})

@app.route('/test_connection')
def test_conn():
    """Test the connection to XGO"""
    result = test_connection()
    return jsonify({'status': 'success' if result else 'failed'})

@app.route('/stop')
def stop():
    """Stop the monitoring"""
    global is_running
    is_running = False
    logger.info("Stopping monitoring")
    return jsonify({'status': 'stopped'})

@app.route('/start')
def start():
    """Start the monitoring"""
    global is_running
    is_running = True
    threading.Thread(target=start_monitoring, daemon=True).start()
    logger.info("Starting monitoring")
    return jsonify({'status': 'running'})

if __name__ == '__main__':
    # Check if the monitor directory exists
    if not os.path.exists(monitor_dir):
        logger.error(f"Monitor directory does not exist: {monitor_dir}")
        sys.exit(1)
        
    # Resolve XGO IP on startup (heartbeat → local probe → ZeroTier probe)
    resolve_xgo_ip()
    
    # Start monitoring in a separate thread
    threading.Thread(target=start_monitoring, daemon=True).start()
    
    # Start Flask app
    logger.info("Starting XGO Audio Bridge")
    logger.info(f"Monitoring directory: {monitor_dir}")
    logger.info(f"XGO IP: {xgo_ip}")
    logger.info(f"XGO audio directory: {XGO_AUDIO_DIR}")
    app.run(host='0.0.0.0', port=5000)
