// Minimal chat renderer with streaming effects and avatars
console.log("Streaming chat renderer loaded");

document.addEventListener('DOMContentLoaded', function() {
    console.log("Streaming chat renderer initialized");

    // Initialize Mermaid.js with dark theme
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
                darkMode: true,
                background: 'transparent',
                primaryColor: '#6366f1',
                primaryTextColor: '#e2e8f0',
                primaryBorderColor: 'rgba(255,255,255,0.15)',
                lineColor: 'rgba(255,255,255,0.3)',
                secondaryColor: '#4f46e5',
                tertiaryColor: 'rgba(30,30,50,0.8)',
                fontFamily: 'Inter, sans-serif',
                fontSize: '13px'
            }
        });
    }

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
            background-color: rgba(0, 0, 0, 0.18) !important;
            border-radius: 16px !important;
            border-top-left-radius: 6px !important;
            padding: 14px 16px !important;
            color: rgba(255, 255, 255, 0.82) !important;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
            font-size: 13.5px !important;
            line-height: 1.65 !important;
            letter-spacing: -0.005em !important;
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
            border: 1px solid rgba(255, 255, 255, 0.06) !important;
            -webkit-font-smoothing: antialiased !important;
            text-rendering: optimizeLegibility !important;
        }
        
        .message-bubble code {
            background: rgba(0, 0, 0, 0.22) !important;
            padding: 2px 6px !important;
            border-radius: 5px !important;
            font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace !important;
            font-size: 0.87em !important;
            color: rgba(255, 255, 255, 0.85) !important;
            border: 1px solid rgba(255, 255, 255, 0.04) !important;
        }
        
        .message-bubble pre {
            background: rgba(0, 0, 0, 0.30) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 12px !important;
            padding: 14px 16px !important;
            overflow-x: auto !important;
            font-size: 12.5px !important;
            line-height: 1.6 !important;
            margin: 10px 0 !important;
            white-space: pre !important;
            position: relative !important;
        }
        
        .message-bubble pre code {
            background: none !important;
            border: none !important;
            color: #e2e8f0 !important;
            padding: 0 !important;
            font-size: inherit !important;
        }
        
        .message-bubble a {
            color: #93c5fd !important;
            text-decoration: underline !important;
            text-decoration-color: rgba(147,197,253,0.4) !important;
        }
        .message-bubble a:hover {
            color: #bfdbfe !important;
            text-decoration-color: rgba(191,219,254,0.6) !important;
        }
        
        .message-bubble h1, .message-bubble h2, .message-bubble h3, .message-bubble h4 {
            margin: 12px 0 6px 0 !important;
            font-weight: 600 !important;
            line-height: 1.3 !important;
            color: rgba(255,255,255,0.95) !important;
        }
        .message-bubble h1 { font-size: 1.3em !important; border-bottom: 1px solid rgba(255,255,255,0.12) !important; padding-bottom: 4px !important; }
        .message-bubble h2 { font-size: 1.15em !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; padding-bottom: 3px !important; }
        .message-bubble h3 { font-size: 1.05em !important; }
        .message-bubble ul, .message-bubble ol { margin: 6px 0 !important; padding-left: 20px !important; }
        .message-bubble li { margin: 3px 0 !important; line-height: 1.5 !important; }
        .message-bubble blockquote {
            border-left: 3px solid rgba(255,255,255,0.25) !important;
            margin: 8px 0 !important;
            padding: 4px 12px !important;
            color: rgba(255,255,255,0.75) !important;
            font-style: italic !important;
        }
        .message-bubble table { border-collapse: collapse !important; margin: 8px 0 !important; width: 100% !important; font-size: 0.9em !important; }
        .message-bubble th, .message-bubble td { border: 1px solid rgba(255,255,255,0.12) !important; padding: 5px 8px !important; text-align: left !important; }
        .message-bubble th { background: rgba(255,255,255,0.06) !important; font-weight: 600 !important; }
        .message-bubble strong { font-weight: 700 !important; color: rgba(255,255,255,0.95) !important; }
        .message-bubble em { font-style: italic !important; color: rgba(255,255,255,0.85) !important; }
        .message-bubble hr { border: none !important; border-top: 1px solid rgba(255,255,255,0.12) !important; margin: 10px 0 !important; }
        .message-bubble p { margin: 6px 0 !important; line-height: 1.6 !important; }
        .message-bubble p:first-child { margin-top: 0 !important; }
        .message-bubble p:last-child { margin-bottom: 0 !important; }
        .message-bubble .code-lang {
            position: absolute !important;
            top: 4px !important;
            right: 8px !important;
            font-size: 9px !important;
            color: rgba(255,255,255,0.3) !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
        }
        .message-bubble .copy-btn {
            position: absolute !important;
            top: 4px !important;
            right: 4px !important;
            background: rgba(255,255,255,0.1) !important;
            border: 1px solid rgba(255,255,255,0.15) !important;
            border-radius: 4px !important;
            color: rgba(255,255,255,0.4) !important;
            font-size: 10px !important;
            padding: 2px 6px !important;
            cursor: pointer !important;
            opacity: 0 !important;
            transition: opacity 0.2s !important;
        }
        .message-bubble pre:hover .copy-btn { opacity: 1 !important; }
        .message-bubble .copy-btn:hover { background: rgba(255,255,255,0.2) !important; color: rgba(255,255,255,0.7) !important; }
        
        /* User message bubbles */
        .debug-message.user-message {
            text-align: right !important;
        }
        .debug-message.user-message .message-bubble {
            margin-left: 40px !important;
            margin-right: 0 !important;
            background-color: rgba(255, 255, 255, 0.06) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-top-left-radius: 16px !important;
            border-top-right-radius: 6px !important;
            text-align: left !important;
            font-size: 13px !important;
            white-space: pre-wrap !important;
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
            font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
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
        
        /* === Mermaid Diagrams === */
        .mermaid-container {
            background: rgba(0, 0, 0, 0.25) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 12px !important;
            padding: 16px !important;
            margin: 10px 0 !important;
            overflow-x: auto !important;
            text-align: center !important;
        }
        .mermaid-container svg {
            max-width: 100% !important;
            height: auto !important;
        }
        .mermaid-container .mermaid-label {
            font-size: 9px;
            color: rgba(255,255,255,0.25);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            text-align: right;
        }
        .mermaid-error {
            color: rgba(255,100,100,0.7) !important;
            font-size: 11px !important;
            font-style: italic !important;
            padding: 8px !important;
        }

        /* === Slide Cards === */
        .slide-container {
            margin: 10px 0 !important;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .slide-card {
            background: linear-gradient(135deg, rgba(30,30,50,0.9), rgba(20,20,40,0.95)) !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            border-radius: 14px !important;
            padding: 24px 28px !important;
            position: relative;
            overflow: hidden;
        }
        .slide-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 3px;
            background: linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa);
            border-radius: 14px 14px 0 0;
        }
        .slide-card .slide-number {
            position: absolute;
            top: 10px;
            right: 14px;
            font-size: 9px;
            color: rgba(255,255,255,0.2);
            font-weight: 600;
        }
        .slide-card h1, .slide-card h2, .slide-card h3 {
            color: rgba(255,255,255,0.95) !important;
            margin: 0 0 10px 0 !important;
        }
        .slide-card h1 { font-size: 1.4em !important; }
        .slide-card h2 { font-size: 1.15em !important; }
        .slide-card p, .slide-card li {
            color: rgba(255,255,255,0.75) !important;
            font-size: 13px !important;
            line-height: 1.7 !important;
        }
        .slide-card ul, .slide-card ol {
            padding-left: 18px !important;
            margin: 6px 0 !important;
        }
        
        /* === Math (KaTeX) === */
        .math-block {
            background: rgba(0,0,0,0.2) !important;
            border: 1px solid rgba(255,255,255,0.06) !important;
            border-radius: 10px !important;
            padding: 14px 18px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            text-align: center !important;
        }
        .math-inline .katex, .math-block .katex {
            color: rgba(255,255,255,0.9) !important;
            font-size: 1.1em !important;
        }
        .math-error {
            color: rgba(255,100,100,0.6) !important;
            font-size: 11px !important;
            font-family: 'JetBrains Mono', monospace !important;
        }
        
        /* === Chart.js containers === */
        .chart-container {
            background: rgba(0,0,0,0.2) !important;
            border: 1px solid rgba(255,255,255,0.08) !important;
            border-radius: 12px !important;
            padding: 16px !important;
            margin: 10px 0 !important;
            position: relative;
            max-height: 400px;
        }
        .chart-container canvas {
            max-width: 100% !important;
            max-height: 350px !important;
        }
        .chart-container .chart-label {
            font-size: 9px;
            color: rgba(255,255,255,0.25);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            text-align: right;
        }
        
        /* === Live HTML Preview === */
        .live-preview-container {
            position: relative !important;
            background: #0a0a1a !important;
            border: 1px solid rgba(255,255,255,0.06) !important;
            border-radius: 12px !important;
            padding: 8px !important;
            margin: 10px 0 !important;
            overflow: visible !important;
        }
        .live-preview-container .code-lang {
            position: absolute !important;
            top: 8px !important;
            left: 12px !important;
            font-size: 9px !important;
            color: rgba(255,255,255,0.3) !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            z-index: 2 !important;
        }
        .live-preview-container .copy-btn {
            position: absolute !important;
            top: 6px !important;
            right: 130px !important;
            font-size: 10px !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            background: rgba(255,255,255,0.05) !important;
            color: rgba(255,255,255,0.4) !important;
            cursor: pointer !important;
            z-index: 2 !important;
            opacity: 0 !important;
            transition: opacity 0.2s !important;
        }
        .live-preview-container:hover .copy-btn { opacity: 1 !important; }
        .live-preview-container .copy-btn:hover { background: rgba(255,255,255,0.15) !important; color: rgba(255,255,255,0.7) !important; }
        .preview-toggle-btn {
            position: relative !important;
            display: inline-block !important;
            font-size: 10px !important;
            padding: 2px 10px !important;
            border-radius: 4px !important;
            border: 1px solid rgba(99,102,241,0.4) !important;
            background: rgba(99,102,241,0.15) !important;
            color: rgba(180,170,255,0.8) !important;
            cursor: pointer !important;
            z-index: 2 !important;
            font-family: 'Inter', sans-serif !important;
            transition: background 0.2s, border-color 0.2s !important;
            margin-right: 4px !important;
        }
        .preview-toggle-btn:hover {
            background: rgba(99,102,241,0.3) !important;
            border-color: rgba(99,102,241,0.6) !important;
        }
        .live-preview-container .code-lang,
        .live-preview-container .copy-btn,
        .live-preview-container .preview-toggle-btn {
            position: relative !important;
            top: auto !important;
            right: auto !important;
            left: auto !important;
        }
        .live-preview-container > .code-lang,
        .live-preview-container > .copy-btn,
        .live-preview-container > .preview-toggle-btn {
            display: inline-block !important;
            vertical-align: middle !important;
            margin-right: 6px !important;
            margin-bottom: 6px !important;
            opacity: 1 !important;
        }
        .preview-frame-wrap {
            background: #0a0a1a !important;
            border-radius: 6px !important;
        }
        .preview-corner-grip {
            position: absolute !important;
            bottom: -2px !important;
            right: -2px !important;
            width: 16px !important;
            height: 16px !important;
            cursor: nwse-resize !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: rgba(255,255,255,0.2) !important;
            transition: color 0.2s !important;
            z-index: 3 !important;
        }
        .preview-corner-grip:hover {
            color: rgba(99,102,241,0.6) !important;
        }
        .preview-fullscreen-overlay {
            position: fixed !important;
            inset: 0 !important;
            z-index: 99999 !important;
            display: flex !important;
            flex-direction: column !important;
            background: rgba(0,0,0,0.85) !important;
            backdrop-filter: blur(20px) !important;
        }
        .preview-fs-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 12px 24px !important;
            border-bottom: 1px solid rgba(255,255,255,0.06) !important;
        }
        .preview-fs-label {
            font-size: 10px !important;
            color: rgba(255,255,255,0.3) !important;
            text-transform: uppercase !important;
            letter-spacing: 1px !important;
            font-family: 'Inter', sans-serif !important;
        }
        .preview-fs-close {
            font-size: 11px !important;
            padding: 4px 14px !important;
            border-radius: 8px !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            background: rgba(255,255,255,0.05) !important;
            color: rgba(255,255,255,0.5) !important;
            cursor: pointer !important;
            font-family: 'Inter', sans-serif !important;
            transition: all 0.2s !important;
        }
        .preview-fs-close:hover {
            background: rgba(255,255,255,0.1) !important;
            color: rgba(255,255,255,0.8) !important;
        }
        .preview-fs-body {
            flex: 1 !important;
            padding: 16px !important;
            overflow: auto !important;
        }

        /* === Rich Message Card (structured research responses) === */
        .rich-card {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .rich-card .rich-preamble {
            font-size: 13px;
            line-height: 1.65;
            color: rgba(255,255,255,0.75);
        }
        .rich-card .rich-section-header {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            color: rgba(99,102,241,0.5);
            margin-bottom: 2px;
        }
        .rich-card .rich-section-header button {
            background: none;
            border: none;
            color: rgba(99,102,241,0.4);
            cursor: pointer;
            font-size: 10px;
            padding: 0;
            transition: color 0.2s;
        }
        .rich-card .rich-section-header button:hover {
            color: rgba(99,102,241,0.7);
        }
        .rich-section {
            border-left: 2px solid rgba(99,102,241,0.15);
            padding-left: 12px;
            padding-top: 2px;
            padding-bottom: 2px;
        }
        .rich-section .rich-section-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
            width: 100%;
            background: none;
            border: none;
            padding: 2px 0;
            text-align: left;
        }
        .rich-section .rich-section-toggle:hover .rich-section-title {
            color: rgba(255,255,255,0.85);
        }
        .rich-section .rich-section-chevron {
            font-size: 8px;
            color: rgba(99,102,241,0.35);
            transition: transform 0.2s;
            flex-shrink: 0;
        }
        .rich-section .rich-section-chevron.expanded {
            transform: rotate(90deg);
        }
        .rich-section .rich-section-title {
            font-size: 12px;
            font-weight: 600;
            color: rgba(255,255,255,0.7);
            transition: color 0.2s;
        }
        .rich-section .rich-section-body {
            margin-top: 6px;
            margin-left: 16px;
            font-size: 12.5px;
            line-height: 1.65;
            color: rgba(255,255,255,0.6);
        }
        .rich-section .rich-section-body.collapsed {
            display: none;
        }
        .rich-sources {
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.05);
        }
        .rich-sources .rich-sources-label {
            font-size: 9px;
            color: rgba(255,255,255,0.25);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .rich-sources .rich-source-pills {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }
        .rich-source-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 5px;
            font-size: 10px;
            background: rgba(0,180,220,0.06);
            border: 1px solid rgba(0,180,220,0.12);
            color: rgba(100,200,240,0.6);
            text-decoration: none;
            transition: all 0.2s;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .rich-source-pill:hover {
            color: rgba(100,200,240,0.9);
            background: rgba(0,180,220,0.12);
            border-color: rgba(0,180,220,0.25);
        }
        .rich-stats {
            display: flex;
            gap: 12px;
            font-size: 9px;
            color: rgba(255,255,255,0.18);
        }
        .rich-copy-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 5px;
            font-size: 10px;
            color: rgba(255,255,255,0.25);
            background: none;
            border: none;
            cursor: pointer;
            transition: all 0.2s;
        }
        .rich-copy-btn:hover {
            color: rgba(255,255,255,0.6);
            background: rgba(255,255,255,0.06);
        }

        /* === Highlight.js overrides for dark theme === */
        pre code.hljs {
            background: transparent !important;
            padding: 0 !important;
        }
        pre {
            position: relative !important;
        }

        /* === Zoom indicator === */
        .zoom-indicator {
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: rgba(0,0,0,0.7);
            color: rgba(255,255,255,0.8);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-family: 'Inter', sans-serif;
            z-index: 99999;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .zoom-indicator.visible { opacity: 1; }
    `;
    document.head.appendChild(styleEl);
    
    // === Ctrl+Scroll Font Size Zoom ===
    let chatZoom = parseFloat(localStorage.getItem('chat-zoom') || '100');
    const zoomMin = 60, zoomMax = 180, zoomStep = 5;
    
    function applyZoom() {
        const output = document.getElementById('output');
        if (output) output.style.fontSize = chatZoom + '%';
        localStorage.setItem('chat-zoom', String(chatZoom));
    }
    applyZoom(); // apply saved zoom on load
    
    // Zoom indicator element
    const zoomIndicator = document.createElement('div');
    zoomIndicator.className = 'zoom-indicator';
    document.body.appendChild(zoomIndicator);
    let zoomTimeout = null;
    
    function showZoomIndicator() {
        zoomIndicator.textContent = Math.round(chatZoom) + '%';
        zoomIndicator.classList.add('visible');
        if (zoomTimeout) clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => zoomIndicator.classList.remove('visible'), 1200);
    }
    
    document.addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        const output = document.getElementById('output');
        if (!output || !output.contains(e.target)) return;
        e.preventDefault();
        if (e.deltaY < 0) {
            chatZoom = Math.min(zoomMax, chatZoom + zoomStep);
        } else {
            chatZoom = Math.max(zoomMin, chatZoom - zoomStep);
        }
        applyZoom();
        showZoomIndicator();
    }, { passive: false });

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
    
    // Global counter for unique IDs on special blocks
    let _richBlockId = 0;
    // Pending post-render tasks (mermaid, chart, katex) collected during formatText
    let _pendingRenders = [];
    
    // === Rich Message Card Renderer ===
    // Mirrors dashboard's RichMessageCard: parses structured responses into
    // collapsible sections, source URL pills, stats footer, copy button.
    // Returns HTML string if the message is "rich enough", or null to fall back to formatText.
    function renderRichMessage(rawText) {
        if (!rawText || rawText.length < 200) return null;

        // Extract source URLs
        var sourceUrls = [];
        var seenUrls = {};
        // Markdown links [label](url)
        var mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        var m;
        while ((m = mdLinkRe.exec(rawText)) !== null) {
            if (!seenUrls[m[2]]) { seenUrls[m[2]] = true; sourceUrls.push({ url: m[2], label: m[1].slice(0, 40) }); }
        }
        // Bare URLs
        var bareRe = /(?<!\()https?:\/\/[^\s)<>\]]+/g;
        while ((m = bareRe.exec(rawText)) !== null) {
            var url = m[0].replace(/[.,;:!?]+$/, '');
            if (!seenUrls[url]) {
                seenUrls[url] = true;
                try { var host = new URL(url).hostname.replace(/^www\./, ''); sourceUrls.push({ url: url, label: host }); }
                catch(e) { sourceUrls.push({ url: url, label: url.slice(0, 35) }); }
            }
        }

        // Count code blocks and list items
        var codeBlockCount = Math.floor((rawText.match(/```/g) || []).length / 2);
        var listItemCount = (rawText.match(/^[-*+] |^\d+\. /gm) || []).length;

        // Extract code blocks first to avoid misidentifying headings inside them
        var codeBlockStore = [];
        var textForParsing = rawText.replace(/```[\w#+]*?\n[\s\S]*?```/g, function(match) {
            var idx = codeBlockStore.length;
            codeBlockStore.push(match);
            return '\x00CODEBLOCK' + idx + '\x00';
        });

        // Split into sections by headings
        var lines = textForParsing.split('\n');
        var sections = [];
        var preambleLines = [];
        var currentHeading = '';
        var currentLevel = 2;
        var currentBody = [];
        var foundFirstHeading = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var headingMatch = line.match(/^(#{1,3})\s+(.+)/);
            if (headingMatch) {
                if (foundFirstHeading && (currentHeading || currentBody.length)) {
                    sections.push({ heading: currentHeading || 'Overview', body: currentBody.join('\n').trim(), level: currentLevel });
                }
                foundFirstHeading = true;
                currentLevel = headingMatch[1].length;
                currentHeading = headingMatch[2].trim();
                currentBody = [];
            } else if (!foundFirstHeading) {
                preambleLines.push(line);
            } else {
                currentBody.push(line);
            }
        }
        if (foundFirstHeading && (currentHeading || currentBody.length)) {
            sections.push({ heading: currentHeading || 'Overview', body: currentBody.join('\n').trim(), level: currentLevel });
        }
        var preamble = preambleLines.join('\n').trim();

        // Restore code blocks in section bodies and preamble
        function restoreCodeBlocks(text) {
            return text.replace(/\x00CODEBLOCK(\d+)\x00/g, function(_, idx) { return codeBlockStore[parseInt(idx)]; });
        }
        preamble = restoreCodeBlocks(preamble);
        sections.forEach(function(s) { s.body = restoreCodeBlocks(s.body); });

        // Determine if "rich enough" for card rendering
        var isRich =
            sections.length >= 2 ||
            (sections.length >= 1 && sourceUrls.length > 0) ||
            (sections.length >= 1 && codeBlockCount >= 2) ||
            (sections.length >= 1 && listItemCount >= 5) ||
            rawText.length > 800;

        if (!isRich) return null;

        // Build the rich card HTML
        var html = '<div class="rich-card">';

        // Preamble
        if (preamble) {
            html += '<div class="rich-preamble">' + formatText(preamble) + '</div>';
        }

        // Section count header + collapse toggle
        if (sections.length > 1) {
            html += '<div class="rich-section-header">';
            html += '<span>\u25A6 ' + sections.length + ' sections</span>';
            html += '<button onclick="(function(btn){var card=btn.closest(\'.rich-card\');var bodies=card.querySelectorAll(\'.rich-section-body\');var chevrons=card.querySelectorAll(\'.rich-section-chevron\');var anyVisible=false;bodies.forEach(function(b){if(!b.classList.contains(\'collapsed\'))anyVisible=true;});bodies.forEach(function(b){if(anyVisible)b.classList.add(\'collapsed\');else b.classList.remove(\'collapsed\');});chevrons.forEach(function(c){if(anyVisible)c.classList.remove(\'expanded\');else c.classList.add(\'expanded\');});btn.textContent=anyVisible?\'\u25B8 Expand all\':\'\u25BE Collapse all\';})(this)">\u25BE Collapse all</button>';
            html += '</div>';
        }

        // Sections
        if (sections.length > 0) {
            sections.forEach(function(section) {
                html += '<div class="rich-section">';
                html += '<button class="rich-section-toggle" onclick="var body=this.nextElementSibling;var chevron=this.querySelector(\'.rich-section-chevron\');body.classList.toggle(\'collapsed\');chevron.classList.toggle(\'expanded\');">';
                html += '<span class="rich-section-chevron expanded">\u25B6</span>';
                html += '<span class="rich-section-title">' + section.heading.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
                html += '</button>';
                html += '<div class="rich-section-body">' + formatText(section.body) + '</div>';
                html += '</div>';
            });
        }

        // Source URLs
        if (sourceUrls.length > 0) {
            html += '<div class="rich-sources">';
            html += '<div class="rich-sources-label">\uD83D\uDCD6 Sources</div>';
            html += '<div class="rich-source-pills">';
            var maxSources = Math.min(sourceUrls.length, 8);
            for (var j = 0; j < maxSources; j++) {
                var src = sourceUrls[j];
                var escapedUrl = src.url.replace(/"/g, '&quot;');
                var escapedLabel = src.label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                html += '<a class="rich-source-pill" href="' + escapedUrl + '" target="_blank" rel="noopener noreferrer">\u2197 ' + escapedLabel + '</a>';
            }
            if (sourceUrls.length > 8) {
                html += '<span style="font-size:9px;color:rgba(255,255,255,0.2);">+' + (sourceUrls.length - 8) + ' more</span>';
            }
            html += '</div></div>';
        }

        // Stats footer
        if (codeBlockCount > 0 || listItemCount > 3) {
            html += '<div class="rich-stats">';
            if (codeBlockCount > 0) html += '<span># ' + Math.round(codeBlockCount) + ' code block' + (Math.round(codeBlockCount) !== 1 ? 's' : '') + '</span>';
            if (listItemCount > 3) html += '<span>\u2261 ' + listItemCount + ' items</span>';
            html += '</div>';
        }

        // Copy button
        html += '<div><button class="rich-copy-btn" onclick="var bubble=this.closest(\'.message-bubble\');var raw=bubble?bubble.dataset.rawText:\'\';if(!raw)raw=bubble?bubble.textContent:\'\';navigator.clipboard.writeText(raw.trim()).then(function(){event.target.textContent=\'\u2713 Copied\';setTimeout(function(){event.target.textContent=\'\u2398 Copy\'},1200)}).catch(function(){});">\u2398 Copy</button></div>';

        html += '</div>';
        return html;
    }

    // Semantic markdown → HTML renderer with rich block support
    function formatText(text) {
        if (!text) return '';
        _pendingRenders = [];
        function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

        var s = text;

        // Extract ALL fenced code blocks first — special langs get rich containers
        var codeBlocks = [];
        s = s.replace(/```([\w#+]*?)\n([\s\S]*?)```/g, function(_, lang, code) {
            var idx = codeBlocks.length;
            var cleanCode = code.replace(/^\n|\n$/g, '');
            var lowerLang = (lang || '').toLowerCase();
            
            // Mermaid diagrams
            if (lowerLang === 'mermaid') {
                var mid = 'mermaid-' + (++_richBlockId);
                _pendingRenders.push({ type: 'mermaid', id: mid, code: cleanCode });
                codeBlocks.push('<div class="mermaid-container"><div class="mermaid-label">Diagram</div><div id="' + mid + '" class="mermaid-render"></div></div>');
                return '\x00CB' + idx + '\x00';
            }
            
            // Chart.js charts (JSON config)
            if (lowerLang === 'chart' || lowerLang === 'chartjs') {
                var cid = 'chart-' + (++_richBlockId);
                _pendingRenders.push({ type: 'chart', id: cid, code: cleanCode });
                codeBlocks.push('<div class="chart-container"><div class="chart-label">Chart</div><canvas id="' + cid + '"></canvas></div>');
                return '\x00CB' + idx + '\x00';
            }
            
            // Slide presentations
            if (lowerLang === 'slide' || lowerLang === 'slides') {
                var slides = cleanCode.split(/^---+$/m);
                var slideHtml = '<div class="slide-container">';
                slides.forEach(function(slide, i) {
                    slideHtml += '<div class="slide-card"><span class="slide-number">' + (i + 1) + ' / ' + slides.length + '</span>';
                    // Mini-render inside each slide: headings, bold, lists, inline code
                    var sc = esc(slide.trim());
                    sc = sc.replace(/^### (.+)$/gm, '<h3>$1</h3>');
                    sc = sc.replace(/^## (.+)$/gm, '<h2>$1</h2>');
                    sc = sc.replace(/^# (.+)$/gm, '<h1>$1</h1>');
                    sc = sc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                    sc = sc.replace(/`([^`]+)`/g, '<code>$1</code>');
                    // Lists
                    sc = sc.replace(/^(?:[-*+] .+\n?)+/gm, function(block) {
                        var items = block.trim().split('\n').map(function(line) {
                            return '<li>' + line.replace(/^[-*+] /, '') + '</li>';
                        }).join('');
                        return '<ul>' + items + '</ul>';
                    });
                    sc = sc.replace(/^(?:\d+\. .+\n?)+/gm, function(block) {
                        var items = block.trim().split('\n').map(function(line) {
                            return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
                        }).join('');
                        return '<ol>' + items + '</ol>';
                    });
                    // Paragraphs for remaining text
                    var sParts = sc.split(/\n{2,}/);
                    sc = sParts.map(function(p) {
                        var t = p.trim();
                        if (!t) return '';
                        if (/^<(?:h[1-3]|ul|ol)/.test(t)) return t;
                        return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
                    }).join('\n');
                    slideHtml += sc + '</div>';
                });
                slideHtml += '</div>';
                codeBlocks.push(slideHtml);
                return '\x00CB' + idx + '\x00';
            }
            
            // Live HTML/CSS/JS preview — render inline in a sandboxed iframe
            if (lowerLang === 'html' && (cleanCode.indexOf('<') !== -1)) {
                var pid = 'htmlpreview-' + (++_richBlockId);
                _pendingRenders.push({ type: 'html-preview', id: pid, code: cleanCode });
                var langLabel = '<span class="code-lang">HTML Preview</span>';
                var copyBtn = '<button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest(\'.live-preview-container\').querySelector(\'code\').textContent).then(function(){event.target.textContent=\'Copied!\';setTimeout(function(){event.target.textContent=\'Copy\'},1200)})">Copy</button>';
                var toggleBtn = '<button class="preview-toggle-btn" onclick="var w=this.closest(\'.live-preview-container\');var p=w.querySelector(\'.preview-frame-wrap\');var c=w.querySelector(\'pre\');if(p.style.display===\'none\'){p.style.display=\'\';c.style.display=\'none\';this.textContent=\'Code\'}else{p.style.display=\'none\';c.style.display=\'\';this.textContent=\'Preview\'}">Code</button>';
                var fullscreenBtn = '<button class="preview-toggle-btn" onclick="var w=this.closest(\'.live-preview-container\');var iframe=w.querySelector(\'iframe\');if(!iframe)return;var overlay=document.createElement(\'div\');overlay.className=\'preview-fullscreen-overlay\';overlay.innerHTML=\'<div class=&quot;preview-fs-header&quot;><span class=&quot;preview-fs-label&quot;>HTML PREVIEW</span><button class=&quot;preview-fs-close&quot;>Exit Fullscreen</button></div><div class=&quot;preview-fs-body&quot;></div>\';var newIframe=iframe.cloneNode(true);newIframe.style.cssText=\'width:100%;height:100%;border:none;border-radius:8px;background:#0a0a1a;\';overlay.querySelector(\'.preview-fs-body\').appendChild(newIframe);overlay.querySelector(\'.preview-fs-close\').onclick=function(){overlay.remove()};overlay.addEventListener(\'click\',function(e){if(e.target===overlay)overlay.remove()});document.body.appendChild(overlay)">Fullscreen</button>';
                var cornerGrip = '<div class="preview-corner-grip" onmousedown="var wrap=this.parentElement.querySelector(\'.preview-frame-wrap\');var startX=event.clientX;var startY=event.clientY;var startW=wrap.offsetWidth;var startH=wrap.offsetHeight;var onMove=function(e){wrap.style.width=Math.max(250,startW+(e.clientX-startX))+\'px\';wrap.style.height=Math.max(150,startH+(e.clientY-startY))+\'px\';var ifr=wrap.querySelector(\'iframe\');if(ifr){ifr.style.width=\'100%\';ifr.style.height=\'100%\';}};var onUp=function(){document.removeEventListener(\'mousemove\',onMove);document.removeEventListener(\'mouseup\',onUp);document.body.style.cursor=\'\';document.body.style.userSelect=\'\'};document.addEventListener(\'mousemove\',onMove);document.addEventListener(\'mouseup\',onUp);document.body.style.cursor=\'nwse-resize\';document.body.style.userSelect=\'none\';event.preventDefault()"><svg width=\'10\' height=\'10\' viewBox=\'0 0 10 10\' fill=\'currentColor\'><circle cx=\'8\' cy=\'8\' r=\'1.2\'/><circle cx=\'4\' cy=\'8\' r=\'1.2\'/><circle cx=\'8\' cy=\'4\' r=\'1.2\'/></svg></div>';
                codeBlocks.push('<div class="live-preview-container">' + langLabel + copyBtn + toggleBtn + fullscreenBtn +
                    '<div class="preview-frame-wrap" id="' + pid + '" style="width:100%;min-height:200px;border-radius:6px;overflow:visible;margin:6px 0;position:relative;"></div>' +
                    cornerGrip +
                    '<pre style="display:none;"><code class="language-html">' + esc(cleanCode) + '</code></pre></div>');
                return '\x00CB' + idx + '\x00';
            }

            // Normalise language aliases for highlight.js
            var hljsLang = lowerLang;
            if (hljsLang === 'c#') hljsLang = 'csharp';
            if (hljsLang === 'c++' || hljsLang === 'cpp') hljsLang = 'cpp';
            if (hljsLang === 'f#') hljsLang = 'fsharp';
            if (hljsLang === 'obj-c' || hljsLang === 'objc') hljsLang = 'objectivec';

            // Regular code block with language class for highlight.js
            var langClass = hljsLang ? ' class="language-' + esc(hljsLang) + '"' : '';
            var langLabel = lang ? '<span class="code-lang">' + esc(lang) + '</span>' : '';
            var copyBtn = '<button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector(\'code\').textContent).then(function(){event.target.textContent=\'Copied!\';setTimeout(function(){event.target.textContent=\'Copy\'},1200)})">Copy</button>';
            codeBlocks.push('<pre>' + langLabel + copyBtn + '<code' + langClass + '>' + esc(cleanCode) + '</code></pre>');
            return '\x00CB' + idx + '\x00';
        });

        // Extract display math blocks $$...$$ before escaping
        var mathBlocks = [];
        s = s.replace(/\$\$([\s\S]+?)\$\$/g, function(_, math) {
            var midx = mathBlocks.length;
            var mid = 'mathblock-' + (++_richBlockId);
            _pendingRenders.push({ type: 'katex-block', id: mid, code: math.trim() });
            mathBlocks.push('<div class="math-block" id="' + mid + '"></div>');
            return '\x00MB' + midx + '\x00';
        });

        // Escape remaining HTML
        s = esc(s);

        // Restore code blocks and math blocks
        s = s.replace(/\x00CB(\d+)\x00/g, function(_, idx) { return codeBlocks[parseInt(idx)]; });
        s = s.replace(/\x00MB(\d+)\x00/g, function(_, idx) { return mathBlocks[parseInt(idx)]; });

        // Inline math $...$ (after escaping so $ aren't eaten)
        s = s.replace(/\$([^\$\n]+?)\$/g, function(_, math) {
            var mid = 'mathinline-' + (++_richBlockId);
            _pendingRenders.push({ type: 'katex-inline', id: mid, code: math.trim() });
            return '<span class="math-inline" id="' + mid + '"></span>';
        });

        // Headings
        s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Horizontal rules
        s = s.replace(/^---+$/gm, '<hr>');
        s = s.replace(/^\*\*\*+$/gm, '<hr>');

        // Bold and italic
        s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
        s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

        // Inline code
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Links [text](url)
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        // Bare URLs (not already inside an href)
        s = s.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

        // Blockquotes
        s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        s = s.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Tables (GFM-style)
        s = s.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm, function(_, header, sep, body) {
            var ths = header.split('|').filter(function(c){return c.trim();}).map(function(c){return '<th>'+c.trim()+'</th>';}).join('');
            var rows = body.trim().split('\n').map(function(row) {
                var tds = row.split('|').filter(function(c){return c.trim();}).map(function(c){return '<td>'+c.trim()+'</td>';}).join('');
                return '<tr>' + tds + '</tr>';
            }).join('');
            return '<table><thead><tr>' + ths + '</tr></thead><tbody>' + rows + '</tbody></table>';
        });

        // Unordered lists
        s = s.replace(/^(?:[-*+] .+\n?)+/gm, function(block) {
            var items = block.trim().split('\n').map(function(line) {
                return '<li>' + line.replace(/^[-*+] /, '') + '</li>';
            }).join('');
            return '<ul>' + items + '</ul>';
        });

        // Ordered lists
        s = s.replace(/^(?:\d+\. .+\n?)+/gm, function(block) {
            var items = block.trim().split('\n').map(function(line) {
                return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
            }).join('');
            return '<ol>' + items + '</ol>';
        });

        // Detect ASCII art lines
        function isAsciiArtLine(line) {
            if (!line.trim()) return false; // blank lines handled separately
            // Skip lines that are HTML markup
            if (/^<[a-z]/.test(line.trim()) || /<\/[a-z]+>$/.test(line.trim())) return false;
            // Box-drawing: +---, |...|, +---------+
            if (/[+|][-=+]{2,}[+|]/.test(line)) return true;
            // Lines starting with | (table/diagram columns)
            if (/^\s*\|/.test(line)) return true;
            // Unicode box-drawing
            if (/[┌┐└┘├┤┬┴─│╔╗╚╝║═]/.test(line)) return true;
            // Lines with multiple consecutive spaces in the middle (aligned columns)
            if (/\S {3,}\S/.test(line)) return true;
            // Lines starting with 4+ spaces (indented preformatted)
            if (/^ {4,}\S/.test(line)) return true;
            // Arrow patterns
            if (/[-=]{2,}>|<[-=]{2,}|-->|<--/.test(line)) return true;
            // Lines that are mostly non-alpha (symbols, dashes, pipes)
            var nonAlpha = line.replace(/[a-zA-Z0-9 ]/g, '').length;
            if (nonAlpha > line.trim().length * 0.4 && line.trim().length > 3) return true;
            return false;
        }
        
        // Extract ASCII art blocks before paragraph splitting
        // Scan lines, group consecutive ASCII-art lines (allowing up to 1 blank line gap)
        var asciiBlocks = [];
        var allLines = s.split('\n');
        var i = 0;
        while (i < allLines.length) {
            if (isAsciiArtLine(allLines[i])) {
                var start = i;
                var blankGap = 0;
                while (i < allLines.length) {
                    if (isAsciiArtLine(allLines[i])) {
                        blankGap = 0;
                        i++;
                    } else if (allLines[i].trim() === '' && blankGap < 2) {
                        // Allow blank lines within a diagram block
                        blankGap++;
                        i++;
                    } else {
                        break;
                    }
                }
                // Trim trailing blank lines
                while (i > start && allLines[i - 1].trim() === '') i--;
                // Only extract if we have 3+ art lines
                var artLineCount = 0;
                for (var j = start; j < i; j++) {
                    if (isAsciiArtLine(allLines[j])) artLineCount++;
                }
                if (artLineCount >= 3) {
                    var blockContent = allLines.slice(start, i).join('\n');
                    var aidx = asciiBlocks.length;
                    asciiBlocks.push('<pre style="background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px 16px;margin:8px 0;color:rgba(255,255,255,0.75);font-size:0.82em;line-height:1.4;overflow-x:auto;">' + blockContent + '</pre>');
                    // Replace the lines with a placeholder
                    allLines.splice(start, i - start, '\x00AB' + aidx + '\x00');
                    i = start + 1;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        s = allLines.join('\n');
        
        // Restore ASCII art blocks
        s = s.replace(/\x00AB(\d+)\x00/g, function(_, idx) { return asciiBlocks[parseInt(idx)]; });

        // Paragraphs
        var parts = s.split(/\n{2,}/);
        s = parts.map(function(part) {
            var trimmed = part.trim();
            if (!trimmed) return '';
            if (/^<(?:h[1-6]|pre|ul|ol|table|blockquote|hr|div|span)/.test(trimmed)) return trimmed;
            return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
        }).join('\n');

        return s;
    }
    
    // Post-render: activate mermaid diagrams, charts, and KaTeX after HTML is in the DOM
    function postRenderRichBlocks() {
        var tasks = _pendingRenders.slice();
        _pendingRenders = [];
        
        // Small delay to ensure DOM has updated
        setTimeout(function() {
            tasks.forEach(function(task) {
                try {
                    var el = document.getElementById(task.id);
                    if (!el) return;
                    
                    if (task.type === 'mermaid') {
                        if (typeof mermaid !== 'undefined') {
                            // Mermaid 10+ uses .render() with a callback
                            mermaid.render(task.id + '-svg', task.code).then(function(result) {
                                el.innerHTML = result.svg;
                            }).catch(function(err) {
                                console.warn('Mermaid render error:', err);
                                el.innerHTML = '<div class="mermaid-error">Diagram error: ' + (err.message || err) + '</div><pre style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:6px;">' + task.code.replace(/</g,'&lt;') + '</pre>';
                            });
                        } else {
                            el.innerHTML = '<div class="mermaid-error">Mermaid.js not loaded</div>';
                        }
                    }
                    
                    else if (task.type === 'chart') {
                        if (typeof Chart !== 'undefined') {
                            try {
                                var config = JSON.parse(task.code);
                                // Apply dark theme defaults
                                if (!config.options) config.options = {};
                                if (!config.options.plugins) config.options.plugins = {};
                                if (!config.options.plugins.legend) config.options.plugins.legend = {};
                                if (!config.options.plugins.legend.labels) config.options.plugins.legend.labels = {};
                                config.options.plugins.legend.labels.color = 'rgba(255,255,255,0.7)';
                                if (!config.options.scales) config.options.scales = {};
                                ['x','y'].forEach(function(axis) {
                                    if (!config.options.scales[axis]) config.options.scales[axis] = {};
                                    if (!config.options.scales[axis].ticks) config.options.scales[axis].ticks = {};
                                    config.options.scales[axis].ticks.color = 'rgba(255,255,255,0.5)';
                                    if (!config.options.scales[axis].grid) config.options.scales[axis].grid = {};
                                    config.options.scales[axis].grid.color = 'rgba(255,255,255,0.08)';
                                });
                                config.options.responsive = true;
                                config.options.maintainAspectRatio = true;
                                new Chart(el.getContext('2d'), config);
                            } catch(parseErr) {
                                el.parentElement.innerHTML = '<div class="mermaid-error">Chart config error: ' + parseErr.message + '</div>';
                            }
                        } else {
                            el.parentElement.innerHTML = '<div class="mermaid-error">Chart.js not loaded</div>';
                        }
                    }
                    
                    else if (task.type === 'katex-block') {
                        if (typeof katex !== 'undefined') {
                            try {
                                katex.render(task.code, el, { displayMode: true, throwOnError: false });
                            } catch(e) {
                                el.innerHTML = '<span class="math-error">' + task.code + '</span>';
                            }
                        } else {
                            el.textContent = '$$' + task.code + '$$';
                        }
                    }
                    
                    else if (task.type === 'katex-inline') {
                        if (typeof katex !== 'undefined') {
                            try {
                                katex.render(task.code, el, { displayMode: false, throwOnError: false });
                            } catch(e) {
                                el.innerHTML = '<span class="math-error">' + task.code + '</span>';
                            }
                        } else {
                            el.textContent = '$' + task.code + '$';
                        }
                    }
                    
                    else if (task.type === 'html-preview') {
                        // Render live HTML/CSS/JS in a sandboxed iframe
                        var iframe = document.createElement('iframe');
                        iframe.sandbox = 'allow-scripts allow-same-origin';
                        iframe.style.cssText = 'width:100%;border:none;border-radius:6px;background:#0a0a1a;min-height:200px;';
                        el.appendChild(iframe);
                        var doc = iframe.contentDocument || iframe.contentWindow.document;
                        // Detect if the code is a full HTML document or just a snippet
                        var isFullDoc = /<html[\s>]/i.test(task.code) || /<!doctype/i.test(task.code);
                        // ResizeObserver script inside iframe for live height tracking
                        var resizeScript = '<script>new ResizeObserver(function(){var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);try{window.frameElement&&(window.frameElement.style.height=Math.max(200,h)+"px")}catch(e){}}).observe(document.body);<\/script>';
                        var content;
                        if (isFullDoc) {
                            content = task.code.replace(/<head>/i, '<head><style>html,body{background:#0a0a1a!important;margin:0;overflow:visible!important;height:auto!important;min-height:0!important;}</style>');
                            content = content.replace(/<\/body>/i, resizeScript + '</body>');
                        } else {
                            content = '<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{background:#0a0a1a;color:#e0e0e0;font-family:Inter,system-ui,sans-serif;padding:16px;overflow:visible;height:auto;min-height:0;}</style></head><body>' + task.code + resizeScript + '</body></html>';
                        }
                        doc.open();
                        doc.write(content);
                        doc.close();
                        // Auto-resize iframe to fit content (no max cap)
                        var resizeIframe = function() {
                            try {
                                var h = Math.max(
                                    iframe.contentDocument.body ? iframe.contentDocument.body.scrollHeight : 0,
                                    iframe.contentDocument.documentElement ? iframe.contentDocument.documentElement.scrollHeight : 0,
                                    iframe.contentDocument.body ? iframe.contentDocument.body.offsetHeight : 0
                                );
                                if (h > 0) iframe.style.height = Math.max(200, h) + 'px';
                            } catch(e) {}
                        };
                        iframe.onload = resizeIframe;
                        setTimeout(resizeIframe, 50);
                        setTimeout(resizeIframe, 200);
                        setTimeout(resizeIframe, 600);
                        setTimeout(resizeIframe, 1500);
                        setTimeout(resizeIframe, 3000);
                    }
                } catch(err) {
                    console.warn('Post-render error for', task.type, task.id, err);
                }
            });
            
            // Apply highlight.js syntax highlighting to all new code blocks
            if (typeof hljs !== 'undefined') {
                document.querySelectorAll('pre code[class^="language-"]').forEach(function(block) {
                    if (!block.dataset.highlighted) {
                        hljs.highlightElement(block);
                    }
                });
            }
        }, 50);
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
        postRenderRichBlocks();
        
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
            (window._authFetch || fetch)('http://localhost:8765/api/interrupt', { method: 'POST' })
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
        panel.style.cssText = "margin:6px 0;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(180,140,255,0.15);overflow:hidden;font-family:'JetBrains Mono','Fira Code','Consolas',monospace;";
        
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
        postRenderRichBlocks();
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
                postRenderRichBlocks();
                
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
                // Try rich card rendering first, fall back to formatText
                var richHtml = renderRichMessage(messageContent);
                if (richHtml) {
                    streamingElement.innerHTML = richHtml;
                } else {
                    streamingElement.innerHTML = formatText(messageContent);
                }
                postRenderRichBlocks();
                
                // Store rawText for copy button
                streamingElement.dataset.rawText = messageContent;
                
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
                
                // Store rawText for copy button
                bubble.dataset.rawText = messageContent;
                
                // Try rich card rendering for structured responses
                var richHtml = renderRichMessage(messageContent);
                if (richHtml) {
                    bubble.innerHTML = richHtml;
                    postRenderRichBlocks();
                } else {
                    // Simulate streaming for the full message
                    streamText(bubble, messageContent);
                }
                
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
            // Render backend-injected user messages (e.g. inbound SMS) on the user side
            if (data.type === 'user_message' && data.text) {
                addUserMessage(data.text);
                return;
            }
            
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
                                outputDiv.style.cssText = "display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.4);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:300px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(255,255,255,0.08);font-family:'JetBrains Mono','Fira Code','Consolas',monospace;";
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
                                outputDiv.style.cssText = "display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(80,200,120,0.15);font-family:'JetBrains Mono','Fira Code','Consolas',monospace;";
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
                                outputDiv.style.cssText = "display:block;margin:2px 0 4px 26px;padding:0;background:rgba(0,0,0,0.35);border-radius:6px;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.7);max-height:350px;overflow-y:auto;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;border:1px solid rgba(100,180,255,0.15);font-family:'JetBrains Mono','Fira Code','Consolas',monospace;";
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
                                postRenderRichBlocks();
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
