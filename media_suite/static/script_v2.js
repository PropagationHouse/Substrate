// ========== STATE ==========
let state = {
    currentMonth: new Date(),
    brandProfile: null,
    mediaItems: [],
    selectedItem: null,
    aiModel: 'gemini-2.5-flash',
    theme: 'forest',
    moduleOrder: ['kanbanModule', 'timelineModule', 'contentModule', 'researchModule', 'moodBoardModule', 'assetsModule'],
    moodBoardImages: [],
    currentPlanningTool: null,
    planningData: {},
    kanbanSelectMode: false,
    kanbanSelected: new Set(),
    kanbanAddingTo: null,
    // Workspace
    activeWorkspace: null,
    workspaces: []
};

// ========== WORKSPACE SYSTEM ==========
async function loadWorkspaces() {
    try {
        const response = await fetch('/api/workspaces');
        state.workspaces = await response.json();
        
        // Restore last active workspace from localStorage, or use main
        const lastWsId = localStorage.getItem('activeWorkspaceId');
        const lastWs = state.workspaces.find(w => w.id === lastWsId);
        state.activeWorkspace = lastWs || state.workspaces.find(w => w.is_main) || state.workspaces[0];
        
        if (state.activeWorkspace) {
            localStorage.setItem('activeWorkspaceId', state.activeWorkspace.id);
        }
        
        renderWorkspaceSwitcher();
    } catch (err) {
        console.error('Failed to load workspaces:', err);
    }
}

function getWorkspaceId() {
    return state.activeWorkspace?.id || '';
}

function renderWorkspaceSwitcher() {
    const iconEl = document.getElementById('wsIcon');
    const nameEl = document.getElementById('wsName');
    const listEl = document.getElementById('workspaceList');
    
    if (!iconEl || !nameEl || !listEl) return;
    
    const ws = state.activeWorkspace;
    if (ws) {
        iconEl.textContent = ws.icon || '??';
        nameEl.textContent = ws.name;
        nameEl.style.color = ws.is_main ? '' : ws.color;
    }
    
    listEl.innerHTML = state.workspaces.map(w => `
        <div class="workspace-option ${w.id === state.activeWorkspace?.id ? 'active' : ''}" onclick="switchWorkspace('${w.id}')">
            <span class="workspace-option-icon">${w.icon}</span>
            <span class="workspace-option-name">${w.name}</span>
            <span class="workspace-option-dot" style="background:${w.color};"></span>
            ${w.is_main ? '<span style="font-size:0.6rem;color:var(--text-tertiary);margin-left:auto;">main</span>' : ''}
        </div>
    `).join('');
}

function toggleWorkspaceMenu() {
    const dropdown = document.getElementById('workspaceDropdown');
    if (dropdown) dropdown.classList.toggle('open');
}

