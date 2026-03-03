// Direct Config Loader
// This script directly loads custom_settings.json and applies it to the config panel
// without relying on the backend or IPC
// It also automatically saves changes when inputs change, eliminating the need for save buttons

(function() {
    console.log("Direct Config Loader initializing...");
    
    // Function to load config directly from file using fetch
    async function loadDirectConfig() {
        try {
            console.log("Attempting to load custom_settings.json directly...");
            const response = await fetch('custom_settings.json');
            if (!response.ok) {
                console.error("Failed to load custom_settings.json:", response.status);
                return null;
            }
            
            const config = await response.json();
            console.log("Successfully loaded custom_settings.json:", config);
            return config;
        } catch (error) {
            console.error("Error loading custom_settings.json:", error);
            return null;
        }
    }
    
    // Function to manually update config panel with loaded config
    function updateConfigPanelDirectly(config) {
        if (!config) {
            console.error("No config provided to updateConfigPanelDirectly");
            return;
        }
        
        console.log("Directly updating config panel with:", config);
        
        // Update basic fields
        updateElement('model-input', config.model);
        updateElement('api-endpoint-input', config.api_endpoint);
        updateElement('system-prompt-input', config.system_prompt);
        updateElement('screenshot-prompt-input', config.screenshot_prompt);
        
        // Update note prompts
        if (config.note_prompts) {
            updateElement('general-note-prompt-input', config.note_prompts.general_note);
            updateElement('autonomous-note-prompt-input', config.note_prompts.autonomous);
        }
        
        // Update autonomy settings
        if (config.autonomy) {
            // Notes
            if (config.autonomy.notes) {
                updateCheckbox('notes-enabled', config.autonomy.notes.enabled);
                updateElement('notes-min-interval', config.autonomy.notes.min_interval);
                updateElement('notes-max-interval', config.autonomy.notes.max_interval);
            }
            
            // Screenshot
            if (config.autonomy.screenshot) {
                updateCheckbox('screenshot-enabled', config.autonomy.screenshot.enabled);
                updateElement('screenshot-min-interval', config.autonomy.screenshot.min_interval);
                updateElement('screenshot-max-interval', config.autonomy.screenshot.max_interval);
            }
            
            // Messages
            if (config.autonomy.messages) {
                updateCheckbox('messages-enabled', config.autonomy.messages.enabled);
                updateElement('messages-min-interval', config.autonomy.messages.min_interval);
                updateElement('messages-max-interval', config.autonomy.messages.max_interval);
                updateElement('messages-prompt', config.autonomy.messages.prompt);
            }
            
            // Midjourney
            if (config.autonomy.midjourney) {
                updateCheckbox('midjourney-enabled', config.autonomy.midjourney.enabled);
                updateElement('midjourney-min-interval', config.autonomy.midjourney.min_interval);
                updateElement('midjourney-max-interval', config.autonomy.midjourney.max_interval);
                updateElement('midjourney-prompt', config.autonomy.midjourney.prompt);
                updateElement('midjourney-system-prompt', config.autonomy.midjourney.system_prompt);
            }
        }
        
        // Update voice settings if present
        if (config.voice_settings) {
            console.log("Updating voice settings:", config.voice_settings);
            updateCheckbox('voice-enabled', config.voice_settings.enabled);
            updateElement('voice-preset', config.voice_settings.voice);
            updateElement('speaking-rate', config.voice_settings.speed);
            updateElement('voice-pitch', config.voice_settings.pitch);
            updateElement('voice-temperature', config.voice_settings.temperature);
            updateElement('voice-top-p', config.voice_settings.top_p);
            updateCheckbox('enhance-speech', config.voice_settings.enhance_speech);
            updateCheckbox('use-elevenlabs-tts', config.voice_settings.use_elevenlabs_tts);
        }
        
        console.log("Config panel updated directly");
    }
    
    // Helper functions to update elements
    function updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
            console.log(`Updated ${id} with value: ${value ? (value.length > 20 ? value.substring(0, 20) + '...' : value) : 'empty'}`);
        } else {
            console.warn(`Element not found: ${id}`);
        }
    }
    
    function updateCheckbox(id, checked) {
        const element = document.getElementById(id);
        if (element) {
            element.checked = !!checked;
            console.log(`Updated checkbox ${id} to: ${!!checked}`);
        } else {
            console.warn(`Checkbox not found: ${id}`);
        }
    }
    
    // Function to automatically save changes when inputs change
    function setupAutoSave() {
        console.log("Setting up auto-save functionality");
        
        // Get all input elements in the config panel
        const configPanel = document.getElementById('config-panel');
        if (!configPanel) return;
        
        // Add event listeners to all inputs, textareas, and checkboxes
        const inputs = configPanel.querySelectorAll('input[type="text"], input[type="number"], textarea');
        inputs.forEach(input => {
            input.addEventListener('change', function() {
                console.log(`Input changed: ${input.id}`);
                window.saveConfig(); // Use the existing save function
            });
            
            // Also save on blur for text inputs and textareas
            input.addEventListener('blur', function() {
                console.log(`Input blur: ${input.id}`);
                window.saveConfig();
            });
        });
        
        // Add listeners to checkboxes
        const checkboxes = configPanel.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                console.log(`Checkbox changed: ${checkbox.id} to ${checkbox.checked}`);
                window.saveConfig();
            });
        });
        
        console.log("Auto-save functionality set up");
    }
    
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', async function() {
        console.log("Direct Config Loader: DOM ready");
        
        // Listen for config panel opening
        const configButton = document.getElementById('config-button');
        if (configButton) {
            configButton.addEventListener('click', async function() {
                console.log("Config button clicked - loading config directly");
                setTimeout(async function() {
                    const config = await loadDirectConfig();
                    if (config) {
                        updateConfigPanelDirectly(config);
                        setupAutoSave(); // Set up auto-save after loading config
                    }
                }, 500); // Small delay to ensure panel is open
            });
        }
        
        // Automatically load config when the page loads
        setTimeout(async function() {
            const config = await loadDirectConfig();
            if (config) {
                updateConfigPanelDirectly(config);
                setupAutoSave(); // Set up auto-save after loading config
            }
        }, 2000); // Wait for everything to initialize
    });
})();
