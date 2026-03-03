// Auto-save configuration when input fields lose focus
window.setupAutoSaveListeners = function() {
    console.log('Setting up auto-save listeners for config inputs');
    
    // Get all input and textarea elements that might be config inputs
    // Target multiple possible containers to ensure we catch all config inputs
    const configInputs = document.querySelectorAll('#config-panel input, #config-panel textarea, #config-panel select, ' +
        '.config-section input, .config-section textarea, .config-section select, ' +
        '.config-row input, .config-row textarea, .config-row select, ' +
        '.config-container input, .config-container textarea, .config-container select, ' +
        '#note-prompts-container input, #note-prompts-container textarea, #note-prompts-container select, ' +
        'input[id$="-input"], textarea[id$="-input"], select[id$="-input"], ' +
        'input[id*="note"], textarea[id*="note"], select[id*="note"], ' +
        '#system-prompt, #screenshot-prompt, #message-prompt, #midjourney-prompt, #midjourney-system-prompt');
    
    console.log(`Found ${configInputs.length} potential config inputs`);
    
    // Function to save the current configuration
    const saveCurrentConfig = (event) => {
        console.log(`Input changed: ${event.target.id || 'unnamed input'}`);

        if (!window.saveConfig || typeof window.saveConfig !== 'function') {
            console.warn('window.saveConfig is not available; cannot auto-save');
            return;
        }

        // Delegate to the shared save logic so all fields (including API keys) are captured
        try {
            window.saveConfig();
        } catch (err) {
            console.error('Auto-save failed:', err);
        }
    };
    
    // Log all found inputs with their details
    console.log('Detailed list of all found config inputs:');
    configInputs.forEach((input, index) => {
        console.log(`[${index}] ID: ${input.id || 'no-id'}, Type: ${input.type || input.tagName}, Class: ${input.className}, Value: ${input.value?.substring(0, 20)}${input.value?.length > 20 ? '...' : ''}`);
    });
    
    // Add blur event listeners to all config inputs
    configInputs.forEach(input => {
        // Remove any existing listeners to prevent duplicates
        input.removeEventListener('blur', saveCurrentConfig);
        input.removeEventListener('change', saveCurrentConfig);
        input.removeEventListener('input', saveCurrentConfig);
        
        // Add new listeners - use multiple event types for better coverage
        input.addEventListener('blur', saveCurrentConfig);
        
        // For checkboxes and selects, also listen for change events
        if (input.type === 'checkbox' || input.tagName === 'SELECT') {
            input.addEventListener('change', saveCurrentConfig);
        }
        
        // For textareas, also listen for input events with debounce
        if (input.tagName === 'TEXTAREA') {
            // Use input event with debounce for textareas
            let debounceTimer;
            input.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    console.log(`Debounced input event for ${e.target.id || 'unnamed textarea'}`);
                    saveCurrentConfig(e);
                }, 1000); // 1 second debounce
            });
        }
        
        console.log(`Added auto-save listener to ${input.id || 'unnamed input'}`);
    });
    
    console.log(`Auto-save listeners set up for ${configInputs.length} inputs`);
};

// Call the setup function when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM content loaded, setting up auto-save listeners');
    if (window.setupAutoSaveListeners) {
        window.setupAutoSaveListeners();
    }
});

// Also set up listeners when the config panel is updated
window.addEventListener('config-panel-updated', () => {
    console.log('Config panel updated, setting up auto-save listeners');
    if (window.setupAutoSaveListeners) {
        window.setupAutoSaveListeners();
    }
});

// Add a manual trigger function that can be called from the console for debugging
window.triggerAutoSaveSetup = function() {
    console.log('Manually triggering auto-save setup');
    if (window.setupAutoSaveListeners) {
        window.setupAutoSaveListeners();
    }
};

// Set up a mutation observer to detect when new config inputs are added to the DOM
window.setupConfigObserver = function() {
    console.log('Setting up config observer');
    const observer = new MutationObserver((mutations) => {
        let shouldSetupListeners = false;
        
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if any added nodes are config inputs or contain config inputs
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const hasConfigInputs = node.querySelector('input, textarea, select') || 
                                             node.tagName === 'INPUT' || 
                                             node.tagName === 'TEXTAREA' || 
                                             node.tagName === 'SELECT';
                        
                        if (hasConfigInputs) {
                            shouldSetupListeners = true;
                        }
                    }
                });
            }
        });
        
        if (shouldSetupListeners) {
            console.log('Config inputs detected in DOM changes, setting up listeners');
            if (window.setupAutoSaveListeners) {
                window.setupAutoSaveListeners();
            }
        }
    });
    
    // Start observing the document with the configured parameters
    observer.observe(document.body, { childList: true, subtree: true });
    
    return observer;
};

// Start the observer when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    window.setupConfigObserver();
});
