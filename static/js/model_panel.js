// Model Management Panel JavaScript
class ModelManager {
    constructor() {
        this.models = {
            featured: [],
            installed: [],
            available: [],
            remote: []
        };
        this.currentModel = '';
        this.operations = {};
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Open model management panel
        document.getElementById('model-management-button')?.addEventListener('click', () => this.openModelPanel());
        
        // Close model management panel
        document.getElementById('model-panel-close')?.addEventListener('click', () => this.closeModelPanel());
        
        // Close model details modal
        document.querySelector('.modal-close')?.addEventListener('click', () => this.closeModelModal());
        
        // Modal action buttons
        document.getElementById('modal-install-button')?.addEventListener('click', () => this.installSelectedModel());
        document.getElementById('modal-remove-button')?.addEventListener('click', () => this.removeSelectedModel());
        document.getElementById('modal-select-button')?.addEventListener('click', () => this.selectModelForUse());
    }

    openModelPanel() {
        const panel = document.getElementById('model-management-panel');
        if (panel) {
            panel.style.display = 'flex';
            this.loadModels();
        }
    }

    closeModelPanel() {
        const panel = document.getElementById('model-management-panel');
        if (panel) {
            panel.style.display = 'none';
        }
    }

    loadModels() {
        // Show loading indicators
        document.getElementById('featured-models-container').innerHTML = '<div class="loading-indicator">Loading models...</div>';
        document.getElementById('installed-models-container').innerHTML = '<div class="loading-indicator">Loading models...</div>';
        document.getElementById('available-models-container').innerHTML = '<div class="loading-indicator">Loading models...</div>';
        
        // Request models from backend
        window.api.send('model-manager', { action: 'refresh-models' });
        
        // Set up listener for model data
        window.api.receive('model-manager-response', (data) => {
            if (data.action === 'models-refreshed') {
                this.models = {
                    featured: data.models.featured || [],
                    installed: data.models.installed || [],
                    available: data.models.available || [],
                    remote: data.models.remote || []
                };
                this.currentModel = data.currentModel || '';
                this.renderModels();
            } else if (data.action === 'operation-update') {
                this.updateOperationProgress(data);
            }
        });
    }

    renderModels() {
        this.renderFeaturedModels();
        this.renderInstalledModels();
        this.renderRemoteModels();
        this.renderAvailableModels();
    }

    renderFeaturedModels() {
        const container = document.getElementById('featured-models-container');
        if (!container) return;
        
        if (this.models.featured && this.models.featured.length > 0) {
            container.innerHTML = '';
            this.models.featured.forEach(model => {
                container.appendChild(this.createModelCard(model, 'featured'));
            });
        } else {
            container.innerHTML = '<div class="empty-message">No featured models available</div>';
        }
    }

    renderInstalledModels() {
        const container = document.getElementById('installed-models-container');
        if (!container) return;
        
        if (this.models.installed && this.models.installed.length > 0) {
            container.innerHTML = '';
            this.models.installed.forEach(model => {
                if (!this.isModelInFeatured(model)) {
                    container.appendChild(this.createModelCard(model, 'installed'));
                }
            });
        } else {
            container.innerHTML = '<div class="empty-message">No models installed</div>';
        }
    }

    renderRemoteModels() {
        const container = document.getElementById('remote-models-container');
        if (!container) return;

        const remoteModels = this.models.remote || [];
        if (remoteModels.length > 0) {
            container.innerHTML = '';
            remoteModels.forEach(model => {
                container.appendChild(this.createModelCard(model, 'remote'));
            });
        } else {
            container.innerHTML = '<div class="empty-message">No online providers configured</div>';
        }
    }

    renderAvailableModels() {
        const container = document.getElementById('available-models-container');
        if (!container) return;
        
        if (this.models.available && this.models.available.length > 0) {
            container.innerHTML = '';
            this.models.available.forEach(model => {
                if (!this.isModelInFeatured(model)) {
                    container.appendChild(this.createModelCard(model, 'available'));
                }
            });
        } else {
            container.innerHTML = '<div class="empty-message">No additional models available</div>';
        }
    }

    isModelInFeatured(model) {
        const modelName = typeof model === 'string' ? model : model.name;
        return this.models.featured.some(featuredModel => 
            featuredModel.name === modelName
        );
    }

