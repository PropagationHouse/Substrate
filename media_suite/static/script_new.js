// ========== STATE ==========
let state = {
    currentView: 'timeline',
    currentMonth: new Date(),
    brandProfile: null,
    mediaItems: [],
    selectedItem: null,
    aiModel: 'gemini-2.5-flash',
    theme: 'forest'
};

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initModals();
    initAIPanel();
    await loadSettings();
    await loadBrandProfile();
    await loadMediaItems();
    renderCurrentView();
});

// ========== NAVIGATION ==========
function initNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            switchView(view);
        });
    });
}

function switchView(viewName) {
    state.currentView = viewName;
    
    // Update nav
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    
    // Update views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`${viewName}View`).classList.add('active');
    
    renderCurrentView();
}

// ========== RENDER VIEWS ==========
function renderCurrentView() {
    switch(state.currentView) {
        case 'timeline':
            renderTimeline();
            break;
        case 'content':
            renderContentGrid();
            break;
        case 'research':
            renderResearch();
            break;
        case 'assets':
            renderAssets();
            break;
    }
}

function renderTimeline() {
    const calendar = document.getElementById('timelineCalendar');
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();
    const today = new Date();
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = `
        <div class="calendar-header">
            <h3>${state.currentMonth.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h3>
            <div style="display: flex; gap: 1rem;">
                <button class="btn-ghost" onclick="navigateMonth(-1)">← Prev</button>
                <button class="btn-ghost" onclick="navigateMonth(1)">Next →</button>
            </div>
        </div>
        <div class="calendar-grid">
    `;
    
    // Day headers
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
        html += `<div style="text-align: center; font-weight: 600; color: var(--text-secondary); padding: 0.5rem;">${day}</div>`;
    });
    
    // Empty cells
    for (let i = 0; i < firstDay; i++) {
        html += '<div></div>';
    }
    
    // Days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];
        const isToday = date.toDateString() === today.toDateString();
        
        const dayItems = state.mediaItems.filter(item => 
            item.scheduled_date && item.scheduled_date.startsWith(dateStr)
        );
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="openDayModal('${dateStr}')">
                <div class="day-number">${day}</div>
                <div class="day-content">
                    ${dayItems.map(item => `
                        <div class="content-pill" onclick="event.stopPropagation(); openContentModal('${item.id}')">${item.title}</div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    calendar.innerHTML = html;
}

function renderContentGrid() {
    const grid = document.getElementById('contentGrid');
    
    if (state.mediaItems.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 3rem;">No content yet. Click "New Content" to get started!</p>';
        return;
    }
    
    grid.innerHTML = state.mediaItems.map(item => `
        <div class="content-card" onclick="openContentModal('${item.id}')">
            <div class="content-card-header">
                <div>
                    <div class="content-card-title">${item.title}</div>
                    <div class="content-card-meta">
                        <span class="tag">${item.status}</span>
                        <span class="tag">${item.content_type}</span>
                        ${item.scheduled_date ? `<span class="tag">📅 ${new Date(item.scheduled_date).toLocaleDateString()}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="content-card-description">${item.description || 'No description'}</div>
        </div>
    `).join('');
}

async function renderResearch() {
    const grid = document.getElementById('researchGrid');
    
    try {
        const response = await fetch('/api/news?limit=20');
        const articles = await response.json();
        
        if (articles.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 3rem;">No research articles yet. Click "Refresh" to fetch latest industry news.</p>';
            return;
        }
        
        grid.innerHTML = articles.map(article => `
            <div class="content-card">
                <div class="content-card-title">${article.title}</div>
                <div class="content-card-meta">
                    <span class="tag">${article.source}</span>
                </div>
                <div class="content-card-description">${article.summary || ''}</div>
                <button class="btn-primary" style="margin-top: 1rem;" onclick="convertArticleToContent('${article.id}')">
                    ✨ Convert to Content
                </button>
            </div>
        `).join('');
    } catch (error) {
        grid.innerHTML = '<p style="color: var(--text-secondary);">Error loading research</p>';
    }
}

function renderAssets() {
    const grid = document.getElementById('assetsGrid');
    grid.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 3rem;">Asset management coming soon...</p>';
}

// ========== DATA LOADING ==========
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        state.aiModel = settings.ai_model || 'gemini-2.5-flash';
        state.theme = settings.theme || 'forest';
        
        document.body.setAttribute('data-theme', state.theme);
        
        // Populate AI model selector
        if (settings.available_models) {
            const selector = document.getElementById('aiModelSelector');
            selector.innerHTML = Object.entries(settings.available_models).map(([id, info]) => {
                return `<option value="${id}" ${id === state.aiModel ? 'selected' : ''}>${info.name}</option>`;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function loadBrandProfile() {
    try {
        const response = await fetch('/api/brand-profiles');
        const profiles = await response.json();
        
        if (profiles.length > 0) {
            state.brandProfile = profiles[0];
            document.getElementById('brandName').value = state.brandProfile.name || '';
            document.getElementById('brandIndustry').value = state.brandProfile.industry || '';
            document.getElementById('brandKeywords').value = state.brandProfile.keywords || '';
        }
    } catch (error) {
        console.error('Error loading brand profile:', error);
    }
}

async function loadMediaItems() {
    try {
        if (!state.brandProfile) return;
        
        const response = await fetch(`/api/media-items?brand_profile_id=${state.brandProfile.id}`);
        state.mediaItems = await response.json();
    } catch (error) {
        console.error('Error loading media items:', error);
    }
}

// ========== MODALS ==========
function initModals() {
    // Close buttons
    document.getElementById('closeModalBtn').addEventListener('click', () => closeModal('contentModal'));
    document.getElementById('closeSettingsBtn').addEventListener('click', () => closeModal('settingsModal'));
    
    // Overlay clicks
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.parentElement.id);
            }
        });
    });
    
    // New content button
    document.getElementById('newContentBtn').addEventListener('click', () => openContentModal());
    
    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => openModal('settingsModal'));
    
    // Save content
    document.getElementById('saveContentBtn').addEventListener('click', saveContent);
    
    // Delete content
    document.getElementById('deleteContentBtn').addEventListener('click', deleteContent);
    
    // Auto-generate button
    document.getElementById('autoGenerateBtn').addEventListener('click', autoGeneratePlan);
    
    // Refresh research
    document.getElementById('refreshResearchBtn').addEventListener('click', refreshResearch);
    
    // AI model selector
    document.getElementById('aiModelSelector').addEventListener('change', async (e) => {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ai_model: e.target.value})
        });
        state.aiModel = e.target.value;
        showNotification('AI model updated');
    });
    
    // Theme selector
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            const theme = btn.dataset.theme;
            document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            await fetch('/api/settings', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({theme})
            });
            
            state.theme = theme;
            document.body.setAttribute('data-theme', theme);
            showNotification('Theme updated');
        });
    });
    
    // Status change updates progress
    document.getElementById('contentStatus').addEventListener('change', updateProgress);
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function openContentModal(itemId = null) {
    if (itemId) {
        const item = state.mediaItems.find(i => i.id === itemId);
        if (item) {
            state.selectedItem = item;
            document.getElementById('modalTitle').textContent = 'Edit Content';
            document.getElementById('contentTitle').value = item.title || '';
            document.getElementById('contentType').value = item.content_type || '';
            document.getElementById('contentDescription').value = item.description || '';
            document.getElementById('contentCaption').value = item.caption || '';
            document.getElementById('publishDate').value = item.scheduled_date ? item.scheduled_date.slice(0, 16) : '';
            document.getElementById('contentStatus').value = item.status || 'idea';
            updateProgress();
        }
    } else {
        state.selectedItem = null;
        document.getElementById('modalTitle').textContent = 'New Content';
        document.getElementById('contentTitle').value = '';
        document.getElementById('contentType').value = 'Instagram Reel';
        document.getElementById('contentDescription').value = '';
        document.getElementById('contentCaption').value = '';
        document.getElementById('publishDate').value = '';
        document.getElementById('contentStatus').value = 'idea';
        updateProgress();
    }
    
    openModal('contentModal');
}

