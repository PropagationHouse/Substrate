const { app, BrowserWindow, ipcMain, screen, shell, dialog, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const os = require('os');
const remote = require('@electron/remote/main');

// Initialize remote module
remote.initialize();

// File-based debug logging for diagnosing startup issues
const _debugLogPath = path.join(__dirname, 'startup_debug.log');
function debugLog(msg) {
    const ts = new Date().toISOString();
    try { fs.appendFileSync(_debugLogPath, `[${ts}] ${msg}\n`); } catch(_) {}
    console.log(`[DEBUG] ${msg}`);
}

let mainWindow;
let pythonProcess;
let profileManagerWindow = null;
let latestRemoteKeyStatus = {};
let tray = null;

// Speech recognition variables
let speechProcess = null;
let isListening = false;
let isSpeaking = false;

// Mic timing persistence
const MIC_SETTINGS_PATH = path.join(__dirname, 'mic_settings.json');
function loadMicSettings() {
    try {
        if (fs.existsSync(MIC_SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(MIC_SETTINGS_PATH, 'utf8'));
        }
    } catch (_) {}
    return null;
}
function saveMicSettings(key, value) {
    try {
        const settings = loadMicSettings() || {};
        settings[key] = value;
        fs.writeFileSync(MIC_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) { console.error('[MicSettings] Save error:', e.message); }
}

// Safe write to Python process stdin — prevents EPIPE crash if process died
function safePythonWrite(data) {
    try {
        if (pythonProcess && pythonProcess.stdin && !pythonProcess.stdin.destroyed) {
            pythonProcess.stdin.write(data);
            return true;
        }
    } catch (e) {
        console.error('[safePythonWrite] Write failed:', e.code || e.message);
    }
    return false;
}

// Safe write to speech process stdin
function safeSpeechWrite(data) {
    try {
        if (speechProcess && speechProcess.stdin && !speechProcess.stdin.destroyed) {
            speechProcess.stdin.write(data);
            return true;
        }
    } catch (e) {
        console.error('[safeSpeechWrite] Write failed:', e.code || e.message);
    }
    return false;
}

// Global uncaught exception handler — prevent EPIPE crashes
process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
        console.error('[UncaughtException] Suppressed EPIPE/stream error:', err.message);
        return; // Don't crash
    }
    console.error('[UncaughtException]', err);
    // Re-throw non-EPIPE errors so they still show
    throw err;
});

// Brainstorm recording mode — accumulates transcriptions instead of sending immediately
let isRecording = false;
let recordingBuffer = [];
let brainstormCooldownUntil = 0; // Timestamp: ignore speech input until this time

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('Another instance is already running. Quitting...');
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window
        if (hostWindow && hostWindow.isMinimized()) hostWindow.restore();
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
    
    // Create the main window and start the application
    app.whenReady().then(() => {
        createWindow();
        
        // Create system tray icon
        createTray();
        
        // First-run prerequisite check, then start backend + speech
        debugLog('runFirstRunCheck starting...');
        runFirstRunCheck().then(() => {
            debugLog('runFirstRunCheck completed, calling startPythonBackend');
            startPythonBackend();
            startSpeechRecognition();
            checkVisionClientAutoStart();

            // Request the configuration after backend has had time to start
            setTimeout(() => {
                console.log('App ready: Requesting initial configuration');
                if (pythonProcess && pythonProcess.stdin) {
                    safePythonWrite(JSON.stringify({
                        command: 'requestConfig'
                    }) + '\n');
                } else {
                    console.error('Python process not available when trying to request config');
                    console.log('Attempting to restart Python process');
                    startPythonBackend();
                    
                    setTimeout(() => {
                        if (pythonProcess && pythonProcess.stdin) {
                            safePythonWrite(JSON.stringify({
                                command: 'requestConfig'
                            }) + '\n');
                        } else if (mainWindow) {
                            mainWindow.webContents.send('error', 'Python process not available after restart. Please check the console for errors.');
                        }
                    }, 2000);
                }
            }, 2000);
        });
    });
}

let hostWindow = null; // Invisible parent that holds the taskbar icon

function createWindow() {
    try {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const windowWidth = 300;
        const windowHeight = 400;

        // Resolve app icon - prefer avatar, fall back to assets icon
        let appIconPath = path.join(__dirname, 'profiles', 'default', 'avatar.png');
        if (!fs.existsSync(appIconPath)) {
            appIconPath = path.join(__dirname, 'assets', 'icons', 'icon.png');
        }
        let appIcon;
        if (fs.existsSync(appIconPath)) {
            appIcon = nativeImage.createFromPath(appIconPath);
        }

        // --- Parent window trick for transparent windows on Windows ---
        // A tiny non-transparent parent window owns the taskbar slot.
        // The real transparent UI window is its child via `parent`.
        // When the parent minimizes/restores, we hide/show the child.
        hostWindow = new BrowserWindow({
            width: 1,
            height: 1,
            x: -100,
            y: -100,
            frame: false,
            transparent: false,
            skipTaskbar: false,
            icon: appIcon || undefined,
            show: false,
            title: 'Substrate',
            webPreferences: { nodeIntegration: false }
        });
        hostWindow.showInactive(); // puts it on the taskbar without stealing focus

        mainWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            x: Math.floor((screenWidth - windowWidth) / 2),
            y: Math.floor((screenHeight - windowHeight) / 2),
            frame: false,
            transparent: true,
            icon: appIcon || undefined,
            parent: hostWindow,
            skipTaskbar: true, // child hides from taskbar; parent owns it
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                enableRemoteModule: true,
                webSecurity: false, // (optional, for local file access)
                preload: path.join(__dirname, 'preload.js'),
                spellcheck: false // Disable spellcheck to avoid clipboard interference
            },
            alwaysOnTop: false, // Change to false to prevent clipboard interference
            hasShadow: false,
            focusable: true,
            enableLargerThanScreen: false,
            disableHtmlFullscreenWindowResize: true
        });

        // When parent (taskbar icon) is minimized → hide the transparent child
        hostWindow.on('minimize', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.hide();
            }
        });

        // When parent is restored from taskbar → show the transparent child
        hostWindow.on('restore', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
        });

        // Clicking the taskbar icon when host is not minimized → focus the child
        hostWindow.on('focus', () => {
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                mainWindow.show();
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.focus();
            }
        });

        // If someone closes the host, close everything
        hostWindow.on('closed', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
            }
        });

        remote.enable(mainWindow.webContents);
        
        // Set up handler for opening external links
        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            // Open all links in external browser
            if (url.startsWith('http:') || url.startsWith('https:')) {
                shell.openExternal(url);
                return { action: 'deny' };
            }
            return { action: 'allow' };
        });
        
        mainWindow.loadFile('index.html')
            .then(() => {
                console.log('Window loaded successfully');
            })
            .catch(error => {
                console.error('Failed to load window:', error);
                logError(error);
            });

        mainWindow.webContents.on('dom-ready', () => {
            mainWindow.webContents.send('request-initial-config');
        });

        // Window error handling
        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            logError(`Failed to load: ${errorDescription} (${errorCode})`);
        });

        mainWindow.on('closed', () => {
            if (pythonProcess) {
                pythonProcess.kill();
            }
            
            // Also kill speech process if active
            if (speechProcess) {
                speechProcess.kill();
            }
            
            mainWindow = null;
            // Also close the host window
            if (hostWindow && !hostWindow.isDestroyed()) {
                hostWindow.close();
            }
        });

        // Ctrl+Shift+T as backup restore shortcut
        app.whenReady().then(() => {
            globalShortcut.register('Ctrl+Shift+T', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                }
                if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isMinimized()) {
                    hostWindow.restore();
                }
            });
        });

        // Python backend already started in app.whenReady() — don't double-spawn
    } catch (error) {
        logError(error);
    }
}

// Profile Manager Window Creation
function createProfileManagerWindow() {
    // If window exists, just focus it
    if (profileManagerWindow) {
        if (!profileManagerWindow.isDestroyed()) {
            profileManagerWindow.focus();
            return profileManagerWindow;
        }
    }

    console.log('Creating Profile Manager Window');
    profileManagerWindow = new BrowserWindow({
        width: 900,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        transparent: true,
        frame: false,
        backgroundColor: '#00000000'
    });

    remote.enable(profileManagerWindow.webContents);
    
    profileManagerWindow.loadFile('profile_manager.html')
        .then(() => {
            console.log('Profile manager window loaded successfully');
            if (process.env.NODE_ENV === 'development') {
                profileManagerWindow.webContents.openDevTools();
            }
        })
        .catch(error => {
            console.error('Failed to load profile manager window:', error);
            logError(error);
        });

    profileManagerWindow.on('closed', () => {
        profileManagerWindow = null;
    });

    return profileManagerWindow;
}

