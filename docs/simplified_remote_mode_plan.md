# Simplified Substrate Remote Mode Implementation

## Overview
This simplified approach focuses on using the XGO's microphone to capture audio and send it to the main app over the existing ZeroTier connection.

## Implementation Steps

### 1. Access XGO Microphone
```javascript
// In Substrate app
function setupMicrophone() {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            window.xgoMicStream = stream;
            console.log('XGO microphone access granted');
        })
        .catch(err => {
            console.error('Error accessing microphone:', err);
        });
}
```

**Testing**: 
- Call `setupMicrophone()` on app start
- Check console for successful access message

### 2. Create Remote Mode Toggle
Add to `radial_config_new.js`:
```javascript
// Add to sections array
{ id: "remote-mode", title: "Remote Mode" }

// Create content function
function getRemoteModeContent() {
    return `
        <div class="config-section">
            <h3>Remote Mode</h3>
            <div class="config-row">
                <label for="remote-mode-toggle">Enable Remote Mode:</label>
                <input type="checkbox" id="remote-mode-toggle">
            </div>
            <div class="config-help">When enabled, XGO will use its microphone and send audio to main app.</div>
        </div>
    `;
}

// Add event listener
document.getElementById('remote-mode-toggle').addEventListener('change', function(e) {
    const enabled = e.target.checked;
    localStorage.setItem('remote-mode-enabled', enabled);
    toggleRemoteMode(enabled);
});

// Load saved setting
const savedEnabled = localStorage.getItem('remote-mode-enabled') === 'true';
document.getElementById('remote-mode-toggle').checked = savedEnabled;
toggleRemoteMode(savedEnabled);
```

**Testing**:
- Verify toggle appears in UI
- Check that setting is saved to localStorage

### 3. Implement Audio Forwarding
```javascript
// Global variables
let isRemoteModeEnabled = false;
let audioRecorder = null;
const TOWER_DESK_ADDRESS = '10.147.17.235:3000';

// Toggle remote mode
function toggleRemoteMode(enabled) {
    isRemoteModeEnabled = enabled;
    
    if (enabled) {
        // Show status indicator
        updateStatusIndicator('Remote Mode Active', 'connected');
        
        // Start audio recording if mic is available
        if (window.xgoMicStream) {
            setupAudioRecording(window.xgoMicStream);
        } else {
            console.error('Microphone not available');
            updateStatusIndicator('Mic Not Available', 'error');
        }
    } else {
        // Stop recording if active
        if (audioRecorder) {
            audioRecorder.stop();
            audioRecorder = null;
        }
        
        updateStatusIndicator('Local Mode', 'local');
    }
}

// Set up audio recording
function setupAudioRecording(stream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    
    source.connect(processor);
    processor.connect(audioContext.destination);
    
    // Process audio data
    processor.onaudioprocess = function(e) {
        if (!isRemoteModeEnabled) return;
        
        // Get audio data
        const audioData = e.inputBuffer.getChannelData(0);
        
        // Convert to format suitable for transmission
        const audioBlob = convertFloat32ToWav(audioData);
        
        // Send to main app
        sendAudioToMainApp(audioBlob);
    };
}

// Send audio to main app
async function sendAudioToMainApp(audioBlob) {
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob);
        
        const response = await fetch(`http://${TOWER_DESK_ADDRESS}/process-audio`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Handle response from main app
        handleMainAppResponse(result);
    } catch (error) {
        console.error('Error sending audio to main app:', error);
        updateStatusIndicator('Connection Error', 'error');
    }
}

// Handle response from main app
function handleMainAppResponse(response) {
    // Display text response
    if (response.text) {
        displayResponse(response.text);
    }
    
    // Play audio response if available
    if (response.audio) {
        playAudioResponse(response.audio);
    }
}

// Status indicator
function updateStatusIndicator(message, status) {
    const indicator = document.getElementById('status-indicator') || createStatusIndicator();
    
    indicator.className = `status-indicator ${status}`;
    indicator.textContent = message;
}

// Create status indicator if it doesn't exist
function createStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'status-indicator';
    indicator.className = 'status-indicator';
    document.body.appendChild(indicator);
    return indicator;
}

// Helper: Convert Float32Array to WAV format
function convertFloat32ToWav(float32Array) {
    // Implementation of WAV conversion
    // ...
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
}
```

### 4. Create Simple Server on Tower Desk
```javascript
const express = require('express');
const multer = require('multer');
const app = express();
const upload = multer();

// Handle audio from XGO
app.post('/process-audio', upload.single('audio'), async (req, res) => {
    try {
        // Get audio file from request
        const audioFile = req.file;
        
        if (!audioFile) {
            return res.status(400).json({ error: 'No audio file received' });
        }
        
        console.log('Received audio from XGO, size:', audioFile.size);
        
        // Process with your existing pipeline
        // ...
        
        // Send response back to XGO
        res.json({
            text: "Response from main app",
            audio: null // Audio response if available
        });
    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).json({ error: 'Processing failed' });
    }
});

// Start server on ZeroTier interface
app.listen(3000, '10.147.17.235', () => {
    console.log('Server running on ZeroTier IP 10.147.17.235:3000');
});
```

## Testing

1. **Basic Connectivity**
   - Start server on Tower Desk
   - Enable remote mode on XGO
   - Check for successful connection

2. **Audio Transmission**
   - Speak into XGO microphone
   - Verify audio is received by server (check logs)
   - Confirm response is displayed on XGO

3. **Network Resilience**
   - Test with XGO on different WiFi networks
   - Verify ZeroTier connection remains stable

## Time Estimate

With this simplified approach, implementation should take approximately 1 day:
- Microphone access and recording: 2 hours
- Remote mode toggle: 1 hour
- Audio transmission: 3 hours
- Server setup: 1 hour
- Testing and debugging: 1-2 hours
