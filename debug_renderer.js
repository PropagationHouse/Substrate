// Minimal chat renderer with streaming effects and avatars
console.log("Streaming chat renderer loaded");

document.addEventListener('DOMContentLoaded', function() {
    console.log("Streaming chat renderer initialized");

    // Keep track of the current message being built
    let currentMessageContent = "";
    let streamingElement = null;
    let streamingInterval = null;
    let streamBuffer = "";
    const STREAM_SPEED = 15; // ms between characters
    
    // Smart auto-scroll: enabled by default, disabled when user scrolls up
    let _dbgAutoScroll = true;
    (function _initScrollListener() {
        const el = document.getElementById('output');
        if (!el) return;
        el.addEventListener('scroll', () => {
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            _dbgAutoScroll = dist <= 80;
        });
    })();
    function _scrollToBottom() {
        if (!_dbgAutoScroll) return;
        const el = document.getElementById('output');
        if (el) el.scrollTop = el.scrollHeight;
    }
    
    // Basic CSS only
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        #output {
            padding: 20px 15px 250px 15px !important;
            overflow-y: auto !important;
            display: block !important;
            -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 8%, rgba(0,0,0,0.7) 15%, black 25%) !important;
            mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 8%, rgba(0,0,0,0.7) 15%, black 25%) !important;
        }
        
        .debug-message {
            display: block !important;
            margin: 20px 0 !important;
            clear: both !important;
            transition: opacity 0.3s ease !important;
        }
        
        .avatar-container {
            float: left !important;
            margin-right: 15px !important;
            width: 40px !important;
        }
        
        .message-avatar {
            width: 40px !important;
            height: 40px !important;
            border-radius: 8px !important;
        }
        
        .message-bubble {
            margin-left: 55px !important;
            background-color: rgba(20, 20, 30, 0.35) !important;
            border-radius: 10px !important;
            padding: 15px !important;
            color: rgba(255, 255, 255, 0.92) !important;
            font-family: 'Press Start 2P', monospace !important;
            font-size: 11px !important;
            line-height: 1.8 !important;
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
        }
        
        .message-bubble code {
            background-color: rgba(0, 0, 0, 0.3) !important;
            padding: 2px 4px !important;
            border-radius: 3px !important;
            font-family: monospace !important;
            font-size: 10px !important;
            color: #a0e1ff !important;
        }
        
        .message-bubble pre {
            background-color: rgba(0, 0, 0, 0.3) !important;
            padding: 12px !important;
            border-radius: 6px !important;
            overflow-x: auto !important;
            margin: 10px 0 !important;
        }
        
        .message-bubble pre code {
            background: none !important;
            color: #c0f0ff !important;
            padding: 0 !important;
        }
        
        .message-bubble a {
            color: #4da6ff !important;
            text-decoration: underline !important;
        }
        
        /* User message bubbles */
        .debug-message.user-message {
            text-align: right !important;
        }
        .debug-message.user-message .message-bubble {
            margin-left: 40px !important;
            margin-right: 0 !important;
            background-color: rgba(0, 180, 255, 0.12) !important;
            border: 1px solid rgba(0, 180, 255, 0.15) !important;
            text-align: left !important;
            font-size: 10px !important;
        }
        .debug-message.user-message .avatar-container {
            display: none !important;
        }
        /* Hidden state for user messages */
        #output.hide-user-messages .debug-message.user-message {
            display: none !important;
        }
        
        
        /* Message action buttons container */
        .msg-actions {
            position: absolute;
            bottom: 6px;
            right: 6px;
            display: flex;
            gap: 4px;
            z-index: 10;
        }
        
        /* Hide other elements but preserve activity panels */
        .thinking, .system-message {
            display: none !important;
        }
        .message:not(.debug-message):not(.agent-activity-container) {
            display: none !important;
        }
        
        /* Agent Activity Panel (Cascade-style) */
        .agent-activity-panel {
            margin: 8px 0 12px 55px;
            padding: 0;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 11px;
            line-height: 1.5;
            color: rgba(255, 255, 255, 0.7);
            max-height: 300px;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.2) transparent;
        }
        .activity-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            cursor: pointer;
            user-select: none;
            border-radius: 6px 6px 0 0;
            background: rgba(255, 255, 255, 0.05);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .activity-step {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 3px 10px;
            margin: 2px 0;
            transition: opacity 0.3s, border-color 0.3s;
        }
        .activity-step[data-status="running"] {
            border-left: 2px solid rgba(100, 200, 255, 0.4);
        }
        .activity-step[data-status="done"] {
            border-left: 2px solid rgba(100, 255, 100, 0.3);
        }
        .activity-step[data-status="error"] {
            border-left: 2px solid rgba(255, 100, 100, 0.3);
        }
        .activity-step[data-status="pending"] {
            border-left: 2px solid rgba(255, 200, 50, 0.3);
        }
        .activity-step .step-icon {
            flex-shrink: 0;
            width: 16px;
            text-align: center;
        }
        .activity-step .step-label {
            color: rgba(255, 255, 255, 0.85);
            font-weight: 500;
        }
        .activity-step .step-detail {
            color: rgba(255, 255, 255, 0.45);
            margin-left: 6px;
            font-size: 10px;
        }
        .agent-activity-panel.finalized {
            opacity: 0.5;
        }
        .agent-activity-panel.finalized .activity-body {
            display: none;
        }
        .agent-activity-panel.finalized .activity-toggle {
            transform: rotate(-90deg);
        }
        
        /* Message action buttons (audio, copy) */
        .msg-action-btn {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 50%;
            width: 18px;
            height: 18px;
            cursor: pointer;
            font-size: 9px;
            opacity: 0.35;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
        }
        .msg-action-btn:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.25);
            border-color: rgba(255, 255, 255, 0.4);
        }
        .msg-action-btn.playing {
            opacity: 1;
            background: rgba(100, 200, 255, 0.25);
            border-color: rgba(100, 200, 255, 0.5);
        }
        .msg-action-btn.copied {
            opacity: 1;
            background: rgba(100, 255, 100, 0.2);
            border-color: rgba(100, 255, 100, 0.4);
        }
        
        /* Simpler input box */
        #chat-input-container {
            background-color: rgba(20, 20, 30, 0.35) !important;
            border-radius: 10px !important;
        }
        
        /* Cursor animation for streaming effect */
        @keyframes blink {
            0% { opacity: 1; }
            50% { opacity: 0; }
            100% { opacity: 1; }
        }
        
        .typing-cursor {
            display: inline-block;
            width: 6px;
            height: 15px;
            background-color: #4da6ff;
            margin-left: 2px;
            vertical-align: middle;
            animation: blink 1s infinite;
        }
    `;
    document.head.appendChild(styleEl);

    // Aggressively clean up the output area and remove all other UI elements
    function aggressiveCleanup() {
        console.log("Performing cleanup while preserving avatars");
        
        // First, clear the output area except our debug messages
        const output = document.getElementById('output');
        if (output) {
            // Remove everything that's not our debug messages
            // But be careful not to touch avatar-related elements
            const nonDebugMessages = output.querySelectorAll(':not(.debug-message):not(.avatar-container):not(.message-avatar):not(.agent-activity-panel)');
            nonDebugMessages.forEach(el => {
                // Check if this is an ancestor of an avatar, debug message, or activity panel
                const hasAvatarChild = el.querySelector('.message-avatar');
                const hasDebugChild = el.querySelector('.debug-message');
                const hasActivityChild = el.querySelector('.agent-activity-panel');
                const isActivityElement = el.classList && (el.classList.contains('agent-activity-panel') || el.classList.contains('activity-header') || el.classList.contains('activity-body') || el.classList.contains('activity-step'));
                
                // Only remove if it's not containing important elements
                if (!hasAvatarChild && !hasDebugChild && !hasActivityChild && !isActivityElement && el.parentNode === output) {
                    el.remove();
                }
            });
        }
        
        // Remove duplicate UI containers but keep avatar intact
        document.querySelectorAll('#debug-container, .debug-container, .message:not(.debug-message)').forEach(el => {
            // Check if this element contains an avatar
            const hasAvatar = el.querySelector('.message-avatar');
            if (!hasAvatar) {
                el.remove();
            }
        });
        
        // Remove any non-essential UI elements
        document.querySelectorAll('.thinking, .system-message').forEach(el => {
            // Make sure this isn't an avatar container
            if (!el.querySelector('.message-avatar')) {
                el.remove();
            }
        });
        
        // Find any containers that might be holding duplicate UIs
        document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"]').forEach(el => {
            // Keep essential elements and avatar-related elements
            if (el.id !== 'chat-input-container' && 
                !el.classList.contains('titlebar') &&
                !el.classList.contains('avatar') && 
                !el.id.includes('config') &&
                !el.id.includes('avatar') &&
                !el.id.includes('radial') &&
                !el.id.includes('button-container') &&
                !el.querySelector('.message-avatar')) {
                el.remove();
            }
        });

        // Style the input container
        const chatInputContainer = document.getElementById('chat-input-container');
        if (chatInputContainer) {
            chatInputContainer.style.backgroundColor = 'rgba(20, 20, 30, 0.35)';
            chatInputContainer.style.borderRadius = '10px';
        }
        
        // Make sure the avatar is visible
        ensureAvatarVisible();
    }
    
    // Make sure avatar is visible and properly loaded
    function ensureAvatarVisible() {
        // Check if avatar preview exists
        const avatarPreview = document.getElementById('avatar-preview');
        if (!avatarPreview || !avatarPreview.src) {
            console.log("Avatar preview element not found or has no source");
            return;
        }
        
        // Make sure avatar is visible
        avatarPreview.style.display = '';
        
        // Ensure all message avatars have the correct source
        document.querySelectorAll('.message-avatar').forEach(avatar => {
            if (avatar.src !== avatarPreview.src) {
                avatar.src = avatarPreview.src;
            }
        });
    }
    
    // Run cleanup immediately but with some delay to let avatars load
    setTimeout(aggressiveCleanup, 300);
    
    // Make sure the cleanup runs after all other scripts
    setTimeout(aggressiveCleanup, 1000);
    setTimeout(aggressiveCleanup, 2000);
    
    // Run cleanup periodically to catch any new elements
    setInterval(aggressiveCleanup, 3000);
    
    // Format the incoming text with markdown formatting
    function formatText(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    }
    
    // Create a message container with avatar
    function createMessageContainer() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'debug-message';
        
        // Avatar as a floated image
        const avatarContainer = document.createElement('div');
        avatarContainer.className = 'avatar-container';
        
        try {
            const avatarPreview = document.getElementById('avatar-preview');
            if (avatarPreview && avatarPreview.src) {
                const avatar = document.createElement('img');
                avatar.className = 'message-avatar';
                avatar.src = avatarPreview.src;
                avatar.alt = "Avatar";
                avatar.setAttribute('draggable', 'false');
                avatarContainer.appendChild(avatar);
                messageDiv.appendChild(avatarContainer);
            } else {
                console.warn("Avatar preview not found or has no source");
            }
        } catch (err) {
            console.error("Error adding avatar:", err);
        }
        
        // Create message bubble
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        messageDiv.appendChild(bubble);
        
        // Add typing cursor
        const cursor = document.createElement('span');
        cursor.className = 'typing-cursor';
        bubble.appendChild(cursor);
        
        return { messageDiv, bubble };
    }
    
    // Stop any existing streaming
    function stopStreaming() {
        if (streamingInterval) {
            clearInterval(streamingInterval);
            streamingInterval = null;
        }
    }
    
    // Stream text with a typewriter effect
    function streamText(element, text, onComplete) {
        if (!element) return;
        
        // Create a new formatted version of the entire text
        const formattedText = formatText(text);
        
        // Create a temporary div to hold the formatted HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = formattedText;
        
        // Extract just the text content to determine length for streaming
        const textOnly = tempDiv.textContent;
        const textLength = textOnly.length;
        
        // Start with the HTML but initially hidden
        element.innerHTML = formattedText;
        
        // Measure the actual height when fully displayed
        const fullHeight = element.scrollHeight;
        
        // Create a wrapper for the cursor
        const cursorElement = document.createElement('span');
        cursorElement.className = 'typing-cursor';
        element.appendChild(cursorElement);
        
        // Now gradually reveal using a clip-path
        let progress = 0;
        let charCount = 0;
        
        // Stop any existing streaming
        stopStreaming();
        
        // Start a new streaming interval
        streamingInterval = setInterval(() => {
            // Increase the progress
            charCount += 3;  // Reveal 3 characters at a time for smoother animation
            progress = Math.min(1, charCount / textLength);
            
            if (progress >= 1) {
                // Animation complete
                stopStreaming();
                if (onComplete) onComplete();
            }
            
            // Scroll to the bottom to ensure visibility
            _scrollToBottom();
        }, STREAM_SPEED);
    }

    // === Audio Replay & Copy ===
    let replayAudio = null;
    const BACKEND_BASE = 'http://localhost:8765';
    
    function ensureReplayAudio() {
        if (!replayAudio) {
            replayAudio = document.createElement('audio');
            replayAudio.id = 'debug-replay-audio';
            replayAudio.style.display = 'none';
            document.body.appendChild(replayAudio);
            replayAudio.addEventListener('ended', () => {
                document.querySelectorAll('.msg-action-btn.playing').forEach(b => b.classList.remove('playing'));
            });
        }
        return replayAudio;
    }
    
    function resolveAudioUrl(url) {
        if (!url) return url;
        // Relative paths need the backend base URL in Electron
        if (url.startsWith('/')) return BACKEND_BASE + url;
        if (!url.startsWith('http')) return BACKEND_BASE + '/' + url;
        return url;
    }
    
    function getOrCreateActions(messageDiv) {
        let actions = messageDiv.querySelector('.msg-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'msg-actions';
            messageDiv.appendChild(actions);
            messageDiv.style.position = 'relative';
        }
        return actions;
    }
    
    function addCopyButtonToMessage(messageDiv) {
        if (messageDiv.dataset.hasCopy) return;
        const bubble = messageDiv.querySelector('.message-bubble');
        if (!bubble) return;
        
        const actions = getOrCreateActions(messageDiv);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action-btn';
        copyBtn.textContent = '\u2398'; // ⎘ (minimal copy icon)
        copyBtn.title = 'Copy message';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            const text = bubble.textContent || bubble.innerText || '';
            navigator.clipboard.writeText(text.trim()).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.textContent = '\u2713'; // ✓
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.textContent = '\u2398';
                }, 1500);
            }).catch(err => console.warn('Copy failed:', err));
        };
        actions.appendChild(copyBtn);
        messageDiv.dataset.hasCopy = 'true';
    }
    
    function attachAudioToLastMessage(audioUrl) {
        const output = document.getElementById('output');
        if (!output) return;
        
        const msgs = output.querySelectorAll('.debug-message:not(.user-message)');
        if (msgs.length === 0) return;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.dataset.audioUrl) return;
        
        const resolvedUrl = resolveAudioUrl(audioUrl);
        const actions = getOrCreateActions(lastMsg);
        
        const audioBtn = document.createElement('button');
        audioBtn.className = 'msg-action-btn';
        audioBtn.textContent = '\u25B6'; // ▶ (minimal play icon)
        audioBtn.title = 'Replay voice';
        audioBtn.onclick = (e) => {
            e.stopPropagation();
            try {
                const audio = ensureReplayAudio();
                // Toggle play/pause
                if (!audio.paused && audio._activeBtn === audioBtn) {
                    audio.pause();
                    audioBtn.classList.remove('playing');
                    audioBtn.textContent = '\u25B6';
                    audioBtn.title = 'Replay voice';
                } else {
                    document.querySelectorAll('.msg-action-btn.playing').forEach(b => {
                        b.classList.remove('playing');
                        b.textContent = '\u25B6';
                        b.title = 'Replay voice';
                    });
                    audio.src = resolvedUrl;
                    audio._activeBtn = audioBtn;
                    audioBtn.classList.add('playing');
                    audioBtn.textContent = '\u23F8'; // ⏸
                    audioBtn.title = 'Pause';
                    audio.play().catch(err => {
                        console.warn('Audio replay error:', err);
                        audioBtn.classList.remove('playing');
                        audioBtn.textContent = '\u25B6';
                    });
                    audio.onended = () => {
                        audioBtn.classList.remove('playing');
                        audioBtn.textContent = '\u25B6';
                        audioBtn.title = 'Replay voice';
                    };
                }
            } catch(err) { console.warn('Audio replay error:', err); }
        };
        
        // Insert audio button before copy button if it exists
        const copyBtn = actions.querySelector('[title="Copy message"]');
        if (copyBtn) {
            actions.insertBefore(audioBtn, copyBtn);
        } else {
            actions.appendChild(audioBtn);
        }
        lastMsg.dataset.audioUrl = resolvedUrl;
    }
    
    // === Agent Activity Panel (Cascade-style) ===
    let activityPanel = null;
    let activityStepCount = 0;
    
    function getOrCreateActivityPanel() {
        if (activityPanel && document.body.contains(activityPanel)) return activityPanel;
        
        const output = document.getElementById('output');
        if (!output) return null;
        
        activityPanel = document.createElement('div');
        activityPanel.className = 'agent-activity-panel';
        
        const header = document.createElement('div');
        header.className = 'activity-header';
        header.innerHTML = '<span class="activity-toggle" style="font-size:10px;transition:transform 0.2s;">▼</span>' +
            '<span style="opacity:0.5;font-size:11px;">Agent Activity</span>' +
            '<span class="activity-count" style="margin-left:auto;opacity:0.4;font-size:10px;">0 steps</span>' +
            '<button class="activity-stop-btn" title="Stop agent" style="' +
                'background:transparent;border:none;border-radius:3px;' +
                'color:rgba(255,255,255,0.2);font-size:9px;padding:1px 4px;cursor:pointer;margin-left:6px;' +
                'transition:all 0.3s;line-height:1.4;">■</button>';
        
        // Stop button handler
        const stopBtn = header.querySelector('.activity-stop-btn');
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopBtn.textContent = '·';
            stopBtn.style.opacity = '0.15';
            stopBtn.disabled = true;
            fetch('http://localhost:8765/api/interrupt', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                    console.log('[STOP] Interrupt response:', data);
                    stopBtn.textContent = '·';
                    stopBtn.style.opacity = '0.1';
                })
                .catch(err => {
                    console.error('[STOP] Interrupt failed:', err);
                    stopBtn.textContent = '■';
                    stopBtn.style.opacity = '0.2';
                    stopBtn.disabled = false;
                });
        });
        stopBtn.addEventListener('mouseenter', () => {
            if (!stopBtn.disabled) { stopBtn.style.color = 'rgba(255,255,255,0.5)'; }
        });
        stopBtn.addEventListener('mouseleave', () => {
            if (!stopBtn.disabled) { stopBtn.style.color = 'rgba(255,255,255,0.2)'; }
        });
        
        // Collapse toggle (on header click, not stop button)
        header.addEventListener('click', (e) => {
            if (e.target.closest('.activity-stop-btn')) return;
            const body = activityPanel.querySelector('.activity-body');
            const toggle = header.querySelector('.activity-toggle');
            if (body.style.display === 'none') {
                body.style.display = 'block';
                toggle.style.transform = 'rotate(0deg)';
            } else {
                body.style.display = 'none';
                toggle.style.transform = 'rotate(-90deg)';
            }
        });
        activityPanel.appendChild(header);
        
        const body = document.createElement('div');
        body.className = 'activity-body';
        body.style.padding = '4px 0';
        activityPanel.appendChild(body);
        
        activityStepCount = 0;
        output.appendChild(activityPanel);
        _scrollToBottom();
        return activityPanel;
    }
    
    // === Thinking Panel (streaming model reasoning) ===
    function _createThinkingPanel() {
        // Remove old generic thinking messages
        document.querySelectorAll('.thinking').forEach(el => el.remove());
        // Remove any existing thinking panel
        const existing = output.querySelector('.thinking-panel');
        if (existing) existing.remove();
        
        const panel = document.createElement('div');
        panel.className = 'thinking-panel';
        panel.style.cssText = 'margin:6px 0;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(180,140,255,0.15);overflow:hidden;font-family:Consolas,Monaco,"Courier New",monospace;';
        
        const header = document.createElement('div');
        header.className = 'thinking-panel-header';
        header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(180,140,255,0.08);border-bottom:1px solid rgba(180,140,255,0.1);cursor:pointer;user-select:none;';
        header.innerHTML = '<span style="font-size:11px;color:rgba(180,140,255,0.7);">\ud83d\udcad</span><span style="font-size:11px;color:rgba(180,140,255,0.7);font-weight:500;">Thinking</span><span class="thinking-spinner" style="font-size:9px;color:rgba(180,140,255,0.4);margin-left:4px;">\u25cf\u25cf\u25cf</span><span class="thinking-toggle" style="margin-left:auto;font-size:9px;color:rgba(255,255,255,0.2);">\u25be</span>';
        
        const content = document.createElement('div');
        content.className = 'thinking-panel-content';
        content.style.cssText = 'padding:8px 12px;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.45);max-height:250px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(180,140,255,0.15) transparent;white-space:pre-wrap;word-break:break-word;';
        
        header.addEventListener('click', () => {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            const toggle = header.querySelector('.thinking-toggle');
            if (toggle) toggle.textContent = isCollapsed ? '\u25be' : '\u25b8';
        });
        
        panel.appendChild(header);
        panel.appendChild(content);
        output.appendChild(panel);
        _scrollToBottom();
    }
    
    function _appendThinkingDelta(text) {
        let panel = output.querySelector('.thinking-panel');
        if (!panel) _createThinkingPanel();
        panel = output.querySelector('.thinking-panel');
        const content = panel ? panel.querySelector('.thinking-panel-content') : null;
        if (content) {
            content.textContent += text;
            content.scrollTop = content.scrollHeight;
        }
        _scrollToBottom();
    }
    
    function _finalizeThinkingPanel() {
        const panel = output.querySelector('.thinking-panel');
        if (!panel) return;
        const spinner = panel.querySelector('.thinking-spinner');
        if (spinner) spinner.remove();
        const content = panel.querySelector('.thinking-panel-content');
        const header = panel.querySelector('.thinking-panel-header');
        if (content && header) {
            const charCount = (content.textContent || '').length;
            if (charCount > 0) {
                const countLabel = document.createElement('span');
                countLabel.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.15);margin-left:6px;';
                countLabel.textContent = charCount + ' chars';
                const toggle = header.querySelector('.thinking-toggle');
                if (toggle) header.insertBefore(countLabel, toggle);
            }
            content.style.display = 'none';
            const toggle = header.querySelector('.thinking-toggle');
            if (toggle) toggle.textContent = '\u25b8';
        }
    }
    
    function addActivityStep(icon, label, detail, status) {
        const panel = getOrCreateActivityPanel();
        if (!panel) return;
        const body = panel.querySelector('.activity-body');
        
        const step = document.createElement('div');
        step.className = 'activity-step';
        step.dataset.status = status || 'running';
        
        // Header row (clickable)
        const headerRow = document.createElement('div');
        headerRow.className = 'step-header';
        headerRow.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:3px 10px;cursor:pointer;';
        headerRow.innerHTML = '<span class="step-icon">' + icon + '</span>' +
            '<span class="step-text" style="flex:1;word-break:break-word;">' +
            '<span class="step-label">' + label + '</span>' +
            (detail ? '<span class="step-detail">' + detail + '</span>' : '') +
            '</span>';
        step.appendChild(headerRow);
        
        // Expandable output area
        const outputDiv = document.createElement('div');
        outputDiv.className = 'step-output';
        outputDiv.style.cssText = 'display:none;margin:2px 0 4px 26px;padding:6px 10px;background:rgba(0,0,0,0.25);border-radius:4px;font-size:11px;line-height:1.4;color:rgba(255,255,255,0.6);max-height:200px;overflow-y:auto;overflow-x:auto;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(255,255,255,0.05);';
        step.appendChild(outputDiv);
        
        // Click to expand/collapse
        headerRow.addEventListener('click', () => {
            if (!outputDiv.textContent) return;
            outputDiv.style.display = outputDiv.style.display === 'none' ? 'block' : 'none';
        });
        
        body.appendChild(step);
        activityStepCount++;
        
        const countEl = panel.querySelector('.activity-count');
        if (countEl) countEl.textContent = activityStepCount + ' step' + (activityStepCount !== 1 ? 's' : '');
        
        _scrollToBottom();
    }
    
    function updateLastStep(icon, detail, status, toolOutput) {
        if (!activityPanel) return;
        const steps = activityPanel.querySelectorAll('.activity-step');
        if (steps.length === 0) return;
        const lastStep = steps[steps.length - 1];
        lastStep.dataset.status = status || 'done';
        if (icon) {
            const iconEl = lastStep.querySelector('.step-icon');
            if (iconEl) iconEl.textContent = icon;
        }
        if (detail) {
            let detailEl = lastStep.querySelector('.step-detail');
            if (detailEl) {
                detailEl.textContent = detail;
            } else {
                detailEl = document.createElement('span');
                detailEl.className = 'step-detail';
                detailEl.textContent = detail;
                const textSpan = lastStep.querySelector('.step-text');
                if (textSpan) textSpan.appendChild(detailEl);
            }
        }
        // Populate expandable output
        const outputDiv = lastStep.querySelector('.step-output');
        if (outputDiv && toolOutput) {
            let outputText = '';
            if (typeof toolOutput === 'string') {
                outputText = toolOutput;
            } else if (typeof toolOutput === 'object') {
                if (toolOutput.output) outputText = toolOutput.output;
                else if (toolOutput.content) outputText = toolOutput.content;
                else if (toolOutput.text) outputText = toolOutput.text;
                else if (toolOutput.error) outputText = 'Error: ' + toolOutput.error;
                else outputText = JSON.stringify(toolOutput, null, 2);
            }
            if (outputText) {
                if (outputText.length > 3000) outputText = outputText.slice(0, 3000) + '\n... (truncated)';
                // Check if this step has a terminal panel (exec tool)
                const termOutput = outputDiv.querySelector('.terminal-output');
                if (termOutput) {
                    // Remove spinner
                    const spinner = termOutput.querySelector('.terminal-spinner');
                    if (spinner) spinner.remove();
                    // Append stdout
                    const stdoutDiv = document.createElement('div');
                    stdoutDiv.style.cssText = 'color:rgba(255,255,255,0.7);';
                    stdoutDiv.textContent = outputText;
                    termOutput.appendChild(stdoutDiv);
                    // Exit code status line
                    const exitCode = (typeof toolOutput === 'object' && toolOutput.exit_code !== undefined) ? toolOutput.exit_code : null;
                    const statusDiv = document.createElement('div');
                    statusDiv.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.05);font-size:10px;';
                    if (status === 'error' || (exitCode !== null && exitCode !== 0)) {
                        statusDiv.innerHTML = '<span style="color:rgba(255,100,100,0.8);">\u2717 exit ' + (exitCode !== null ? exitCode : '1') + '</span>';
                        if (typeof toolOutput === 'object' && toolOutput.error) {
                            const stderrDiv = document.createElement('div');
                            stderrDiv.style.cssText = 'color:rgba(255,100,100,0.7);margin-top:2px;';
                            stderrDiv.textContent = toolOutput.error;
                            termOutput.appendChild(stderrDiv);
                        }
                    } else {
                        statusDiv.innerHTML = '<span style="color:rgba(80,200,120,0.7);">\u2713 exit 0</span>';
                    }
                    termOutput.appendChild(statusDiv);
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                } else {
                    // Generic output for non-exec tools
                    outputDiv.textContent = outputText;
                    if (outputDiv.style.display === 'none' || !outputDiv.style.display) {
                        const headerRow = lastStep.querySelector('.step-header');
                        if (headerRow && !headerRow.querySelector('.expand-hint')) {
                            const hint = document.createElement('span');
                            hint.className = 'expand-hint';
                            hint.style.cssText = 'color:rgba(255,255,255,0.2);font-size:9px;margin-left:auto;flex-shrink:0;';
                            hint.textContent = '\u25b8';
                            headerRow.appendChild(hint);
                        }
                    }
                }
            }
        }
    }
    
    function finalizeActivityPanel() {
        if (activityPanel) {
            activityPanel.classList.add('finalized');
            activityPanel = null;
            activityStepCount = 0;
        }
    }
    
    // Add a user message bubble to the chat
    let showUserMessages = true;
    function addUserMessage(text) {
        const output = document.getElementById('output');
        if (!output || !text) return;
        
        // Nuclear filter: block any text that is only punctuation/brackets
        if (text.replace(/[^a-zA-Z0-9]/g, '').length < 2) {
            console.error('BLOCKED garbage in addUserMessage:', JSON.stringify(text), new Error().stack);
            return;
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'debug-message user-message';
        
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = formatText(text);
        messageDiv.appendChild(bubble);
        
        output.appendChild(messageDiv);
        _scrollToBottom();
    }
    
    // Track the parent messageDiv of the current streaming element
    let streamingMessageDiv = null;
    
    // Display message handler - handle both streaming and complete messages
    function displayMessage(data) {
        const output = document.getElementById('output');
        if (!output) return;
        
        // Reject non-streaming messages that are only punctuation/brackets (noise from STT hallucinations)
        if (data.status !== 'streaming') {
            const rawResult = data.result || '';
            if (rawResult && rawResult.length < 4 && rawResult.replace(/[^a-zA-Z0-9]/g, '').length === 0) {
                console.log('Filtered garbage display message:', JSON.stringify(rawResult));
                return;
            }
        }
        
        // For streaming messages, accumulate content and update display
        if (data.status === 'streaming') {
            // Add to buffer
            streamBuffer += data.result || '';
            
            // Create message container if this is the first chunk
            if (!streamingElement) {
                // Create the message elements
                const { messageDiv, bubble } = createMessageContainer();
                
                // Add to the output
                output.appendChild(messageDiv);
                
                // Save the bubble element and its parent for updating
                streamingElement = bubble;
                streamingMessageDiv = messageDiv;
                
                // Start with empty content
                streamingElement.innerHTML = '';
                
                // Add cursor element
                const cursor = document.createElement('span');
                cursor.className = 'typing-cursor';
                streamingElement.appendChild(cursor);
            }
            
            // Update the content with what we have so far
            if (streamingElement) {
                // Use formatted version of the accumulated text
                streamingElement.innerHTML = formatText(streamBuffer);
                
                // Add blinking cursor at the end
                const cursor = document.createElement('span');
                cursor.className = 'typing-cursor';
                streamingElement.appendChild(cursor);
                
                // Scroll to bottom
                _scrollToBottom();
            }
            
            return;
        }
        
        // For completed messages, display the final version
        if (data.status === 'done' || data.status === 'success') {
            // Use either the streamed buffer or direct result
            const messageContent = data.result || streamBuffer || '';
            
            // If we were already streaming this message
            if (streamingElement && streamBuffer) {
                // Replace with final content
                streamingElement.innerHTML = formatText(messageContent);
                
                // Add copy button to the completed streamed message
                if (streamingMessageDiv) {
                    addCopyButtonToMessage(streamingMessageDiv);
                }
                
                // Reset for next message
                streamingElement = null;
                streamingMessageDiv = null;
                streamBuffer = '';
                
                // Scroll to the bottom
                _scrollToBottom();
                return;
            }
            
            // Otherwise create a new message from scratch
            if (messageContent) {
                // Create message container
                const { messageDiv, bubble } = createMessageContainer();
                
                // Add to output
                output.appendChild(messageDiv);
                
                // Add copy button
                addCopyButtonToMessage(messageDiv);
                
                // Simulate streaming for the full message
                streamText(bubble, messageContent);
                
                // Scroll to bottom
                _scrollToBottom();
            }
            
            // Reset for next message
            streamingElement = null;
            streamingMessageDiv = null;
            streamBuffer = '';
        }
    }
    
    // Disable any cleanup that might remove our messages
    if (window.cleanupBrokenChat) {
        window.cleanupBrokenChat = function() { /* Do nothing */ };
    }
    
    // Block ALL interval-based cleanups from other scripts
    const originalSetInterval = window.setInterval;
    window.setInterval = function(fn, delay) {
        // Allow our own intervals to run
        if (fn === aggressiveCleanup || fn === ensureAvatarVisible) {
            return originalSetInterval(fn, delay);
        }
        
        // Block any cleanup-related intervals
        if (typeof fn === 'function' && fn.toString) {
            const fnStr = fn.toString();
            if (fnStr.includes('removeChild') || 
                fnStr.includes('clean') || 
                fnStr.includes('innerHTML') ||
                fnStr.includes('remove()')) {
                console.log("Blocked potential cleanup interval");
                return 0; // Return fake interval ID
            }
        }
        
        return originalSetInterval(fn, delay);
    };
    
    // Remove all toggle buttons or debug controls
    document.querySelectorAll('button').forEach(button => {
        if (button.textContent === 'Toggle Debug' || 
            button.textContent.toLowerCase().includes('debug') ||
            button.id.includes('debug')) {
            button.remove();
        }
    });
    
    // Expose showUserMessages on window so the radial menu toggle button can sync
    window.showUserMessages = showUserMessages;
    
    // Intercept chat input to display user messages
    let lastUserText = null;
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        // Use keydown with capture phase to grab text BEFORE executeAction clears it
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const text = chatInput.value.trim();
                if (text) {
                    lastUserText = text;
                    addUserMessage(text);
                }
            }
        }, true); // capture phase ensures we run before other handlers
    }
    
    // Also hook into execute-action IPC as a fallback
    if (window.api && window.api.receive) {
        const origSend = window.api.send;
        if (origSend) {
            window.api.send = function(channel, data) {
                if (channel === 'execute-action' && data && data.text && data.text !== lastUserText) {
                    // Filter out garbage text (random punctuation, brackets, etc.)
                    const alphaCheck = data.text.replace(/[^a-zA-Z0-9]/g, '');
                    if (alphaCheck.length < 2) {
                        console.log('Filtered garbage execute-action text:', data.text);
                        return origSend.call(this, channel, data);
                    }
                    lastUserText = data.text;
                    addUserMessage(data.text);
                }
                return origSend.call(this, channel, data);
            };
        }
    }
    
    // Listen for speech transcriptions and show them as user messages in chat
    if (window.api && window.api.receive) {
        window.api.receive('speech-message', (data) => {
            if (data && data.text && data.text.trim()) {
                // Filter out garbage transcriptions (random punctuation, brackets, etc.)
                const alphaOnly = data.text.replace(/[^a-zA-Z0-9]/g, '');
                if (alphaOnly.length < 2) {
                    console.log('Filtered garbage speech in renderer:', data.text);
                    return;
                }
                console.log('Speech message received in chat:', data.text);
                addUserMessage('\uD83C\uDF99\uFE0F ' + data.text.trim());
            }
        });
    }
    
    // Listen for Python messages
    window.api.receive('python-message', (data) => {
        try {
            // Skip startup and thinking messages
            if (data.status === 'success' && 
                (data.result === 'Agent ready! Type /help for available commands.' ||
                 (data.result && data.result.startsWith && data.result.startsWith('Current configuration:')))) {
                return;
            }
            
            // Streaming thinking content from model reasoning
            if (data.type === 'thinking_start') {
                _createThinkingPanel();
                return;
            }
            if (data.type === 'thinking_delta') {
                _appendThinkingDelta(data.content || '');
                return;
            }
            if (data.type === 'thinking_end') {
                _finalizeThinkingPanel();
                return;
            }
            
            if (data.type === 'thinking') {
                return;
            }
            
            // Handle voice-audio messages - attach replay button to last message
            if (data.type === 'voice-audio' && data.url) {
                console.log('%c \uD83D\uDD0A Voice audio received:', 'background: #222; color: #00ff00;', data.url);
                attachAudioToLastMessage(data.url);
                return;
            }
            
            // === Agent Activity Messages (Cascade-style) ===
            if (data.status === 'tool_executing') {
                _finalizeThinkingPanel();
                const toolName = data.tool || 'unknown';
                const detail = (data.message || '').replace('▶ ' + toolName, '').trim();
                addActivityStep('⚙', toolName, detail, 'running');
                
                // If code_preview is present, show it in the step output (auto-expanded)
                if (data.code_preview && activityPanel) {
                    const steps = activityPanel.querySelectorAll('.activity-step');
                    const lastStep = steps[steps.length - 1];
                    if (lastStep) {
                        const outputDiv = lastStep.querySelector('.step-output');
                        if (outputDiv) {
                            if (toolName === 'exec') {
                                // Terminal-style panel for exec commands
                                const cmdText = data.code_preview;
                                outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.4);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:300px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(255,255,255,0.08);font-family:Consolas,Monaco,"Courier New",monospace;';
                                const termHeader = document.createElement('div');
                                termHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.06);border-radius:6px 6px 0 0;';
                                termHeader.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:10px;font-weight:500;">Terminal</span><span style="color:rgba(255,255,255,0.15);font-size:9px;">PowerShell</span>';
                                outputDiv.appendChild(termHeader);
                                const cmdDiv = document.createElement('div');
                                cmdDiv.className = 'terminal-cmd';
                                cmdDiv.style.cssText = 'padding:6px 10px;white-space:pre-wrap;word-break:break-word;';
                                const escaped = cmdText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                cmdDiv.innerHTML = '<span style="color:rgba(80,200,120,0.9);font-weight:600;">PS&gt;</span> <span style="color:rgba(255,255,255,0.85);">' + escaped + '</span>';
                                outputDiv.appendChild(cmdDiv);
                                const sep = document.createElement('div');
                                sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.05);margin:0;';
                                outputDiv.appendChild(sep);
                                const termOutput = document.createElement('div');
                                termOutput.className = 'terminal-output';
                                termOutput.style.cssText = 'padding:6px 10px;white-space:pre-wrap;word-break:break-word;min-height:16px;';
                                termOutput.innerHTML = '<span class="terminal-spinner" style="color:rgba(100,200,255,0.5);font-size:10px;">Running...</span>';
                                outputDiv.appendChild(termOutput);
                            } else if (data.code_preview_meta && data.code_preview_meta.type === 'write') {
                                // Code editor panel for write_file
                                const meta = data.code_preview_meta;
                                const codeText = data.code_preview;
                                const lines = codeText.split('\n');
                                outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(80,200,120,0.15);font-family:Consolas,Monaco,"Courier New",monospace;';
                                const editorHeader = document.createElement('div');
                                editorHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:rgba(80,200,120,0.08);border-bottom:1px solid rgba(80,200,120,0.1);border-radius:6px 6px 0 0;';
                                const fileLabel = document.createElement('span');
                                fileLabel.style.cssText = 'color:rgba(80,200,120,0.8);font-size:10px;font-weight:500;';
                                fileLabel.textContent = meta.file || 'new file';
                                const langLabel = document.createElement('span');
                                langLabel.style.cssText = 'color:rgba(255,255,255,0.2);font-size:9px;';
                                langLabel.textContent = meta.lang || 'text';
                                const copyBtn = document.createElement('span');
                                copyBtn.style.cssText = 'color:rgba(255,255,255,0.25);font-size:9px;cursor:pointer;margin-left:8px;';
                                copyBtn.textContent = '\ud83d\udccb';
                                copyBtn.title = 'Copy code';
                                copyBtn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(codeText).then(() => {
                                        copyBtn.textContent = '\u2713';
                                        setTimeout(() => { copyBtn.textContent = '\ud83d\udccb'; }, 1200);
                                    });
                                });
                                const rightGroup = document.createElement('span');
                                rightGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';
                                rightGroup.appendChild(langLabel);
                                rightGroup.appendChild(copyBtn);
                                editorHeader.appendChild(fileLabel);
                                editorHeader.appendChild(rightGroup);
                                outputDiv.appendChild(editorHeader);
                                const codeBody = document.createElement('div');
                                codeBody.style.cssText = 'padding:4px 0;';
                                lines.forEach((line, i) => {
                                    const row = document.createElement('div');
                                    row.style.cssText = 'display:flex;padding:0 10px 0 0;background:rgba(80,200,120,0.03);';
                                    if (i % 2 === 0) row.style.background = 'rgba(80,200,120,0.05)';
                                    const num = document.createElement('span');
                                    num.style.cssText = 'display:inline-block;width:32px;text-align:right;padding-right:8px;color:rgba(255,255,255,0.15);font-size:10px;flex-shrink:0;user-select:none;';
                                    num.textContent = i + 1;
                                    const code = document.createElement('span');
                                    code.style.cssText = 'color:rgba(80,200,120,0.85);white-space:pre-wrap;word-break:break-word;';
                                    code.textContent = line;
                                    row.appendChild(num);
                                    row.appendChild(code);
                                    codeBody.appendChild(row);
                                });
                                outputDiv.appendChild(codeBody);
                            } else if (data.code_preview_meta && data.code_preview_meta.type === 'diff') {
                                // Diff panel for edit_file
                                const meta = data.code_preview_meta;
                                let diffData;
                                try { diffData = JSON.parse(data.code_preview); } catch(e) { diffData = {old:'',new:''}; }
                                const oldLines = (diffData.old || '').split('\n');
                                const newLines = (diffData.new || '').split('\n');
                                outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(100,180,255,0.15);font-family:Consolas,Monaco,"Courier New",monospace;';
                                const diffHeader = document.createElement('div');
                                diffHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:rgba(100,180,255,0.08);border-bottom:1px solid rgba(100,180,255,0.1);border-radius:6px 6px 0 0;';
                                const escaped_file = (meta.file || 'edit').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                const escaped_lang = (meta.lang || 'text').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                diffHeader.innerHTML = '<span style="color:rgba(100,180,255,0.8);font-size:10px;font-weight:500;">' + escaped_file + '</span><span style="color:rgba(255,255,255,0.2);font-size:9px;">' + escaped_lang + '</span>';
                                outputDiv.appendChild(diffHeader);
                                if (oldLines.length > 0 && oldLines[0] !== '') {
                                    oldLines.forEach((line) => {
                                        const row = document.createElement('div');
                                        row.style.cssText = 'display:flex;padding:0 10px;background:rgba(255,80,80,0.08);';
                                        const prefix = document.createElement('span');
                                        prefix.style.cssText = 'color:rgba(255,100,100,0.6);width:16px;flex-shrink:0;user-select:none;';
                                        prefix.textContent = '-';
                                        const code = document.createElement('span');
                                        code.style.cssText = 'color:rgba(255,100,100,0.7);white-space:pre-wrap;word-break:break-word;';
                                        code.textContent = line;
                                        row.appendChild(prefix);
                                        row.appendChild(code);
                                        outputDiv.appendChild(row);
                                    });
                                }
                                const diffSep = document.createElement('div');
                                diffSep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.05);margin:0;';
                                outputDiv.appendChild(diffSep);
                                if (newLines.length > 0 && newLines[0] !== '') {
                                    newLines.forEach((line) => {
                                        const row = document.createElement('div');
                                        row.style.cssText = 'display:flex;padding:0 10px;background:rgba(80,200,120,0.08);';
                                        const prefix = document.createElement('span');
                                        prefix.style.cssText = 'color:rgba(80,200,120,0.6);width:16px;flex-shrink:0;user-select:none;';
                                        prefix.textContent = '+';
                                        const code = document.createElement('span');
                                        code.style.cssText = 'color:rgba(80,200,120,0.7);white-space:pre-wrap;word-break:break-word;';
                                        code.textContent = line;
                                        row.appendChild(prefix);
                                        row.appendChild(code);
                                        outputDiv.appendChild(row);
                                    });
                                }
                            } else {
                                outputDiv.innerHTML = formatText(data.code_preview);
                                outputDiv.style.display = 'block';
                            }
                            const headerRow = lastStep.querySelector('.step-header');
                            if (headerRow && !headerRow.querySelector('.expand-hint')) {
                                const hint = document.createElement('span');
                                hint.className = 'expand-hint';
                                hint.style.cssText = 'color:rgba(255,255,255,0.2);font-size:9px;margin-left:auto;flex-shrink:0;';
                                hint.textContent = '▾';
                                headerRow.appendChild(hint);
                            }
                        }
                    }
                }
                return;
            }
            
            if (data.status === 'tool_result') {
                const toolName = data.tool || 'unknown';
                const result = data.result || {};
                const isError = result.error || (typeof result === 'object' && result.success === false);
                const detail = (data.message || '').replace('◀ ' + toolName, '').trim();
                updateLastStep(
                    isError ? '✗' : '✓',
                    detail,
                    isError ? 'error' : 'done',
                    result
                );
                return;
            }
            
            if (data.status === 'tool_permission_required') {
                const toolName = data.tool || 'unknown';
                addActivityStep('🔐', toolName, 'Awaiting approval...', 'pending');
                return;
            }
            
            // For final done messages, finalize the activity panel
            if (data.status === 'done' && data.clear_thinking) {
                finalizeActivityPanel();
            }
            
            // Display the message
            displayMessage(data);
            
            // Run cleanup after processing to remove any new unwanted elements
            // But use a delay to allow avatars to load
            setTimeout(aggressiveCleanup, 500);
            
        } catch (error) {
            console.error('Error:', error);
        }
    });
    
    // Prevent message removal with a mutation observer
    const observer = new MutationObserver(function(mutations) {
        let needsCleanup = false;
        
        mutations.forEach(function(mutation) {
            // If nodes were removed
            if (mutation.type === 'childList' && mutation.removedNodes.length) {
                for (let i = 0; i < mutation.removedNodes.length; i++) {
                    const node = mutation.removedNodes[i];
                    if (node.className && 
                        typeof node.className === 'string' && 
                        node.className.includes('debug-message')) {
                        // Re-add our message that was removed
                        mutation.target.appendChild(node);
                        needsCleanup = true;
                    }
                }
            }
            
            // If nodes were added that aren't ours
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i];
                    if (node.nodeType === 1 && // Element node
                        node.className && 
                        typeof node.className === 'string' && 
                        !node.className.includes('debug-message') &&
                        !node.className.includes('agent-activity') &&
                        !node.className.includes('activity-') &&
                        node.className.includes('message') && 
                        !node.querySelector('.message-avatar')) { // Don't remove if it has an avatar
                        // Remove non-debug messages
                        node.remove();
                        needsCleanup = true;
                    }
                }
            }
        });
        
        // If mutations required cleanup, run it again
        if (needsCleanup) {
            setTimeout(aggressiveCleanup, 100);
        }
    });
    
    // Observe the output container
    const output = document.getElementById('output');
    if (output) {
        observer.observe(output, { 
            childList: true,
            subtree: true
        });
    }
    
    // Additional check to ensure avatar is visible periodically
    setInterval(ensureAvatarVisible, 2000);
    
    console.log("Streaming chat renderer with avatars setup complete");
});