// Close workspace dropdown when clicking outside
document.addEventListener('click', (e) => {
    const switcher = document.getElementById('workspaceSwitcher');
    const dropdown = document.getElementById('workspaceDropdown');
    if (dropdown && switcher && !switcher.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

async function switchWorkspace(wsId) {
    const ws = state.workspaces.find(w => w.id === wsId);
    if (!ws || ws.id === state.activeWorkspace?.id) {
        document.getElementById('workspaceDropdown')?.classList.remove('open');
        return;
    }
    
    state.activeWorkspace = ws;
    localStorage.setItem('activeWorkspaceId', ws.id);
        setTimeout(initResearchHub, 100);
    document.getElementById('workspaceDropdown')?.classList.remove('open');
    
    // Reload everything scoped to this workspace
    await loadBrandProfile();
    await loadMediaItems();
    await loadMoodBoard();
    renderWorkspaceSwitcher();
    renderAll();
    showNotification(`Switched to ${ws.icon} ${ws.name}`);
}

function openCreateWorkspaceModal() {
    document.getElementById('workspaceDropdown')?.classList.remove('open');
    openModal('createWorkspaceModal');
    // Reset form
    const nameInput = document.getElementById('newWsName');
    if (nameInput) nameInput.value = '';
    const brandName = document.getElementById('newWsBrandName');
    if (brandName) brandName.value = '';
    const industry = document.getElementById('newWsIndustry');
    if (industry) industry.value = '';
    const audience = document.getElementById('newWsAudience');
    if (audience) audience.value = '';
}

function selectWsIcon(btn) {
    document.querySelectorAll('.ws-icon-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

function selectWsColor(btn) {
    document.querySelectorAll('.ws-color-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

async function createWorkspace() {
    const name = document.getElementById('newWsName')?.value?.trim();
    if (!name) { showNotification('Channel name is required', 'error'); return; }
    
    const icon = document.querySelector('.ws-icon-opt.selected')?.dataset?.icon || '??';
    const color = document.querySelector('.ws-color-opt.selected')?.dataset?.color || '#818cf8';
    const createBrand = document.getElementById('newWsCreateBrand')?.checked;
    
    const payload = { name, icon, color, create_brand_profile: createBrand };
    
    if (createBrand) {
        payload.brand_name = document.getElementById('newWsBrandName')?.value?.trim() || name;
        payload.industry = document.getElementById('newWsIndustry')?.value?.trim() || '';
        payload.target_audience = document.getElementById('newWsAudience')?.value?.trim() || '';
    }
    
    try {
        const response = await fetch('/api/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const ws = await response.json();
        
        state.workspaces.push(ws);
        closeModal('createWorkspaceModal');
        
        // Immediately switch to the new workspace
        await switchWorkspace(ws.id);
        showNotification(`Created channel "${name}" — you're now in it!`);
    } catch (err) {
        showNotification('Failed to create channel', 'error');
    }
}

async function deleteWorkspace(wsId) {
    const ws = state.workspaces.find(w => w.id === wsId);
    if (!ws || ws.is_main) { showNotification('Cannot delete the main workspace', 'error'); return; }
    if (!confirm(`Delete "${ws.name}" and ALL its content? This cannot be undone.`)) return;
    
    try {
        await fetch(`/api/workspaces/${wsId}`, { method: 'DELETE' });
        state.workspaces = state.workspaces.filter(w => w.id !== wsId);
        
        // Switch to main
        const main = state.workspaces.find(w => w.is_main) || state.workspaces[0];
        await switchWorkspace(main.id);
        showNotification(`Deleted "${ws.name}"`);
    } catch (err) {
        showNotification('Failed to delete workspace', 'error');
    }
}

async function renameWorkspace(wsId) {
    const ws = state.workspaces.find(w => w.id === wsId);
    if (!ws) return;
    const name = prompt('Rename channel:', ws.name);
    if (!name || !name.trim()) return;
    
    try {
        const response = await fetch(`/api/workspaces/${wsId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        const updated = await response.json();
        Object.assign(ws, updated);
        renderWorkspaceSwitcher();
        showNotification(`Renamed to "${name.trim()}"`);
    } catch (err) {
        showNotification('Rename failed', 'error');
    }
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    setTimeout(initResearchHub, 1000);

    initModules();
    initDraggableSidebar();
    initCustomSelects();
    initDatePicker();
    initModals();
    initAIPanel();
    initMoodBoard();
    initPlanningTools();
    initResearch();
    initEditableNavLabels();
    await loadWorkspaces();
    await loadSettings();
    loadCustomTheme();
    await loadBrandProfile();
    await loadMediaItems();
    await loadMoodBoard();
    renderAll();
    
    // Poll for external changes (e.g. deletions from Substrate main task board) every 10s
    setInterval(async () => {
        if (!state.brandProfile) return;
        try {
            const wsParam = getWorkspaceId() ? `&workspace_id=${getWorkspaceId()}` : '';
            const response = await fetch(`/api/media-items?brand_profile_id=${state.brandProfile.id}${wsParam}`);
            if (!response.ok) return;
            const freshItems = await response.json();
            // Only re-render if item count or IDs changed
            const currentIds = state.mediaItems.map(i => i.id).sort().join(',');
            const freshIds = freshItems.map(i => i.id).sort().join(',');
            if (currentIds !== freshIds) {
                state.mediaItems = freshItems;
                renderKanban();
                renderContentGrid();
            }
        } catch (e) { /* ignore polling errors */ }
    }, 10000);
});

// ========== MODULES ==========
function initModules() {
    // Module toggle
    document.querySelectorAll('.module-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const module = btn.closest('.module');
            module.classList.toggle('collapsed');
        });
    });
    
    // Apply saved order
    const savedOrder = localStorage.getItem('moduleOrder');
    if (savedOrder) {
        state.moduleOrder = JSON.parse(savedOrder);
        reorderModules();
    }
}

function reorderModules() {
    const mainContent = document.querySelector('.main-content');
    const globalActions = mainContent.querySelector('.global-actions');
    
    state.moduleOrder.forEach(moduleId => {
        const module = document.getElementById(moduleId);
        if (module) {
            mainContent.appendChild(module);
        }
    });
    
    // Keep global actions at top
    if (globalActions) {
        mainContent.insertBefore(globalActions, mainContent.firstChild);
    }
}

// ========== DRAGGABLE SIDEBAR ==========
function initDraggableSidebar() {
    const navItems = document.querySelectorAll('.nav-item[draggable="true"]');
    let draggedItem = null;
    
    navItems.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(e.currentTarget.parentElement, e.clientY);
            if (afterElement == null) {
                e.currentTarget.parentElement.appendChild(draggedItem);
            } else {
                e.currentTarget.parentElement.insertBefore(draggedItem, afterElement);
            }
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            updateModuleOrder();
        });
        
        // Click to scroll to module
        item.addEventListener('click', () => {
            const moduleId = item.dataset.module;
            const module = document.getElementById(moduleId);
            if (module) {
                module.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.nav-item[draggable="true"]:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateModuleOrder() {
    const navItems = document.querySelectorAll('.nav-item[draggable="true"]');
    state.moduleOrder = Array.from(navItems).map(item => item.dataset.module);
    localStorage.setItem('moduleOrder', JSON.stringify(state.moduleOrder));
    reorderModules();
}

// ========== CUSTOM SELECTS ==========
function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(select => {
        const trigger = select.querySelector('.select-trigger');
        const options = select.querySelectorAll('.select-option');
        
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other selects
            document.querySelectorAll('.custom-select').forEach(s => {
                if (s !== select) s.classList.remove('open');
            });
            select.classList.toggle('open');
        });
        
        options.forEach(option => {
            option.addEventListener('click', () => {
                const value = option.dataset.value;
                const text = option.textContent;
                
                trigger.querySelector('span:first-child').textContent = text;
                
                // Update selected state
                options.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                select.classList.remove('open');
                
                // Trigger change event
                const event = new CustomEvent('selectchange', { detail: { value, text } });
                select.dispatchEvent(event);
            });
        });
    });
    
    // Close on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select').forEach(s => s.classList.remove('open'));
    });
}

// ========== DATE PICKER ==========
function initDatePicker() {
    const input = document.getElementById('publishDate');
    const miniCal = document.getElementById('miniCalendar');
    
    if (!input || !miniCal) return;
    
    input.addEventListener('click', () => {
        miniCal.style.display = miniCal.style.display === 'none' ? 'block' : 'none';
        if (miniCal.style.display === 'block') {
            renderMiniCalendar();
        }
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.date-picker-wrapper')) {
            miniCal.style.display = 'none';
        }
    });
}

function renderMiniCalendar(month = new Date()) {
    const miniCal = document.getElementById('miniCalendar');
    const year = month.getFullYear();
    const monthNum = month.getMonth();
    const today = new Date();
    
    const firstDay = new Date(year, monthNum, 1).getDay();
    const daysInMonth = new Date(year, monthNum + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, monthNum, 0).getDate();
    
    let html = `
        <div class="mini-calendar-header">
            <button class="mini-calendar-nav" onclick="navigateMiniCalendar(-1)">?</button>
            <h4>${month.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h4>
            <button class="mini-calendar-nav" onclick="navigateMiniCalendar(1)">?</button>
        </div>
        <div class="mini-calendar-grid">
    `;
    
    // Day headers
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(day => {
        html += `<div class="mini-calendar-day-header">${day}</div>`;
    });
    
    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        html += `<div class="mini-calendar-day other-month">${day}</div>`;
    }
    
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthNum, day);
        const dateStr = date.toISOString().split('T')[0];
        const isToday = date.toDateString() === today.toDateString();
        const hasContent = state.mediaItems.some(item => 
            item.scheduled_date && item.scheduled_date.startsWith(dateStr)
        );
        
        html += `
            <div class="mini-calendar-day ${isToday ? 'today' : ''} ${hasContent ? 'has-content' : ''}" 
                 onclick="selectMiniCalendarDate('${dateStr}')">
                ${day}
            </div>
        `;
    }
    
    // Next month days
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    const remainingCells = totalCells - (firstDay + daysInMonth);
    for (let day = 1; day <= remainingCells; day++) {
        html += `<div class="mini-calendar-day other-month">${day}</div>`;
    }
    
    html += '</div>';
    miniCal.innerHTML = html;
}

window.navigateMiniCalendar = function(direction) {
    const current = new Date(state.currentMonth);
    current.setMonth(current.getMonth() + direction);
    renderMiniCalendar(current);
};

window.selectMiniCalendarDate = function(dateStr) {
    const input = document.getElementById('publishDate');
    const date = new Date(dateStr + 'T12:00');
    input.value = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    input.dataset.value = dateStr + 'T12:00';
    document.getElementById('miniCalendar').style.display = 'none';
    
    // Update selected state
    document.querySelectorAll('.mini-calendar-day').forEach(d => d.classList.remove('selected'));
    event.target.classList.add('selected');
};

// ========== RENDER ALL ==========
function renderAll() {
    renderKanban();
    renderTimeline();
    renderContentGrid();
    renderResearch();
    renderAssets();
    renderDayPlanner();
}

// ========== KANBAN BOARD ==========
function renderKanban() {
    const board = document.getElementById('kanbanBoard');
    
    const stages = [
        { id: 'not_started', icon: '??', label: 'Not Started' },
        { id: 'in_progress', icon: '??', label: 'In Progress' },
        { id: 'done', icon: '?', label: 'Done' }
    ];
    
    // Batch controls bar
    const batchBar = state.kanbanSelectMode ? `
        <div class="kanban-batch-bar" style="grid-column: 1 / -1; display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3); border-radius: 10px; margin-bottom: 0.5rem;">
            <span style="font-size: 0.85rem; color: #c4b5fd;">${state.kanbanSelected.size} selected</span>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="kanbanSelectAll()">Select All</button>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="state.kanbanSelected.clear(); renderKanban();">Deselect</button>
            <div style="flex:1;"></div>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="kanbanBatchMove('not_started')">? Not Started</button>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="kanbanBatchMove('in_progress')">? In Progress</button>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="kanbanBatchMove('done')">? Done</button>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem; color: #f87171;" onclick="kanbanBatchDelete()">?? Delete</button>
            <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;" onclick="toggleKanbanSelectMode()">? Exit</button>
        </div>
    ` : '';
    
    const columns = stages.map(stage => {
        const items = state.mediaItems.filter(item => item.status === stage.id);
        
        return `
            <div class="kanban-column" data-status="${stage.id}"
                 ondragover="kanbanDragOver(event)" ondrop="kanbanDrop(event, '${stage.id}')" ondragleave="kanbanDragLeave(event)">
                <div class="kanban-column-header">
                    <div class="kanban-column-title">
                        <span>${stage.icon}</span>
                        <span>${stage.label}</span>
                    </div>
                    <span class="kanban-count">${items.length}</span>
                    <button class="btn-ghost" style="font-size:1rem;padding:0;width:22px;height:22px;display:flex;align-items:center;justify-content:center;opacity:0.4;border-radius:6px;" onclick="event.stopPropagation();quickAddToColumn('${stage.id}')" title="Add content">+</button>
                </div>
                <div class="kanban-items" ondragover="kanbanDragOver(event)" ondrop="kanbanDrop(event, '${stage.id}')">
                    ${items.map(item => {
                        const isSelected = state.kanbanSelected.has(item.id);
                        return `
                            <div class="kanban-card ${isSelected ? 'kanban-selected' : ''}" draggable="${!state.kanbanSelectMode}" data-item-id="${item.id}"
                                 ondragstart="kanbanDragStart(event, '${item.id}')" ondragend="kanbanDragEnd(event)"
                                 onclick="${state.kanbanSelectMode ? `toggleKanbanSelect('${item.id}')` : `openContentModal('${item.id}')`}">
                                <button class="card-x-delete" onclick="event.stopPropagation(); quickDeleteItem('${item.id}')" title="Delete">×</button>
                                ${state.kanbanSelectMode ? `<div class="kanban-checkbox" style="position:absolute;top:0.5rem;left:0.5rem;width:18px;height:18px;border-radius:4px;border:2px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'};background:${isSelected ? 'var(--accent)' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:11px;color:#000;">${isSelected ? '?' : ''}</div>` : ''}
                                <div class="kanban-card-title" ${state.kanbanSelectMode ? 'style="padding-left:1.5rem;"' : ''}>${item.title}</div>
                                <div class="kanban-card-meta">
                                    <span class="kanban-card-tag">${item.content_type}</span>
                                    ${item.channel && item.channel !== 'none' && item.channel !== 'social' ? `<span class="kanban-card-tag">${item.channel}</span>` : ''}
                                    ${item.scheduled_date ? `<span class="kanban-card-tag">?? ${new Date(item.scheduled_date).toLocaleDateString()}</span>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('') || '<p class="kanban-empty" style="color: var(--text-tertiary); text-align: center; padding: 2rem;">No items</p>'}
                </div>
            </div>
        `;
    }).join('');
    
    board.innerHTML = batchBar + columns;
}

function quickAddToColumn(status) {
    openContentModal(null, status);
}

function toggleKanbanSelectMode() {
    state.kanbanSelectMode = !state.kanbanSelectMode;
    if (!state.kanbanSelectMode) state.kanbanSelected.clear();
    renderKanban();
}

function toggleKanbanSelect(itemId) {
    if (state.kanbanSelected.has(itemId)) {
        state.kanbanSelected.delete(itemId);
    } else {
        state.kanbanSelected.add(itemId);
    }
    renderKanban();
}

function kanbanSelectAll() {
    state.mediaItems.forEach(item => state.kanbanSelected.add(item.id));
    renderKanban();
}

async function kanbanBatchMove(newStatus) {
    if (state.kanbanSelected.size === 0) return;
    const ids = [...state.kanbanSelected];
    
    for (const id of ids) {
        try {
            await fetch(`/api/media-items/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ status: newStatus })
            });
            const item = state.mediaItems.find(i => i.id === id);
            if (item) item.status = newStatus;
        } catch (e) { console.error(e); }
    }
    
    state.kanbanSelected.clear();
    state.kanbanSelectMode = false;
    renderKanban();
    renderContentGrid();
    showNotification(`Moved ${ids.length} items to ${newStatus.replace('_', ' ')}`);
}

async function quickDeleteItem(itemId) {
    try {
        await fetch(`/api/media-items/${itemId}`, { method: 'DELETE' });
        state.mediaItems = state.mediaItems.filter(i => i.id !== itemId);
        renderAll();
    } catch (e) { console.error(e); }
}

async function quickDeleteArticle(articleId) {
    try {
        await fetch(`/api/news/${articleId}`, { method: 'DELETE' });
        researchState.articles = researchState.articles.filter(a => a.id !== articleId);
        researchState.searchResults = researchState.searchResults.filter(a => a.id !== articleId);
        researchState.pinnedArticles = researchState.pinnedArticles.filter(a => a.id !== articleId);
        // Remove the card from DOM instantly for snappy feel
        const card = document.querySelector(`[data-article-id="${articleId}"]`);
        if (card) card.remove();
    } catch (e) { console.error(e); }
}

async function kanbanBatchDelete() {
    if (state.kanbanSelected.size === 0) return;
    if (!confirm(`Delete ${state.kanbanSelected.size} selected item(s)? This cannot be undone.`)) return;
    
    const ids = [...state.kanbanSelected];
    
    for (const id of ids) {
        try {
            await fetch(`/api/media-items/${id}`, { method: 'DELETE' });
        } catch (e) { console.error(e); }
    }
    
    state.mediaItems = state.mediaItems.filter(i => !ids.includes(i.id));
    state.kanbanSelected.clear();
    state.kanbanSelectMode = false;
    renderAll();
    showNotification(`Deleted ${ids.length} items`);
}

function kanbanDragStart(e, itemId) {
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
    // Highlight all columns
    document.querySelectorAll('.kanban-column').forEach(col => col.classList.add('drag-active'));
}

function kanbanDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.kanban-column').forEach(col => {
        col.classList.remove('drag-active', 'drag-over');
    });
}

function kanbanDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const column = e.target.closest('.kanban-column');
    if (column) column.classList.add('drag-over');
}

function kanbanDragLeave(e) {
    const column = e.target.closest('.kanban-column');
    if (column && !column.contains(e.relatedTarget)) {
        column.classList.remove('drag-over');
    }
}

async function kanbanDrop(e, newStatus) {
    e.preventDefault();
    const column = e.target.closest('.kanban-column');
    if (column) column.classList.remove('drag-over');
    
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    
    const item = state.mediaItems.find(i => i.id === itemId);
    if (!item || item.status === newStatus) return;
    
    try {
        const response = await fetch(`/api/media-items/${itemId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
            item.status = newStatus;
            renderKanban();
            renderContentGrid();
            showNotification(`Moved "${item.title}" to ${newStatus.replace('_', ' ')}`);
        }
    } catch (error) {
        console.error('Error updating item status:', error);
        showNotification('Error moving item', 'error');
    }
}


// ========== CALENDAR DRAG-DROP ==========
function calendarDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const dayCell = e.target.closest('.calendar-day') || e.target.closest('.planner-week-day') || e.target.closest('.planner-day-dropzone');
    if (dayCell) {
        dayCell.classList.add('calendar-drag-over');
    }
}

function calendarDragLeave(e) {
    e.stopPropagation();
    const dayCell = e.target.closest('.calendar-day') || e.target.closest('.planner-week-day') || e.target.closest('.planner-day-dropzone');
    if (dayCell && !dayCell.contains(e.relatedTarget)) {
        dayCell.classList.remove('calendar-drag-over');
    }
}

async function calendarDrop(e, dateStr) {
    e.preventDefault();
    e.stopPropagation();
    const dayCell = e.target.closest('.calendar-day') || e.target.closest('.planner-week-day') || e.target.closest('.planner-day-dropzone');
    if (dayCell) dayCell.classList.remove('calendar-drag-over');

    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;

    const item = state.mediaItems.find(i => i.id == itemId);
    if (!item) return;

    // Don't do anything if already on this date
    if (item.scheduled_date === dateStr) return;

    try {
        const response = await fetch('/api/media-items/' + itemId, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ scheduled_date: dateStr })
        });

        if (response.ok) {
            item.scheduled_date = dateStr;
            renderTimeline();
            renderDayPlanner();
            renderKanban();
            showNotification('Scheduled "' + item.title + '" for ' + dateStr);
        }
    } catch (error) {
        console.error('Error scheduling item:', error);
        showNotification('Error scheduling item', 'error');
    }
}

function calendarPillDragStart(e, itemId) {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
    // Also highlight calendar cells as drop targets
    document.querySelectorAll('.calendar-day').forEach(d => d.classList.add('calendar-drop-target'));
}

// Also extend kanbanDragEnd to clean up calendar highlights
const _originalKanbanDragEnd = kanbanDragEnd;
function kanbanDragEndExtended(e) {
    _originalKanbanDragEnd(e);
    document.querySelectorAll('.calendar-day').forEach(d => {
        d.classList.remove('calendar-drag-over', 'calendar-drop-target');
    });
    document.querySelectorAll('.content-pill.dragging').forEach(p => p.classList.remove('dragging'));
}
// Patch kanbanDragEnd globally
window.kanbanDragEnd = kanbanDragEndExtended;

// ========== QUICK CREATE PROJECT ==========
async function quickCreateProject() {
    const input = document.getElementById('quickProjectInput');
    const title = input?.value?.trim();
    if (!title) return;
    
    try {
        const response = await fetch('/api/media-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                content_type: 'Image',
                status: 'not_started',
                brand_profile_id: state.brandProfile?.id
            })
        });
        const item = await response.json();
        if (item.error) {
            showNotification(item.error, 'error');
            return;
        }
        state.mediaItems.push(item);
        input.value = '';
        renderAll();
        showNotification('Project created');
    } catch (err) {
        showNotification('Error creating project', 'error');
    }
}

// ========== TIMELINE ==========
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
                <button class="btn-ghost" onclick="navigateMonth(-1)">? Prev</button>
                <button class="btn-ghost" onclick="navigateMonth(1)">Next ?</button>
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
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="openDayModal('${dateStr}')" ondragover="calendarDragOver(event)" ondragleave="calendarDragLeave(event)" ondrop="calendarDrop(event, '${dateStr}')">
                <div class="day-number">${day}${dayItems.length > 0 ? `<span class="day-count">${dayItems.length}</span>` : ''}</div>
                <div class="day-content">
                    ${dayItems.map(item => {
                        const statusColor = item.status === 'published' ? '#4ade80' : item.status === 'in_progress' ? '#facc15' : item.status === 'review' ? '#818cf8' : 'var(--accent)';
                        return `<div class="content-pill compact" draggable="true" ondragstart="calendarPillDragStart(event, '${item.id}')" style="border-left-color:${statusColor}; cursor: grab;" onclick="event.stopPropagation(); openContentModal('${item.id}')">${item.title}</div>`;
                    }).join('')}
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
        grid.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 3rem;">No projects yet. Use the + button in the Project Board or the Brainstorming section to add items.</p>';
        return;
    }
    
    grid.innerHTML = state.mediaItems.map(item => `
        <div class="content-card" draggable="true" ondragstart="kanbanDragStart(event, '${item.id}')" ondragend="kanbanDragEndExtended(event)" onclick="openContentModal('${item.id}')">
            <div class="content-card-title">${item.title}</div>
            <div class="content-card-meta">
                <span class="tag">${item.status}</span>
                <span class="tag">${item.content_type}</span>
                ${item.channel && item.channel !== 'none' && item.channel !== 'social' ? `<span class="tag">${item.channel}</span>` : ''}
                ${item.scheduled_date ? `<span class="tag">?? ${new Date(item.scheduled_date).toLocaleDateString()}</span>` : ''}
            </div>
            <div class="content-card-description">${item.description || 'No description'}</div>
        </div>
    `).join('');
}

// ========== RESEARCH MODULE ==========
let researchState = {
    currentTab: 'feed',
    articles: [],
    searchResults: [],
    searchSources: [],
    pinnedArticles: [],
    briefs: [],
    sources: [],
    interests: [],
    lastSearchSummary: '',
    lastSearchQuery: '',
    _cachedDigest: ''
};

function initResearch() {
    const searchBtn = document.getElementById('researchSearchBtn');
    const searchInput = document.getElementById('researchSearchInput');
    const aiResearchBtn = document.getElementById('aiResearchBtn');
    const researchSettingsBtn = document.getElementById('researchSettingsBtn');
    const closeResearchSettingsBtn = document.getElementById('closeResearchSettingsBtn');
    const addInterestBtn = document.getElementById('addInterestBtn');
    const addSourceBtn = document.getElementById('addSourceBtn');
    
    if (searchBtn) searchBtn.addEventListener('click', doResearchSearch);
    if (searchInput) searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doResearchSearch(); });
    if (aiResearchBtn) aiResearchBtn.addEventListener('click', generateAIBrief);
    if (researchSettingsBtn) researchSettingsBtn.addEventListener('click', () => { openModal('researchSettingsModal'); loadResearchSettings(); });
    if (closeResearchSettingsBtn) closeResearchSettingsBtn.addEventListener('click', () => closeModal('researchSettingsModal'));
    if (addInterestBtn) addInterestBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addInterest(); });
    if (addSourceBtn) addSourceBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addNewsSource(); });
    
    // Enter key support for inputs
    const addInterestInput = document.getElementById('addInterestInput');
    const addSourceNameInput = document.getElementById('addSourceName');
    const addSourceUrlInput = document.getElementById('addSourceUrl');
    if (addInterestInput) addInterestInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addInterest(); });
    if (addSourceNameInput) addSourceNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addNewsSource(); });
    if (addSourceUrlInput) addSourceUrlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addNewsSource(); });
    
    // Load interests from brand profile keywords
    loadResearchInterests();
}

async function loadResearchInterests() {
    if (state.brandProfile?.keywords) {
        researchState.interests = state.brandProfile.keywords.split(',').map(k => k.trim()).filter(k => k);
    }
    renderResearchKeywords();
}

function renderResearchKeywords() {
    const bar = document.getElementById('researchKeywordsBar');
    if (!bar) return;
    
    if (researchState.interests.length === 0) {
        bar.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-tertiary);">No interests set. Go to Sources to add keywords.</span>';
        return;
    }
    
    bar.innerHTML = researchState.interests.map(interest => 
        `<span class="tag" style="cursor: pointer;" onclick="searchByInterest('${interest.replace(/'/g, "\\'")}')">${interest}</span>`
    ).join('');
}

function switchResearchTab(tab) {
    researchState.currentTab = tab;
    document.querySelectorAll('.research-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    renderResearchContent();
}

async function renderResearch() {
    await loadResearchInterests();
    await renderResearchContent();
    
    // Auto-fetch news on first load if we have no articles and have a brand profile
    if (researchState.articles.length === 0 && state.brandProfile?.id) {
        try {
            const countResp = await fetch(`/api/news?limit=1&brand_profile_id=${state.brandProfile.id}`);
            const countData = await countResp.json();
            if (countData.length === 0) {
                console.log('No articles in DB, auto-fetching news...');
                await fetch('/api/news/fetch', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ brand_profile_id: state.brandProfile.id })
                });
                await renderResearchContent();
            }
        } catch (e) {
            console.log('Auto-fetch skipped:', e);
        }
    }
}

async function renderResearchContent() {
    const grid = document.getElementById('researchGrid');
    const tab = researchState.currentTab;
    
    if (tab === 'feed') {
        try {
            const response = await fetch(`/api/news?limit=30&brand_profile_id=${state.brandProfile?.id || ''}&workspace_id=${getWorkspaceId() || ''}`);
            researchState.articles = await response.json();
            
            if (researchState.articles.length === 0) {
                grid.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">?? No articles yet</p>
                        <p>Click <strong>Fetch News</strong> to pull articles from your configured sources,<br>or <strong>Sources</strong> to set up RSS feeds and interests.</p>
                    </div>`;
                return;
            }
            
            // Build digest + collapsible wire panel
            let html = '';
            
            // Digest section (cached or loading)
            html += `<div id="feedDigestSection" style="grid-column: 1 / -1; margin-bottom: 0.5rem;">
                ${researchState._cachedDigest 
                    ? `<div class="content-card" style="border-left: 3px solid var(--accent);">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                            <span class="tag" style="background: var(--accent); color: #000;">? Wire Digest</span>
                            <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.6rem; margin-left: auto;" onclick="generateFeedDigest()">? Refresh</button>
                        </div>
                        <div class="digest-content">${cleanAIHTML(researchState._cachedDigest)}</div>
                    </div>`
                    : `<button class="btn-primary" style="width: 100%; padding: 0.75rem;" onclick="generateFeedDigest()">? Generate Wire Digest — what's actually worth your time</button>`
                }
            </div>`;
            
            // Group articles by source
            const bySource = {};
            researchState.articles.forEach(a => {
                const src = a.source || 'Unknown';
                if (!bySource[src]) bySource[src] = [];
                bySource[src].push(a);
            });
            
            // Collapsible "On The Wire" panel
            const sourceCount = Object.keys(bySource).length;
            const articleCount = researchState.articles.length;
            html += `<div style="grid-column: 1 / -1;">
                <div class="wire-panel-header" onclick="toggleWirePanel()" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 10px; cursor: pointer; user-select: none; transition: background 0.2s;">
                    <span id="wirePanelArrow" style="transition: transform 0.3s; display: inline-block;">?</span>
                    <span style="font-weight: 600;">?? On The Wire</span>
                    <span style="color: var(--text-tertiary); font-size: 0.85rem;">${articleCount} articles from ${sourceCount} source${sourceCount !== 1 ? 's' : ''}</span>
                </div>
                <div id="wirePanelContent" style="display: none; margin-top: 0.75rem;">`;
            
            // Render each source as a sub-group
            for (const [sourceName, articles] of Object.entries(bySource)) {
                html += `<div style="margin-bottom: 1rem;">
                    <div class="wire-source-header" onclick="toggleWireSource(this)" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; cursor: pointer; color: var(--text-secondary); font-size: 0.85rem; border-bottom: 1px solid var(--glass-border);">
                        <span class="wire-src-arrow" style="transition: transform 0.3s; display: inline-block; font-size: 0.7rem;">?</span>
                        <strong style="color: var(--text-primary);">${sourceName}</strong>
                        <span>${articles.length} article${articles.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="wire-source-articles" style="display: none; padding: 0.5rem 0;">`;
                html += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; padding: 0.5rem;">`;
                articles.forEach(article => {
                    const hasRealUrl = article.url && !article.url.startsWith('ai-research://') && article.url.startsWith('http');
                    html += `<div class="content-card research-article" data-article-id="${article.id}" style="position:relative;">
                        <button class="card-x-delete" onclick="event.stopPropagation(); quickDeleteArticle('${article.id}')" title="Delete">×</button>
                        ${article.image_url ? `<img src="${article.image_url}" alt="" style="width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 0.5rem;" onerror="this.style.display='none'">` : ''}
                        <div class="content-card-title" style="font-size: 0.9rem;">${article.title}</div>
                        <div class="content-card-meta" style="margin: 0.4rem 0;">
                            ${article.published_at ? `<span class="tag">${new Date(article.published_at).toLocaleDateString()}</span>` : ''}
                            ${article.is_pinned ? '<span class="tag" style="background: var(--accent); color: #000;">??</span>' : ''}
                        </div>
                        <div class="content-card-description" style="font-size: 0.8rem;">${(article.summary || '').substring(0, 150)}${(article.summary || '').length > 150 ? '...' : ''}</div>
                        <div style="display: flex; gap: 0.4rem; margin-top: 0.5rem; flex-wrap: wrap;">
                            ${hasRealUrl ? `<a href="${article.url}" target="_blank" class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; text-decoration: none;">?? Read</a>` : ''}
                            <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="event.stopPropagation(); togglePinArticle('${article.id}')">${article.is_pinned ? '?? Unpin' : '?? Pin'}</button>
                            <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="event.stopPropagation(); showConvertOptions('${article.id}', '${article.title.replace(/'/g, "\\'")}')">? Content</button>
                        </div>
                    </div>`;
                });
                html += `</div></div></div>`;
            }
            
            html += `</div></div>`;
            grid.innerHTML = html;
        } catch (error) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">Error loading research</p>';
        }
    } else if (tab === 'search') {
        const sources = researchState.searchSources || [];
        if (sources.length === 0 && !researchState.lastSearchSummary) {
            grid.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-secondary);"><p>Use the search bar to research any topic. AI will search the web and return real sources.</p></div>';
        } else {
            let html = '';
            // AI Summary
            if (researchState.lastSearchSummary) {
                html += `<div class="content-card" style="grid-column: 1 / -1; border-left: 3px solid var(--accent);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                        <span class="tag" style="background: var(--accent); color: #000;">? Research</span>
                        <span class="tag">${researchState.lastSearchQuery || ''}</span>
                        <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.6rem; margin-left: auto;" onclick="doResearchSearch()">? Re-search</button>
                    </div>
                    <div class="content-card-description" style="white-space: pre-wrap; line-height: 1.7; font-size: 0.9rem;">${researchState.lastSearchSummary}</div>
                </div>`;
            }
            // Collapsible Sources panel (grouped by source/domain)
            if (sources.length > 0) {
                const bySource = {};
                sources.forEach(s => {
                    const srcName = s.source || 'Web';
                    if (!bySource[srcName]) bySource[srcName] = [];
                    bySource[srcName].push(s);
                });
                const sourceCount = Object.keys(bySource).length;
                html += `<div style="grid-column: 1 / -1;">
                    <div onclick="toggleSearchSources()" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 10px; cursor: pointer; user-select: none; transition: background 0.2s;">
                        <span id="searchSourcesArrow" style="transition: transform 0.3s; display: inline-block; transform: rotate(90deg);">?</span>
                        <span style="font-weight: 600;">?? Sources</span>
                        <span style="color: var(--text-tertiary); font-size: 0.85rem;">${sources.length} article${sources.length !== 1 ? 's' : ''} from ${sourceCount} source${sourceCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div id="searchSourcesContent" style="margin-top: 0.75rem;">`;
                
                for (const [sourceName, articles] of Object.entries(bySource)) {
                    html += `<div style="margin-bottom: 0.75rem;">
                        <div class="search-source-header" onclick="toggleSearchSource(this)" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; cursor: pointer; color: var(--text-secondary); font-size: 0.85rem; border-bottom: 1px solid var(--glass-border);">
                            <span class="search-src-arrow" style="transition: transform 0.3s; display: inline-block; font-size: 0.7rem; transform: rotate(90deg);">?</span>
                            <strong style="color: var(--text-primary);">${sourceName}</strong>
                            <span>${articles.length} article${articles.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="search-source-articles" style="padding: 0.5rem 0 0.5rem 1rem;">`;
                    articles.forEach(article => {
                        const hasUrl = article.url && article.url.startsWith('http');
                        html += `<div style="padding: 0.6rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                ${hasUrl ? `<a href="${article.url}" target="_blank" rel="noopener" style="color: var(--text-primary); font-size: 0.9rem; font-weight: 500; text-decoration: none; line-height: 1.4;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text-primary)'">${article.title}</a>` 
                                    : `<span style="color: var(--text-primary); font-size: 0.9rem; font-weight: 500;">${article.title}</span>`}
                            </div>
                            ${article.summary ? `<p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0.3rem 0 0; line-height: 1.5;">${article.summary}</p>` : ''}
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.3rem;">
                                ${hasUrl ? `<a href="${article.url}" target="_blank" rel="noopener" style="color: var(--text-tertiary); font-size: 0.7rem; text-decoration: none; opacity: 0.7;">${article.url.length > 60 ? article.url.substring(0, 60) + '...' : article.url}</a>` : ''}
                                ${article.published ? `<span style="color: var(--text-tertiary); font-size: 0.7rem;">${article.published}</span>` : ''}
                            </div>
                        </div>`;
                    });
                    html += `</div></div>`;
                }
                html += `</div></div>`;
            }
            grid.innerHTML = html;
        }
    } else if (tab === 'pinned') {
        try {
            const response = await fetch(`/api/news?pinned=true&brand_profile_id=${state.brandProfile?.id || ''}`);
            researchState.pinnedArticles = await response.json();
            if (researchState.pinnedArticles.length === 0) {
                grid.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-secondary);"><p>?? Pin important articles from the feed to save them here.</p></div>';
            } else {
                renderArticleGrid(researchState.pinnedArticles, grid);
            }
        } catch (error) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">Error loading pinned articles</p>';
        }
    } else if (tab === 'briefs') {
        if (researchState.briefs.length === 0) {
            grid.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-secondary);"><p>? Click <strong>AI Brief</strong> to generate an intelligence brief tailored to your operation.</p></div>';
        } else {
            grid.innerHTML = researchState.briefs.map((brief, i) => `
                <div style="grid-column: 1 / -1; padding: 0.5rem 0;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; color: var(--text-tertiary); font-size: 0.75rem;">
                        <span class="tag">Brief</span>
                        <span>${brief.date}</span>
                    </div>
                    <div class="brief-content">${cleanAIHTML(brief.content)}</div>
                </div>
            `).join('');
        }
    }
}

function renderArticleGrid(articles, grid) {
    grid.innerHTML = articles.map(article => {
        const isAI = !article.url || article.url.startsWith('ai-research://') || article.source === 'AI Research';
        const hasRealUrl = article.url && !article.url.startsWith('ai-research://') && article.url.startsWith('http');
        return `
        <div class="content-card research-article" data-article-id="${article.id}" style="position:relative;">
            <button class="card-x-delete" onclick="event.stopPropagation(); quickDeleteArticle('${article.id}')" title="Delete">×</button>
            ${article.image_url ? `<img src="${article.image_url}" alt="" style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px; margin-bottom: 0.75rem;" onerror="this.style.display='none'">` : ''}
            <div class="content-card-title" style="font-size: 0.95rem;">${article.title}</div>
            <div class="content-card-meta" style="margin: 0.5rem 0;">
                ${isAI ? '<span class="tag" style="background: rgba(139,92,246,0.3); color: #c4b5fd;">?? AI Finding</span>' : ''}
                <span class="tag">${article.source || 'Unknown'}</span>
                ${article.published_at ? `<span class="tag">${new Date(article.published_at).toLocaleDateString()}</span>` : ''}
                ${article.is_pinned ? '<span class="tag" style="background: var(--accent); color: #000;">?? Pinned</span>' : ''}
            </div>
            <div class="content-card-description" style="font-size: 0.85rem;">${(article.summary || '').substring(0, 200)}${(article.summary || '').length > 200 ? '...' : ''}</div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap;">
                ${hasRealUrl ? `<a href="${article.url}" target="_blank" class="btn-ghost" style="font-size: 0.8rem; padding: 0.3rem 0.6rem; text-decoration: none;">?? Read</a>` : ''}
                <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;" onclick="event.stopPropagation(); togglePinArticle('${article.id}')">${article.is_pinned ? '?? Unpin' : '?? Pin'}</button>
                <button class="btn-ghost" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;" onclick="event.stopPropagation(); showConvertOptions('${article.id}', '${article.title.replace(/'/g, "\\'")}')">? To Content</button>
            </div>
        </div>`;
    }).join('');
}

async function doResearchSearch() {
    const input = document.getElementById('researchSearchInput');
    const query = input?.value?.trim();
    if (!query) return;
    
    const grid = document.getElementById('researchGrid');
    grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">?? Searching the web with AI... This may take a moment.</p>';
    
    researchState.currentTab = 'search';
    document.querySelectorAll('.research-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'search'));
    
    try {
        const response = await fetch('/api/research/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query, brand_profile_id: state.brandProfile?.id, workspace_id: getWorkspaceId() })
        });
        
        const data = await response.json();
        researchState.searchResults = data.results || [];
        researchState.searchSources = data.sources || [];
        researchState.lastSearchQuery = query;
        
        // Safety: if ai_summary is raw JSON, parse it and extract fields
        let summary = data.ai_summary || '';
        if (summary.trim().startsWith('{') && summary.includes('"summary"')) {
            try {
                const parsed = JSON.parse(summary.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, ''));
                summary = parsed.summary || summary;
                if (parsed.sources && parsed.sources.length > 0 && researchState.searchSources.length === 0) {
                    researchState.searchSources = parsed.sources;
                }
            } catch(e) { /* leave as-is */ }
        }
        // Format: convert \n\n to paragraph breaks for display
        researchState.lastSearchSummary = summary.replace(/\\n/g, '\n');
        
        // Research sync removed -- Intelligence Hub handles its own research
        
        renderResearchContent();
    } catch (error) {
        console.error('Research search error:', error);
        grid.innerHTML = '<p style="color: var(--text-secondary);">Error searching. Please try again.</p>';
    }
}

function cleanAIHTML(raw) {
    // Strip markdown code fences if the AI wrapped in ```html ... ```
    let html = raw.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
    // Strip any remaining markdown bold/italic that wasn't converted to HTML
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return html;
}

function searchByInterest(interest) {
    document.getElementById('researchSearchInput').value = interest;
    doResearchSearch();
}

async function generateAIBrief() {
    const grid = document.getElementById('researchGrid');
    switchResearchTab('briefs');
    grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">? Generating AI brief from your interests and recent news...</p>';
    
    try {
        const response = await fetch('/api/research/brief', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ brand_profile_id: state.brandProfile?.id, workspace_id: getWorkspaceId() })
        });
        
        const data = await response.json();
        
        if (data.error) {
            grid.innerHTML = `<p style="color: var(--text-secondary); padding: 2rem;">${data.error}</p>`;
            return;
        }
        
        researchState.briefs.unshift({
            content: data.brief,
            date: new Date().toLocaleDateString()
        });
        
        renderResearchContent();
    } catch (error) {
        console.error('AI brief error:', error);
        grid.innerHTML = '<p style="color: var(--text-secondary);">Error generating brief.</p>';
    }
}

async function togglePinArticle(articleId) {
    try {
        const response = await fetch(`/api/news/${articleId}/pin`, { method: 'POST' });
        if (response.ok) {
            // Update local state
            const article = researchState.articles.find(a => a.id === articleId) || 
                           researchState.searchResults.find(a => a.id === articleId);
            if (article) article.is_pinned = !article.is_pinned;
            renderResearchContent();
        }
    } catch (error) {
        console.error('Error toggling pin:', error);
    }
}

async function loadResearchSettings() {
    // Load sources
    try {
        const response = await fetch('/api/news-sources');
        researchState.sources = await response.json();
    } catch (e) {
        researchState.sources = [];
    }
    
    renderResearchSourcesList();
    renderResearchInterestsList();
}

function renderResearchInterestsList() {
    const list = document.getElementById('interestsList');
    if (!list) return;
    
    list.innerHTML = researchState.interests.map((interest, i) => 
        `<span class="tag" style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.3rem 0.8rem;">${interest}<button onclick="event.stopPropagation();removeInterest(${i})" style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;padding:0 0.2rem;opacity:0.7;line-height:1;">?</button></span>`
    ).join('') || '<span style="color: var(--text-tertiary); font-size: 0.85rem;">No interests added yet</span>';
}

function renderResearchSourcesList() {
    const list = document.getElementById('sourcesList');
    if (!list) return;
    
    list.innerHTML = researchState.sources.map(source => `
        <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid var(--glass-border);">
            <label style="display: flex; align-items: center; gap: 0.5rem; flex: 1; cursor: pointer;">
                <input type="checkbox" ${source.is_active ? 'checked' : ''} onchange="toggleSource(${source.id}, this.checked)" style="accent-color: var(--accent);">
                <div>
                    <div style="font-weight: 500;">${source.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">${source.url}</div>
                </div>
            </label>
            ${source.keywords ? `<span class="tag" style="font-size: 0.7rem;">${source.keywords}</span>` : ''}
            <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="deleteSource(${source.id})">?</button>
        </div>
    `).join('') || '<p style="color: var(--text-tertiary); font-size: 0.85rem;">No custom sources yet. Default sources will be used.</p>';
}

async function addInterest() {
    const input = document.getElementById('addInterestInput');
    const interest = input?.value?.trim();
    if (!interest) return;
    
    researchState.interests.push(interest);
    input.value = '';
    
    // Save to brand profile keywords
    const keywords = researchState.interests.join(', ');
    if (state.brandProfile?.id) {
        await fetch(`/api/brand-profiles/${state.brandProfile.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ keywords })
        });
        state.brandProfile.keywords = keywords;
        document.getElementById('brandKeywords').value = keywords;
    }
    
    renderResearchInterestsList();
    renderResearchKeywords();
}

async function removeInterest(index) {
    researchState.interests.splice(index, 1);
    
    const keywords = researchState.interests.join(', ');
    if (state.brandProfile?.id) {
        await fetch(`/api/brand-profiles/${state.brandProfile.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ keywords })
        });
        state.brandProfile.keywords = keywords;
        document.getElementById('brandKeywords').value = keywords;
    }
    
    renderResearchInterestsList();
    renderResearchKeywords();
}

async function addNewsSource() {
    const nameInput = document.getElementById('addSourceName');
    const urlInput = document.getElementById('addSourceUrl');
    const name = nameInput?.value?.trim();
    const url = urlInput?.value?.trim();
    
    if (!name || !url) {
        showNotification('Please enter both name and URL', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/news-sources', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, url, feed_type: 'rss' })
        });
        
        const data = await response.json();
        if (!response.ok) {
            showNotification(data.error || 'Failed to add source', 'error');
            return;
        }
        // Check if source already existed in local state (reactivated on backend)
        const existingIdx = researchState.sources.findIndex(s => s.id === data.id);
        if (existingIdx >= 0) {
            researchState.sources[existingIdx] = data;
            showNotification(`Source "${data.name}" is already added`, 'info');
        } else {
            researchState.sources.push(data);
            showNotification(`Source "${name}" added!`);
        }
        nameInput.value = '';
        urlInput.value = '';
        renderResearchSourcesList();
    } catch (error) {
        console.error('addNewsSource error:', error);
        showNotification('Error adding source', 'error');
    }
}

async function toggleSource(sourceId, active) {
    try {
        const response = await fetch(`/api/news-sources/${sourceId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ is_active: active })
        });
        if (!response.ok) {
            console.error('Toggle source failed:', response.status);
            showNotification('Error toggling source', 'error');
            return;
        }
        // Update local state
        const src = researchState.sources.find(s => String(s.id) === String(sourceId));
        if (src) src.is_active = active;
    } catch (error) {
        console.error('Error toggling source:', error);
        showNotification('Error toggling source', 'error');
    }
}

