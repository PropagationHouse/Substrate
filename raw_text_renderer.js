// Raw Text Renderer
// Simplified version - wipes old message and streams new one in place
console.log('%c 🚀 RAW_TEXT_RENDERER.JS LOADED', 'background: #ff0000; color: #fff; font-size: 20px; font-weight: bold;');

class RawTextRenderer {
    constructor(outputContainer) {
        this.outputContainer = outputContainer;
        this.avatarUrl = '';
        this.isReplacing = false;
        this.lastAudioUrl = null;
        
        // Smart auto-scroll: enabled by default, disabled when user scrolls up
        this._autoScrollEnabled = true;
        this._scrollListenerAttached = false;
        this._attachScrollListener();
    }
    
    _attachScrollListener() {
        if (this._scrollListenerAttached || !this.outputContainer) return;
        this._scrollListenerAttached = true;
        this.outputContainer.addEventListener('scroll', () => {
            const el = this.outputContainer;
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (distFromBottom > 80) {
                // User scrolled up — break away from auto-scroll
                this._autoScrollEnabled = false;
            } else {
                // User scrolled back to bottom — reconnect
                this._autoScrollEnabled = true;
            }
        });
    }
    
    _autoScroll() {
        if (this._autoScrollEnabled && this.outputContainer) {
            this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
        }
    }