// IPC listener for opening profile manager
ipcMain.on('open-profile-manager', (event) => {
    console.log('IPC Message Received: Open Profile Manager');
    try {
        createProfileManagerWindow();
        console.log('Profile manager window created/focused successfully');
    } catch (error) {
        console.error('Error creating profile manager window:', error);
        logError(error);
    }
});

// IPC listener for updating voice settings
ipcMain.on('update-voice-settings', (event, data) => {
    console.log('IPC Message Received: Update Voice Settings', data);
    try {
        if (!pythonProcess || pythonProcess.killed) {
            throw new Error('Python process not available');
        }
        
        // Format command to send to Python backend
        const command = {
            action: 'update-voice-settings',
            data: data.voice_settings
        };
        
        // Send to Python process
        safePythonWrite(JSON.stringify(command) + '\n');
        console.log('Voice settings update command sent to Python backend');
        
        // Listen for response in pythonProcess.stdout handler and send back to renderer
        // The existing stdout handler will parse JSON responses and can be extended to handle
        // voice settings responses specifically
    } catch (error) {
        console.error('Error updating voice settings:', error);
        event.sender.send('voice-settings-updated', {
            status: 'error',
            result: error.message
        });
    }
});

// IPC listener for updating Perplexity Sonar settings
ipcMain.on('update-perplexity-settings', (event, data) => {
    console.log('IPC Message Received: Update Perplexity Settings', data);
    try {
        if (!pythonProcess || pythonProcess.killed) {
            throw new Error('Python process not available');
        }
        
        // Format command to send to Python backend
        const command = {
            action: 'update-perplexity-settings',
            data: data.perplexity_settings
        };
        
        // Send to Python process
        safePythonWrite(JSON.stringify(command) + '\n');
        console.log('Perplexity settings update command sent to Python backend');
        
        // Listen for response in pythonProcess.stdout handler
        // The existing stdout handler will parse JSON responses
    } catch (error) {
        console.error('Error updating Perplexity settings:', error);
        event.sender.send('perplexity-settings-updated', {
            status: 'error',
            result: error.message
        });
    }
});

function updateAgentConfigPanel() {
    const configPanel = document.getElementById('agent-config');
    if (!configPanel) return;

    // Get current config
    const currentConfig = window.currentConfig || {};
    const autonomy = currentConfig.autonomy || {};

    configPanel.innerHTML = `
        <div class="config-section">
            <h3>Screenshot Observation</h3>
            <div class="config-row">
                <label>
                    <input type="checkbox" id="screenshot-enabled" 
                        ${autonomy.screenshot?.enabled ? 'checked' : ''}>
                    Enable Screenshots
                </label>
            </div>
            <div class="config-row">
                <label>Interval (seconds):</label>
                <input type="number" id="screenshot-min-interval" 
                    value="${autonomy.screenshot?.min_interval || 5}" min="1" max="3600">
                to
                <input type="number" id="screenshot-max-interval" 
                    value="${autonomy.screenshot?.max_interval || 20}" min="1" max="3600">
            </div>
            <div class="config-row">
                <label>Prompt:</label>
                <textarea id="screenshot-prompt">${autonomy.screenshot?.prompt || ''}</textarea>
            </div>
        </div>

        <div class="config-section">
            <h3>Autonomous Messages</h3>
            <div class="config-row">
                <label>
                    <input type="checkbox" id="messages-enabled" 
                        ${autonomy.messages?.enabled ? 'checked' : ''}>
                    Enable Messages
                </label>
            </div>
            <div class="config-row">
                <label>Interval (seconds):</label>
                <input type="number" id="messages-min-interval" 
                    value="${autonomy.messages?.min_interval || 15}" min="1" max="3600">
                to
                <input type="number" id="messages-max-interval" 
                    value="${autonomy.messages?.max_interval || 20}" min="1" max="3600">
            </div>
            <div class="config-row">
                <label>Prompt:</label>
                <textarea id="messages-prompt">${autonomy.messages?.prompt || ''}</textarea>
            </div>
        </div>

        <div class="config-section">
            <h3>Midjourney Generation</h3>
            <div class="config-row">
                <label>
                    <input type="checkbox" id="midjourney-enabled" 
                        ${autonomy.midjourney?.enabled ? 'checked' : ''}>
                    Enable Auto-Generation
                </label>
            </div>
            <div class="config-row">
                <label>Interval (seconds):</label>
                <input type="number" id="midjourney-min-interval" 
                    value="${autonomy.midjourney?.min_interval || 300}" min="1" max="7200">
                to
                <input type="number" id="midjourney-max-interval" 
                    value="${autonomy.midjourney?.max_interval || 900}" min="1" max="7200">
            </div>
            <div class="config-row">
                <label>Prompt Template:</label>
                <textarea id="midjourney-prompt">${autonomy.midjourney?.prompt || ''}</textarea>
            </div>
            <div class="config-row">
                <label>System Prompt:</label>
                <textarea id="midjourney-system-prompt" style="height: 100px;">${autonomy.midjourney?.system_prompt || ''}</textarea>
            </div>
        </div>

        <div class="config-section">
            <button onclick="saveAgentConfig()">Save Configuration</button>
        </div>
    `;
}

function saveAgentConfig() {
    // Get current config
    const config = window.currentConfig || {};
    
    // Update autonomy settings
    config.autonomy = config.autonomy || {};
    
    // Screenshot settings
    config.autonomy.screenshot = {
        enabled: document.getElementById('screenshot-enabled').checked,
        min_interval: parseInt(document.getElementById('screenshot-min-interval').value),
        max_interval: parseInt(document.getElementById('screenshot-max-interval').value),
        prompt: document.getElementById('screenshot-prompt').value
    };
    
    // Messages settings
    config.autonomy.messages = {
        enabled: document.getElementById('messages-enabled').checked,
        min_interval: parseInt(document.getElementById('messages-min-interval').value),
        max_interval: parseInt(document.getElementById('messages-max-interval').value),
        prompt: document.getElementById('messages-prompt').value
    };
    
    // Midjourney settings
    config.autonomy.midjourney = {
        enabled: document.getElementById('midjourney-enabled').checked,
        min_interval: parseInt(document.getElementById('midjourney-min-interval').value),
        max_interval: parseInt(document.getElementById('midjourney-max-interval').value),
        prompt: document.getElementById('midjourney-prompt').value,
        system_prompt: document.getElementById('midjourney-system-prompt').value
    };

    // Send as config save command
    window.ws.send(JSON.stringify({
        text: `/config save ${JSON.stringify(config)}`
    }));
}

function updateConfigPanel(config) {
    if (!config) {
        console.log('ERROR: updateConfigPanel called with null/undefined config');
        return;
    }
    
    console.log('Updating config panel with full config object...');
    console.log('Config keys:', Object.keys(config));
    
    // Log specific important values to verify they exist
    console.log('Model:', config.model);
    console.log('API Endpoint:', config.api_endpoint);
    console.log('System Prompt exists:', !!config.system_prompt);
    
    // Check autonomy structure
    if (config.autonomy) {
        console.log('Autonomy exists with keys:', Object.keys(config.autonomy));
        // Check if messages exists in autonomy
        if (config.autonomy.messages) {
            console.log('Messages exists with enabled:', config.autonomy.messages.enabled);
        } else {
            console.log('WARNING: messages missing in autonomy');
        }
    } else {
        console.log('WARNING: autonomy missing in config');
    }
    
    // Check if we're using autonomous instead of autonomy
    if (config.autonomous) {
        console.log('WARNING: Using "autonomous" instead of "autonomy"');
        console.log('autonomous keys:', Object.keys(config.autonomous));
    }
    
    // Ensure midjourney prompt is properly set
    if (config.autonomy && config.autonomy.midjourney) {
        console.log('Midjourney config in main.js:', config.autonomy.midjourney);
    }
    
    console.log('Sending update-config-panel event to renderer...');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-config-panel', config);
    }

    // Also try sending via config-update event for redundancy
    console.log('Sending config-update event to renderer...');
    sendConfigUpdate(config);

    // Force a debug-config-update event to trace in console
    console.log('Sending debug-config-update event to renderer...');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('debug-config-update', config);
    }
}