async function deleteSource(sourceId) {
    try {
        await fetch(`/api/news-sources/${sourceId}`, { method: 'DELETE' });
        researchState.sources = researchState.sources.filter(s => String(s.id) !== String(sourceId));
        renderResearchSourcesList();
        showNotification('Source removed');
    } catch (error) {
        console.error('Error deleting source:', error);
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
            const optionsContainer = document.getElementById('aiModelOptions');
            if (optionsContainer) {
                optionsContainer.innerHTML = Object.entries(settings.available_models).map(([id, info]) => {
                    return `<div class="select-option ${id === state.aiModel ? 'selected' : ''}" data-value="${id}">${info.name}</div>`;
                }).join('');
                
                // Set trigger text
                const trigger = document.getElementById('aiModelTrigger');
                if (trigger && settings.available_models[state.aiModel]) {
                    trigger.querySelector('span:first-child').textContent = settings.available_models[state.aiModel].name;
                }
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function loadBrandProfile() {
    try {
        console.log('[Workbench] loadBrandProfile: fetching...');
        const response = await fetch('/api/brand-profiles');
        if (!response.ok) { console.error('[Workbench] brand-profiles fetch failed:', response.status); return; }
        const profiles = await response.json();
        console.log('[Workbench] loadBrandProfile: got', profiles.length, 'profiles');
        
        // Use workspace's brand profile if set, otherwise fall back to first
        const wsBrandId = state.activeWorkspace?.brand_profile_id;
        const profile = wsBrandId ? profiles.find(p => p.id === wsBrandId) : profiles[0];
        console.log('[Workbench] loadBrandProfile: selected:', profile?.name || 'NONE');
        
        if (profile) {
            state.brandProfile = profile;
            console.log('[Workbench] Loaded brand profile:', state.brandProfile.name);
            
            const brandName = document.getElementById('brandName');
            const brandIndustry = document.getElementById('brandIndustry');
            const brandDescription = document.getElementById('brandDescription');
            const brandTargetAudience = document.getElementById('brandTargetAudience');
            const brandKeywords = document.getElementById('brandKeywords');
            const statusEl = document.getElementById('brandProfileStatus');
            
            if (brandName) brandName.value = state.brandProfile.name || '';
            if (brandIndustry) brandIndustry.value = state.brandProfile.industry || '';
            if (brandDescription) brandDescription.value = state.brandProfile.description || '';
            if (brandTargetAudience) brandTargetAudience.value = state.brandProfile.target_audience || '';
            if (brandKeywords) brandKeywords.value = state.brandProfile.keywords || '';
            if (statusEl) statusEl.textContent = `? Profile loaded: ${state.brandProfile.name}`;
        }
    } catch (error) {
        console.error('Error loading brand profile:', error);
    }
}

async function saveBrandProfile() {
    const name = document.getElementById('brandName')?.value?.trim();
    const industry = document.getElementById('brandIndustry')?.value?.trim();
    const description = document.getElementById('brandDescription')?.value?.trim();
    const target_audience = document.getElementById('brandTargetAudience')?.value?.trim();
    const keywords = document.getElementById('brandKeywords')?.value?.trim();
    
    if (!name) {
        showNotification('Brand name is required', 'error');
        return;
    }
    
    const statusEl = document.getElementById('brandProfileStatus');
    if (statusEl) statusEl.textContent = 'Saving...';
    
    try {
        let response;
        if (state.brandProfile?.id) {
            // Update existing
            response = await fetch(`/api/brand-profiles/${state.brandProfile.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, industry, description, target_audience, keywords })
            });
        } else {
            // Create new
            response = await fetch('/api/brand-profiles', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, industry, description, target_audience, keywords })
            });
        }
        
        const profile = await response.json();
        if (profile.error) {
            throw new Error(profile.error);
        }
        
        state.brandProfile = profile;
        console.log('Brand profile saved:', state.brandProfile);
        
        // Link this brand profile to the active workspace if not already linked
        if (state.activeWorkspace && state.activeWorkspace.brand_profile_id !== profile.id) {
            await fetch(`/api/workspaces/${state.activeWorkspace.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ brand_profile_id: profile.id })
            });
            state.activeWorkspace.brand_profile_id = profile.id;
        }
        
        if (statusEl) statusEl.textContent = `? Profile saved: ${state.brandProfile.name}`;
        showNotification('Brand profile saved!');
        
        // Reload media items now that we have a brand profile
        await loadMediaItems();
        await loadMoodBoard();
        renderAll();
    } catch (error) {
        console.error('Error saving brand profile:', error);
        if (statusEl) statusEl.textContent = 'Error saving profile';
        showNotification('Error saving brand profile', 'error');
    }
}

async function loadMediaItems() {
    try {
        if (!state.brandProfile) return;
        
        const wsParam = getWorkspaceId() ? `&workspace_id=${getWorkspaceId()}` : '';
        const response = await fetch(`/api/media-items?brand_profile_id=${state.brandProfile.id}${wsParam}`);
        state.mediaItems = await response.json();
    } catch (error) {
        console.error('Error loading media items:', error);
    }
}

// ========== MODALS ==========
function initModals() {
    // Close buttons
    const closeModalBtn = document.getElementById('closeModalBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => closeModal('contentModal'));
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => closeModal('settingsModal'));
    
    // Overlay clicks
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.parentElement.id);
            }
        });
    });
    
    // Buttons
    const newContentBtn = document.getElementById('newContentBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const saveContentBtn = document.getElementById('saveContentBtn');
    const deleteContentBtn = document.getElementById('deleteContentBtn');
    const refreshResearchBtn = document.getElementById('refreshResearchBtn');
    
    if (newContentBtn) newContentBtn.addEventListener('click', () => openContentModal());
    if (settingsBtn) settingsBtn.addEventListener('click', () => openModal('settingsModal'));
    if (saveContentBtn) saveContentBtn.addEventListener('click', saveContent);
    if (deleteContentBtn) deleteContentBtn.addEventListener('click', deleteContent);
    
    // Initialize brainstorming section
    setTimeout(() => renderBrainstormSection(), 500);
    
    // Toggle pill mode is handled by toggleBrainstormMode()
    
    // Card chat Enter key
    const cardChatInput = document.getElementById('cardChatInput');
    if (cardChatInput) cardChatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendCardChat(); });
    
    const saveBrandProfileBtn = document.getElementById('saveBrandProfileBtn');
    if (saveBrandProfileBtn) saveBrandProfileBtn.addEventListener('click', saveBrandProfile);
    if (refreshResearchBtn) refreshResearchBtn.addEventListener('click', refreshResearch);
    
    // Custom select handlers
    const aiModelSelect = document.querySelector('#aiModelTrigger')?.closest('.custom-select');
    if (aiModelSelect) {
        aiModelSelect.addEventListener('selectchange', async (e) => {
            await fetch('/api/settings', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ai_model: e.detail.value})
            });
            state.aiModel = e.detail.value;
            showNotification('AI model updated');
        });
    }
    
    const contentStatusSelect = document.querySelector('#contentStatusTrigger')?.closest('.custom-select');
    if (contentStatusSelect) {
        contentStatusSelect.addEventListener('selectchange', updateProgress);
    }
    
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
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function openContentModal(itemId = null, presetStatus = null) {
    if (itemId) {
        const item = state.mediaItems.find(i => i.id === itemId);
        if (item) {
            state.selectedItem = item;
            document.getElementById('modalTitle').textContent = 'Edit Project';
            document.getElementById('contentTitle').value = item.title || '';
            
            // Set content type
            const contentTypeTrigger = document.getElementById('contentTypeTrigger');
            if (contentTypeTrigger) {
                contentTypeTrigger.querySelector('span:first-child').textContent = item.content_type || 'Image';
            }
            
            const contentChannelTrigger = document.getElementById('contentChannelTrigger');
            if (contentChannelTrigger) {
                contentChannelTrigger.querySelector('span:first-child').textContent = (item.channel && item.channel !== 'social') ? item.channel.charAt(0).toUpperCase() + item.channel.slice(1) : 'None';
            }
            
            document.getElementById('contentDescription').value = item.description || '';
            document.getElementById('contentCaption').value = item.caption || '';
            
            // Set publish date
            if (item.scheduled_date) {
                const date = new Date(item.scheduled_date);
                document.getElementById('publishDate').value = date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                });
                document.getElementById('publishDate').dataset.value = item.scheduled_date;
            }
            
            // Set status
            const statusTrigger = document.getElementById('contentStatusTrigger');
            if (statusTrigger) {
                const statusMap = {
                    'not_started': '?? Not Started',
                    'in_progress': '?? In Progress',
                    'done': '? Done'
                };
                statusTrigger.querySelector('span:first-child').textContent = statusMap[item.status] || '?? Not Started';
            }
            
            updateProgress();
        }
    } else {
        state.selectedItem = null;
        document.getElementById('modalTitle').textContent = 'New Project';
        document.getElementById('contentTitle').value = '';
        document.getElementById('contentDescription').value = '';
        document.getElementById('contentCaption').value = '';
        document.getElementById('publishDate').value = '';
        
        // Reset type and channel dropdowns
        const contentTypeTrigger = document.getElementById('contentTypeTrigger');
        if (contentTypeTrigger) contentTypeTrigger.querySelector('span:first-child').textContent = 'Image';
        const contentChannelTrigger = document.getElementById('contentChannelTrigger');
        if (contentChannelTrigger) contentChannelTrigger.querySelector('span:first-child').textContent = 'None';
        
        // Pre-set status if specified (from + button on a column)
        const statusTrigger = document.getElementById('contentStatusTrigger');
        if (statusTrigger && presetStatus) {
            const statusMap = {
                'not_started': '?? Not Started',
                'in_progress': '?? In Progress',
                'done': '? Done'
            };
            statusTrigger.querySelector('span:first-child').textContent = statusMap[presetStatus] || '?? Not Started';
        }
        
        updateProgress();
    }
    
    openModal('contentModal');
}

