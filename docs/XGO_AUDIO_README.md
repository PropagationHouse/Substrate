# XGO Audio Integration for Tiny Pirate

This document provides comprehensive information about the XGO device audio integration with the Tiny Pirate system, including setup, configuration, and troubleshooting.

## Overview

The XGO audio integration enables remote voice interaction with Tiny Pirate through the XGO robot device. The system captures audio on the XGO device, sends it to the PC for processing, and integrates with the main Tiny Pirate voice processing pipeline.

## Architecture

The XGO audio integration consists of several components:

1. **XGO Remote Microphone** (`xgo_remote_mic.py`): Runs on the XGO device to capture audio, perform voice activity detection, and send audio to the PC
2. **PC Audio Receiver** (`pc_audio_receiver_server.py`): Flask server running on the PC to receive audio files from XGO
3. **Whisper Speech Processing** (`speech_components/whisper_speech.py`): Processes audio files from both XGO and local microphone using Whisper for transcription
4. **Voice Synthesis** (Kokoro-82M): Generates voice responses that can be played on both PC and XGO

## Key Files and Components

### XGO Device Components
- `xgo_remote_mic.py`: Main remote microphone script for XGO
  - Voice Activity Detection (VAD) with configurable thresholds
  - Audio buffering and processing
  - HTTP transmission to PC

### PC Components
- `pc_audio_receiver_server.py`: Receives audio from XGO
- `speech_components/whisper_speech.py`: Processes audio using Whisper
- `speech_components/active_speech.py`: Alternative speech processing component

## Configuration Settings

### XGO Remote Microphone Settings (`xgo_remote_mic.py`)
```python
# Audio settings
RATE = 16000         # Sample rate
CHANNELS = 1         # Mono
CHUNK = 1024         # Frames per buffer
FORMAT = np.float32  # Audio format

# Voice Activity Detection settings
VAD_THRESHOLD = 0.005  # Energy threshold for voice activity detection
VAD_PADDING_MS = 800   # Padding in ms to add before and after voice activity
SILENCE_LIMIT = 2.0    # Seconds of silence before stopping recording
MIN_RECORDING_SECONDS = 1.0  # Minimum recording length in seconds
```

### Desktop Speech Processing Settings (`whisper_speech.py`)
```python
# Speech detection settings
energy_threshold = 0.05   # Energy threshold for speech detection
silence_timeout = 0.15    # Seconds of silence before processing
voice_cooldown = 0.2      # Cooldown period in seconds after system speaks
max_buffer_size = 16000 * 1.5  # Maximum buffer size (1.5 seconds)
```

## Usage Notes

1. **Component Dependencies**:
   - The purple terminal (whisper_speech.py) is only necessary when using XGO integration
   - Regular desktop speech recognition works without this component

2. **Energy Thresholds**:
   - Lower values (e.g., 0.005) are more sensitive, detecting quieter speech
   - Higher values (e.g., 0.05) are less sensitive, requiring louder speech
   - Adjust based on environment noise and microphone sensitivity

3. **Silence Timeouts**:
   - Lower values process speech more quickly after pauses
   - Higher values wait longer for complete phrases

## Utility Scripts

Several utility scripts have been created to help manage the XGO audio integration:

1. **Storage Management**:
   - `xgo_expand_storage.py`: Remotely expands the SD card storage on the XGO device

2. **File Analysis**:
   - `list_key_files.py`: Lists and categorizes Python files in the project
   - `analyze_project_files.py`: Comprehensive analysis of project structure

3. **Cleanup Tools**:
   - `archive_test_files.py`: Archives test files to a timestamped folder
   - `find_audio_files.py`: Locates and analyzes Kokoro voice response files

4. **Diagnostic Tools**:
   - `audio_energy_monitor.py`: Monitors and displays audio energy levels

## Troubleshooting

1. **Speech Not Detected**:
   - Check energy threshold settings (may need to be lowered)
   - Ensure microphone is working and properly connected
   - Verify audio input device is correctly selected

2. **XGO Connection Issues**:
   - Ensure XGO and PC are on the same network or ZeroTier VPN
   - Check IP addresses in configuration
   - Verify port forwarding if necessary

3. **Storage Issues on XGO**:
   - Use `xgo_expand_storage.py` to expand SD card storage
   - Clean up unnecessary files and backups

4. **Audio Quality Problems**:
   - Adjust VAD_THRESHOLD for better sensitivity
   - Modify SILENCE_LIMIT for appropriate speech detection
   - Check for background noise interference

## Best Practices

1. **Regular Maintenance**:
   - Archive or remove test files periodically
   - Monitor XGO storage usage
   - Update configuration settings based on environment changes

2. **Configuration Optimization**:
   - Adjust energy thresholds based on ambient noise levels
   - Fine-tune silence timeouts for optimal speech detection
   - Balance sensitivity vs. false triggers

3. **Deployment**:
   - Consider setting up critical scripts as system services
   - Use SSH keys for passwordless authentication
   - Implement proper error handling and logging

## Network Configuration

The XGO device communicates with the PC using:
- ZeroTier VPN for reliable connectivity across networks
- HTTP POST requests for audio transmission
- Default ports: 5000 (main API), 5001 (backup)

## Future Improvements

Potential areas for enhancement:
1. Implement WebRTC for real-time audio streaming
2. Add noise cancellation preprocessing
3. Optimize audio compression for faster transmission
4. Create a unified configuration interface for all audio settings