// IPC Communication
ipcMain.on('python-message', (event, message) => {
    if(message.type === 'config' && message.content) {
        // Send to renderer process - exactly as in TP 75
        sendConfigUpdate(message.content, message.remote_key_status);
        console.log('Sent config update to renderer:', message.content);
    }
    // Keep existing logic for other message types...
});

// Add a debug command to display the current configuration
ipcMain.on('debug-config', (event) => {
    console.log('Debug command received: Displaying current configuration');
    
    // Request the current configuration from Python
    safePythonWrite(JSON.stringify({
        command: 'requestConfig',
        debug: true
    }) + '\n');
    
    console.log('Debug: Configuration request sent to Python backend');
});

// Add a debug function to test the configuration flow
function testConfigFlow(config) {
    console.log('==== DEBUG: CONFIGURATION FLOW TEST ====');
    console.log('Configuration received from Python:', JSON.stringify(config, null, 2));

    // Check if midjourney configuration exists
    if (config.autonomy && config.autonomy.midjourney) {
        console.log('Midjourney configuration found:');
        console.log('- enabled:', config.autonomy.midjourney.enabled);
        console.log('- min_interval:', config.autonomy.midjourney.min_interval);
        console.log('- max_interval:', config.autonomy.midjourney.max_interval);
        console.log('- prompt:', config.autonomy.midjourney.prompt);
        console.log('- system_prompt:', config.autonomy.midjourney.system_prompt);
    } else {
        console.log('No midjourney configuration found in the config object');
    }
    
    // Forward to renderer through multiple channels
    console.log('Forwarding configuration to renderer process...');
    
    // Standard config update channel
    sendConfigUpdate(config);
    
    // Debug channel (for compatibility with old code)
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('debug-config-update', config);
    }
    
    // Direct update to the config panel
    mainWindow.webContents.send('update-config-panel', config);
    
    console.log('==== END OF DEBUG TEST ====');
}

// IPC listener for opening profile manager
ipcMain.on('open-profile-manager', (event) => {
    console.log('IPC Message Received: Open Profile Manager');
    try {
        createProfileManagerWindow();
        console.log('Profile manager window created/focused successfully');
    } catch (error) {
        console.error('Error creating profile manager window:', error);
        logError(error);
    }
});

// IPC listener for saving profiles
ipcMain.on('save-profile', (event, profile) => {
    console.log('Saving profile:', profile);
    try {
        if (!pythonProcess || pythonProcess.killed) {
            logError('Python process not running');
            return;
        }
        safePythonWrite(JSON.stringify({
            text: `/profile create ${JSON.stringify(profile)}`
        }) + '\n');
        
        // Close the profile manager window after saving
        if (profileManagerWindow && !profileManagerWindow.isDestroyed()) {
            profileManagerWindow.close();
        }
    } catch (error) {
        logError('Error saving profile: ' + error);
    }
});

// IPC listener for config operations
ipcMain.on('config', (event, data) => {
    console.log('Config operation received:', data);
    try {
        if (!pythonProcess || pythonProcess.killed) {
            logError('Python process not running');
            return;
        }

        if (data.action === 'create-profile') {
            console.log('Creating profile:', data);
            safePythonWrite(JSON.stringify({
                text: `/config create-profile ${data.name}`,
                config: data.config
            }) + '\n');
        } else if (data.action === 'save') {
            console.log('Saving config:', data);
            
            // Debug: log ElevenLabs keys specifically
            if (data.config && data.config.remote_api_keys) {
                const rk = data.config.remote_api_keys;
                console.log('[11LABS MAIN.JS] API key length:', (rk.elevenlabs_api_key || '').length);
                console.log('[11LABS MAIN.JS] Voice ID:', rk.elevenlabs_voice_id || '(empty)');
                console.log('[11LABS MAIN.JS] Agent ID:', rk.elevenlabs_agent_id || '(empty)');
            }
            
            // Check if this is a toggle for notes
            if (data.config && data.config.autonomy && data.config.autonomy.notes !== undefined) {
                console.log('Notes autonomy config detected:');
                console.log('Enabled state:', data.config.autonomy.notes.enabled);
                console.log('Type of enabled:', typeof data.config.autonomy.notes.enabled);
            }
            
            // Stringify with formatting for better debug visibility
            const configJson = JSON.stringify(data.config, null, 2);
            console.log('Config JSON being sent to Python:', configJson);
            
            // Send to Python process
            const commandText = `/config save ${JSON.stringify(data.config)}`;
            console.log('Full command being sent:', commandText);
            
            safePythonWrite(JSON.stringify({
                text: commandText
            }) + '\n');
            
            // Also update the UI immediately with the new config
            mainWindow.webContents.send('config-update', data.config);
        } else if (data.action === 'get') {
            console.log('Getting config');
            safePythonWrite(JSON.stringify({
                text: '/config'
            }) + '\n');
        }
    } catch (error) {
        logError('Error in config operation: ' + error);
    }
});

// Add a function to request the configuration after a delay
function requestConfigWithDelay(delayMs = 1000) {
    setTimeout(() => {
        console.log('Requesting configuration after delay...');
        if (pythonProcess && pythonProcess.stdin) {
            safePythonWrite(JSON.stringify({
                text: '/config'
            }) + '\n');
            console.log('Config request sent to Python backend');
        } else {
            console.error('Python process not available when requesting config after delay');
            // Try to restart the Python process
            console.log('Attempting to restart Python process');
            startPythonBackend();
            // Try again after restart
            setTimeout(() => {
                if (pythonProcess && pythonProcess.stdin) {
                    safePythonWrite(JSON.stringify({
                        text: '/config'
                    }) + '\n');
                } else {
                    if (mainWindow) {
                        mainWindow.webContents.send('error', 'Cannot request configuration: Python process not available after restart');
                    }
                }
            }, 2000);
        }
    }, delayMs);
}

// Primary save-config handler - sends to Python backend
ipcMain.on('save-config', (event, config) => {
    if (pythonProcess && pythonProcess.stdin) {
        safePythonWrite(JSON.stringify({
            text: `/config save ${JSON.stringify(config)}`
        }) + '\n');
        // Python backend will send updated config back automatically
    } else {
        console.error('Python process not available when trying to save config');
        if (mainWindow) {
            mainWindow.webContents.send('error', 'Cannot save configuration: Python process not available');
        }
    }
});

// Modify the debug-config handler to use the delay
ipcMain.on('debug-config', (event) => {
    console.log('Debug command received: Displaying current configuration');
    
    // Request the current configuration from Python with a delay
    requestConfigWithDelay(1000);
    
    console.log('Debug: Configuration request scheduled with delay');
});

