# Tiny Pirate XGO Integration

This document explains how the XGO integration works with Tiny Pirate.

> **Note**: For detailed information about the voice synthesis system that powers the XGO audio integration, see the [Voice System Documentation](docs/VOICE_SYSTEM.md).

## Overview

The integration allows Tiny Pirate to send audio to an XGO Rider device over WiFi using both UDP and HTTP protocols. When Tiny Pirate generates speech using Kokoro TTS, the audio is both played locally and forwarded to the XGO device. The system also supports receiving audio from the XGO device for speech recognition.

## Components

1. **Voice Handler** (`src/voice/voice_handler.py`)
   - Generates speech using Kokoro TTS
   - Plays audio locally using pygame
   - Forwards audio to XGO by copying files to the XGO audio directory

2. **XGO Integration** (`XGO_Audio_Bridge/direct_xgo_integration.py`)
   - Provides a direct interface to send audio files to XGO
   - Handles UDP communication with the XGO device
   - Implements file validation and chunked transfer
   - Default IP: 192.168.4.1 (configurable)

3. **Standalone XGO Bridge** (`XGO_Audio_Bridge/standalone_xgo_bridge.py`)
   - Monitors the voice temp directory for new audio files
   - Forwards audio files to XGO over UDP
   - Provides a web interface for status and control (http://localhost:5000)
   - Supports JSON-based packet format for reliable transmission

4. **XGO Audio Receiver** (`xgo_audio_receiver.py`)
   - HTTP server that receives audio from XGO device
   - Saves received audio to the monitored directory for processing
   - Supports multiple endpoint formats for compatibility
   - Automatically processed by whisper_speech.py for transcription

## How to Use

1. **Start Tiny Pirate**
   - Run `main.py` to start the Tiny Pirate application
   - This will initialize the voice handler with XGO integration

2. **Start XGO Bridge**
   - Run `start_xgo_bridge.bat` to start the standalone XGO bridge
   - This will monitor the voice temp directory and forward audio to XGO

3. **Start XGO Audio Receiver** (for receiving audio from XGO)
   - Run `xgo_audio_receiver.py` to start the HTTP server
   - Default port is 5000, can be configured with command line arguments
   - Audio files will be saved to `speech_components/xgo_audio_input/`

4. **Test the Integration**
   - Run `test_voice_xgo.py` to test voice synthesis and XGO integration
   - This will generate test messages and forward them to XGO

## Configuration

- **XGO IP Address**: 
  - Default is 192.168.4.1 in direct_xgo_integration.py
  - Default is 10.0.0.144 in standalone_xgo_bridge.py
  - Can be changed via the web interface: http://localhost:5000/set_ip/<new_ip>
  - Or by editing the `xgo_ip` variable in the respective files

- **Voice Settings**: Configurable in Tiny Pirate's profile settings
  - Voice: Default is "af_heart"
  - Speed: Default is 1.0
  - Pitch: Default is 0.0
  - Other parameters as supported by Kokoro TTS

- **Audio Directories**:
  - Voice temp directory: `src/voice/temp/`
  - XGO audio directory: `XGO_Audio_Bridge/xgo_audio/`
  - XGO input directory: `speech_components/xgo_audio_input/`

## Bidirectional Communication

The system now supports bidirectional communication with XGO:

1. **Tiny Pirate to XGO**:
   - Voice audio is sent to XGO via UDP in chunks
   - File size is sent first, followed by audio data
   - Small delays (0.001s) between chunks prevent packet loss

2. **XGO to Tiny Pirate**:
   - XGO sends audio via HTTP POST to the audio receiver
   - Audio is saved with timestamp in the monitored directory
   - whisper_speech.py automatically processes new audio files
   - Transcribed speech is sent to the main application

## Troubleshooting

1. **Connection Issues**:
   - Verify XGO is on the same network as the computer
   - Check IP address configuration in both files
   - Use the test_connection() function in direct_xgo_integration.py

2. **Audio Not Playing on XGO**:
   - Check if audio files are being created in the XGO audio directory
   - Verify UDP port 12345 is not blocked by firewall
   - Check XGO device volume settings

3. **Audio Not Being Received from XGO**:
   - Verify xgo_audio_receiver.py is running
   - Check if audio files appear in speech_components/xgo_audio_input/
   - Check xgo_audio_receiver.log for error messages

4. **Performance Optimization**:
   - Adjust chunk_size in direct_xgo_integration.py for network conditions
   - Modify the delay between chunks (time.sleep value) if experiencing packet loss

1. **No Audio on XGO**
   - Check that the XGO device is connected to the same WiFi network
   - Verify the IP address is correct (default: 192.168.4.1)
   - Test the connection: http://localhost:5000/test_connection
   - Check the XGO bridge logs for errors

2. **Silent Audio Files**
   - Check that Kokoro TTS is properly installed and working
   - Look for error messages in the console output
   - Verify that audio files are being generated in the temp directory

3. **XGO Bridge Not Starting**
   - Make sure required packages are installed: `pip install -r XGO_Audio_Bridge/requirements.txt`
   - Check for error messages in the console output
   - Verify that the monitored directory exists

## Directory Structure

```
TPXGO/
├── src/
│   └── voice/
│       ├── voice_handler.py  # Voice synthesis and XGO forwarding
│       └── temp/            # Temporary audio files
├── XGO_Audio_Bridge/
│   ├── direct_xgo_integration.py  # Direct XGO communication
│   ├── standalone_xgo_bridge.py   # Standalone bridge service
│   ├── requirements.txt           # Required packages
│   └── xgo_audio/                 # XGO audio files
├── start_xgo_bridge.bat           # Start the XGO bridge
└── test_voice_xgo.py              # Test script
```

## Advanced Usage

- The XGO bridge provides a simple REST API:
  - `/status`: Get the current status
  - `/set_ip/<ip>`: Set the XGO IP address
  - `/test_connection`: Test the connection to XGO
  - `/stop`: Stop monitoring
  - `/start`: Start monitoring

- You can customize the UDP port in both `direct_xgo_integration.py` and `standalone_xgo_bridge.py` if needed (default: 12345)
