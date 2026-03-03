// Simple Text Renderer
// A minimal implementation focused on reliable text rendering

class SimpleTextRenderer {
    constructor(outputContainer) {
        this.outputContainer = outputContainer;
        this.avatarUrl = '';
    }

    // Set the avatar URL
    setAvatarUrl(url) {
        this.avatarUrl = url;
    }

    // Add a message
    addMessage(text) {
        // Create container
        const container = document.createElement('div');
        container.className = 'message assistant';
        
        // Create avatar
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = this.avatarUrl || 'default-avatar.png';
        container.appendChild(avatar);
        
        // Create text container
        const textContainer = document.createElement('div');
        textContainer.className = 'message-content';
        
        // Set text directly without any processing
        textContainer.innerText = text;
        
        // Add to container
        container.appendChild(textContainer);
        
        // Add to output
        this.outputContainer.appendChild(container);
        
        // Scroll to bottom
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
    }
    
    // Add thinking message
    addThinking() {
        // Remove any existing thinking messages
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        // Create container
        const container = document.createElement('div');
        container.className = 'message thinking';
        
        // Add text directly
        container.innerText = '⌛ thinking...';
        
        // Add to output
        this.outputContainer.appendChild(container);
        
        // Scroll to bottom
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
    }
    
    // Process a message from the backend
    processMessage(message) {
        if (!message) return;
        
        // Handle thinking messages
        if (message && message.type === 'thinking') {
            this.addThinking();
            return;
        }
        
        // Extract text content
        let text = '';
        
        if (typeof message === 'string') {
            text = message;
        } else if (message.messages) {
            // Handle message array
            message.messages.forEach(msg => {
                if (msg.role !== 'user') {
                    text += msg.content + '\n';
                }
            });
        } else if (message.result) {
            text = message.result;
        } else {
            text = String(message || '');
        }
        
        // Add the message
        this.addMessage(text);
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleTextRenderer;
}