// Handler for execute-action IPC event
ipcMain.on('execute-action', (event, data) => {
    console.log('Execute action received:', data);
    
    if (data.action === 'run-python-script' && 
        (data.script === 'xgo_vision_client.py' || data.script === 'xgo_vision_client_reference.py')) {
        console.log('Launching XGO Vision Client');
        
        // Construct the path to the Python script
        const pythonPath = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
        
        // Use the reference implementation instead
        const scriptPath = path.join(__dirname, 'xgo_vision_client_reference.py');
        
        // Prepare arguments
        const args = data.args || [];
        
        console.log(`Launching: ${pythonPath} ${scriptPath} ${args.join(' ')}`);
        
        // Spawn the process
        const visionProcess = spawn(pythonPath, [scriptPath, ...args], {
            stdio: 'inherit',
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
        
        visionProcess.on('error', (err) => {
            console.error('Failed to start XGO Vision Client:', err);
            if (mainWindow) {
                mainWindow.webContents.send('error', `Failed to start XGO Vision Client: ${err.message}`);
            }
        });
        
        visionProcess.on('exit', (code) => {
            console.log(`XGO Vision Client exited with code ${code}`);
        });
    } else {
        console.log('Unknown action or script');
    }
});

function killPythonProcessTree(proc) {
    if (!proc) return;
    const pid = proc.pid;
    try {
        // Kill entire process tree on Windows (includes all child processes)
        if (process.platform === 'win32') {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } else {
            proc.kill('SIGKILL');
        }
        console.log(`Killed Python process tree (PID ${pid})`);
    } catch (e) {
        // Process may already be dead
        console.log(`Process tree kill (PID ${pid}): ${e.message}`);
    }
}

function killPortHolders() {
    // Kill any process holding port 8765 or 8766 (stale from previous sessions)
    if (process.platform === 'win32') {
        try {
            const out = execSync('netstat -ano | findstr "LISTENING" | findstr ":8765"', { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] });
            const pids = new Set();
            out.split('\n').forEach(line => {
                const m = line.trim().match(/(\d+)\s*$/);
                if (m) pids.add(m[1]);
            });
            pids.forEach(pid => {
                try {
                    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
                    console.log(`Killed stale process on port 8765 (PID ${pid})`);
                } catch (_) {}
            });
        } catch (_) {
            // No process on port — good
        }
    }
}

async function runFirstRunCheck() {
    const markerPath = path.join(__dirname, '.deps_installed');
    const reqPath = path.join(__dirname, 'requirements.txt');
    const pkgPath = path.join(__dirname, 'package.json');

    // Read current app version from package.json
    let appVersion = '0.0.0';
    try {
        appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
    } catch (_) {}

    // Read installed version from marker (old markers had 'ok', new ones have version)
    let installedVersion = null;
    let isUpdate = false;
    if (fs.existsSync(markerPath)) {
        try {
            const marker = fs.readFileSync(markerPath, 'utf-8').trim();
            installedVersion = (marker === 'ok' || !marker) ? '0.0.0' : marker;
        } catch (_) { installedVersion = '0.0.0'; }
    }

    // Determine if we need to install/update
    const needsInstall = (!installedVersion && fs.existsSync(reqPath));
    isUpdate = (installedVersion !== null && installedVersion !== appVersion && fs.existsSync(reqPath));
    const needsSetup = needsInstall || isUpdate;
    debugLog(`[FirstRun] __dirname=${__dirname}`);
    debugLog(`[FirstRun] markerPath=${markerPath} exists=${fs.existsSync(markerPath)}`);
    debugLog(`[FirstRun] appVersion=${JSON.stringify(appVersion)} installedVersion=${JSON.stringify(installedVersion)}`);
    debugLog(`[FirstRun] needsInstall=${needsInstall} isUpdate=${isUpdate} needsSetup=${needsSetup}`);

    // 1. Create necessary directories (always, fast)
    const dirs = [
        'profiles', 'knowledge', 'workspace', 'data', 'logs',
        'uploads', 'screenshots', 'config', 'skills', 'certs',
        // v1.2.0: skill learning & event system
        path.join('workspace', 'recordings'),
        path.join('workspace', 'emergent'),
        path.join('workspace', 'output'),
        path.join('workspace', 'temp'),
        path.join('data', 'events'),
        path.join('data', 'sounds'),
    ];
    for (const d of dirs) {
        const dirPath = path.join(__dirname, d);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    // 2. Find Python — prefer local venv, fall back to system
    const venvPython = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    let pythonExe = fs.existsSync(venvPython) ? venvPython : null;
    if (!pythonExe) {
        // Try common Python names
        for (const cmd of ['python', 'python3', 'py']) {
            try {
                execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 10000 });
                pythonExe = cmd;
                break;
            } catch (_) {}
        }
    }
    if (!pythonExe) {
        dialog.showErrorBox(
            'Python Not Found',
            'Substrate requires Python 3.10 or higher.\n\n' +
            'Please install Python from https://python.org\n' +
            'Make sure to check "Add Python to PATH" during installation.'
        );
        app.quit();
        return;
    }
    console.log('[FirstRun] Python found:', pythonExe);

    // 3. If deps already installed and version matches, skip
    if (!needsSetup) {
        console.log(`[FirstRun] v${appVersion} already installed, skipping setup`);
        return;
    }

    // 4. Show a visible setup window for first-run or update
    console.log(isUpdate
        ? `[FirstRun] Updating v${installedVersion} → v${appVersion}`
        : '[FirstRun] First run — showing setup window');
    let setupWindow = new BrowserWindow({
        width: 480,
        height: 320,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        backgroundColor: '#1a1a2e',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    const setupHTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #1a1a2e;
         color: #e0e0e0; display:flex; flex-direction:column; align-items:center;
         justify-content:center; height:100vh; padding:30px; user-select:none;
         -webkit-app-region: drag; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: #4fc3f7; }
  .subtitle { font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 30px; }
  .status { font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 14px;
            min-height: 20px; text-align: center; }
  .progress-track { width: 100%; height: 6px; background: rgba(255,255,255,0.1);
                    border-radius: 3px; overflow: hidden; }
  .progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #4fc3f7, #81d4fa);
                  border-radius: 3px; transition: width 0.5s ease; }
  .hint { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 20px; text-align:center; }
</style></head><body>
  <h1>Substrate</h1>
  <div class="subtitle">${isUpdate ? `Updating to v${appVersion}...` : 'First-time setup'}</div>
  <div class="status" id="status">Checking prerequisites...</div>
  <div class="progress-track"><div class="progress-bar" id="bar"></div></div>
  <div class="hint">${isUpdate ? 'Updating dependencies...' : 'This only happens once. Please wait...'}</div>
</body></html>`)}`;

    setupWindow.loadURL(setupHTML);

    // Helper to update the setup window
    const updateSetup = (status, percent) => {
        if (setupWindow && !setupWindow.isDestroyed()) {
            setupWindow.webContents.executeJavaScript(
                `document.getElementById('status').textContent = ${JSON.stringify(status)};` +
                `document.getElementById('bar').style.width = '${percent}%';`
            ).catch(() => {});
        }
    };

    // Helper to run a command as a promise
    const runAsync = (cmd, args, label) => {
        return new Promise((resolve, reject) => {
            const proc = spawn(cmd, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                cwd: __dirname
            });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`${label} failed (code ${code}): ${stderr.slice(-300)}`));
            });
            proc.on('error', err => reject(err));
        });
    };

    try {
        // Step 1: Create venv if needed
        const venvDir = path.join(__dirname, 'venv');
        if (!fs.existsSync(venvDir)) {
            updateSetup('Creating Python environment...', 10);
            await runAsync(pythonExe, ['-m', 'venv', venvDir], 'venv creation');
            pythonExe = venvPython;
        } else {
            pythonExe = venvPython;
        }

        // Step 2: Upgrade pip
        updateSetup('Upgrading pip...', 25);
        await runAsync(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'pip upgrade');

        // Step 3: Install requirements
        updateSetup('Installing dependencies (this may take a few minutes)...', 40);
        await runAsync(pythonExe, ['-m', 'pip', 'install', '-r', reqPath], 'pip install');

        updateSetup(isUpdate ? `Update to v${appVersion} complete!` : 'Setup complete!', 100);

        // Write marker with version
        fs.writeFileSync(markerPath, appVersion);
        console.log('[FirstRun] Dependencies installed successfully');

        // Brief pause so user sees "complete"
        await new Promise(r => setTimeout(r, 1500));

    } catch (installErr) {
        console.error('[FirstRun] Setup error:', installErr.message);
        const choice = dialog.showMessageBoxSync(setupWindow, {
            type: 'warning',
            title: 'Setup Issue',
            message: 'Some dependencies failed to install.',
            detail: installErr.message + '\n\nYou can try manually:\npip install -r requirements.txt',
            buttons: ['Continue Anyway', 'Quit'],
            defaultId: 0
        });
        if (choice === 1) {
            app.quit();
            return;
        }
    }

    // Close setup window
    if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.close();
    }
    setupWindow = null;

    // Check Ollama (non-blocking)
    try {
        execSync('ollama --version', { stdio: 'pipe', timeout: 5000 });
        console.log('[FirstRun] Ollama found');
    } catch (e) {
        console.log('[FirstRun] Ollama not found');
        if (!fs.existsSync(path.join(__dirname, '.ollama_warned'))) {
            const ollamaChoice = dialog.showMessageBoxSync(mainWindow || null, {
                type: 'info',
                title: 'Ollama Not Found',
                message: 'Ollama is recommended for local AI models.',
                detail: 'Without Ollama, you can still use remote models (Gemini, Claude, GPT, etc).\n\nInstall from: https://ollama.com',
                buttons: ['Download Ollama', 'Skip for Now'],
                defaultId: 1
            });
            if (ollamaChoice === 0) {
                shell.openExternal('https://ollama.com/download');
            }
            fs.writeFileSync(path.join(__dirname, '.ollama_warned'), 'ok');
        }
    }

    console.log('[FirstRun] All checks complete');
}