function openDayModal(dateStr) {
    document.getElementById('publishDate').value = dateStr + 'T12:00';
    openContentModal();
}

function updateProgress() {
    const status = document.getElementById('contentStatus').value;
    const stages = ['idea', 'research', 'script', 'shoot', 'edit', 'ready'];
    const currentIndex = stages.indexOf(status);
    const progress = ((currentIndex + 1) / stages.length) * 100;
    
    document.getElementById('progressFill').style.width = progress + '%';
    
    document.querySelectorAll('.stage').forEach((stage, index) => {
        stage.classList.remove('active', 'completed');
        if (index < currentIndex) {
            stage.classList.add('completed');
        } else if (index === currentIndex) {
            stage.classList.add('active');
        }
    });
}

async function saveContent() {
    const data = {
        title: document.getElementById('contentTitle').value,
        content_type: document.getElementById('contentType').value,
        description: document.getElementById('contentDescription').value,
        caption: document.getElementById('contentCaption').value,
        scheduled_date: document.getElementById('publishDate').value,
        status: document.getElementById('contentStatus').value,
        channel: 'social',
        brand_profile_id: state.brandProfile?.id
    };
    
    if (!data.title) {
        showNotification('Title is required', 'error');
        return;
    }
    
    try {
        if (state.selectedItem) {
            await fetch(`/api/media-items/${state.selectedItem.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            showNotification('Content updated');
        } else {
            await fetch('/api/media-items', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            showNotification('Content created');
        }
        
        await loadMediaItems();
        renderCurrentView();
        closeModal('contentModal');
    } catch (error) {
        showNotification('Error saving content', 'error');
    }
}

async function deleteContent() {
    if (!state.selectedItem) return;
    if (!confirm('Delete this content?')) return;
    
    try {
        await fetch(`/api/media-items/${state.selectedItem.id}`, {method: 'DELETE'});
        await loadMediaItems();
        renderCurrentView();
        closeModal('contentModal');
        showNotification('Content deleted');
    } catch (error) {
        showNotification('Error deleting content', 'error');
    }
}

// ========== AI FEATURES ==========
function initAIPanel() {
    document.getElementById('aiAssistBtn').addEventListener('click', () => {
        document.getElementById('aiPanel').classList.toggle('active');
    });
    
    document.getElementById('closeAiBtn').addEventListener('click', () => {
        document.getElementById('aiPanel').classList.remove('active');
    });
    
    document.getElementById('sendAiBtn').addEventListener('click', sendAIMessage);
    document.getElementById('aiInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendAIMessage();
    });
}

async function sendAIMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    if (!message) return;
    
    addAIMessage(message, 'user');
    input.value = '';
    
    const loadingMsg = addAIMessage('Thinking...', 'assistant');
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message})
        });
        
        const data = await response.json();
        loadingMsg.remove();
        
        if (data.error) {
            addAIMessage(`Error: ${data.error}`, 'assistant');
        } else {
            addAIMessage(data.response, 'assistant');
        }
    } catch (error) {
        loadingMsg.remove();
        addAIMessage('Sorry, I encountered an error.', 'assistant');
    }
}

function addAIMessage(text, type) {
    const chat = document.getElementById('aiChat');
    const msg = document.createElement('div');
    msg.className = `ai-message ${type}`;
    msg.textContent = text;
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
    return msg;
}

async function autoGeneratePlan() {
    if (!state.brandProfile) {
        showNotification('Please set up your brand profile first', 'error');
        openModal('settingsModal');
        return;
    }
    
    const loadingMsg = showNotification('AI is generating your content plan...', 'info');
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: `Generate a 7-day content plan for ${state.brandProfile.name} in the ${state.brandProfile.industry} industry. Create 7 content ideas with titles, types (Instagram Reel, TikTok, Post, etc), descriptions, and captions. Format as JSON array with fields: title, content_type, description, caption.`
            })
        });
        
        const data = await response.json();
        
        if (data.response) {
            // Try to parse JSON from response
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const ideas = JSON.parse(jsonMatch[0]);
                
                // Create media items
                for (let i = 0; i < ideas.length; i++) {
                    const date = new Date();
                    date.setDate(date.getDate() + i);
                    
                    await fetch('/api/media-items', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            ...ideas[i],
                            status: 'idea',
                            channel: 'social',
                            scheduled_date: date.toISOString(),
                            brand_profile_id: state.brandProfile.id
                        })
                    });
                }
                
                await loadMediaItems();
                renderCurrentView();
                showNotification(`Generated ${ideas.length} content ideas!`);
            } else {
                showNotification('Could not parse AI response', 'error');
            }
        }
    } catch (error) {
        showNotification('Error generating plan', 'error');
    }
}

async function convertArticleToContent(articleId) {
    showNotification('Converting article to content ideas...', 'info');
    
    try {
        const response = await fetch('/api/research/convert', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                article_id: articleId,
                media_plan_id: state.brandProfile?.id
            })
        });
        
        const items = await response.json();
        
        if (items.error) {
            showNotification(items.error, 'error');
        } else {
            await loadMediaItems();
            renderCurrentView();
            showNotification(`Created ${items.length} content ideas!`);
        }
    } catch (error) {
        showNotification('Error converting article', 'error');
    }
}

async function refreshResearch() {
    showNotification('Fetching latest industry news...', 'info');
    
    try {
        await fetch('/api/news/fetch', {method: 'POST'});
        await renderResearch();
        showNotification('Research updated!');
    } catch (error) {
        showNotification('Error fetching news', 'error');
    }
}

// ========== UTILITIES ==========
function navigateMonth(direction) {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + direction);
    renderTimeline();
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: ${type === 'error' ? 'rgba(239, 68, 68, 0.9)' : type === 'info' ? 'rgba(59, 130, 246, 0.9)' : 'rgba(74, 222, 128, 0.9)'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        font-weight: 500;
        z-index: 10000;
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
    
    return notification;
}

// Make functions globally accessible
window.navigateMonth = navigateMonth;
window.openDayModal = openDayModal;
window.openContentModal = openContentModal;
window.convertArticleToContent = convertArticleToContent;
