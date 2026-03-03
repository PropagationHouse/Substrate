import os
import time
import socket
import logging
import json
import wave
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global variables
xgo_ip = "10.147.17.147"  # Default XGO IP (ZeroTier — works on any network)
XGO_LOCAL_IP = "10.0.0.144"      # XGO local WiFi IP (fallback)
PROXY_SERVER_URL = "http://localhost:8765"  # proxy_server base URL
udp_port = 12345
connection_active = False

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

def send_audio_file(file_path, ip=None):
    """Send an audio file to XGO via UDP using JSON chunked protocol.
    
    Protocol (matches xgo_audio_receiver.py on the Pi):
    1. {"type": "size", "size": N}  -> receiver ACKs
    2. {"type": "data", "seq": i, "total": T, "data": hex} x T chunks
    3. {"type": "end", "filename": name}  -> receiver reassembles & plays
    """
    if not is_valid_wav(file_path):
        logger.error(f"Invalid WAV file: {file_path}")
        return False
    
    if ip is None:
        ip = xgo_ip
    
    if ip is None:
        logger.error("XGO IP not set")
        return False
    
    try:
        with open(file_path, 'rb') as f:
            data = f.read()
        
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5)
        
        file_size = len(data)
        file_name = os.path.basename(file_path)
        
        # 1. Send size notification
        size_msg = json.dumps({"type": "size", "size": file_size}).encode('utf-8')
        sock.sendto(size_msg, (ip, udp_port))
        
        # Wait for ACK (non-fatal if missing)
        try:
            sock.recvfrom(1024)
        except socket.timeout:
            logger.warning("No ACK for size message, continuing anyway")
        
        # 2. Send data chunks (1KB each, hex-encoded in JSON)
        chunk_size = 1024
        total_chunks = (file_size + chunk_size - 1) // chunk_size
        
        for i in range(total_chunks):
            start = i * chunk_size
            end = min(start + chunk_size, file_size)
            chunk = data[start:end]
            
            packet = json.dumps({
                "type": "data",
                "seq": i,
                "total": total_chunks,
                "data": chunk.hex()
            }).encode('utf-8')
            sock.sendto(packet, (ip, udp_port))
            time.sleep(0.001)
        
        # 3. Send end marker
        end_msg = json.dumps({"type": "end", "filename": file_name}).encode('utf-8')
        sock.sendto(end_msg, (ip, udp_port))
        
        logger.info(f"Sent audio file: {file_name} ({file_size} bytes, {total_chunks} chunks) to {ip}")
        sock.close()
        return True
    except Exception as e:
        logger.error(f"Error sending audio file: {e}")
        return False

def test_connection(ip=None):
    """Test connection to XGO"""
    if ip is None:
        ip = xgo_ip
    
    if ip is None:
        logger.error("XGO IP not set")
        return False
    
    try:
        # Create UDP socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)  # Set timeout for receiving response
        
        # Send test message
        test_msg = b"TEST_CONNECTION"
        sock.sendto(test_msg, (ip, udp_port))
        
        # Wait for response
        try:
            response, addr = sock.recvfrom(1024)
            if response == b"ACK":
                logger.info(f"Connection to XGO at {ip} successful")
                return True
            else:
                logger.warning(f"Unexpected response from XGO: {response}")
                return False
        except socket.timeout:
            logger.warning(f"No response from XGO at {ip}")
            return False
    except Exception as e:
        logger.error(f"Error testing connection to XGO: {e}")
        return False

def resolve_xgo_ip():
    """Resolve the best XGO IP: probe ZeroTier first, local WiFi as fallback."""
    global xgo_ip
    for candidate in [xgo_ip, XGO_LOCAL_IP]:
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


class XGOIntegration:
    def __init__(self, xgo_ip="10.147.17.147", xgo_port=12345):
        self.xgo_ip = xgo_ip
        self.connection_active = False
        
    def set_ip(self, ip):
        """Set XGO IP address"""
        self.xgo_ip = ip
        logger.info(f"XGO IP set to {ip}")

    def resolve_ip(self):
        """Resolve the best XGO IP and update self.xgo_ip."""
        self.xgo_ip = resolve_xgo_ip()
        return self.xgo_ip
        
    def is_connected(self):
        """Check if connection to XGO is active"""
        return self.connection_active and self.xgo_ip is not None
        
    def send_audio(self, file_path):
        """Send audio file to XGO"""
        self.resolve_ip()
        return send_audio_file(file_path, self.xgo_ip)
    
    def stream_audio_file(self, file_path):
        """Alias for send_audio (voice_handler calls this name)."""
        return self.send_audio(file_path)
    
    def test_connection(self):
        """Test connection to XGO via TCP probe (SSH port)."""
        self.resolve_ip()
        try:
            s = socket.create_connection((self.xgo_ip, 22), timeout=2)
            s.close()
            self.connection_active = True
            logger.info(f"XGO reachable at {self.xgo_ip}")
            return True
        except (OSError, socket.timeout):
            self.connection_active = False
            logger.warning(f"XGO not reachable at {self.xgo_ip}")
            return False

# Create global instance
xgo_integration = XGOIntegration(xgo_ip)