function startPythonBackend() {
    try {
        const pythonPath = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
        debugLog(`startPythonBackend: pythonPath=${pythonPath}`);
        debugLog(`startPythonBackend: exists=${fs.existsSync(pythonPath)}`);
        debugLog(`startPythonBackend: __dirname=${__dirname}`);
        if (!fs.existsSync(pythonPath)) {
            debugLog('[Backend] venv python NOT FOUND at ' + pythonPath);
            console.error('[Backend] venv python not found at', pythonPath, '— skipping start');
            return;
        }
        // Kill any existing Python process tree before starting a new one
        if (pythonProcess) {
            killPythonProcessTree(pythonProcess);
            pythonProcess = null;
        }
        // Also kill any stale processes holding our ports from previous sessions
        killPortHolders();
        const agentPath = path.join(__dirname, 'proxy_server.py');
        console.log('Starting Python process:', pythonPath, agentPath);
        
        debugLog(`Spawning: ${pythonPath} ${agentPath}`);
        pythonProcess = spawn(pythonPath, [agentPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: __dirname,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
        debugLog(`Spawned PID: ${pythonProcess.pid}`);

        // Handle output with proper line buffering (prevents partial JSON fragments)
        let pythonLineBuffer = '';
        pythonProcess.stdout.on('data', (data) => {
            pythonLineBuffer += data.toString();
            
            // Only process complete lines (ending with \n)
            const lastNewline = pythonLineBuffer.lastIndexOf('\n');
            if (lastNewline === -1) return; // No complete line yet, keep buffering
            
            const completeData = pythonLineBuffer.substring(0, lastNewline);
            pythonLineBuffer = pythonLineBuffer.substring(lastNewline + 1); // Keep remainder
            
            completeData.split('\n').forEach(line => {
                if (!line.trim()) return;
                
                try {
                    const message = JSON.parse(line);
                    
                    // Special handling for config messages - IMPORTANT!
                    if (message.type === 'config' && message.content) {
                        // CRITICAL: Forward config data to renderer exactly as in tp 105
                        console.log(`Received config from Python. Forwarding to renderer`);
                        console.log(`Config content sample: ${JSON.stringify(message.content).substring(0, 100)}...`);
                        
                        // Send to renderer using the tp 105 channel name
                        sendConfigUpdate(message.content, message.remote_key_status);
                        return;
                    }
                    
                    // Handle other message types
                    if (message.type === 'error') {
                        mainWindow.webContents.send('error', message.content);
                    } else if (message.type === 'voice') {
                        mainWindow.webContents.send('voice-status', message.status);
                    } else if (message.type === 'avatar_emotions') {
                        console.log('[EMOTION] Forwarding emotion schedule to renderer:', JSON.stringify(message.schedule?.map(s => s.emotion)));
                        mainWindow.webContents.send('python-message', message);
                        mainWindow.webContents.send('avatar-emotions', message);
                    } else {
                        // Suppress [SILENT] messages from reaching the renderer
                        const _r = (message.result || '').toString().trim();
                        if (_r.startsWith('[SILENT]') || _r === 'CIRCUITS_OK' || _r === 'HEARTBEAT_OK') return;
                        // Forward message to renderer
                        mainWindow.webContents.send('python-message', message);
                    }
                } catch (e) {
                    debugLog('Python stdout (non-JSON): ' + line.substring(0, 500));
                    // Not a JSON message - suppress most raw output
                    if (line.includes('ERROR') || line.includes('error') || line.includes('Exception')) {
                        console.log('Python:', line);
                    }
                }
            });
        });

        pythonProcess.stderr.on('data', (data) => {
            const error = data.toString();
            debugLog('Python stderr: ' + error.substring(0, 500));
            // Only log actual errors, not INFO/DEBUG messages
            if (error.includes('ERROR') || error.includes('Exception') || error.includes('Traceback')) {
                console.log('Python stderr:', error);
            }
            // Skip torch warnings and pygame messages
            if (error.includes('Warning:') || error.includes('pygame')) {
                // Suppressed warning
                return;
            }
            // Only send actual errors to UI (not INFO/DEBUG messages)
            if (error.includes('ERROR') || error.includes('Exception') || error.includes('Traceback') || error.includes('failed')) {
                logError('Python Error: ' + error);
                mainWindow.webContents.send('error', 'Python error: ' + error);
            }
        });

        pythonProcess.on('error', (error) => {
            debugLog('Python process ERROR: ' + error);
            logError('Failed to start Python process: ' + error);
            mainWindow.webContents.send('error', 'Failed to start Python process');
        });

        pythonProcess.on('close', (code) => {
            debugLog('Python process CLOSED with code: ' + code);
            logError('Python process closed with code: ' + code);
            pythonProcess = null;
            
            // Auto-restart the Python process if it crashes unexpectedly
            // but only if the app is not quitting
            if (!app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
                console.log('Attempting to restart Python process after unexpected close');
                setTimeout(() => {
                    startPythonBackend();
                    // Request config after restart
                    setTimeout(() => {
                        if (pythonProcess && pythonProcess.stdin) {
                            safePythonWrite(JSON.stringify({
                                text: '/config'
                            }) + '\n');
                        }
                    }, 2000);
                }, 1000);
            }
        });
    } catch (error) {
        logError(error);
    }
}

function logError(error) {
    console.error('Error:', error);
    if (mainWindow) {
        mainWindow.webContents.send('error', error.toString());
    }
}

function sendConfigUpdate(config, remoteStatus) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    let payload;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
        try {
            payload = JSON.parse(JSON.stringify(config));
        } catch (err) {
            console.warn('Failed to clone config object, falling back to shallow copy', err);
            payload = { ...config };
        }
    } else {
        payload = { content: config };
    }

    if (remoteStatus && typeof remoteStatus === 'object') {
        latestRemoteKeyStatus = remoteStatus;
    }

    if (payload.remote_key_status && typeof payload.remote_key_status === 'object') {
        latestRemoteKeyStatus = payload.remote_key_status;
    }

    if (!payload.remote_key_status && latestRemoteKeyStatus && Object.keys(latestRemoteKeyStatus).length) {
        payload.remote_key_status = latestRemoteKeyStatus;
    }

    if (payload.content === undefined && payload !== config) {
        payload.content = config;
    }

    mainWindow.webContents.send('config-update', payload);
}

// Function to check if Vision Client should auto-start
function checkVisionClientAutoStart() {
    try {
        const settingsPath = path.join(__dirname, 'vision_client_settings.json');
        
        // Check if settings file exists
        if (fs.existsSync(settingsPath)) {
            const settingsData = fs.readFileSync(settingsPath, 'utf8');
            const settings = JSON.parse(settingsData);
            
            // Check if auto-start is enabled
            if (settings.auto_start === true) {
                console.log('Auto-starting Vision Client...');
                
                // Start Vision Client in background mode
                const pythonPath = process.env.PYTHONPATH || 'python';
                const scriptPath = path.join(__dirname, 'xgo_vision_client_reference.py');
                
                // Start Vision Client with --background flag
                const visionClientProcess = spawn(pythonPath, [scriptPath, '--background']);
                
                visionClientProcess.stdout.on('data', (data) => {
                    console.log(`Vision Client: ${data}`);
                });
                
                visionClientProcess.stderr.on('data', (data) => {
                    console.error(`Vision Client Error: ${data}`);
                });
                
                visionClientProcess.on('close', (code) => {
                    console.log(`Vision Client process exited with code ${code}`);
                });
            } else {
                console.log('Vision Client auto-start is disabled');
            }
        } else {
            console.log('Vision Client settings file not found, skipping auto-start');
        }
    } catch (error) {
        console.error('Error checking Vision Client auto-start:', error);
    }
}