    createModelCard(model, section) {
        const isObject = typeof model === 'object';
        const modelId = isObject ? model.name : model;
        const displayName = isObject && model.display_name ? model.display_name : modelId;
        const isRemote = section === 'remote' || (isObject && model.provider);
        const isInstalled = isRemote ? false : (isObject ? model.installed : section === 'installed');
        const isSelected = modelId === this.currentModel;
        const modelDetails = isObject ? (model.details || {}) : {};
        
        const card = document.createElement('div');
        card.className = `model-card ${isInstalled ? 'installed' : ''} ${isSelected ? 'selected' : ''} ${isRemote ? 'remote' : ''}`;
        card.dataset.model = modelId;
        
        // Check if it's a new Llama 4 model
        const isLlama4 = modelId.includes('llama4');
        
        let cardContent = `
            <div class="model-name">${displayName}</div>
            <div class="model-status ${isInstalled ? 'installed' : ''}">
                ${isRemote ? 'Online Provider' : (isInstalled ? 'Installed' : 'Not Installed')}
                ${isSelected ? ' (Selected)' : ''}
            </div>
        `;
        
        if (isInstalled && modelDetails.size) {
            const sizeInGB = (modelDetails.size / (1024 * 1024 * 1024)).toFixed(2);
            cardContent += `<div class="model-size">${sizeInGB} GB</div>`;
        }
        
        if (isRemote && model.provider) {
            cardContent += `<div class="model-provider">${model.provider}</div>`;
            cardContent += `<div class="model-badge online">Online</div>`;
        }

        if (isLlama4) {
            cardContent += `<div class="model-badge new">New</div>`;
        }
        
        card.innerHTML = cardContent;
        
        // Add click event to show model details
        card.addEventListener('click', () => this.showModelDetails(modelId));
        
        return card;
    }

    showModelDetails(modelName) {
        // Find the model in our data
        let modelData = null;
        let section = '';
        let remoteMeta = null;

        // Check featured models first
        const featuredModel = this.models.featured.find(m => m.name === modelName);
        if (featuredModel) {
            modelData = featuredModel;
            section = 'featured';
        } else {
            // Check installed models
            const isInstalled = this.models.installed.includes(modelName);
            if (isInstalled) {
                modelData = { name: modelName, installed: true };
                section = 'installed';
            } else {
                // Check remote providers
                remoteMeta = (this.models.remote || []).find(m => m.name === modelName);
                if (remoteMeta) {
                    modelData = { ...remoteMeta, installed: false, remote: true };
                    section = 'remote';
                } else {
                    // Must be available
                    modelData = { name: modelName, installed: false };
                    section = 'available';
                }
            }
        }
        
        // Set modal content
        document.getElementById('modal-model-name').textContent = modelName;
        
        const statusElement = document.getElementById('modal-model-status');
        statusElement.textContent = modelData.installed ? 'Installed' : 'Not Installed';
        statusElement.className = modelData.installed ? 'installed' : '';
        
        if (modelData.installed && modelData.details && modelData.details.size) {
            const sizeInGB = (modelData.details.size / (1024 * 1024 * 1024)).toFixed(2);
            document.getElementById('modal-model-size').textContent = `${sizeInGB} GB`;
        } else {
            document.getElementById('modal-model-size').textContent = 'Unknown';
        }
        
        if (modelData.installed && modelData.details && modelData.details.modified_at) {
            const date = new Date(modelData.details.modified_at);
            document.getElementById('modal-model-modified').textContent = date.toLocaleString();
        } else {
            document.getElementById('modal-model-modified').textContent = 'N/A';
        }
        
        // Remote provider metadata
        const providerRow = document.getElementById('modal-model-provider-row');
        const endpointRow = document.getElementById('modal-model-endpoint-row');
        const authRow = document.getElementById('modal-model-auth-row');
        const notesRow = document.getElementById('modal-model-notes-row');

        if (section === 'remote' && remoteMeta) {
            document.getElementById('modal-model-provider').textContent = remoteMeta.provider || 'Online';
            document.getElementById('modal-model-endpoint').textContent = remoteMeta.endpoint || '—';
            document.getElementById('modal-model-auth').textContent = remoteMeta.auth_env || '—';
            document.getElementById('modal-model-notes').textContent = remoteMeta.notes || '—';

            providerRow.classList.remove('hidden');
            endpointRow.classList.remove('hidden');
            authRow.classList.remove('hidden');
            notesRow.classList.remove('hidden');
        } else {
            providerRow.classList.add('hidden');
            endpointRow.classList.add('hidden');
            authRow.classList.add('hidden');
            notesRow.classList.add('hidden');
        }

        // Show/hide buttons based on status
        const installButton = document.getElementById('modal-install-button');
        const removeButton = document.getElementById('modal-remove-button');
        const selectButton = document.getElementById('modal-select-button');

        if (section === 'remote') {
            installButton.style.display = 'none';
            removeButton.style.display = 'none';
            selectButton.style.display = 'block';
        } else {
            installButton.style.display = modelData.installed ? 'none' : 'block';
            removeButton.style.display = modelData.installed ? 'block' : 'none';
            selectButton.style.display = modelData.installed ? 'block' : 'none';
        }

        // Hide progress container
        document.getElementById('modal-progress-container').classList.add('hidden');
        
        // Store selected model
        this.selectedModel = modelName;
        
        // Show modal
        document.getElementById('model-details-modal').style.display = 'block';
    }

