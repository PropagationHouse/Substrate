// Direct Chat Renderer
// This is a completely new approach to rendering chat messages
// It bypasses the complex DOM manipulation and directly renders text

// Store this in a separate file and include it in your HTML
class DirectChatRenderer {
    constructor(outputContainer) {
        this.outputContainer = outputContainer;
        this.messageHistory = [];
        this.avatarUrl = '';
        this.currentMessageElement = null;
        this.accumulatedText = '';
    }

    // Set the avatar URL
    setAvatarUrl(url) {
        this.avatarUrl = url;
    }

    // Clear all messages
    clearMessages() {
        this.messageHistory = [];
        this.outputContainer.innerHTML = '';
    }

    // Add a thinking message using direct DOM manipulation
    addThinkingMessage() {
        // Remove any existing thinking messages
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        // Create thinking message container
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message thinking';
        
        // Create emoji span
        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'thinking-emoji';
        emojiSpan.textContent = '⌛';
        messageDiv.appendChild(emojiSpan);
        
        // Add text node directly
        messageDiv.appendChild(document.createTextNode(' thinking...'));
        
        // Add to output
        this.outputContainer.appendChild(messageDiv);
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
    }

    // Add a message from the assistant with streaming support
    addAssistantMessage(content) {
        // Get the raw text content without any processing or filtering
        let textContent = '';
        if (typeof content === 'string') {
            textContent = content;
        } else if (content && content.result) {
            textContent = content.result;
        } else {
            textContent = String(content || '');
        }
        
        // Remove any thinking messages
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        // If this is a new message (not streaming continuation)
        if (!this.currentMessageElement) {
            // Store in history
            this.messageHistory.push({
                role: 'assistant',
                content: textContent
            });
            
            // Reset accumulated text
            this.accumulatedText = textContent;
            
            // Create message element
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant';
            
            // Create avatar image
            const avatarImg = document.createElement('img');
            avatarImg.className = 'message-avatar';
            avatarImg.src = this.avatarUrl || 'default-avatar.png';
            messageDiv.appendChild(avatarImg);
            
            // Create message content container
            const preElement = document.createElement('pre');
            preElement.className = 'message-content';
            
            // Apply styles directly to the element
            preElement.style.fontFamily = "'Consolas', 'Monaco', 'Courier New', monospace";
            preElement.style.fontSize = '14px';
            preElement.style.lineHeight = '1.6';
            preElement.style.whiteSpace = 'pre-wrap';
            preElement.style.wordBreak = 'break-word';
            preElement.style.fontWeight = 'normal';
            preElement.style.margin = '0';
            preElement.style.padding = '12px';
            preElement.style.background = 'rgba(255, 255, 255, 0.1)';
            preElement.style.borderRadius = '8px';
            preElement.style.border = '2px solid rgba(255, 255, 255, 0.2)';
            preElement.style.color = 'white';
            
            // Create a text node with the content
            const textNode = document.createTextNode(textContent);
            preElement.appendChild(textNode);
            
            // Add content to message
            messageDiv.appendChild(preElement);
            
            // Store references for streaming updates
            this.currentMessageElement = messageDiv;
            this.currentTextNode = textNode;
            
            // Add to output
            this.outputContainer.appendChild(messageDiv);
        } else {
            // This is a streaming update to an existing message
            // Replace the text node with the full content
            this.accumulatedText = textContent;
            if (this.currentTextNode) {
                this.currentTextNode.nodeValue = textContent;
            }
            
            // Update history
            if (this.messageHistory.length > 0) {
                this.messageHistory[this.messageHistory.length - 1].content = textContent;
            }
        }
        
        // Scroll to bottom
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
    }

    // Process a message object from the backend
    processMessage(message) {
        if (!message) return;
        
        // Handle thinking messages
        if (message && message.type === 'thinking') {
            this.addThinkingMessage();
            // Reset current message when thinking starts
            this.currentMessageElement = null;
            this.currentTextNode = null;
            return;
        }
        
        // Handle final message - reset streaming state
        if (message && message.type === 'final') {
            // Keep the message but reset streaming state for next message
            this.currentMessageElement = null;
            this.currentTextNode = null;
            return;
        }
        
        // Handle regular messages
        if (typeof message === 'string') {
            this.addAssistantMessage(message);
        } else if (message.messages) {
            message.messages.forEach(msg => {
                if (msg.role !== 'user') {
                    this.addAssistantMessage(msg.content);
                    // Reset streaming state after processing a complete message array
                    this.currentMessageElement = null;
                    this.currentTextNode = null;
                }
            });
        } else {
            this.addAssistantMessage(message);
        }
    }


    // Direct text rendering without filtering
    escapeHtml(text) {
        if (!text) return '';
        // Simple direct conversion without any filtering
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DirectChatRenderer;
}