// IPC listener for executing actions
ipcMain.on('execute-action', (event, data) => {
    try {
        console.log('Executing action:', data);
        
        // Clean up text for processing (allow textless actions)
        const cleanedText = (data.text || '').trim();
        
        // Filter out garbage text (random punctuation from STT noise)
        if (cleanedText && cleanedText.replace(/[^a-zA-Z0-9]/g, '').length < 2) {
            console.log('Filtered garbage execute-action input:', cleanedText);
            return;
        }
        
        // Check for special case: weather queries
        let isWeatherQuery = false;
        let isAuroraCommand = false;
        
        // Check for aurora forecast commands
        const auroraTerms = ['aurora forecast', 'aurora map', 'show aurora', 'check aurora', 'aurora prediction', 
                           'show me aurora', 'show the aurora', 'show me the aurora', 'northern lights', 'aurora borealis'];
        
        // Check if this is an aurora-related command
        const textLower = (data.text || '').toLowerCase();
        for (const term of auroraTerms) {
            if (textLower.includes(term)) {
                isAuroraCommand = true;
                console.log(`[DEBUG] Detected aurora command: ${term} in text: ${data.text}`);
                break;
            }
        }
        
        // Weather functionality has been removed, only aurora commands are supported
        
        try {
            // All location detection and Google Earth functionality has been removed
            // Aurora forecast functionality is still supported and handled by the Python backend
        } catch (error) {
            console.error('Error processing location query:', error);
        }
        
        // For all other commands, we'll let the command parser handle them
        
        // For all other commands, send to the existing command processing system
        if (pythonProcess && pythonProcess.stdin) {
            console.log('Sending command to Python:', cleanedText);
            if (data.action === 'start-elevenlabs') {
                safePythonWrite(JSON.stringify({
                    action: 'start-elevenlabs'
                }) + '\n');
            } else if (data.action === 'command') {
                safePythonWrite(JSON.stringify({
                    command: data.text,
                    text: data.text
                }) + '\n');
            } else if (data.action === 'chat') {
                // Don't send empty chat messages (prevents 'Hello' fallback on startup)
                if (!cleanedText && !data.image && !data.file_content) {
                    console.log('Skipping empty chat message');
                    return;
                }
                const payload = { text: data.text, image: data.image };
                if (data.mode && data.mode !== 'code') payload.mode = data.mode;
                if (data.file_content) payload.file_content = data.file_content;
                if (data.file_name) payload.file_name = data.file_name;
                safePythonWrite(JSON.stringify(payload) + '\n');
            } else {
                safePythonWrite(JSON.stringify(data) + '\n');
            }
        } else {
            console.error('Python process stdin not available, attempting to restart process');
            // Try to restart the Python process
            startPythonBackend();
            // Return a friendly error message instead of throwing
            if (mainWindow) {
                mainWindow.webContents.send('error', 'Python process restarting. Please try again in a few seconds.');
            }
            return; // Don't throw, just return
        }
    } catch (error) {
        console.error('Error executing action:', error);
        if (mainWindow) {
            mainWindow.webContents.send('error', 'Error executing action: ' + error.message);
        }
    }
});

// Duplicate save-config handler removed - using primary handler above



ipcMain.on('command', (event, command) => {
    console.log('Received IPC message:', 'command', command);
    try {
        console.log('Executing command:', command);
        if (!pythonProcess || pythonProcess.killed) {
            logError('Python process not running');
            return;
        }
        if (pythonProcess && pythonProcess.stdin) {
            safePythonWrite(JSON.stringify({
                text: command
            }) + '\n');
        } else {
            logError('Python process stdin not available');
            if (mainWindow) {
                mainWindow.webContents.send('error', 'Cannot execute command: Python process not available');
            }
        }
    } catch (error) {
        logError('Error executing command: ' + error);
    }
});

ipcMain.on('requestConfig', (event) => {
    if (pythonProcess && pythonProcess.stdin) {
        safePythonWrite(JSON.stringify({
            text: '/config'
        }) + '\n');
    }
});

// Create system tray icon
function createTray() {
    try {
        // Try to use the avatar as tray icon, fall back to assets icon
        let iconPath = path.join(__dirname, 'profiles', 'default', 'avatar.png');
        if (!fs.existsSync(iconPath)) {
            iconPath = path.join(__dirname, 'assets', 'icons', 'icon.png');
        }
        
        let trayIcon;
        if (fs.existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
            // Resize for tray (16x16 on Windows)
            trayIcon = trayIcon.resize({ width: 16, height: 16 });
        } else {
            // Create a simple colored icon if no image exists
            trayIcon = nativeImage.createEmpty();
        }
        
        tray = new Tray(trayIcon);
        tray.setToolTip('Substrate');
        
        const contextMenu = Menu.buildFromTemplate([
            { 
                label: 'Show', 
                click: () => {
                    if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isMinimized()) {
                        hostWindow.restore();
                    }
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            { 
                label: 'Web UI', 
                click: () => {
                    shell.openExternal('http://localhost:8765/webui/');
                }
            },
            { type: 'separator' },
            { 
                label: 'Quit', 
                click: () => {
                    if (pythonProcess) {
                        pythonProcess.kill();
                    }
                    app.quit();
                }
            }
        ]);
        
        tray.setContextMenu(contextMenu);
        
        // Double-click to show window
        tray.on('double-click', () => {
            if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isMinimized()) {
                hostWindow.restore();
            }
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
        
        console.log('System tray created successfully');
    } catch (error) {
        console.error('Error creating tray:', error);
    }
}

// Minimize to tray handler
ipcMain.on('minimize-to-tray', () => {
    console.log('Received IPC message:', 'minimize-to-tray');
    if (hostWindow && !hostWindow.isDestroyed()) {
        hostWindow.minimize();
    }
    if (mainWindow) {
        mainWindow.hide();
    }
});

// Show window handler (for restoring from tray)
ipcMain.on('show-window', () => {
    console.log('Received IPC message:', 'show-window');
    if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isMinimized()) {
        hostWindow.restore();
    }
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.on('quit-app', () => {
    console.log('Received IPC message:', 'quit-app');
    try {
        if (pythonProcess) {
            pythonProcess.kill();
        }
        app.quit();
    } catch (error) {
        logError('Error during quit: ' + error);
        app.exit(1); // Force quit if normal quit fails
    }
});

app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
        } else {
            callback(false);
        }
    });
});

// Handle external links
ipcMain.on('open-external-link', (event, url) => {
  if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    console.log(`Opening external URL: ${url}`);
    shell.openExternal(url);
  } else {
    console.error(`Invalid URL format: ${url}`);
  }
});

// Add a function to handle speech input
function handleSpeechInput(text) {
    console.log('Processing speech input:', text);
    
    if (!text || text.trim() === '') {
        console.log('Empty speech input, ignoring');
        return;
    }
    
    // Clean up the text
    const cleanedText = text.trim();
    
    // Filter out garbage transcriptions (random punctuation, brackets, etc.)
    const alphanumericOnly = cleanedText.replace(/[^a-zA-Z0-9]/g, '');
    if (alphanumericOnly.length < 2) {
        console.log('Filtered garbage speech input:', cleanedText);
        return;
    }
    
    const lowerText = cleanedText.toLowerCase();
    
    // Check for "show me" commands first
    if (lowerText.match(/^(show|show me|display|view|look at)\s+(.+)$/i)) {
        const match = lowerText.match(/^(show|show me|display|view|look at)\s+(.+)$/i);
        const query = match[2].trim();
        
        // Check for news queries
        if (query.toLowerCase().includes('news') || 
            query.toLowerCase().includes('headlines') || 
            query.toLowerCase().includes('current events')) {
            
            // Open Google News
            const newsUrl = 'https://news.google.com';
            console.log('News query detected: Opening Google News:', newsUrl);
            
            // Open the URL in the default browser
            shell.openExternal(newsUrl);
            
            // Send a confirmation message to the UI
            let message = `Opening Google News to show you the latest headlines...`;
            mainWindow.webContents.send('python-message', {
                status: 'success',
                result: message
            });
            
            return; // Skip further processing
        }
        
        // "Show me" queries are now handled by the Python backend
        // No special handling for Google Earth anymore
        console.log('Show me command detected: Forwarding to Python backend');
        
        // Check if this is a YouTube URL for logging purposes
        const youtubeUrlPatterns = [
            /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+(?:&t=\d+s?)?/,
            /https?:\/\/youtu\.be\/[\w-]+(?:\?t=\d+s?)?/
        ];
        
        let isYoutubeUrl = false;
        for (const pattern of youtubeUrlPatterns) {
            if (pattern.test(query)) {
                isYoutubeUrl = true;
                console.log('YouTube URL detected:', query);
                break;
            }
        }
    }
    
    // Weather functionality has been removed, only aurora forecast is supported
    // Check for aurora-related queries is handled in the Python backend
    
    // For all other commands, send to the existing command processing system
    if (pythonProcess && pythonProcess.stdin) {
        console.log('Sending speech input to Python backend:', cleanedText);
        
        const message = JSON.stringify({
            text: cleanedText,
            source: 'speech'
        }) + '\n';
        
        safePythonWrite(message);
        
        // Also update the UI to show the message
        if (mainWindow) {
            mainWindow.webContents.send('speech-message', {
                text: cleanedText,
                final: true
            });
        }
    } else {
        console.error('Python process not available for speech input');
        
        // Fallback to renderer if Python process is not available
        if (mainWindow) {
            console.log('Sending speech input to renderer (fallback):', cleanedText);
            mainWindow.webContents.send('message', {
                type: 'user',
                content: cleanedText,
                source: 'speech',
                autoSubmit: true
            });
        }
    }
}