    closeModelModal() {
        document.getElementById('model-details-modal').style.display = 'none';
    }

    installSelectedModel() {
        if (!this.selectedModel) return;
        
        // Show progress container
        const progressContainer = document.getElementById('modal-progress-container');
        progressContainer.classList.remove('hidden');
        
        // Reset progress bar
        document.getElementById('modal-progress-bar').style.width = '0%';
        document.getElementById('modal-progress-text').textContent = 'Starting installation...';
        
        // Hide action buttons
        document.getElementById('modal-install-button').style.display = 'none';
        document.getElementById('modal-remove-button').style.display = 'none';
        document.getElementById('modal-select-button').style.display = 'none';
        
        // Send install request to backend
        window.api.send('model-manager', { 
            action: 'install-model', 
            model: this.selectedModel 
        });
    }

    removeSelectedModel() {
        if (!this.selectedModel) return;
        
        // Show progress container
        const progressContainer = document.getElementById('modal-progress-container');
        progressContainer.classList.remove('hidden');
        
        // Reset progress bar
        document.getElementById('modal-progress-bar').style.width = '0%';
        document.getElementById('modal-progress-text').textContent = 'Starting removal...';
        
        // Hide action buttons
        document.getElementById('modal-install-button').style.display = 'none';
        document.getElementById('modal-remove-button').style.display = 'none';
        document.getElementById('modal-select-button').style.display = 'none';
        
        // Send remove request to backend
        window.api.send('model-manager', { 
            action: 'remove-model', 
            model: this.selectedModel 
        });
    }

    selectModelForUse() {
        if (!this.selectedModel) return;
        
        // Update the model input field
        const modelInput = document.getElementById('model-input');
        if (modelInput) {
            modelInput.value = this.selectedModel;
            
            // Save the configuration
            if (window.saveConfig) {
                window.saveConfig();
            }
            
            // Update current model
            this.currentModel = this.selectedModel;
            
            // Close modal
            this.closeModelModal();
            
            // Show success message
            this.showNotification(`Model ${this.selectedModel} selected for use`);
        }
    }

    updateOperationProgress(data) {
        if (!data.operation) return;
        
        const { progress, status, message } = data.operation;
        
        // Update progress bar
        document.getElementById('modal-progress-bar').style.width = `${progress}%`;
        document.getElementById('modal-progress-text').textContent = message || `${progress}% complete`;
        
        if (status === 'completed') {
            // Reload models after a short delay
            setTimeout(() => {
                this.loadModels();
                
                // Show buttons again
                setTimeout(() => {
                    // Close modal
                    this.closeModelModal();
                    
                    // Show success notification
                    this.showNotification(message || 'Operation completed successfully');
                }, 1000);
            }, 1000);
        } else if (status === 'failed') {
            // Show error
            document.getElementById('modal-progress-text').textContent = message || 'Operation failed';
            document.getElementById('modal-progress-bar').style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
            
            // Show buttons again after a delay
            setTimeout(() => {
                document.getElementById('modal-install-button').style.display = 
                    this.models.installed.includes(this.selectedModel) ? 'none' : 'block';
                document.getElementById('modal-remove-button').style.display = 
                    this.models.installed.includes(this.selectedModel) ? 'block' : 'none';
                document.getElementById('modal-select-button').style.display = 
                    this.models.installed.includes(this.selectedModel) ? 'block' : 'none';
            }, 3000);
        }
    }

    showNotification(message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        
        // Add to body
        document.body.appendChild(notification);
        
        // Show notification
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Initialize model manager when document is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.modelManager = new ModelManager();
    
    // Add model management button to config panel
    const configSection = document.querySelector('.config-section');
    if (configSection) {
        const modelRow = document.querySelector('.config-row:has(#model-input)');
        if (modelRow) {
            const manageButton = document.createElement('button');
            manageButton.id = 'model-management-button';
            manageButton.className = 'action-button';
            manageButton.textContent = 'Manage Models';
            modelRow.appendChild(manageButton);
            
            manageButton.addEventListener('click', () => {
                window.modelManager.openModelPanel();
            });
        }
    }
});

// Add notification styles
const style = document.createElement('style');
style.textContent = `
.notification {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    background: rgba(0, 255, 255, 0.2);
    border: 1px solid rgba(0, 255, 255, 0.4);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-family: 'Press Start 2P', monospace;
    font-size: 12px;
    z-index: 2000;
    opacity: 0;
    transition: transform 0.3s ease, opacity 0.3s ease;
}

.notification.show {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
}
`;
document.head.appendChild(style);