function openDayModal(dateStr) {
    const date = new Date(dateStr + 'T12:00');
    document.getElementById('publishDate').value = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    document.getElementById('publishDate').dataset.value = dateStr + 'T12:00';
    openContentModal();
}

function updateProgress() {
    // Simplified - no progress bar needed with new 3-stage system
    // Status is just a simple dropdown now
}

async function saveContent() {
    const contentTypeTrigger = document.getElementById('contentTypeTrigger');
    const statusTrigger = document.getElementById('contentStatusTrigger');
    
    const statusMap = {
        '? Not Started': 'not_started',
        '?? In Progress': 'in_progress',
        '? Done': 'done'
    };
    
    const data = {
        title: document.getElementById('contentTitle').value,
        content_type: contentTypeTrigger ? contentTypeTrigger.querySelector('span:first-child').textContent : 'Image',
        description: document.getElementById('contentDescription').value,
        caption: document.getElementById('contentCaption').value,
        scheduled_date: document.getElementById('publishDate').dataset.value || null,
        status: statusMap[statusTrigger.querySelector('span:first-child').textContent] || 'not_started',
        channel: (document.getElementById('contentChannelTrigger')?.querySelector('span:first-child')?.textContent || 'none').toLowerCase(),
        media_plan_id: state.brandProfile?.id,
        workspace_id: getWorkspaceId()
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
            const response = await fetch('/api/media-items', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                showNotification('Content created');
            } else {
                const error = await response.text();
                console.error('Error creating content:', error);
                console.error('Non-200 response but item likely saved');
            }
        }
        
        closeModal('contentModal');
        try { await loadMediaItems(); renderAll(); } catch(e) { /* silent refresh */ }
    } catch (error) {
        console.error('Error saving content:', error);
        // Item saves successfully - suppressed false error notification
    }
}

