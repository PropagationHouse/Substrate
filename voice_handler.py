import pygame
import soundfile as sf
import tempfile
import os
import threading
from queue import Queue
import time
import shutil

# Create XGO audio folder if it doesn't exist
XGO_AUDIO_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "xgo_audio")
os.makedirs(XGO_AUDIO_FOLDER, exist_ok=True)

class VoiceHandler:
    def __init__(self):
        pygame.mixer.init()
        self.voice_queue = Queue()
        self.is_speaking = False
        self.current_audio = None
        self.voice_thread = threading.Thread(target=self._process_voice_queue, daemon=True)
        self.voice_thread.start()
        # Reference to the websocket handler for sending status updates
        self.websocket_handler = None
        # Counter for XGO audio files
        self.xgo_file_counter = 0
    
    def set_websocket_handler(self, handler):
        """Set the websocket handler for sending status updates"""
        self.websocket_handler = handler
    
    def _send_status_update(self, status):
        """Send status update to frontend"""
        if self.websocket_handler:
            try:
                message = {
                    'type': 'voice',
                    'status': status
                }
                self.websocket_handler(message)
            except Exception as e:
                print(f"Error sending voice status update: {e}")
    
    def _process_voice_queue(self):
        """Process voice messages in the background"""
        while True:
            if not self.is_speaking and not self.voice_queue.empty():
                audio_file = self.voice_queue.get()
                try:
                    self.is_speaking = True
                    # Notify frontend that speech is starting
                    self._send_status_update('speaking')
                    
                    pygame.mixer.music.load(audio_file)
                    pygame.mixer.music.play()
                    while pygame.mixer.music.get_busy():
                        time.sleep(0.1)
                except Exception as e:
                    print(f"Error playing audio: {e}")
                finally:
                    self.is_speaking = False
                    # Notify frontend that speech has stopped
                    self._send_status_update('stopped')
                    
                    try:
                        os.remove(audio_file)
                    except:
                        pass
            time.sleep(0.1)
    
    def speak(self, text):
        """Queue text to be spoken"""
        try:
            # Generate audio file in temp directory
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            # Convert text to speech using Kokoro
            from kokoro import save_to_file
            save_to_file(text, temp_path)
            
            # Save a copy for XGO Rider
            self.xgo_file_counter += 1
            xgo_filename = f"xgo_speech_{self.xgo_file_counter:04d}.wav"
            xgo_path = os.path.join(XGO_AUDIO_FOLDER, xgo_filename)
            shutil.copy2(temp_path, xgo_path)
            print(f"Saved audio for XGO: {xgo_path}")
            
            # Queue the audio file for playback
            self.voice_queue.put(temp_path)
            
        except Exception as e:
            print(f"Error generating speech: {e}")
    
    def stop(self):
        """Stop current playback"""
        if self.is_speaking:
            pygame.mixer.music.stop()
            self.is_speaking = False
            # Notify frontend that speech has stopped
            self._send_status_update('stopped')
            
            # Clear the queue
            while not self.voice_queue.empty():
                try:
                    audio_file = self.voice_queue.get_nowait()
                    try:
                        os.remove(audio_file)
                    except:
                        pass
                except:
                    pass

voice_handler = VoiceHandler()
speak = voice_handler.speak
stop_speaking = voice_handler.stop
