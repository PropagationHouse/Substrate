# Substrate Voice Synthesis System

This document provides a detailed overview of the voice synthesis system used in Substrate.

> **Note**: For detailed information about the XGO device integration that uses this voice system, see the [XGO Integration Documentation](../XGO_INTEGRATION_README.md).

## Overview

The voice synthesis system enables Substrate to communicate verbally with users through text-to-speech capabilities. It uses the Kokoro-82M model for high-quality voice generation and supports bidirectional audio communication with XGO devices.

## Components

### Core Components

#### VoiceHandler Class

The main class that manages all voice synthesis operations, located in `src/voice/voice_handler.py`:

```python
class VoiceHandler:
    def __init__(self):
        self.is_speaking = False
        self.should_stop = False
        self.voice_queue = Queue()
        self.current_text = None
        self.voice_thread = None
        self.message_buffer = None
        self.proxy_server = None
        self.voice_enabled = True
        self.voice_rate = 1.0
        self.voice_model = "kokoro-82m"
        self.start_voice_thread()
```

### Key Functions

#### Speech Generation

```python
def speak(text, priority=False):
    """Add text to the speech queue"""
    if not text or not isinstance(text, str):
        return False
        
    # Clean the text for better speech
    text = clean_text_for_speech(text)
    
    # Add to queue with priority flag
    voice_handler.add_to_queue(text, priority)
    return True

def add_to_queue(self, text, priority=False):
    """Add text to the speech queue with optional priority"""
    if not self.voice_enabled:
        return False
        
    if priority:
        # Clear queue for priority messages
        self.clear_queue()
        
    # Add to queue
    self.voice_queue.put(text)
    return True
```

#### Speech Processing Thread

```python
def start_voice_thread(self):
    """Start the voice processing thread"""
    self.voice_thread = threading.Thread(target=self.process_voice_queue)
    self.voice_thread.daemon = True
    self.voice_thread.start()

def process_voice_queue(self):
    """Process items in the voice queue"""
    while True:
        try:
            # Get next text from queue
            text = self.voice_queue.get()
            
            # Check if we should stop
            if self.should_stop:
                self.should_stop = False
                self.voice_queue.task_done()
                continue
                
            # Process the speech
            self.current_text = text
            self.is_speaking = True
            
            # Send status update
            self.send_voice_status("speaking")
            
            # Generate and play speech
            self.generate_speech(text)
            
            # Reset state
            self.is_speaking = False
            self.current_text = None
            self.voice_queue.task_done()
            
            # Send status update
            self.send_voice_status("stopped")
            
            # Forward to XGO if enabled
            if hasattr(self, 'xgo_enabled') and self.xgo_enabled:
                self.forward_to_xgo()
                
            # Small delay between speeches
            time.sleep(0.5)
            
        except Exception as e:
            logger.error(f"Error in voice thread: {e}")
            self.is_speaking = False
            self.send_voice_status("stopped")
            
            # Forward to XGO if enabled
            if hasattr(self, 'xgo_enabled') and self.xgo_enabled:
                self.forward_to_xgo()
```

### XGO Integration

The voice system integrates with XGO devices for bidirectional audio communication:

#### Audio Output to XGO

```python
def forward_to_xgo(self):
    """Forward the current audio to XGO device"""
    if not hasattr(self, 'xgo_enabled') or not self.xgo_enabled:
        return False
        
    try:
        # Copy the audio file to XGO directory
        source_file = self.temp_audio_file
        target_dir = self.xgo_audio_dir
        
        if os.path.exists(source_file):
            # Ensure target directory exists
            os.makedirs(target_dir, exist_ok=True)
            
            # Generate target filename
            target_file = os.path.join(
                target_dir, 
                f"xgo_audio_{int(time.time())}.wav"
            )
            
            # Copy the file
            shutil.copy2(source_file, target_file)
            return True
    except Exception as e:
        print(f"Error forwarding to XGO: {e}")
        
    return False
```

#### Audio Input from XGO

The system also supports receiving audio from XGO devices:

```python
class XGOAudioReceiver:
    """HTTP server that receives audio from XGO device"""
    def __init__(self, port=5000, save_dir='speech_components/xgo_audio_input/'):
        self.port = port
        self.save_dir = save_dir
        os.makedirs(self.save_dir, exist_ok=True)
        
    def start(self):
        """Start the HTTP server"""
        app = Flask(__name__)
        
        @app.route('/audio', methods=['POST'])
        def receive_audio():
            try:
                # Get audio file from request
                audio_file = request.files.get('audio')
                if not audio_file:
                    return jsonify({'error': 'No audio file provided'}), 400
                    
                # Save the file
                filename = f"xgo_input_{int(time.time())}.wav"
                filepath = os.path.join(self.save_dir, filename)
                audio_file.save(filepath)
                
                # Process the audio (transcription)
                self.process_audio(filepath)
                
                return jsonify({'success': True, 'filename': filename})
            except Exception as e:
                return jsonify({'error': str(e)}), 500
                
        app.run(host='0.0.0.0', port=self.port)
        
    def process_audio(self, filepath):
        """Process received audio file"""
        # This will be handled by whisper_speech.py
        pass
```
            self.voice_queue.task_done()