async function deleteContent() {
    if (!state.selectedItem) return;
    if (!confirm('Delete this content?')) return;
    
    try {
        await fetch(`/api/media-items/${state.selectedItem.id}`, {method: 'DELETE'});
        closeModal('contentModal');
        try { await loadMediaItems(); renderAll(); } catch(e) { /* silent refresh */ }
        showNotification('Content deleted');
    } catch (error) {
        showNotification('Error deleting content', 'error');
    }
}

// ========== AI FEATURES ==========
function initAIPanel() {
    const panel = document.getElementById('aiPanel');
    const aiAssistBtn = document.getElementById('aiAssistBtn');
    const closeAiBtn = document.getElementById('closeAiBtn');
    const minBtn = document.getElementById('aiPanelMinBtn');
    const sendAiBtn = document.getElementById('sendAiBtn');
    const aiInput = document.getElementById('aiInput');
    const dragHandle = document.getElementById('aiPanelDragHandle');
    const resizeHandle = document.getElementById('aiPanelResize');
    
    if (aiAssistBtn) {
        aiAssistBtn.addEventListener('click', () => {
            panel.classList.toggle('active');
            panel.classList.remove('minimized');
        });
    }
    
    if (closeAiBtn) closeAiBtn.addEventListener('click', () => panel.classList.remove('active'));
    if (minBtn) minBtn.addEventListener('click', () => panel.classList.toggle('minimized'));
    
    if (sendAiBtn) sendAiBtn.addEventListener('click', sendAIMessage);
    if (aiInput) aiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendAIMessage(); });
    
    // Dragging
    if (dragHandle && panel) {
        let isDragging = false, startX, startY, startLeft, startTop;
        
        dragHandle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.ai-float-btn')) return;
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            panel.style.transition = 'none';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                panel.style.transition = '';
            }
        });
    }
    
    // Resizing from top-left corner
    if (resizeHandle && panel) {
        let isResizing = false, startX, startY, startW, startH, startL, startT;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            const rect = panel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startW = rect.width;
            startH = rect.height;
            startL = rect.left;
            startT = rect.top;
            panel.style.transition = 'none';
            e.preventDefault();
            e.stopPropagation();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newW = Math.max(300, startW - dx);
            const newH = Math.max(250, startH - dy);
            panel.style.width = newW + 'px';
            panel.style.height = newH + 'px';
            panel.style.left = (startL + (startW - newW)) + 'px';
            panel.style.top = (startT + (startH - newH)) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                panel.style.transition = '';
            }
        });
    }
}

async function sendAIMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    if (!message) return;
    
    addAIMessage(message, 'user');
    input.value = '';
    
    const loadingMsg = addAIMessage('Thinking...', 'assistant');
    
    try {
        // Add context about brand, mood board, research, and existing media items
        const moodContext = localStorage.getItem('moodBoardContext') || '';
        
        // Include existing media items data for AI to reference
        const itemsSummary = state.mediaItems.map(item => ({
            title: item.title,
            content_type: item.content_type,
            description: item.description,
            status: item.status,
            has_shotlist: !!item.planning_data?.shotlist,
            has_storyboard: !!item.planning_data?.storyboard
        }));
        
        // Include recent research/pinned articles for grounded context
        const researchContext = researchState.articles.slice(0, 5).map(a => `[${a.source}] ${a.title}`).join('; ');
        const pinnedContext = researchState.pinnedArticles.slice(0, 3).map(a => `[${a.source}] ${a.title}`).join('; ');
        const briefContext = researchState.briefs.length > 0 ? researchState.briefs[0].content.substring(0, 500) : '';
        
        const enhancedMessage = `${message}\n\nContext:\n- Brand: ${state.brandProfile?.name || 'Not set'}\n- Industry: ${state.brandProfile?.industry || 'Not set'}\n- Keywords: ${state.brandProfile?.keywords || 'None'}\n- Mood Board: ${moodContext}\n- Current content items: ${JSON.stringify(itemsSummary)}\n- Recent research: ${researchContext || 'None'}\n- Pinned articles: ${pinnedContext || 'None'}\n- Latest AI brief: ${briefContext || 'None'}`;
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: enhancedMessage,
                action_mode: true,
                brand_profile_id: state.brandProfile?.id,
                workspace_id: getWorkspaceId()
            })
        });
        
        const data = await response.json();
        loadingMsg.remove();
        
        if (data.error) {
            addAIMessage(`Error: ${data.error}`, 'assistant');
        } else {
            addAIMessage(data.response, 'assistant');
            
            // Check if AI wants to create or update content items
            if (data.actions && data.actions.length > 0) {
                await executeAIActions(data.actions);
            }
        }
    } catch (error) {
        loadingMsg.remove();
        addAIMessage('Sorry, I encountered an error.', 'assistant');
        console.error('Chat error:', error);
    }
}

async function executeAIActions(actions) {
    for (const action of actions) {
        if (action.type === 'create_content') {
            showNotification('Creating project items...', 'info');
            
            // Ensure we have a media plan (create one if needed)
            let mediaPlanId = state.brandProfile?.id;
            if (!mediaPlanId) {
                showNotification('Please set up your brand profile first', 'error');
                return;
            }
            
            let createdCount = 0;
            for (const item of action.items) {
                try {
                    const response = await fetch('/api/media-items', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            title: item.title,
                            content_type: item.content_type || 'Other',
                            description: item.description || '',
                            caption: item.caption || '',
                            scheduled_date: item.scheduled_date,
                            status: item.status || 'not_started',
                            channel: item.channel || 'none',
                            media_plan_id: mediaPlanId,
                            workspace_id: getWorkspaceId(),
                            shot_list: item.shot_list || '',
                            storyboard: item.storyboard || '',
                            tags: item.tags || ''
                        })
                    });
                    
                    if (response.ok) {
                        createdCount++;
                    } else {
                        console.error('Failed to create item:', await response.text());
                    }
                } catch (error) {
                    console.error('Error creating item:', error);
                }
            }
            
            if (createdCount > 0) {
                await loadMediaItems();
                renderAll();
                showNotification(`Created ${createdCount} project items!`);
                
                // Scroll to timeline to show the new items
                const timeline = document.getElementById('timelineModule');
                if (timeline) {
                    timeline.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                showNotification('Failed to create project items', 'error');
            }
        } else if (action.type === 'update_planning') {
            // Update existing content item with planning data
            showNotification('Updating content with planning details...', 'info');
            
            // Find the item by title
            const item = state.mediaItems.find(i => 
                i.title.toLowerCase() === action.item_title.toLowerCase()
            );
            
            if (!item) {
                showNotification(`Could not find item: ${action.item_title}`, 'error');
                continue;
            }
            
            try {
                const response = await fetch(`/api/media-items/${item.id}/planning`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        tool: action.planning_type,
                        data: action.content
                    })
                });
                
                if (response.ok) {
                    await loadMediaItems();
                    renderAll();
                    showNotification(`Updated ${action.planning_type} for "${item.title}"`);
                } else {
                    console.error('Failed to update planning:', await response.text());
                    showNotification('Failed to update planning data', 'error');
                }
            } catch (error) {
                console.error('Error updating planning:', error);
                showNotification('Error updating planning data', 'error');
            }
        } else if (action.type === 'delete_content') {
            const titles = action.item_titles || [];
            let deleted = 0;
            for (const title of titles) {
                const item = state.mediaItems.find(i => i.title.toLowerCase() === title.toLowerCase());
                if (item) {
                    try {
                        await fetch(`/api/media-items/${item.id}`, { method: 'DELETE' });
                        state.mediaItems = state.mediaItems.filter(i => i.id !== item.id);
                        deleted++;
                    } catch (e) { console.error(e); }
                }
            }
            if (deleted > 0) {
                renderAll();
                showNotification(`Deleted ${deleted} item${deleted > 1 ? 's' : ''}`);
            }
        } else if (action.type === 'move_content') {
            const titles = action.item_titles || [];
            const newStatus = action.new_status;
            let moved = 0;
            for (const title of titles) {
                const item = state.mediaItems.find(i => i.title.toLowerCase() === title.toLowerCase());
                if (item && newStatus) {
                    try {
                        await fetch(`/api/media-items/${item.id}`, {
                            method: 'PUT',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ status: newStatus })
                        });
                        item.status = newStatus;
                        moved++;
                    } catch (e) { console.error(e); }
                }
            }
            if (moved > 0) {
                renderAll();
                showNotification(`Moved ${moved} item${moved > 1 ? 's' : ''} to ${newStatus.replace('_', ' ')}`);
            }
        } else if (action.type === 'research') {
            const query = action.query;
            if (query) {
                document.getElementById('researchSearchInput').value = query;
                await doResearchSearch();
                addAIMessage(`?? Researched "${query}" — check the Research tab for results.`, 'assistant');
            }
        } else if (action.type === 'research_brief') {
            await generateAIBrief();
            addAIMessage('?? Generated an AI brief — check the AI Briefs tab in Research.', 'assistant');
        }
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

async function sendCardChat() {
    const input = document.getElementById('cardChatInput');
    const messagesDiv = document.getElementById('cardChatMessages');
    const message = input?.value?.trim();
    if (!message || !state.selectedItem) return;
    
    // Clear placeholder
    const placeholder = messagesDiv.querySelector('p');
    if (placeholder) placeholder.remove();
    
    // Show user message
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-message user';
    userMsg.style.cssText = 'font-size:0.8rem;padding:0.5rem 0.75rem;max-width:85%;';
    userMsg.textContent = message;
    messagesDiv.appendChild(userMsg);
    input.value = '';
    
    // Show loading
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ai-message assistant';
    loadingMsg.style.cssText = 'font-size:0.8rem;padding:0.5rem 0.75rem;';
    loadingMsg.textContent = 'Thinking...';
    messagesDiv.appendChild(loadingMsg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    try {
        const item = state.selectedItem;
        const cardContext = `You are editing a specific content card. Apply changes directly via ACTION_JSON.
        
Card details:
- Title: ${item.title}
- Type: ${item.content_type}
- Description: ${item.description || 'None'}
- Caption: ${item.caption || 'None'}
- Has shot list: ${!!item.planning_data?.shotlist}
- Has storyboard: ${!!item.planning_data?.storyboard}

User request about this card: ${message}`;

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: cardContext,
                action_mode: true,
                brand_profile_id: state.brandProfile?.id
            })
        });
        
        const data = await response.json();
        loadingMsg.remove();
        
        const replyMsg = document.createElement('div');
        replyMsg.className = 'ai-message assistant';
        replyMsg.style.cssText = 'font-size:0.8rem;padding:0.5rem 0.75rem;max-width:85%;line-height:1.4;';
        replyMsg.textContent = data.response || data.error || 'No response';
        messagesDiv.appendChild(replyMsg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        if (data.actions && data.actions.length > 0) {
            await executeAIActions(data.actions);
            // Refresh modal with updated data
            if (state.selectedItem) {
                const updated = state.mediaItems.find(i => i.id === state.selectedItem.id);
                if (updated) openContentModal(updated.id);
            }
        }
    } catch (error) {
        loadingMsg.remove();
        const errMsg = document.createElement('div');
        errMsg.className = 'ai-message assistant';
        errMsg.style.cssText = 'font-size:0.8rem;padding:0.5rem 0.75rem;color:#f87171;';
        errMsg.textContent = 'Error communicating with AI';
        messagesDiv.appendChild(errMsg);
    }
}

// ========== BRAINSTORMING ==========
let brainstormIdeas = [];

