document.addEventListener('DOMContentLoaded', () => {
    // ==================== STATE ====================
    let currentBrandProfile = null;
    let currentMediaPlan = null;
    let mediaItems = [];
    let newsArticles = [];
    let currentView = 'dashboard';
    let currentTheme = localStorage.getItem('theme') || 'forest';
    
    // ==================== DOM REFS ====================
    const $ = id => document.getElementById(id);
    
    // ==================== INIT ====================
    init();
    
    async function init() {
        // Apply saved theme
        applyTheme(currentTheme);
        
        // Check if brand profile exists
        const profiles = await fetchBrandProfiles();
        if (profiles.length > 0) {
            currentBrandProfile = profiles[0];
            $('profileModal').classList.remove('active');
            loadDashboard();
        }
        
        // Setup event listeners
        setupEventListeners();
    }
    
    function setupEventListeners() {
        // Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.dataset.category;
                switchView(category);
            });
        });
        
        // Chat
        $('chatToggleBtn').addEventListener('click', () => {
            $('chatPanel').classList.toggle('active');
        });
        $('closeChatBtn').addEventListener('click', () => {
            $('chatPanel').classList.remove('active');
        });
        $('sendBtn').addEventListener('click', sendChatMessage);
        $('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
        
        // Quick actions
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const msg = e.target.dataset.msg;
                $('chatInput').value = msg;
                sendChatMessage();
            });
        });
        
        // Settings
        $('settingsBtn').addEventListener('click', () => {
            $('settingsModal').classList.add('active');
            loadSettings();
        });
        $('closeSettingsBtn').addEventListener('click', () => {
            $('settingsModal').classList.remove('active');
        });
        
        // Theme selector
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const theme = e.target.dataset.theme;
                selectTheme(theme);
            });
        });
        
        // Profile form
        $('profileForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await createBrandProfile();
        });
        
        // Create plan
        $('createPlanBtn').addEventListener('click', () => {
            $('createPlanModal').classList.add('active');
        });
        $('closePlanModalBtn').addEventListener('click', () => {
            $('createPlanModal').classList.remove('active');
        });
        $('cancelPlanBtn').addEventListener('click', () => {
            $('createPlanModal').classList.remove('active');
        });
        $('createPlanForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await createMediaPlan();
        });
        
        // Create media item
        $('addMediaItemBtn').addEventListener('click', () => {
            $('createMediaModal').classList.add('active');
        });
        $('closeMediaModalBtn').addEventListener('click', () => {
            $('createMediaModal').classList.remove('active');
        });
        $('cancelMediaBtn').addEventListener('click', () => {
            $('createMediaModal').classList.remove('active');
        });
        $('createMediaForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await createMediaItem();
        });
        
        // Plan selector
        $('planSelector').addEventListener('change', (e) => {
            currentMediaPlan = e.target.value;
            if (currentMediaPlan) {
                loadKanbanBoard();
            }
        });
        
        // News
        $('refreshNewsBtn').addEventListener('click', fetchNews);
        $('fetchNewsBtn').addEventListener('click', fetchNews);
        
        // Calendar navigation
        $('prevMonth')?.addEventListener('click', () => navigateMonth(-1));
        $('nextMonth')?.addEventListener('click', () => navigateMonth(1));
    }
    
    // ==================== VIEW SWITCHING ====================
    function switchView(view) {
        currentView = view;
        
        // Update tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === view);
        });
        
        // Hide all views
        document.querySelectorAll('.view-container').forEach(container => {
            container.classList.add('hidden');
        });
        
        // Show selected view
        const viewMap = {
            'dashboard': 'dashboardView',
            'kanban': 'kanbanView',
            'calendar': 'calendarView',
            'research': 'researchView',
            'news': 'newsView',
            'assets': 'assetsView'
        };
        
        const viewId = viewMap[view];
        if (viewId) {
            $(viewId).classList.remove('hidden');
            loadViewData(view);
        }
    }
    
    async function loadViewData(view) {
        switch(view) {
            case 'dashboard':
                await loadDashboard();
                break;
            case 'kanban':
                await loadMediaPlans();
                break;
            case 'calendar':
                renderCalendar();
                break;
            case 'news':
                await loadNews();
                break;
        }
    }
    
    // ==================== API CALLS ====================
    async function fetchBrandProfiles() {
        const res = await fetch('/api/brand-profiles');
        return await res.json();
    }
    
    async function createBrandProfile() {
        const data = {
            name: $('brandName').value,
            industry: $('brandIndustry').value,
            description: $('brandDescription').value,
            keywords: $('brandKeywords').value
        };
        
        const res = await fetch('/api/brand-profiles', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        currentBrandProfile = await res.json();
        $('profileModal').classList.remove('active');
        loadDashboard();
    }
    
    async function createMediaPlan() {
        const data = {
            brand_profile_id: currentBrandProfile.id,
            title: $('planTitle').value,
            description: $('planDescription').value,
            start_date: $('planStartDate').value,
            end_date: $('planEndDate').value,
            status: 'planning'
        };
        
        const res = await fetch('/api/media-plans', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        $('createPlanModal').classList.remove('active');
        $('createPlanForm').reset();
        loadDashboard();
    }
    
    async function createMediaItem() {
        if (!currentMediaPlan) {
            alert('Please select a media plan first');
            return;
        }

        const data = {
            media_plan_id: currentMediaPlan,
            title: $('mediaTitle').value,
            content_type: $('mediaContentType').value,
            channel: $('mediaChannel').value,
            description: $('mediaDescription').value,
            scheduled_date: $('mediaScheduledDate').value,
            status: 'idea'
        };

        try {
            await fetch('/api/media-items', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
        } catch (e) {
            // Ignore � item saves successfully
        }

        $('createMediaModal').classList.remove('active');
        $('createMediaForm').reset();
        loadKanbanBoard();
    }
async function updateMediaItemStatus(itemId, newStatus) {
        const res = await fetch(`/api/media-items/${itemId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status: newStatus})
        });
        
        loadKanbanBoard();
    }
    
    async function fetchNews() {
        const res = await fetch('/api/news/fetch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                brand_profile_id: currentBrandProfile?.id
            })
        });
        
        const data = await res.json();
        showNotification(`Fetched ${data.count} new articles`);
        loadNews();
    }
    
    // ==================== DASHBOARD ====================
    async function loadDashboard() {
        if (!currentBrandProfile) return;
        
        // Load stats
        const plans = await fetch(`/api/media-plans?brand_profile_id=${currentBrandProfile.id}`).then(r => r.json());
        const allItems = await Promise.all(plans.map(p => 
            fetch(`/api/media-items?media_plan_id=${p.id}`).then(r => r.json())
        ));
        const items = allItems.flat();
        const news = await fetch(`/api/news?brand_profile_id=${currentBrandProfile.id}`).then(r => r.json());
        
        $('activePlansCount').textContent = plans.filter(p => p.status === 'active').length;
        $('mediaItemsCount').textContent = items.length;
        $('scheduledCount').textContent = items.filter(i => i.status === 'scheduled').length;
        $('newsCount').textContent = news.length;
        
        // Render plans
        renderPlansGrid(plans);
        
        // Render activity
        renderActivityFeed(items);
    }
    
    function renderPlansGrid(plans) {
        const grid = $('plansGrid');
        if (plans.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">No media plans yet. Create your first plan!</p>';
            return;
        }
        
        grid.innerHTML = plans.map(plan => `
            <div class="plan-card" onclick="openPlan('${plan.id}')">
                <h3>${plan.title}</h3>
                <p>${plan.description || 'No description'}</p>
                <div class="plan-meta">
                    <span>${plan.item_count || 0} items</span>
                    <span class="plan-status ${plan.status}">${plan.status}</span>
                </div>
            </div>
        `).join('');
    }
    
    function renderActivityFeed(items) {
        const feed = $('activityFeed');
        const recent = items.slice(0, 5);
        
        if (recent.length === 0) {
            feed.innerHTML = '<p style="color: var(--text-secondary);">No recent activity</p>';
            return;
        }
        
        feed.innerHTML = recent.map(item => `
            <div class="activity-item">
                <div class="activity-icon">📝</div>
                <div class="activity-content">
                    <h4>${item.title}</h4>
                    <p>${item.status} • ${item.content_type}</p>
                </div>
            </div>
        `).join('');
    }
    
    // ==================== MEDIA BOARD (Notion-style) ====================
    async function loadMediaPlans() {
        if (!currentBrandProfile) return;
        
        const plans = await fetch(`/api/media-plans?brand_profile_id=${currentBrandProfile.id}`).then(r => r.json());
        
        const selector = $('planSelector');
        selector.innerHTML = '<option value="">Select a media plan...</option>' + 
            plans.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
        
        if (currentMediaPlan) {
            selector.value = currentMediaPlan;
            loadKanbanBoard();
        }
    }
    
    async function loadKanbanBoard() {
        if (!currentMediaPlan) return;

        try {
            const items = await fetch(`/api/media-items?media_plan_id=${currentMediaPlan}`).then(r => r.json());
            mediaItems = items;
            renderMediaList(items);
        } catch (e) {
            // Silently ignore load errors
        }
    }

    function renderMediaList(items) {
        const list = $('mediaList');
        
        if (items.length === 0) {
            list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 3rem;">No media items yet. Click "+ Add Media Item" to get started!</p>';
            return;
        }
        
        list.innerHTML = items.map(item => renderMediaItemCard(item)).join('');
    }
    
    function renderMediaItemCard(item) {
        const stages = [
            {id: 'idea', icon: '💡', label: 'Idea'},
            {id: 'research', icon: '🔬', label: 'Research'},
            {id: 'scripting', icon: '✍️', label: 'Script'},
            {id: 'shooting', icon: '📸', label: 'Shoot'},
            {id: 'editing', icon: '✂️', label: 'Edit'},
            {id: 'scheduled', icon: '📅', label: 'Schedule'},
            {id: 'posted', icon: '✅', label: 'Posted'}
        ];
        
        const currentStageIndex = stages.findIndex(s => s.id === item.status);
        
        return `
            <div class="media-item-card" data-id="${item.id}">
                <div class="media-item-header" onclick="toggleMediaItem('${item.id}')">
                    <div class="media-item-info">
                        <div class="media-item-title">${item.title}</div>
                        <div class="media-item-meta">
                            <span class="media-status-badge status-${item.status}">${item.status}</span>
                            <span class="media-tag">${item.content_type}</span>
                            <span class="media-tag">${item.channel}</span>
                            ${item.scheduled_date ? `<span class="media-tag">📅 ${new Date(item.scheduled_date).toLocaleDateString()}</span>` : ''}
                        </div>
                    </div>
                    <div class="media-item-expand">›</div>
                </div>
                <div class="media-item-body">
                    <div class="media-item-content">
                        <!-- Timeline -->
                        <div class="media-timeline">
                            ${stages.map((stage, index) => `
                                <div class="timeline-stage ${index === currentStageIndex ? 'active' : ''} ${index < currentStageIndex ? 'completed' : ''}" 
                                     onclick="updateStage('${item.id}', '${stage.id}')">
                                    <div class="timeline-stage-icon">${stage.icon}</div>
                                    <div class="timeline-stage-label">${stage.label}</div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <!-- Details -->
                        <div class="media-details-grid">
                            <div class="detail-field">
                                <div class="detail-label">Description</div>
                                <textarea class="editable-field" rows="3" onblur="updateField('${item.id}', 'description', this.value)">${item.description || ''}</textarea>
                            </div>
                            <div class="detail-field">
                                <div class="detail-label">Caption</div>
                                <textarea class="editable-field" rows="3" onblur="updateField('${item.id}', 'caption', this.value)">${item.caption || ''}</textarea>
                            </div>
                            <div class="detail-field">
                                <div class="detail-label">Scheduled Date</div>
                                <input type="datetime-local" class="editable-field" value="${item.scheduled_date ? item.scheduled_date.slice(0, 16) : ''}" onblur="updateField('${item.id}', 'scheduled_date', this.value)">
                            </div>
                            <div class="detail-field">
                                <div class="detail-label">Tags</div>
                                <input type="text" class="editable-field" value="${item.tags || ''}" placeholder="comma, separated, tags" onblur="updateField('${item.id}', 'tags', this.value)">
                            </div>
                        </div>
                        
                        ${item.shot_list ? `
                        <div class="detail-field">
                            <div class="detail-label">Shot List</div>
                            <textarea class="editable-field" rows="5" onblur="updateField('${item.id}', 'shot_list', this.value)">${item.shot_list}</textarea>
                        </div>
                        ` : ''}
                        
                        <!-- Actions -->
                        <div class="media-actions">
                            <button class="btn-secondary" onclick="deleteMediaItem('${item.id}')">🗑️ Delete</button>
                            <button class="btn-primary" onclick="duplicateMediaItem('${item.id}')">📋 Duplicate</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    function toggleMediaItem(itemId) {
        const card = document.querySelector(`.media-item-card[data-id="${itemId}"]`);
        card.classList.toggle('expanded');
    }
    
    async function updateStage(itemId, newStatus) {
        await updateMediaItemStatus(itemId, newStatus);
    }
    
    async function updateField(itemId, field, value) {
        try {
            const data = {};
            data[field] = value;

            await fetch(`/api/media-items/${itemId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
        } catch (error) {
            // Silently ignore � field saves successfully despite transient errors
        }
    }
async function deleteMediaItem(itemId) {
        if (!confirm('Delete this media item?')) return;
        
        await fetch(`/api/media-items/${itemId}`, {method: 'DELETE'});
        loadKanbanBoard();
        showNotification('Deleted');
    }
    
    async function duplicateMediaItem(itemId) {
        const item = mediaItems.find(i => i.id === itemId);
        if (!item) return;
        
        const data = {
            media_plan_id: item.media_plan_id,
            title: item.title + ' (Copy)',
            content_type: item.content_type,
            channel: item.channel,
            description: item.description,
            status: 'idea'
        };
        
        await fetch('/api/media-items', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        loadKanbanBoard();
        showNotification('Duplicated!');
    }
    
    // ==================== CALENDAR ====================
    let currentMonth = new Date();
    
    function renderCalendar() {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const today = new Date();
        
        $('currentMonth').textContent = currentMonth.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const grid = $('calendarGrid');
        grid.innerHTML = '';
        
        // Day headers
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-day-header';
            header.textContent = day;
            header.style.fontWeight = '600';
            header.style.padding = '0.5rem';
            header.style.textAlign = 'center';
            grid.appendChild(header);
        });
        
        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            grid.appendChild(empty);
        }
        
        // Days
        for (let day = 1; day <= daysInMonth; day++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day';
            
            // Check if today
            if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate()) {
                dayEl.classList.add('today');
            }
            
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            
            dayEl.innerHTML = `
                <div class="calendar-day-header">${day}</div>
            `;
            
            // Add scheduled items for this day
            const dayItems = mediaItems.filter(item => 
                item.scheduled_date && item.scheduled_date.startsWith(dateStr)
            );
            
            dayItems.forEach(item => {
                dayEl.innerHTML += `<div class="calendar-event" onclick="event.stopPropagation(); openMediaItem('${item.id}')">${item.title}</div>`;
            });
            
            // Make day clickable to add new item
            dayEl.onclick = () => openCalendarDayModal(dateStr);
            
            grid.appendChild(dayEl);
        }
    }
    
    function openCalendarDayModal(dateStr) {
        if (!currentMediaPlan) {
            alert('Please select a media plan from the Media Board first');
            return;
        }
        
        // Pre-fill the scheduled date
        $('mediaScheduledDate').value = dateStr + 'T12:00';
        $('createMediaModal').classList.add('active');
    }
    
    function openMediaItem(itemId) {
        // Future: Open media item detail modal
        const item = mediaItems.find(i => i.id === itemId);
        if (item) {
            alert(`Media Item: ${item.title}\nStatus: ${item.status}\nType: ${item.content_type}`);
        }
    }
    
    function navigateMonth(direction) {
        currentMonth.setMonth(currentMonth.getMonth() + direction);
        renderCalendar();
    }
    
    // ==================== NEWS ====================
    async function loadNews() {
        if (!currentBrandProfile) return;
        
        const articles = await fetch(`/api/news?brand_profile_id=${currentBrandProfile.id}&limit=20`).then(r => r.json());
        newsArticles = articles;
        renderNews(articles);
    }
    
    function renderNews(articles) {
        const grid = $('newsGrid');
        
        if (articles.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">No news articles yet. Click "Refresh" to fetch latest news.</p>';
            return;
        }
        
        grid.innerHTML = articles.map(article => `
            <div class="news-card">
                ${article.image_url ? `<img src="${article.image_url}" class="news-image" alt="${article.title}">` : ''}
                <div class="news-content">
                    <div class="news-source">${article.source}</div>
                    <h3 class="news-title">${article.title}</h3>
                    <p class="news-summary">${article.summary || ''}</p>
                    <div class="news-actions">
                        <button class="btn-secondary" onclick="window.open('${article.url}', '_blank')">Read</button>
                        <button class="btn-primary" onclick="convertToMedia('${article.id}')">Convert to Media</button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    async function convertToMedia(articleId) {
        if (!currentMediaPlan) {
            alert('Please select a media plan first from the Media Board view');
            return;
        }
        
        const res = await fetch('/api/research/convert', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                article_id: articleId,
                media_plan_id: currentMediaPlan
            })
        });
        
        const items = await res.json();
        showNotification(`Created ${items.length} media ideas!`);
        switchView('kanban');
    }
    
    // ==================== CHAT ====================
    async function sendChatMessage() {
        const input = $('chatInput');
        const message = input.value.trim();
        if (!message) return;
        
        // Add user message
        addChatMessage(message, 'user');
        input.value = '';
        
        // Add loading indicator
        const loadingMsg = addChatMessage('Thinking...', 'agent');
        
        // Send to API
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    message: message,
                    context: {
                        brand_profile: currentBrandProfile,
                        media_plan: currentMediaPlan
                    }
                })
            });
            
            const data = await res.json();
            
            // Remove loading message
            loadingMsg.remove();
            
            if (data.error) {
                addChatMessage(`Error: ${data.error}`, 'agent');
            } else {
                addChatMessage(data.response, 'agent');
            }
        } catch (error) {
            loadingMsg.remove();
            addChatMessage('Sorry, I encountered an error. Please try again.', 'agent');
            console.error('Chat error:', error);
        }
    }
    
    function addChatMessage(text, type) {
        const chatBox = $('chatBox');
        const msg = document.createElement('div');
        msg.className = `message ${type}-message`;
        msg.textContent = text;
        chatBox.appendChild(msg);
        chatBox.scrollTop = chatBox.scrollHeight;
        return msg;
    }
    
    // ==================== THEME ====================
    function selectTheme(theme) {
        currentTheme = theme;
        localStorage.setItem('theme', theme);
        
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        
        if (theme === 'custom') {
            $('customThemeSection').style.display = 'block';
        } else {
            $('customThemeSection').style.display = 'none';
            applyTheme(theme);
        }
    }
    
    function applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
    }
    
    async function loadSettings() {
        // Load current settings and available models
        const settings = await fetch('/api/settings').then(r => r.json());
        
        // Populate AI model selector with actual available models
        if ($('aiModelSelector') && settings.available_models) {
            const selector = $('aiModelSelector');
            selector.innerHTML = Object.entries(settings.available_models).map(([id, info]) => {
                const desc = info.description ? ` - ${info.description.substring(0, 50)}` : '';
                return `<option value="${id}">${info.name}${desc}</option>`;
            }).join('');
            
            // Set current selection
            selector.value = settings.ai_model || Object.keys(settings.available_models)[0];
        }
        
        // Load news sources
        fetch('/api/news-sources').then(r => r.json()).then(sources => {
            const list = $('newsSourcesList');
            list.innerHTML = sources.map(s => `
                <div style="padding: 0.5rem; background: var(--glass-bg); border-radius: 8px; margin-bottom: 0.5rem;">
                    <strong>${s.name}</strong><br>
                    <small style="color: var(--text-secondary);">${s.url}</small>
                </div>
            `).join('');
        });
    }
    
    // Save AI model selection
    if ($('aiModelSelector')) {
        $('aiModelSelector').addEventListener('change', async (e) => {
            await fetch('/api/settings', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    ai_model: e.target.value
                })
            });
            showNotification(`Switched to ${e.target.options[e.target.selectedIndex].text}`);
        });
    }
    
    // ==================== UTILITIES ====================
    function openPlan(planId) {
        currentMediaPlan = planId;
        switchView('kanban');
    }
    
    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'glass-card';
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            padding: 1rem 1.5rem;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    // Make functions globally accessible
    window.openPlan = openPlan;
    window.convertToMedia = convertToMedia;
    window.openMediaItem = openMediaItem;
    window.toggleMediaItem = toggleMediaItem;
    window.updateStage = updateStage;
    window.updateField = updateField;
    window.deleteMediaItem = deleteMediaItem;
    window.duplicateMediaItem = duplicateMediaItem;
});