```

#### Speech Generation

```python
def generate_speech(self, text):
    """Generate and play speech for the given text"""
    try:
        # Initialize Kokoro TTS
        tts = KokoroTTS(model=self.voice_model)
        
        # Generate audio
        audio = tts.generate(
            text=text,
            speed=self.voice_rate
        )
        
        # Play the audio
        play_audio(audio)
        
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        return False
        
    return True
```

## Integration with UI

The voice system communicates with the UI through status messages:

```python
def send_voice_status(self, status):
    """Send voice status updates to the frontend"""
    if self.proxy_server:
        # Send through message buffer
        self.proxy_server.send_message_to_frontend({
            "type": "voice",
            "status": status
        })
    else:
        # Direct console output as fallback
        print(json.dumps({"type": "voice", "status": status}))
```

## Configuration

Voice settings can be configured through the configuration system:

```python
def update_config(self, config):
    """Update voice configuration"""
    if "voice_enabled" in config:
        self.voice_enabled = config["voice_enabled"]
        
    if "voice_rate" in config:
        self.voice_rate = float(config["voice_rate"])
        
    if "voice_model" in config:
        self.voice_model = config["voice_model"]
```

## Text Processing

The system includes text preprocessing to improve speech quality:

```python
def clean_text_for_speech(text):
    """Clean and prepare text for speech synthesis"""
    # Replace special characters
    text = text.replace('*', '')
    text = text.replace('_', '')
    text = text.replace('#', 'hashtag')
    
    # Handle URLs
    text = re.sub(r'https?://\S+', 'URL', text)
    
    # Handle code blocks
    text = re.sub(r'```[\s\S]*?```', 'code block', text)
    
    # Handle excessive newlines
    text = re.sub(r'\n{2,}', '. ', text)
    text = text.replace('\n', '. ')
    
    # Handle excessive spaces
    text = re.sub(r'\s{2,}', ' ', text)
    
    return text.strip()
```

## Control Functions

The system provides functions to control speech playback:

```python
def stop_current_playback():
    """Stop the current speech playback"""
    voice_handler.stop_speaking()
    
def stop_speaking(self):
    """Stop current speech and clear queue"""
    self.should_stop = True
    self.clear_queue()
    
    # Force stop audio playback
    stop_audio_playback()
    
    # Reset state
    self.is_speaking = False
    self.current_text = None
    
    # Send status update
    self.send_voice_status("stopped")
```

## Integration with Avatar

The voice system is integrated with the avatar animation system:

1. **Speech Status Updates**: The frontend receives status updates and animates the avatar's mouth accordingly
2. **Synchronization**: The avatar's mouth movements are synchronized with speech timing

```javascript
// In frontend
window.electronAPI.onVoiceStatus((status) => {
  if (status === 'speaking') {
    avatar.startSpeaking();
  } else if (status === 'stopped') {
    avatar.stopSpeaking();
  }
});
```

## Message Filtering

Not all messages are spoken. The system includes logic to determine which messages should be spoken:

```python
def should_speak_message(self, message, content):
    """Determine if a message should be spoken"""
    # Skip system messages
    if message.get("type") == "system":
        return False
        
    # Skip thinking messages
    if message.get("type") == "thinking":
        return False
        
    # Skip error messages
    if message.get("status") == "error":
        return False
        
    # Skip empty content
    if not content or not isinstance(content, str):
        return False
        
    # Skip very long content
    if len(content) > 500:
        return False
        
    return True
```

## Performance Considerations

1. **Threading**: Speech generation runs in a separate thread to prevent UI blocking
2. **Queue Management**: Priority messages can clear the queue to ensure timely responses
3. **Error Handling**: Robust error handling prevents crashes if speech generation fails

## Dependencies

The voice system depends on:

1. **Kokoro**: The main TTS engine (`kokoro==0.7.9`)
2. **PyAudio**: For audio playback
3. **NumPy**: For audio data processing

## Troubleshooting

Common issues and solutions:

1. **No Sound**: Check if voice_enabled is set to true in config.json
2. **Slow Speech**: Adjust voice_rate in configuration (higher values = faster speech)
3. **Crashes**: Ensure Kokoro is properly installed and compatible with your system
4. **Queue Issues**: If speech gets stuck, use stop_current_playback() to reset the system