// Function to start speech recognition
function startSpeechRecognition() {
    if (speechProcess) {
        console.log('Speech recognition already running');
        return;
    }

    console.log('Starting speech recognition process...');
    isListening = true;  // Default to listening; mute button toggles off
    
    // Path to the Python executable in the virtual environment
    const pythonPath = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(pythonPath)) {
        console.error('[Speech] venv python not found at', pythonPath, '— skipping start');
        return;
    }
    
    // Path to the speech recognition script (local Whisper for speed + offline)
    const scriptPath = path.join(__dirname, 'speech_components', 'whisper_speech.py');
    
    // Start the process
    speechProcess = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    // Restore persisted mic timing settings after speech process is ready
    setTimeout(() => {
        const saved = loadMicSettings();
        if (saved && speechProcess && speechProcess.stdin) {
            console.log('[MicSettings] Restoring saved mic timing:', JSON.stringify(saved));
            if (saved.silence_timeout != null)
                safeSpeechWrite(JSON.stringify({ command: 'set_silence_timeout', value: saved.silence_timeout }) + '\n');
            if (saved.chunk_trigger != null)
                safeSpeechWrite(JSON.stringify({ command: 'set_chunk_trigger', value: saved.chunk_trigger }) + '\n');
            if (saved.min_chunk != null)
                safeSpeechWrite(JSON.stringify({ command: 'set_min_chunk', value: saved.min_chunk }) + '\n');
            if (saved.voice_cooldown != null)
                safeSpeechWrite(JSON.stringify({ command: 'set_voice_cooldown', value: saved.voice_cooldown }) + '\n');
        }
    }, 2000);
    
    // Handle output with proper line buffering (prevents partial JSON fragments like stray ']')
    let speechLineBuffer = '';
    speechProcess.stdout.on('data', (data) => {
        speechLineBuffer += data.toString();
        
        // Only process complete lines (ending with \n)
        const lastNewline = speechLineBuffer.lastIndexOf('\n');
        if (lastNewline === -1) return; // No complete line yet, keep buffering
        
        const completeData = speechLineBuffer.substring(0, lastNewline);
        speechLineBuffer = speechLineBuffer.substring(lastNewline + 1); // Keep remainder
        
        const lines = completeData.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const jsonData = JSON.parse(line);
                
                // Handle different types of messages
                if (jsonData.text && jsonData.source === 'speech') {
                    // Drop transcriptions when muted
                    if (!isListening) {
                        console.log('Speech input ignored (muted):', jsonData.text.substring(0, 50));
                        continue;
                    }
                    // Drop late-arriving transcriptions after brainstorm stop (cooldown)
                    if (Date.now() < brainstormCooldownUntil) {
                        console.log('Speech input ignored (brainstorm cooldown):', jsonData.text.substring(0, 50));
                        continue;
                    }
                    // Brainstorm mode: accumulate instead of sending
                    if (isRecording) {
                        recordingBuffer.push(jsonData.text);
                        console.log(`Recording buffer (${recordingBuffer.length} segments):`, jsonData.text.substring(0, 60));
                        continue;
                    }
                    // Normal mode: send immediately to LLM
                    handleSpeechInput(jsonData.text);
                } else if (jsonData.type === 'energy_level') {
                    // Forward mic energy level to renderer for live meter
                    if (mainWindow) {
                        mainWindow.webContents.send('mic-energy-level', jsonData);
                    }
                } else if (jsonData.type === 'threshold_updated') {
                    // Forward threshold update confirmation to renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('mic-threshold-updated', jsonData);
                    }
                } else if (jsonData.type === 'gain_updated') {
                    // Forward gain update confirmation to renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('mic-gain-updated', jsonData);
                    }
                } else if (jsonData.type === 'stt_provider_updated') {
                    // Forward STT provider update confirmation to renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('stt-provider-updated', jsonData);
                    }
                } else if (jsonData.type === 'mic_timing_updated') {
                    // Forward mic timing update confirmation to renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('mic-timing-updated', jsonData);
                    }
                } else if (jsonData.status === 'info') {
                    console.log('Speech info:', jsonData.message);
                } else if (jsonData.status === 'error') {
                    console.error('Speech error:', jsonData.message);
                } else if (jsonData.status === 'warning') {
                    console.warn('Speech warning:', jsonData.message);
                }
            } catch (error) {
                // Not JSON or invalid JSON, just log it
                if (line.trim().length > 2) {
                    console.log('Speech non-JSON output:', line);
                }
            }
        }
    });

    speechProcess.stderr.on('data', (data) => {
        console.error('Speech error:', data.toString());
        if (mainWindow) {
            mainWindow.webContents.send('speech-error', {
                message: 'Speech recognition error',
                details: data.toString()
            });
        }
    });

    speechProcess.on('close', (code) => {
        console.log(`Speech process exited with code ${code}`);
        speechProcess = null;
        
        // Auto-restart if closed unexpectedly
        if (code !== 0 && mainWindow && !app.isQuitting) {
            console.log('Restarting speech recognition...');
            // Add a delay to prevent rapid restart cycles
            setTimeout(startSpeechRecognition, 2000);
        }
    });
}

// Function to stop speech recognition
function stopSpeechRecognition() {
    if (speechProcess) {
        console.log('Stopping speech recognition process...');
        
        // Send exit command
        try {
            if (speechProcess.stdin) {
                safeSpeechWrite(JSON.stringify({ command: 'exit' }) + '\n');
            }
            
            // Force kill after a timeout if it doesn't exit cleanly
            setTimeout(() => {
                if (speechProcess) {
                    console.log('Forcing speech recognition process to exit...');
                    speechProcess.kill();
                    speechProcess = null;
                }
            }, 2000);
        } catch (error) {
            console.error('Error stopping speech recognition:', error);
            
            // Force kill
            try {
                speechProcess.kill();
            } catch (e) {
                console.error('Error killing speech recognition process:', e);
            }
            
            speechProcess = null;
        }
    }
}

// Function to notify speech recognition that the system is speaking
function notifySpeakingStart() {
    if (speechProcess && speechProcess.stdin) {
        console.log('Notifying speech recognition that system is speaking');
        try {
            safeSpeechWrite(JSON.stringify({ command: 'speaking_start' }) + '\n');
            isSpeaking = true;
        } catch (error) {
            console.error('Error notifying speech recognition of speaking start:', error);
        }
    }
}

// Function to notify speech recognition that the system has stopped speaking
function notifySpeakingStop() {
    if (speechProcess && speechProcess.stdin) {
        console.log('Notifying speech recognition that system has stopped speaking');
        try {
            safeSpeechWrite(JSON.stringify({ command: 'speaking_stop' }) + '\n');
            isSpeaking = false;
        } catch (error) {
            console.error('Error notifying speech recognition of speaking stop:', error);
        }
    }
}

// Stop speech recognition when the app is about to quit
app.on('before-quit', () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    stopSpeechRecognition();
    
    // Kill entire Python process tree during app quit
    killPythonProcessTree(pythonProcess);
    pythonProcess = null;
});

// Add IPC handlers for speech recognition
ipcMain.handle('start-listening', () => {
    isListening = true;
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'start' }) + '\n');
    }
    return true;
});

ipcMain.handle('stop-listening', () => {
    isListening = false;
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'stop' }) + '\n');
    }
    return true;
});

