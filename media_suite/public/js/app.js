// Media Planning Suite - Frontend Application

class MediaPlanningApp {
    constructor() {
        this.currentSection = 'dashboard';
        this.currentBusiness = null;
        this.currentPlan = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadDashboardData();
        await this.loadBusinessProfiles();
        this.showSection('dashboard');
    }

    setupEventListeners() {
        // Business form
        document.getElementById('business-form').addEventListener('submit', (e) => this.handleBusinessSubmit(e));
        
        // Brand form
        document.getElementById('brand-form').addEventListener('submit', (e) => this.handleBrandSubmit(e));
        
        // Media plan form
        document.getElementById('media-plan-form').addEventListener('submit', (e) => this.handleMediaPlanSubmit(e));
        
        // Research form
        document.getElementById('research-form').addEventListener('submit', (e) => this.handleResearchSubmit(e));
        
        // Asset form
        document.getElementById('asset-form').addEventListener('submit', (e) => this.handleAssetSubmit(e));
        
        // Logo upload preview
        document.getElementById('logo-upload').addEventListener('change', (e) => this.previewLogo(e));
    }

    // Navigation
    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.add('hidden');
        });
        
        // Show selected section
        document.getElementById(sectionId).classList.remove('hidden');
        
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('bg-gradient-to-r', 'from-blue-500', 'to-purple-500');
        });
        
        event.target.closest('.nav-btn').classList.add('bg-gradient-to-r', 'from-blue-500', 'to-purple-500');
        
        this.currentSection = sectionId;
        
        // Load section-specific data
        this.loadSectionData(sectionId);
    }

    async loadSectionData(sectionId) {
        switch(sectionId) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'media-plans':
                await this.loadMediaPlans();
                break;
            case 'research':
                await this.loadResearchData();
                break;
            case 'brand-assets':
                await this.loadBrandAssets();
                break;
        }
    }

    // Business Profile Management
    async handleBusinessSubmit(e) {
        e.preventDefault();
        
        const businessData = {
            name: document.getElementById('business-name').value,
            industry: document.getElementById('business-industry').value,
            description: document.getElementById('business-description').value,
            website: document.getElementById('business-website').value,
            target_audience: document.getElementById('target-audience').value,
            offerings: document.getElementById('business-offerings').value,
            brand_colors: document.getElementById('brand-colors').value,
            brand_fonts: document.getElementById('brand-fonts').value
        };

        try {
            const response = await fetch('/api/business-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(businessData)
            });

            if (response.ok) {
                const newBusiness = await response.json();
                this.showNotification('Business profile created successfully!', 'success');
                document.getElementById('business-form').reset();
                await this.loadBusinessProfiles();
            } else {
                throw new Error('Failed to create business profile');
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async handleBrandSubmit(e) {
        e.preventDefault();
        // Handle brand-specific settings
        this.showNotification('Brand settings updated!', 'success');
    }

    async loadBusinessProfiles() {
        try {
            const response = await fetch('/api/business-profiles');
            const profiles = await response.json();
            
            // Update all business select dropdowns
            const selects = ['plan-business', 'research-business', 'asset-business'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    select.innerHTML = '<option value="">Select Business</option>';
                    profiles.forEach(profile => {
                        select.innerHTML += `<option value="${profile.id}">${profile.name}</option>`;
                    });
                }
            });
            
            // Update saved profiles display
            this.displaySavedProfiles(profiles);
        } catch (error) {
            console.error('Error loading business profiles:', error);
        }
    }

    displaySavedProfiles(profiles) {
        const container = document.getElementById('saved-profiles');
        if (!container) return;
        
        if (profiles.length === 0) {
            container.innerHTML = '<p class="text-gray-400">No business profiles yet.</p>';
            return;
        }
        
        container.innerHTML = profiles.map(profile => `
            <div class="glass-card p-4 cursor-pointer hover:scale-105 transition-all" onclick="app.selectBusiness('${profile.id}')">
                <h4 class="font-bold text-lg mb-2">${profile.name}</h4>
                <p class="text-sm text-gray-300 mb-2">${profile.industry}</p>
                <p class="text-xs text-gray-400 line-clamp-2">${profile.description}</p>
            </div>
        `).join('');
    }

    selectBusiness(businessId) {
        this.currentBusiness = businessId;
        this.showNotification('Business profile selected', 'info');
    }

    // Media Plan Management
    async handleMediaPlanSubmit(e) {
        e.preventDefault();
        
        const planData = {
            business_id: document.getElementById('plan-business').value,
            title: document.getElementById('plan-title').value,
            description: document.getElementById('plan-description').value,
            start_date: document.getElementById('plan-start').value,
            end_date: document.getElementById('plan-end').value,
            total_budget: document.getElementById('plan-budget').value
        };

        try {
            const response = await fetch('/api/media-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(planData)
            });

            if (response.ok) {
                const newPlan = await response.json();
                this.showNotification('Media plan created successfully!', 'success');
                document.getElementById('media-plan-form').reset();
                await this.loadMediaPlans();
            } else {
                throw new Error('Failed to create media plan');
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async loadMediaPlans() {
        try {
            const response = await fetch('/api/media-plans');
            const plans = await response.json();
            this.displayMediaPlans(plans);
        } catch (error) {
            console.error('Error loading media plans:', error);
        }
    }

    displayMediaPlans(plans) {
        const container = document.getElementById('media-plans-grid');
        if (!container) return;
        
        if (plans.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-400">No media plans yet. Create your first plan above!</div>';
            return;
        }
        
        container.innerHTML = plans.map(plan => `
            <div class="media-card" onclick="app.openMediaPlan('${plan.id}')">
                <div class="flex justify-between items-start mb-4">
                    <h3 class="text-xl font-bold">${plan.title}</h3>
                    <span class="px-3 py-1 rounded-full text-xs font-medium ${this.getStatusColor(plan.status)}">
                        ${plan.status}
                    </span>
                </div>
                <p class="text-gray-300 mb-4 line-clamp-3">${plan.description}</p>
                <div class="flex justify-between items-center text-sm text-gray-400">
                    <span><i class="fas fa-calendar mr-1"></i>${new Date(plan.start_date).toLocaleDateString()}</span>
                    <span><i class="fas fa-dollar-sign mr-1"></i>${plan.total_budget || 'Not set'}</span>
                </div>
            </div>
        `).join('');
    }

    getStatusColor(status) {
        const colors = {
            'draft': 'bg-gray-500',
            'active': 'bg-green-500',
            'completed': 'bg-blue-500',
            'cancelled': 'bg-red-500'
        };
        return colors[status] || 'bg-gray-500';
    }

    openMediaPlan(planId) {
        this.currentPlan = planId;
        // Load detailed plan data and show modal
        this.loadMediaPlanDetails(planId);
    }

    async loadMediaPlanDetails(planId) {
        try {
            // Load plan details, calendar items, shot lists, storyboards
            const [plan, calendar, shotLists, storyboards] = await Promise.all([
                fetch(`/api/media-plans/${planId}`).then(r => r.json()),
                fetch(`/api/media-calendar?plan_id=${planId}`).then(r => r.json()),
                fetch(`/api/shot-lists?plan_id=${planId}`).then(r => r.json()),
                fetch(`/api/storyboards?plan_id=${planId}`).then(r => r.json())
            ]);

            this.displayMediaPlanModal(plan, calendar, shotLists, storyboards);
        } catch (error) {
            console.error('Error loading media plan details:', error);
        }
    }

    displayMediaPlanModal(plan, calendar, shotLists, storyboards) {
        const modal = document.getElementById('media-plan-modal');
        const content = document.getElementById('modal-content');
        
        content.innerHTML = `
            <div class="space-y-6">
                <!-- Plan Overview -->
                <div class="glass-card p-6">
                    <h4 class="text-xl font-bold mb-4">Plan Overview</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-sm text-gray-400">Title</p>
                            <p class="font-semibold">${plan.title}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-400">Status</p>
                            <p class="font-semibold">${plan.status}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-400">Start Date</p>
                            <p class="font-semibold">${new Date(plan.start_date).toLocaleDateString()}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-400">End Date</p>
                            <p class="font-semibold">${new Date(plan.end_date).toLocaleDateString()}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-400">Budget</p>
                            <p class="font-semibold">$${plan.total_budget || 'Not set'}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-400">Duration</p>
                            <p class="font-semibold">${this.calculateDuration(plan.start_date, plan.end_date)} days</p>
                        </div>
                    </div>
                    <div class="mt-4">
                        <p class="text-sm text-gray-400 mb-2">Description</p>
                        <p>${plan.description}</p>
                    </div>
                </div>

                <!-- Tabs for different sections -->
                <div class="flex space-x-4 border-b border-glass-border">
                    <button onclick="app.showPlanTab('calendar')" class="plan-tab px-4 py-2 font-medium text-primary-400 border-b-2 border-primary-400">
                        Calendar
                    </button>
                    <button onclick="app.showPlanTab('shots')" class="plan-tab px-4 py-2 font-medium text-gray-400 hover:text-white">
                        Shot Lists
                    </button>
                    <button onclick="app.showPlanTab('storyboard')" class="plan-tab px-4 py-2 font-medium text-gray-400 hover:text-white">
                        Storyboard
                    </button>
                    <button onclick="app.openExport()" class="plan-tab px-4 py-2 font-medium text-gray-400 hover:text-white">
                        <i class="fas fa-download mr-2"></i>Export
                    </button>
                </div>

                <!-- Tab Content -->
                <div id="plan-tab-content">
                    ${this.renderCalendarTab(calendar)}
                </div>
            </div>
        `;
        
        modal.classList.remove('hidden');
    }

    renderCalendarTab(calendar) {
        return `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h4 class="text-lg font-bold">Media Calendar</h4>
                    <button onclick="app.addCalendarItem()" class="glass-button px-4 py-2">
                        <i class="fas fa-plus mr-2"></i>Add Item
                    </button>
                </div>
                <div class="grid grid-cols-7 gap-2">
                    ${this.renderCalendarGrid(calendar)}
                </div>
            </div>
        `;
    }

    renderCalendarGrid(calendar) {
        // Simple calendar grid - you'd want to enhance this
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        let html = days.map(day => `<div class="text-center text-sm font-medium text-gray-400 py-2">${day}</div>`).join('');
        
        // Add calendar days
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        
        for (let i = 0; i < firstDay; i++) {
            html += '<div></div>';
        }
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEvents = calendar.filter(item => item.scheduled_date.startsWith(dateStr));
            
            html += `
                <div class="calendar-day">
                    <div class="font-medium mb-2">${day}</div>
                    ${dayEvents.map(event => `
                        <div class="text-xs p-1 bg-glass-background rounded mb-1">
                            <p class="font-medium truncate">${event.title}</p>
                            <p class="text-gray-400">${event.channel}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        return html;
    }

    showPlanTab(tab) {
        // Update tab styling
        document.querySelectorAll('.plan-tab').forEach(t => {
            t.classList.remove('text-primary-400', 'border-b-2', 'border-primary-400');
            t.classList.add('text-gray-400');
        });
        
        event.target.classList.remove('text-gray-400');
        event.target.classList.add('text-primary-400', 'border-b-2', 'border-primary-400');
        
        // Update content based on tab
        const content = document.getElementById('plan-tab-content');
        
        switch(tab) {
            case 'calendar':
                this.loadCalendarTab();
                break;
            case 'shots':
                this.openShotList();
                break;
            case 'storyboard':
                this.openStoryboard();
                break;
        }
    }

    loadCalendarTab() {
        const content = document.getElementById('plan-tab-content');
        content.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h4 class="text-lg font-bold">Media Calendar</h4>
                    <button onclick="app.addCalendarItem()" class="glass-button px-4 py-2">
                        <i class="fas fa-plus mr-2"></i>Add Item
                    </button>
                </div>
                <div class="grid grid-cols-7 gap-2">
                    ${this.renderCalendarGrid([])}
                </div>
            </div>
        `;
    }

    openShotList() {
        window.open(`/templates/shot-list?plan_id=${this.currentPlan}`, '_blank');
    }

    openStoryboard() {
        window.open(`/templates/storyboard?plan_id=${this.currentPlan}`, '_blank');
    }

    openExport() {
        window.open(`/templates/export?plan_id=${this.currentPlan}`, '_blank');
    }

    addCalendarItem() {
        // Implementation for adding calendar items
        this.showNotification('Calendar item feature coming soon!', 'info');
    }

    // Research Management
    async handleResearchSubmit(e) {
        e.preventDefault();
        
        const query = document.getElementById('research-query').value;
        const businessId = document.getElementById('research-business').value;
        
        try {
            const response = await fetch('/api/research/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, business_id: businessId })
            });

            if (response.ok) {
                const data = await response.json();
                this.displayResearchResults(data.results);
                this.showNotification('Research completed!', 'success');
            } else {
                throw new Error('Research failed');
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    displayResearchResults(results) {
        const container = document.getElementById('research-results');
        if (!container) return;
        
        if (!results || results.length === 0) {
            container.innerHTML = '<p class="text-gray-400">No results found.</p>';
            return;
        }
        
        container.innerHTML = results.map(result => `
            <div class="glass-card p-4">
                <h4 class="font-bold mb-2">
                    <a href="${result.link}" target="_blank" class="text-primary-400 hover:underline">
                        ${result.title}
                    </a>
                </h4>
                <p class="text-sm text-gray-300">${result.snippet}</p>
            </div>
        `).join('');
    }

    async loadResearchData() {
        try {
            // Load saved research data
            const response = await fetch('/api/research/saved');
            const research = await response.json();
            this.displaySavedResearch(research);
        } catch (error) {
            console.error('Error loading research data:', error);
        }
    }

    displaySavedResearch(research) {
        const container = document.getElementById('saved-research');
        if (!container) return;
        
        if (research.length === 0) {
            container.innerHTML = '<p class="text-gray-400">No saved research yet.</p>';
            return;
        }
        
        container.innerHTML = research.map(item => `
            <div class="glass-card p-4">
                <h4 class="font-bold mb-2">${item.topic}</h4>
                <p class="text-sm text-gray-400 mb-2">${new Date(item.collected_at).toLocaleDateString()}</p>
                <p class="text-sm line-clamp-3">${JSON.parse(item.content).slice(0, 200)}...</p>
            </div>
        `).join('');
    }

    // Brand Assets Management
    async handleAssetSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('business_id', document.getElementById('asset-business').value);
        formData.append('asset_type', document.getElementById('asset-type').value);
        formData.append('name', document.getElementById('asset-name').value);
        formData.append('file', document.getElementById('asset-file').files[0]);
        
        try {
            const response = await fetch('/api/brand-assets', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                this.showNotification('Asset uploaded successfully!', 'success');
                document.getElementById('asset-form').reset();
                await this.loadBrandAssets();
            } else {
                throw new Error('Failed to upload asset');
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async loadBrandAssets() {
        try {
            const businessId = this.currentBusiness || '';
            const response = await fetch(`/api/brand-assets?business_id=${businessId}`);
            const assets = await response.json();
            this.displayBrandAssets(assets);
        } catch (error) {
            console.error('Error loading brand assets:', error);
        }
    }

    displayBrandAssets(assets) {
        const container = document.getElementById('assets-gallery');
        if (!container) return;
        
        if (assets.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-400">No brand assets yet. Upload your first asset above!</div>';
            return;
        }
        
        container.innerHTML = assets.map(asset => `
            <div class="media-card">
                <div class="aspect-square bg-glass-background rounded-lg mb-4 flex items-center justify-center">
                    ${asset.file_path ? 
                        `<img src="${asset.file_path}" alt="${asset.name}" class="max-w-full max-h-full object-contain rounded-lg">` :
                        `<i class="fas fa-file text-4xl text-gray-400"></i>`
                    }
                </div>
                <h4 class="font-bold mb-2">${asset.name}</h4>
                <p class="text-sm text-gray-400 mb-2">${asset.asset_type}</p>
                <div class="flex space-x-2">
                    <button class="glass-button px-3 py-1 text-xs">
                        <i class="fas fa-download mr-1"></i>Download
                    </button>
                    <button class="glass-button px-3 py-1 text-xs">
                        <i class="fas fa-edit mr-1"></i>Edit
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Dashboard
    async loadDashboardData() {
        try {
            const [businesses, plans, shots, scheduled] = await Promise.all([
                fetch('/api/business-profiles').then(r => r.json()),
                fetch('/api/media-plans').then(r => r.json()),
                fetch('/api/shot-lists').then(r => r.json()),
                fetch('/api/media-calendar?month=' + new Date().toISOString().slice(0,7)).then(r => r.json())
            ]);

            // Update stats
            document.getElementById('business-count').textContent = businesses.length;
            document.getElementById('plan-count').textContent = plans.length;
            document.getElementById('shot-count').textContent = shots.length;
            document.getElementById('scheduled-count').textContent = scheduled.length;
            
            // Load recent activity
            this.loadRecentActivity();
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    async loadRecentActivity() {
        try {
            // This would be a dedicated endpoint for activity logs
            const container = document.getElementById('recent-activity');
            container.innerHTML = `
                <div class="space-y-3">
                    <div class="flex items-center space-x-3 p-3 bg-glass-background rounded-lg">
                        <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                            <i class="fas fa-plus text-white text-xs"></i>
                        </div>
                        <div>
                            <p class="font-medium">New business profile created</p>
                            <p class="text-xs text-gray-400">2 hours ago</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3 p-3 bg-glass-background rounded-lg">
                        <div class="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                            <i class="fas fa-calendar text-white text-xs"></i>
                        </div>
                        <div>
                            <p class="font-medium">Media plan scheduled</p>
                            <p class="text-xs text-gray-400">5 hours ago</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3 p-3 bg-glass-background rounded-lg">
                        <div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                            <i class="fas fa-camera text-white text-xs"></i>
                        </div>
                        <div>
                            <p class="font-medium">Shot list completed</p>
                            <p class="text-xs text-gray-400">1 day ago</p>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading recent activity:', error);
        }
    }

    // Utility Functions
    calculateDuration(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    previewLogo(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('logo-image').src = e.target.result;
                document.getElementById('logo-preview').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-20 right-4 z-50 glass-card p-4 max-w-sm transform translate-x-full transition-transform duration-300`;
        
        const colors = {
            success: 'text-green-400',
            error: 'text-red-400',
            info: 'text-blue-400'
        };
        
        notification.innerHTML = `
            <div class="flex items-center space-x-3">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} ${colors[type]}"></i>
                <p class="flex-1">${message}</p>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }
}

// Initialize app
const app = new MediaPlanningApp();

// Global functions for inline event handlers
window.showSection = (sectionId) => app.showSection(sectionId);
window.closeModal = (modalId) => app.closeModal(modalId);
window.selectBusiness = (businessId) => app.selectBusiness(businessId);
window.openMediaPlan = (planId) => app.openMediaPlan(planId);
window.showPlanTab = (tab) => app.showPlanTab(tab);
window.addCalendarItem = () => app.addCalendarItem();