function renderBrainstormSection() {
    const listEl = document.getElementById('brainstormIdeasList');
    if (!listEl) return;

    if (brainstormIdeas.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = `
        <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.35rem 0.65rem;" onclick="confirmAllBrainstormIdeas()">? Add All</button>
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.35rem 0.65rem;color:#f87171;" onclick="brainstormIdeas=[];renderBrainstormSection();">Clear</button>
        </div>
    ` + brainstormIdeas.map((idea, idx) => `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.6rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:0.4rem;">
            <div style="flex:1;">
                <div style="font-weight:500;color:#f1f5f9;margin-bottom:0.2rem;font-size:0.85rem;">${idea.title}</div>
                <div style="font-size:0.78rem;color:#94a3b8;">${idea.description || ''}</div>
                <div style="font-size:0.7rem;color:#64748b;margin-top:0.2rem;">${idea.content_type || 'Other'}</div>
            </div>
            <button class="btn-ghost" style="font-size:0.75rem;padding:0.2rem 0.45rem;color:var(--accent);white-space:nowrap;" onclick="confirmBrainstormIdea(${idx})">+ Add</button>
            <button class="btn-ghost" style="font-size:0.75rem;padding:0.2rem 0.45rem;color:#f87171;white-space:nowrap;" onclick="dismissBrainstormIdea(${idx})">?</button>
        </div>
    `).join('');
}

async function brainstormGenerate() {
    if (!state.brandProfile) {
        showNotification('Please set up your brand profile first', 'error');
        openModal('settingsModal');
        return;
    }

    showNotification('Generating project ideas...', 'info');
    const listEl = document.getElementById('brainstormIdeasList');
    if (listEl) listEl.innerHTML = '<p style="text-align:center;padding:1rem;color:var(--text-secondary);">? Thinking...</p>';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: `Generate 7 creative project ideas for ${state.brandProfile.name} in the ${state.brandProfile.industry} industry. For each idea provide: title, content_type (one of: Image, Video, Audio, Other), description (1-2 sentences). Format as a JSON array with fields: title, content_type, description.`
            })
        });

        const data = await response.json();
        if (data.response) {
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                brainstormIdeas = JSON.parse(jsonMatch[0]);
                showNotification(`Generated ${brainstormIdeas.length} ideas — review and add the ones you like`);
            } else {
                showNotification('Could not parse AI response', 'error');
            }
        }
    } catch (error) {
        showNotification('Error generating ideas', 'error');
    }
    renderBrainstormSection();
}

async function brainstormChat() {
    const input = document.getElementById('brainstormChatInput');
    if (!input || !input.value.trim()) return;
    const msg = input.value.trim();
    input.value = '';

    const log = document.getElementById('brainstormChatLog');
    const thinkingEl = document.getElementById('brainstormThinking');
    const pill = document.getElementById('brainstormTogglePill');
    const activeOpt = pill ? pill.querySelector('.toggle-pill-option.active') : null;
    const isOneShot = activeOpt && activeOpt.dataset.mode === 'oneshot';

    // Show chat log in chat mode
    if (!isOneShot && log) {
        log.style.display = 'block';
        log.innerHTML += `<div style="padding:0.3rem 0;color:#e2e8f0;font-size:0.83rem;"><strong>You:</strong> ${msg}</div>`;
    }

    // Show thinking indicator
    if (thinkingEl) thinkingEl.style.display = 'block';

    const brandCtx = state.brandProfile ? ` for ${state.brandProfile.name} (${state.brandProfile.industry})` : '';
    const systemPrompt = isOneShot
        ? `Generate creative project ideas${brandCtx} based on: "${msg}". For each idea provide: title, content_type (Image/Video/Audio/Other), description (1-2 sentences). Format as a JSON array with fields: title, content_type, description.`
        : `The user is brainstorming project ideas${brandCtx}. They said: "${msg}". Respond helpfully. If you suggest specific ideas, also output them as a JSON array with fields: title, content_type (Image/Video/Audio/Other), description. Put the JSON at the end of your response.`;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: systemPrompt })
        });
        const data = await response.json();
        if (data.response) {
            let text = data.response;
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                text = text.replace(jsonMatch[0], '').trim();
                try {
                    const newIdeas = JSON.parse(jsonMatch[0]);
                    brainstormIdeas.push(...newIdeas);
                } catch(e) {}
            }
            // Show agent reply in chat mode
            if (!isOneShot && log && text) {
                log.innerHTML += `<div style="padding:0.3rem 0;color:#94a3b8;font-size:0.83rem;"><strong>Agent:</strong> ${text}</div>`;
                log.scrollTop = log.scrollHeight;
            }
            renderBrainstormSection();
            if (brainstormIdeas.length > 0) {
                showNotification(`${brainstormIdeas.length} idea${brainstormIdeas.length > 1 ? 's' : ''} ready to review`);
            }
        }
    } catch (error) {
        if (log) {
            log.style.display = 'block';
            log.innerHTML += `<div style="padding:0.3rem 0;color:#f87171;font-size:0.83rem;">Error communicating with agent</div>`;
        }
    } finally {
        if (thinkingEl) thinkingEl.style.display = 'none';
    }
}

function toggleBrainstormMode() {
    const pill = document.getElementById('brainstormTogglePill');
    if (!pill) return;
    const options = pill.querySelectorAll('.toggle-pill-option');
    options.forEach(opt => opt.classList.toggle('active'));
}

async function confirmBrainstormIdea(idx) {
    const idea = brainstormIdeas[idx];
    if (!idea) return;
    try {
        const date = new Date();
        await fetch('/api/media-items', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                title: idea.title,
                content_type: idea.content_type || 'Other',
                description: idea.description || '',
                caption: idea.caption || '',
                status: 'not_started',
                channel: 'none',
                scheduled_date: date.toISOString(),
                media_plan_id: state.brandProfile?.id,
                workspace_id: getWorkspaceId()
            })
        });
        brainstormIdeas.splice(idx, 1);
        await loadMediaItems();
        renderAll();
        renderBrainstormSection();
        showNotification(`Added "${idea.title}" to your project board`);
    } catch (e) {
        showNotification('Error adding project', 'error');
    }
}

function dismissBrainstormIdea(idx) {
    brainstormIdeas.splice(idx, 1);
    renderBrainstormSection();
}

async function confirmAllBrainstormIdeas() {
    let added = 0;
    for (let i = brainstormIdeas.length - 1; i >= 0; i--) {
        const idea = brainstormIdeas[i];
        try {
            const date = new Date();
            date.setDate(date.getDate() + i);
            await fetch('/api/media-items', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    title: idea.title,
                    content_type: idea.content_type || 'Other',
                    description: idea.description || '',
                    caption: idea.caption || '',
                    status: 'not_started',
                    channel: 'none',
                    scheduled_date: date.toISOString(),
                    media_plan_id: state.brandProfile?.id,
                    workspace_id: getWorkspaceId()
                })
            });
            added++;
        } catch(e) {}
    }
    brainstormIdeas = [];
    await loadMediaItems();
    renderAll();
    renderBrainstormSection();
    showNotification(`Added ${added} projects to your board`);
}

function showConvertOptions(articleId, articleTitle) {
    // Remove any existing popup
    document.getElementById('convertPopup')?.remove();
    
    const popup = document.createElement('div');
    popup.id = 'convertPopup';
    popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    const selectStyle = 'width:100%;padding:0.6rem 0.75rem;background:#1a1a2e;color:#e2e8f0;border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:0.9rem;font-family:inherit;appearance:none;-webkit-appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' fill=\'%23888\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M8 11L3 6h10z\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 0.75rem center;';
    popup.innerHTML = `
        <style>
            #convertPopup select option { background: #1a1a2e; color: #e2e8f0; padding: 0.4rem; }
            #convertPopup select:focus { outline: none; border-color: var(--accent, #4ade80); box-shadow: 0 0 0 3px rgba(74,222,128,0.15); }
        </style>
        <div style="background: #12121f; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 1.75rem; max-width: 420px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
            <h3 style="margin-bottom: 0.25rem; color: #f1f5f9;">Create Project From Research</h3>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.25rem; line-height: 1.4;">${articleTitle}</p>
            
            <label style="font-size: 0.8rem; color: #94a3b8; display: block; margin-bottom: 0.4rem; font-weight: 500;">Type</label>
            <select id="convertContentType" style="${selectStyle} margin-bottom: 1rem;">
                <option value="Image">Image</option>
                <option value="Video" selected>Video</option>
                <option value="Audio">Audio</option>
                <option value="Other">Other</option>
            </select>
            
            <label style="font-size: 0.8rem; color: #94a3b8; display: block; margin-bottom: 0.4rem; font-weight: 500;">How many ideas?</label>
            <select id="convertCount" style="${selectStyle} margin-bottom: 1.25rem;">
                <option value="1">1 idea</option>
                <option value="3" selected>3 ideas</option>
                <option value="5">5 ideas</option>
            </select>
            
            <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                <button class="btn-ghost" onclick="document.getElementById('convertPopup').remove()">Cancel</button>
                <button class="btn-primary" onclick="convertArticleToContent('${articleId}')">? Generate</button>
            </div>
        </div>
    `;
    popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
    document.body.appendChild(popup);
}

async function convertArticleToContent(articleId) {
    const contentType = document.getElementById('convertContentType')?.value || 'Video';
    const count = parseInt(document.getElementById('convertCount')?.value || '3');
    
    document.getElementById('convertPopup')?.remove();
    showNotification(`Generating ${count} ${contentType} idea${count > 1 ? 's' : ''}...`, 'info');
    
    try {
        const response = await fetch('/api/research/convert', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                article_id: articleId,
                brand_profile_id: state.brandProfile?.id,
                workspace_id: getWorkspaceId(),
                content_type: contentType,
                count: count
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showNotification(data.error, 'error');
        } else {
            await loadMediaItems();
            renderAll();
            showNotification(`Created ${data.length} content idea${data.length > 1 ? 's' : ''}!`);
        }
    } catch (error) {
        showNotification('Error converting article', 'error');
    }
}

function toggleWirePanel() {
    const content = document.getElementById('wirePanelContent');
    const arrow = document.getElementById('wirePanelArrow');
    if (!content) return;
    const isOpen = content.style.display !== 'none';
    content.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function toggleWireSource(headerEl) {
    const articlesDiv = headerEl.nextElementSibling;
    const arrow = headerEl.querySelector('.wire-src-arrow');
    if (!articlesDiv) return;
    const isOpen = articlesDiv.style.display !== 'none';
    articlesDiv.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function toggleSearchSources() {
    const content = document.getElementById('searchSourcesContent');
    const arrow = document.getElementById('searchSourcesArrow');
    if (!content) return;
    const isOpen = content.style.display !== 'none';
    content.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function toggleSearchSource(headerEl) {
    const articlesDiv = headerEl.nextElementSibling;
    const arrow = headerEl.querySelector('.search-src-arrow');
    if (!articlesDiv) return;
    const isOpen = articlesDiv.style.display !== 'none';
    articlesDiv.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

async function generateFeedDigest() {
    const section = document.getElementById('feedDigestSection');
    if (section) {
        section.innerHTML = `<div class="content-card" style="border-left: 3px solid var(--accent); text-align: center; padding: 1.5rem;">
            <span style="color: var(--text-secondary);">? Scanning the wire...</span>
        </div>`;
    }
    
    try {
        const response = await fetch('/api/news/digest', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ brand_profile_id: state.brandProfile?.id, workspace_id: getWorkspaceId() })
        });
        const data = await response.json();
        
        if (data.error) {
            showNotification(data.error, 'error');
            return;
        }
        
        researchState._cachedDigest = data.digest;
        
        if (section) {
            section.innerHTML = `<div class="content-card" style="border-left: 3px solid var(--accent);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                    <span class="tag" style="background: var(--accent); color: #000;">? Wire Digest</span>
                    <button class="btn-ghost" style="font-size: 0.75rem; padding: 0.2rem 0.6rem; margin-left: auto;" onclick="generateFeedDigest()">? Refresh</button>
                </div>
                <div class="digest-content">${cleanAIHTML(data.digest)}</div>
            </div>`;
        }
    } catch (error) {
        console.error('Digest error:', error);
        showNotification('Error generating digest', 'error');
    }
}

async function refreshResearch() {
    showNotification('Fetching latest news from your sources...', 'info');
    researchState._cachedDigest = '';  // Clear digest so it regenerates with fresh articles
    
    try {
        const response = await fetch('/api/news/fetch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ brand_profile_id: state.brandProfile?.id, workspace_id: getWorkspaceId() })
        });
        const result = await response.json();
        
        if (result.message) {
            showNotification(result.message, 'error');
            return;
        }
        
        switchResearchTab('feed');
        await renderResearch();
        showNotification(`Fetched ${result.count || 0} articles!`);
    } catch (error) {
        console.error('Fetch news error:', error);
        showNotification('Error fetching news', 'error');
    }
}

// ========== EDITABLE LABELS & TITLES ==========
// Map module data-key (h2 title) ? nav module ID (sidebar label)
const _titleToNav = {
    kanbanTitle: 'kanbanModule',
    timelineTitle: 'timelineModule',
    contentTitle2: 'contentModule',
    researchTitle: 'researchModule',
    moodBoardTitle: 'moodBoardModule',
    plannerTitle: 'dayPlannerModule',
    assetsTitle: 'assetsModule'
};
const _navToTitle = Object.fromEntries(Object.entries(_titleToNav).map(([k,v]) => [v, k]));

function _syncTitleAndNav(storageKey, newText) {
    // If a module title changed, update the corresponding nav label
    if (_titleToNav[storageKey]) {
        const navItem = document.querySelector(`.nav-item[data-module="${_titleToNav[storageKey]}"] .nav-label`);
        if (navItem) {
            // Strip leading emoji from title for nav (nav has its own icon)
            const stripped = newText.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}]\s*/u, '');
            navItem.textContent = stripped || newText;
            const store = JSON.parse(localStorage.getItem('editableTitles') || '{}');
            store[_titleToNav[storageKey]] = stripped || newText;
            localStorage.setItem('editableTitles', JSON.stringify(store));
        }
    }
    // If a nav label changed, update the corresponding module title
    if (_navToTitle[storageKey]) {
        const titleEl = document.querySelector(`.editable-title[data-key="${_navToTitle[storageKey]}"]`);
        if (titleEl) {
            // Preserve the emoji prefix from the current title
            const currentText = titleEl.textContent;
            const emojiMatch = currentText.match(/^([\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}]\s*)/u);
            const prefix = emojiMatch ? emojiMatch[1] : '';
            titleEl.textContent = prefix + newText;
            const store = JSON.parse(localStorage.getItem('editableTitles') || '{}');
            store[_navToTitle[storageKey]] = prefix + newText;
            localStorage.setItem('editableTitles', JSON.stringify(store));
        }
    }
}