    // HTML entity escaper
    _escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Lightweight markdown → HTML renderer
    _renderMarkdown(text) {
        if (!text) return '';
        let html = text;
        // Escape HTML entities first
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Fenced code blocks with language label + copy button
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const langLabel = lang || 'code';
            const trimmed = code.trim();
            const copyId = 'cb_' + Math.random().toString(36).slice(2, 8);
            return `<div style="margin:6px 0;border-radius:6px;overflow:hidden;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 10px;background:rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06);font-size:11px;">
                    <span style="color:rgba(255,255,255,0.45);font-family:sans-serif;">${langLabel}</span>
                    <button onclick="(function(b){var c=b.closest('div').nextElementSibling||b.closest('[style]').querySelector('pre');var t=c?c.innerText:'';navigator.clipboard.writeText(t).then(function(){b.textContent='✓';setTimeout(function(){b.textContent='📋'},1200)}).catch(function(){})})(this)" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.35);font-size:12px;padding:1px 4px;border-radius:3px;transition:color 0.2s;" onmouseenter="this.style.color='rgba(255,255,255,0.7)'" onmouseleave="this.style.color='rgba(255,255,255,0.35)'" title="Copy code">📋</button>
                </div>
                <pre style="margin:0;padding:10px;overflow-x:auto;font-size:12.5px;line-height:1.5;"><code>${trimmed}</code></pre>
            </div>`;
        });

        // Inline code (`...`)
        html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:1px 5px;border-radius:3px;font-size:0.9em;">$1</code>');

        // Tables: detect markdown table blocks and render as HTML tables
        html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
            const rows = tableBlock.trim().split('\n').filter(r => r.trim());
            if (rows.length < 2) return tableBlock;
            // Check if row 2 is a separator (|---|---|)
            const isSep = /^\|[\s\-:]+(\|[\s\-:]+)+\|?$/.test(rows[1]);
            let headerRow = null;
            let dataRows = rows;
            if (isSep) {
                headerRow = rows[0];
                dataRows = rows.slice(2);
            }
            const parseRow = (row) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            let tableHtml = '<div style="overflow-x:auto;margin:6px 0;"><table style="border-collapse:collapse;width:100%;background:rgba(0,0,0,0.2);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);font-size:13px;">';
            if (headerRow) {
                const cells = parseRow(headerRow);
                tableHtml += '<thead><tr>';
                cells.forEach(c => {
                    tableHtml += `<th style="background:rgba(255,255,255,0.08);padding:6px 10px;border:1px solid rgba(255,255,255,0.08);text-align:left;font-weight:600;color:rgba(255,255,255,0.9);white-space:nowrap;">${c}</th>`;
                });
                tableHtml += '</tr></thead>';
            }
            tableHtml += '<tbody>';
            dataRows.forEach((row, i) => {
                const cells = parseRow(row);
                const bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.03)';
                tableHtml += `<tr style="background:${bg};">`;
                cells.forEach(c => {
                    tableHtml += `<td style="padding:5px 10px;border:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.75);">${c}</td>`;
                });
                tableHtml += '</tr>';
            });
            tableHtml += '</tbody></table></div>';
            return tableHtml;
        });

        // Headers (### h3, ## h2, # h1)
        html = html.replace(/^### (.+)$/gm, '<strong style="font-size:1em;display:block;margin:8px 0 4px;">$1</strong>');
        html = html.replace(/^## (.+)$/gm, '<strong style="font-size:1.1em;display:block;margin:10px 0 4px;">$1</strong>');
        html = html.replace(/^# (.+)$/gm, '<strong style="font-size:1.2em;display:block;margin:12px 0 6px;">$1</strong>');
        // Bold (**text** or __text__)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        // Italic (*text* or _text_)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/(?<![\w])_(.+?)_(?![\w])/g, '<em>$1</em>');
        // Unordered lists (- item or * item)
        html = html.replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px;">• $1</div>');
        // Ordered lists (1. item)
        html = html.replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px;">$&</div>');
        // Horizontal rules (--- or ***)
        html = html.replace(/^(---|\*\*\*)$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0;">');
        // Markdown images ![alt](url) — must come before link replacement
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
            return this._renderInlineImage(url, alt);
        });
        // Bare base64 data URI images on their own line
        html = html.replace(/^(data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=\r\n]+)$/gm, (_, dataUri) => {
            return this._renderInlineImage(dataUri.replace(/\s/g, ''), 'Generated image');
        });
        // Bare image URLs on their own line (png, jpg, jpeg, gif, webp, svg)
        html = html.replace(/^(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?)$/gim, (_, url) => {
            return this._renderInlineImage(url, 'Image');
        });
        // Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#4a90e2;text-decoration:underline;">$1</a>');
        // Line breaks (double newline → paragraph break, single → <br>)
        html = html.replace(/\n\n/g, '<br><br>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // Render an inline image with click-to-zoom and download
    _renderInlineImage(src, alt) {
        const uid = 'img_' + Math.random().toString(36).slice(2, 8);
        return `<div style="margin:8px 0;display:inline-block;max-width:100%;">
            <img id="${uid}" src="${src}" alt="${this._escapeHtml(alt || 'image')}"
                style="max-width:100%;max-height:400px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);cursor:pointer;display:block;background:rgba(0,0,0,0.2);transition:opacity 0.3s;"
                onclick="(function(img){
                    var overlay=document.createElement('div');
                    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(4px);';
                    var full=document.createElement('img');
                    full.src=img.src;
                    full.alt=img.alt;
                    full.style.cssText='max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
                    overlay.appendChild(full);
                    var bar=document.createElement('div');
                    bar.style.cssText='position:absolute;bottom:16px;display:flex;gap:10px;align-items:center;';
                    var dlBtn=document.createElement('a');
                    dlBtn.href=img.src;dlBtn.download='image.png';
                    dlBtn.textContent='Download';
                    dlBtn.style.cssText='color:#fff;background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:6px;font-size:12px;text-decoration:none;';
                    dlBtn.onclick=function(e){e.stopPropagation();};
                    bar.appendChild(dlBtn);
                    var caption=document.createElement('span');
                    caption.textContent=img.alt||'';
                    caption.style.cssText='color:rgba(255,255,255,0.5);font-size:11px;';
                    bar.appendChild(caption);
                    overlay.appendChild(bar);
                    overlay.onclick=function(){overlay.remove();};
                    document.body.appendChild(overlay);
                })(this)"
                onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span style=\\'color:rgba(255,100,100,0.7);font-size:12px;\\'>[Image failed to load]</span>')"
            >
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;">${this._escapeHtml(alt || '')}</div>
        </div>`;
    }

    setAvatarUrl(url) {
        this.avatarUrl = url;
    }
    
    // Set the audio URL for the last message
    setLastAudioUrl(url) {
        this.lastAudioUrl = url;
        this.attachAudioToLastMessage(url);
    }
    
    // Attach audio playback button to the last assistant message
    attachAudioToLastMessage(audioUrl) {
        const lastAssistant = this.outputContainer.querySelector('.message.assistant.active-streaming')
            || this.outputContainer.querySelector('.message.assistant:last-of-type');
        if (!lastAssistant) return;
        if (lastAssistant.dataset.audioUrl) return; // Already has audio
        
        const audioBtn = document.createElement('button');
        audioBtn.className = 'msg-audio-btn';
        audioBtn.innerHTML = '🔊';
        audioBtn.title = 'Replay voice';
        audioBtn.style.cssText = 'position:absolute;bottom:8px;right:8px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;opacity:0.5;transition:all 0.2s;z-index:10;';
        audioBtn.onmouseenter = () => { audioBtn.style.opacity = '1'; audioBtn.style.background = 'rgba(255,255,255,0.3)'; };
        audioBtn.onmouseleave = () => { audioBtn.style.opacity = '0.5'; audioBtn.style.background = 'rgba(255,255,255,0.15)'; };
        audioBtn.onclick = (e) => {
            e.stopPropagation();
            try {
                // Use the global audio element or create one
                let audio = document.getElementById('voice-replay-audio');
                if (!audio) {
                    audio = document.createElement('audio');
                    audio.id = 'voice-replay-audio';
                    audio.style.display = 'none';
                    document.body.appendChild(audio);
                }
                // Toggle play/pause
                if (!audio.paused && audio._activeBtn === audioBtn) {
                    audio.pause();
                    audioBtn.innerHTML = '🔊';
                    audioBtn.title = 'Replay voice';
                } else {
                    // If a different button was playing, reset its icon
                    if (audio._activeBtn && audio._activeBtn !== audioBtn) {
                        audio._activeBtn.innerHTML = '🔊';
                        audio._activeBtn.title = 'Replay voice';
                    }
                    audio.src = audioUrl;
                    audio._activeBtn = audioBtn;
                    audioBtn.innerHTML = '⏸';
                    audioBtn.title = 'Pause';
                    audio.play().catch(err => console.warn('Audio replay error:', err));
                    // Reset icon when audio finishes
                    audio.onended = () => {
                        audioBtn.innerHTML = '🔊';
                        audioBtn.title = 'Replay voice';
                    };
                }
            } catch(err) { console.warn('Audio replay error:', err); }
        };
        
        // Ensure message container has relative positioning
        lastAssistant.style.position = 'relative';
        lastAssistant.appendChild(audioBtn);
        lastAssistant.dataset.audioUrl = audioUrl;
    }

    // Add a message — preserves chat history, only replaces the active streaming message
    addMessage(text) {
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        // Finalize any previous "active" assistant message so it becomes part of history
        const activeMsg = this.outputContainer.querySelector('.message.assistant.active-streaming');
        if (activeMsg) {
            activeMsg.classList.remove('active-streaming');
            // Collapse its activity panel if it has one
            const panel = activeMsg.querySelector('.agent-activity-panel');
            if (panel) {
                const body = panel.querySelector('.activity-body');
                const toggle = panel.querySelector('.activity-toggle');
                if (body) body.style.display = 'none';
                if (toggle) toggle.style.transform = 'rotate(-90deg)';
                panel.style.opacity = '0.6';
                // Hide stop button on finalized panels
                const stopBtn = panel.querySelector('.activity-stop-btn');
                if (stopBtn) stopBtn.style.display = 'none';
            }
        }
        
        // Create new message
        const container = document.createElement('div');
        container.className = 'message assistant active-streaming';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = this.avatarUrl || 'default-avatar.png';
        container.appendChild(avatar);
        
        const textContainer = document.createElement('div');
        textContainer.className = 'message-content';
        textContainer.style.cssText = `
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
            word-break: break-word;
            margin: 0;
            padding: 12px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            color: white;
            max-height: 60vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.3) transparent;
        `;
        textContainer.innerHTML = this._renderMarkdown(text);
        container.appendChild(textContainer);
        
        this.outputContainer.appendChild(container);
        this._autoScroll();
    }
    
    // Add a message containing an image (bypasses markdown escaping)
    addImageMessage(src, caption) {
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        const activeMsg = this.outputContainer.querySelector('.message.assistant.active-streaming');
        if (activeMsg) {
            activeMsg.classList.remove('active-streaming');
            const panel = activeMsg.querySelector('.agent-activity-panel');
            if (panel) {
                const body = panel.querySelector('.activity-body');
                const toggle = panel.querySelector('.activity-toggle');
                if (body) body.style.display = 'none';
                if (toggle) toggle.style.transform = 'rotate(-90deg)';
                panel.style.opacity = '0.6';
                const stopBtn = panel.querySelector('.activity-stop-btn');
                if (stopBtn) stopBtn.style.display = 'none';
            }
        }
        
        const container = document.createElement('div');
        container.className = 'message assistant';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = this.avatarUrl || 'default-avatar.png';
        container.appendChild(avatar);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.style.cssText = `
            margin: 0; padding: 12px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            color: white;
        `;
        
        // Caption text above image
        if (caption) {
            const capEl = document.createElement('div');
            capEl.style.cssText = 'font-size:13px;margin-bottom:8px;color:rgba(255,255,255,0.8);font-family:Consolas,Monaco,"Courier New",monospace;';
            capEl.textContent = caption;
            contentDiv.appendChild(capEl);
        }
        
        // Image element
        const img = document.createElement('img');
        img.src = src;
        img.alt = caption || 'Generated image';
        img.style.cssText = 'max-width:100%;max-height:400px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);cursor:pointer;display:block;background:rgba(0,0,0,0.2);';
        img.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(4px);';
            const full = document.createElement('img');
            full.src = src;
            full.alt = caption || '';
            full.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
            overlay.appendChild(full);
            const bar = document.createElement('div');
            bar.style.cssText = 'position:absolute;bottom:16px;display:flex;gap:10px;align-items:center;';
            const dlBtn = document.createElement('a');
            dlBtn.href = src; dlBtn.download = 'image.png';
            dlBtn.textContent = 'Download';
            dlBtn.style.cssText = 'color:#fff;background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:6px;font-size:12px;text-decoration:none;';
            dlBtn.addEventListener('click', (e) => e.stopPropagation());
            bar.appendChild(dlBtn);
            overlay.appendChild(bar);
            overlay.addEventListener('click', () => overlay.remove());
            document.body.appendChild(overlay);
        });
        img.addEventListener('error', () => {
            img.style.display = 'none';
            const errSpan = document.createElement('span');
            errSpan.style.cssText = 'color:rgba(255,100,100,0.7);font-size:12px;';
            errSpan.textContent = '[Image failed to load]';
            contentDiv.appendChild(errSpan);
        });
        contentDiv.appendChild(img);
        container.appendChild(contentDiv);
        
        this.outputContainer.appendChild(container);
        this._autoScroll();
    }
    
    addThinking() {
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        const container = document.createElement('div');
        container.className = 'message thinking';
        container.innerHTML = '<span class="thinking-emoji">⌛</span> thinking...';
        
        this.outputContainer.appendChild(container);
        this._autoScroll();
    }
    
    // Create a streaming thinking panel (replaces generic "thinking..." when actual content is available)
    _createThinkingPanel() {
        // Remove old generic thinking messages
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        // Remove any existing thinking panel (shouldn't happen, but safety)
        const existing = this.outputContainer.querySelector('.thinking-panel');
        if (existing) existing.remove();
        
        const panel = document.createElement('div');
        panel.className = 'thinking-panel';
        panel.style.cssText = 'margin:6px 0;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(180,140,255,0.15);overflow:hidden;font-family:Consolas,Monaco,"Courier New",monospace;';
        
        // Header bar
        const header = document.createElement('div');
        header.className = 'thinking-panel-header';
        header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(180,140,255,0.08);border-bottom:1px solid rgba(180,140,255,0.1);cursor:pointer;user-select:none;';
        header.innerHTML = '<span style="font-size:11px;color:rgba(180,140,255,0.7);">💭</span><span style="font-size:11px;color:rgba(180,140,255,0.7);font-weight:500;">Thinking</span><span class="thinking-spinner" style="font-size:9px;color:rgba(180,140,255,0.4);margin-left:4px;">●●●</span><span class="thinking-toggle" style="margin-left:auto;font-size:9px;color:rgba(255,255,255,0.2);">▾</span>';
        
        // Content area (scrollable, auto-expanded while streaming)
        const content = document.createElement('div');
        content.className = 'thinking-panel-content';
        content.style.cssText = 'padding:8px 12px;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.45);max-height:250px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(180,140,255,0.15) transparent;white-space:pre-wrap;word-break:break-word;';
        
        // Toggle collapse on header click
        header.addEventListener('click', () => {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            const toggle = header.querySelector('.thinking-toggle');
            if (toggle) toggle.textContent = isCollapsed ? '▾' : '▸';
        });
        
        panel.appendChild(header);
        panel.appendChild(content);
        this.outputContainer.appendChild(panel);
        this._autoScroll();
        return panel;
    }
    
    // Append text to the active thinking panel
    _appendThinkingDelta(text) {
        let panel = this.outputContainer.querySelector('.thinking-panel');
        if (!panel) {
            panel = this._createThinkingPanel();
        }
        const content = panel.querySelector('.thinking-panel-content');
        if (content) {
            content.textContent += text;
            // Auto-scroll to bottom of thinking content
            content.scrollTop = content.scrollHeight;
        }
        this._autoScroll();
    }
    
    // Finalize thinking panel — remove spinner, collapse it
    _finalizeThinkingPanel() {
        const panel = this.outputContainer.querySelector('.thinking-panel');
        if (!panel) return;
        const spinner = panel.querySelector('.thinking-spinner');
        if (spinner) spinner.remove();
        const content = panel.querySelector('.thinking-panel-content');
        const header = panel.querySelector('.thinking-panel-header');
        if (content && header) {
            // Show character count in header
            const charCount = (content.textContent || '').length;
            if (charCount > 0) {
                const countLabel = document.createElement('span');
                countLabel.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.15);margin-left:6px;';
                countLabel.textContent = `${charCount} chars`;
                const toggle = header.querySelector('.thinking-toggle');
                if (toggle) header.insertBefore(countLabel, toggle);
            }
            // Auto-collapse after finishing
            content.style.display = 'none';
            const toggle = header.querySelector('.thinking-toggle');
            if (toggle) toggle.textContent = '▸';
        }
    }
    
    // === Agent Activity Panel (Cascade-style) ===
    
    // Get or create the activity panel attached to the current active assistant message
    _getActivityPanel() {
        // Prefer the active streaming message, fall back to last assistant
        let lastAssistant = this.outputContainer.querySelector('.message.assistant.active-streaming')
            || this.outputContainer.querySelector('.message.assistant:last-of-type');
        if (!lastAssistant) {
            this.addMessage('');
            lastAssistant = this.outputContainer.querySelector('.message.assistant:last-of-type');
        }
        
        let panel = lastAssistant.querySelector('.agent-activity-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'agent-activity-panel';
            panel.style.cssText = `
                margin-top: 8px;
                padding: 0;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 12px;
                line-height: 1.5;
                color: rgba(255, 255, 255, 0.7);
                max-height: 300px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.2) transparent;
            `;
            
            // Header row with collapse toggle
            const header = document.createElement('div');
            header.className = 'activity-header';
            header.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                cursor: pointer;
                user-select: none;
                border-radius: 6px 6px 0 0;
                background: rgba(255, 255, 255, 0.05);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            `;
            header.innerHTML = `<span class="activity-toggle" style="font-size: 10px; transition: transform 0.2s;">▼</span>
                <span style="opacity: 0.5; font-size: 11px;">Agent Activity</span>
                <span class="activity-count" style="margin-left: auto; opacity: 0.4; font-size: 10px;">0 steps</span>
                <button class="activity-stop-btn" title="Stop agent" style="
                    background: transparent;
                    border: none;
                    border-radius: 3px;
                    color: rgba(255, 255, 255, 0.2);
                    font-size: 9px;
                    padding: 1px 4px;
                    cursor: pointer;
                    margin-left: 6px;
                    transition: all 0.3s;
                    line-height: 1.4;
                ">■</button>`;
            
            // Stop button handler
            const stopBtn = header.querySelector('.activity-stop-btn');
            stopBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                stopBtn.textContent = '·';
                stopBtn.style.opacity = '0.15';
                stopBtn.disabled = true;
                
                // Call the interrupt API
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
                if (!stopBtn.disabled) {
                    stopBtn.style.color = 'rgba(255, 255, 255, 0.5)';
                }
            });
            stopBtn.addEventListener('mouseleave', () => {
                if (!stopBtn.disabled) {
                    stopBtn.style.color = 'rgba(255, 255, 255, 0.2)';
                }
            });
            
            // Collapse toggle (on header click, not stop button)
            header.addEventListener('click', (e) => {
                if (e.target.closest('.activity-stop-btn')) return;
                const body = panel.querySelector('.activity-body');
                const toggle = header.querySelector('.activity-toggle');
                if (body.style.display === 'none') {
                    body.style.display = 'block';
                    toggle.style.transform = 'rotate(0deg)';
                } else {
                    body.style.display = 'none';
                    toggle.style.transform = 'rotate(-90deg)';
                }
            });
            panel.appendChild(header);
            
            // Body
            const body = document.createElement('div');
            body.className = 'activity-body';
            body.style.cssText = 'padding: 4px 0;';
            panel.appendChild(body);
            
            // Insert panel before the message-content or after it
            const content = lastAssistant.querySelector('.message-content');
            if (content) {
                content.parentNode.insertBefore(panel, content);
            } else {
                lastAssistant.appendChild(panel);
            }
        }
        return panel;
    }
    
    // Add an activity step to the panel
    _addActivityStep(icon, label, detail, status) {
        const panel = this._getActivityPanel();
        const body = panel.querySelector('.activity-body');
        const countEl = panel.querySelector('.activity-count');
        
        const step = document.createElement('div');
        step.className = 'activity-step';
        step.dataset.status = status || 'running';
        step.style.cssText = `
            border-left: 2px solid ${status === 'done' ? 'rgba(100, 255, 100, 0.3)' : status === 'error' ? 'rgba(255, 100, 100, 0.3)' : 'rgba(100, 200, 255, 0.3)'};
            margin: 2px 0;
            transition: opacity 0.3s;
        `;
        
        // Header row (always visible)
        const headerRow = document.createElement('div');
        headerRow.className = 'step-header';
        headerRow.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:3px 10px;cursor:pointer;';
        
        const iconSpan = document.createElement('span');
        iconSpan.className = 'step-icon';
        iconSpan.style.cssText = 'flex-shrink: 0; width: 16px; text-align: center;';
        iconSpan.textContent = icon;
        
        const textSpan = document.createElement('span');
        textSpan.className = 'step-text';
        textSpan.style.cssText = 'flex: 1; word-break: break-word;';
        
        const labelEl = document.createElement('span');
        labelEl.className = 'step-label';
        labelEl.style.cssText = 'color: rgba(255, 255, 255, 0.85); font-weight: 500;';
        labelEl.textContent = label;
        textSpan.appendChild(labelEl);
        
        if (detail) {
            const detailEl = document.createElement('span');
            detailEl.className = 'step-detail';
            detailEl.style.cssText = 'color: rgba(255, 255, 255, 0.45); margin-left: 6px; font-size: 11px;';
            detailEl.textContent = detail;
            textSpan.appendChild(detailEl);
        }
        
        headerRow.appendChild(iconSpan);
        headerRow.appendChild(textSpan);
        step.appendChild(headerRow);
        
        // Output container (hidden by default, shown on click after result arrives)
        const outputDiv = document.createElement('div');
        outputDiv.className = 'step-output';
        outputDiv.style.cssText = `
            display: none;
            margin: 2px 0 4px 26px;
            padding: 6px 10px;
            background: rgba(0, 0, 0, 0.25);
            border-radius: 4px;
            font-size: 11px;
            line-height: 1.4;
            color: rgba(255, 255, 255, 0.6);
            max-height: 200px;
            overflow-y: auto;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-word;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.15) transparent;
            border: 1px solid rgba(255,255,255,0.05);
        `;
        step.appendChild(outputDiv);
        
        // Click to expand/collapse output
        headerRow.addEventListener('click', () => {
            if (!outputDiv.textContent) return;
            outputDiv.style.display = outputDiv.style.display === 'none' ? 'block' : 'none';
        });
        
        body.appendChild(step);
        
        // Update count
        const stepCount = body.querySelectorAll('.activity-step').length;
        if (countEl) countEl.textContent = `${stepCount} step${stepCount !== 1 ? 's' : ''}`;
        
        // Auto-scroll panel
        panel.scrollTop = panel.scrollHeight;
        this._autoScroll();
        
        return step;
    }
    
    // Update the last activity step (e.g., mark as done with output)
    _updateLastStep(icon, detail, status, toolOutput) {
        const panel = this._getActivityPanel();
        const body = panel.querySelector('.activity-body');
        const steps = body.querySelectorAll('.activity-step');
        if (steps.length === 0) return;
        
        const lastStep = steps[steps.length - 1];
        lastStep.dataset.status = status || 'done';
        
        const borderColor = status === 'error' ? 'rgba(255, 100, 100, 0.3)' : 'rgba(100, 255, 100, 0.3)';
        lastStep.style.borderLeftColor = borderColor;
        
        if (icon) {
            const iconSpan = lastStep.querySelector('.step-icon');
            if (iconSpan) iconSpan.textContent = icon;
        }
        
        if (detail) {
            const textSpan = lastStep.querySelector('.step-text');
            if (textSpan) {
                let detailEl = textSpan.querySelector('.step-detail');
                if (detailEl) {
                    detailEl.textContent = detail;
                } else {
                    detailEl = document.createElement('span');
                    detailEl.className = 'step-detail';
                    detailEl.style.cssText = 'color: rgba(255, 255, 255, 0.45); margin-left: 6px; font-size: 11px;';
                    detailEl.textContent = detail;
                    textSpan.appendChild(detailEl);
                }
            }
        }
        
        // Populate the expandable output area
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
                if (outputText.length > 3000) {
                    outputText = outputText.slice(0, 3000) + '\n... (truncated)';
                }
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
                        statusDiv.innerHTML = '<span style="color:rgba(255,100,100,0.8);">✗ exit ' + (exitCode !== null ? exitCode : '1') + '</span>';
                        // Show stderr in red if present
                        if (typeof toolOutput === 'object' && toolOutput.error) {
                            const stderrDiv = document.createElement('div');
                            stderrDiv.style.cssText = 'color:rgba(255,100,100,0.7);margin-top:2px;';
                            stderrDiv.textContent = toolOutput.error;
                            termOutput.appendChild(stderrDiv);
                        }
                    } else {
                        statusDiv.innerHTML = '<span style="color:rgba(80,200,120,0.7);">✓ exit 0</span>';
                    }
                    termOutput.appendChild(statusDiv);
                    // Scroll terminal to bottom
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                } else {
                    // Generic output for non-exec tools
                    outputDiv.textContent = outputText;
                    if (outputDiv.style.display === 'none' || !outputDiv.style.display) {
                        // Keep collapsed for non-exec, add expand hint
                        const headerRow = lastStep.querySelector('.step-header');
                        if (headerRow && !headerRow.querySelector('.expand-hint')) {
                            const hint = document.createElement('span');
                            hint.className = 'expand-hint';
                            hint.style.cssText = 'color:rgba(255,255,255,0.2);font-size:9px;margin-left:auto;flex-shrink:0;';
                            hint.textContent = '▸';
                            headerRow.appendChild(hint);
                        }
                    }
                }
            }
        }
    }
    
    // Clear the activity panel (when final response arrives)
    _finalizeActivityPanel() {
        const lastAssistant = this.outputContainer.querySelector('.message.assistant.active-streaming')
            || this.outputContainer.querySelector('.message.assistant:last-of-type');
        if (!lastAssistant) return;
        
        // Remove active-streaming flag so this message becomes history
        lastAssistant.classList.remove('active-streaming');
        
        const panel = lastAssistant.querySelector('.agent-activity-panel');
        if (panel) {
            // Collapse the panel and dim it
            const body = panel.querySelector('.activity-body');
            const toggle = panel.querySelector('.activity-toggle');
            if (body) body.style.display = 'none';
            if (toggle) toggle.style.transform = 'rotate(-90deg)';
            panel.style.opacity = '0.6';
            // Hide stop button
            const stopBtn = panel.querySelector('.activity-stop-btn');
            if (stopBtn) stopBtn.style.display = 'none';
        }
    }
    
    // Process message from backend
    processMessage(message) {
        console.log('%c 📨 RAW_TEXT_RENDERER processMessage called', 'background: #0066ff; color: #fff; font-size: 14px;', message);
        
        if (!message) return;
        
        // Avatar emotion detection: trigger on completed responses
        try {
            if (window.avatar && window.avatar._detectAndPlayEmotions && message.status !== 'streaming') {
                let emotionText = '';
                if (typeof message.result === 'string') {
                    emotionText = message.result;
                } else if (message.messages) {
                    emotionText = message.messages.filter(m => m.role !== 'user').map(m => m.content).join(' ');
                } else if (typeof message === 'string') {
                    emotionText = message;
                }
                if (emotionText.length > 20 && !this._lastEmotionText || emotionText !== this._lastEmotionText) {
                    this._lastEmotionText = emotionText;
                    console.log('%c 🎭 Triggering emotion detection (status=' + message.status + ')', 'background: #9900ff; color: #fff;', emotionText.substring(0, 80) + '...');
                    window.avatar._detectAndPlayEmotions(emotionText);
                }
            }
        } catch (e) { console.warn('Emotion detection error:', e); }
        
        // Log key flags
        if (message.replace_last) {
            console.log('%c 🔄 MESSAGE HAS replace_last=true, status=' + message.status, 'background: #ff00ff; color: #fff; font-size: 14px;');
        }
        
        // Handle image messages from backend (type: 'image' or contains image_url/image_base64)
        if (message.type === 'image' || message.image_url || message.image_base64) {
            const src = message.image_url || message.image_base64 || '';
            const caption = message.caption || message.alt || message.result || 'Generated image';
            if (src) {
                this.addImageMessage(src, caption);
                return;
            }
        }
        
        // Streaming thinking content from model reasoning
        if (message && message.type === 'thinking_start') {
            this._createThinkingPanel();
            return;
        }
        if (message && message.type === 'thinking_delta') {
            this._appendThinkingDelta(message.content || '');
            return;
        }
        if (message && message.type === 'thinking_end') {
            this._finalizeThinkingPanel();
            return;
        }
        
        if (message && message.type === 'thinking') {
            this.addThinking();
            return;
        }
        
        // === Agent Activity Messages (Cascade-style) ===
        
        // Tool executing: show in activity panel
        if (message.status === 'tool_executing') {
            // Finalize any active streaming bubble so the model's plan text
            // stays visible as a permanent message in chat history
            const activeStreaming = this.outputContainer.querySelector('.message.assistant.active-streaming');
            if (activeStreaming) {
                activeStreaming.classList.remove('active-streaming');
            }
            // Remove thinking indicator and finalize thinking panel
            const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
            thinkingMessages.forEach(msg => msg.remove());
            this._finalizeThinkingPanel();
            
            const toolName = message.tool || 'unknown';
            const detail = message.message || '';
            const step = this._addActivityStep('⚙', toolName, detail.replace(`▶ ${toolName}`, '').trim(), 'running');
            
            // If code_preview is present, show it immediately in the step output (auto-expanded)
            if (step && message.code_preview) {
                const outputDiv = step.querySelector('.step-output');
                if (outputDiv) {
                    if (toolName === 'exec') {
                        // Terminal-style panel for exec commands
                        const cmdText = message.code_preview;
                        outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.4);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:300px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(255,255,255,0.08);font-family:Consolas,Monaco,"Courier New",monospace;';
                        // Terminal header bar
                        const termHeader = document.createElement('div');
                        termHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.06);border-radius:6px 6px 0 0;';
                        termHeader.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:10px;font-weight:500;">Terminal</span><span style="color:rgba(255,255,255,0.15);font-size:9px;">PowerShell</span>';
                        outputDiv.appendChild(termHeader);
                        // Command line with PS> prompt
                        const cmdDiv = document.createElement('div');
                        cmdDiv.className = 'terminal-cmd';
                        cmdDiv.style.cssText = 'padding:6px 10px;white-space:pre-wrap;word-break:break-word;';
                        cmdDiv.innerHTML = '<span style="color:rgba(80,200,120,0.9);font-weight:600;">PS&gt;</span> <span style="color:rgba(255,255,255,0.85);">' + this._escapeHtml(cmdText) + '</span>';
                        outputDiv.appendChild(cmdDiv);
                        // Separator
                        const sep = document.createElement('div');
                        sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.05);margin:0;';
                        outputDiv.appendChild(sep);
                        // Output area (empty, filled on tool_result)
                        const termOutput = document.createElement('div');
                        termOutput.className = 'terminal-output';
                        termOutput.style.cssText = 'padding:6px 10px;white-space:pre-wrap;word-break:break-word;min-height:16px;';
                        // Spinner while running
                        termOutput.innerHTML = '<span class="terminal-spinner" style="color:rgba(100,200,255,0.5);font-size:10px;">Running...</span>';
                        outputDiv.appendChild(termOutput);
                    } else if (message.code_preview_meta && message.code_preview_meta.type === 'write') {
                        // Code editor panel for write_file
                        const meta = message.code_preview_meta;
                        const codeText = message.code_preview;
                        const lines = codeText.split('\n');
                        outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(80,200,120,0.15);font-family:Consolas,Monaco,"Courier New",monospace;';
                        // Editor header bar
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
                        // Code body with line numbers
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
                    } else if (message.code_preview_meta && message.code_preview_meta.type === 'diff') {
                        // Diff panel for edit_file
                        const meta = message.code_preview_meta;
                        let diffData;
                        try { diffData = JSON.parse(message.code_preview); } catch(e) { diffData = {old:'',new:''}; }
                        const oldLines = (diffData.old || '').split('\n');
                        const newLines = (diffData.new || '').split('\n');
                        outputDiv.style.cssText = 'display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(100,180,255,0.15);font-family:Consolas,Monaco,"Courier New",monospace;';
                        // Diff header bar
                        const diffHeader = document.createElement('div');
                        diffHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:rgba(100,180,255,0.08);border-bottom:1px solid rgba(100,180,255,0.1);border-radius:6px 6px 0 0;';
                        diffHeader.innerHTML = '<span style="color:rgba(100,180,255,0.8);font-size:10px;font-weight:500;">' + this._escapeHtml(meta.file || 'edit') + '</span><span style="color:rgba(255,255,255,0.2);font-size:9px;">' + this._escapeHtml(meta.lang || 'text') + '</span>';
                        outputDiv.appendChild(diffHeader);
                        // Removed lines (red)
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
                        // Separator between old and new
                        const diffSep = document.createElement('div');
                        diffSep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.05);margin:0;';
                        outputDiv.appendChild(diffSep);
                        // Added lines (green)
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
                        // Fallback generic code preview
                        outputDiv.innerHTML = this._renderMarkdown(message.code_preview);
                        outputDiv.style.display = 'block';
                    }
                    // Add expand hint
                    const headerRow = step.querySelector('.step-header');
                    if (headerRow && !headerRow.querySelector('.expand-hint')) {
                        const hint = document.createElement('span');
                        hint.className = 'expand-hint';
                        hint.style.cssText = 'color:rgba(255,255,255,0.2);font-size:9px;margin-left:auto;flex-shrink:0;';
                        hint.textContent = '▾';
                        headerRow.appendChild(hint);
                    }
                }
            }
            
            this.startAvatarGlowingEyes();
            
            // Show searching expression for web search tools
            const toolLower = toolName.toLowerCase();
            if (window.avatar && (toolLower.includes('search') || toolLower.includes('browse') || toolLower.includes('web') || toolLower.includes('perplexity') || toolLower.includes('fetch') || toolLower.includes('scrape'))) {
                window.avatar._stopEmotionCycle();
                window.avatar.showEmotion('searching', 15000);
            }
            return;
        }
        
        // Tool result: update activity panel with expandable output
        if (message.status === 'tool_result') {
            const toolName = message.tool || 'unknown';
            const result = message.result || {};
            const isError = result.error || (typeof result === 'object' && result.success === false);
            const detail = message.message || '';
            this._updateLastStep(
                isError ? '✗' : '✓',
                detail.replace(`◀ ${toolName}`, '').trim(),
                isError ? 'error' : 'done',
                result
            );
            return;
        }
        
        // Tool permission required
        if (message.status === 'tool_permission_required') {
            const toolName = message.tool || 'unknown';
            this._addActivityStep('🔐', toolName, 'Awaiting approval...', 'pending');
            return;
        }
        
        // Streaming text mid-task: update active message content inline (model's thoughts/plan)
        if (message.status === 'streaming' && message.result && message.clear_thinking) {
            const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
            thinkingMessages.forEach(msg => msg.remove());
            
            let activeMsg = this.outputContainer.querySelector('.message.assistant.active-streaming');
            if (!activeMsg) {
                this.addMessage('');
                activeMsg = this.outputContainer.querySelector('.message.assistant.active-streaming');
            }
            if (activeMsg) {
                const textContainer = activeMsg.querySelector('.message-content');
                if (textContainer) {
                    textContainer.innerHTML = this._renderMarkdown(message.result);
                    // Auto-scroll the content area if it's overflowing
                    textContainer.scrollTop = textContainer.scrollHeight;
                }
            }
            this._autoScroll();
            return;
        }
        
        // Handle searching status
        if (message.status === 'searching') {
            console.log('%c 🔍 SEARCHING STATUS RECEIVED', 'background: #ff6600; color: #fff; font-size: 16px;');
            this.startSearchMode();
            // Show searching expression on avatar
            if (window.avatar) {
                window.avatar._stopEmotionCycle();
                window.avatar.showEmotion('searching', 15000);
            }
            return;
        }
        
        // Extract text
        let text = '';
        if (typeof message === 'string') {
            text = message;
        } else if (message.messages) {
            message.messages.forEach(msg => {
                if (msg.role !== 'user') text += msg.content + '\n';
            });
        } else if (message.result !== undefined && message.result !== null) {
            text = message.result;
        } else if (message.message) {
            text = message.message;
        } else {
            text = String(message || '');
        }
        
        // Filter out garbage text (random punctuation/brackets from STT noise or buffer splits)
        if (text && text.length < 4 && text.replace(/[^a-zA-Z0-9]/g, '').length === 0) {
            console.log('RawTextRenderer: filtered garbage text:', JSON.stringify(text));
            return;
        }
        
        // Don't render empty text for final messages
        if (!text || !text.trim()) {
            if (message.status === 'done' && message.clear_thinking) {
                // Final done with no text — just finalize activity panel and stop effects
                this._finalizeActivityPanel();
                this.stopAvatarGlowingEyes();
                this.stopSearchMode();
            }
            return;
        }
        
        // KEY FIX: If replace_last is set, handle replacement properly
        if (message.replace_last) {
            let lastAssistant = this.outputContainer.querySelector('.message.assistant.active-streaming')
                || this.outputContainer.querySelector('.message.assistant:last-of-type');
            
            // If no assistant message exists, create one first (for first replacement)
            if (!lastAssistant) {
                console.log('%c ⚠️ No assistant message found - creating placeholder', 'background: #ff9900; color: #000; font-size: 14px;');
                this.addMessage(''); // Create empty message
                lastAssistant = this.outputContainer.querySelector('.message.assistant:last-of-type');
            }
            
            if (lastAssistant) {
                const textContainer = lastAssistant.querySelector('.message-content');
                const avatar = lastAssistant.querySelector('.message-avatar');
                
                if (textContainer) {
                    if (message.status === 'streaming') {
                        // First streaming message with replace_last? Start replacement mode
                        if (!this.isReplacing) {
                            console.log('%c 🔄 FIRST REPLACE_LAST STREAMING - Starting replacement', 'background: #9900ff; color: #fff; font-size: 14px;');
                            this.isReplacing = true;
                            textContainer.textContent = '🔍 '; // Show search indicator
                            // Start glowing eyes - try multiple approaches
                            this.startAvatarGlowingEyes();
                        }
                        // Append streaming text
                        if (textContainer.innerHTML === '🔍 ') {
                            textContainer.innerHTML = this._renderMarkdown(text); // Replace indicator with first text
                        } else {
                            textContainer.innerHTML += this._renderMarkdown(text);
                        }
                    } else if (message.status === 'done') {
                        // Final text - set complete text and stop
                        console.log('%c ✅ REPLACE_LAST DONE - Finishing replacement', 'background: #00ff00; color: #000; font-size: 14px;');
                        textContainer.innerHTML = this._renderMarkdown(text);
                        // Stop glowing eyes
                        this.stopAvatarGlowingEyes();
                        this.stopSearchMode();
                    } else {
                        // Just replace
                        textContainer.innerHTML = this._renderMarkdown(text);
                    }
                }
            }
            this._autoScroll();
            return;
        }
        
        // For 'done' status with activity panel — finalize panel, then show final response
        if (message.status === 'done' && message.clear_thinking) {
            this._finalizeActivityPanel();
            this.stopAvatarGlowingEyes();
            this.stopSearchMode();
            
            // Finalize the plan/thinking bubble so it stays visible in chat
            const activeMsg = this.outputContainer.querySelector('.message.assistant.active-streaming');
            if (activeMsg) {
                const planText = activeMsg.querySelector('.message-content')?.innerText?.trim();
                activeMsg.classList.remove('active-streaming');
                // Only keep plan bubble if it has real content different from the final response
                if (planText && text.trim() && planText !== text.trim()) {
                    activeMsg.classList.add('agent-plan');
                } else {
                    // Same text or empty plan — update in place, no duplicate
                    const textContainer = activeMsg.querySelector('.message-content');
                    if (textContainer) {
                        textContainer.innerHTML = this._renderMarkdown(text.trim());
                        this._autoScroll();
                        return;
                    }
                }
            }
            
            // Create new message bubble for the final response
            if (text.trim()) {
                this.addMessage(text.trim());
                this._autoScroll();
                return;
            }
        }
        
        // Normal message handling (no replace_last)
        this.addMessage(text);
        this._autoScroll();
    }
    
    // Start search mode - wipe message text and start glowing avatar
    startSearchMode() {
        this.isReplacing = true;
        
        // Remove thinking messages
        const thinkingMessages = this.outputContainer.querySelectorAll('.message.thinking');
        thinkingMessages.forEach(msg => msg.remove());
        
        // Find active assistant message and wipe its text
        const lastAssistant = this.outputContainer.querySelector('.message.assistant.active-streaming')
            || this.outputContainer.querySelector('.message.assistant:last-of-type');
        if (lastAssistant) {
            const textContainer = lastAssistant.querySelector('.message-content');
            if (textContainer) {
                // Wipe the text - show searching indicator
                textContainer.textContent = '🔍 Searching for current information...';
            }
            
            // Start glowing avatar
            const avatar = lastAssistant.querySelector('.message-avatar');
            if (avatar) this.startGlow(avatar);
        }
        
        // Also glow the main avatar
        const mainAvatar = document.getElementById('avatar-preview');
        if (mainAvatar) this.startGlow(mainAvatar);
        
        this._autoScroll();
    }
    
    // Stop search mode
    stopSearchMode() {
        this.isReplacing = false;
        this.stopGlow();
    }
    
    // Start glowing effect on an avatar
    startGlow(avatar) {
        if (!avatar) {
            console.log('%c ⚠️ startGlow called with null avatar', 'background: #ff0000; color: #fff;');
            return;
        }
        console.log('%c 👁️ STARTING GLOW on:', 'background: #00ffff; color: #000; font-size: 14px;', avatar.id || avatar.className, avatar);
        
        // Clear any existing glow interval
        if (avatar._glowInterval) {
            clearInterval(avatar._glowInterval);
        }
        
        avatar.dataset.glowing = 'true';
        
        // Apply glow using multiple techniques for visibility
        const applyGlowState = (intense) => {
            if (intense) {
                avatar.style.filter = 'brightness(1.8) drop-shadow(0 0 15px #fff) drop-shadow(0 0 30px #fff)';
                avatar.style.boxShadow = '0 0 20px 10px rgba(255,255,255,0.8), 0 0 40px 20px rgba(0,255,255,0.5)';
                avatar.style.border = '3px solid #fff';
            } else {
                avatar.style.filter = 'brightness(1.5) drop-shadow(0 0 10px #fff) drop-shadow(0 0 20px #fff)';
                avatar.style.boxShadow = '0 0 15px 8px rgba(255,255,255,0.6), 0 0 30px 15px rgba(0,255,255,0.3)';
                avatar.style.border = '2px solid rgba(255,255,255,0.8)';
            }
        };
        
        // Initial glow
        applyGlowState(true);
        
        // Pulse animation
        let bright = true;
        avatar._glowInterval = setInterval(() => {
            applyGlowState(bright);
            bright = !bright;
        }, 400);
    }
    
    // Stop all glowing effects
    stopGlow() {
        console.log('%c 👁️ STOPPING GLOW', 'background: #ff6600; color: #fff;');
        document.querySelectorAll('[data-glowing="true"]').forEach(avatar => {
            if (avatar._glowInterval) {
                clearInterval(avatar._glowInterval);
                avatar._glowInterval = null;
            }
            avatar.style.filter = '';
            avatar.style.boxShadow = '';
            avatar.style.border = '';
            avatar.dataset.glowing = '';
        });
    }
    
    // Start glowing eyes on the animated avatar - directly manipulate DOM
    startAvatarGlowingEyes() {
        console.log('%c 👁️ START AVATAR GLOWING EYES', 'background: #00ffff; color: #000; font-size: 16px; font-weight: bold;');
        
        // Show searching expression on avatar
        if (window.avatar) {
            if (window.avatar._stopEmotionCycle) window.avatar._stopEmotionCycle();
            window.avatar.showEmotion('searching', 30000);
        }
        
        // Try window.avatar first
        if (window.avatar && typeof window.avatar.startGlowingEyes === 'function') {
            console.log('%c Using window.avatar.startGlowingEyes()', 'color: #00ff00;');
            window.avatar.startGlowingEyes();
            return;
        }
        
        // Fallback: directly find and manipulate eye elements
        const eyes = document.querySelectorAll('.eye, .left-eye, .right-eye');
        console.log('%c Found eye elements:', 'color: #00ffff;', eyes.length);
        
        if (eyes.length > 0) {
            this._eyeGlowInterval = setInterval(() => {
                eyes.forEach(eye => {
                    if (!eye._originalBg) eye._originalBg = eye.style.backgroundColor;
                    const intense = Math.random() > 0.5;
                    eye.style.backgroundColor = intense ? '#ffffff' : '#aaffff';
                    eye.style.boxShadow = intense 
                        ? '0 0 20px 10px rgba(255,255,255,1), 0 0 40px 20px rgba(0,255,255,0.6)'
                        : '0 0 15px 8px rgba(255,255,255,0.8), 0 0 30px 15px rgba(0,255,255,0.4)';
                });
            }, 400);
            
            // Initial glow
            eyes.forEach(eye => {
                eye._originalBg = eye.style.backgroundColor;
                eye.style.backgroundColor = '#ffffff';
                eye.style.boxShadow = '0 0 20px 10px rgba(255,255,255,1), 0 0 40px 20px rgba(0,255,255,0.6)';
                eye.style.transition = 'all 0.3s ease-in-out';
            });
        } else {
            console.log('%c ⚠️ No eye elements found in DOM!', 'background: #ff0000; color: #fff;');
        }
    }
    
    // Stop glowing eyes on the animated avatar
    stopAvatarGlowingEyes() {
        console.log('%c 👁️ STOP AVATAR GLOWING EYES', 'background: #ff6600; color: #fff; font-size: 16px;');
        
        // Clear searching expression on avatar
        if (window.avatar && window.avatar._clearExpressionClasses) {
            window.avatar._clearExpressionClasses();
        }
        
        // Try window.avatar first
        if (window.avatar && typeof window.avatar.stopGlowingEyes === 'function') {
            window.avatar.stopGlowingEyes();
        }
        
        // Also clear our fallback interval
        if (this._eyeGlowInterval) {
            clearInterval(this._eyeGlowInterval);
            this._eyeGlowInterval = null;
        }
        
        // Reset eye elements
        const eyes = document.querySelectorAll('.eye, .left-eye, .right-eye');
        eyes.forEach(eye => {
            eye.style.backgroundColor = eye._originalBg || '';
            eye.style.boxShadow = '';
            eye.style.transition = '';
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RawTextRenderer;
}
