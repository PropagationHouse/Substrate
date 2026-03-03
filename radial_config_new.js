// Radial Config Panel
// This script transforms the regular config panel into a futuristic radial menu

(function() {
  console.log("Radial Config Panel initializing...");
  // Debounce utility to prevent spamming backend with config saves
  function debounce(fn, wait){
    let t = null; let lastArgs = null; let lastThis = null;
    return function(){
      lastArgs = arguments; lastThis = this;
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, wait);
    };
  }
  // Track last sent values to avoid redundant saves
  const lastSent = { system_prompt: null, screenshot_prompt: null, temperature: null, max_tokens: null, context_retrieval_limit: null };
    
    // Store original config panel
    let originalConfigPanel = null;
    let radialPanel = null;
    let currentSectionIndex = 0;
    let sectionCount = 0;
    let wheelContainer = null;
    let cumulativeAngle = 0;  // Track total rotation for smooth wrap-around feel
    let cachedModelCatalog = [];
    const modelLookup = new Map();
    // Favorites: persisted in localStorage + config
    let favoriteModels = new Set();
    try {
        const saved = localStorage.getItem('favorite_models');
        if (saved) favoriteModels = new Set(JSON.parse(saved));
    } catch(_) {}
    function toggleFavorite(modelName) {
        if (favoriteModels.has(modelName)) favoriteModels.delete(modelName);
        else favoriteModels.add(modelName);
        try { localStorage.setItem('favorite_models', JSON.stringify([...favoriteModels])); } catch(_) {}
        window.api.send('config', { action: 'save', config: { favorite_models: [...favoriteModels] } });
    }
    function isFavorite(modelName) { return favoriteModels.has(modelName); }
    // Active provider filter for dropdown tabs
    let activeProviderFilter = 'all';
    const MODEL_FALLBACKS = [
        { name: 'gemma3:12b', provider: 'ollama' },
        { name: 'llama3.2-vision:11b', provider: 'ollama' },
        { name: 'qwen2.5-coder:14b', provider: 'ollama' },
        { name: 'dolphin3:8b', provider: 'ollama' },
        { name: 'dolphin-mistral:7b', provider: 'ollama' },
        { name: 'dolphin-mixtral:latest', provider: 'ollama' },
        { name: 'deepseek-r1:32b', provider: 'ollama' },
        { name: 'grok-latest', provider: 'xai', display_name: 'Grok (xAI)' },
        { name: 'claude-sonnet-4.5', provider: 'anthropic', display_name: 'Claude Sonnet 4.5' },
        { name: 'claude-opus-4.5', provider: 'anthropic', display_name: 'Claude Opus 4.5' },
        { name: 'claude-haiku-4.5', provider: 'anthropic', display_name: 'Claude Haiku 4.5' },
        { name: 'claude-sonnet-4', provider: 'anthropic', display_name: 'Claude Sonnet 4' },
        { name: 'gemini-3-pro', provider: 'google', display_name: 'Gemini 3 Pro' },
        { name: 'gemini-3-flash', provider: 'google', display_name: 'Gemini 3 Flash' },
        { name: 'gemini-2.5-pro', provider: 'google', display_name: 'Gemini 2.5 Pro' },
        { name: 'gemini-2.5-flash', provider: 'google', display_name: 'Gemini 2.5 Flash' },
        { name: 'gpt-4.1', provider: 'openai', display_name: 'GPT-4.1 (OpenAI)' },
        { name: 'gpt-4.1-mini', provider: 'openai', display_name: 'GPT-4.1 Mini (OpenAI)' },
        { name: 'o4-mini', provider: 'openai', display_name: 'o4-mini (OpenAI)' },
        { name: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o (OpenAI)' },
        { name: 'minimax-m2.5', provider: 'minimax', display_name: 'MiniMax M2.5' }
    ];
    
    // Config sections to include in the radial menu
    const sections = [
        { id: "agent-model", title: "Agent & Model" },
        { id: "system-prompt", title: "System Prompt" },
        { id: "note-creation", title: "Note Creation" },
        { id: "autonomy", title: "Autonomy Settings" },
        { id: "remote-view", title: "Remote View" },
        { id: "api", title: "API Settings" },
        { id: "mcp", title: "MCP Connections" },
        { id: "network", title: "Network & WebUI" },
        { id: "commands", title: "Commands" },
        { id: "circuits", title: "CIRCUITS.md" },
        { id: "prime", title: "PRIME.md" }
    ];
    
    // Function to create the radial panel
    function createRadialPanel() {
        // Store original panel for content
        originalConfigPanel = document.getElementById('config-panel');
        if (!originalConfigPanel) {
            console.error("Original config panel not found");
            return;
        }

        // Hide original panel
        originalConfigPanel.style.display = 'none';
        
        // Create radial panel container
        radialPanel = document.createElement('div');
        radialPanel.className = 'radial-config-panel';
        radialPanel.id = 'radial-config-panel';

        // Create wheel structure
        const wheelHTML = `
            <div class="radial-wheel">
                <div class="wheel-container" id="wheel-container">
                    ${createSectionCards()}
                </div>
                <div class="wheel-indicator" id="wheel-indicator">
                    ${createIndicatorDots()}
                </div>
                <div class="holographic-overlay"></div>
            </div>
            <div class="radial-close" id="radial-close">×</div>
        `;
        
        radialPanel.innerHTML = wheelHTML;
        document.body.appendChild(radialPanel);
        
        // Initialize wheel container reference
        wheelContainer = document.getElementById('wheel-container');
        
        // Set up event listeners
        setupEventListeners();
        
        // Position section cards in 3D space
        positionSectionCards();
        
        // Set the first section as active
        updateActiveSection(0);
        
        console.log("Radial panel created");
    }
    
    // Create HTML for all section cards
    function createSectionCards() {
        let cardsHTML = '';
        
        // Combined Agent & Model section
        cardsHTML += createSectionCard("agent-model", "Agent & Model", getAgentModelContent());
        
        // System prompt section
        cardsHTML += createSectionCard("system-prompt", "System Prompt", getSystemPromptContent());
        
        // Note creation section
        cardsHTML += createSectionCard("note-creation", "Note Creation", getNoteCreationContent());
        
        // Autonomy settings section
        cardsHTML += createSectionCard("autonomy", "Autonomy Settings", getAutonomyContent());
        
        // Remote View (camera observation) section
        cardsHTML += createSectionCard("remote-view", "Remote View", getRemoteViewContent());
        
        // API settings section
        cardsHTML += createSectionCard("api", "API Settings", getAPIContent());
        
        // MCP connections section
        cardsHTML += createSectionCard("mcp", "MCP Connections", getMCPContent());
        
        // Network & WebUI section
        cardsHTML += createSectionCard("network", "Network & WebUI", getNetworkContent());
        
        // Command dictionary section
        cardsHTML += createSectionCard("commands", "Commands", getCommandsContent());
        
        // Circuits section (dedicated card)
        cardsHTML += createSectionCard("circuits", "Circuits", getCircuitsContent());
        
        // Prime section (startup tasks)
        cardsHTML += createSectionCard("prime", "Prime", getPrimeContent());
        
        sectionCount = sections.length;
        return cardsHTML;
    }
    
    // Create a single section card
    function createSectionCard(id, title, content) {
        return `
            <div class="section-card" id="section-${id}">
                <h3>${title}</h3>
                <div class="content">
                    ${content}
                </div>
            </div>
        `;
    }
    
    // Create indicator dots
    function createIndicatorDots() {
        let dotsHTML = '';
        for (let i = 0; i < sections.length; i++) {
            dotsHTML += `<div class="indicator-dot" data-index="${i}"></div>`;
        }
        return dotsHTML;
    }
    
    // Position cards in 3D space
    function positionSectionCards() {
        const cards = document.querySelectorAll('.section-card');
        const angleIncrement = 360 / sectionCount;
        
        cards.forEach((card, index) => {
            const angle = index * angleIncrement;
            card.style.transform = `rotateY(${angle}deg) translateZ(160px)`;
        });
    }
    
    // Update the active section
    // direction: 1 = forward/next, -1 = backward/prev, 0 = jump (initial load)
    function updateActiveSection(index, direction) {
        const prevIndex = currentSectionIndex;
        // Normalize index
        currentSectionIndex = (index + sectionCount) % sectionCount;
        
        // Re-enable perspective for the carousel animation
        const wheel = document.querySelector('.radial-wheel');
        if (wheel) wheel.style.perspective = '1000px';

        const step = 360 / sectionCount;
        if (direction === undefined || direction === 0) {
            // Direct jump — set absolute angle
            cumulativeAngle = -currentSectionIndex * step;
        } else {
            // Always rotate one full step in the given direction
            cumulativeAngle += -direction * step;
        }
        wheelContainer.style.transform = `rotateY(${cumulativeAngle}deg)`;
        
        // Update active classes and push non-active cards behind
        const cards = document.querySelectorAll('.section-card');
        const angleIncrement = 360 / sectionCount;
        cards.forEach((card, i) => {
            const cardAngle = i * angleIncrement;
            if (i === currentSectionIndex) {
                card.classList.add('active');
                card.style.transform = `rotateY(${cardAngle}deg) translateZ(160px)`;
            } else {
                card.classList.remove('active');
                card.style.transform = `rotateY(${cardAngle}deg) translateZ(60px) scale(0.85)`;
            }
        });

        // After carousel transition completes, smoothly flatten for pointer events.
        // Step 1: Scale active card down to compensate for the ~1.19x perspective inflation.
        // Step 2: Once that scale transition finishes, disable perspective (now visually identical).
        const settleIdx = currentSectionIndex;
        setTimeout(() => {
            if (currentSectionIndex !== settleIdx) return;
            const activeCard = document.querySelector('.section-card.active');
            if (!activeCard) return;
            const cardAngle = settleIdx * (360 / sectionCount);
            // Smoothly scale down to counteract perspective: 1000/(1000-160) ≈ 1.19
            activeCard.style.transition = 'transform 0.3s ease-out';
            activeCard.style.transform = `rotateY(${cardAngle}deg) translateZ(160px) scale(${1/1.19})`;
            // After scale transition, kill perspective (no visual change since scale already compensated)
            setTimeout(() => {
                if (currentSectionIndex !== settleIdx) return;
                activeCard.style.transition = 'none';
                const wheel = document.querySelector('.radial-wheel');
                if (wheel) wheel.style.perspective = 'none';
                activeCard.style.transform = `rotateY(${cardAngle}deg) translateZ(160px)`;
                void document.body.offsetHeight;
                activeCard.style.transition = '';
            }, 320);
        }, 150);
        
        // Update indicator dots
        const dots = document.querySelectorAll('.indicator-dot');
        dots.forEach((dot, i) => {
            if (i === currentSectionIndex) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
        
        // Load content for the active section if needed
        const sectionId = sections[currentSectionIndex].id;
        if (sectionId === 'system-prompt') {
            const substrateTA = document.getElementById('substrate-input-radial');
            if (substrateTA && (!substrateTA.value || substrateTA.value.trim() === '')) loadSubstrateContent();
        } else if (sectionId === 'commands') {
            console.log('Navigated to commands section, loading command dictionary...');
            loadCommandsData();
        } else if (sectionId === 'autonomy' || sectionId === 'circuits') {
            // Always attempt to load circuits when navigating to either section
            console.log('Navigated to ' + sectionId + ' section, loading CIRCUITS.md...');
            loadCircuitsContent();
            if (sectionId === 'circuits') loadCircuitsConfig();
        } else if (sectionId === 'prime') {
            const primeTA = document.getElementById('prime-input-radial');
            if (!primeTA || primeTA.dataset.loaded !== 'true') loadPrimeContent();
        }
        
        console.log(`Active section updated to: ${sections[currentSectionIndex].title}`);
    }
    
    // Set up event listeners
    function setupEventListeners() {
        const closeButton = document.getElementById('radial-close');
        const indicators = document.querySelectorAll('.indicator-dot');
        
        // Vision client launch button
        document.addEventListener('click', function(e) {
            if (e.target && e.target.id === 'launch-vision-client') {
                console.log('Launching XGO Vision Client');
                // Send IPC message to main process to launch the vision client
                window.api.send('execute-action', {
                    action: 'run-python-script',
                    script: 'xgo_vision_client_reference.py',
                    args: []
                });
            }
        });
        
        // Close button
        closeButton.addEventListener('click', function() {
            hideRadialPanel();
        });
        
        // Indicator dots
        indicators.forEach((dot, index) => {
            dot.addEventListener('click', function() {
                const dir = index > currentSectionIndex ? 1 : index < currentSectionIndex ? -1 : 0;
                currentSectionIndex = index;
                updateActiveSection(currentSectionIndex, dir);
            });
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (!radialPanel || !radialPanel.classList.contains('active')) return;
            
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                currentSectionIndex = (currentSectionIndex - 1 + sectionCount) % sectionCount;
                updateActiveSection(currentSectionIndex, -1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                currentSectionIndex = (currentSectionIndex + 1) % sectionCount;
                updateActiveSection(currentSectionIndex, 1);
            } else if (e.key === 'Escape') {
                hideRadialPanel();
            }
        });
        
        // Mouse wheel navigation
        radialPanel.addEventListener('wheel', function(e) {
            // Check if we're over the vertical radial wheel
            const verticalWheel = document.querySelector('.vertical-radial-wheel');
            if (verticalWheel) {
                const wheelRect = verticalWheel.getBoundingClientRect();
                const isOverVerticalWheel = (
                    e.clientX >= wheelRect.left &&
                    e.clientX <= wheelRect.right &&
                    e.clientY >= wheelRect.top &&
                    e.clientY <= wheelRect.bottom
                );
                
                // If over vertical wheel, don't handle horizontal scrolling
                if (isOverVerticalWheel) {
                    return;
                }
            }
            
            // Check if cursor is visually over the active card using bounding rect
            // If over card and content overflows → programmatic scroll
            // If outside card → fall through to card rotation
            const activeCard = document.querySelector('.section-card.active');
            if (activeCard && e.deltaY !== 0) {
                const rect = activeCard.getBoundingClientRect();
                const overCard = (
                    e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom
                );
                if (overCard) {
                    // If cursor is over a textarea/select, let native scroll handle it
                    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
                    if (hitEl && (hitEl.tagName === 'TEXTAREA' || hitEl.tagName === 'SELECT')) {
                        return; // native scroll works fine on these elements
                    }
                    const contentDiv = activeCard.querySelector('.content');
                    if (contentDiv && contentDiv.scrollHeight > contentDiv.clientHeight) {
                        const atTop = contentDiv.scrollTop <= 0;
                        const atBottom = contentDiv.scrollHeight - contentDiv.scrollTop <= contentDiv.clientHeight + 1;
                        if (!((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom))) {
                            e.preventDefault();
                            contentDiv.scrollBy({ top: e.deltaY, behavior: 'smooth' });
                            return;
                        }
                    }
                }
            }
            
            // Handle horizontal scrolling for main radial menu
            if (e.deltaX !== 0) {
                const dir = e.deltaX > 0 ? 1 : -1;
                currentSectionIndex = (currentSectionIndex + dir + sectionCount) % sectionCount;
                updateActiveSection(currentSectionIndex, dir);
                e.preventDefault();
            } else if (e.deltaY !== 0) {
                // Vertical scroll at boundary or no overflow — rotate cards
                const dir = e.deltaY > 0 ? 1 : -1;
                currentSectionIndex = (currentSectionIndex + dir + sectionCount) % sectionCount;
                updateActiveSection(currentSectionIndex, dir);
                e.preventDefault();
            }
        }, { passive: false });
        
        // Drag to rotate
        let isDragging = false;
        let startX = 0;
        
        radialPanel.addEventListener('mousedown', function(e) {
            // Don't start dragging on interactive elements — let them handle clicks normally
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'label' || tag === 'a') return;
            if (e.target.closest('button, a, label, .accordion-header, .config-button-small, [onclick]')) return;

            // Don't start dragging if we're over the vertical wheel
            const verticalWheel = document.querySelector('.vertical-radial-wheel');
            if (verticalWheel) {
                const wheelRect = verticalWheel.getBoundingClientRect();
                const isOverVerticalWheel = (
                    e.clientX >= wheelRect.left &&
                    e.clientX <= wheelRect.right &&
                    e.clientY >= wheelRect.top &&
                    e.clientY <= wheelRect.bottom
                );
                
                if (isOverVerticalWheel) {
                    return;
                }
            }
            
            isDragging = true;
            startX = e.clientX;
        });
        
        radialPanel.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            startX = e.clientX;
            
            // Only change section if drag distance is significant
            if (Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    // Drag right
                    currentSectionIndex = (currentSectionIndex - 1 + sectionCount) % sectionCount;
                    updateActiveSection(currentSectionIndex, -1);
                } else {
                    // Drag left
                    currentSectionIndex = (currentSectionIndex + 1) % sectionCount;
                    updateActiveSection(currentSectionIndex, 1);
                }
                isDragging = false;
            }
        });
        
        document.addEventListener('mouseup', function() {
            isDragging = false;
        });

        // Reset Memory button handler
        document.addEventListener('click', async function(e){
            if (e.target && e.target.id === 'reset-memory-btn') {
                try {
                    const res = await fetch('http://localhost:8765/api/memory/reset', { method: 'POST' });
                    const data = await res.json().catch(()=>({}));
                    const ok = res.ok && data && data.status === 'success';
                    const msg = ok ? 'Memory reset.' : ('Memory reset failed' + (data && data.message ? ': ' + data.message : ''));
                    // Simple toast
                    const t = document.createElement('div');
                    t.textContent = msg;
                    t.style.position = 'fixed';
                    t.style.bottom = '24px';
                    t.style.right = '24px';
                    t.style.background = 'rgba(0,0,0,0.8)';
                    t.style.color = '#fff';
                    t.style.padding = '8px 12px';
                    t.style.borderRadius = '6px';
                    t.style.zIndex = '2000';
                    document.body.appendChild(t);
                    setTimeout(()=> t.remove(), 1500);
                } catch(err) {
                    // Silent fail
                }
            }
        });

        // Right-click to wipe all memory (dangerous)
        document.addEventListener('contextmenu', async function(e){
            if (e.target && e.target.id === 'reset-memory-btn') {
                e.preventDefault();
                const proceed = confirm('Wipe ALL memory? This deletes long-term DB and semantic index. This cannot be undone.');
                if (!proceed) return;
                try {
                    const res = await fetch('http://localhost:8765/api/memory/wipe-all', { method: 'POST' });
                    const data = await res.json().catch(()=>({}));
                    const ok = res.ok && data && data.status === 'success';
                    const msg = ok ? 'All memory wiped.' : ('Wipe failed' + (data && data.message ? ': ' + data.message : ''));
                    const t = document.createElement('div');
                    t.textContent = msg;
                    t.style.position = 'fixed';
                    t.style.bottom = '24px';
                    t.style.right = '24px';
                    t.style.background = 'rgba(255,0,0,0.85)';
                    t.style.color = '#fff';
                    t.style.padding = '8px 12px';
                    t.style.borderRadius = '6px';
                    t.style.zIndex = '2000';
                    document.body.appendChild(t);
                    setTimeout(()=> t.remove(), 2000);
                } catch(err) {
                    // Silent fail
                }
            }
        });
    }
    
    // Show the radial panel
    function showRadialPanel() {
        // Make sure panel exists
        if (!radialPanel) {
            createRadialPanel();
        }
        
        // Load volume settings from config via IPC
        try {
            if (window.api && window.api.send) {
                window.api.send('config', { action: 'get' });
            }
        } catch(_) {}
        
        // Show panel with animation
        radialPanel.style.display = 'block';
        setTimeout(() => {
            radialPanel.classList.add('active');
        }, 10);
        
        // Hide original panel
        if (originalConfigPanel) {
            originalConfigPanel.style.display = 'none';
        }
        
        // Ensure first section is active
        updateActiveSection(0);
        
        // Initialize model selection
        populateModelOptions();
        
        // Initialize autonomy wheel
        setTimeout(() => {
            initAutonomyWheel();
        }, 300);
        
        // Add event listeners to prompts (delay to ensure DOM is ready)
        setTimeout(() => {
            // SUBSTRATE.md editor
            const substrateInput = document.getElementById('substrate-input-radial');
            const substrateReloadBtn = document.getElementById('substrate-reload-btn');
            if (substrateInput) {
              console.log('Setting up SUBSTRATE.md editor');
              loadSubstrateContent(); // Load initial content
              
              const saveSubstrateDebounced = debounce(saveSubstrateContent, 1000);
              substrateInput.addEventListener('input', saveSubstrateDebounced);
              substrateInput.addEventListener('blur', saveSubstrateContent);
              
              if (substrateReloadBtn) {
                substrateReloadBtn.addEventListener('click', (e) => {
                  e.preventDefault();
                  loadSubstrateContent();
                });
              }
            }
            
            // Commands reload button
            const commandsReloadBtn = document.getElementById('commands-reload-btn');
            if (commandsReloadBtn) {
              commandsReloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                loadCommandsData();
              });
            }

            // Network & WebUI card: fetch info, populate, QR
            (function initNetworkCard() {
                const urlDisplay = document.getElementById('webui-url-display');
                const copyBtn = document.getElementById('webui-url-copy');
                const statusDot = document.getElementById('network-status-dot');
                const statusText = document.getElementById('network-status-text');
                const httpsBadge = document.getElementById('https-status-badge');
                const qrCanvas = document.getElementById('webui-qr-canvas');
                if (!urlDisplay) return;

                fetch('http://localhost:8765/api/network/info')
                    .then(r => r.json())
                    .then(data => {
                        const url = data.webui_https || data.webui_http || 'http://localhost:8765/ui';
                        urlDisplay.value = url;
                        if (statusDot) { statusDot.style.background = '#4CAF50'; }
                        if (statusText) { statusText.textContent = 'Server running \u2014 ' + data.local_ip; statusText.style.color = 'rgba(255,255,255,0.7)'; }
                        if (httpsBadge) {
                            if (data.https_enabled) {
                                httpsBadge.textContent = 'HTTPS: enabled';
                                httpsBadge.style.background = 'rgba(76,175,80,0.2)';
                                httpsBadge.style.color = 'rgba(76,175,80,0.9)';
                            } else {
                                httpsBadge.textContent = 'HTTPS: disabled (no certs)';
                                httpsBadge.style.background = 'rgba(255,152,0,0.15)';
                                httpsBadge.style.color = 'rgba(255,152,0,0.8)';
                            }
                        }
                        if (qrCanvas) drawQR(qrCanvas, url);
                    })
                    .catch(() => {
                        urlDisplay.value = 'http://localhost:8765/ui';
                        if (statusDot) { statusDot.style.background = '#f44336'; }
                        if (statusText) { statusText.textContent = 'Server unreachable'; statusText.style.color = 'rgba(244,67,54,0.8)'; }
                        if (httpsBadge) { httpsBadge.textContent = 'HTTPS: unknown'; }
                    });

                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(urlDisplay.value).then(() => {
                            copyBtn.textContent = 'Copied!';
                            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
                        });
                    });
                }

                function drawQR(canvas, text) {
                    const ctx = canvas.getContext('2d');
                    try {
                        if (typeof qrcode !== 'function') throw new Error('qrcode lib not loaded');
                        const qr = qrcode(0, 'L');
                        qr.addData(text);
                        qr.make();
                        const count = qr.getModuleCount();
                        const scale = Math.floor(canvas.width / (count + 4));
                        const offset = Math.floor((canvas.width - count * scale) / 2);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.fillStyle = '#000000';
                        for (let r = 0; r < count; r++) {
                            for (let c = 0; c < count; c++) {
                                if (qr.isDark(r, c)) {
                                    ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale);
                                }
                            }
                        }
                    } catch(e) {
                        console.error('[QR]', e);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.fillStyle = '#999';
                        ctx.font = '11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('QR unavailable', canvas.width/2, canvas.height/2);
                    }
                }
            })();

            // Commands card: programmatic scroll to work around Chromium 3D-transform scroll bug
            const commandsSection = document.getElementById('section-commands');
            if (commandsSection) {
              commandsSection.addEventListener('wheel', function(e) {
                const contentDiv = commandsSection.querySelector('.content');
                if (!contentDiv) return;
                const hasScroll = contentDiv.scrollHeight > contentDiv.clientHeight;
                if (!hasScroll) return;
                const atTop = contentDiv.scrollTop <= 0;
                const atBottom = contentDiv.scrollHeight - contentDiv.scrollTop <= contentDiv.clientHeight + 1;
                if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return; // boundary — let card rotate
                e.preventDefault();
                e.stopPropagation();
                contentDiv.scrollBy({ top: e.deltaY, behavior: 'smooth' }); // programmatic scroll
              }, { passive: false });
            }

            // CIRCUITS.md editor
            const circuitsInput = document.getElementById('circuits-input-radial');
            const circuitsReloadBtn = document.getElementById('circuits-reload-btn');
            if (circuitsInput) {
              console.log('Setting up CIRCUITS.md editor');
              loadCircuitsContent(); // Load initial content
              
              const saveCircuitsDebounced = debounce(saveCircuitsContent, 1000);
              circuitsInput.addEventListener('input', saveCircuitsDebounced);
              circuitsInput.addEventListener('blur', saveCircuitsContent);
              
              if (circuitsReloadBtn) {
                circuitsReloadBtn.addEventListener('click', (e) => {
                  e.preventDefault();
                  loadCircuitsContent();
                });
              }
            } else {
              console.warn('CIRCUITS textarea not found in DOM during setup - will load on section navigate');
            }
            
            // Circuits config controls — wire event listeners
            {
              const cToggle = document.getElementById('circuits-enabled-toggle');
              const cInterval = document.getElementById('circuits-interval-input');
              const cActiveStart = document.getElementById('circuits-active-start');
              const cActiveEnd = document.getElementById('circuits-active-end');
              const saveCConfigDebounced = debounce(saveCircuitsConfig, 1500);
              if (cToggle) cToggle.addEventListener('change', saveCircuitsConfig);
              if (cInterval) {
                cInterval.addEventListener('change', saveCConfigDebounced);
                cInterval.addEventListener('blur', saveCircuitsConfig);
              }
              if (cActiveStart) cActiveStart.addEventListener('change', saveCConfigDebounced);
              if (cActiveEnd) cActiveEnd.addEventListener('change', saveCConfigDebounced);
              loadCircuitsConfig();
            }

            // PRIME.md editor
            const primeInput = document.getElementById('prime-input-radial');
            const primeReloadBtn = document.getElementById('prime-reload-btn');
            if (primeInput) {
              console.log('Setting up PRIME.md editor');
              loadPrimeContent();
              
              const savePrimeDebounced = debounce(savePrimeContent, 1000);
              primeInput.addEventListener('input', savePrimeDebounced);
              primeInput.addEventListener('blur', savePrimeContent);
              
              if (primeReloadBtn) {
                primeReloadBtn.addEventListener('click', (e) => {
                  e.preventDefault();
                  loadPrimeContent();
                });
              }
            } else {
              console.warn('PRIME textarea not found in DOM during setup - will load on section navigate');
            }
            
            // Temperature slider
            const temperatureRadial = document.getElementById('temperature-radial');
            const temperatureValueRadial = document.getElementById('temperature-value-radial');
            if (temperatureRadial && temperatureValueRadial) {
              console.log('Adding event listener to temperature-radial');
              const sendTemp = debounce(() => {
                temperatureValueRadial.textContent = temperatureRadial.value;
                const val = parseFloat(temperatureRadial.value);
                if (lastSent.temperature === val) return;
                lastSent.temperature = val;
                console.log('Temperature changed (radial):', val);
                window.api.send('config', { action: 'save', config: { temperature: val } });
              }, 300);
              temperatureRadial.addEventListener('input', sendTemp);
            }

            // Max tokens input
            const maxTokensRadial = document.getElementById('max-tokens-radial');
            if (maxTokensRadial) {
              console.log('Adding event listener to max-tokens-radial');
              const persistMaxTokens = debounce(() => {
                let val = parseInt(maxTokensRadial.value, 10);
                if (isNaN(val)) val = 16384;
                val = Math.max(128, Math.min(128000, val));
                if (String(val) !== maxTokensRadial.value) {
                  maxTokensRadial.value = String(val);
                }
                if (lastSent.max_tokens === val) return;
                lastSent.max_tokens = val;
                console.log('Max tokens changed (radial):', val);
                window.api.send('config', { action: 'save', config: { max_tokens: val } });
              }, 400);
              maxTokensRadial.addEventListener('change', persistMaxTokens);
              maxTokensRadial.addEventListener('input', persistMaxTokens);
            }

            // Context items slider
            const contextLimitRadial = document.getElementById('context-limit-radial');
            const contextLimitValueRadial = document.getElementById('context-limit-value-radial');
            if (contextLimitRadial && contextLimitValueRadial) {
              console.log('Adding event listener to context-limit-radial');
              const sendCtx = debounce(() => {
                contextLimitValueRadial.textContent = contextLimitRadial.value;
                const val = parseInt(contextLimitRadial.value, 10) || 15;
                if (lastSent.context_retrieval_limit === val) return;
                lastSent.context_retrieval_limit = val;
                console.log('Context retrieval limit changed (radial):', val);
                window.api.send('config', { action: 'save', config: { context_retrieval_limit: val } });
              }, 300);
              contextLimitRadial.addEventListener('input', sendCtx);
            }

            // Mic sensitivity — draggable threshold on meter bar
            const micMeter = document.getElementById('mic-meter-container');
            const micHandle = document.getElementById('mic-threshold-handle');
            const micThresholdLabel = document.getElementById('mic-threshold-label');
            const micSlider = document.getElementById('mic-threshold-slider');
            const micLevelBar = document.getElementById('mic-level-bar');
            const micLevelReadout = document.getElementById('mic-level-readout');
            const MIC_MAX = 0.05; // max threshold value maps to 100% of bar
            
            function setThresholdFromPct(pct) {
              pct = Math.max(0.2, Math.min(100, pct)); // clamp
              const val = (pct / 100) * MIC_MAX;
              if (micHandle) micHandle.style.left = pct + '%';
              if (micThresholdLabel) micThresholdLabel.textContent = val.toFixed(4);
              if (micSlider) micSlider.value = val;
              if (window.api && window.api.send) {
                window.api.send('set-mic-threshold', val);
              }
            }
            
            if (micMeter && micHandle) {
              console.log('Setting up draggable mic threshold handle');
              // Request current threshold
              if (window.api && window.api.send) window.api.send('get-mic-threshold');
              
              let dragging = false;
              
              function getPctFromEvent(e) {
                const rect = micMeter.getBoundingClientRect();
                const x = (e.clientX || e.touches[0].clientX) - rect.left;
                return (x / rect.width) * 100;
              }
              
              micHandle.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); e.stopPropagation(); });
              micHandle.addEventListener('touchstart', (e) => { dragging = true; e.preventDefault(); e.stopPropagation(); }, {passive: false});
              
              // Click on meter bar to set threshold
              micMeter.addEventListener('mousedown', (e) => {
                if (e.target === micHandle || micHandle.contains(e.target)) return;
                dragging = true;
                setThresholdFromPct(getPctFromEvent(e));
              });
              
              document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                setThresholdFromPct(getPctFromEvent(e));
              });
              document.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                setThresholdFromPct(getPctFromEvent(e));
              }, {passive: false});
              document.addEventListener('mouseup', () => { dragging = false; });
              document.addEventListener('touchend', () => { dragging = false; });
            }
            
            // STT provider dropdown
            const sttProviderSelect = document.getElementById('stt-provider-select');
            const sttProviderStatus = document.getElementById('stt-provider-status');
            if (sttProviderSelect) {
              console.log('Setting up STT provider dropdown');
              if (window.api && window.api.send) window.api.send('get-stt-provider');
              sttProviderSelect.addEventListener('change', () => {
                const provider = sttProviderSelect.value;
                if (sttProviderStatus) {
                  sttProviderStatus.textContent = provider === 'whisper' ? 'local' : 'cloud';
                  sttProviderStatus.style.color = provider === 'whisper' ? 'rgba(255,255,255,0.4)' : '#4fc3f7';
                }
                if (window.api && window.api.send) {
                  window.api.send('set-stt-provider', provider);
                }
              });
            }

            // Mic gain slider
            const micGainSlider = document.getElementById('mic-gain-slider');
            const micGainValue = document.getElementById('mic-gain-value');
            if (micGainSlider) {
              console.log('Setting up mic gain slider');
              if (window.api && window.api.send) window.api.send('get-mic-gain');
              micGainSlider.addEventListener('input', () => {
                const val = parseFloat(micGainSlider.value);
                if (micGainValue) micGainValue.textContent = val.toFixed(1) + 'x';
                if (window.api && window.api.send) {
                  window.api.send('set-mic-gain', val);
                }
              });
            }
            
            // Mic timing sliders
            const micSilenceTimeout = document.getElementById('mic-silence-timeout');
            const micSilenceTimeoutValue = document.getElementById('mic-silence-timeout-value');
            const micChunkTrigger = document.getElementById('mic-chunk-trigger');
            const micChunkTriggerValue = document.getElementById('mic-chunk-trigger-value');
            const micMinChunk = document.getElementById('mic-min-chunk');
            const micMinChunkValue = document.getElementById('mic-min-chunk-value');
            const micVoiceCooldown = document.getElementById('mic-voice-cooldown');
            const micVoiceCooldownValue = document.getElementById('mic-voice-cooldown-value');

            if (window.api && window.api.send) window.api.send('get-mic-timing');

            if (micSilenceTimeout) {
              micSilenceTimeout.addEventListener('input', () => {
                const val = parseFloat(micSilenceTimeout.value);
                if (micSilenceTimeoutValue) micSilenceTimeoutValue.textContent = val.toFixed(1) + 's';
                if (window.api && window.api.send) window.api.send('set-silence-timeout', val);
              });
            }
            if (micChunkTrigger) {
              micChunkTrigger.addEventListener('input', () => {
                const val = parseFloat(micChunkTrigger.value);
                if (micChunkTriggerValue) micChunkTriggerValue.textContent = val.toFixed(1) + 's';
                if (window.api && window.api.send) window.api.send('set-chunk-trigger', val);
              });
            }
            if (micMinChunk) {
              micMinChunk.addEventListener('input', () => {
                const val = parseFloat(micMinChunk.value);
                if (micMinChunkValue) micMinChunkValue.textContent = val.toFixed(1) + 's';
                if (window.api && window.api.send) window.api.send('set-min-chunk', val);
              });
            }
            if (micVoiceCooldown) {
              micVoiceCooldown.addEventListener('input', () => {
                const val = parseFloat(micVoiceCooldown.value);
                if (micVoiceCooldownValue) micVoiceCooldownValue.textContent = val.toFixed(1) + 's';
                if (window.api && window.api.send) window.api.send('set-voice-cooldown', val);
              });
            }

            // Listen for live energy levels from speech process
            if (window.api && window.api.receive) {
              window.api.receive('mic-energy-level', (data) => {
                if (!micLevelBar) return;
                const pct = Math.min(100, (data.energy / MIC_MAX) * 100);
                micLevelBar.style.width = pct + '%';
                if (data.active) {
                  micLevelBar.style.background = 'linear-gradient(90deg, rgba(0,230,118,0.7), rgba(118,255,3,0.9))';
                } else {
                  micLevelBar.style.background = 'linear-gradient(90deg, rgba(79,195,247,0.5), rgba(41,182,246,0.7))';
                }
                if (micLevelReadout) {
                  micLevelReadout.textContent = data.energy.toFixed(5) + (data.active ? ' ✓' : '');
                }
              });
              window.api.receive('mic-threshold-updated', (data) => {
                const pct = Math.min(100, (data.threshold / MIC_MAX) * 100);
                if (micHandle) micHandle.style.left = pct + '%';
                if (micThresholdLabel) micThresholdLabel.textContent = data.threshold.toFixed(4);
                if (micSlider) micSlider.value = data.threshold;
              });
              window.api.receive('mic-gain-updated', (data) => {
                if (micGainSlider) micGainSlider.value = data.gain;
                if (micGainValue) micGainValue.textContent = data.gain.toFixed(1) + 'x';
              });
              window.api.receive('stt-provider-updated', (data) => {
                if (sttProviderSelect) sttProviderSelect.value = data.provider;
                if (sttProviderStatus) {
                  sttProviderStatus.textContent = data.provider === 'whisper' ? 'local' : 'cloud';
                  sttProviderStatus.style.color = data.provider === 'whisper' ? 'rgba(255,255,255,0.4)' : '#4fc3f7';
                }
              });
              window.api.receive('mic-timing-updated', (data) => {
                if (micSilenceTimeout) { micSilenceTimeout.value = data.silence_timeout; }
                if (micSilenceTimeoutValue) { micSilenceTimeoutValue.textContent = data.silence_timeout.toFixed(1) + 's'; }
                if (micChunkTrigger) { micChunkTrigger.value = data.chunk_trigger; }
                if (micChunkTriggerValue) { micChunkTriggerValue.textContent = data.chunk_trigger.toFixed(1) + 's'; }
                if (micMinChunk) { micMinChunk.value = data.min_chunk; }
                if (micMinChunkValue) { micMinChunkValue.textContent = data.min_chunk.toFixed(1) + 's'; }
                if (micVoiceCooldown) { micVoiceCooldown.value = data.voice_cooldown; }
                if (micVoiceCooldownValue) { micVoiceCooldownValue.textContent = data.voice_cooldown.toFixed(1) + 's'; }
              });
            }

            // Volume sliders (Voice + SFX)
            const voiceVolSlider = document.getElementById('voice-volume-radial');
            const voiceVolValue = document.getElementById('voice-volume-radial-value');
            const sfxVolSlider = document.getElementById('sfx-volume-radial');
            const sfxVolValue = document.getElementById('sfx-volume-radial-value');
            // Load volume from config updates
            if (window.api && window.api.receive) {
              const loadVol = (cfg) => {
                const vs = (cfg && cfg.voice_settings) || {};
                if (vs.voice_volume !== undefined && voiceVolSlider) { voiceVolSlider.value = vs.voice_volume; if (voiceVolValue) voiceVolValue.textContent = vs.voice_volume + '%'; }
                if (vs.sfx_volume !== undefined && sfxVolSlider) { sfxVolSlider.value = vs.sfx_volume; if (sfxVolValue) sfxVolValue.textContent = vs.sfx_volume + '%'; }
              };
              window.api.receive('config-update', loadVol);
              window.api.receive('update-config-panel', loadVol);
            }
            const sendVolume = debounce(() => {
              const vv = voiceVolSlider ? parseInt(voiceVolSlider.value) : 80;
              const sv = sfxVolSlider ? parseInt(sfxVolSlider.value) : 80;
              window.api.send('config', { action: 'save', config: { voice_settings: { voice_volume: vv, sfx_volume: sv } } });
            }, 300);
            if (voiceVolSlider) {
              voiceVolSlider.addEventListener('input', () => {
                if (voiceVolValue) voiceVolValue.textContent = voiceVolSlider.value + '%';
                sendVolume();
              });
            }
            if (sfxVolSlider) {
              sfxVolSlider.addEventListener('input', () => {
                if (sfxVolValue) sfxVolValue.textContent = sfxVolSlider.value + '%';
                sendVolume();
              });
            }

            // Autonomy: Screen Observation controls (single source of truth)
            const shotEnabled = document.getElementById('screenshot-enabled-radial');
            const shotMin = document.getElementById('screenshot-min-interval-radial');
            const shotMax = document.getElementById('screenshot-max-interval-radial');
            const shotPrompt = document.getElementById('screenshot-prompt-input-radial');
            if (shotEnabled || shotMin || shotMax || shotPrompt) {
              const sendShotConfig = debounce(() => {
                const cfg = {
                  autonomy: {
                    screenshot: {
                      enabled: !!(shotEnabled && shotEnabled.checked),
                      min_interval: shotMin ? parseInt(shotMin.value || '0', 10) : undefined,
                      max_interval: shotMax ? parseInt(shotMax.value || '0', 10) : undefined,
                      prompt: shotPrompt ? shotPrompt.value : undefined
                    }
                  }
                };
                // Clean undefineds
                if (cfg.autonomy.screenshot.min_interval === undefined) delete cfg.autonomy.screenshot.min_interval;
                if (cfg.autonomy.screenshot.max_interval === undefined) delete cfg.autonomy.screenshot.max_interval;
                if (cfg.autonomy.screenshot.prompt === undefined) delete cfg.autonomy.screenshot.prompt;
                window.api.send('config', { action: 'save', config: cfg });
                // Also update root-level screenshot_prompt so explicit image flow uses it
                if (shotPrompt) {
                  const v = shotPrompt.value;
                  if (lastSent.screenshot_prompt !== v) {
                    lastSent.screenshot_prompt = v;
                    try { localStorage.setItem('screenshot_prompt', v || ''); } catch(_) {}
                    window.api.send('config', { action: 'save', config: { screenshot_prompt: v } });
                  }
                }
              }, 300);
              shotEnabled && shotEnabled.addEventListener('change', sendShotConfig);
              shotMin && shotMin.addEventListener('input', sendShotConfig);
              shotMax && shotMax.addEventListener('input', sendShotConfig);
              if (shotPrompt) {
                shotPrompt.addEventListener('input', sendShotConfig);
                shotPrompt.addEventListener('blur', sendShotConfig);
                shotPrompt.addEventListener('keydown', (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); shotPrompt.blur(); }
                });
              }
            }

            // Remote View: Camera observation controls
            const camEnabled = document.getElementById('camera-enabled-radial');
            const camMin = document.getElementById('camera-min-interval-radial');
            const camMax = document.getElementById('camera-max-interval-radial');
            const camSilent = document.getElementById('camera-silent-chance-radial');
            const camSilentValue = document.getElementById('camera-silent-chance-value');
            const camScrapbook = document.getElementById('camera-scrapbook-radial');
            const camPrompt = document.getElementById('camera-prompt-radial');
            const camFirstLook = document.getElementById('camera-first-look-prompt-radial');
            if (camEnabled || camMin || camMax || camSilent || camScrapbook || camPrompt || camFirstLook) {
              // Load current values from config
              try {
                const cc = (window.currentConfig && window.currentConfig.autonomy && window.currentConfig.autonomy.camera) || {};
                if (camEnabled && cc.enabled !== undefined) camEnabled.checked = cc.enabled === true || cc.enabled === 'true';
                if (camMin && cc.min_interval !== undefined) camMin.value = cc.min_interval;
                if (camMax && cc.max_interval !== undefined) camMax.value = cc.max_interval;
                if (camSilent && cc.silent_chance !== undefined) { camSilent.value = cc.silent_chance; if (camSilentValue) camSilentValue.textContent = cc.silent_chance + '%'; }
                if (camScrapbook && cc.save_to_scrapbook !== undefined) camScrapbook.checked = cc.save_to_scrapbook === true || cc.save_to_scrapbook === 'true';
                if (camPrompt && cc.prompt) camPrompt.value = cc.prompt;
                if (camFirstLook && cc.first_look_prompt) camFirstLook.value = cc.first_look_prompt;
              } catch(_) {}

              const sendCamConfig = debounce(() => {
                const cfg = {
                  autonomy: {
                    camera: {
                      enabled: !!(camEnabled && camEnabled.checked),
                      min_interval: camMin ? parseInt(camMin.value || '30', 10) : 30,
                      max_interval: camMax ? parseInt(camMax.value || '120', 10) : 120,
                      silent_chance: camSilent ? parseInt(camSilent.value || '50', 10) : 50,
                      save_to_scrapbook: !!(camScrapbook && camScrapbook.checked),
                      prompt: camPrompt ? camPrompt.value : undefined,
                      first_look_prompt: camFirstLook ? camFirstLook.value : undefined
                    }
                  }
                };
                if (cfg.autonomy.camera.prompt === undefined) delete cfg.autonomy.camera.prompt;
                if (cfg.autonomy.camera.first_look_prompt === undefined) delete cfg.autonomy.camera.first_look_prompt;
                window.api.send('config', { action: 'save', config: cfg });
              }, 400);
              camEnabled && camEnabled.addEventListener('change', sendCamConfig);
              camMin && camMin.addEventListener('input', sendCamConfig);
              camMax && camMax.addEventListener('input', sendCamConfig);
              if (camSilent) {
                camSilent.addEventListener('input', () => {
                  if (camSilentValue) camSilentValue.textContent = camSilent.value + '%';
                  sendCamConfig();
                });
              }
              camScrapbook && camScrapbook.addEventListener('change', sendCamConfig);
              if (camPrompt) {
                camPrompt.addEventListener('input', sendCamConfig);
                camPrompt.addEventListener('blur', sendCamConfig);
              }
              if (camFirstLook) {
                camFirstLook.addEventListener('input', sendCamConfig);
                camFirstLook.addEventListener('blur', sendCamConfig);
              }
            }
        }, 500);
        
        console.log("Radial panel shown");
    }
    
    // Hide the radial panel
    function hideRadialPanel() {
        radialPanel.classList.remove('active');
        setTimeout(() => {
            radialPanel.style.display = 'none';
        }, 300);
        console.log("Radial panel hidden");
    }
    
    // Combined avatar and model content
    function getAgentModelContent() {
        // Get the current temperature value from the original config panel
        const temperatureInput = originalConfigPanel.querySelector('#temperature');
        const temperatureValue = temperatureInput ? temperatureInput.value : '0.7';
        // Try to get context retrieval limit from original panel if present
        let contextLimitValue = '15';
        try {
            const ctxInput = originalConfigPanel.querySelector('#context-retrieval-limit');
            if (ctxInput && ctxInput.value) contextLimitValue = String(ctxInput.value);
        } catch(_) {}
        // Try to get max tokens from original panel if present (fallback to 16384)
        let maxTokensValue = '16384';
        try {
            const maxTokInput = originalConfigPanel.querySelector('#max-tokens');
            if (maxTokInput && maxTokInput.value) maxTokensValue = String(maxTokInput.value);
        } catch(_) {}
        
        return `
            <div class="combined-agent-model">
                <div class="avatar-section">
                    <h4>Agent Avatar</h4>
                    <div class="avatar-upload-radial">
                        <img id="avatar-preview-radial" class="avatar-preview-radial" src="default-avatar.png" alt="Agent Avatar">
                        <input type="file" id="avatar-input-radial" accept="image/*">
                        <label for="avatar-input-radial">Choose Avatar</label>
                        <div class="config-help">Select an image for the agent (64x64+)</div>
                    </div>
                </div>
                <div class="divider"></div>
                <div class="model-section">
                    <h4>Model Selection</h4>
                    <div class="model-select-radial">
                        <div class="selected">
                            <span class="model-name" id="selected-model-name">Loading models...</span>
                            <span class="model-arrow">▼</span>
                        </div>
                        <div class="model-options-radial" id="model-options-radial">
                            <!-- Models will be populated dynamically -->
                        </div>
                    </div>
                    <div class="config-help">Choose the AI model to use for responses.</div>
                    <div style="margin-top:10px;">
                        <h4 style="font-size:12px; margin-bottom:4px;">Vision Fallback Model</h4>
                        <div class="model-select-radial" id="vision-fallback-wrapper" style="margin-bottom:6px;">
                            <div class="selected">
                                <span class="model-name" id="vision-fallback-label">Gemini 2.5 Flash</span>
                                <span class="model-arrow">\u25BC</span>
                            </div>
                            <div class="model-options-radial" id="vision-fallback-options" style="display:none;">
                                <div class="model-option" data-value="gemini-2.5-flash">Gemini 2.5 Flash</div>
                                <div class="model-option" data-value="gemini-2.5-pro">Gemini 2.5 Pro</div>
                                <div class="model-option" data-value="gemini-3-flash">Gemini 3 Flash</div>
                                <div class="model-option" data-value="gemini-3-pro">Gemini 3 Pro</div>
                                <div class="model-option" data-value="claude-sonnet-4.5">Claude Sonnet 4.5</div>
                                <div class="model-option" data-value="grok-latest">Grok (xAI)</div>
                                <div class="model-option" data-value="gpt-4.1">GPT-4.1 (OpenAI)</div>
                                <div class="model-option" data-value="llama3.2-vision:11b">Llama 3.2 Vision (Local)</div>
                            </div>
                        </div>
                        <input type="hidden" id="vision-fallback-select" value="gemini-2.5-flash">
                        <div class="config-help">Used for images when the active model doesn't support vision.</div>
                    </div>
                    <div style="margin-top:10px;">
                        <h4 style="font-size:12px; margin-bottom:4px;">Circuits Model</h4>
                        <div class="model-select-radial" id="circuits-model-wrapper" style="margin-bottom:6px;">
                            <div class="selected">
                                <span class="model-name" id="circuits-model-label">Use Default Model</span>
                                <span class="model-arrow">\u25BC</span>
                            </div>
                            <div class="model-options-radial" id="circuits-model-options" style="display:none;">
                                <!-- Populated dynamically from model catalog -->
                            </div>
                        </div>
                        <input type="hidden" id="circuits-model-select" value="">
                        <div class="config-help">Model for background circuits/scheduled tasks. Defaults to your main model.</div>
                    </div>
                </div>
                <div class="divider"></div>
                <div class="temperature-section">
                    <h4>Temperature: <span id="temperature-value-radial">${temperatureValue}</span></h4>
                    <input type="range" id="temperature-radial" min="0.0" max="2.0" step="0.1" value="${temperatureValue}">
                    <div class="config-help">Higher values make output more random, lower values more focused.</div>
                </div>
                <div class="max-tokens-section" style="margin-top:8px;">
                    <h4 style="margin-bottom:6px;">Max Tokens:</h4>
                    <input type="number" id="max-tokens-radial" min="128" max="128000" step="128" value="${maxTokensValue}" 
                        style="width: 220px; padding: 6px 8px; box-sizing: border-box; font-size: 14px;">
                    <div class="config-help">Applies to chat and screenshot responses only. Default 16384. Reduce to prevent rambles. Note creation uses its own limits.</div>
                </div>
                <div class="context-limit-section" style="margin-top:12px;">
                    <h4>Context Items: <span id="context-limit-value-radial">${contextLimitValue}</span></h4>
                    <input type="range" id="context-limit-radial" min="1" max="30" step="1" value="${contextLimitValue}">
                    <div class="config-help">How many prior items to inject as conversation context (semantic + recent).</div>
                </div>
                <div class="divider" style="margin:14px 0;"></div>
                <div class="mic-sensitivity-section" style="margin-top:8px;">
                    <h4>Microphone <span id="mic-level-readout" style="font-size:9px; color:rgba(255,255,255,0.5); font-weight:normal; margin-left:6px;">--</span></h4>
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                        <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:28px;">STT</span>
                        <select id="stt-provider-select" style="flex:1; background:rgba(0,0,0,0.4); color:#fff; border:1px solid rgba(79,195,247,0.3); border-radius:4px; padding:3px 6px; font-size:11px; outline:none; cursor:pointer;">
                            <option value="whisper">Whisper (Local)</option>
                            <option value="gemini">Gemini (Cloud)</option>
                            <option value="google-cloud">Google Cloud STT</option>
                        </select>
                        <span id="stt-provider-status" style="font-size:9px; color:rgba(255,255,255,0.4); min-width:28px; text-align:right;">local</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:28px;">Gain</span>
                        <input type="range" id="mic-gain-slider" min="0.1" max="5.0" step="0.1" value="1.0"
                            style="flex:1; accent-color:#ffa726; height:4px;">
                        <span id="mic-gain-value" style="font-size:9px; color:#ffa726; min-width:28px; text-align:right;">1.0x</span>
                    </div>
                    <div id="mic-meter-container" style="position:relative; height:22px; background:rgba(0,0,0,0.5); border-radius:11px; overflow:visible; border:1px solid rgba(79,195,247,0.25); cursor:pointer; user-select:none; -webkit-user-select:none;">
                        <div id="mic-level-bar" style="position:absolute; left:0; top:0; height:100%; width:0%; background:linear-gradient(90deg, rgba(79,195,247,0.6), rgba(0,230,118,0.8)); border-radius:11px; transition:width 0.08s ease-out; pointer-events:none;"></div>
                        <div id="mic-threshold-handle" style="position:absolute; top:-3px; height:28px; width:4px; background:#ff5252; border-radius:2px; left:10%; z-index:3; cursor:ew-resize; box-shadow:0 0 6px rgba(255,82,82,0.6);">
                            <div style="position:absolute; top:-14px; left:50%; transform:translateX(-50%); font-size:8px; color:#ff5252; white-space:nowrap; pointer-events:none;" id="mic-threshold-label">0.005</div>
                        </div>
                    </div>
                    <input type="hidden" id="mic-threshold-slider" value="0.005">
                    <div class="config-help" style="margin-top:4px;"><span style="color:#ffa726;">Gain</span> = mic amplification. <span style="color:#ff5252;">Red handle</span> = trigger threshold. Bar = live level.</div>
                    <div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(79,195,247,0.15);">
                        <div style="font-size:9px; color:rgba(79,195,247,0.5); margin-bottom:6px; text-transform:uppercase; letter-spacing:1px;">Timing</div>
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                            <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;" title="How long to wait after speech stops before sending transcript">Silence</span>
                            <input type="range" id="mic-silence-timeout" min="0.3" max="10.0" step="0.1" value="2.0"
                                style="flex:1; accent-color:#4fc3f7; height:4px;">
                            <span id="mic-silence-timeout-value" style="font-size:9px; color:#4fc3f7; min-width:28px; text-align:right;">2.0s</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                            <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;" title="Max seconds of audio to buffer before auto-sending">Max Buf</span>
                            <input type="range" id="mic-chunk-trigger" min="1.0" max="30.0" step="0.5" value="6.0"
                                style="flex:1; accent-color:#4fc3f7; height:4px;">
                            <span id="mic-chunk-trigger-value" style="font-size:9px; color:#4fc3f7; min-width:28px; text-align:right;">6.0s</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                            <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;" title="Minimum audio length required before processing">Min Audio</span>
                            <input type="range" id="mic-min-chunk" min="0.2" max="5.0" step="0.1" value="1.0"
                                style="flex:1; accent-color:#4fc3f7; height:4px;">
                            <span id="mic-min-chunk-value" style="font-size:9px; color:#4fc3f7; min-width:28px; text-align:right;">1.0s</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                            <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;" title="Pause after agent speaks before listening again">Cooldown</span>
                            <input type="range" id="mic-voice-cooldown" min="0.0" max="5.0" step="0.1" value="0.2"
                                style="flex:1; accent-color:#4fc3f7; height:4px;">
                            <span id="mic-voice-cooldown-value" style="font-size:9px; color:#4fc3f7; min-width:28px; text-align:right;">0.2s</span>
                        </div>
                        <div class="config-help" style="margin-top:2px;"><span style="color:#4fc3f7;">Silence</span> = wait after speech stops. <span style="color:#4fc3f7;">Max Buf</span> = auto-send limit. <span style="color:#4fc3f7;">Min Audio</span> = ignore short clips. <span style="color:#4fc3f7;">Cooldown</span> = pause after agent speaks.</div>
                    </div>
                </div>
                <div class="divider" style="margin:14px 0;"></div>
                <div class="volume-section" style="margin-top:8px;">
                    <h4>Volume</h4>
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;">Voice</span>
                        <input type="range" id="voice-volume-radial" min="0" max="100" step="5" value="80"
                            style="flex:1; accent-color:#4fc3f7; height:4px;">
                        <span id="voice-volume-radial-value" style="font-size:9px; color:#4fc3f7; min-width:28px; text-align:right;">80%</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <span style="font-size:9px; color:rgba(79,195,247,0.7); min-width:52px;">SFX</span>
                        <input type="range" id="sfx-volume-radial" min="0" max="100" step="5" value="80"
                            style="flex:1; accent-color:#ffa726; height:4px;">
                        <span id="sfx-volume-radial-value" style="font-size:9px; color:#ffa726; min-width:28px; text-align:right;">80%</span>
                    </div>
                    <div class="config-help"><span style="color:#4fc3f7;">Voice</span> = TTS reply volume. <span style="color:#ffa726;">SFX</span> = recorder start/stop sounds.</div>
                </div>
                <div class="divider" style="margin:14px 0;"></div>
                <div class="memory-actions" style="display:flex; justify-content:flex-end;">
                    <button id="reset-memory-btn" class="config-button">Reset Memory</button>
                </div>
            </div>
        `;
    }

    // Avatar section content (kept for backward compatibility)
    function getAvatarContent() {
        console.warn("getAvatarContent is deprecated, use getAgentModelContent instead");
        return `
            <div class="avatar-upload-radial">
                <img id="avatar-preview-radial" class="avatar-preview-radial" src="default-avatar.png" alt="Agent Avatar">
                <input type="file" id="avatar-input-radial" accept="image/*">
                <label for="avatar-input-radial">Choose Avatar</label>
                <div class="config-help">Select an image to use as the agent's avatar (recommended: 64x64 or larger)</div>
            </div>
        `;
    }

    // Model selection content (kept for backward compatibility)
    function getModelContent() {
        console.warn("getModelContent is deprecated, use getAgentModelContent instead");
        return `
            <div class="model-select-radial">
                <div class="selected">
                    <span class="model-name" id="selected-model-name">Loading models...</span>
                    <span class="model-arrow">▼</span>
                </div>
                <div class="model-options-radial" id="model-options-radial">
                    <!-- Models will be populated dynamically -->
                </div>
            </div>
            <div class="config-help">Choose the AI model to use for responses.</div>
        `;
    }
    
    // Store click handlers to be able to remove them later
    let modelSelectClickHandler = null;
    let documentClickHandler = null;
    
    // Function to populate model options
    async function populateModelOptions() {
        let currentModel = '';
        try {
            const modelInput = document.getElementById('model-input');
            if (modelInput && modelInput.value) {
                currentModel = modelInput.value;
            }

            // Ensure we have at least fallback metadata available for styling
            if (modelLookup.size === 0) {
                populateModelCache(MODEL_FALLBACKS.map(normalizeModelEntry));
            }

            const selectedModelName = document.getElementById('selected-model-name');
            if (selectedModelName) {
                selectedModelName.textContent = currentModel || 'Select a model';
            }

            const modelSelect = document.querySelector('.model-select-radial');
            const modelOptions = document.getElementById('model-options-radial');

            if (!(modelSelect && modelOptions)) {
                return;
            }

            if (modelSelectClickHandler) {
                modelSelect.removeEventListener('click', modelSelectClickHandler);
            }
            if (documentClickHandler) {
                document.removeEventListener('click', documentClickHandler);
            }

            const applyDropdownLayout = () => {
                if (modelOptions.parentElement !== modelSelect) {
                    modelSelect.appendChild(modelOptions);
                }
                modelSelect.style.position = '';
                modelSelect.style.overflow = '';
                modelOptions.style.position = 'static';
                modelOptions.style.width = '100%';
                modelOptions.style.marginTop = '6px';
                modelOptions.style.maxHeight = '380px';
                modelOptions.style.overflowY = 'auto';
                modelOptions.style.background = 'rgba(0, 0, 0, 0.35)';
                modelOptions.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                modelOptions.style.borderRadius = '6px';
                modelOptions.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.04)';
                modelOptions.style.padding = '6px';
                modelOptions.style.color = '#e6f2ff';
                modelOptions.style.fontSize = '14px';
                modelOptions.style.lineHeight = '1.2';
                modelOptions.style.display = 'block';
                modelOptions.style.pointerEvents = 'auto';
            };

            const closeDropdown = () => {
                modelOptions.style.display = 'none';
                modelOptions.setAttribute('aria-expanded', 'false');
            };

            const openDropdown = () => {
                applyDropdownLayout();
                modelOptions.style.display = 'block';
                modelOptions.setAttribute('aria-expanded', 'true');
            };

            const toggleDropdown = () => {
                if (modelOptions.style.display === 'block') {
                    closeDropdown();
                } else {
                    buildModelDropdown();
                }
            };

            const buildModelDropdown = async () => {
                modelOptions.innerHTML = '';
                const loading = document.createElement('div');
                loading.textContent = 'Loading models...';
                loading.style.opacity = '0.8';
                loading.style.padding = '6px 4px';
                modelOptions.appendChild(loading);
                openDropdown();

                try {
                    // Fetch static models + discover live models in parallel
                    const [staticRes, discoverRes] = await Promise.allSettled([
                        fetch('http://localhost:8765/api/models').then(r => r.json()),
                        fetch('http://localhost:8765/api/discover-models').then(r => r.json())
                    ]);

                    let models = [];
                    if (staticRes.status === 'fulfilled' && staticRes.value?.status === 'success') {
                        models = (staticRes.value.models || []).map(normalizeModelEntry);
                    }
                    if (!models.length) {
                        models = MODEL_FALLBACKS.map(normalizeModelEntry);
                    }

                    // Merge discovered models from live API queries
                    const knownNames = new Set(models.map(m => m.name));
                    if (discoverRes.status === 'fulfilled' && discoverRes.value?.providers) {
                        const providers = discoverRes.value.providers;
                        for (const [provider, provModels] of Object.entries(providers)) {
                            for (const dm of provModels) {
                                const mid = dm.id || '';
                                if (!mid || knownNames.has(mid)) continue;
                                // For Anthropic, auto-generate endpoint/config so it's usable
                                const entry = {
                                    name: mid, provider: provider,
                                    display_name: dm.display_name || mid,
                                    key_active: true, discovered: true
                                };
                                if (provider === 'anthropic') {
                                    entry.endpoint = 'https://api.anthropic.com/v1/messages';
                                    entry.auth_env = 'ANTHROPIC_API_KEY';
                                } else if (provider === 'google') {
                                    entry.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${mid}:generateContent`;
                                    entry.auth_env = 'GOOGLE_API_KEY';
                                } else if (provider === 'xai') {
                                    entry.endpoint = 'https://api.x.ai/v1/chat/completions';
                                    entry.auth_env = 'XAI_API_KEY';
                                } else if (provider === 'openai') {
                                    entry.endpoint = 'https://api.openai.com/v1/chat/completions';
                                    entry.auth_env = 'OPENAI_API_KEY';
                                }
                                models.push(normalizeModelEntry(entry));
                                knownNames.add(mid);
                            }
                        }
                    }

                    populateModelCache(models);
                    renderDropdown(models, currentModel, modelInput, selectedModelName, modelOptions, closeDropdown);
                    updateSelectedModelStyles(currentModel);
                } catch (err) {
                    console.error('Error fetching models:', err);
                    const fallback = (cachedModelCatalog.length ? cachedModelCatalog : MODEL_FALLBACKS.map(normalizeModelEntry));
                    populateModelCache(fallback);
                    renderDropdown(fallback, currentModel, modelInput, selectedModelName, modelOptions, closeDropdown);
                    updateSelectedModelStyles(currentModel);
                }
            };

            modelSelectClickHandler = function (e) {
                e.stopPropagation();
                toggleDropdown();
            };

            documentClickHandler = function () {
                closeDropdown();
            };

            modelSelect.addEventListener('click', modelSelectClickHandler);
            document.addEventListener('click', documentClickHandler);
            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') closeDropdown();
            }, { once: true });

        } catch (error) {
            console.error('Error setting up model selection:', error);
        }

        updateSelectedModelStyles(currentModel);
    }

    function normalizeModelEntry(model) {
        if (!model || typeof model !== 'object') {
            return { name: String(model || ''), provider: 'ollama' };
        }
        return {
            name: model.name || '',
            provider: model.provider || 'ollama',
            size: model.size || '',
            modified_at: model.modified_at || '',
            endpoint: model.endpoint,
            auth_env: model.auth_env,
            display_name: model.display_name || model.name || '',
            notes: model.notes || '',
            key_active: model.key_active,
            discovered: model.discovered || false
        };
    }

    function populateModelCache(models) {
        if (!Array.isArray(models)) return;
        cachedModelCatalog = models.slice();
        modelLookup.clear();
        cachedModelCatalog.forEach(entry => {
            if (entry?.name) {
                modelLookup.set(entry.name, entry);
            }
        });
    }

    // Provider tab definitions with brand colors
    const PROVIDER_TABS = [
        { key: 'all', label: 'All', color: '#94a3b8' },
        { key: 'favorites', label: '★', color: '#facc15' },
        { key: 'anthropic', label: 'Anthropic', color: '#d4a574' },
        { key: 'google', label: 'Google', color: '#4285f4' },
        { key: 'xai', label: 'xAI', color: '#e5e5e5' },
        { key: 'openai', label: 'OpenAI', color: '#74aa9c' },
        { key: 'ollama', label: 'Local', color: '#a78bfa' },
    ];

    function smartSort(models, currentModel) {
        const favs = [];
        const selected = [];
        const curated = [];
        const discovered = [];
        for (const m of models) {
            if (isFavorite(m.name)) favs.push(m);
            else if (m.name === currentModel) selected.push(m);
            else if (!m.discovered) curated.push(m);
            else discovered.push(m);
        }
        return [...favs, ...selected, ...curated, ...discovered];
    }

    function renderDropdown(models, currentModel, modelInput, selectedModelName, container, closeDropdown) {
        container.innerHTML = '';

        // --- Search row ---
        const searchRow = document.createElement('div');
        searchRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin:0 0 6px; min-height:14px;';
        const info = document.createElement('div');
        info.className = 'model-count-info';
        info.style.cssText = 'font-size:11px; opacity:0.6; white-space:nowrap; min-width:60px;';
        const filter = document.createElement('input');
        filter.type = 'text';
        filter.placeholder = 'Search models...';
        styleFilterInput(filter);
        searchRow.appendChild(info);
        searchRow.appendChild(filter);
        container.appendChild(searchRow);

        // --- Provider tabs ---
        const tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; margin:0 0 8px; padding:0 0 6px; border-bottom:1px solid rgba(255,255,255,0.06);';
        const tabButtons = {};
        PROVIDER_TABS.forEach(tab => {
            const btn = document.createElement('button');
            btn.textContent = tab.label;
            btn.dataset.tab = tab.key;
            btn.style.cssText = `
                font-size:10px; padding:2px 8px; border-radius:10px; border:1px solid rgba(255,255,255,0.12);
                background:transparent; color:${tab.color}; cursor:pointer; transition:all 150ms ease;
                font-family:inherit; line-height:1.4; letter-spacing:0.3px; outline:none;
            `.replace(/\n/g, '');
            if (tab.key === activeProviderFilter) {
                btn.style.background = tab.color;
                btn.style.color = '#0a0a0f';
                btn.style.borderColor = tab.color;
                btn.style.fontWeight = '600';
            }
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                activeProviderFilter = tab.key;
                Object.entries(tabButtons).forEach(([k, b]) => {
                    const t = PROVIDER_TABS.find(p => p.key === k);
                    if (k === tab.key) {
                        b.style.background = t.color;
                        b.style.color = '#0a0a0f';
                        b.style.borderColor = t.color;
                        b.style.fontWeight = '600';
                    } else {
                        b.style.background = 'transparent';
                        b.style.color = t.color;
                        b.style.borderColor = 'rgba(255,255,255,0.12)';
                        b.style.fontWeight = 'normal';
                    }
                });
                applyFilters();
            });
            btn.addEventListener('mouseenter', () => {
                if (tab.key !== activeProviderFilter) btn.style.background = 'rgba(255,255,255,0.06)';
            });
            btn.addEventListener('mouseleave', () => {
                if (tab.key !== activeProviderFilter) btn.style.background = 'transparent';
            });
            tabButtons[tab.key] = btn;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // --- Model list container ---
        const listContainer = document.createElement('div');
        listContainer.className = 'model-list-inner';
        container.appendChild(listContainer);

        const renderList = (list) => {
            listContainer.innerHTML = '';
            info.textContent = `${list.length} model${list.length !== 1 ? 's' : ''}`;
            if (!list || list.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'model-option';
                empty.textContent = 'No models found';
                empty.style.cssText = 'opacity:0.7; pointer-events:none; padding:8px 10px;';
                listContainer.appendChild(empty);
                return;
            }

            // Insert favorites separator if there are favorites in the list
            let insertedSep = false;
            list.forEach((entry, idx) => {
                // Separator between favorites and non-favorites
                if (!insertedSep && idx > 0 && isFavorite(list[idx - 1].name) && !isFavorite(entry.name)) {
                    const sep = document.createElement('div');
                    sep.style.cssText = 'height:1px; background:rgba(250,204,21,0.15); margin:4px 0;';
                    listContainer.appendChild(sep);
                    insertedSep = true;
                }

                const option = document.createElement('div');
                option.className = 'model-option';
                option.dataset.provider = entry.provider;
                option.style.cssText = 'display:flex; align-items:center; padding:6px 8px; border-radius:6px; cursor:pointer; user-select:none; transition:background 120ms ease; gap:6px;';

                // Star button
                const star = document.createElement('span');
                star.className = 'model-fav-star';
                star.textContent = isFavorite(entry.name) ? '★' : '☆';
                star.style.cssText = `
                    cursor:pointer; font-size:14px; line-height:1; flex-shrink:0; transition:color 150ms ease;
                    color:${isFavorite(entry.name) ? '#facc15' : 'rgba(255,255,255,0.2)'};
                `.replace(/\n/g, '');
                star.title = isFavorite(entry.name) ? 'Remove from favorites' : 'Add to favorites';
                star.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    toggleFavorite(entry.name);
                    // Re-render with updated favorites
                    applyFilters();
                });
                star.addEventListener('mouseenter', () => { star.style.color = '#facc15'; });
                star.addEventListener('mouseleave', () => { star.style.color = isFavorite(entry.name) ? '#facc15' : 'rgba(255,255,255,0.2)'; });
                option.appendChild(star);

                // Model label area
                const labelSpan = document.createElement('span');
                labelSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;';

                if (entry.provider && entry.provider !== 'ollama') {
                    option.classList.add('model-option-remote');
                    const dot = document.createElement('span');
                    dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:middle;flex-shrink:0;';
                    dot.style.background = entry.key_active ? '#4ade80' : '#f87171';
                    dot.title = entry.key_active ? 'API key active' : 'API key not configured';
                    labelSpan.appendChild(dot);
                    labelSpan.appendChild(document.createTextNode(entry.display_name || entry.name));
                    if (entry.discovered) {
                        const badge = document.createElement('span');
                        badge.textContent = 'LIVE';
                        badge.style.cssText = 'font-size:9px;background:rgba(99,102,241,0.3);color:#a5b4fc;padding:1px 4px;border-radius:3px;margin-left:6px;vertical-align:middle;letter-spacing:0.5px;';
                        labelSpan.appendChild(badge);
                    }
                } else {
                    labelSpan.textContent = entry.display_name || entry.name;
                }
                option.appendChild(labelSpan);

                // Provider badge (small, right-aligned)
                const provBadge = document.createElement('span');
                const provTab = PROVIDER_TABS.find(t => t.key === entry.provider);
                provBadge.textContent = entry.provider === 'ollama' ? 'local' : entry.provider;
                provBadge.style.cssText = `font-size:9px; opacity:0.4; flex-shrink:0; color:${provTab ? provTab.color : '#888'};`;
                option.appendChild(provBadge);

                option.title = entry.provider !== 'ollama' ? `${entry.name} — ${entry.provider.toUpperCase()} (online)` : entry.name;

                if (entry.name === currentModel) {
                    option.style.background = 'rgba(79,195,247,0.1)';
                    option.style.borderLeft = '2px solid rgba(79,195,247,0.5)';
                }

                option.addEventListener('mouseenter', () => { if (entry.name !== currentModel) option.style.background = 'rgba(255,255,255,0.06)'; });
                option.addEventListener('mouseleave', () => { option.style.background = entry.name === currentModel ? 'rgba(79,195,247,0.1)' : 'transparent'; });
                option.addEventListener('click', () => {
                    if (selectedModelName) {
                        selectedModelName.textContent = entry.display_name || entry.name;
                    }
                    if (modelInput) {
                        modelInput.value = entry.name;
                        const event = new Event('change', { bubbles: true });
                        modelInput.dispatchEvent(event);
                    }
                    closeDropdown();
                    updateSelectedModelStyles(entry.name);
                });

                listContainer.appendChild(option);
            });
        };

        // Combined filter: search query + provider tab
        const applyFilters = () => {
            const query = filter.value.toLowerCase();
            let filtered = models;
            // Provider tab filter
            if (activeProviderFilter === 'favorites') {
                filtered = filtered.filter(m => isFavorite(m.name));
            } else if (activeProviderFilter !== 'all') {
                filtered = filtered.filter(m => m.provider === activeProviderFilter);
            }
            // Text search filter
            if (query) {
                filtered = filtered.filter(entry =>
                    entry.name.toLowerCase().includes(query) ||
                    (entry.display_name && entry.display_name.toLowerCase().includes(query)) ||
                    (entry.provider && entry.provider.toLowerCase().includes(query))
                );
            }
            renderList(smartSort(filtered, currentModel));
        };

        // Initial render
        applyFilters();

        filter.addEventListener('input', applyFilters);

        container.addEventListener('click', (ev) => ev.stopPropagation());
        container.addEventListener('mousedown', (ev) => ev.stopPropagation());
        filter.addEventListener('click', (ev) => ev.stopPropagation());
        if (typeof applyDropdownLayout === 'function') {
            applyDropdownLayout();
        }
    }

    function styleFilterInput(filter) {
        filter.style.width = '20%';
        filter.style.minWidth = '140px';
        filter.style.boxSizing = 'border-box';
        filter.style.fontSize = '12px';
        filter.style.padding = '0 6px';
        filter.style.color = '#e6f2ff';
        filter.style.background = 'transparent';
        filter.style.border = '1px solid rgba(255,255,255,0.16)';
        filter.style.borderRadius = '3px';
        filter.style.outline = 'none';
        filter.style.boxShadow = 'none';
        filter.style.backdropFilter = 'none';
        filter.style.WebkitAppearance = 'none';
        filter.style.MozAppearance = 'none';
        filter.style.appearance = 'none';
        filter.style.display = 'inline-block';
        filter.style.setProperty('height', '14px', 'important');
        filter.style.setProperty('min-height', '14px', 'important');
        filter.style.setProperty('max-height', '14px', 'important');
        filter.style.setProperty('line-height', '14px', 'important');
        filter.style.setProperty('padding-top', '0', 'important');
        filter.style.setProperty('padding-bottom', '0', 'important');
        filter.style.setProperty('margin', '0', 'important');
        filter.style.setProperty('box-shadow', 'none', 'important');
        filter.style.setProperty('backdrop-filter', 'none', 'important');
        filter.style.setProperty('transform', 'none', 'important');
        filter.style.setProperty('-webkit-transform', 'none', 'important');
        filter.style.setProperty('filter', 'none', 'important');
    }

    function updateSelectedModelStyles(modelName) {
        const wrapper = document.querySelector('.model-select-radial');
        const selectedLabel = document.getElementById('selected-model-name');
        if (!wrapper || !selectedLabel) return;

        const meta = modelLookup.get(modelName) || MODEL_FALLBACKS.find(m => m.name === modelName);
        const provider = meta?.provider || 'ollama';

        wrapper.classList.toggle('remote-active', provider !== 'ollama');
        selectedLabel.classList.toggle('remote-provider', provider !== 'ollama');
        if (provider !== 'ollama') {
            selectedLabel.dataset.provider = provider;
        } else {
            delete selectedLabel.dataset.provider;
        }
    }
    
    // System prompt content - now edits SUBSTRATE.md directly
    function getSystemPromptContent() {
        return `
            <div class="substrate-editor">
                <div class="substrate-header">
                    <label for="substrate-input-radial">SUBSTRATE.md <span class="substrate-badge">Agent Personality</span></label>
                    <button id="substrate-reload-btn" class="config-button-small" title="Reload from file">↻</button>
                </div>
                <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="substrate-input-radial" rows="14" placeholder="Loading SUBSTRATE.md..."></textarea>
                <div class="config-help">Edit your agent's core personality and behavior. Changes save to SUBSTRATE.md file.</div>
                <div class="substrate-status" id="substrate-status"></div>
            </div>
        `;
    }
    
    // Load SUBSTRATE.md content into the editor (with retry)
    async function loadSubstrateContent(retries) {
        if (retries === undefined) retries = 8;
        const textarea = document.getElementById('substrate-input-radial');
        const status = document.getElementById('substrate-status');
        if (!textarea) { console.warn('SUBSTRATE textarea not found'); return; }
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                console.log('Loading SUBSTRATE.md content from /api/substrate (attempt ' + (attempt+1) + '/' + (retries+1) + ')...');
                const res = await fetch('http://localhost:8765/api/substrate');
                console.log('SUBSTRATE.md fetch response status:', res.status);
                const data = await res.json();
                console.log('SUBSTRATE.md response data:', JSON.stringify(data).substring(0, 200));
                if (data.status === 'success') {
                    textarea.value = data.content || '';
                    textarea.dataset.loaded = 'true';
                    if (status) status.textContent = '';
                    console.log('SUBSTRATE.md loaded successfully (' + (data.content || '').length + ' chars)');
                    return;
                } else {
                    console.warn('SUBSTRATE.md load returned non-success:', data);
                    if (status) status.textContent = 'Failed to load: ' + (data.message || 'unknown error');
                }
            } catch (err) {
                console.error('Error loading SUBSTRATE.md (attempt ' + (attempt+1) + '):', err);
                if (attempt < retries) {
                    const delay = Math.min((attempt + 1) * 2000, 6000);
                    console.log('Retrying SUBSTRATE.md load in ' + delay + 'ms...');
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    if (status) status.textContent = 'Error loading SUBSTRATE.md';
                    textarea.placeholder = 'Could not load SUBSTRATE.md - click ↻ to retry';
                }
            }
        }
    }
    
    // Save SUBSTRATE.md content
    async function saveSubstrateContent() {
        const textarea = document.getElementById('substrate-input-radial');
        const status = document.getElementById('substrate-status');
        if (!textarea) return;
        
        try {
            const res = await fetch('http://localhost:8765/api/substrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: textarea.value })
            });
            const data = await res.json();
            if (data.status === 'success') {
                if (status) {
                    status.textContent = 'Saved ✓';
                    status.style.color = '#4ade80';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            } else {
                if (status) {
                    status.textContent = 'Save failed';
                    status.style.color = '#f87171';
                }
            }
        } catch (err) {
            console.error('Error saving SUBSTRATE.md:', err);
            if (status) {
                status.textContent = 'Error saving';
                status.style.color = '#f87171';
            }
        }
    }
    
    // Load CIRCUITS.md content into the editor (with retry)
    async function loadCircuitsContent(retries) {
        if (retries === undefined) retries = 8;
        const textarea = document.getElementById('circuits-input-radial');
        const status = document.getElementById('circuits-status');
        if (!textarea) {
            console.warn('CIRCUITS textarea not found in DOM');
            return;
        }
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                console.log('Loading CIRCUITS.md from /api/circuits (attempt ' + (attempt+1) + '/' + (retries+1) + ')...');
                const res = await fetch('http://localhost:8765/api/circuits');
                console.log('CIRCUITS.md response status:', res.status, res.statusText);
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status + ' ' + res.statusText);
                }
                const text = await res.text();
                console.log('CIRCUITS.md raw response:', text.substring(0, 300));
                let data;
                try { data = JSON.parse(text); } catch(e) {
                    console.error('CIRCUITS.md response is not valid JSON:', e);
                    if (status) status.textContent = 'Invalid response from server';
                    return;
                }
                if (data.status === 'success') {
                    textarea.value = data.content || '';
                    textarea.placeholder = 'Enter tasks for the agent...';
                    textarea.dataset.loaded = 'true';
                    if (status) status.textContent = '';
                    console.log('CIRCUITS.md loaded OK (' + (data.content || '').length + ' chars)');
                    return;
                } else {
                    console.warn('CIRCUITS.md non-success response:', data);
                    if (status) status.textContent = 'Failed: ' + (data.message || 'unknown error');
                    textarea.placeholder = 'Failed to load - click ↻ to retry';
                }
            } catch (err) {
                console.error('CIRCUITS.md fetch error (attempt ' + (attempt+1) + '):', err.message || err);
                if (attempt < retries) {
                    const delay = Math.min((attempt + 1) * 2000, 6000);
                    console.log('Retrying CIRCUITS.md in ' + delay + 'ms...');
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    if (status) status.textContent = 'Error loading CIRCUITS.md';
                    textarea.placeholder = 'Could not load - click ↻ to retry';
                }
            }
        }
    }
    
    // Save CIRCUITS.md content
    async function saveCircuitsContent() {
        const textarea = document.getElementById('circuits-input-radial');
        const status = document.getElementById('circuits-status');
        if (!textarea) return;
        
        try {
            const res = await fetch('http://localhost:8765/api/circuits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: textarea.value })
            });
            const data = await res.json();
            if (data.status === 'success') {
                if (status) {
                    status.textContent = 'Saved ✓';
                    status.style.color = '#4ade80';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            } else {
                if (status) {
                    status.textContent = 'Save failed';
                    status.style.color = '#f87171';
                }
            }
        } catch (err) {
            console.error('Error saving CIRCUITS.md:', err);
            if (status) {
                status.textContent = 'Error saving';
                status.style.color = '#f87171';
            }
        }
    }
    
    // Circuits config helpers (hoisted to IIFE scope for access from updateActiveSection)
    function _secondsToDisplay(sec) {
        if (!sec || sec <= 0) return '30m';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        let parts = [];
        if (h > 0) parts.push(h + 'h');
        if (m > 0) parts.push(m + 'm');
        if (s > 0 && h === 0) parts.push(s + 's');
        return parts.join('') || '30m';
    }

    function _updateCircuitsBadge(data) {
        const badge = document.getElementById('circuits-running-badge');
        if (!badge) return;
        if (data.running) {
            badge.textContent = data.next_due_in ? 'Running \u2022 next: ' + data.next_due_in : 'Running';
            badge.style.color = '#f59e0b';
            badge.style.background = 'rgba(245,158,11,0.15)';
        } else if (data.enabled) {
            badge.textContent = 'Enabled (not running)';
            badge.style.color = '#888';
            badge.style.background = 'rgba(255,255,255,0.1)';
        } else {
            badge.textContent = 'Disabled';
            badge.style.color = '#666';
            badge.style.background = 'rgba(255,255,255,0.05)';
        }
    }

    async function loadCircuitsConfig() {
        try {
            const res = await fetch('http://localhost:8765/api/circuits-config');
            if (!res.ok) return;
            const data = await res.json();
            if (data.status !== 'success') return;
            const toggle = document.getElementById('circuits-enabled-toggle');
            const interval = document.getElementById('circuits-interval-input');
            const activeStart = document.getElementById('circuits-active-start');
            const activeEnd = document.getElementById('circuits-active-end');
            if (toggle) toggle.checked = !!data.enabled;
            if (interval) interval.value = _secondsToDisplay(data.interval_seconds || 1800);
            if (activeStart) activeStart.value = data.active_start || '';
            if (activeEnd) activeEnd.value = data.active_end || '';
            _updateCircuitsBadge(data);
        } catch (e) { console.warn('Failed to load circuits config:', e); }
    }

    async function saveCircuitsConfig() {
        try {
            const toggle = document.getElementById('circuits-enabled-toggle');
            const interval = document.getElementById('circuits-interval-input');
            const activeStart = document.getElementById('circuits-active-start');
            const activeEnd = document.getElementById('circuits-active-end');
            const body = {};
            if (toggle) body.enabled = toggle.checked;
            if (interval && interval.value.trim()) body.interval = interval.value.trim();
            if (activeStart) body.active_start = activeStart.value || '';
            if (activeEnd) body.active_end = activeEnd.value || '';
            const res = await fetch('http://localhost:8765/api/circuits-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.status === 'success') {
                _updateCircuitsBadge(data);
                if (interval) interval.value = _secondsToDisplay(data.interval_seconds || 1800);
                console.log('Circuits config saved:', data);
            }
        } catch (e) { console.error('Failed to save circuits config:', e); }
    }

    // (Removed: getScreenshotPromptContent)
    
    // Note creation content
    function getNoteCreationContent() {
        // Get values from original panel if available
        const generalNotePromptInput = originalConfigPanel.querySelector('#general-note-prompt-input');
        const generalValue = generalNotePromptInput ? generalNotePromptInput.value : '';
        
        const autonomousNotePromptInput = originalConfigPanel.querySelector('#autonomous-note-prompt-input');
        const autonomousValue = autonomousNotePromptInput ? autonomousNotePromptInput.value : '';
        
        return `
            <div class="setting-group">
                <h4>Note Output Location</h4>
                <div class="config-row" style="flex-direction:column; align-items:stretch; gap:6px;">
                    <input type="text" id="vault-path-radial" placeholder="C:\\Users\\You\\Documents\\Obsidian\\Notes" style="width:100%; padding:6px 10px; border-radius:6px; border:1px solid rgba(79,195,247,0.3); background:rgba(0,0,0,0.3); color:#fff; font-size:12px; font-family:monospace;">
                    <div class="config-help">Folder where notes and .md files are saved. Works with or without Obsidian.</div>
                </div>
                <div id="vault-path-status" style="font-size:11px; min-height:14px; color:#888; margin-top:4px;"></div>
            </div>

            <div class="setting-group">
                <h4>General Note Prompt</h4>
                <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="general-note-prompt-input-radial" rows="6" placeholder="Create a detailed and well-structured note...">${generalValue}</textarea>
                <div class="config-help">This prompt guides how general notes are structured and formatted.</div>
            </div>
            
            <div class="setting-group">
                <h4>Autonomous Note Prompt</h4>
                <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="autonomous-note-prompt-input-radial" rows="6" placeholder="Based on recent context and interactions, create a detailed note that...">${autonomousValue}</textarea>
                <div class="config-help">This prompt guides how autonomous notes are created from recent interactions.</div>
            </div>
            
            <div class="setting-group">
                <h4>Note Creation Settings</h4>
                <div class="config-row">
                    <label for="note-creation-enabled-radial">Enable Note Creation:</label>
                    <input type="checkbox" id="note-creation-enabled-radial">
                </div>
                
                <div class="config-row">
                    <label for="notes-min-interval-radial">Minimum Interval (seconds):</label>
                    <input type="number" id="notes-min-interval-radial" value="300" min="5">
                </div>
                
                <div class="config-row">
                    <label for="notes-max-interval-radial">Maximum Interval (seconds):</label>
                    <input type="number" id="notes-max-interval-radial" value="900" min="10">
                </div>
            </div>
        `;
    }
    
    // Circuits content - dedicated card for CIRCUITS.md task queue + config controls
    function getCircuitsContent() {
        return `
            <div class="circuits-header">
                <span class="circuits-badge">Task Queue</span>
                <button id="circuits-reload-btn" class="config-button-small" title="Reload from file">\u21BB</button>
            </div>
            <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all; font-family: monospace;" id="circuits-input-radial" rows="10" placeholder="Enter tasks for the agent to work on during circuits cycles..."></textarea>
            <div class="config-help">The agent checks this file periodically. Add tasks, monitoring instructions, or reminders. Changes auto-save.</div>
            <div class="circuits-status" id="circuits-status"></div>
            <div class="circuits-controls" style="margin-top:14px; padding-top:12px; border-top:1px solid rgba(245,158,11,0.15);">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <input type="checkbox" id="circuits-enabled-toggle" style="width:16px; height:16px; accent-color:#f59e0b; cursor:pointer;">
                    <span style="font-weight:600; font-size:13px;">Circuits Enabled</span>
                    <span id="circuits-running-badge" style="font-size:11px; padding:2px 8px; border-radius:8px; background:rgba(255,255,255,0.1); color:#888; margin-left:auto;"></span>
                </div>
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;">
                    <label style="font-size:12px; color:#aaa; min-width:60px;">Interval</label>
                    <input type="text" id="circuits-interval-input" placeholder="30m" value="30m"
                        style="width:80px; padding:4px 8px; border-radius:6px; border:1px solid rgba(245,158,11,0.3); background:rgba(0,0,0,0.3); color:#fff; font-size:13px; font-family:monospace;">
                    <span style="font-size:11px; color:#666;">e.g. 15m, 1h, 2h30m</span>
                </div>
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;">
                    <label style="font-size:12px; color:#aaa; min-width:60px;">Active</label>
                    <input type="time" id="circuits-active-start" style="padding:3px 6px; border-radius:6px; border:1px solid rgba(245,158,11,0.3); background:rgba(0,0,0,0.3); color:#fff; font-size:12px;">
                    <span style="font-size:11px; color:#666;">to</span>
                    <input type="time" id="circuits-active-end" style="padding:3px 6px; border-radius:6px; border:1px solid rgba(245,158,11,0.3); background:rgba(0,0,0,0.3); color:#fff; font-size:12px;">
                    <span style="font-size:11px; color:#666;">(blank = always)</span>
                </div>
            </div>
        `;
    }
    
    // Prime content - dedicated card for PRIME.md startup tasks
    function getPrimeContent() {
        return `
            <div class="prime-header">
                <span class="prime-badge">Startup Tasks</span>
                <button id="prime-reload-btn" class="config-button-small" title="Reload from file">\u21BB</button>
            </div>
            <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all; font-family: monospace;" id="prime-input-radial" rows="12" placeholder="Add startup tasks under '## On Startup'\nExample:\n## On Startup\n- Check my email\n- Summarize today's calendar"></textarea>
            <div class="config-help">Tasks listed under <code>## On Startup</code> run automatically when the app launches. Comment out lines with <code>&lt;!-- --&gt;</code> to disable them.</div>
            <div class="prime-status" id="prime-status"></div>
        `;
    }

    // Load PRIME.md content into the editor (with retry)
    async function loadPrimeContent(retries) {
        if (retries === undefined) retries = 8;
        const textarea = document.getElementById('prime-input-radial');
        const status = document.getElementById('prime-status');
        if (!textarea) {
            console.warn('PRIME textarea not found in DOM');
            return;
        }
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                console.log('Loading PRIME.md from /api/prime (attempt ' + (attempt+1) + '/' + (retries+1) + ')...');
                const res = await fetch('http://localhost:8765/api/prime');
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status + ' ' + res.statusText);
                }
                const data = await res.json();
                if (data.status === 'success') {
                    textarea.value = data.content || '';
                    textarea.placeholder = 'Add startup tasks under \'## On Startup\'...';
                    textarea.dataset.loaded = 'true';
                    if (status) status.textContent = '';
                    console.log('PRIME.md loaded OK (' + (data.content || '').length + ' chars)');
                    return;
                } else {
                    console.warn('PRIME.md non-success response:', data);
                    if (status) status.textContent = 'Failed: ' + (data.message || 'unknown error');
                }
            } catch (err) {
                console.error('PRIME.md fetch error (attempt ' + (attempt+1) + '):', err.message || err);
                if (attempt < retries) {
                    const delay = Math.min((attempt + 1) * 2000, 6000);
                    console.log('Retrying PRIME.md in ' + delay + 'ms...');
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    if (status) status.textContent = 'Error loading PRIME.md';
                    textarea.placeholder = 'Could not load - click \u21BB to retry';
                }
            }
        }
    }
    
    // Save PRIME.md content
    async function savePrimeContent() {
        const textarea = document.getElementById('prime-input-radial');
        const status = document.getElementById('prime-status');
        if (!textarea) return;
        
        try {
            const res = await fetch('http://localhost:8765/api/prime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: textarea.value })
            });
            const data = await res.json();
            if (data.status === 'success') {
                if (status) {
                    status.textContent = 'Saved \u2713';
                    status.style.color = '#4ade80';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            } else {
                if (status) {
                    status.textContent = 'Save failed';
                    status.style.color = '#f87171';
                }
            }
        } catch (err) {
            console.error('Error saving PRIME.md:', err);
            if (status) {
                status.textContent = 'Error saving';
                status.style.color = '#f87171';
            }
        }
    }

    // Autonomy settings content
    function getAutonomyContent() {
        return `
            <div class="autonomy-settings-card">
                <h3>Autonomy Settings</h3>
                <div class="autonomy-settings-content">
                    <section>
                        <h4>Vision Client</h4>
                        <div class="config-row simple-row">
                            <button id="launch-vision-client" class="action-button" style="width: 100%; padding: 10px; margin: 10px 0; background-color: #2a9fd6; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Launch XGO Vision Client</button>
                        </div>
                        <div class="config-help" style="margin-bottom: 15px;">Connect to XGO camera, take snapshots, and analyze images with LLM</div>
                    </section>
                    <section>
                        <h4>Screen Observation</h4>
                        <div class="config-row simple-row">
                            <label for="screenshot-enabled-radial">Enable:</label>
                            <input type="checkbox" id="screenshot-enabled-radial" checked>
                        </div>
                        <div class="interval-container">
                            <div class="interval-row">
                                <label for="screenshot-min-interval-radial">Min (sec):</label>
                                <input type="number" id="screenshot-min-interval-radial" min="5" max="3600" value="30">
                            </div>
                            <div class="interval-row">
                                <label for="screenshot-max-interval-radial">Max (sec):</label>
                                <input type="number" id="screenshot-max-interval-radial" min="5" max="3600" value="120">
                            </div>
                        </div>
                        <div class="prompt-section">
                            <label for="screenshot-prompt-input-radial">Screenshot Prompt:</label>
                            <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="screenshot-prompt-input-radial" rows="2" placeholder="Analyze this screenshot from my screen"></textarea>
                        </div>
                    </section>
                    <section>
                        <h4>Midjourney Integration</h4>
                        <div class="config-row simple-row">
                            <label for="midjourney-enabled-radial">Enable:</label>
                            <input type="checkbox" id="midjourney-enabled-radial" checked>
                        </div>
                        <div class="interval-container">
                            <div class="interval-row">
                                <label for="midjourney-min-interval-radial">Min (sec):</label>
                                <input type="number" id="midjourney-min-interval-radial" min="60" max="7200" value="600">
                            </div>
                            <div class="interval-row">
                                <label for="midjourney-max-interval-radial">Max (sec):</label>
                                <input type="number" id="midjourney-max-interval-radial" min="60" max="7200" value="1800">
                            </div>
                        </div>
                        <div class="prompt-section">
                            <label for="midjourney-prompt-radial">Prompt:</label>
                            <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="midjourney-prompt-radial" rows="2" placeholder="Describe the image you want to generate"></textarea>
                        </div>
                    </section>
                    <section>
                        <h4>Autonomous Notes</h4>
                        <div class="config-row simple-row">
                            <label for="notes-enabled-radial">Enable:</label>
                            <input type="checkbox" id="notes-enabled-radial">
                        </div>
                        <div class="interval-container">
                            <div class="interval-row">
                                <label for="notes-min-interval-radial">Min (sec):</label>
                                <input type="number" id="notes-min-interval-radial" min="60" max="7200" value="600">
                            </div>
                            <div class="interval-row">
                                <label for="notes-max-interval-radial">Max (sec):</label>
                                <input type="number" id="notes-max-interval-radial" min="60" max="7200" value="1800">
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        `;
    }
    
    // Remote View (mobile camera observation) content
    function getRemoteViewContent() {
        return `
            <div class="remote-view-card">
                <div style="text-align:center; margin-bottom:12px;">
                    <span style="font-size:28px; opacity:0.7;">ꕥ</span>
                    <div class="config-help" style="margin-top:4px;">Mobile camera vision — the agent sees through your phone's camera</div>
                </div>
                <section>
                    <h4>Camera Observation</h4>
                    <div class="config-row simple-row">
                        <label for="camera-enabled-radial">Enable:</label>
                        <input type="checkbox" id="camera-enabled-radial" checked>
                    </div>
                    <div class="config-help" style="margin-bottom:8px;">When enabled, the agent passively observes through the mobile camera when vision (ꕥ) is toggled on in the WebUI.</div>
                </section>
                <section>
                    <h4>Timing</h4>
                    <div class="interval-container">
                        <div class="interval-row">
                            <label for="camera-min-interval-radial">Min (sec):</label>
                            <input type="number" id="camera-min-interval-radial" min="5" max="600" value="30">
                        </div>
                        <div class="interval-row">
                            <label for="camera-max-interval-radial">Max (sec):</label>
                            <input type="number" id="camera-max-interval-radial" min="10" max="600" value="120">
                        </div>
                    </div>
                    <div class="config-help">How often the agent takes a snapshot. The WebUI picks a random interval between min and max.</div>
                </section>
                <section>
                    <h4>Silent Observation: <span id="camera-silent-chance-value" style="color:#4fc3f7;">50%</span></h4>
                    <input type="range" id="camera-silent-chance-radial" min="0" max="100" step="5" value="50" style="width:100%; accent-color:#4fc3f7;">
                    <div class="config-help">Chance the agent silently absorbs what it sees (builds context) vs responding naturally. 0% = always respond, 100% = always silent.</div>
                </section>
                <section>
                    <h4>Scrapbook</h4>
                    <div class="config-row simple-row">
                        <label for="camera-scrapbook-radial">Save snapshots to disk:</label>
                        <input type="checkbox" id="camera-scrapbook-radial">
                    </div>
                    <div class="config-help">When enabled, every camera snapshot is saved to <code>visual_memory/images/</code> as a JPEG — building a visual diary over time.</div>
                </section>
                <section>
                    <h4>Vision Prompt</h4>
                    <div class="prompt-section">
                        <label for="camera-prompt-radial">Observation prompt:</label>
                        <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="camera-prompt-radial" rows="3" placeholder="How the agent should respond to what it sees"></textarea>
                    </div>
                </section>
                <section>
                    <h4>First Look Prompt</h4>
                    <div class="prompt-section">
                        <label for="camera-first-look-prompt-radial">When vision first connects:</label>
                        <textarea style="width:100%; overflow-wrap:break-word; word-break:break-all;" id="camera-first-look-prompt-radial" rows="3" placeholder="How the agent reacts when it first opens its eyes"></textarea>
                    </div>
                    <div class="config-help">Used only for the very first snapshot after toggling vision on. The agent reacts naturally, like opening its eyes.</div>
                </section>
            </div>
        `;
    }

    // Voice settings content - removed as requested
    function getVoiceContent() {
        return ``;
    }
    
    // API settings content
    function getAPIContent() {
        return `
            <div class="config-section">
                <h3>API Settings</h3>
                <div class="config-row">
                    <label for="model-input-radial">Model Name:</label>
                    <input type="text" id="model-input-radial" placeholder="llama3.2-vision:11b">
                </div>
                <div class="config-row">
                    <label for="api-endpoint-input-radial">API Endpoint:</label>
                    <input type="text" id="api-endpoint-input-radial" placeholder="http://localhost:11434/api/generate">
                </div>
                <div class="config-row">
                    <label for="xai-api-key-input-radial">Grok API Key:</label>
                    <input type="password" id="xai-api-key-input-radial" placeholder="Enter xAI API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-row">
                    <label for="openai-api-key-input-radial">OpenAI API Key:</label>
                    <input type="password" id="openai-api-key-input-radial" placeholder="Enter OpenAI API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-help">Stored locally and sent only to the selected provider. Leave blank to remove the key.</div>
                <div class="config-row">
                    <label for="anthropic-api-key-input-radial">Claude API Key:</label>
                    <input type="password" id="anthropic-api-key-input-radial" placeholder="Enter Anthropic API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-row">
                    <label for="google-api-key-input-radial">Google API Key:</label>
                    <input type="password" id="google-api-key-input-radial" placeholder="Enter Google/Gemini API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-row">
                    <label for="minimax-api-key-input-radial">MiniMax API Key:</label>
                    <input type="password" id="minimax-api-key-input-radial" placeholder="Enter MiniMax API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-row">
                    <label for="perplexity-api-key-input-radial">Perplexity API Key:</label>
                    <input type="password" id="perplexity-api-key-input-radial" placeholder="Enter Perplexity API key" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-help">Keys are masked in the UI after saving. Remove the value to clear it.</div>
                <div class="config-help">Advanced settings for the AI model and API endpoint.</div>
            </div>
            
            <h4>Temperature</h4>
            <div class="config-row">
                <label for="temperature-input-radial">Temperature:</label>
                <input type="range" id="temperature-input-radial" min="0" max="1" step="0.1" value="0.7">
                <span id="temperature-value-radial">0.7</span>
            </div>
            <div class="config-help">Controls randomness: lower values are more deterministic, higher values more creative.</div>
            
            <h4>Voice Settings</h4>
            <div class="config-row simple-row">
                <label for="use-elevenlabs-tts-radial">Use ElevenLabs for all TTS:</label>
                <input type="checkbox" id="use-elevenlabs-tts-radial">
            </div>
            <div class="config-help">Enable ElevenLabs voice for all text-to-speech responses. Falls back to Kokoro if unavailable.</div>
            <div class="config-row">
                <label for="elevenlabs-api-key-radial">ElevenLabs API Key:</label>
                <input type="password" id="elevenlabs-api-key-radial" placeholder="Enter ElevenLabs API key" autocomplete="off" spellcheck="false">
            </div>
            <div class="config-row">
                <label for="elevenlabs-voice-id-radial">ElevenLabs Voice ID:</label>
                <input type="text" id="elevenlabs-voice-id-radial" placeholder="Enter Voice ID" autocomplete="off" spellcheck="false">
            </div>
            <div class="config-row">
                <label for="elevenlabs-agent-id-radial">ElevenLabs Agent ID:</label>
                <input type="text" id="elevenlabs-agent-id-radial" placeholder="Enter Agent ID" autocomplete="off" spellcheck="false">
            </div>
            <div class="config-help">ElevenLabs credentials for voice synthesis and conversational mode. Keys stored locally.</div>
        `;
    }
    
    // MCP Connections content
    function getMCPContent() {
        return `
            <div class="config-section">
                <h3>MCP Server Connections</h3>
                <p class="config-help" style="margin-top:0">Connect external tool servers via the <a href="https://modelcontextprotocol.io" target="_blank">Model Context Protocol</a>. The agent discovers and uses these tools automatically.</p>
                
                <h4>Notion</h4>
                <div class="config-row">
                    <label for="notion-api-key-radial">Integration Token:</label>
                    <input type="password" id="notion-api-key-radial" placeholder="Enter Notion token (ntn_...)" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-help">Create an integration at <a href="https://www.notion.so/my-integrations" target="_blank">notion.so/my-integrations</a>, then share pages with it via \u201c...\u201d \u2192 \u201cConnections\u201d. Auto-saves on change.</div>
                <div id="notion-save-status-radial" class="config-help" style="color:#4CAF50;display:none">Saved \u2713</div>
                
                <h4 style="margin-top:16px">Server Status</h4>
                <div id="mcp-server-status-radial" class="config-help" style="font-family:monospace;font-size:12px;white-space:pre-line">No MCP servers configured.</div>
                <div class="config-help" style="margin-top:8px">Add more servers by editing <code>config/mcp_servers.json</code>. Changes take effect on restart.</div>
            </div>
        `;
    }
    
    // Network & WebUI content
    function getNetworkContent() {
        return `
            <div class="config-section">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                    <div id="network-status-dot" style="width:10px;height:10px;border-radius:50%;background:#555;flex-shrink:0;"></div>
                    <span id="network-status-text" style="font-size:12px;color:rgba(255,255,255,0.5);">Checking...</span>
                </div>
                
                <h4 style="font-size:12px; margin-bottom:6px;">WebUI URL</h4>
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <input type="text" id="webui-url-display" readonly style="flex:1; background:rgba(0,0,0,0.4); color:rgba(255,255,255,0.85); border:1px solid rgba(79,195,247,0.25); border-radius:5px; padding:8px 10px; font-size:13px; font-family:monospace; outline:none; cursor:text;">
                    <button id="webui-url-copy" style="background:rgba(79,195,247,0.15); border:1px solid rgba(79,195,247,0.3); border-radius:5px; color:rgba(79,195,247,0.9); padding:7px 10px; cursor:pointer; font-size:12px; white-space:nowrap;" title="Copy URL">Copy</button>
                </div>
                <div class="config-help">Open this URL on any device on the same network to access the WebUI.</div>
                
                <div style="margin-top:6px; display:flex; align-items:center; gap:6px;">
                    <span id="https-status-badge" style="font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.4);">HTTPS: checking...</span>
                </div>
                
                <h4 style="font-size:12px; margin-top:14px; margin-bottom:6px;">QR Code</h4>
                <div style="display:flex; justify-content:center; padding:10px; background:rgba(255,255,255,0.95); border-radius:8px; width:fit-content; margin:0 auto;">
                    <canvas id="webui-qr-canvas" width="150" height="150" style="image-rendering:pixelated;"></canvas>
                </div>
                <div class="config-help" style="text-align:center; margin-top:4px;">Scan with your phone to open the WebUI.</div>
            </div>
        `;
    }
    
    // Command Dictionary content
    function getCommandsContent() {
        return `
            <div class="commands-card" style="font-size:12px;">
                <span id="cmd-settings-status" style="font-size:10px; color:#666; float:right;"></span>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-size:11px; color:rgba(79,195,247,0.7); text-transform:uppercase; letter-spacing:1px;">Command Dictionary</span>
                    <button id="commands-reload-btn" class="config-button-small" title="Reload">\u21BB</button>
                </div>
                <div class="config-help" style="margin-bottom:8px;">Click a category to expand. Click a trigger word for options.</div>
                <div id="commands-list" style="padding-right:4px;">
                    <div style="color:#888; padding:12px; text-align:center;">Loading commands...</div>
                </div>
                <div id="commands-apps-section" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(79,195,247,0.15); display:none;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <span style="font-size:11px; color:rgba(79,195,247,0.7); text-transform:uppercase; letter-spacing:1px;">Known Apps</span>
                        <span id="commands-app-count" style="font-size:10px; color:#666;">0</span>
                    </div>
                    <input type="text" id="commands-app-filter" placeholder="Filter apps..." style="width:100%; box-sizing:border-box; padding:4px 8px; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid rgba(79,195,247,0.2); border-radius:4px; color:#e6f2ff; outline:none; margin-bottom:6px;">
                    <div id="commands-app-list" style="font-size:11px; color:#aaa; line-height:1.6;"></div>
                </div>
                <div id="commands-suggestions-section" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(245,158,11,0.2); display:none;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                        <span style="font-size:11px; color:#f59e0b; text-transform:uppercase; letter-spacing:1px;">Agent Suggestions</span>
                        <span id="commands-suggestion-count" style="font-size:10px; background:rgba(245,158,11,0.2); color:#f59e0b; padding:1px 6px; border-radius:8px;">0</span>
                    </div>
                    <div id="commands-suggestion-list"></div>
                </div>
            </div>
        `;
    }

    async function loadCommandsData() {
        const listEl = document.getElementById('commands-list');
        const appsSection = document.getElementById('commands-apps-section');
        const appListEl = document.getElementById('commands-app-list');
        const appCountEl = document.getElementById('commands-app-count');
        const appFilterEl = document.getElementById('commands-app-filter');
        const sugSection = document.getElementById('commands-suggestions-section');
        const sugListEl = document.getElementById('commands-suggestion-list');
        const sugCountEl = document.getElementById('commands-suggestion-count');
        if (!listEl) return;

        try {
            const [cmdRes, sugRes, cfgRes] = await Promise.all([
                fetch('http://localhost:8765/api/commands'),
                fetch('http://localhost:8765/api/commands/suggestions'),
                fetch('http://localhost:8765/api/commands/config')
            ]);
            const cmdData = await cmdRes.json();
            const sugData = await sugRes.json();
            const cfgData = await cfgRes.json();

            if (cmdData.status !== 'success') throw new Error(cmdData.message || 'Failed');
            if (cfgData.status === 'success') _cmdConfig = cfgData.config;

            const commands = cmdData.commands || {};
            const disabledTriggers = _cmdConfig.disabled_triggers || [];
            const disabledCats = _cmdConfig.disabled_categories || [];
            const aliases = _cmdConfig.custom_aliases || {};
            const categoryColors = {
                app: '#4fc3f7', web: '#81c784', search: '#ffb74d',
                note: '#ce93d8', clock: '#90caf9', system: '#ef5350',
                midjourney: '#f48fb1', retry: '#a5d6a7', macro: '#80cbc4'
            };

            // Helper: build a trigger chip with × on hover to remove
            const triggerChip = (word, catId, color) => {
                const aliasTo = aliases[word.toLowerCase()];
                const aliasHint = aliasTo ? ' \u2192 ' + aliasTo : '';
                return '<span class="cmd-chip-wrap" style="display:inline-flex; align-items:center; position:relative; margin:1px;">'
                    + '<span class="cmd-trigger-chip" data-word="' + word + '" data-cat="' + catId + '" title="Click for options" style="cursor:pointer; display:inline-block; padding:2px 7px; border-radius:10px; font-size:10px; background:rgba(255,255,255,0.08); color:' + color + '; border:1px solid rgba(255,255,255,0.1); transition:all 120ms; user-select:none;">' + word + '<span style="color:#555; font-size:9px;">' + aliasHint + '</span></span>'
                    + '<span class="cmd-chip-x" data-word="' + word + '" title="Remove" style="position:absolute; right:-2px; top:-4px; width:12px; height:12px; border-radius:50%; background:rgba(239,83,80,0.8); color:#fff; font-size:8px; line-height:12px; text-align:center; cursor:pointer; opacity:0; transition:opacity 100ms; pointer-events:none;">\u00d7</span>'
                    + '</span>';
            };

            let html = '';
            for (const [catId, cat] of Object.entries(commands)) {
                const color = categoryColors[catId] || '#888';
                const catDisabled = disabledCats.includes(catId);

                const triggers = (cat.triggers || []).filter(t => !disabledTriggers.includes(t.toLowerCase())).map(t =>
                    triggerChip(t, catId, color)
                ).join('');

                const examples = (cat.examples || []).map(e => '<div style="color:#888; font-size:10px; padding-left:8px;">\u2022 ' + e + '</div>').join('');

                let specialHtml = '';
                if (cat.special) {
                    for (const [sId, s] of Object.entries(cat.special)) {
                        const sTriggers = (s.triggers || []).filter(t => !disabledTriggers.includes(t.toLowerCase())).map(t =>
                            triggerChip(t, catId, color)
                        ).join('');
                        specialHtml += '<div style="margin-top:6px; padding-left:8px;"><span style="color:' + color + '; font-size:10px; font-weight:600;">' + sId + '</span> <span style="color:#666; font-size:10px;">' + (s.description || '') + '</span><div style="margin-top:3px;">' + sTriggers + '</div></div>';
                    }
                }
                if (cat.sources) {
                    for (const [sId, s] of Object.entries(cat.sources)) {
                        const sTriggers = (s.triggers || []).filter(t => !disabledTriggers.includes(t.toLowerCase())).map(t =>
                            triggerChip(t, catId, color)
                        ).join('');
                        const sExamples = (s.examples || []).slice(0, 1).map(e => '<span style="color:#666; font-size:10px;"> \u2014 ' + e + '</span>').join('');
                        specialHtml += '<div style="margin-top:6px; padding-left:8px;"><span style="color:' + color + '; font-size:10px; font-weight:600;">' + sId + '</span>' + sExamples + '<div style="margin-top:3px;">' + sTriggers + '</div></div>';
                    }
                }

                let sysAppsHtml = '';
                if (cat.system_apps && cat.system_apps.length) {
                    sysAppsHtml = '<div style="margin-top:6px; padding-left:8px; font-size:10px; color:#666;">System: ' + cat.system_apps.sort().join(', ') + '</div>';
                }

                const headerOpacity = catDisabled ? '0.45' : '1';
                const dotColor = catDisabled ? '#555' : color;
                const catLabel = catDisabled ? '<s>' + catId + '</s>' : catId;

                html += '<div class="cmd-category" style="margin-bottom:6px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; overflow:hidden; opacity:' + headerOpacity + '; transition:opacity 200ms;">';
                html += '<div class="cmd-cat-header" data-cat="' + catId + '" style="display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; transition:background 120ms;" onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'transparent\'">';
                html += '<span class="cmd-cat-dot" style="width:8px; height:8px; border-radius:50%; background:' + dotColor + '; flex-shrink:0;"></span>';
                html += '<span style="font-weight:600; flex:1;">' + catLabel + '</span>';
                html += '<span style="font-size:10px; color:#666;">' + (cat.description || '') + '</span>';
                html += '<span class="cmd-cat-toggle" data-cat="' + catId + '" title="' + (catDisabled ? 'Enable category' : 'Disable category') + '" style="font-size:9px; padding:1px 6px; border-radius:8px; background:' + (catDisabled ? 'rgba(239,83,80,0.15)' : 'rgba(129,199,132,0.15)') + '; color:' + (catDisabled ? '#ef5350' : '#81c784') + '; cursor:pointer; user-select:none;">' + (catDisabled ? 'OFF' : 'ON') + '</span>';
                html += '<span class="cmd-cat-arrow" style="font-size:10px; color:#555; transition:transform 200ms;">\u25B6</span>';
                html += '</div>';
                html += '<div class="cmd-cat-body" style="display:none; padding:6px 10px 10px; border-top:1px solid rgba(255,255,255,0.04);">';
                html += '<div style="margin-bottom:4px;"><span style="font-size:10px; color:rgba(79,195,247,0.6); text-transform:uppercase; letter-spacing:0.5px;">Triggers</span></div>';
                // Triggers row with + icon at end
                html += '<div style="margin-bottom:6px; line-height:2; display:flex; flex-wrap:wrap; align-items:center; gap:0;">' + triggers;
                html += '<span class="cmd-add-icon" data-cat="' + catId + '" title="Add trigger" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; background:rgba(79,195,247,0.1); color:rgba(79,195,247,0.6); font-size:12px; margin-left:4px; transition:background 120ms; user-select:none;" onmouseenter="this.style.background=\'rgba(79,195,247,0.25)\'" onmouseleave="this.style.background=\'rgba(79,195,247,0.1)\'">+</span>';
                html += '</div>';
                // Hidden add-trigger input (revealed by + icon)
                html += '<div class="cmd-add-row" data-cat="' + catId + '" style="display:none; margin-bottom:8px;">';
                html += '<div style="display:flex; gap:4px;">';
                html += '<input type="text" class="cmd-add-trigger-input" data-cat="' + catId + '" placeholder="new trigger word\u2026" style="flex:1; padding:3px 6px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(79,195,247,0.2); border-radius:4px; color:#e6f2ff; outline:none;">';
                html += '<button class="cmd-add-trigger-btn config-button-small" data-cat="' + catId + '" style="font-size:9px; padding:2px 8px;">Add</button>';
                html += '<button class="cmd-add-cancel config-button-small" data-cat="' + catId + '" style="font-size:9px; padding:2px 6px; color:#888;">Cancel</button>';
                html += '</div></div>';
                // Detail panel (revealed when a trigger word is clicked)
                html += '<div class="cmd-detail-panel" data-cat="' + catId + '" style="display:none; margin-bottom:8px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(79,195,247,0.15); border-radius:6px;">';
                html += '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">';
                html += '<span class="cmd-detail-word" style="font-weight:600; color:' + color + '; font-size:11px;"></span>';
                html += '<span class="cmd-detail-close" style="cursor:pointer; color:#555; font-size:12px;" title="Close">\u2715</span>';
                html += '</div>';
                html += '<label style="display:flex; align-items:center; gap:6px; margin-bottom:6px; cursor:pointer; font-size:10px;">';
                html += '<input type="checkbox" class="cmd-detail-fs" style="accent-color:#4fc3f7;">';
                html += '<span>First sentence only</span>';
                html += '<span style="color:#555; font-size:9px;">\u2014 only trigger from first sentence</span>';
                html += '</label>';
                html += '<div style="display:flex; align-items:center; gap:4px; margin-bottom:6px;">';
                html += '<span style="font-size:10px; color:#888;">Alias:</span>';
                html += '<input type="text" class="cmd-detail-alias" placeholder="maps to\u2026" style="width:80px; padding:2px 5px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(79,195,247,0.15); border-radius:3px; color:#e6f2ff; outline:none;">';
                html += '<button class="cmd-detail-alias-save config-button-small" style="font-size:9px; padding:2px 6px;">Set</button>';
                html += '<button class="cmd-detail-alias-clear config-button-small" style="font-size:9px; padding:2px 6px; color:#888;">Clear</button>';
                html += '</div>';
                html += '<div style="display:flex; gap:6px;">';
                html += '<button class="cmd-detail-toggle config-button-small" style="font-size:9px; padding:2px 8px;"></button>';
                html += '</div>';
                html += '</div>';
                if (examples) {
                    html += '<div style="margin-bottom:4px;"><span style="font-size:10px; color:rgba(79,195,247,0.6); text-transform:uppercase; letter-spacing:0.5px;">Examples</span></div>';
                    html += examples;
                }
                html += specialHtml;
                html += sysAppsHtml;
                html += '</div></div>';
            }
            listEl.innerHTML = html;

            // ── Wire up interactions ──

            // Hover to show/hide × on chips
            listEl.querySelectorAll('.cmd-chip-wrap').forEach(wrap => {
                const xBtn = wrap.querySelector('.cmd-chip-x');
                if (!xBtn) return;
                wrap.addEventListener('mouseenter', () => { xBtn.style.opacity = '1'; xBtn.style.pointerEvents = 'auto'; });
                wrap.addEventListener('mouseleave', () => { xBtn.style.opacity = '0'; xBtn.style.pointerEvents = 'none'; });
            });

            // × button: remove trigger (add to disabled list — word disappears from UI)
            listEl.querySelectorAll('.cmd-chip-x').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const word = btn.dataset.word.toLowerCase();
                    if (!(_cmdConfig.disabled_triggers || []).includes(word)) {
                        _cmdConfig.disabled_triggers = [...(_cmdConfig.disabled_triggers || []), word];
                    }
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // Click trigger word: open detail panel
            listEl.querySelectorAll('.cmd-trigger-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const cat = chip.dataset.cat;
                    const word = chip.dataset.word;
                    const panel = listEl.querySelector('.cmd-detail-panel[data-cat="' + cat + '"]');
                    if (!panel) return;
                    // Close any other open detail panels
                    listEl.querySelectorAll('.cmd-detail-panel').forEach(p => { if (p !== panel) p.style.display = 'none'; });
                    const isOpen = panel.style.display !== 'none' && panel.dataset.word === word;
                    if (isOpen) { panel.style.display = 'none'; return; }
                    panel.dataset.word = word;
                    panel.style.display = 'block';
                    // Populate detail panel
                    const wordEl = panel.querySelector('.cmd-detail-word');
                    if (wordEl) wordEl.textContent = word;
                    const fsCheck = panel.querySelector('.cmd-detail-fs');
                    if (fsCheck) fsCheck.checked = _cmdConfig.first_sentence_only !== false;
                    const aliasInput = panel.querySelector('.cmd-detail-alias');
                    if (aliasInput) aliasInput.value = (_cmdConfig.custom_aliases || {})[word.toLowerCase()] || '';
                    const toggleBtn = panel.querySelector('.cmd-detail-toggle');
                    if (toggleBtn) {
                        toggleBtn.textContent = 'Remove this trigger';
                        toggleBtn.style.color = '#ef5350';
                    }
                });
            });

            // Detail panel: close button
            listEl.querySelectorAll('.cmd-detail-close').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.closest('.cmd-detail-panel').style.display = 'none';
                });
            });

            // Detail panel: first-sentence toggle
            listEl.querySelectorAll('.cmd-detail-fs').forEach(cb => {
                cb.addEventListener('change', async () => {
                    _cmdConfig.first_sentence_only = cb.checked;
                    await saveCommandsConfig();
                    // Sync all other open detail panels
                    listEl.querySelectorAll('.cmd-detail-fs').forEach(other => { other.checked = cb.checked; });
                });
            });

            // Detail panel: alias set
            listEl.querySelectorAll('.cmd-detail-alias-save').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const panel = btn.closest('.cmd-detail-panel');
                    const word = (panel.dataset.word || '').toLowerCase();
                    const val = panel.querySelector('.cmd-detail-alias').value.trim().toLowerCase();
                    if (!word) return;
                    if (!_cmdConfig.custom_aliases) _cmdConfig.custom_aliases = {};
                    if (val) { _cmdConfig.custom_aliases[word] = val; } else { delete _cmdConfig.custom_aliases[word]; }
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // Detail panel: alias clear
            listEl.querySelectorAll('.cmd-detail-alias-clear').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const panel = btn.closest('.cmd-detail-panel');
                    const word = (panel.dataset.word || '').toLowerCase();
                    if (!word) return;
                    if (_cmdConfig.custom_aliases) delete _cmdConfig.custom_aliases[word];
                    panel.querySelector('.cmd-detail-alias').value = '';
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // Detail panel: remove trigger
            listEl.querySelectorAll('.cmd-detail-toggle').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const panel = btn.closest('.cmd-detail-panel');
                    const word = (panel.dataset.word || '').toLowerCase();
                    if (!word) return;
                    if (!(_cmdConfig.disabled_triggers || []).includes(word)) {
                        _cmdConfig.disabled_triggers = [...(_cmdConfig.disabled_triggers || []), word];
                    }
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // Accordion toggles
            listEl.querySelectorAll('.cmd-cat-header').forEach(header => {
                header.addEventListener('click', (e) => {
                    if (e.target.classList.contains('cmd-cat-toggle')) return;
                    const body = header.nextElementSibling;
                    const arrow = header.querySelector('.cmd-cat-arrow');
                    const isOpen = body.style.display !== 'none';
                    body.style.display = isOpen ? 'none' : 'block';
                    if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
                });
            });

            // Category ON/OFF toggles
            listEl.querySelectorAll('.cmd-cat-toggle').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cat = btn.dataset.cat;
                    let disabled = _cmdConfig.disabled_categories || [];
                    if (disabled.includes(cat)) {
                        _cmdConfig.disabled_categories = disabled.filter(x => x !== cat);
                    } else {
                        _cmdConfig.disabled_categories = [...disabled, cat];
                    }
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // + icon: reveal add-trigger input
            listEl.querySelectorAll('.cmd-add-icon').forEach(icon => {
                icon.addEventListener('click', () => {
                    const row = listEl.querySelector('.cmd-add-row[data-cat="' + icon.dataset.cat + '"]');
                    if (row) { row.style.display = 'block'; row.querySelector('input').focus(); }
                });
            });

            // Add trigger: submit
            listEl.querySelectorAll('.cmd-add-trigger-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const input = listEl.querySelector('.cmd-add-trigger-input[data-cat="' + btn.dataset.cat + '"]');
                    const val = (input && input.value || '').trim().toLowerCase();
                    if (!val) return;
                    if (!_cmdConfig.custom_triggers) _cmdConfig.custom_triggers = {};
                    if (!_cmdConfig.custom_triggers[btn.dataset.cat]) _cmdConfig.custom_triggers[btn.dataset.cat] = [];
                    if (!_cmdConfig.custom_triggers[btn.dataset.cat].includes(val)) {
                        _cmdConfig.custom_triggers[btn.dataset.cat].push(val);
                    }
                    _cmdConfig.disabled_triggers = (_cmdConfig.disabled_triggers || []).filter(x => x !== val);
                    await saveCommandsConfig();
                    loadCommandsData();
                });
            });

            // Add trigger: cancel
            listEl.querySelectorAll('.cmd-add-cancel').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('.cmd-add-row');
                    if (row) { row.style.display = 'none'; row.querySelector('input').value = ''; }
                });
            });

            // Add trigger: enter key
            listEl.querySelectorAll('.cmd-add-trigger-input').forEach(input => {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); listEl.querySelector('.cmd-add-trigger-btn[data-cat="' + input.dataset.cat + '"]').click(); }
                    if (e.key === 'Escape') { const row = input.closest('.cmd-add-row'); if (row) { row.style.display = 'none'; input.value = ''; } }
                });
            });

            // Render known apps
            const knownApps = cmdData.known_apps || [];
            if (knownApps.length && appsSection && appListEl) {
                appsSection.style.display = 'block';
                if (appCountEl) appCountEl.textContent = knownApps.length;

                const renderApps = (filter) => {
                    const filtered = filter ? knownApps.filter(a => a.toLowerCase().includes(filter.toLowerCase())) : knownApps;
                    appListEl.innerHTML = filtered.map(a => '<span style="display:inline-block; background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:3px; margin:2px; font-size:10px;">' + a + '</span>').join(' ');
                };
                renderApps('');
                if (appFilterEl) {
                    appFilterEl.addEventListener('input', () => renderApps(appFilterEl.value));
                }
            }

            // Render suggestions
            const suggestions = (sugData.status === 'success' ? sugData.suggestions : []) || [];
            if (suggestions.length && sugSection && sugListEl) {
                sugSection.style.display = 'block';
                if (sugCountEl) sugCountEl.textContent = suggestions.length;

                sugListEl.innerHTML = suggestions.map(s => {
                    return '<div style="display:flex; align-items:flex-start; gap:8px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04);">'
                        + '<div style="flex:1;">'
                        + '<div style="font-weight:600; font-size:11px;">' + (s.trigger || '') + '</div>'
                        + '<div style="font-size:10px; color:#888;">' + (s.category || '') + ' \u2014 ' + (s.reason || '') + '</div>'
                        + '</div>'
                        + '<button class="cmd-sug-dismiss config-button-small" data-id="' + s.id + '" title="Dismiss" style="font-size:10px; padding:2px 6px; color:#ef5350;">\u2715</button>'
                        + '</div>';
                }).join('');

                sugListEl.querySelectorAll('.cmd-sug-dismiss').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        try {
                            await fetch('http://localhost:8765/api/commands/suggestions/' + id, { method: 'DELETE' });
                            btn.closest('div[style]').remove();
                            const remaining = sugListEl.children.length;
                            if (sugCountEl) sugCountEl.textContent = remaining;
                            if (remaining === 0) sugSection.style.display = 'none';
                        } catch (e) { console.error('Failed to dismiss suggestion:', e); }
                    });
                });
            }
        } catch (err) {
            console.error('Failed to load commands:', err);
            listEl.innerHTML = '<div style="color:#ef5350; padding:12px; text-align:center;">Failed to load commands</div>';
        }
    }

    // ── Command Parser Config UI ──────────────────────────────────
    let _cmdConfig = { disabled_triggers: [], disabled_categories: [], custom_aliases: {}, first_sentence_only: true };

    async function loadCommandsConfig() {
        // Config is now loaded inside loadCommandsData; this just triggers a refresh
        await loadCommandsData();
    }

    async function saveCommandsConfig() {
        const statusEl = document.getElementById('cmd-settings-status');
        try {
            const res = await fetch('http://localhost:8765/api/commands/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(_cmdConfig)
            });
            const data = await res.json();
            if (data.status === 'success') {
                _cmdConfig = data.config;
                if (statusEl) { statusEl.textContent = 'Saved'; statusEl.style.color = '#81c784'; setTimeout(() => { statusEl.textContent = ''; }, 1200); }
            }
        } catch (e) {
            console.error('Failed to save cmd config:', e);
            if (statusEl) { statusEl.textContent = 'Error'; statusEl.style.color = '#ef5350'; setTimeout(() => { statusEl.textContent = ''; }, 2000); }
        }
    }

    // (Aliases and first-sentence toggle are now managed per-word in the detail panel)

    // Sync data between original panel and radial panel
    function syncPanelData() {
        // Create a mapping between original and radial panel elements
        const elementMappings = [
            { original: 'model-input', radial: 'model-input-radial' },
            { original: 'api-endpoint-input', radial: 'api-endpoint-input-radial' },
            { original: 'system-prompt-input', radial: 'system-prompt-input-radial' },
            { original: 'note-enabled', radial: 'notes-enabled-radial' },
            { original: 'notes-min-interval', radial: 'notes-min-interval-radial' },
            { original: 'notes-max-interval', radial: 'notes-max-interval-radial' },
            { original: 'screenshot-enabled', radial: 'screenshot-enabled-radial' },
            { original: 'screenshot-min-interval', radial: 'screenshot-min-interval-radial' },
            { original: 'screenshot-max-interval', radial: 'screenshot-max-interval-radial' },
            { original: 'messages-enabled', radial: 'messages-enabled-radial' },
            { original: 'messages-min-interval', radial: 'messages-min-interval-radial' },
            { original: 'messages-max-interval', radial: 'messages-max-interval-radial' },
            { original: 'messages-prompt', radial: 'messages-prompt-radial' },
            // Voice settings mappings
            { original: 'voice-enabled', radial: 'voice-enabled-radial' },
            { original: 'voice-preset', radial: 'voice-preset-radial' },
            { original: 'speaking-rate', radial: 'speaking-rate-radial', valueDisplay: 'speaking-rate-value-radial' },
            { original: 'voice-pitch', radial: 'voice-pitch-radial', valueDisplay: 'voice-pitch-value-radial' },
            { original: 'voice-temperature', radial: 'voice-temperature-radial', valueDisplay: 'voice-temperature-value-radial' },
            { original: 'voice-top-p', radial: 'voice-top-p-radial', valueDisplay: 'voice-top-p-value-radial' },
            { original: 'enhance-speech', radial: 'enhance-speech-radial' },
            { original: 'use-elevenlabs-tts', radial: 'use-elevenlabs-tts-radial' },
            { original: 'suggestions-enabled', radial: 'suggestions-enabled-radial' },
            { original: 'notes-enabled', radial: 'notes-enabled-radial' },
            { original: 'suggestions-min-interval', radial: 'suggestions-min-interval-radial' },
            { original: 'suggestions-max-interval', radial: 'suggestions-max-interval-radial' },
            { original: 'midjourney-enabled', radial: 'midjourney-enabled-radial' },
            { original: 'midjourney-min-interval', radial: 'midjourney-min-interval-radial' },
            { original: 'midjourney-max-interval', radial: 'midjourney-max-interval-radial' },
            { original: 'midjourney-prompt', radial: 'midjourney-prompt-radial' },
            { original: 'midjourney-system-prompt', radial: 'midjourney-system-prompt-radial' },
            { original: 'xai-api-key-input', radial: 'xai-api-key-input-radial' },
            { original: 'openai-api-key-input', radial: 'openai-api-key-input-radial' },
            { original: 'anthropic-api-key-input', radial: 'anthropic-api-key-input-radial' },
            { original: 'google-api-key-input', radial: 'google-api-key-input-radial' },
            { original: 'perplexity-api-key-input', radial: 'perplexity-api-key-input-radial' },
            { original: 'elevenlabs-api-key-input', radial: 'elevenlabs-api-key-radial' },
            { original: 'elevenlabs-voice-id-input', radial: 'elevenlabs-voice-id-radial' },
            { original: 'elevenlabs-agent-id-input', radial: 'elevenlabs-agent-id-radial' },
            { original: 'temperature-input', radial: 'temperature-input-radial' }
        ];
        
        // Copy values from original to radial
        elementMappings.forEach(mapping => {
            const originalElement = document.getElementById(mapping.original);
            const radialElement = document.getElementById(mapping.radial);
            
            if (originalElement && radialElement) {
                if (originalElement.type === 'checkbox') {
                    radialElement.checked = originalElement.checked;
                } else {
                    radialElement.value = originalElement.value;
                }
            }
        });

        // Special case: screenshot prompt is stored as #screenshot-prompt in the base config,
        // but the radial uses #screenshot-prompt-input-radial inside Autonomy.
        const baseShotPrompt = document.getElementById('screenshot-prompt');
        const radialShotPrompt = document.getElementById('screenshot-prompt-input-radial');
        // Prefer last-saved value from localStorage, then live config, then base panel textarea
        let shotText = '';
        try {
            const stored = localStorage.getItem('screenshot_prompt');
            if (stored && stored.length > 0) {
                shotText = stored;
            } else if (window.currentConfig && typeof window.currentConfig.screenshot_prompt === 'string') {
                shotText = window.currentConfig.screenshot_prompt;
            } else if (baseShotPrompt) {
                shotText = baseShotPrompt.value || '';
            }
        } catch(_) {}
        if (radialShotPrompt && shotText !== '') {
            radialShotPrompt.value = shotText;
        }
        
        // Load vault_path from config (no original panel element to sync from)
        const vaultPathInput = document.getElementById('vault-path-radial');
        if (vaultPathInput) {
            let vaultVal = '';
            try {
                if (window.currentConfig && typeof window.currentConfig.vault_path === 'string') {
                    vaultVal = window.currentConfig.vault_path;
                } else {
                    const storedVault = localStorage.getItem('vault_path');
                    if (storedVault && storedVault.length > 0) {
                        vaultVal = storedVault;
                    }
                }
            } catch(_) {}
            if (vaultVal) {
                vaultPathInput.value = vaultVal;
            }
        }
        
        // Load vision_fallback_model from config
        const visionFallbackHidden = document.getElementById('vision-fallback-select');
        const visionFallbackLabel = document.getElementById('vision-fallback-label');
        if (visionFallbackHidden) {
            let vfVal = 'gemini-2.5-flash';
            try {
                if (window.currentConfig && typeof window.currentConfig.vision_fallback_model === 'string') {
                    vfVal = window.currentConfig.vision_fallback_model;
                } else {
                    const storedVf = localStorage.getItem('vision_fallback_model');
                    if (storedVf) vfVal = storedVf;
                }
            } catch(_) {}
            visionFallbackHidden.value = vfVal;
            const matchOpt = document.querySelector('#vision-fallback-options .model-option[data-value="' + vfVal + '"]');
            if (matchOpt && visionFallbackLabel) visionFallbackLabel.textContent = matchOpt.textContent;
        }
        
        // Load circuits_model from config
        const circuitsModelHidden = document.getElementById('circuits-model-select');
        const circuitsModelLabel = document.getElementById('circuits-model-label');
        if (circuitsModelHidden) {
            let cmVal = '';
            try {
                if (window.currentConfig && typeof window.currentConfig.circuits_model === 'string') {
                    cmVal = window.currentConfig.circuits_model;
                } else {
                    const storedCm = localStorage.getItem('circuits_model');
                    if (storedCm) cmVal = storedCm;
                }
            } catch(_) {}
            circuitsModelHidden.value = cmVal;
            const cmMatchOpt = document.querySelector('#circuits-model-options .model-option[data-value="' + cmVal + '"]');
            if (cmMatchOpt && circuitsModelLabel) circuitsModelLabel.textContent = cmMatchOpt.textContent;
        }
        
        // Handle avatar separately
        const originalAvatar = document.getElementById('avatar-preview');
        const radialAvatar = document.getElementById('avatar-preview-radial');
        
        // First check localStorage for saved avatar
        const savedAvatar = localStorage.getItem('agent-avatar');
        const validSavedAvatar = savedAvatar ? savedAvatar : null;
        
        if (validSavedAvatar) {
            // If we have a saved avatar in localStorage, use that
            if (originalAvatar) originalAvatar.src = validSavedAvatar;
            if (radialAvatar) radialAvatar.src = validSavedAvatar;
        } else if (originalAvatar && radialAvatar) {
            // Otherwise use the original avatar if available
            radialAvatar.src = originalAvatar.src;
            
            // And save it to localStorage for future use
            if (originalAvatar.src && !originalAvatar.src.includes('default-avatar.png')) {
                localStorage.setItem('agent-avatar', originalAvatar.src);
            }
        }
        
        // Update the model selection in the radial panel
        const modelInput = document.getElementById('model-input');
        const selectedModelName = document.getElementById('selected-model-name');
        
        if (modelInput && selectedModelName) {
            // Update the selected model name in the radial panel
            selectedModelName.textContent = modelInput.value || 'Select a model';
        }
        
        // Populate the model options in the radial panel
        populateModelOptions();
        console.log("Initializing vertical radial wheel...");
        const container = document.getElementById('vertical-wheel-container');
        const cards = document.querySelectorAll('.vertical-section-card');
        const dots = document.querySelectorAll('.vertical-indicator-dot');
        let verticalSectionCount = cards.length;
        let currentVerticalIndex = 0;
        
        if (!container || !cards.length) {
            console.error("Vertical wheel elements not found");
            return;
        }
        
        // Position cards in 3D space
        positionVerticalCards();
        
        // Set the first section as active
        updateVerticalActiveSection(0);
        
        // Add event listeners to dots
        dots.forEach((dot, index) => {
            dot.addEventListener('click', function() {
                currentVerticalIndex = index;
                updateVerticalActiveSection(currentVerticalIndex);
            });
        });
        
        // Add wheel scrolling behavior
        const autonomySection = document.getElementById('section-autonomy');
        if (autonomySection) {
            autonomySection.addEventListener('wheel', function(e) {
                // Get the active card and its content
                const activeCard = document.querySelector('.vertical-section-card.active');
                const activeContent = activeCard ? activeCard.querySelector('.content') : null;
                
                if (activeContent) {
                    // Check if we're hovering over the content area
                    const contentRect = activeContent.getBoundingClientRect();
                    const isOverContent = (
                        e.clientX >= contentRect.left &&
                        e.clientX <= contentRect.right &&
                        e.clientY >= contentRect.top &&
                        e.clientY <= contentRect.bottom
                    );
                    
                    // If hovering over content, allow natural scrolling
                    if (isOverContent) {
                        // Check if we've reached the top or bottom of the content
                        const atTop = activeContent.scrollTop <= 0;
                        const atBottom = activeContent.scrollHeight - activeContent.scrollTop <= activeContent.clientHeight + 1;
                        
                        // Only prevent default and change cards if we're at the limits
                        if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
                            e.preventDefault();
                            if (e.deltaY > 0) {
                                // Scroll down to next card
                                currentVerticalIndex = (currentVerticalIndex + 1) % verticalSectionCount;
                            } else {
                                // Scroll up to previous card
                                currentVerticalIndex = (currentVerticalIndex - 1 + verticalSectionCount) % verticalSectionCount;
                            }
                            updateVerticalActiveSection(currentVerticalIndex);
                        }
                        // Otherwise, let the natural scroll happen
                        return;
                    }
                }
                
                // If not over content or no active content, rotate the wheel
                e.preventDefault();
                if (e.deltaY > 0) {
                    // Scroll down
                    currentVerticalIndex = (currentVerticalIndex + 1) % verticalSectionCount;
                } else {
                    // Scroll up
                    currentVerticalIndex = (currentVerticalIndex - 1 + verticalSectionCount) % verticalSectionCount;
                }
                updateVerticalActiveSection(currentVerticalIndex);
            }, { passive: false });
        }
        
        // Position cards in 3D space
        function positionVerticalCards() {
            const angleIncrement = 90; // Degrees between cards
            
            cards.forEach((card, index) => {
                const angle = index * angleIncrement;
                card.style.transform = 'rotateX(' + angle + 'deg) translateZ(120px)';
            });
        }
        
        // Update the active section
        function updateVerticalActiveSection(index) {
            // Normalize index
            currentVerticalIndex = (index + verticalSectionCount) % verticalSectionCount;
            
            // Rotate wheel to show active section
            const angle = -currentVerticalIndex * 90; // 90 degrees per card
            container.style.transform = 'rotateX(' + angle + 'deg)';
            
            // Update active classes
            cards.forEach((card, i) => {
                if (i === currentVerticalIndex) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            });
            
            // Update indicator dots
            dots.forEach((dot, i) => {
                if (i === currentVerticalIndex) {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
            
            console.log(`Vertical active section updated to: ${currentVerticalIndex}`);
        }
        
        console.log("Vertical radial wheel initialized");
    }
    
    // Set up auto-save for radial panel inputs
    function setupRadialAutoSave() {
        // Create a mapping between radial and original panel elements
        const elementMappings = [
            { radial: 'model-input-radial', original: 'model-input' },
            { radial: 'api-endpoint-input-radial', original: 'api-endpoint-input' },
            { radial: 'system-prompt-input-radial', original: 'system-prompt-input' },
            { radial: 'screenshot-prompt-input-radial', original: 'screenshot-prompt-input' },
            { radial: 'general-note-prompt-input-radial', original: 'general-note-prompt-input' },
            { radial: 'autonomous-note-prompt-input-radial', original: 'autonomous-note-prompt-input' },
            { radial: 'note-creation-enabled-radial', original: 'note-enabled' },
            { radial: 'notes-min-interval-radial', original: 'notes-min-interval' },
            { radial: 'notes-max-interval-radial', original: 'notes-max-interval' },
            { radial: 'screenshot-enabled-radial', original: 'screenshot-enabled' },
            { radial: 'screenshot-min-interval-radial', original: 'screenshot-min-interval' },
            { radial: 'screenshot-max-interval-radial', original: 'screenshot-max-interval' },
            { radial: 'messages-enabled-radial', original: 'messages-enabled' },
            { radial: 'messages-min-interval-radial', original: 'messages-min-interval' },
            { radial: 'messages-max-interval-radial', original: 'messages-max-interval' },
            { radial: 'messages-prompt-radial', original: 'messages-prompt' },
            { radial: 'suggestions-enabled-radial', original: 'suggestions-enabled' },
            { radial: 'notes-enabled-radial', original: 'notes-enabled' },
            { radial: 'suggestions-min-interval-radial', original: 'suggestions-min-interval' },
            { radial: 'suggestions-max-interval-radial', original: 'suggestions-max-interval' },
            { radial: 'midjourney-enabled-radial', original: 'midjourney-enabled' },
            { radial: 'midjourney-min-interval-radial', original: 'midjourney-min-interval' },
            { radial: 'midjourney-max-interval-radial', original: 'midjourney-max-interval' },
            { radial: 'midjourney-prompt-radial', original: 'midjourney-prompt' },
            { radial: 'midjourney-system-prompt-radial', original: 'midjourney-system-prompt' },
            { radial: 'xai-api-key-input-radial', original: 'xai-api-key-input' },
            { radial: 'openai-api-key-input-radial', original: 'openai-api-key-input' },
            { radial: 'anthropic-api-key-input-radial', original: 'anthropic-api-key-input' },
            { radial: 'google-api-key-input-radial', original: 'google-api-key-input' },
            { radial: 'minimax-api-key-input-radial', original: 'minimax-api-key-input' },
            { radial: 'perplexity-api-key-input-radial', original: 'perplexity-api-key-input' },
            { radial: 'temperature-input-radial', original: 'temperature-input' },
            // Voice settings mappings
            { radial: 'voice-enabled-radial', original: 'voice-enabled' },
            { radial: 'voice-preset-radial', original: 'voice-preset' },
            { radial: 'speaking-rate-radial', original: 'speaking-rate', valueDisplay: 'speaking-rate-value-radial' },
            { radial: 'voice-pitch-radial', original: 'voice-pitch', valueDisplay: 'voice-pitch-value-radial' },
            { radial: 'voice-temperature-radial', original: 'voice-temperature', valueDisplay: 'voice-temperature-value-radial' },
            { radial: 'voice-top-p-radial', original: 'voice-top-p', valueDisplay: 'voice-top-p-value-radial' },
            { radial: 'enhance-speech-radial', original: 'enhance-speech' },
            { radial: 'use-elevenlabs-tts-radial', original: 'use-elevenlabs-tts' },
            { radial: 'elevenlabs-api-key-radial', original: 'elevenlabs-api-key-input' },
            { radial: 'elevenlabs-voice-id-radial', original: 'elevenlabs-voice-id-input' },
            { radial: 'elevenlabs-agent-id-radial', original: 'elevenlabs-agent-id-input' }
        ];
        
        // Auto-save vault path on input with debounce
        let _vaultSaveTimer = null;
        const _autoSaveVaultPath = () => {
            if (_vaultSaveTimer) clearTimeout(_vaultSaveTimer);
            _vaultSaveTimer = setTimeout(() => {
                const vaultPath = (document.getElementById('vault-path-radial') || {}).value || '';
                const status = document.getElementById('vault-path-status');
                console.log('[VAULT AUTO-SAVE] Saving vault_path:', vaultPath);
                window.api.send('config', { action: 'save', config: { vault_path: vaultPath } });
                try { localStorage.setItem('vault_path', vaultPath); } catch(_) {}
                if (status) {
                    status.textContent = vaultPath ? 'Saved \u2713' : 'Using default location';
                    status.style.color = vaultPath ? '#4ade80' : '#888';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            }, 1000);
        };
        const vaultPathEl = document.getElementById('vault-path-radial');
        if (vaultPathEl) {
            vaultPathEl.addEventListener('input', _autoSaveVaultPath);
            vaultPathEl.addEventListener('change', _autoSaveVaultPath);
        }
        
        // Vision fallback custom dropdown — toggle, select, save
        const vfWrapper = document.getElementById('vision-fallback-wrapper');
        const vfOptions = document.getElementById('vision-fallback-options');
        const vfLabel = document.getElementById('vision-fallback-label');
        const vfHidden = document.getElementById('vision-fallback-select');
        if (vfWrapper && vfOptions && vfLabel && vfHidden) {
            vfWrapper.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = vfOptions.style.display === 'block';
                vfOptions.style.display = isOpen ? 'none' : 'block';
            });
            vfOptions.querySelectorAll('.model-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = opt.getAttribute('data-value');
                    vfLabel.textContent = opt.textContent;
                    vfHidden.value = val;
                    vfOptions.style.display = 'none';
                    console.log('[VISION FALLBACK] Saving vision_fallback_model:', val);
                    window.api.send('config', { action: 'save', config: { vision_fallback_model: val } });
                    try { localStorage.setItem('vision_fallback_model', val); } catch(_) {}
                });
            });
            document.addEventListener('click', () => { vfOptions.style.display = 'none'; });
        }
        
        // Circuits model custom dropdown — dynamically populated from model catalog
        const cmWrapper = document.getElementById('circuits-model-wrapper');
        const cmOptions = document.getElementById('circuits-model-options');
        const cmLabel = document.getElementById('circuits-model-label');
        const cmHidden = document.getElementById('circuits-model-select');
        if (cmWrapper && cmOptions && cmLabel && cmHidden) {
            const buildCircuitsOptions = async () => {
                cmOptions.innerHTML = '';
                // Fetch models if cache is empty
                let models = cachedModelCatalog.length ? cachedModelCatalog : [];
                if (!models.length) {
                    try {
                        const [staticRes, discoverRes] = await Promise.allSettled([
                            fetch('http://localhost:8765/api/models').then(r => r.json()),
                            fetch('http://localhost:8765/api/discover-models').then(r => r.json())
                        ]);
                        if (staticRes.status === 'fulfilled' && staticRes.value?.status === 'success') {
                            models = (staticRes.value.models || []).map(normalizeModelEntry);
                        }
                        if (!models.length) models = MODEL_FALLBACKS.map(normalizeModelEntry);
                        const knownNames = new Set(models.map(m => m.name));
                        if (discoverRes.status === 'fulfilled' && discoverRes.value?.providers) {
                            for (const [prov, provModels] of Object.entries(discoverRes.value.providers)) {
                                for (const dm of provModels) {
                                    const mid = dm.id || '';
                                    if (!mid || knownNames.has(mid)) continue;
                                    models.push(normalizeModelEntry({ name: mid, provider: prov, display_name: dm.display_name || mid, key_active: true, discovered: true }));
                                    knownNames.add(mid);
                                }
                            }
                        }
                        populateModelCache(models);
                    } catch(e) { console.error('[CIRCUITS] Error fetching models:', e); }
                }
                // "Use Default Model" option first
                const defaultOpt = document.createElement('div');
                defaultOpt.className = 'model-option';
                defaultOpt.setAttribute('data-value', '');
                defaultOpt.textContent = 'Use Default Model';
                defaultOpt.style.cssText = 'padding:6px 8px; cursor:pointer; border-radius:4px; font-style:italic; opacity:0.8;';
                defaultOpt.addEventListener('click', (e) => { e.stopPropagation(); _selectCircuitsModel('', 'Use Default Model'); });
                cmOptions.appendChild(defaultOpt);
                // Add all models
                for (const m of models) {
                    const label = m.display_name || m.name;
                    const isCloud = m.provider && m.provider !== 'ollama';
                    const opt = document.createElement('div');
                    opt.className = 'model-option';
                    opt.setAttribute('data-value', m.name);
                    opt.innerHTML = '<span>' + label + (isCloud ? ' \u2601\uFE0F' : '') + '</span><span class="model-size" style="opacity:0.5;margin-left:auto;font-size:11px;">' + (isCloud ? m.provider : (m.size || '')) + '</span>';
                    opt.style.cssText = 'padding:6px 8px; cursor:pointer; border-radius:4px; display:flex; justify-content:space-between; align-items:center;';
                    opt.addEventListener('click', (e) => { e.stopPropagation(); _selectCircuitsModel(m.name, label); });
                    cmOptions.appendChild(opt);
                }
                cmOptions.style.display = 'block';
                cmOptions.style.maxHeight = '300px';
                cmOptions.style.overflowY = 'auto';
                cmOptions.style.background = 'rgba(0, 0, 0, 0.35)';
                cmOptions.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                cmOptions.style.borderRadius = '6px';
                cmOptions.style.padding = '4px';
            };
            const _selectCircuitsModel = (val, label) => {
                cmLabel.textContent = label;
                cmHidden.value = val;
                cmOptions.style.display = 'none';
                console.log('[CIRCUITS MODEL] Saving circuits_model:', val);
                window.api.send('config', { action: 'save', config: { circuits_model: val } });
                try { localStorage.setItem('circuits_model', val); } catch(_) {}
            };
            cmWrapper.addEventListener('click', (e) => {
                e.stopPropagation();
                if (cmOptions.style.display === 'block') { cmOptions.style.display = 'none'; }
                else { buildCircuitsOptions(); }
            });
            document.addEventListener('click', () => { cmOptions.style.display = 'none'; });
        }
        
        // Auto-save ElevenLabs credentials on input with debounce
        let _elSaveTimer = null;
        const _autoSaveElevenLabsCreds = () => {
            if (_elSaveTimer) clearTimeout(_elSaveTimer);
            _elSaveTimer = setTimeout(() => {
                const apiKey = (document.getElementById('elevenlabs-api-key-radial') || {}).value || '';
                const voiceId = (document.getElementById('elevenlabs-voice-id-radial') || {}).value || '';
                const agentId = (document.getElementById('elevenlabs-agent-id-radial') || {}).value || '';
                console.log('%c[11LABS AUTO-SAVE] Saving credentials...', 'color:#0f0;font-size:12px', 'key len:', apiKey.length, 'voice:', voiceId, 'agent:', agentId);
                window.api.send('config', { action: 'save', config: {
                    remote_api_keys: {
                        elevenlabs_api_key: apiKey,
                        elevenlabs_voice_id: voiceId,
                        elevenlabs_agent_id: agentId
                    }
                }});
            }, 1000);
        };
        ['elevenlabs-api-key-radial', 'elevenlabs-voice-id-radial', 'elevenlabs-agent-id-radial'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', _autoSaveElevenLabsCreds);
                el.addEventListener('change', _autoSaveElevenLabsCreds);
            }
        });
        
        // Auto-save OpenAI API key on input with debounce
        let _oaiSaveTimer = null;
        const _autoSaveOpenAIKey = () => {
            if (_oaiSaveTimer) clearTimeout(_oaiSaveTimer);
            _oaiSaveTimer = setTimeout(() => {
                const apiKey = (document.getElementById('openai-api-key-input-radial') || {}).value || '';
                if (apiKey.length > 0) {
                    console.log('[OpenAI AUTO-SAVE] Saving key, length:', apiKey.length);
                    window.api.send('config', { action: 'save', config: { remote_api_keys: { openai_api_key: apiKey } } });
                }
            }, 1500);
        };
        const oaiKeyEl = document.getElementById('openai-api-key-input-radial');
        if (oaiKeyEl) {
            oaiKeyEl.addEventListener('input', _autoSaveOpenAIKey);
            oaiKeyEl.addEventListener('change', _autoSaveOpenAIKey);
        }
        
        // Auto-save MiniMax API key on input with debounce
        let _mmSaveTimer = null;
        const _autoSaveMinimaxKey = () => {
            if (_mmSaveTimer) clearTimeout(_mmSaveTimer);
            _mmSaveTimer = setTimeout(() => {
                const apiKey = (document.getElementById('minimax-api-key-input-radial') || {}).value || '';
                if (apiKey.length > 0) {
                    console.log('[MiniMax AUTO-SAVE] Saving key, length:', apiKey.length);
                    window.api.send('config', { action: 'save', config: { remote_api_keys: { minimax_api_key: apiKey } } });
                }
            }, 1500);
        };
        const mmKeyEl = document.getElementById('minimax-api-key-input-radial');
        if (mmKeyEl) {
            mmKeyEl.addEventListener('input', _autoSaveMinimaxKey);
            mmKeyEl.addEventListener('change', _autoSaveMinimaxKey);
        }
        
        // Auto-save Perplexity API key on input with debounce
        let _pplxSaveTimer = null;
        const _autoSavePerplexityKey = () => {
            if (_pplxSaveTimer) clearTimeout(_pplxSaveTimer);
            _pplxSaveTimer = setTimeout(() => {
                const apiKey = (document.getElementById('perplexity-api-key-input-radial') || {}).value || '';
                if (apiKey.length > 0) {
                    console.log('[Perplexity AUTO-SAVE] Saving key, length:', apiKey.length);
                    window.api.send('config', { action: 'save', config: { perplexity_api_key: apiKey } });
                }
            }, 1500);
        };
        const pplxKeyEl = document.getElementById('perplexity-api-key-input-radial');
        if (pplxKeyEl) {
            pplxKeyEl.addEventListener('input', _autoSavePerplexityKey);
            pplxKeyEl.addEventListener('change', _autoSavePerplexityKey);
        }
        
        // Set up event listeners for each element
        elementMappings.forEach(mapping => {
            const radialElement = document.getElementById(mapping.radial);
            
            if (radialElement) {
                // For sliders with value display
                if (mapping.valueDisplay) {
                    const valueDisplay = document.getElementById(mapping.valueDisplay);
                    if (valueDisplay) {
                        // Update display value on load
                        valueDisplay.textContent = radialElement.value;
                        
                        // Add input event listener to update display value
                        radialElement.addEventListener('input', function() {
                            valueDisplay.textContent = radialElement.value;
                            
                            const originalElement = document.getElementById(mapping.original);
                            if (originalElement) {
                                originalElement.value = radialElement.value;
                                
                                // Trigger change event on original element to activate auto-save
                                const event = new Event('change', { bubbles: true });
                                originalElement.dispatchEvent(event);
                            }
                        });
                    }
                }
                // For text inputs and textareas
                else if (radialElement.type !== 'checkbox') {
                    radialElement.addEventListener('input', function() {
                        const originalElement = document.getElementById(mapping.original);
                        if (originalElement) {
                            originalElement.value = radialElement.value;
                            
                            // Trigger change event on original element to activate auto-save
                            const event = new Event('change', { bubbles: true });
                            originalElement.dispatchEvent(event);
                        }
                    });
                } 
                // For checkboxes
                else {
                    radialElement.addEventListener('change', function() {
                        const originalElement = document.getElementById(mapping.original);
                        if (originalElement) {
                            console.log(`Checkbox ${mapping.radial} changed to: ${radialElement.checked}`);
                            console.log(`Setting ${mapping.original} to: ${radialElement.checked}`);
                            originalElement.checked = radialElement.checked;
                            
                            // Explicitly log the boolean value for debugging
                            console.log(`Boolean value being sent: ${Boolean(radialElement.checked)}`);
                            
                            // Trigger change event on original element to activate auto-save
                            const event = new Event('change', { bubbles: true });
                            originalElement.dispatchEvent(event);
                            
                            // Verify the event was dispatched with the correct value
                            console.log(`After dispatch: ${mapping.original} is now ${originalElement.checked}`);
                            
                            // Force an immediate config save to ensure the change is captured
                            if (window.saveConfig) {
                                console.log(`Forcing immediate config save for toggle change: ${mapping.original}`);
                                window.saveConfig();
                            }
                        }
                    });
                }
            }
        });
        
        // Handle avatar upload separately
        const radialAvatarInput = document.getElementById('avatar-input-radial');
        if (radialAvatarInput) {
            radialAvatarInput.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        // Update radial avatar preview
                        const radialAvatar = document.getElementById('avatar-preview-radial');
                        if (radialAvatar) {
                            radialAvatar.src = e.target.result;
                        }
                        
                        // Update original avatar preview
                        const originalAvatar = document.getElementById('avatar-preview');
                        if (originalAvatar) {
                            originalAvatar.src = e.target.result;
                            
                            // Save the avatar to configuration
                            saveAvatarToConfig(e.target.result);
                            
                            // Trigger change event to save
                            const event = new Event('change', { bubbles: true });
                            originalAvatar.dispatchEvent(event);
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
        
        // Handle temperature slider
        const temperatureSlider = document.getElementById('temperature-input-radial');
        const temperatureValue = document.getElementById('temperature-value-radial');
        
        if (temperatureSlider && temperatureValue) {
            temperatureSlider.addEventListener('input', function() {
                temperatureValue.textContent = temperatureSlider.value;
            });
        }
        
        // Load saved avatar from localStorage if available
        const savedAvatar = localStorage.getItem('agent-avatar');
        if (savedAvatar) {
            const radialAvatar = document.getElementById('avatar-preview-radial');
            const originalAvatar = document.getElementById('avatar-preview');
            
            if (radialAvatar) radialAvatar.src = savedAvatar;
            if (originalAvatar) originalAvatar.src = savedAvatar;
        }
    }
    
    // Function to save avatar to configuration
    function saveAvatarToConfig(avatarDataUrl) {
        // Store in localStorage for persistence across sessions
        localStorage.setItem('agent-avatar', avatarDataUrl);
        
        // If we have a way to save to the backend configuration, do it here
        // For now, we'll just use localStorage
        console.log('Avatar saved to local storage');
        
        // Dispatch a custom event to notify that the avatar has been updated
        document.dispatchEvent(new CustomEvent('avatar-updated', { 
            detail: { avatarDataUrl: avatarDataUrl }
        }));
    }
    
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        console.log("Radial Config Panel: DOM ready");
        
        // Replace the config button click handler
        const configButton = document.getElementById('config-button');
        if (configButton) {
            // Remove existing click handlers
            const newConfigButton = configButton.cloneNode(true);
            configButton.parentNode.replaceChild(newConfigButton, configButton);
            
            // Add new click handler
            newConfigButton.addEventListener('click', function() {
                // Create radial panel if it doesn't exist
                if (!radialPanel) {
                    createRadialPanel();
                }
                
                // Sync data from original panel
                syncPanelData();
                
                // Set up auto-save for radial panel
                setupRadialAutoSave();
                
                // Set up voice settings save button
                const saveVoiceSettingsButton = document.getElementById('save-voice-settings-radial');
                if (saveVoiceSettingsButton) {
                    saveVoiceSettingsButton.addEventListener('click', function() {
                        // Get all voice settings from radial panel
                        const voiceEnabled = document.getElementById('voice-enabled-radial').checked;
                        const voicePreset = document.getElementById('voice-preset-radial').value;
                        const speakingRate = parseFloat(document.getElementById('speaking-rate-radial').value);
                        const voicePitch = parseFloat(document.getElementById('voice-pitch-radial').value);
                        const voiceTemperature = parseFloat(document.getElementById('voice-temperature-radial').value);
                        const voiceTopP = parseFloat(document.getElementById('voice-top-p-radial').value);
                        const enhanceSpeech = document.getElementById('enhance-speech-radial').checked;
                        const useElevenLabsTTS = document.getElementById('use-elevenlabs-tts-radial').checked;
                        
                        // Get ElevenLabs credentials from radial panel
                        const elKeyEl = document.getElementById('elevenlabs-api-key-radial');
                        const elVoiceEl = document.getElementById('elevenlabs-voice-id-radial');
                        const elAgentEl = document.getElementById('elevenlabs-agent-id-radial');
                        const elevenlabsApiKey = elKeyEl ? elKeyEl.value : '';
                        const elevenlabsVoiceId = elVoiceEl ? elVoiceEl.value : '';
                        const elevenlabsAgentId = elAgentEl ? elAgentEl.value : '';
                        
                        console.log('%c[11LABS SAVE] Key el:', 'color:#ff0;font-size:14px', !!elKeyEl, 'len:', elevenlabsApiKey.length);
                        console.log('%c[11LABS SAVE] Voice el:', 'color:#ff0;font-size:14px', !!elVoiceEl, 'val:', elevenlabsVoiceId);
                        console.log('%c[11LABS SAVE] Agent el:', 'color:#ff0;font-size:14px', !!elAgentEl, 'val:', elevenlabsAgentId);
                        
                        // Create config payload with voice settings AND credentials
                        const configPayload = {
                            voice_settings: {
                                enabled: voiceEnabled,
                                preset: voicePreset,
                                speaking_rate: speakingRate,
                                pitch: voicePitch,
                                temperature: voiceTemperature,
                                top_p: voiceTopP,
                                enhance_speech: enhanceSpeech,
                                use_elevenlabs_tts: useElevenLabsTTS
                            },
                            remote_api_keys: {
                                elevenlabs_api_key: elevenlabsApiKey,
                                elevenlabs_voice_id: elevenlabsVoiceId,
                                elevenlabs_agent_id: elevenlabsAgentId
                            }
                        };
                        
                        console.log('%c[11LABS SAVE] Payload:', 'color:#0f0;font-size:14px', JSON.stringify(configPayload.remote_api_keys));
                        
                        // Send via config save channel (handles remote_api_keys properly)
                        window.api.send('config', { action: 'save', config: configPayload });
                        // Also send via save-config as fallback
                        window.api.send('save-config', configPayload);
                        console.log('%c[11LABS SAVE] Sent via config + save-config channels', 'color:#0f0;font-size:14px');
                        
                        // Update original panel elements if they exist
                        const syncVal = (id, val) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
                        syncVal('voice-enabled', voiceEnabled);
                        syncVal('voice-preset', voicePreset);
                        syncVal('speaking-rate', speakingRate);
                        syncVal('voice-pitch', voicePitch);
                        syncVal('voice-temperature', voiceTemperature);
                        syncVal('voice-top-p', voiceTopP);
                        syncVal('enhance-speech', enhanceSpeech);
                        syncVal('use-elevenlabs-tts', useElevenLabsTTS);
                        syncVal('elevenlabs-api-key-input', elevenlabsApiKey);
                        syncVal('elevenlabs-voice-id-input', elevenlabsVoiceId);
                        syncVal('elevenlabs-agent-id-input', elevenlabsAgentId);
                        
                        // Show a confirmation message
                        const btn = document.getElementById('save-voice-settings-radial');
                        if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save Voice Settings'; }, 2000); }
                    });
                }
                
                // Auto-save Notion MCP key on input (debounced)
                let _notionSaveTimer = null;
                const _autoSaveNotionKey = () => {
                    if (_notionSaveTimer) clearTimeout(_notionSaveTimer);
                    _notionSaveTimer = setTimeout(() => {
                        const notionInput = document.getElementById('notion-api-key-radial');
                        if (!notionInput) return;
                        const notionKey = notionInput.value.trim();
                        if (notionKey.length === 0) return;
                        console.log('[MCP] Auto-saving Notion key, length:', notionKey.length);
                        window.api.send('config', { action: 'save', config: { remote_api_keys: { notion_api_key: notionKey } } });
                        // Show saved indicator
                        const status = document.getElementById('notion-save-status-radial');
                        if (status) { status.style.display = 'block'; setTimeout(() => { status.style.display = 'none'; }, 2000); }
                    }, 1500);
                };
                const notionKeyEl = document.getElementById('notion-api-key-radial');
                if (notionKeyEl) {
                    notionKeyEl.addEventListener('input', _autoSaveNotionKey);
                    notionKeyEl.addEventListener('change', _autoSaveNotionKey);
                }
                
                // Load key statuses into cards
                if (window.currentConfig && window.currentConfig.remote_api_keys) {
                    const keys = window.currentConfig.remote_api_keys;
                    const maskIfSet = (id, keyName) => {
                        const el = document.getElementById(id);
                        if (el && keys[keyName] && keys[keyName].length > 0) {
                            el.placeholder = '••••••••••••••••••••';
                            el.dataset.hasKey = 'true';
                        }
                    };
                    maskIfSet('notion-api-key-radial', 'notion_api_key');
                    maskIfSet('minimax-api-key-input-radial', 'minimax_api_key');
                    maskIfSet('openai-api-key-input-radial', 'openai_api_key');
                }
                
                // Show the radial panel
                showRadialPanel();
            });
        }
    });
    
    // Auto-save voice settings when main panel checkbox changes
    function setupElevenLabsToggleListener() {
        const useElevenLabsCheckbox = document.getElementById('use-elevenlabs-tts');
        console.log('[ElevenLabs Toggle] Looking for checkbox:', useElevenLabsCheckbox);
        if (useElevenLabsCheckbox) {
            useElevenLabsCheckbox.addEventListener('change', function() {
                console.log('[ElevenLabs Toggle] Checkbox changed to:', this.checked);
                // Gather all voice settings from main panel
                const voiceSettings = {
                    enabled: document.getElementById('voice-enabled')?.checked || false,
                    preset: document.getElementById('voice-preset')?.value || 'af_heart',
                    speaking_rate: parseFloat(document.getElementById('speaking-rate')?.value || 1.0),
                    pitch: parseFloat(document.getElementById('voice-pitch')?.value || 0.0),
                    temperature: parseFloat(document.getElementById('voice-temperature')?.value || 0.5),
                    top_p: parseFloat(document.getElementById('voice-top-p')?.value || 0.9),
                    enhance_speech: document.getElementById('enhance-speech')?.checked || false,
                    use_elevenlabs_tts: this.checked
                };
                console.log('[ElevenLabs Toggle] Voice settings to send:', voiceSettings);
                // Send to backend
                if (window.api && window.api.send) {
                    window.api.send('update-voice-settings', {
                        voice_settings: voiceSettings
                    });
                    console.log('[ElevenLabs Toggle] Voice settings sent to backend');
                } else {
                    console.error('[ElevenLabs Toggle] window.api not available');
                }
            });
        } else {
            console.error('[ElevenLabs Toggle] Checkbox element not found');
        }
    }
    
    // Try to set up listener immediately and also on DOMContentLoaded
    setupElevenLabsToggleListener();
    document.addEventListener('DOMContentLoaded', setupElevenLabsToggleListener);
    
    // Failsafe: auto-load CIRCUITS.md, SUBSTRATE.md, and PRIME.md when their textareas appear
    // Only consider truly loaded when dataset.loaded === 'true' (set by successful fetch)
    let _circuitsLoadPending = false;
    let _substrateLoadPending = false;
    let _primeLoadPending = false;
    const _autoLoadCheck = setInterval(() => {
        const cTA = document.getElementById('circuits-input-radial');
        const cDone = cTA && cTA.dataset.loaded === 'true';
        if (cTA && !cDone && !_circuitsLoadPending) {
            console.log('[AutoLoad] Found circuits textarea, triggering load...');
            _circuitsLoadPending = true;
            loadCircuitsContent(8).finally(() => { _circuitsLoadPending = false; });
        }

        const sTA = document.getElementById('substrate-input-radial');
        const sDone = sTA && sTA.dataset.loaded === 'true';
        if (sTA && !sDone && !_substrateLoadPending) {
            console.log('[AutoLoad] Found substrate textarea, triggering load...');
            _substrateLoadPending = true;
            loadSubstrateContent(8).finally(() => { _substrateLoadPending = false; });
        }

        const pTA = document.getElementById('prime-input-radial');
        const pDone = pTA && pTA.dataset.loaded === 'true';
        if (pTA && !pDone && !_primeLoadPending) {
            console.log('[AutoLoad] Found prime textarea, triggering load...');
            _primeLoadPending = true;
            loadPrimeContent(8).finally(() => { _primeLoadPending = false; });
        }

        if (cDone && sDone && pDone) {
            console.log('[AutoLoad] All MD files loaded successfully, stopping interval.');
            clearInterval(_autoLoadCheck);
        }
    }, 3000);
})();
