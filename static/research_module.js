/**
 * Native Research Module — replaces iframe-based Intelligence Hub
 * Renders directly in the Workbench DOM for true glassmorphic transparency.
 * Calls /api/local/ endpoints on the dashboard (localhost:3000).
 */
(function() {
  'use strict';

  var DASHBOARD_URL = window.__SUBSTRATE_DASHBOARD_URL || 'http://localhost:3000';
  var state = {
    view: 'feed', // feed | topics | research | prompts | slideshow
    topics: [],
    feedItems: [],
    prompts: [],
    loading: false,
    isPending: false,
    pendingQuery: '',
    errorMsg: '',
    researchQuery: '',
    newTopic: '',
    newUrl: '',
    activeFilter: null,
    channelId: '',
    channelName: '',
    // Slideshow state
    slideShowItemId: null,
    slideIndex: 0,
    designProgress: { done: 0, total: 0 }
  };

  var container = null;

  // ─── API helpers ─────────────────────────────────────────────────────
  function apiUrl(path) {
    var wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
    var sep = path.indexOf('?') > -1 ? '&' : '?';
    return DASHBOARD_URL + path + (wsId ? sep + 'channel=' + encodeURIComponent(wsId) : '');
  }

  function fetchJSON(path, opts) {
    return fetch(apiUrl(path), opts).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  }

  // ─── Data loading ────────────────────────────────────────────────────
  function loadTopics() {
    return fetchJSON('/api/local/research-topics').then(function(data) {
      if (data && data.topics) state.topics = data.topics;
      render();
    });
  }

  function loadFeed() {
    return fetchJSON('/api/local/research-feed').then(function(data) {
      if (data && data.items) state.feedItems = data.items;
      render();
    });
  }

  function loadPrompts() {
    return fetchJSON('/api/local/research-prompts').then(function(data) {
      if (data && data.prompts) state.prompts = data.prompts;
      render();
    });
  }

  // ─── Actions ─────────────────────────────────────────────────────────
  function addTopic() {
    var label = state.newTopic.trim();
    if (!label) return;
    var topic = {
      id: 'topic-' + Date.now(),
      label: label,
      keywords: label.split(',').map(function(k) { return k.trim(); }),
      color: ['#8b5cf6','#06b6d4','#f59e0b','#ef4444','#10b981','#ec4899'][state.topics.length % 6],
      active: true,
      url: state.newUrl.trim() || undefined
    };
    state.topics.push(topic);
    state.newTopic = '';
    state.newUrl = '';
    saveTopics();
    render();
  }

  function removeTopic(id) {
    state.topics = state.topics.filter(function(t) { return t.id !== id; });
    saveTopics();
    render();
  }

  function toggleTopic(id) {
    state.topics = state.topics.map(function(t) {
      if (t.id === id) return Object.assign({}, t, { active: !t.active });
      return t;
    });
    saveTopics();
    render();
  }

  function saveTopics() {
    fetch(apiUrl('/api/local/research-topics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics: state.topics })
    }).catch(function() {});
  }

  function doResearch(query) {
    if (!query || !query.trim() || state.isPending) return;
    state.isPending = true;
    state.pendingQuery = query.trim();
    state.errorMsg = '';
    state.view = 'feed';
    state.researchQuery = '';
    render();

    console.log('[ResearchModule] Starting deep research:', query.trim());

    fetch(DASHBOARD_URL + '/api/local/deep-research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim(),
        context: ''
      })
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Request failed: ' + r.status); });
      return r.json();
    })
      .then(function(data) {
        console.log('[ResearchModule] Deep research response:', data);
        state.isPending = false;
        state.pendingQuery = '';
        if (data && data.ok && data.result) {
          var res = data.result;
          var newItem = {
            id: 'deep-' + Date.now(),
            type: 'research',
            title: res.title || query.trim(),
            summary: res.summary || '',
            content: res.summary || '',
            topics: res.keyTopics || [],
            timestamp: Date.now(),
            saved: false,
            pending: false,
            sourceUrls: (res.sources || []).filter(function(s) { return s.url && s.url.startsWith('http'); }).map(function(s) { return { url: s.url, label: s.label || s.title || 'Source' }; }),
            sections: res.sections || undefined,
            _deepResearch: true
          };
          state.feedItems.unshift(newItem);
          // Persist to feed file
          saveFeed();
          // Auto-trigger design pass if research has sections (matches Hub's 300ms auto-trigger)
          if (newItem.sections && newItem.sections.length > 0) {
            setTimeout(function() {
              console.log('[ResearchModule] Auto-triggering slide design for:', newItem.title);
              openSlideshow(newItem.id);
            }, 300);
          }
        } else if (data && data.error) {
          state.errorMsg = data.error;
        }
        render();
      })
      .catch(function(err) {
        console.error('[ResearchModule] Deep research error:', err);
        state.isPending = false;
        state.pendingQuery = '';
        state.errorMsg = err.message || 'Research request failed. Check console.';
        render();
      });
  }

  function saveFeed() {
    fetch(apiUrl('/api/local/research-feed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: state.feedItems })
    }).catch(function(e) { console.warn('[ResearchModule] Failed to save feed:', e); });
  }

  // ─── Presentation Generation ──────────────────────────────────────
  var SLIDE_DESIGNER_PROMPT = 'You are an elite research analyst and storytelling expert. Your job: distill research into a structured slide deck outline with punchy headings and data-dense body text.\n\nReturn as JSON:\n{\n  "title": "TOPIC_PLACEHOLDER",\n  "summary": "A sharp, memorable subtitle",\n  "sections": [\n    { "heading": "Punchy insight heading, max 8 words", "body": "Data-rich body text with 2+ data markers. 3-6 sentences." }\n  ],\n  "sources": [],\n  "keyTopics": ["topic1", "topic2"]\n}\n\n=== DATA MARKERS ===\n* [STAT: value | description]\n* [COMPARE: A = val | B = val]\n* [TIMELINE: 2023 = event | 2024 = event]\n* [FLOW: Step1 -> Step2 -> Step3]\n* > "quote" -- Attribution\n* **Bold lead-ins** for bullet points\n\n=== RULES ===\n1. Headings: Lead with insight, max 8 words.\n2. Each section body: 3-6 sentences with 2+ data markers.\n3. One core idea per slide.\n4. Narrative arc: hook -> context -> evidence -> insight -> takeaway.\n5. Use REAL DATA from the research.\n6. Return EXACTLY SLIDE_COUNT_PLACEHOLDER sections.\n\nIMPORTANT: Return ONLY the JSON object, no markdown fences.\n\nSource research:\n';

  function generatePresentation(itemId, slideCount) {
    var item = state.feedItems.find(function(i) { return i.id === itemId; });
    if (!item || state.isPending) return;
    slideCount = slideCount || 8;

    // ── Hub-matching pipeline: if research already has sections, use them directly ──
    // This avoids the double-processing that dilutes the original research quality.
    // The sections from deep-research are already well-structured; just hand them
    // straight to the per-slide design pass (same as Intelligence Hub's doDeepResearch
    // → auto-trigger runDesignPass flow).
    if (item.sections && item.sections.length > 0) {
      console.log('[ResearchModule] Research already has ' + item.sections.length + ' sections — opening directly (no re-processing)');
      // Clear any stale designed HTML so slides get fresh designs
      item.sections.forEach(function(s) { delete s.html; });
      saveFeed();
      openSlideshow(itemId);
      return;
    }

    // ── Fallback: item has no sections (e.g. a brief or simple item) ──
    // Only in this case do we send through the slide designer prompt to create sections.
    var research = '';
    if (item.title) research += 'Topic: ' + item.title + '\n\n';
    if (item.summary) research += item.summary + '\n\n';
    if (item.content && item.content !== item.summary) research += item.content + '\n\n';
    if (item.sourceUrls && item.sourceUrls.length) {
      research += '\nSources:\n';
      item.sourceUrls.forEach(function(src) { research += '- ' + (src.label || src.url) + ': ' + src.url + '\n'; });
    }

    var prompt = SLIDE_DESIGNER_PROMPT.replace('TOPIC_PLACEHOLDER', item.title || 'Presentation').replace('SLIDE_COUNT_PLACEHOLDER', String(slideCount)) + research;

    state.isPending = true;
    state.pendingQuery = slideCount + '-Slide Deck: ' + (item.title || '');
    state.errorMsg = '';
    state.view = 'feed';
    render();

    console.log('[ResearchModule] Item has no sections — generating ' + slideCount + '-slide outline via deep-research');

    fetch(DASHBOARD_URL + '/api/local/deep-research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, context: '' })
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Request failed: ' + r.status); });
      return r.json();
    }).then(function(data) {
      state.isPending = false;
      state.pendingQuery = '';
      if (data && data.ok && data.result) {
        var res = data.result;
        // Attach the new sections directly to the existing item (don't create a duplicate)
        item.type = 'slide';
        item.sections = res.sections || [];
        item.slideCount = slideCount;
        if (res.sources && res.sources.length) {
          item.sourceUrls = res.sources.filter(function(s) { return s.url && s.url.startsWith('http'); }).map(function(s) { return { url: s.url, label: s.label || s.title || 'Source' }; });
        }
        saveFeed();
        openSlideshow(itemId);
        return;
      } else if (data && data.error) {
        state.errorMsg = data.error;
      }
      render();
    }).catch(function(err) {
      console.error('[ResearchModule] Presentation generation error:', err);
      state.isPending = false;
      state.pendingQuery = '';
      state.errorMsg = err.message || 'Presentation generation failed.';
      render();
    });
  }

  // ─── Slideshow (matches Intelligence Hub pipeline) ─────────────────
  var ACCENT_COLORS = [
    '#818cf8', // indigo
    '#22d3ee', // cyan
    '#fbbf24', // amber
    '#fb7185', // rose
    '#34d399', // emerald
    '#a78bfa'  // violet
  ];
  var MAX_CONCURRENT = 3;

  function openSlideshow(itemId) {
    var item = state.feedItems.find(function(i) { return i.id === itemId; });
    if (!item || !item.sections || item.sections.length === 0) return;
    state.slideShowItemId = itemId;
    state.slideIndex = 0;
    state.view = 'slideshow';
    state.designProgress = { done: 0, total: 0 };
    render();
    runDesignPass(itemId);
  }

  function runDesignPass(itemId) {
    var item = state.feedItems.find(function(i) { return i.id === itemId; });
    if (!item || !item.sections || !item.sections.length) return;

    var sections = item.sections;
    var deckOutline = sections.map(function(s, i) { return (i + 1) + '. ' + (s.heading || ''); }).join(' | ');

    // Find which sections need design (don't have html yet)
    var toDesign = [];
    var alreadyDone = 0;
    sections.forEach(function(s, i) {
      if (s.html) { alreadyDone++; } else { toDesign.push(i); }
    });

    console.log('[DesignPass] Starting: ' + sections.length + ' slides, ' + alreadyDone + ' already designed, ' + toDesign.length + ' to design');

    if (toDesign.length === 0) {
      console.log('[DesignPass] All slides already have HTML.');
      state.designProgress = { done: sections.length, total: sections.length };
      render();
      return;
    }

    state.designProgress = { done: alreadyDone, total: sections.length };
    render();

    function designOneSlide(sectionIndex) {
      var section = sections[sectionIndex];
      var accent = ACCENT_COLORS[sectionIndex % ACCENT_COLORS.length];
      console.log('[DesignPass] Requesting slide ' + (sectionIndex + 1) + '/' + sections.length + ': "' + (section.heading || '').substring(0, 50) + '"');

      return fetch(DASHBOARD_URL + '/api/local/slide-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heading: section.heading || '',
          body: section.body || '',
          slideIndex: sectionIndex,
          totalSlides: sections.length,
          deckTitle: item.title || '',
          deckOutline: deckOutline,
          accentColor: accent,
          skipMap: true,
          researchQuery: item.title || ''
        })
      }).then(function(r) {
        if (!r.ok) {
          console.warn('[DesignPass] Slide ' + (sectionIndex + 1) + ' HTTP ' + r.status);
          return r.text().then(function(txt) { console.warn('[DesignPass] Body:', txt.substring(0, 200)); return null; });
        }
        return r.json();
      }).then(function(data) {
        if (data && data.ok && data.html) {
          console.log('[DesignPass] Slide ' + (sectionIndex + 1) + ' OK (' + data.html.length + ' chars)');
          // Persist HTML into the feed item's section (survives refresh)
          var curItem = state.feedItems.find(function(fi) { return fi.id === itemId; });
          if (curItem && curItem.sections && curItem.sections[sectionIndex]) {
            curItem.sections[sectionIndex].html = data.html;
          }
          state.designProgress.done++;
          if (state.view === 'slideshow' && state.slideShowItemId === itemId) render();
          return true;
        }
        console.warn('[DesignPass] Slide ' + (sectionIndex + 1) + ' no html in response');
        return false;
      }).catch(function(err) {
        console.warn('[DesignPass] Slide ' + (sectionIndex + 1) + ' error:', err.message || err);
        return false;
      });
    }

    // Process in parallel batches of MAX_CONCURRENT (matching Intelligence Hub)
    function processBatches(indices, onDone) {
      if (indices.length === 0) { onDone([]); return; }
      var failed = [];
      var pos = 0;

      function nextBatch() {
        if (pos >= indices.length) { onDone(failed); return; }
        var chunk = indices.slice(pos, pos + MAX_CONCURRENT);
        pos += MAX_CONCURRENT;
        Promise.all(chunk.map(function(idx) {
          return designOneSlide(idx).then(function(ok) { if (!ok) failed.push(idx); });
        })).then(nextBatch);
      }
      nextBatch();
    }

    processBatches(toDesign, function(failed) {
      // Retry pass for failed slides (same as Intelligence Hub)
      if (failed.length > 0) {
        console.log('[DesignPass] Retry pass for ' + failed.length + ' failed slides: [' + failed.map(function(i) { return i + 1; }).join(', ') + ']');
        setTimeout(function() {
          processBatches(failed, function(stillFailed) {
            // For anything still failed, use local fallback
            stillFailed.forEach(function(idx) {
              var sec = sections[idx];
              if (sec && !sec.html) {
                sec.html = buildFallbackSlideHtml(sec, idx);
              }
            });
            saveFeed();
            if (state.view === 'slideshow' && state.slideShowItemId === itemId) render();
            console.log('[DesignPass] Complete. ' + stillFailed.length + ' used fallback.');
          });
        }, 3000);
      } else {
        saveFeed();
        if (state.view === 'slideshow' && state.slideShowItemId === itemId) render();
        console.log('[DesignPass] Complete — all slides designed via API.');
      }
    });
  }

  function buildFallbackSlideHtml(section, index) {
    var accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
    var heading = section.heading || 'Slide ' + (index + 1);
    var body = section.body || '';
    var bodyHtml = body
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(255,255,255,0.8);">$1</strong>')
      .replace(/\[STAT:\s*(.+?)\s*\|\s*(.+?)\]/g, '<div style="margin:16px 0;padding:16px 20px;background:rgba(99,102,241,0.06);border-left:3px solid ' + accent + ';border-radius:6px;"><span style="font-size:22px;font-weight:700;color:' + accent + ';">$1</span><br><span style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:4px;display:block;">$2</span></div>')
      .replace(/\[COMPARE:\s*(.+?)\]/g, '<div style="margin:10px 0;padding:10px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:10px;color:rgba(255,255,255,0.5);">📊 $1</div>')
      .replace(/\[TIMELINE:\s*(.+?)\]/g, '<div style="margin:10px 0;padding:10px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:10px;color:rgba(255,255,255,0.5);">📅 $1</div>')
      .replace(/\[FLOW:\s*(.+?)\]/g, '<div style="margin:10px 0;padding:10px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:10px;color:rgba(255,255,255,0.5);">→ $1</div>')
      .replace(/^>\s*"(.+?)"\s*--\s*(.+)$/gm, '<blockquote style="margin:14px 0;padding:10px 16px;border-left:2px solid ' + accent + '40;font-style:italic;color:rgba(255,255,255,0.55);font-size:12px;">"$1"<br><span style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:4px;display:block;">— $2</span></blockquote>')
      .replace(/^\*\s+(.+)$/gm, '<div style="padding:4px 0 4px 14px;border-left:2px solid ' + accent + '25;margin:5px 0;font-size:11px;color:rgba(255,255,255,0.55);">$1</div>')
      .replace(/\n/g, '<br>');
    return '<div style="padding:32px 28px;height:100%;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(145deg, rgba(14,14,22,0.98) 0%, rgba(20,20,35,0.96) 50%, ' + accent + '08 100%);position:relative;overflow:hidden;">'
      + '<div style="position:absolute;top:0;right:0;width:200px;height:200px;background:radial-gradient(circle,' + accent + '08 0%, transparent 70%);pointer-events:none;"></div>'
      + '<div style="font-size:8px;color:' + accent + ';text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;font-weight:600;">Slide ' + (index + 1) + '</div>'
      + '<div style="font-size:17px;font-weight:700;color:rgba(255,255,255,0.88);margin-bottom:18px;line-height:1.35;border-bottom:1px solid ' + accent + '20;padding-bottom:12px;">' + heading.replace(/</g,'&lt;') + '</div>'
      + '<div style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.75;">' + bodyHtml + '</div>'
      + '</div>';
  }

  function deleteFeedItem(id) {
    state.feedItems = state.feedItems.filter(function(i) { return i.id !== id; });
    saveFeed();
    render();
  }

  function requestBrief() {
    var topicLabels = state.topics.filter(function(t) { return t.active; }).map(function(t) { return t.label; });
    var query = topicLabels.length > 0
      ? 'Daily brief on: ' + topicLabels.join(', ')
      : 'Daily intelligence brief on technology and current events';
    doResearch(query);
  }

  // ─── Render ──────────────────────────────────────────────────────────
  function render() {
    if (!container) return;
    var html = '';

    // Tab navigation (hidden in slideshow mode — it has its own nav)
    if (state.view !== 'slideshow') {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 1rem;border-bottom:1px solid rgba(255,255,255,0.04);">';
      html += '<div style="display:flex;gap:4px;">';
      ['feed','topics','research','prompts'].forEach(function(v) {
        var label = v === 'feed' ? 'Feed' : v === 'topics' ? 'Topics' : v === 'research' ? 'Research' : 'Prompts';
        var active = state.view === v;
        html += '<button class="rh-tab' + (active ? ' active' : '') + '" data-view="' + v + '">' + label + '</button>';
      });
      html += '</div>';
      // Channel badge
      var wsName = (window.state && window.state.activeWorkspace) ? window.state.activeWorkspace.name : '';
      if (wsName) {
        html += '<span class="rh-badge">';
        html += '<span class="rh-badge-dot"></span>' + escHtml(wsName);
        html += '</span>';
      }
      html += '</div>';
    }

    // View content
    if (state.view === 'slideshow') html += renderSlideshow();
    else if (state.view === 'feed') html += renderFeed();
    else if (state.view === 'topics') html += renderTopics();
    else if (state.view === 'research') html += renderResearch();
    else if (state.view === 'prompts') html += renderPrompts();

    container.innerHTML = html;
    bindEvents();
  }

  function renderFeed() {
    var html = '';
    // Action bar
    html += '<div style="display:flex;gap:8px;padding:0.5rem 1rem;border-bottom:1px solid rgba(255,255,255,0.03);">';
    html += '<button class="rh-btn" data-action="brief">📰 Daily Brief</button>';
    html += '<button class="rh-btn" data-action="go-research">🔍 Research</button>';
    // Topic filters
    state.topics.filter(function(t) { return t.active; }).forEach(function(t) {
      var active = state.activeFilter === t.label;
      html += '<button class="rh-filter' + (active ? ' active' : '') + '" data-filter="' + escHtml(t.label) + '" style="' + (active ? 'border-color:' + t.color + '40;' : '') + '">' + escHtml(t.label) + '</button>';
    });
    html += '</div>';

    // Feed items
    html += '<div class="rh-scroll">';
    var items = state.feedItems;
    if (state.activeFilter) {
      items = items.filter(function(i) {
        return i.topics && i.topics.some(function(t) {
          return t.toLowerCase().indexOf(state.activeFilter.toLowerCase()) > -1;
        });
      });
    }

    if (state.errorMsg) {
      html += '<div class="rh-card" style="border-color:rgba(239,68,68,0.2);"><div class="rh-card-title" style="color:rgba(239,68,68,0.8);">⚠ Error</div><div class="rh-card-body">' + escHtml(state.errorMsg) + '</div></div>';
    }

    if (state.isPending) {
      html += '<div class="rh-card" style="border-color:rgba(99,102,241,0.15);">';
      html += '<div class="rh-card-title"><span class="rh-spinner"></span> Researching: ' + escHtml(state.pendingQuery || '...') + '</div>';
      html += '<div class="rh-card-body">Deep research with Gemini + Google Search grounding. This may take 30-60 seconds...</div>';
      html += '</div>';
    }

    if (items.length === 0 && !state.isPending) {
      html += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:rgba(255,255,255,0.25);">';
      html += '<div style="font-size:28px;">🌐</div>';
      html += '<div style="font-size:12px;">No intelligence yet</div>';
      html += '<div style="font-size:10px;">Request a daily brief or start a research query</div>';
      html += '</div>';
    } else {
      items.forEach(function(item) {
        if (item.pending) return;
        html += '<div class="rh-card">';
        html += '<div class="rh-card-header">';
        html += '<div class="rh-card-title">' + escHtml(item.title || 'Untitled') + '</div>';
        html += '<div style="display:flex;gap:4px;align-items:center;">';
        if (item._deepResearch) html += '<span style="font-size:8px;color:rgba(99,102,241,0.6);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:1px 4px;">Deep</span>';
        html += '<button class="rh-card-del" data-delete="' + item.id + '">×</button>';
        html += '</div></div>';
        if (item.summary) {
          html += '<div class="rh-card-body">' + escHtml(item.summary).substring(0, 400) + (item.summary.length > 400 ? '...' : '') + '</div>';
        }
        // Sections (collapsible)
        if (item.sections && item.sections.length > 0) {
          html += '<div class="rh-sections" style="margin-top:8px;">';
          item.sections.forEach(function(sec, idx) {
            if (idx === 0 && sec.heading === 'Research Findings' && item.sections.length === 1) {
              // Single section — show body directly
              html += '<div class="rh-card-body" style="margin-top:4px;max-height:200px;overflow-y:auto;">' + escHtml(sec.body || '').substring(0, 800) + '</div>';
            } else {
              html += '<details class="rh-section-detail"' + (idx === 0 ? ' open' : '') + '>';
              html += '<summary class="rh-section-heading">' + escHtml(sec.heading || 'Section') + '</summary>';
              html += '<div class="rh-card-body" style="margin-top:4px;max-height:150px;overflow-y:auto;">' + escHtml(sec.body || '').substring(0, 600) + '</div>';
              html += '</details>';
            }
          });
          html += '</div>';
        }
        // Source URLs
        if (item.sourceUrls && item.sourceUrls.length > 0) {
          html += '<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">';
          item.sourceUrls.slice(0, 5).forEach(function(src) {
            html += '<a href="' + escHtml(src.url) + '" target="_blank" rel="noopener" class="rh-source-link">' + escHtml(src.label || 'Source') + '</a>';
          });
          if (item.sourceUrls.length > 5) html += '<span class="rh-tag">+' + (item.sourceUrls.length - 5) + ' more</span>';
          html += '</div>';
        }
        // Action buttons (generate presentation, open slideshow)
        if (item.type === 'slide' && item.sections && item.sections.length > 0) {
          html += '<div style="margin-top:8px;display:flex;gap:6px;align-items:center;">';
          html += '<button class="rh-btn rh-btn-sm" data-open-slideshow="' + item.id + '" title="Open as presentation">▶ Present (' + item.sections.length + ' slides)</button>';
          html += '</div>';
        } else if (item.type === 'research' || item.type === 'brief' || item._deepResearch) {
          html += '<div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
          if (item.sections && item.sections.length > 0) {
            // Research already has sections — direct path (matches Hub pipeline)
            html += '<button class="rh-btn rh-btn-sm" data-gen-slides="' + item.id + '" title="Design slides from this research">▶ Present as Slides (' + item.sections.length + ')</button>';
          } else {
            // No sections — needs slide outline generation first
            html += '<button class="rh-btn rh-btn-sm" data-gen-slides="' + item.id + '" title="Generate slide deck from this research">📊 Generate Slides</button>';
            html += '<select class="rh-select-sm" data-slide-count-for="' + item.id + '"><option value="6">6</option><option value="8" selected>8</option><option value="10">10</option><option value="12">12</option></select>';
          }
          html += '</div>';
        }
        if (item.topics && item.topics.length) {
          html += '<div class="rh-card-tags">';
          item.topics.forEach(function(t) {
            html += '<span class="rh-tag">' + escHtml(t) + '</span>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderTopics() {
    var html = '';
    // Input bar
    html += '<div style="padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
    html += '<div class="rh-input-wrap" style="flex:1;"><span style="color:rgba(255,255,255,0.25);font-size:11px;">🏷</span><input class="rh-input" id="rh-topic-input" placeholder="Topic or keywords (comma-separated)..." value="' + escHtml(state.newTopic) + '"></div>';
    html += '<button class="rh-btn-icon" data-action="add-topic">+</button>';
    html += '</div>';
    html += '<div class="rh-input-wrap"><span style="color:rgba(255,255,255,0.25);font-size:11px;">🌐</span><input class="rh-input" id="rh-url-input" placeholder="Optional: RSS feed or news URL..." value="' + escHtml(state.newUrl) + '"></div>';
    html += '</div>';

    // Topic list
    html += '<div class="rh-scroll" style="padding:0.75rem;">';
    state.topics.forEach(function(t) {
      html += '<div class="rh-topic-row' + (t.active ? '' : ' inactive') + '">';
      html += '<button class="rh-topic-dot" data-toggle="' + t.id + '" style="border-color:' + t.color + ';' + (t.active ? 'background:' + t.color + ';' : '') + '"></button>';
      html += '<div class="rh-topic-info"><div class="rh-topic-label">' + escHtml(t.label) + '</div><div class="rh-topic-keywords">' + escHtml(t.keywords.join(', ')) + (t.url ? ' · ' + escHtml(t.url) : '') + '</div></div>';
      html += '<button class="rh-topic-action" data-research-topic="' + escHtml(t.label) + '" title="Research">🔍</button>';
      html += '<button class="rh-topic-action delete" data-remove-topic="' + t.id + '" title="Delete">🗑</button>';
      html += '</div>';
    });
    if (state.topics.length === 0) {
      html += '<div style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;padding:2rem 0;">Add topics to curate your intelligence feed</div>';
    }
    html += '</div>';
    return html;
  }

  function renderResearch() {
    var html = '';
    html += '<div style="padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<div style="display:flex;gap:8px;">';
    html += '<div class="rh-input-wrap" style="flex:1;"><span style="color:rgba(255,255,255,0.25);font-size:12px;">🔍</span><input class="rh-input" id="rh-research-input" placeholder="Deep research (Gemini + Google Search)..." value="' + escHtml(state.researchQuery) + '"></div>';
    html += '<button class="rh-btn" data-action="do-research"' + (state.isPending ? ' disabled' : '') + '>' + (state.isPending ? '⏳' : '→') + '</button>';
    html += '</div>';
    html += '</div>';

    // Show recent research items
    html += '<div class="rh-scroll" style="padding:0.75rem;">';
    var researchItems = state.feedItems.filter(function(i) { return i.type === 'research'; });
    if (researchItems.length === 0) {
      html += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;color:rgba(255,255,255,0.25);">';
      html += '<div style="font-size:24px;">🔬</div>';
      html += '<div style="font-size:12px;">Enter a query above to start researching</div>';
      html += '</div>';
    } else {
      researchItems.forEach(function(item) {
        html += '<div class="rh-card">';
        html += '<div class="rh-card-header"><div class="rh-card-title">' + escHtml(item.title) + '</div></div>';
        if (item.summary) html += '<div class="rh-card-body">' + escHtml(item.summary).substring(0, 400) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderPrompts() {
    var html = '';
    html += '<div class="rh-scroll" style="padding:0.75rem;">';
    if (state.prompts.length === 0) {
      html += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;color:rgba(255,255,255,0.25);">';
      html += '<div style="font-size:24px;">💡</div>';
      html += '<div style="font-size:12px;">Saved prompts will appear here</div>';
      html += '</div>';
    } else {
      state.prompts.forEach(function(p) {
        html += '<div class="rh-card"><div class="rh-card-title">' + escHtml(p.title || p.text || 'Prompt') + '</div>';
        if (p.text) html += '<div class="rh-card-body">' + escHtml(p.text).substring(0, 200) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  // Glassmorphic Shell wrapper — matches Intelligence Hub SlideCard Shell
  function slideShell(slideTitle, slideNum, totalNum, innerHtml) {
    return '<div class="rh-shell" style="animation:rh-fadeIn 200ms ease-out;">'
      // Top edge highlight
      + '<div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.08) 50%, transparent 90%);"></div>'
      // Subtle inner glow
      + '<div style="position:absolute;top:-80px;left:50%;transform:translateX(-50%);width:320px;height:160px;border-radius:50%;background:radial-gradient(ellipse, rgba(255,255,255,0.03) 0%, transparent 60%);pointer-events:none;"></div>'
      // Inner padding container
      + '<div style="position:relative;flex:1;padding:28px;display:flex;flex-direction:column;">'
        // Slide header
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-shrink:0;">'
          + '<div style="display:flex;align-items:center;gap:10px;">'
            + '<div style="width:3px;height:12px;border-radius:2px;background:linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.08));"></div>'
            + '<span style="font-size:7.5px;font-weight:700;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.25em;">' + escHtml(slideTitle) + '</span>'
          + '</div>'
          + '<span style="font-size:7.5px;color:rgba(255,255,255,0.1);font-family:monospace;letter-spacing:0.1em;">' + slideNum + ' / ' + totalNum + '</span>'
        + '</div>'
        // Content
        + '<div style="flex:1;display:flex;flex-direction:column;min-height:0;">'
          + innerHtml
        + '</div>'
        // Bottom bar
        + '<div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-shrink:0;">'
          + '<div style="height:1px;flex:1;background:linear-gradient(90deg, rgba(255,255,255,0.06), transparent);"></div>'
          + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<div style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,0.12);"></div>'
            + '<span style="font-size:6.5px;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;color:rgba(255,255,255,0.06);">substrate</span>'
          + '</div>'
        + '</div>'
      + '</div>'
    + '</div>';
  }

  function renderSlideshow() {
    var item = state.feedItems.find(function(i) { return i.id === state.slideShowItemId; });
    if (!item || !item.sections) { state.view = 'feed'; return renderFeed(); }

    var sections = item.sections;
    var hasSources = item.sourceUrls && item.sourceUrls.length > 0;
    var totalSlides = 1 + sections.length + (hasSources ? 1 : 0);
    var idx = state.slideIndex;

    var designedCount = 0;
    sections.forEach(function(s) { if (s.html) designedCount++; });
    var progress = state.designProgress || { done: designedCount, total: sections.length };

    var html = '';

    // Top nav bar
    html += '<div class="rh-slide-nav">';
    html += '<button class="rh-slide-nav-btn" data-action="slide-back" title="Back to feed">← Back</button>';
    html += '<div class="rh-slide-nav-info">';
    html += '<span class="rh-slide-nav-title">' + escHtml(item.title || 'Presentation') + '</span>';
    html += '<span class="rh-slide-nav-counter">' + (idx + 1) + ' / ' + totalSlides + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="rh-slide-nav-btn" data-action="slide-prev"' + (idx === 0 ? ' disabled' : '') + '>‹</button>';
    html += '<button class="rh-slide-nav-btn" data-action="slide-next"' + (idx >= totalSlides - 1 ? ' disabled' : '') + '>›</button>';
    html += '</div>';
    html += '</div>';

    // Thumbnail strip
    html += '<div class="rh-slide-thumbs">';
    for (var t = 0; t < totalSlides; t++) {
      var isActive = t === idx;
      var thumbLabel = '';
      var thumbStyle = '';
      if (t === 0) { thumbLabel = '▣'; }
      else if (t <= sections.length) {
        var secIdx = t - 1;
        var hasDesign = !!sections[secIdx].html;
        var thumbAccent = ACCENT_COLORS[secIdx % ACCENT_COLORS.length];
        thumbLabel = hasDesign ? '✓' : (secIdx + 1);
        if (hasDesign) thumbStyle = ' style="border-color:' + thumbAccent + '30;color:' + thumbAccent + ';"';
      } else { thumbLabel = '◈'; }
      html += '<button class="rh-slide-thumb' + (isActive ? ' active' : '') + '"' + thumbStyle + ' data-slide-goto="' + t + '">' + thumbLabel + '</button>';
    }
    html += '</div>';

    // Design progress bar
    if (designedCount < sections.length) {
      var pct = Math.round((progress.done / progress.total) * 100) || 0;
      html += '<div style="padding:4px 12px;display:flex;align-items:center;gap:8px;">';
      html += '<div style="flex:1;height:2px;background:rgba(255,255,255,0.04);border-radius:1px;overflow:hidden;">';
      html += '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.15));transition:width 0.5s;"></div>';
      html += '</div>';
      html += '<span style="font-size:8px;color:rgba(255,255,255,0.25);">Designing ' + progress.done + '/' + progress.total + ' <span class="rh-spinner"></span></span>';
      html += '</div>';
    }

    // Slide content area
    html += '<div class="rh-slide-canvas">';

    if (idx === 0) {
      // ── Title Slide (matches Hub SlideCard title) ──
      var titleInner = '';
      // SVG decorative accents
      titleInner += '<div style="position:absolute;top:6px;right:7px;opacity:0.03;pointer-events:none;">'
        + '<svg width="120" height="120" viewBox="0 0 120 120" fill="none">'
        + '<circle cx="60" cy="60" r="55" stroke="rgba(255,255,255,0.3)" stroke-width="0.5" stroke-dasharray="4 6"/>'
        + '<circle cx="60" cy="60" r="35" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" stroke-dasharray="2 4"/>'
        + '<line x1="5" y1="60" x2="115" y2="60" stroke="rgba(255,255,255,0.2)" stroke-width="0.3"/>'
        + '<line x1="60" y1="5" x2="60" y2="115" stroke="rgba(255,255,255,0.2)" stroke-width="0.3"/>'
        + '</svg></div>';
      titleInner += '<div style="position:absolute;bottom:8px;left:6px;opacity:0.025;pointer-events:none;">'
        + '<svg width="80" height="80" viewBox="0 0 80 80" fill="none">'
        + '<rect x="5" y="5" width="70" height="70" rx="4" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>'
        + '<rect x="15" y="15" width="50" height="50" rx="3" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" stroke-dasharray="3 5"/>'
        + '</svg></div>';
      // Type badge + divider
      titleInner += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">';
      titleInner += '<div style="display:flex;align-items:center;gap:10px;">';
      titleInner += '<div style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.35);box-shadow:0 0 12px rgba(255,255,255,0.15);"></div>';
      titleInner += '<span style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.3em;color:rgba(255,255,255,0.3);">' + escHtml(item.type || 'RESEARCH') + '</span>';
      titleInner += '</div>';
      titleInner += '<div style="height:1px;flex:1;background:linear-gradient(90deg, rgba(255,255,255,0.06), transparent 60%);"></div>';
      if (sections.length > 0) {
        titleInner += '<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">';
        titleInner += '<span style="font-size:7.5px;font-weight:700;color:rgba(255,255,255,0.25);">' + sections.length + ' slides</span>';
        titleInner += '</div>';
      }
      titleInner += '</div>';
      // Gradient title text
      titleInner += '<h2 style="font-size:24px;font-weight:800;line-height:1.12;margin-bottom:20px;letter-spacing:-0.035em;background:linear-gradient(160deg, rgba(255,255,255,0.92) 10%, rgba(255,255,255,0.65) 60%, rgba(255,255,255,0.35) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">' + escHtml(item.title || 'Untitled') + '</h2>';
      // Accent divider
      titleInner += '<div style="position:relative;height:2px;margin-bottom:24px;"><div style="position:absolute;left:0;top:0;width:35%;height:100%;border-radius:2px;background:linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05), transparent);"></div></div>';
      // Summary with left accent
      if (item.summary) {
        titleInner += '<div style="display:flex;gap:12px;margin-bottom:20px;max-width:92%;">';
        titleInner += '<div style="width:2px;border-radius:2px;flex-shrink:0;margin-top:2px;background:linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.04), transparent);min-height:20px;"></div>';
        titleInner += '<p style="font-size:11px;color:rgba(255,255,255,0.38);line-height:1.85;font-weight:300;">' + escHtml(item.summary) + '</p>';
        titleInner += '</div>';
      }
      // Design progress on title
      if (designedCount < sections.length && progress.total > 0) {
        var titlePct = Math.round((progress.done / progress.total) * 100);
        titleInner += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;max-width:85%;">';
        titleInner += '<div style="flex:1;height:2px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,0.06);">';
        titleInner += '<div style="width:' + titlePct + '%;height:100%;border-radius:2px;transition:width 0.7s;background:linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.15));"></div>';
        titleInner += '</div>';
        titleInner += '<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.3);">Designing ' + progress.done + '/' + progress.total + '</span>';
        titleInner += '</div>';
      }
      // Topic pills
      if (item.topics && item.topics.length > 0) {
        titleInner += '<div style="margin-top:auto;display:flex;gap:8px;flex-wrap:wrap;">';
        item.topics.slice(0, 5).forEach(function(t) {
          titleInner += '<span style="padding:4px 12px;border-radius:8px;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.06);">' + escHtml(t) + '</span>';
        });
        titleInner += '</div>';
      }

      html += slideShell('TITLE', 1, totalSlides, titleInner);

    } else if (idx <= sections.length) {
      // ── Section Slide (matches Hub SlideCard section) ──
      var sectionIndex = idx - 1;
      var section = sections[sectionIndex];
      var sectionAccent = ACCENT_COLORS[sectionIndex % ACCENT_COLORS.length];
      var sectionInner = '';

      // Section heading with number badge + accent line
      sectionInner += '<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;margin-top:2px;">';
      // Number badge + vertical accent
      sectionInner += '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:2px;flex-shrink:0;">';
      sectionInner += '<span style="font-size:10px;font-weight:900;color:rgba(255,255,255,0.3);">' + String(sectionIndex + 1).padStart(2, '0') + '</span>';
      sectionInner += '<div style="width:1.5px;height:20px;border-radius:2px;background:linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04), transparent);"></div>';
      sectionInner += '</div>';
      // Heading text
      sectionInner += '<div style="flex:1;min-width:0;">';
      sectionInner += '<h3 style="font-size:16px;font-weight:700;line-height:1.3;letter-spacing:-0.015em;color:rgba(255,255,255,0.85);">' + escHtml(section.heading || 'Slide ' + (sectionIndex + 1)) + '</h3>';
      sectionInner += '</div>';
      sectionInner += '</div>';

      // Section body — designed HTML or fallback
      if (section.html) {
        sectionInner += '<div class="rh-slide-designed-inner">' + section.html + '</div>';
      } else {
        // Pre-design fallback with accent styling
        sectionInner += '<div style="flex:1;overflow-y:auto;padding-right:4px;">';
        sectionInner += '<div style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.7;white-space:pre-wrap;">' + escHtml(section.body || '').substring(0, 600) + '</div>';
        sectionInner += '<div style="margin-top:16px;display:flex;align-items:center;gap:6px;">';
        sectionInner += '<span class="rh-spinner"></span>';
        sectionInner += '<span style="font-size:9px;color:rgba(255,255,255,0.2);">Designing visual via Gemini...</span>';
        sectionInner += '</div>';
        sectionInner += '</div>';
      }

      // Per-slide design progress
      if (designedCount < sections.length && progress.total > 0) {
        sectionInner += '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding-left:4px;">';
        sectionInner += '<div style="flex:1;height:2px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,0.06);">';
        var secPct = Math.round((progress.done / progress.total) * 100);
        sectionInner += '<div style="width:' + secPct + '%;height:100%;border-radius:2px;transition:width 0.7s;background:linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.15));"></div>';
        sectionInner += '</div>';
        sectionInner += '<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.3);">Designing ' + progress.done + '/' + progress.total + '</span>';
        sectionInner += '</div>';
      }

      var secTitle = (section.heading || '').length <= 30 ? (section.heading || '').toUpperCase() : (section.heading || '').substring(0, 28).toUpperCase() + '…';
      html += slideShell(secTitle, idx + 1, totalSlides, sectionInner);

    } else {
      // ── Sources Slide ──
      var sourcesInner = '';
      sourcesInner += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;margin-top:4px;">';
      sourcesInner += '<div style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.2);"></div>';
      sourcesInner += '<span style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.3em;color:rgba(255,255,255,0.3);">Sources</span>';
      sourcesInner += '<div style="height:1px;flex:1;background:linear-gradient(90deg, rgba(255,255,255,0.06), transparent 60%);"></div>';
      sourcesInner += '</div>';
      sourcesInner += '<h3 style="font-size:16px;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:16px;">References & Citations</h3>';

      if (item.sourceUrls && item.sourceUrls.length > 0) {
        sourcesInner += '<div style="display:flex;flex-direction:column;gap:6px;">';
        item.sourceUrls.forEach(function(src, si) {
          var srcAccent = ACCENT_COLORS[si % ACCENT_COLORS.length];
          sourcesInner += '<a href="' + escHtml(src.url) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;text-decoration:none;color:rgba(255,255,255,0.5);font-size:10px;transition:all 0.2s;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.02);">';
          sourcesInner += '<div style="width:4px;height:4px;border-radius:50%;background:' + srcAccent + ';flex-shrink:0;"></div>';
          sourcesInner += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(src.label || src.url) + '</span>';
          sourcesInner += '<span style="font-size:8px;color:rgba(255,255,255,0.15);">↗</span>';
          sourcesInner += '</a>';
        });
        sourcesInner += '</div>';
      } else {
        sourcesInner += '<div style="color:rgba(255,255,255,0.2);font-size:11px;padding:20px 0;">No external sources referenced</div>';
      }

      html += slideShell('SOURCES', totalSlides, totalSlides, sourcesInner);
    }

    html += '</div>';
    return html;
  }

  // ─── Event binding ───────────────────────────────────────────────────
  function bindEvents() {
    if (!container) return;

    // Tab clicks
    container.querySelectorAll('.rh-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.view = btn.getAttribute('data-view');
        render();
      });
    });

    // Feed actions
    container.querySelectorAll('[data-action="brief"]').forEach(function(btn) {
      btn.addEventListener('click', requestBrief);
    });
    container.querySelectorAll('[data-action="go-research"]').forEach(function(btn) {
      btn.addEventListener('click', function() { state.view = 'research'; render(); });
    });
    container.querySelectorAll('[data-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var f = btn.getAttribute('data-filter');
        state.activeFilter = state.activeFilter === f ? null : f;
        render();
      });
    });
    container.querySelectorAll('[data-delete]').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteFeedItem(btn.getAttribute('data-delete')); });
    });

    // Topic actions
    var topicInput = container.querySelector('#rh-topic-input');
    if (topicInput) {
      topicInput.addEventListener('input', function() { state.newTopic = topicInput.value; });
      topicInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addTopic(); });
    }
    var urlInput = container.querySelector('#rh-url-input');
    if (urlInput) {
      urlInput.addEventListener('input', function() { state.newUrl = urlInput.value; });
      urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addTopic(); });
    }
    container.querySelectorAll('[data-action="add-topic"]').forEach(function(btn) {
      btn.addEventListener('click', addTopic);
    });
    container.querySelectorAll('[data-toggle]').forEach(function(btn) {
      btn.addEventListener('click', function() { toggleTopic(btn.getAttribute('data-toggle')); });
    });
    container.querySelectorAll('[data-remove-topic]').forEach(function(btn) {
      btn.addEventListener('click', function() { removeTopic(btn.getAttribute('data-remove-topic')); });
    });
    container.querySelectorAll('[data-research-topic]').forEach(function(btn) {
      btn.addEventListener('click', function() { doResearch(btn.getAttribute('data-research-topic')); });
    });

    // Research input
    var researchInput = container.querySelector('#rh-research-input');
    if (researchInput) {
      researchInput.addEventListener('input', function() { state.researchQuery = researchInput.value; });
      researchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doResearch(state.researchQuery); });
    }
    container.querySelectorAll('[data-action="do-research"]').forEach(function(btn) {
      btn.addEventListener('click', function() { doResearch(state.researchQuery); });
    });

    // Generate Slides buttons
    container.querySelectorAll('[data-gen-slides]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var itemId = btn.getAttribute('data-gen-slides');
        var countSelect = container.querySelector('[data-slide-count-for="' + itemId + '"]');
        var count = countSelect ? parseInt(countSelect.value, 10) : 8;
        generatePresentation(itemId, count);
      });
    });

    // Open slideshow (for items that already have type=slide with sections)
    container.querySelectorAll('[data-open-slideshow]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openSlideshow(btn.getAttribute('data-open-slideshow'));
      });
    });

    // Slideshow navigation
    container.querySelectorAll('[data-action="slide-back"]').forEach(function(btn) {
      btn.addEventListener('click', function() { state.view = 'feed'; state.slideShowItemId = null; render(); });
    });
    container.querySelectorAll('[data-action="slide-prev"]').forEach(function(btn) {
      btn.addEventListener('click', function() { if (state.slideIndex > 0) { state.slideIndex--; render(); } });
    });
    container.querySelectorAll('[data-action="slide-next"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = state.feedItems.find(function(i) { return i.id === state.slideShowItemId; });
        if (!item || !item.sections) return;
        var hasSrc = item.sourceUrls && item.sourceUrls.length > 0;
        var total = 1 + item.sections.length + (hasSrc ? 1 : 0);
        if (state.slideIndex < total - 1) { state.slideIndex++; render(); }
      });
    });
    container.querySelectorAll('[data-slide-goto]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.slideIndex = parseInt(btn.getAttribute('data-slide-goto'), 10);
        render();
      });
    });

    // Keyboard navigation for slideshow
    if (state.view === 'slideshow') {
      container.setAttribute('tabindex', '0');
      container.focus();
      container.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft' && state.slideIndex > 0) { e.preventDefault(); state.slideIndex--; render(); }
        if (e.key === 'ArrowRight') {
          var item = state.feedItems.find(function(i) { return i.id === state.slideShowItemId; });
          if (!item || !item.sections) return;
          var hasSrc = item.sourceUrls && item.sourceUrls.length > 0;
          var total = 1 + item.sections.length + (hasSrc ? 1 : 0);
          if (state.slideIndex < total - 1) { e.preventDefault(); state.slideIndex++; render(); }
        }
        if (e.key === 'Escape') { state.view = 'feed'; state.slideShowItemId = null; render(); }
      });
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Init ────────────────────────────────────────────────────────────
  function init() {
    var moduleContent = document.querySelector('#researchModule .module-content');
    if (!moduleContent) return;

    // Create container
    container = document.createElement('div');
    container.className = 'research-hub-native';
    container.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;';
    moduleContent.innerHTML = '';
    moduleContent.appendChild(container);

    // Load data
    loadTopics();
    loadFeed();
    loadPrompts();
  }

  // ─── Reinit on workspace switch ──────────────────────────────────────
  window.initResearchModule = function() {
    loadTopics();
    loadFeed();
    loadPrompts();
  };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 500); });
  } else {
    setTimeout(init, 500);
  }
})();
