const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api', {
        send: (channel, data) => {
            // Whitelist outgoing channels
            const validSendChannels = [
                'terminal-input', 'config-request', 'config-update', 
                'profile-create', 'profile-switch', 'profile-delete', 
                'profile-list', 'update-voice-settings', 'update-perplexity-settings',
                'execute-action', 'quit-app', 'save-config', 'command', 'speak', 'requestConfig', 'open-profile-manager', 'message', 'config', 'debug-config', 'config-panel-request',
                'open-external-link', 'start-listening', 'stop-listening', 'record-start', 'record-stop', 'minimize-to-tray', 'show-window',
                'set-mic-threshold', 'get-mic-threshold', 'set-mic-gain', 'get-mic-gain',
                'set-stt-provider', 'get-stt-provider',
                'set-silence-timeout', 'set-chunk-trigger', 'set-min-chunk', 'set-voice-cooldown', 'get-mic-timing'
            ];
            if (validSendChannels.includes(channel)) {
                console.log(`Sending message through channel: ${channel}`);
                ipcRenderer.send(channel, data);
            }
        },
        invoke: (channel, data) => {
            // Whitelist channels for invoke
            const validInvokeChannels = [
                'start-listening', 'stop-listening', 'speaking-start', 'speaking-stop'
            ];
            if (validInvokeChannels.includes(channel)) {
                console.log(`Invoking IPC handler for channel: ${channel}`);
                return ipcRenderer.invoke(channel, data);
            }
            return Promise.reject(new Error(`Unauthorized IPC invoke to channel "${channel}"`));
        },
        receive: (channel, func) => {
            // Whitelist incoming channels
            const validReceiveChannels = [
                'terminal-output', 'python-message', 'python-stream', 
                'config-response', 'profile-response', 'voice-settings-updated',
                'perplexity-settings-updated',
                'error', 'config-update', 'profile-manager-message', 'voice-status', 'debug-config-update', 'config-panel-update',
                'mic-energy-level', 'mic-threshold-updated', 'mic-gain-updated', 'speech-message',
                'stt-provider-updated', 'mic-timing-updated',
                'avatar-emotions'
            ];
            if (validReceiveChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender` 
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        },
        handleVoiceStatus: (status) => {
            console.log(`Handling voice status in preload: ${status}`);
            // Forward to window
            window.postMessage({
                type: 'voice',
                status: status
            }, '*');
            
            // Also try to call the handler directly if it exists
            if (window.handleVoiceStatusMessage) {
                console.log('Calling window.handleVoiceStatusMessage directly');
                window.handleVoiceStatusMessage(status);
            }
        }
    }
);

// Expose updateConfigPanel to renderer
contextBridge.exposeInMainWorld(
    'electron',
    {
        ...contextBridge.exposeInMainWorld.arguments[1],
        updateConfigPanel: (config) => {
            console.log("updateConfigPanel called with config:", config);
            if (!config) {
                console.log("No config provided to updateConfigPanel");
                return;
            }
            
            // List all possible IDs that might exist in the config panel
            // This ensures compatibility with both TP 110 and TP 120
            const possibleIds = {
                'model': ['model-input', 'model', 'modelInput', 'model_input'],
                'api_endpoint': ['api-endpoint-input', 'api_endpoint', 'apiEndpoint', 'endpoint'],
                'system_prompt': ['system-prompt-input', 'systemPrompt', 'system_prompt'],
                'screenshot_prompt': ['screenshot-prompt-input', 'screenshotPrompt', 'screenshot_prompt'],
                'general_note': ['general-note-prompt-input', 'generalNotePrompt', 'general_note_prompt'],
                'autonomous_note': ['autonomous-note-prompt-input', 'autonomousNotePrompt', 'autonomous_note_prompt']
            };
            
            // Enhanced update function that tries multiple possible IDs
            const updateElement = (idKey, value) => {
                if (value === undefined) return false;
                
                const ids = possibleIds[idKey] || [idKey];
                let found = false;
                for (const id of ids) {
                    const element = document.getElementById(id);
                    if (element) {
                        // Store previous value for critical fields to detect changes
                        const prevValue = element.type === 'checkbox' ? element.checked : element.value;
                        
                        // Update the element value
                        if (element.type === 'checkbox') {
                            element.checked = !!value;
                        } else {
                            element.value = value || '';
                        }
                        
                        // For critical fields like model and API endpoint, trigger a change event
                        // to ensure any listeners are notified of the change
                        if ((id === 'model-input' || id === 'api-endpoint-input') && 
                            prevValue !== (element.type === 'checkbox' ? element.checked : element.value)) {
                            console.log(`Critical field ${id} updated from '${prevValue}' to '${element.value}', triggering change event`);
                            const event = new Event('change', { bubbles: true });
                            element.dispatchEvent(event);
                        }
                        
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    console.log(`Could not find element for ${idKey} with value ${value}`);
                }
                
                return found;
            };

            // Log all input elements on the page to help debugging
            console.log('All input elements in document:');
            document.querySelectorAll('input, textarea').forEach(el => {
                console.log(`Element: ${el.tagName} ID: ${el.id || '(no id)'} Name: ${el.name || '(no name)'} Type: ${el.type || 'unknown'}`);
            });

            // Try updating basic elements with various possible IDs
            let success = false;
            success = updateElement('model', config.model) || success;
            success = updateElement('api_endpoint', config.api_endpoint) || success;
            success = updateElement('system_prompt', config.system_prompt) || success;
            success = updateElement('screenshot_prompt', config.screenshot_prompt) || success;
            
            // Update note prompts
            if (config.note_prompts) {
                success = updateElement('general_note', config.note_prompts.general_note) || success;
                success = updateElement('autonomous_note', config.note_prompts.autonomous) || success;
            }
            
            // Update autonomous settings
            if (config.autonomy) {
                if (config.autonomy.notes) {
                    const noteEnabled = document.getElementById('notes-enabled');
                    if (noteEnabled) {
                        noteEnabled.checked = config.autonomy.notes.enabled;
                        success = true;
                    }
                    success = updateElement('notes-min-interval', config.autonomy.notes.min_interval) || success;
                    success = updateElement('notes-max-interval', config.autonomy.notes.max_interval) || success;
                }
                
                if (config.autonomy.screenshot) {
                    const screenshotEnabled = document.getElementById('screenshot-enabled');
                    if (screenshotEnabled) {
                        screenshotEnabled.checked = config.autonomy.screenshot.enabled;
                        success = true;
                    }
                    success = updateElement('screenshot-min-interval', config.autonomy.screenshot.min_interval) || success;
                    success = updateElement('screenshot-max-interval', config.autonomy.screenshot.max_interval) || success;
                    success = updateElement('screenshot-prompt-autonomy', config.autonomy.screenshot.prompt) || success;
                }

                if (config.autonomy.messages) {
                    const messageEnabled = document.getElementById('messages-enabled');
                    if (messageEnabled) {
                        messageEnabled.checked = config.autonomy.messages.enabled;
                        success = true;
                    }
                    success = updateElement('messages-min-interval', config.autonomy.messages.min_interval) || success;
                    success = updateElement('messages-max-interval', config.autonomy.messages.max_interval) || success;
                    success = updateElement('messages-prompt', config.autonomy.messages.prompt) || success;
                }
                
                if (config.autonomy.midjourney) {
                    const midjourneyEnabled = document.getElementById('midjourney-enabled');
                    if (midjourneyEnabled) {
                        midjourneyEnabled.checked = config.autonomy.midjourney.enabled;
                        success = true;
                    }
                    success = updateElement('midjourney-min-interval', config.autonomy.midjourney.min_interval) || success;
                    success = updateElement('midjourney-max-interval', config.autonomy.midjourney.max_interval) || success;
                    success = updateElement('midjourney-prompt', config.autonomy.midjourney.prompt) || success;
                    success = updateElement('midjourney-system-prompt', config.autonomy.midjourney.system_prompt) || success;
                }
            }
            
            // If nothing was updated successfully, try alternate IDs
            if (!success) {
                console.log("No elements were updated successfully, trying alternate IDs");
                
                // Try with different ID patterns
                const alternateElementIds = [
                    {original: 'model-input', alternates: ['model', 'modelInput']},
                    {original: 'api-endpoint-input', alternates: ['api_endpoint', 'apiEndpoint']},
                    {original: 'system-prompt-input', alternates: ['systemPrompt', 'system_prompt']},
                    {original: 'screenshot-prompt-input', alternates: ['screenshotPrompt', 'screenshot_prompt']}
                ];
                
                alternateElementIds.forEach(item => {
                    const value = config[item.original.replace(/-/g, '_').replace('-input', '')];
                    if (value !== undefined) {
                        item.alternates.forEach(altId => {
                            updateElement(altId, value);
                        });
                    }
                });
                
                // Log all input elements to help diagnose
                console.log("Listing all input/textarea elements:");
                document.querySelectorAll('input, textarea').forEach(el => {
                    if (el.id) {
                        console.log(`Element ID: ${el.id}, Type: ${el.type}`);
                    }
                });
            }
            
            console.log('Config panel update complete. Success: ' + success);
        }
    }
);

// Listen for the request-initial-config event from main process
ipcRenderer.on('request-initial-config', () => {
    // Send the config request through IPC
    ipcRenderer.send('requestConfig');
});

// Listen for config updates from main process
ipcRenderer.on('config-update', (event, payload = {}) => {
    const { remote_key_status: remoteKeyStatus, ...config } = payload || {};
    if (!config) {
        console.error('CRITICAL ERROR: Received empty config object');
        return;
    }
    console.log('***DEBUG-RENDERER*** Received config update in preload.js:', JSON.stringify(config, null, 2));
    console.log('***DEBUG-RENDERER*** Config autonomy exists:', !!config.autonomy);
    console.log('***DEBUG-RENDERER*** Config autonomous exists:', !!config.autonomous);
    
    // Stash latest config in window for downstream listeners
    window.currentConfig = config;
    window.latestRemoteKeyStatus = remoteKeyStatus || window.latestRemoteKeyStatus || {};

    // Attempt to update the electron.updateConfigPanel function
    if (window.electron && window.electron.updateConfigPanel) {
        console.log('***DEBUG-RENDERER*** Calling window.electron.updateConfigPanel');
        try {
            window.electron.updateConfigPanel(config);
            console.log('***DEBUG-RENDERER*** Called updateConfigPanel successfully');
        } catch (error) {
            console.error('***DEBUG-RENDERER*** Error in updateConfigPanel:', error);
        }
    } else {
        console.error('***DEBUG-RENDERER*** electron.updateConfigPanel not available');
    }

    if (config.remote_api_keys) {
        const grokInput = document.getElementById('xai-api-key-input');
        if (grokInput) {
            grokInput.value = config.remote_api_keys.xai_api_key || '';
        }
        const claudeInput = document.getElementById('anthropic-api-key-input');
        if (claudeInput) {
            claudeInput.value = config.remote_api_keys.anthropic_api_key || '';
        }
    }
    
    // DEBUG: Log all elements we're looking for to see if they exist
    console.log("CONFIG PANEL DEBUG - Checking for elements:");
    console.log("model-input exists:", !!document.getElementById('model-input'));
    console.log("api-endpoint-input exists:", !!document.getElementById('api-endpoint-input'));
    console.log("system-prompt-input exists:", !!document.getElementById('system-prompt-input'));
    console.log("screenshot-prompt-input exists:", !!document.getElementById('screenshot-prompt-input'));
    console.log("message-enabled exists:", !!document.getElementById('messages-enabled'));
    
    // Also check if our config panel container exists
    console.log("Config panel container elements check:");
    console.log("Elements with 'config' in ID:", document.querySelectorAll('[id*="config"]').length);
    console.log("Elements with 'settings' in ID:", document.querySelectorAll('[id*="settings"]').length);
    console.log("Elements with 'panel' in ID:", document.querySelectorAll('[id*="panel"]').length);
    
    const updateElement = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
            console.log(`Updated ${id} to:`, value);
        } else {
            console.log(`Element ${id} not found!`);
        }
    };

    // Update the UI elements
    // Special handling for model-input as it's now a dropdown
    const modelInput = document.getElementById('model-input');
    if (modelInput && modelInput.tagName === 'SELECT') {
        // Request installed models from backend
        ipcRenderer.send('request-installed-models');
        
        // If we have a current model value, we'll select it after populating
        const currentModel = config.model;
        
        // Store the current model for later use
        modelInput.dataset.currentModel = currentModel;
    } else {
        // Fallback to old behavior if it's still a text input
        updateElement('model-input', config.model);
    }
    
    updateElement('api-endpoint-input', config.api_endpoint);
    updateElement('system-prompt-input', config.system_prompt);
    updateElement('screenshot-prompt-input', config.screenshot_prompt);
    
    // Update note prompts
    if (config.note_prompts) {
        updateElement('general-note-prompt-input', config.note_prompts.general_note);
        updateElement('autonomous-note-prompt-input', config.note_prompts.autonomous);
    }
    
    // Update autonomous settings
    if (config.autonomy) {
        if (config.autonomy.notes) {
            const noteEnabled = document.getElementById('notes-enabled');
            if (noteEnabled) noteEnabled.checked = config.autonomy.notes.enabled;
            updateElement('notes-min-interval', config.autonomy.notes.min_interval);
            updateElement('notes-max-interval', config.autonomy.notes.max_interval);
        }
        
        if (config.autonomy.screenshot) {
            const screenshotEnabled = document.getElementById('screenshot-enabled');
            if (screenshotEnabled) screenshotEnabled.checked = config.autonomy.screenshot.enabled;
            updateElement('screenshot-min-interval', config.autonomy.screenshot.min_interval);
            updateElement('screenshot-max-interval', config.autonomy.screenshot.max_interval);
            updateElement('screenshot-prompt-autonomy', config.autonomy.screenshot.prompt);
        }

        if (config.autonomy.messages) {
            const messageEnabled = document.getElementById('messages-enabled');
            if (messageEnabled) messageEnabled.checked = config.autonomy.messages.enabled;
            updateElement('messages-min-interval', config.autonomy.messages.min_interval);
            updateElement('messages-max-interval', config.autonomy.messages.max_interval);
            updateElement('messages-prompt', config.autonomy.messages.prompt);
        }
        
        if (config.autonomy.midjourney) {
            console.log('Preload.js: Midjourney config received:', config.autonomy.midjourney);
            const midjourneyEnabled = document.getElementById('midjourney-enabled');
            if (midjourneyEnabled) midjourneyEnabled.checked = config.autonomy.midjourney.enabled;
            updateElement('midjourney-min-interval', config.autonomy.midjourney.min_interval);
            updateElement('midjourney-max-interval', config.autonomy.midjourney.max_interval);
            updateElement('midjourney-prompt', config.autonomy.midjourney.prompt);
            updateElement('midjourney-system-prompt', config.autonomy.midjourney.system_prompt);
        }
    }
    
    console.log('Config panel updated with:', config);
});

// Listen for the update-config-panel event from main process
ipcRenderer.on('update-config-panel', (event, config) => {
    if (!config) return;
    console.log('Received update-config-panel event in preload.js:', config);
    
    const updateElement = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.value = value || '';
    };

    // Update the UI elements
    if (config.autonomy) {
        if (config.autonomy.messages) {
            const messageEnabled = document.getElementById('message-enabled');
            if (messageEnabled) messageEnabled.checked = config.autonomy.messages.enabled;
            updateElement('message-min-interval', config.autonomy.messages.min_interval);
            updateElement('message-max-interval', config.autonomy.messages.max_interval);
            updateElement('message-prompt', config.autonomy.messages.prompt);
        }
        
        if (config.autonomy.midjourney) {
            console.log('Preload.js (update-config-panel): Midjourney config received:', config.autonomy.midjourney);
            const midjourneyEnabled = document.getElementById('midjourney-enabled');
            if (midjourneyEnabled) midjourneyEnabled.checked = config.autonomy.midjourney.enabled;
            updateElement('midjourney-min-interval', config.autonomy.midjourney.min_interval);
            updateElement('midjourney-max-interval', config.autonomy.midjourney.max_interval);
            updateElement('midjourney-prompt', config.autonomy.midjourney.prompt);
            updateElement('midjourney-system-prompt', config.autonomy.midjourney.system_prompt);
        }
    }
    
    console.log('Config panel updated with (update-config-panel):', config);
});

// Listen for avatar emotion schedules (dedicated channel)
ipcRenderer.on('avatar-emotions', (event, message) => {
    console.log('[EMOTION] Received avatar-emotions in preload:', message);
    window.postMessage(message, '*');
});

// Special handler for voice status messages
ipcRenderer.on('voice-status', (event, status) => {
    console.log('Received voice-status in preload.js:', status);
    
    // Forward to window
    window.postMessage({
        type: 'voice',
        status: status
    }, '*');
    
    // Also try to call the handler directly if it exists
    if (window.handleVoiceStatusMessage) {
        console.log('Calling window.handleVoiceStatusMessage directly from voice-status event');
        window.handleVoiceStatusMessage(status);
    }
});

// Listen for profile manager messages from main process
ipcRenderer.on('profile-manager-message', (event, message) => {
    console.log('Received profile manager message:', message);
});

// Listen for installed models response
ipcRenderer.on('installed-models-response', (event, models) => {
    console.log('Received installed models:', models);
    
    // Find the model dropdown
    const modelDropdown = document.getElementById('model-input');
    if (modelDropdown && modelDropdown.tagName === 'SELECT') {
        // Clear existing options
        modelDropdown.innerHTML = '';
        
        // Get the current model from dataset
        const currentModel = modelDropdown.dataset.currentModel;
        
        // Add options for each installed model
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            
            // Select the current model if it matches
            if (model === currentModel) {
                option.selected = true;
            }
            
            modelDropdown.appendChild(option);
        });
        
        // If we have options but none were selected (current model not in list)
        // select the first option
        if (modelDropdown.options.length > 0 && !Array.from(modelDropdown.options).some(opt => opt.selected)) {
            modelDropdown.options[0].selected = true;
            
            // Trigger a change event to save the new selection
            const event = new Event('change');
            modelDropdown.dispatchEvent(event);
        }
    }
});

// Listen for config updates from main process
contextBridge.on('config-update', (config) => {
    console.log('Received config update from main process', config);
    
    // Log the model value specifically for debugging
    if (config && config.model) {
        console.log(`Config update includes model: ${config.model}`);
    }
    
    if (window.electron && window.electron.updateConfigPanel) {
        window.electron.updateConfigPanel(config);
        
        // After updating the config panel, check if the model input was updated
        setTimeout(() => {
            const modelInput = document.getElementById('model-input');
            if (modelInput) {
                console.log(`Model input value after update: ${modelInput.value}`);
                
                // If window.setupAutoSaveListeners exists, call it to ensure listeners are attached
                if (window.setupAutoSaveListeners) {
                    console.log('Setting up auto-save listeners after config update');
                    window.setupAutoSaveListeners();
                }
            }
        }, 100);
    }
});

// Listen for debug-config-update event from main process
ipcRenderer.on('debug-config-update', (event, config) => {
    console.log('Received debug-config-update event in preload.js:', config);
    window.postMessage({
        type: 'debug-config',
        config: config
    }, '*');
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    const openProfileManagerButton = document.getElementById('openProfileManagerButton');
    if (openProfileManagerButton) {
        console.log('Found profile manager button');
        openProfileManagerButton.addEventListener('click', () => {
            console.log('Profile Manager Button Clicked');
            window.api.send('open-profile-manager');
        });
    } else {
        console.log('Profile manager button not found');
    }
    const plusButton = document.getElementById('+');
    if (plusButton) {
        plusButton.addEventListener('click', () => {
            ipcRenderer.send('open-profile-manager');
        });
    }
});