// Add IPC on handlers for speech recognition (for send method)
ipcMain.on('start-listening', (event) => {
    isListening = true;
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'start' }) + '\n');
        console.log('Start listening command sent to speech process');
    } else {
        console.log('Speech process not available for start-listening');
    }
});

ipcMain.on('stop-listening', (event) => {
    isListening = false;
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'stop' }) + '\n');
        console.log('Stop listening command sent to speech process');
    } else {
        console.log('Speech process not available for stop-listening');
    }
});

// Brainstorm recording mode — accumulate transcriptions, send all at once on stop
let _wasMutedBeforeBrainstorm = false;

ipcMain.on('record-start', (event) => {
    isRecording = true;
    recordingBuffer = [];
    _wasMutedBeforeBrainstorm = !isListening;
    console.log(`Brainstorm recording started — accumulating transcriptions (was muted: ${_wasMutedBeforeBrainstorm})`);
    // Enable no-buffer-limit so speech engine doesn't chunk mid-thought
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_no_buffer_limit', value: true }) + '\n');
    }
    // Ensure mic is active for recording
    if (!isListening) {
        isListening = true;
        if (speechProcess && speechProcess.stdin) {
            safeSpeechWrite(JSON.stringify({ command: 'start' }) + '\n');
        }
    }
});

ipcMain.on('record-stop', (event) => {
    // Keep isRecording=true so the flush transcription lands in recordingBuffer
    const segmentsBefore = recordingBuffer.length;

    // Disable no-buffer-limit — this triggers a flush of remaining audio
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_no_buffer_limit', value: false }) + '\n');
    }

    // Wait briefly for the flush transcription to arrive, then collect everything
    const maxWait = 2500;  // ms
    const checkInterval = 200;
    let waited = 0;

    const collectAndSend = () => {
        // Check if new segments arrived since we sent the flush
        if (waited < maxWait && recordingBuffer.length === segmentsBefore) {
            waited += checkInterval;
            setTimeout(collectAndSend, checkInterval);
            return;
        }

        // Now stop recording and collect
        isRecording = false;
        brainstormCooldownUntil = Date.now() + 2000; // Ignore speech for 2s to prevent duplicates
        // Restore mute state if mic was muted before brainstorm
        if (_wasMutedBeforeBrainstorm) {
            isListening = false;
            console.log('Brainstorm done — restoring muted state');
        }
        const segments = recordingBuffer.length;
        if (segments > 0) {
            const fullTranscript = recordingBuffer.join(' ');
            recordingBuffer = [];
            console.log(`Brainstorm recording stopped — sending ${segments} segments (${fullTranscript.length} chars)`);
            handleSpeechInput(fullTranscript);
        } else {
            recordingBuffer = [];
            console.log('Brainstorm recording stopped — no segments captured');
        }
    };

    // Give the flush a moment to process, then start checking
    setTimeout(collectAndSend, 300);
});

ipcMain.on('set-no-buffer-limit', (event, value) => {
    console.log('Setting no-buffer-limit to:', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_no_buffer_limit', value: !!value }) + '\n');
    }
});

ipcMain.on('set-mic-threshold', (event, value) => {
    console.log('Setting mic threshold to:', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_threshold', value: value }) + '\n');
    }
});

ipcMain.on('get-mic-threshold', (event) => {
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'get_threshold' }) + '\n');
    }
});

ipcMain.on('set-mic-gain', (event, value) => {
    console.log('Setting mic gain to:', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_gain', value: value }) + '\n');
    }
});

ipcMain.on('get-mic-gain', (event) => {
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'get_gain' }) + '\n');
    }
});

ipcMain.on('set-silence-timeout', (event, value) => {
    console.log('Setting silence timeout to:', value);
    saveMicSettings('silence_timeout', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_silence_timeout', value: value }) + '\n');
    }
});

ipcMain.on('set-chunk-trigger', (event, value) => {
    console.log('Setting chunk trigger to:', value);
    saveMicSettings('chunk_trigger', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_chunk_trigger', value: value }) + '\n');
    }
});

ipcMain.on('set-min-chunk', (event, value) => {
    console.log('Setting min chunk to:', value);
    saveMicSettings('min_chunk', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_min_chunk', value: value }) + '\n');
    }
});

ipcMain.on('set-voice-cooldown', (event, value) => {
    console.log('Setting voice cooldown to:', value);
    saveMicSettings('voice_cooldown', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_voice_cooldown', value: value }) + '\n');
    }
});

ipcMain.on('get-mic-timing', (event) => {
    // Send saved settings to UI immediately so sliders reflect persisted values
    const saved = loadMicSettings();
    if (saved && mainWindow) {
        mainWindow.webContents.send('mic-timing-updated', {
            type: 'mic_timing_updated',
            silence_timeout: saved.silence_timeout || 2.0,
            chunk_trigger: saved.chunk_trigger || 6.0,
            min_chunk: saved.min_chunk || 0.5,
            voice_cooldown: saved.voice_cooldown || 1.0
        });
    }
    // Also request live values from speech process
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'get_mic_timing' }) + '\n');
    }
});

ipcMain.on('set-stt-provider', (event, value) => {
    console.log('Setting STT provider to:', value);
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'set_stt_provider', value: value }) + '\n');
    }
});

ipcMain.on('get-stt-provider', (event) => {
    if (speechProcess && speechProcess.stdin) {
        safeSpeechWrite(JSON.stringify({ command: 'get_stt_provider' }) + '\n');
    }
});

ipcMain.handle('speaking-start', () => {
    notifySpeakingStart();
    return true;
});

ipcMain.handle('speaking-stop', () => {
    notifySpeakingStop();
    return true;
});

app.on('window-all-closed', () => {
    killPythonProcessTree(pythonProcess);
    pythonProcess = null;
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

const processedImageMessages = new Set();

// Duplicate requestConfig and save-config handlers removed - using primary handlers above

// Handler for requesting installed models from Ollama
ipcMain.on('request-installed-models', (event) => {
    console.log('Request for installed models received');
    
    if (pythonProcess && pythonProcess.stdin) {
        // Send a command to get installed models
        safePythonWrite(JSON.stringify({
            text: '/models list'
        }) + '\n');
        console.log('Models list request sent to Python backend');
        
        // Set up a one-time listener for the models response
        const modelsListener = (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                if (message.type === 'models' && message.content && Array.isArray(message.content.installed)) {
                    console.log('Received models list from Python backend:', message.content.installed);
                    
                    // Send the installed models to the renderer
                    event.sender.send('installed-models-response', message.content.installed);
                    
                    // Remove this listener after processing
                    pythonProcess.stdout.removeListener('data', modelsListener);
                }
            } catch (error) {
                console.error('Error parsing models response:', error);
            }
        };
        
        // Add the temporary listener
        pythonProcess.stdout.on('data', modelsListener);
        
        // Set a timeout to remove the listener if no response is received
        setTimeout(() => {
            pythonProcess.stdout.removeListener('data', modelsListener);
            
            // If we didn't get a response, use the Ollama API directly as fallback
            const http = require('http');
            const options = {
                hostname: 'localhost',
                port: 11434,
                path: '/api/tags',
                method: 'GET'
            };
            
            const req = http.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        const installedModels = response.models.map(model => model.name);
                        console.log('Received models directly from Ollama API:', installedModels);
                        event.sender.send('installed-models-response', installedModels);
                    } catch (error) {
                        console.error('Error parsing Ollama API response:', error);
                        // Send a default list as last resort
                        event.sender.send('installed-models-response', [
                            'llama3.2-vision:11b',
                            'dolphin-mixtral:latest',
                            'qwen2.5-coder:14b',
                            'llama4:16x17b'
                        ]);
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('Error fetching models from Ollama API:', error);
                // Send a default list as last resort
                event.sender.send('installed-models-response', [
                    'llama3.2-vision:11b',
                    'dolphin-mixtral:latest',
                    'qwen2.5-coder:14b',
                    'llama4:16x17b'
                ]);
            });
            
            req.end();
        }, 3000);
    } else {
        console.error('Python process not available when requesting models');
        // Send a default list as last resort
        event.sender.send('installed-models-response', [
            'llama3.2-vision:11b',
            'dolphin-mixtral:latest',
            'qwen2.5-coder:14b',
            'llama4:16x17b'
        ]);
    }
});