function makeEditable(el, storageKey) {
    el.style.cursor = 'text';
    
    el.addEventListener('click', (e) => {
        if (el.contentEditable === 'true') return;
        e.stopPropagation();
        e.preventDefault();
        el.contentEditable = 'true';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    });
    
    el.addEventListener('blur', () => {
        el.contentEditable = 'false';
        const newText = el.textContent.trim();
        if (storageKey) {
            const store = JSON.parse(localStorage.getItem('editableTitles') || '{}');
            store[storageKey] = newText;
            localStorage.setItem('editableTitles', JSON.stringify(store));
            _syncTitleAndNav(storageKey, newText);
        }
        // Special: if this is the workspace name, also save via API
        if (storageKey === 'wsName' && state.activeWorkspace && newText) {
            state.activeWorkspace.name = newText;
            fetch(`/api/workspaces/${state.activeWorkspace.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newText })
            }).catch(() => {});
        }
    });
    
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
}

function initEditableNavLabels() {
    const saved = JSON.parse(localStorage.getItem('editableTitles') || '{}');
    // Also migrate old navLabels storage
    const oldNav = JSON.parse(localStorage.getItem('navLabels') || '{}');
    if (Object.keys(oldNav).length > 0) {
        Object.assign(saved, oldNav);
        localStorage.setItem('editableTitles', JSON.stringify(saved));
        localStorage.removeItem('navLabels');
    }
    
    // Nav sidebar labels
    document.querySelectorAll('.nav-menu .nav-label').forEach(label => {
        const module = label.closest('.nav-item')?.dataset?.module;
        if (module && saved[module]) label.textContent = saved[module];
        makeEditable(label, module);
    });
    
    // All .editable-title elements (module h2s, brand h1, etc)
    document.querySelectorAll('.editable-title').forEach(el => {
        const key = el.dataset.key;
        if (key && saved[key]) el.textContent = saved[key];
        makeEditable(el, key);
    });
}

// ========== PROGRESS TRACKER ==========
function renderProgressTracker() {
    const el = document.getElementById('progressTracker');
    if (!el) return;
    
    const today = new Date();
    const items = state.mediaItems || [];
    
    let done = 0, inProgress = 0, pending = 0, overdue = 0;
    items.forEach(item => {
        if (item.status === 'published' || item.status === 'posted') done++;
        else if (item.status === 'in_progress' || item.status === 'review') inProgress++;
        else {
            if (item.scheduled_date && new Date(item.scheduled_date) < today) overdue++;
            else pending++;
        }
    });
    
    const total = items.length || 1;
    const pDone = (done / total * 100).toFixed(0);
    const pProgress = (inProgress / total * 100).toFixed(0);
    const pOverdue = (overdue / total * 100).toFixed(0);
    const pPending = (pending / total * 100).toFixed(0);
    
    el.innerHTML = `
        <div class="progress-stats">
            <span class="progress-stat"><span class="progress-dot" style="background:#4ade80;"></span>${done} Done</span>
            <span class="progress-stat"><span class="progress-dot" style="background:#facc15;"></span>${inProgress} Active</span>
            <span class="progress-stat"><span class="progress-dot" style="background:#818cf8;"></span>${pending} Pending</span>
            ${overdue > 0 ? `<span class="progress-stat"><span class="progress-dot" style="background:#f87171;"></span>${overdue} Overdue</span>` : ''}
        </div>
        <div class="progress-track">
            <div class="progress-seg done" style="width:${pDone}%" title="${done} done"></div>
            <div class="progress-seg active" style="width:${pProgress}%" title="${inProgress} active"></div>
            <div class="progress-seg overdue" style="width:${pOverdue}%" title="${overdue} overdue"></div>
            <div class="progress-seg pending" style="width:${pPending}%" title="${pending} pending"></div>
        </div>
    `;
}

// ========== DAY PLANNER (Multi-Planner) ==========
let plannerState = {
    view: 'day',
    selectedDate: new Date().toISOString().split('T')[0],
    activePlannerId: null,
    planners: [] // [{id, name, tasks:[{id,date,text,done}]}]
};

function loadPlanners() {
    const saved = JSON.parse(localStorage.getItem('planners') || 'null');
    if (saved && Array.isArray(saved) && saved.length > 0) {
        plannerState.planners = saved;
    } else {
        // Migrate old single-planner tasks if they exist
        const oldTasks = JSON.parse(localStorage.getItem('plannerTasks') || '[]');
        plannerState.planners = [{ id: crypto.randomUUID(), name: 'Main', tasks: oldTasks }];
        localStorage.removeItem('plannerTasks');
    }
    plannerState.activePlannerId = localStorage.getItem('activePlannerId') || plannerState.planners[0].id;
    // Ensure active planner exists
    if (!plannerState.planners.find(p => p.id === plannerState.activePlannerId)) {
        plannerState.activePlannerId = plannerState.planners[0].id;
    }
}

function getActivePlanner() {
    return plannerState.planners.find(p => p.id === plannerState.activePlannerId) || plannerState.planners[0];
}

function savePlanners() {
    localStorage.setItem('planners', JSON.stringify(plannerState.planners));
    localStorage.setItem('activePlannerId', plannerState.activePlannerId);
}

function renderPlannerSelector() {
    const sel = document.getElementById('plannerSelector');
    if (!sel) return;
    sel.innerHTML = plannerState.planners.map(p =>
        `<option value="${p.id}" ${p.id === plannerState.activePlannerId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
}

function switchPlanner(plannerId) {
    plannerState.activePlannerId = plannerId;
    localStorage.setItem('activePlannerId', plannerId);
    renderDayPlanner();
}

function createNewPlanner() {
    const name = prompt('Planner name (e.g. "Client X", "Studio", "Personal"):');
    if (!name || !name.trim()) return;
    const newPlanner = { id: crypto.randomUUID(), name: name.trim(), tasks: [] };
    plannerState.planners.push(newPlanner);
    plannerState.activePlannerId = newPlanner.id;
    savePlanners();
    renderPlannerSelector();
    renderDayPlanner();
    showNotification(`Created planner "${name.trim()}"`);
}

function renamePlanner() {
    const planner = getActivePlanner();
    const name = prompt('Rename planner:', planner.name);
    if (!name || !name.trim()) return;
    planner.name = name.trim();
    savePlanners();
    renderPlannerSelector();
    showNotification(`Renamed to "${name.trim()}"`);
}

function deletePlanner() {
    if (plannerState.planners.length <= 1) { showNotification('Cannot delete the only planner', 'error'); return; }
    const planner = getActivePlanner();
    if (!confirm(`Delete planner "${planner.name}" and all its tasks?`)) return;
    plannerState.planners = plannerState.planners.filter(p => p.id !== planner.id);
    plannerState.activePlannerId = plannerState.planners[0].id;
    savePlanners();
    renderPlannerSelector();
    renderDayPlanner();
    showNotification(`Deleted "${planner.name}"`);
}

function switchPlannerView(view) {
    plannerState.view = view;
    renderDayPlanner();
}

function renderDayPlanner() {
    const container = document.getElementById('dayPlannerContent');
    if (!container) return;
    loadPlanners();
    renderPlannerSelector();
    renderProgressTracker();
    
    if (plannerState.view === 'day') {
        renderDayView(container);
    } else {
        renderWeekView(container);
    }
}

function renderDayView(container) {
    const planner = getActivePlanner();
    const dateStr = plannerState.selectedDate;
    const date = new Date(dateStr + 'T12:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    
    const scheduledItems = (state.mediaItems || []).filter(i => i.scheduled_date && i.scheduled_date.startsWith(dateStr));
    const dayTasks = planner.tasks.filter(t => t.date === dateStr);
    
    container.innerHTML = `
        <div class="planner-header">
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="navigatePlannerDay(-1)">?</button>
            <h3 class="planner-date">${dayName}</h3>
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="navigatePlannerDay(1)">?</button>
            <button class="btn-ghost" style="font-size:0.75rem;margin-left:auto;" onclick="goToPlannerToday()">Today</button>
            <button class="btn-ghost" style="font-size:0.7rem;padding:0.15rem 0.4rem;opacity:0.5;" onclick="renamePlanner()" title="Rename planner">??</button>
            ${plannerState.planners.length > 1 ? `<button class="btn-ghost" style="font-size:0.7rem;padding:0.15rem 0.4rem;opacity:0.4;" onclick="deletePlanner()" title="Delete planner">??</button>` : ''}
        </div>
        ${scheduledItems.length > 0 ? `
            <div class="planner-section-label">Scheduled Content <span style="font-size:0.65rem;color:var(--text-tertiary);font-weight:normal;">(drag items here)</span></div>
            ${scheduledItems.map(item => `
                <div class="planner-item scheduled" draggable="true" ondragstart="calendarPillDragStart(event, '${item.id}')" onclick="openContentModal('${item.id}')" style="cursor:grab;">
                    <span class="planner-dot" style="background:${item.status === 'published' ? '#4ade80' : '#facc15'};"></span>
                    <span class="planner-item-title">${item.title}</span>
                    <span class="planner-item-type">${item.content_type}</span>
                </div>
            `).join('') }
        ` : ''}
        <div class="planner-section-label">Tasks</div>
        <div class="planner-tasks" id="plannerTaskList">
            ${dayTasks.map((t, i) => `
                <div class="planner-item task ${t.done ? 'done' : ''}">
                    <input type="checkbox" ${t.done ? 'checked' : ''} onchange="togglePlannerTask('${t.id}')">
                    <span class="planner-item-title ${t.done ? 'line-through' : ''}">${t.text}</span>
                    <button class="card-x-delete" style="position:static;opacity:0.4;width:16px;height:16px;font-size:12px;" onclick="deletePlannerTask('${t.id}')">×</button>
                </div>
            `).join('') || '<div style="color:var(--text-tertiary);font-size:0.8rem;padding:0.3rem 0;">No tasks yet</div>'}
        </div>
        <div class="planner-add">
            <input type="text" id="plannerNewTask" class="planner-input" placeholder="Add a task..." onkeydown="if(event.key==='Enter')addPlannerTask()">
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.2rem 0.6rem;" onclick="addPlannerTask()">+</button>
        </div>
    `;
}

function renderWeekView(container) {
    const planner = getActivePlanner();
    const startDate = new Date(plannerState.selectedDate + 'T12:00:00');
    const dayOfWeek = startDate.getDay();
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    
    let days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        days.push(d);
    }
    
    const weekLabel = `${weekStart.toLocaleDateString('en-US', {month:'short', day:'numeric'})} – ${days[6].toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;
    
    container.innerHTML = `
        <div class="planner-header">
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="navigatePlannerWeek(-1)">?</button>
            <h3 class="planner-date">${weekLabel}</h3>
            <button class="btn-ghost" style="font-size:0.8rem;padding:0.2rem 0.5rem;" onclick="navigatePlannerWeek(1)">?</button>
            <button class="btn-ghost" style="font-size:0.75rem;margin-left:auto;" onclick="goToPlannerToday()">Today</button>
        </div>
        <div class="planner-week-grid">
            ${days.map(d => {
                const ds = d.toISOString().split('T')[0];
                const isToday = ds === new Date().toISOString().split('T')[0];
                const items = (state.mediaItems || []).filter(i => i.scheduled_date && i.scheduled_date.startsWith(ds));
                const tasks = planner.tasks.filter(t => t.date === ds);
                return `
                    <div class="planner-week-day ${isToday ? 'today' : ''}" onclick="plannerState.selectedDate='${ds}'; plannerState.view='day'; renderDayPlanner();" ondragover="calendarDragOver(event)" ondragleave="calendarDragLeave(event)" ondrop="event.stopPropagation(); calendarDrop(event, '${ds}');">
                        <div class="planner-week-day-header">${d.toLocaleDateString('en-US',{weekday:'short'})}<br><strong>${d.getDate()}</strong></div>
                        ${items.map(i => `<div class="content-pill compact" style="font-size:0.65rem;">${i.title}</div>`).join('')}
                        ${tasks.map(t => `<div class="planner-task-pill ${t.done ? 'done' : ''}">${t.text}</div>`).join('')}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function navigatePlannerDay(dir) {
    const d = new Date(plannerState.selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + dir);
    plannerState.selectedDate = d.toISOString().split('T')[0];
    renderDayPlanner();
}

function navigatePlannerWeek(dir) {
    const d = new Date(plannerState.selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + (dir * 7));
    plannerState.selectedDate = d.toISOString().split('T')[0];
    renderDayPlanner();
}

function goToPlannerToday() {
    plannerState.selectedDate = new Date().toISOString().split('T')[0];
    renderDayPlanner();
}

function addPlannerTask() {
    const input = document.getElementById('plannerNewTask');
    const text = input?.value?.trim();
    if (!text) return;
    
    const planner = getActivePlanner();
    planner.tasks.push({
        id: crypto.randomUUID(),
        date: plannerState.selectedDate,
        text,
        done: false
    });
    savePlanners();
    input.value = '';
    renderDayPlanner();
}

function togglePlannerTask(taskId) {
    const planner = getActivePlanner();
    const task = planner.tasks.find(t => t.id === taskId);
    if (task) task.done = !task.done;
    savePlanners();
    renderDayPlanner();
}

function deletePlannerTask(taskId) {
    const planner = getActivePlanner();
    planner.tasks = planner.tasks.filter(t => t.id !== taskId);
    savePlanners();
    renderDayPlanner();
}

// ========== CUSTOM THEME ==========
function applyCustomAccent() {
    const picker = document.getElementById('customAccentColor');
    if (!picker) return;
    const hex = picker.value;
    
    // Parse hex to r,g,b
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
    document.documentElement.style.setProperty('--accent-hover', hex);
    
    localStorage.setItem('customAccent', hex);
    showNotification('Custom accent color applied');
}

function resetAccentColor() {
    localStorage.removeItem('customAccent');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-dim');
    document.documentElement.style.removeProperty('--accent-hover');
    showNotification('Accent color reset to theme default');
}

function loadCustomTheme() {
    const accent = localStorage.getItem('customAccent');
    if (accent) {
        const r = parseInt(accent.slice(1,3), 16);
        const g = parseInt(accent.slice(3,5), 16);
        const b = parseInt(accent.slice(5,7), 16);
        document.documentElement.style.setProperty('--accent', accent);
        document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
        document.documentElement.style.setProperty('--accent-hover', accent);
        const picker = document.getElementById('customAccentColor');
        if (picker) picker.value = accent;
    }
    const bgColor = localStorage.getItem('customBgColor');
    if (bgColor) {
        const bg = document.querySelector('.glass-background');
        if (bg) bg.style.background = bgColor;
        const picker = document.getElementById('customBgColor');
        if (picker) picker.value = bgColor;
    }
    const bgImage = localStorage.getItem('customBgImage');
    if (bgImage) {
        applyBackgroundImage(bgImage);
    }
    // Restore panel blur/opacity
    const savedBlur = localStorage.getItem('panelBlur');
    if (savedBlur) setPanelBlur(savedBlur, true);
    const savedOpacity = localStorage.getItem('panelOpacity');
    if (savedOpacity) setPanelOpacity(savedOpacity, true);
    // Restore fullscreen workbench slider UI state
    const savedFsBlur = localStorage.getItem('fsBlur');
    if (savedFsBlur) setFullscreenBlur(savedFsBlur, true);
    const savedFsDarkness = localStorage.getItem('fsDarkness');
    if (savedFsDarkness) setFullscreenDarkness(savedFsDarkness, true);
}

function setPanelBlur(val, silent) {
    val = parseInt(val);
    document.documentElement.style.setProperty('--glass-blur', val + 'px');
    localStorage.setItem('panelBlur', val);
    const label = document.getElementById('panelBlurVal');
    if (label) label.textContent = val + 'px';
    const slider = document.getElementById('panelBlurSlider');
    if (slider) slider.value = val;
    // Apply inline styles as fallback for browsers where CSS var in backdrop-filter is unreactive
    const blurVal = val > 0 ? 'blur(' + val + 'px) saturate(1.3)' : 'none';
    document.querySelectorAll('.module, .sidebar, .global-actions, .modal-container').forEach(function(el) {
        el.style.backdropFilter = blurVal;
        el.style.webkitBackdropFilter = blurVal;
    });
    if (!silent) showNotification('Panel blur: ' + val + 'px');
}

function setPanelOpacity(val, silent) {
    val = parseInt(val);
    const opacity = val / 100;
    document.documentElement.style.setProperty('--glass-bg', `rgba(255, 255, 255, ${opacity.toFixed(3)})`);
    localStorage.setItem('panelOpacity', val);
    const label = document.getElementById('panelOpacityVal');
    if (label) label.textContent = val + '%';
    const slider = document.getElementById('panelOpacitySlider');
    if (slider) slider.value = val;
    if (!silent) showNotification('Panel opacity: ' + val + '%');
}

function setFullscreenBlur(val, silent) {
    val = parseInt(val);
    localStorage.setItem('fsBlur', val);
    const label = document.getElementById('fsBlurVal');
    if (label) label.textContent = val + 'px';
    const slider = document.getElementById('fsBlurSlider');
    if (slider) slider.value = val;
    // Apply to fullscreen board if active
    const fsBoard = document.querySelector('.mood-board.fullscreen');
    if (fsBoard) {
        const blurVal = 'blur(' + val + 'px) saturate(1.4)';
        fsBoard.style.setProperty('backdrop-filter', blurVal, 'important');
        fsBoard.style.setProperty('-webkit-backdrop-filter', blurVal, 'important');
    }
    if (!silent) showNotification('Fullscreen blur: ' + val + 'px');
}

function setFullscreenDarkness(val, silent) {
    val = parseInt(val);
    localStorage.setItem('fsDarkness', val);
    const label = document.getElementById('fsDarknessVal');
    if (label) label.textContent = val + '%';
    const slider = document.getElementById('fsDarknessSlider');
    if (slider) slider.value = val;
    // Apply to fullscreen board if active
    const fsBoard = document.querySelector('.mood-board.fullscreen');
    if (fsBoard) {
        // Rebuild the background with the new darkness value, keeping grid lines
        const alpha = (val / 100).toFixed(2);
        fsBoard.style.setProperty('background',
            'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px),' +
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'radial-gradient(circle at 50% 50%, rgba(74,222,128,0.05), transparent 70%),' +
            'rgba(10,10,15,' + alpha + ')',
            'important'
        );
        fsBoard.style.setProperty('background-size',
            '50px 50px, 50px 50px, 10px 10px, 10px 10px, 100% 100%, 100% 100%',
            'important'
        );
    }
    if (!silent) showNotification('Fullscreen darkness: ' + val + '%');
}

function uploadCustomBackground(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Compress image to fit within localStorage limits (~2MB target)
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_DIM = 1920;
            let w = img.width, h = img.height;
            if (w > MAX_DIM || h > MAX_DIM) {
                const scale = MAX_DIM / Math.max(w, h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            try {
                localStorage.setItem('customBgImage', dataUrl);
            } catch (err) {
                // If still too large, try lower quality
                const smallerUrl = canvas.toDataURL('image/jpeg', 0.4);
                try {
                    localStorage.setItem('customBgImage', smallerUrl);
                } catch (err2) {
                    showNotification('Image too large for local storage. Try a smaller file.', 'error');
                    return;
                }
            }
            applyBackgroundImage(dataUrl);
            showNotification('Background image applied');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function generateThemeBackground() {
    showNotification('Generating background...', 'info');
    try {
        const response = await fetch('/api/ai/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'Generate a dark, subtle, abstract background texture suitable for a modern dark-themed dashboard UI. Minimal, elegant, with very subtle color gradients. No text, no objects. Ultra-wide aspect ratio.',
                brand_profile_id: state.brandProfile?.id
            })
        });
        const data = await response.json();
        if (data.image_url) {
            localStorage.setItem('customBgImage', data.image_url);
            applyBackgroundImage(data.image_url);
            showNotification('Background generated and applied!');
        } else {
            showNotification(data.error || 'Generation failed', 'error');
        }
    } catch (err) {
        showNotification('Error generating background', 'error');
    }
}

function applyBackgroundImage(dataUrl) {
    // Use a dedicated bg-image layer so it renders behind glassmorphic panels
    let bgImg = document.getElementById('bgImageLayer');
    if (!bgImg) {
        bgImg = document.createElement('div');
        bgImg.id = 'bgImageLayer';
        bgImg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;background-size:cover;background-position:center;filter:blur(20px) brightness(0.4);transform:scale(1.1);';
        document.body.insertBefore(bgImg, document.body.firstChild);
    }
    bgImg.style.backgroundImage = `url(${dataUrl})`;
    bgImg.style.display = 'block';
    
    const preview = document.getElementById('bgPreview');
    if (preview) {
        preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:80px;object-fit:cover;border-radius:8px;opacity:0.7;">`;
    }
}

function clearCustomBackground() {
    localStorage.removeItem('customBgImage');
    const bgImg = document.getElementById('bgImageLayer');
    if (bgImg) bgImg.style.display = 'none';
    const preview = document.getElementById('bgPreview');
    if (preview) preview.innerHTML = '';
    showNotification('Background cleared');
}

function applyCustomBgColor() {
    const color = document.getElementById('customBgColor')?.value;
    if (!color) return;
    localStorage.setItem('customBgColor', color);
    const bg = document.querySelector('.glass-background');
    if (bg) {
        bg.style.background = color;
    }
    showNotification('Background color applied');
}

function resetBgColor() {
    localStorage.removeItem('customBgColor');
    const bg = document.querySelector('.glass-background');
    if (bg) {
        bg.style.background = '';
    }
    showNotification('Background color reset');
}

// ========== INTELLIGENT SOURCE RESEARCHER ==========
async function suggestSources() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    
    const query = input.value.trim();
    if (!query) return;
    
    showNotification('Researching sources...', 'info');
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Find and suggest RSS feeds, news sources, blogs, and publications related to: "${query}". For each source, provide: name, URL (must be a real working URL), and a one-line description. Return as a JSON array: [{"name":"...","url":"...","description":"..."}]. Return ONLY the JSON array.`,
                brand_profile_id: state.brandProfile?.id,
                action_mode: false
            })
        });
        const data = await response.json();
        
        // Try to parse JSON from the response
        let sources = [];
        try {
            const text = data.response || '';
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) sources = JSON.parse(jsonMatch[0]);
        } catch (e) { console.error('Parse error:', e); }
        
        if (sources.length > 0) {
            showSourceSuggestions(sources);
        } else {
            showNotification('No sources found. Try a different query.', 'info');
        }
    } catch (err) {
        showNotification('Error researching sources', 'error');
    }
}

function showSourceSuggestions(sources) {
    // Show in research settings modal if open, else create a floating panel
    let container = document.getElementById('sourceSuggestions');
    if (!container) {
        const settingsPanel = document.querySelector('.research-settings-content, #researchSettingsModal');
        if (settingsPanel) {
            container = document.createElement('div');
            container.id = 'sourceSuggestions';
            settingsPanel.appendChild(container);
        } else {
            // Show as notification-style panel
            container = document.createElement('div');
            container.id = 'sourceSuggestions';
            container.style.cssText = 'position:fixed;bottom:5rem;right:2rem;width:360px;max-height:400px;overflow-y:auto;background:rgba(15,15,25,0.96);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:1rem;z-index:10001;backdrop-filter:blur(16px);box-shadow:0 12px 40px rgba(0,0,0,0.5);';
            document.body.appendChild(container);
        }
    }
    
    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
            <strong style="font-size:0.9rem;">? Suggested Sources</strong>
            <button onclick="document.getElementById('sourceSuggestions')?.remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1rem;">?</button>
        </div>
        ${sources.map(s => `
            <div class="source-suggestion" style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem;border-radius:8px;margin-bottom:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">${s.name}</div>
                    <div style="font-size:0.7rem;color:var(--text-tertiary);margin-top:2px;">${s.description || ''}</div>
                    <div style="font-size:0.65rem;color:var(--accent);margin-top:2px;word-break:break-all;">${s.url}</div>
                </div>
                <button class="btn-ghost" style="font-size:0.7rem;padding:0.2rem 0.5rem;white-space:nowrap;" onclick="addSuggestedSource('${s.name.replace(/'/g,"\\'")}','${s.url.replace(/'/g,"\\'")}')">+ Add</button>
            </div>
        `).join('')}
    `;
}

async function suggestSourcesFromInput() {
    const input = document.getElementById('sourceSuggestInput');
    const query = input?.value?.trim();
    if (!query) { showNotification('Enter a topic to find sources', 'info'); return; }
    
    const container = document.getElementById('sourceSuggestions');
    if (container) container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;padding:0.5rem;">? Searching for sources...</p>';
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Find and suggest RSS feeds, news sources, blogs, and publications related to: "${query}". For each source, provide: name, URL (must be a real working URL), and a one-line description. Return as a JSON array: [{"name":"...","url":"...","description":"..."}]. Return ONLY the JSON array.`,
                brand_profile_id: state.brandProfile?.id,
                action_mode: false
            })
        });
        const data = await response.json();
        let sources = [];
        try {
            const text = data.response || '';
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) sources = JSON.parse(jsonMatch[0]);
        } catch (e) { console.error('Parse error:', e); }
        
        if (sources.length > 0 && container) {
            container.innerHTML = sources.map(s => `
                <div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem;border-radius:8px;margin-bottom:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">${s.name}</div>
                        <div style="font-size:0.7rem;color:var(--text-tertiary);margin-top:2px;">${s.description || ''}</div>
                        <div style="font-size:0.65rem;color:var(--accent);margin-top:2px;word-break:break-all;">${s.url}</div>
                    </div>
                    <button class="btn-ghost" style="font-size:0.7rem;padding:0.2rem 0.5rem;white-space:nowrap;" onclick="addSuggestedSource('${s.name.replace(/'/g,"\\'")}','${s.url.replace(/'/g,"\\'")}')">+ Add</button>
                </div>
            `).join('');
        } else if (container) {
            container.innerHTML = '<p style="color:var(--text-tertiary);font-size:0.8rem;">No sources found. Try a different topic.</p>';
        }
    } catch (err) {
        if (container) container.innerHTML = '<p style="color:#f87171;font-size:0.8rem;">Error searching. Try again.</p>';
    }
}

async function addSuggestedSource(name, url) {
    try {
        const response = await fetch('/api/news-sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, source_type: 'rss' })
        });
        const source = await response.json();
        if (source.error) {
            showNotification(source.error, 'error');
        } else {
            researchState.sources.push(source);
            showNotification(`Added "${name}"!`);
            renderResearchSourcesList();
        }
    } catch (e) {
        showNotification('Error adding source', 'error');
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
window.navigateMiniCalendar = navigateMiniCalendar;
window.selectMiniCalendarDate = selectMiniCalendarDate;
window.toggleKanbanSelectMode = toggleKanbanSelectMode;
window.toggleKanbanSelect = toggleKanbanSelect;
window.kanbanSelectAll = kanbanSelectAll;
window.kanbanBatchMove = kanbanBatchMove;
window.kanbanBatchDelete = kanbanBatchDelete;
window.sendCardChat = sendCardChat;
window.showConvertOptions = showConvertOptions;
window.quickDeleteItem = quickDeleteItem;
window.quickDeleteArticle = quickDeleteArticle;
// Workspace system
window.toggleWorkspaceMenu = toggleWorkspaceMenu;
window.switchWorkspace = switchWorkspace;
window.openCreateWorkspaceModal = openCreateWorkspaceModal;
window.createWorkspace = createWorkspace;
window.deleteWorkspace = deleteWorkspace;
window.renameWorkspace = renameWorkspace;
window.selectWsIcon = selectWsIcon;
window.selectWsColor = selectWsColor;
window.getWorkspaceId = getWorkspaceId;
// Day Planner
window.switchPlannerView = switchPlannerView;
window.renderDayPlanner = renderDayPlanner;
window.navigatePlannerDay = navigatePlannerDay;
window.navigatePlannerWeek = navigatePlannerWeek;
window.goToPlannerToday = goToPlannerToday;
window.addPlannerTask = addPlannerTask;
window.togglePlannerTask = togglePlannerTask;
window.deletePlannerTask = deletePlannerTask;
window.plannerState = plannerState;
// Custom theme
window.applyCustomAccent = applyCustomAccent;
window.resetAccentColor = resetAccentColor;
window.uploadCustomBackground = uploadCustomBackground;
window.generateThemeBackground = generateThemeBackground;
window.clearCustomBackground = clearCustomBackground;
window.applyCustomBgColor = applyCustomBgColor;
window.resetBgColor = resetBgColor;
// Research settings
window.toggleSource = toggleSource;
window.addNewsSource = addNewsSource;
window.deleteSource = deleteSource;
window.addInterest = addInterest;
window.removeInterest = removeInterest;
// Source researcher
window.suggestSources = suggestSources;
window.addSuggestedSource = addSuggestedSource;
window.suggestSourcesFromInput = suggestSourcesFromInput;
// Brainstorming
window.brainstormGenerate = brainstormGenerate;
window.brainstormChat = brainstormChat;
window.confirmBrainstormIdea = confirmBrainstormIdea;
window.dismissBrainstormIdea = dismissBrainstormIdea;
window.confirmAllBrainstormIdeas = confirmAllBrainstormIdeas;
window.renderBrainstormSection = renderBrainstormSection;
// Wire panel
window.toggleWirePanel = toggleWirePanel;
window.toggleWireSource = toggleWireSource;
window.generateFeedDigest = generateFeedDigest;
// Search sources panel
window.toggleSearchSources = toggleSearchSources;
window.toggleSearchSource = toggleSearchSource;

// Substrate Intelligence Hub bridge
function openSubstrateResearch(mode) {
    showResearchView();
}
window.openSubstrateResearch = openSubstrateResearch;

// Auto-initialize the embedded Intelligence Hub iframe when workspace changes
function initResearchHub() {
    // Native research module - reload data on workspace switch
    if (window.initResearchModule) window.initResearchModule();
}
window.initResearchHub = initResearchHub;



