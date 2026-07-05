/**
 * @fileoverview UIRenderer — Chat-based UI rendering for Form Sahayak.
 * Manages the Claude-inspired chat interface: sidebar, message bubbles,
 * greeting page, typing indicators, toasts, modals, and theming.
 * @module ui-renderer
 */

// ─────────────────────── Constants ─────────────────────────

const ISSUE_TYPE_LABELS = {
  general: 'Kuch aur problem hai',
  extraction: 'Galat information padh li',
  translation: 'Hindi/Hinglish theek nahi hai',
  ui: 'Button/Screen kaam nahi kar raha'
};

const FORM_COLORS = [
  'var(--accent-blue)', // Blue
  'var(--accent-saffron)', // Orange
  'var(--accent-green)', // Green
  '#AF52DE', // Purple
  '#FF2D55', // Pink
  '#5AC8FA', // Light Blue
  'var(--accent-gold)', // Yellow
  'var(--text-tertiary)'  // Gray
];

// ─────────────────────── UIRenderer ────────────────────────

export class UIRenderer {
  constructor() {
    this.elements = {};
    this._toastCounter = 0;
    this._feedbackModalEl = null;
    this._escHandler = null;
    this._lightboxEl = null;
    this._lightboxImages = [];
    this._lightboxIndex = 0;
    this._timestampInterval = null;

    // Callbacks set by app.js
    this.onEditSave = null;   // (bubbleEl, newText) => {}
    this.onRetry = null;      // (bubbleEl) => {}
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  init() {
    const ids = [
      'app', 'sidebar', 'sidebarToggle', 'sidebarClose', 'sidebarOverlay',
      'newChatBtn', 'chatSearchInput', 'chatList',
      'clearHistoryBtn', 'settingsBtn',
      'mainArea', 'chatTitle', 'chatMessages', 'chatGreeting',
      'chatInputArea', 'chatAttachBtn', 'chatCameraBtn', 'chatFileInput',
      'chatCameraInput', 'attachPreview',
      'chatTextInput', 'chatSendBtn', 'chatLangSelect', 'chatVoiceBtn',
      'themeToggle', 'shareBtn', 'whatsappShareBtn', 'analyticsBtn',
      'settingsOverlay', 'settingsModal', 'settingsClose',
      'voiceSpeedRange', 'storageUsed',
      'statForms', 'statTemplates', 'statFields', 'statLang',
      'toastContainer',
    ];

    ids.forEach((id) => {
      this.elements[id] = document.getElementById(id);
    });

    // Auto-resize textarea
    const textarea = this.elements.chatTextInput;
    if (textarea) {
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
      });
    }

    // Start timestamp auto-updater (every 30s)
    this._startTimestampUpdater();
  }

  // ───────────────────────── Sidebar ──────────────────────────

  toggleSidebar() {
    const sidebar = this.elements.sidebar;
    const overlay = this.elements.sidebarOverlay;
    if (!sidebar) return;

    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      this.closeSidebar();
    } else {
      sidebar.classList.add('open');
      if (overlay) {
        overlay.classList.remove('hidden');
        requestAnimationFrame(() => overlay.classList.add('visible'));
      }
    }
  }

  closeSidebar() {
    const sidebar = this.elements.sidebar;
    const overlay = this.elements.sidebarOverlay;
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.classList.add('hidden'), 300);
    }
  }

  /**
   * Render the chat list in the sidebar.
   * @param {Array<{id: number, title: string, createdAt: number, updatedAt: number}>} chats
   * @param {number|null} activeChatId
   */
  renderChatList(chats, activeChatId = null) {
    const list = this.elements.chatList;
    if (!list) return;

    list.innerHTML = '';

    if (!chats || chats.length === 0) {
      list.innerHTML = `
        <div class="chat-list-empty">
          <p>Koi chat nahi hai abhi</p>
          <p class="hint">Form ki photo upload karein!</p>
        </div>`;
      return;
    }

    // Group by date
    const groups = this._groupChatsByDate(chats);
    const fragment = document.createDocumentFragment();

    for (const [label, items] of groups) {
      const header = this._createEl('div', 'chat-date-group', label);
      fragment.appendChild(header);

      items.forEach(chat => {
        const item = this._createEl('div', 'chat-list-item');
        item.dataset.chatId = chat.id;
        if (chat.id === activeChatId) item.classList.add('active');

        const icon = this._createEl('div', 'chat-item-icon', '📄');
        const info = this._createEl('div', 'chat-item-info');
        const title = this._createEl('div', 'chat-item-title', chat.title);
        const time = this._createEl('div', 'chat-item-time', this._formatRelativeTime(chat.updatedAt));
        info.appendChild(title);
        info.appendChild(time);

        const deleteBtn = this._createEl('button', 'chat-item-delete');
        deleteBtn.innerHTML = '✕';
        deleteBtn.title = 'Delete chat';
        deleteBtn.dataset.chatId = chat.id;

        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(deleteBtn);
        fragment.appendChild(item);
      });
    }

    list.appendChild(fragment);
  }

  /**
   * Group chats by "Today", "Yesterday", "This Week", "Older"
   * @private
   */
  _groupChatsByDate(chats) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 7 * 86400000;

    const groups = new Map();
    groups.set('Today', []);
    groups.set('Yesterday', []);
    groups.set('This Week', []);
    groups.set('Older', []);

    chats.forEach(chat => {
      const t = chat.updatedAt || chat.createdAt;
      if (t >= today) groups.get('Today').push(chat);
      else if (t >= yesterday) groups.get('Yesterday').push(chat);
      else if (t >= weekAgo) groups.get('This Week').push(chat);
      else groups.get('Older').push(chat);
    });

    // Filter empty groups
    return [...groups.entries()].filter(([_, items]) => items.length > 0);
  }

  // ───────────────────── Chat Greeting ────────────────────────

  showGreeting() {
    const greeting = this.elements.chatGreeting;
    const messages = this.elements.chatMessages;
    if (!greeting || !messages) return;

    // Clear messages
    messages.innerHTML = '';
    messages.appendChild(greeting);
    greeting.classList.remove('hidden');
    greeting.style.display = '';

    // Update greeting based on time
    const hour = new Date().getHours();
    const titleEl = greeting.querySelector('.greeting-title');
    if (titleEl) {
      if (hour < 12) titleEl.textContent = 'Suprabhat! ☀️';
      else if (hour < 17) titleEl.textContent = 'Namaste! 🙏';
      else titleEl.textContent = 'Shubh Sandhya! 🌙';
    }
  }

  hideGreeting() {
    const greeting = this.elements.chatGreeting;
    if (greeting) {
      greeting.style.display = 'none';
    }
  }

  // ──────────────────── Message Bubbles ───────────────────────

  /**
   * Add a user message bubble.
   * @param {Object} options — { text?, imageDataUrls? }
   */
  addUserMessage({ text, imageDataUrls, timestamp }) {
    this.hideGreeting();
    const messages = this.elements.chatMessages;
    if (!messages) return;

    const bubble = this._createEl('div', 'message-bubble user');
    bubble.dataset.timestamp = timestamp || Date.now();
    bubble.dataset.role = 'user';

    // Role label
    const role = this._createEl('div', 'message-role');
    role.innerHTML = '<span class="message-role-icon">👤</span> You';
    bubble.appendChild(role);

    // Image thumbnails with lightbox support
    if (imageDataUrls && imageDataUrls.length > 0) {
      const imgContainer = this._createEl('div', 'msg-thumb-container');
      const MAX_VISIBLE = 3;
      const allUrls = [...imageDataUrls];

      imageDataUrls.forEach((url, i) => {
        if (i >= MAX_VISIBLE) return;
        const wrapper = this._createEl('div', 'msg-thumb-wrapper');
        wrapper.dataset.imgIndex = i;
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Uploaded form image ${i + 1}`;
        img.loading = 'lazy';
        wrapper.appendChild(img);

        // Badge for overflow on last visible
        if (i === MAX_VISIBLE - 1 && imageDataUrls.length > MAX_VISIBLE) {
          const badge = this._createEl('div', 'msg-thumb-badge', `+${imageDataUrls.length - MAX_VISIBLE}`);
          wrapper.appendChild(badge);
        }

        wrapper.addEventListener('click', () => {
          this.openLightbox(allUrls, i);
        });

        imgContainer.appendChild(wrapper);
      });
      bubble.appendChild(imgContainer);
    }

    // Text
    if (text) {
      const msgText = this._createEl('div', 'message-text', text);
      bubble.appendChild(msgText);
    }

    // Action bar
    bubble.appendChild(this._createMessageActions('user', bubble));

    messages.appendChild(bubble);
    this.scrollToBottom();
  }

  /**
   * Create an empty AI response bubble for progressive rendering.
   * @param {number} totalForms - Total number of expected forms
   * @returns {{ bubble: HTMLElement, timestamp: number, cardsContainer: HTMLElement, tocContainer: HTMLElement|null }}
   */
  createEmptyAIBubble(totalForms = 1) {
    const messages = this.elements.chatMessages;
    if (!messages) return null;

    const bubble = this._createEl('div', 'message-bubble ai');
    const timestamp = Date.now();
    bubble.dataset.timestamp = timestamp;
    bubble.dataset.role = 'ai';

    // Role label
    const role = this._createEl('div', 'message-role');
    role.innerHTML = '<span class="message-role-icon">🤖</span> Form Sahayak';
    bubble.appendChild(role);

    // TOC Container
    let tocContainer = null;
    if (totalForms > 1) {
      tocContainer = this._createEl('div', 'forms-nav');
      const tocLabel = this._createEl('span', null, `${totalForms} forms:`);
      tocLabel.style.cssText = 'font-size:11px;color:var(--text-tertiary);align-self:center;margin-right:8px;font-weight:600;';
      tocContainer.appendChild(tocLabel);
      bubble.appendChild(tocContainer);
    }

    // Create a container for the cards
    const cardsContainer = this._createEl('div', 'cards-container');
    
    // Add progressive typing indicator inside
    const indicator = this._createEl('div', 'typing-indicator');
    indicator.id = `bubbleTyping-${timestamp}`;
    const dots = this._createEl('div', 'typing-dots');
    dots.innerHTML = '<span></span><span></span><span></span>';
    indicator.appendChild(dots);
    const label = this._createEl('span', 'typing-label', 'Form Sahayak form analyze kar raha hai...');
    indicator.appendChild(label);
    
    // Slight margin adjustment so it looks good inside the bubble
    indicator.style.margin = '10px 0';
    cardsContainer.appendChild(indicator);

    bubble.appendChild(cardsContainer);

    // Add action bar at the end
    const actions = this._createMessageActions('ai', bubble);
    bubble.appendChild(actions);

    messages.appendChild(bubble);
    this.scrollToBottom();

    return { bubble, timestamp, cardsContainer, tocContainer };
  }

  /**
   * Add a single form card to an existing bubble (Progressive Rendering)
   */
  addFormCardToBubble(bubbleContext, form, idx, totalForms) {
    if (!bubbleContext || !bubbleContext.bubble) return;

    // Remove typing indicator if it exists (on first card render)
    const indicator = bubbleContext.cardsContainer.querySelector('.typing-indicator');
    if (indicator) {
      indicator.remove();
    }

    // Normalize format
    if (!form.sections && Array.isArray(form.fields) && form.fields.length > 0) {
      form.sections = [{ section_name: 'Sabhi Fields', icon: '📋', fields: form.fields }];
    }

    const card = this._createFormCard(form, bubbleContext.timestamp, idx, totalForms, new Set());
    bubbleContext.cardsContainer.appendChild(card);

    // Add TOC chip if multiple forms
    if (bubbleContext.tocContainer) {
      let shortName = form.form_name || `Form ${idx + 1}`;
      shortName = shortName.split('—')[0].split('(')[0].trim();
      if (shortName.length > 22) shortName = shortName.substring(0, 22) + '...';

      const chip = this._createEl('button', 'nav-chip', `${idx + 1}. ${shortName}`);
      const color = FORM_COLORS[idx % FORM_COLORS.length];
      chip.style.borderLeft = `3px solid ${color}`;

      chip.addEventListener('click', () => {
        card.classList.remove('collapsed');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        bubbleContext.tocContainer.querySelectorAll('.nav-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        setTimeout(() => chip.classList.remove('active'), 1200);
      });
      bubbleContext.tocContainer.appendChild(chip);
    }

    this.scrollToBottom();
  }

  /**
   * Add an error card to an existing bubble (Progressive Rendering)
   */
  addErrorCardToBubble(bubbleContext, err, idx) {
    if (!bubbleContext || !bubbleContext.bubble) return;

    const cardId = `form-card-${bubbleContext.timestamp}-${idx}`;
    const card = this._createEl('div', 'form-card error-card');
    card.id = cardId;
    card.style.borderColor = 'var(--error-red)';

    const header = this._createEl('div', 'card-header');
    const cardNum = this._createEl('div', 'card-num', (idx + 1).toString());
    cardNum.style.background = 'var(--error-red)';
    header.appendChild(cardNum);

    const titleWrap = this._createEl('div', 'card-title-wrap');
    const title = this._createEl('div', 'card-title', 'Analysis Failed');
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    card.appendChild(header);

    const cardBody = this._createEl('div', 'card-body');
    const errMsg = this._createEl('p', null, err.message || 'Form analyze nahi ho paya.');
    errMsg.style.color = 'var(--error-red)';
    cardBody.appendChild(errMsg);

    const retryBtn = this._createEl('button', 'error-retry-btn', '🔄 Phir se try karein');
    retryBtn.style.cssText = 'margin-top: 10px; padding: 6px 12px; border-radius: 6px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--glass-border); cursor: pointer; font-size: 12px;';
    retryBtn.onclick = () => {
      this.showToast('Please ek baar phir upload kijiye, retry logic jald aa raha hai.', 'info');
    };
    cardBody.appendChild(retryBtn);

    bubbleContext.cardsContainer.appendChild(card);
    this.scrollToBottom();
  }

  /**
   * Add an AI response bubble with structured form analysis.
   * @deprecated Use progressive rendering instead
   * @param {Object} result — parsed AI response { forms: [...] } or legacy format
   */
  addAIResultMessage(result) {
    const messages = this.elements.chatMessages;
    if (!messages) return;

    const bubble = this._createEl('div', 'message-bubble ai');
    const timestamp = Date.now();
    bubble.dataset.timestamp = timestamp;
    bubble.dataset.role = 'ai';

    // Role label
    const role = this._createEl('div', 'message-role');
    role.innerHTML = '<span class="message-role-icon">🤖</span> Form Sahayak';
    bubble.appendChild(role);

    // Normalize format: support legacy (fields at root) and new (sections)
    let formsList = (result.forms && Array.isArray(result.forms)) ? result.forms : [result];
    formsList = formsList.map(f => {
      if (!f.sections && Array.isArray(f.fields) && f.fields.length > 0) {
        return { ...f, sections: [{ section_name: 'Sabhi Fields', icon: '📋', fields: f.fields }] };
      }
      return f;
    });

    const hasMultiple = formsList.length > 1;

    // Detect common fields for cross-fill
    const commonLabels = new Set();
    formsList.forEach(form => {
      (form.sections || []).forEach(sec => {
        (sec.fields || []).forEach(f => {
          if (f.is_common) commonLabels.add(f.label.toLowerCase());
        });
      });
    });

    // Sticky TOC (prototype: forms-nav with nav-chip buttons)
    if (hasMultiple) {
      const toc = this._createEl('div', 'forms-nav');
      const tocLabel = this._createEl('span', null, `${formsList.length} forms:`);
      tocLabel.style.cssText = 'font-size:11px;color:var(--text-tertiary);align-self:center;margin-right:2px;';
      toc.appendChild(tocLabel);

      formsList.forEach((form, idx) => {
        let shortName = form.form_name || `Form ${idx + 1}`;
        // Extract short name (before — or ()
        shortName = shortName.split('—')[0].split('(')[0].trim();
        if (shortName.length > 22) shortName = shortName.substring(0, 22) + '...';

        const chip = this._createEl('button', 'nav-chip', `${idx + 1}. ${shortName}`);
        chip.addEventListener('click', () => {
          const target = bubble.querySelector(`#form-card-${timestamp}-${idx}`);
          if (target) {
            target.classList.remove('collapsed');
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            toc.querySelectorAll('.nav-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            setTimeout(() => chip.classList.remove('active'), 1200);
          }
        });
        toc.appendChild(chip);
      });
      bubble.appendChild(toc);
    }

    // Cross-fill banner
    if (hasMultiple && commonLabels.size > 0) {
      const banner = this._createEl('div', 'cross-fill-banner');
      const sampleFields = [...commonLabels].slice(0, 3).join(', ');
      banner.innerHTML = `
        <span class="cf-icon">⚡</span>
        <p><strong>Fill-once feature:</strong> ${commonLabels.size} fields (${sampleFields}...) forms mein same hain — highlighted hain blue mein.</p>
        <button class="cf-btn" onclick="this.parentElement.style.display='none'">Samjha</button>
      `;
      bubble.appendChild(banner);
    }

    // Render cards
    formsList.forEach((form, idx) => {
      const card = this._createFormCard(form, timestamp, idx, formsList.length, commonLabels);
      bubble.appendChild(card);
    });

    // Action bar
    bubble.appendChild(this._createMessageActions('ai', bubble));

    messages.appendChild(bubble);
    this.scrollToBottom();
  }

  /**
   * Create an individual AI result card for a form
   * @private
   */
  _createFormCard(form, timestamp, idx, totalForms = 1, commonLabels = new Set()) {
    const cardId = `form-card-${timestamp}-${idx}`;
    const card = this._createEl('div', 'form-card');
    card.id = cardId;

    const isKnown = (form.confidence === 'high' || form.confidence === 'medium');
    const totalFields = (form.sections || []).reduce((acc, sec) => acc + (sec.fields?.length || 0), 0);

    // ── Card Header ──
    const header = this._createEl('div', 'card-header');

    const cardNum = this._createEl('div', 'card-num', (idx + 1).toString());
    cardNum.style.background = FORM_COLORS[idx % FORM_COLORS.length];
    header.appendChild(cardNum);

    const titleWrap = this._createEl('div', 'card-title-wrap');
    const title = this._createEl('div', 'card-title', form.form_name || 'Form');
    const metaRow = this._createEl('div', 'card-meta-row');
    const badge = this._createEl('span', `card-badge ${isKnown ? 'badge-green' : 'badge-yellow'}`,
      isKnown ? '✓ Pehchaan liya' : '~ Possible match');
    const fCount = this._createEl('span', 'field-count', `${totalFields} fields`);
    metaRow.appendChild(badge);
    metaRow.appendChild(fCount);
    titleWrap.appendChild(title);
    titleWrap.appendChild(metaRow);
    header.appendChild(titleWrap);

    const collapseBtn = this._createEl('button', 'card-collapse-btn');
    collapseBtn.title = 'Collapse/Expand';
    collapseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
    collapseBtn.addEventListener('click', () => card.classList.toggle('collapsed'));
    header.appendChild(collapseBtn);

    card.appendChild(header);

    // ── Card Body ──
    const cardBody = this._createEl('div', 'card-body');

    if (form.purpose) {
      cardBody.appendChild(this._createEl('p', 'card-purpose', form.purpose));
    }

    // Documents
    if (Array.isArray(form.documents_needed) && form.documents_needed.length > 0) {
      const docsRow = this._createEl('div', 'docs-row');
      docsRow.appendChild(this._createEl('div', 'docs-label', '📎 ZAROORI DASTAVEZ'));
      const docsList = this._createEl('ul', 'docs-list');
      form.documents_needed.forEach(d => {
        const li = document.createElement('li');
        li.textContent = d;
        docsList.appendChild(li);
      });
      docsRow.appendChild(docsList);
      cardBody.appendChild(docsRow);
    }

    // Handwriting Notes
    if (form.handwriting_notes && typeof form.handwriting_notes === 'string' && form.handwriting_notes.trim()) {
      const hwRow = this._createEl('div', 'docs-row');
      hwRow.style.borderColor = 'var(--accent-gold, #e6c84a)';
      hwRow.style.background = 'rgba(230,200,74,.1)';
      hwRow.appendChild(this._createEl('div', 'docs-label', '✍️ HANDWRITING NOTES'));
      hwRow.querySelector('.docs-label').style.color = 'var(--accent-gold, #e6c84a)';
      const hwText = this._createEl('p', null, form.handwriting_notes);
      hwText.style.fontSize = '12.5px';
      hwRow.appendChild(hwText);
      cardBody.appendChild(hwRow);
    }

    // Sections with search + progress
    if (Array.isArray(form.sections) && form.sections.length > 0) {
      // Search input
      const searchWrap = this._createEl('div', 'card-search-wrap');
      searchWrap.innerHTML = `<span class="card-search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>`;
      const searchInput = this._createEl('input', 'card-search');
      searchInput.type = 'text';
      searchInput.placeholder = 'Is form mein field dhoondein...';
      searchWrap.appendChild(searchInput);
      cardBody.appendChild(searchWrap);

      // Progress bar
      const progWrap = this._createEl('div', 'progress-wrap');
      const progBar = this._createEl('div', 'progress-bar');
      const progFill = this._createEl('div', 'progress-fill');
      progFill.id = `prog-${cardId}`;
      progFill.style.width = '0%';
      progBar.appendChild(progFill);
      const progTxt = this._createEl('span', 'progress-text', `0/${totalFields} fields`);
      progTxt.id = `progTxt-${cardId}`;
      progWrap.appendChild(progBar);
      progWrap.appendChild(progTxt);
      cardBody.appendChild(progWrap);

      // Section accordions
      const sectionsList = this._createEl('div', 'sections-list');
      let globalFieldIndex = 0;

      form.sections.forEach(sec => {
        const secAcc = this._createEl('div', 'section-acc open');

        const secHead = this._createEl('div', 'section-head');
        secHead.innerHTML = `
          ${sec.icon || '📋'} ${sec.section_name || 'Fields'}
          <span class="s-count">${sec.fields?.length || 0}</span>
          <svg class="s-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        `;
        secHead.addEventListener('click', () => secAcc.classList.toggle('open'));
        secAcc.appendChild(secHead);

        const secBody = this._createEl('div', 'section-body');
        if (sec.fields) {
          this._renderFields(sec.fields, secBody, globalFieldIndex, cardId, commonLabels);
          globalFieldIndex += sec.fields.length;
        }
        secAcc.appendChild(secBody);
        sectionsList.appendChild(secAcc);
      });

      cardBody.appendChild(sectionsList);

      // Search filtering
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        sectionsList.querySelectorAll('.field-row').forEach(row => {
          const fl = row.querySelector('.fl')?.textContent.toLowerCase() || '';
          const fe = row.querySelector('.fe')?.textContent.toLowerCase() || '';
          row.classList.toggle('hidden-search', !!query && !fl.includes(query) && !fe.includes(query));
        });
      });
    }

    // Tips
    if (form.tips && typeof form.tips === 'string' && form.tips.trim()) {
      const tipsCard = this._createEl('div', 'tips-card');
      tipsCard.appendChild(this._createEl('div', 'tips-label', '💡 DHYAN RAKHEIN'));
      tipsCard.appendChild(this._createEl('p', null, form.tips));
      cardBody.appendChild(tipsCard);
    }

    // EMI Calculator
    const resultString = JSON.stringify(form).toLowerCase();
    if (resultString.includes('loan') || resultString.includes('emi') || resultString.includes('interest')) {
      const emiCard = this._createEl('div', 'emi-card');
      const emiId = `emi-${timestamp}-${idx}`;
      emiCard.innerHTML = `
        <h4 style="margin-top:0; margin-bottom:10px; color:var(--text-primary);">🧮 EMI Calculator</h4>
        <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:15px;">
          <div>
            <label style="display:block; font-size:12px; margin-bottom:4px;">Loan Amount (₹)</label>
            <input type="number" step="any" id="${emiId}-amount" style="width:100%; padding:8px; border-radius:6px; border:1px solid var(--glass-border); background:var(--bg-primary); color:var(--text-primary);">
          </div>
          <div style="display:flex; gap:10px;">
            <div style="flex:1;">
              <label style="display:block; font-size:12px; margin-bottom:4px;">Interest (%)</label>
              <input type="number" step="any" id="${emiId}-rate" style="width:100%; padding:8px; border-radius:6px; border:1px solid var(--glass-border); background:var(--bg-primary); color:var(--text-primary);">
            </div>
            <div style="flex:1;">
              <label style="display:block; font-size:12px; margin-bottom:4px;">Years</label>
              <input type="number" step="any" id="${emiId}-years" style="width:100%; padding:8px; border-radius:6px; border:1px solid var(--glass-border); background:var(--bg-primary); color:var(--text-primary);">
            </div>
          </div>
        </div>
        <button id="${emiId}-btn" class="send-btn" style="width:100%; padding:8px; background:var(--accent-saffron); color:white; border-radius:6px; margin-bottom:10px;">Calculate</button>
        <div id="${emiId}-result" style="font-weight:bold; color:var(--accent-saffron); text-align:center; display:none;"></div>
      `;

      const calcBtn = emiCard.querySelector(`#${emiId}-btn`);
      if (calcBtn) {
        calcBtn.addEventListener('click', () => {
          const p = parseFloat(emiCard.querySelector(`#${emiId}-amount`).value);
          const r = parseFloat(emiCard.querySelector(`#${emiId}-rate`).value);
          const n = parseFloat(emiCard.querySelector(`#${emiId}-years`).value);
          if (p && r && n) {
            const rMonthly = r / 12 / 100;
            const months = n * 12;
            const emi = (p * rMonthly * Math.pow(1 + rMonthly, months)) / (Math.pow(1 + rMonthly, months) - 1);
            const resDiv = emiCard.querySelector(`#${emiId}-result`);
            resDiv.textContent = `Monthly EMI: ₹${emi.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            resDiv.style.display = 'block';
          }
        });
      }
      cardBody.appendChild(emiCard);
    }

    // Action buttons row (Wizard and PDF download)
    const actionsRow = this._createEl('div', 'result-actions-row');

    const wizardBtn = this._createEl('button', 'start-wizard-btn', '🪄 Start Wizard');
    wizardBtn.type = 'button';
    wizardBtn.dataset.formIndex = idx;

    const pdfBtn = this._createEl('button', 'download-pdf-btn', '📄 Download PDF');
    pdfBtn.type = 'button';
    pdfBtn.dataset.formIndex = idx;

    actionsRow.appendChild(wizardBtn);
    actionsRow.appendChild(pdfBtn);
    cardBody.appendChild(actionsRow);

    card.appendChild(cardBody);
    return card;
  }

  /**
   * Add a simple AI text response bubble (for follow-up questions).
   * @param {string} text
   */
  addAITextMessage(text, timestamp) {
    const messages = this.elements.chatMessages;
    if (!messages) return;

    const bubble = this._createEl('div', 'message-bubble ai');
    bubble.dataset.timestamp = timestamp || Date.now();
    bubble.dataset.role = 'ai';
    const role = this._createEl('div', 'message-role');
    role.innerHTML = '<span class="message-role-icon">🤖</span> Form Sahayak';
    bubble.appendChild(role);

    const msgText = this._createEl('div', 'message-text', text);
    bubble.appendChild(msgText);

    // Action bar
    bubble.appendChild(this._createMessageActions('ai', bubble));

    messages.appendChild(bubble);
    this.scrollToBottom();
  }

  /**
   * Show typing indicator.
   * @returns {HTMLElement} the indicator element (for removal)
   */
  addTypingIndicator() {
    const messages = this.elements.chatMessages;
    if (!messages) return null;

    const indicator = this._createEl('div', 'typing-indicator');
    indicator.id = 'typingIndicator';

    const dots = this._createEl('div', 'typing-dots');
    dots.innerHTML = '<span></span><span></span><span></span>';
    indicator.appendChild(dots);

    const label = this._createEl('span', 'typing-label', 'Form Sahayak soch raha hai...');
    indicator.appendChild(label);

    messages.appendChild(indicator);
    this.scrollToBottom();
    return indicator;
  }

  removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  /**
   * Restore messages from DB when loading a past chat.
   * @param {Array} messages — from ChatDB.getMessages()
   */
  restoreMessages(messages) {
    const container = this.elements.chatMessages;
    if (!container) return;

    this.hideGreeting();
    // Clear existing messages except greeting
    const greeting = this.elements.chatGreeting;
    container.innerHTML = '';
    if (greeting) container.appendChild(greeting);

    messages.forEach(msg => {
      const ts = msg.createdAt || msg.timestamp || Date.now();
      if (msg.role === 'user') {
        this.addUserMessage({
          text: msg.content,
          imageDataUrls: msg.imageDataUrls,
          timestamp: ts
        });
      } else if (msg.role === 'ai') {
        if (msg.resultData) {
          this.addAIResultMessage(msg.resultData);
        } else {
          this.addAITextMessage(msg.content, ts);
        }
      }
    });
  }

  // ──────────────────── Field Rendering ──────────────────────

  /**
   * Render fields grouped by category into a container.
   * @param {Array} fields
   * @param {HTMLElement} container
   * @private
   */
  _renderFields(fields, container, startIndex = 0, cardId, commonLabels = new Set()) {
    fields.forEach((f, idx) => {
      const globalIdx = startIndex + idx;
      const labelLower = (f.label || '').toLowerCase();
      const isCommon = commonLabels.has(labelLower);

      const row = this._createEl('div', `field-row ${isCommon ? 'cf-highlight' : ''}`);
      row.dataset.label = labelLower;

      // Field Number (01, 02)
      const num = this._createEl('span', 'fn', String(globalIdx + 1).padStart(2, '0'));
      row.appendChild(num);

      // Field Label
      const fl = this._createEl('span', 'fl', f.label || '');
      row.appendChild(fl);

      // Field Explanation
      const fe = this._createEl('span', 'fe', f.explanation || '');
      row.appendChild(fe);

      // Example rendering
      if (f.example && f.example.trim()) {
        const fex = this._createEl('div', 'fex');
        const dispType = this._getDisplayType(f.example, f.display_type);
        if (dispType === 'boxed') {
          const chars = f.example.replace(/\s/g, '·').split('');
          chars.forEach(c => {
            const box = this._createEl('span', 'box', c === '·' ? '' : c);
            fex.appendChild(box);
          });
        } else {
          const plainEx = this._createEl('span', 'plain-ex', `"${f.example}"`);
          fex.appendChild(plainEx);
        }
        row.appendChild(fex);
      }

      // Editable Input (Fill once, apply everywhere)
      const syncKey = this._getSyncKey(f.label);
      const inputWrap = this._createEl('div', 'field-input-wrap');
      inputWrap.style.gridColumn = '2';
      inputWrap.style.marginTop = '6px';

      const input = this._createEl('input', 'sync-input');
      input.type = 'text';
      input.placeholder = `e.g. ${f.example || ''}`;
      input.dataset.syncKey = syncKey;

      input.addEventListener('input', (e) => {
        const val = e.target.value;
        // Sync all inputs with the same syncKey across the entire chat
        document.querySelectorAll(`.sync-input[data-sync-key="${syncKey}"]`).forEach(el => {
          if (el !== e.target) {
            el.value = val;
            el.classList.add('synced-flash');
            setTimeout(() => el.classList.remove('synced-flash'), 500);
          }
        });
      });

      inputWrap.appendChild(input);
      row.appendChild(inputWrap);

      // Voice + Feedback + Checkbox buttons
      const actions = this._createEl('div', 'field-actions');
      actions.style.gridColumn = '2';
      actions.style.marginTop = '2px';

      // Checkbox
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'field-check-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'field-done-check';
      checkbox.dataset.fieldIndex = globalIdx;

      // Update progress bar when checked
      checkbox.addEventListener('change', () => {
        const card = document.getElementById(cardId);
        if (card) {
          const total = card.querySelectorAll('.field-done-check').length;
          const checked = card.querySelectorAll('.field-done-check:checked').length;
          const progFill = card.querySelector(`#prog-${cardId}`);
          const progTxt = card.querySelector(`#progTxt-${cardId}`);
          if (progFill) progFill.style.width = `${(checked / total) * 100}%`;
          if (progTxt) progTxt.textContent = `${checked}/${total} fields`;
        }
      });

      const checkText = document.createTextNode(' Done');
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(checkText);
      actions.appendChild(checkboxLabel);

      const voiceBtn = this._createEl('button', 'field-voice-btn', '🔊');
      voiceBtn.type = 'button';
      voiceBtn.dataset.fieldIndex = globalIdx;
      voiceBtn.title = `Field ${globalIdx + 1} sunein`;
      voiceBtn.addEventListener('click', () => {
        const textToRead = `${f.label}. ${f.explanation || ''}`;
        if (window.__formSahayak && window.__formSahayak.speech) {
          window.__formSahayak.speech.speakText(textToRead);
        }
      });

      const fbBtn = this._createEl('button', 'field-feedback-btn', '👎');
      fbBtn.type = 'button';
      fbBtn.dataset.fieldIndex = globalIdx;
      fbBtn.title = `Feedback`;
      fbBtn.addEventListener('click', () => {
        this.showFeedbackModal(f.label, (data) => {
          console.log('Feedback submitted:', data);
          this.showToast('Feedback saved ✓ Shukriya!', 'success');
        });
      });

      actions.appendChild(voiceBtn);
      actions.appendChild(fbBtn);
      row.appendChild(actions);

      container.appendChild(row);
    });
  }

  _getDisplayType(example, explicitType) {
    if (explicitType === 'boxed' || explicitType === 'plain') return explicitType;
    return (example && example.length <= 15 && !example.includes(' ')) ? 'boxed' : 'plain';
  }

  /**
   * Render example value as boxed character cells.
   * @param {string} example
   * @returns {HTMLElement}
   */
  renderExampleBoxes(example) {
    const wrapper = this._createEl('div', 'box-grid');
    const chars = example.split('');
    chars.forEach(ch => {
      const cell = this._createEl('span', 'box-cell', ch);
      if (ch === ' ') cell.classList.add('space');
      else cell.classList.add('filled');
      wrapper.appendChild(cell);
    });
    return wrapper;
  }

  _getSyncKey(label) {
    if (!label) return 'unknown';
    const norm = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.includes('name')) return 'name';
    if (norm.includes('mobile') || norm.includes('phone') || norm.includes('contact')) return 'mobile';
    if (norm.includes('aadhaar') || norm.includes('aadhar') || norm.includes('uid')) return 'aadhaar';
    if (norm.includes('pan')) return 'pan';
    if (norm.includes('dob') || norm.includes('dateofbirth')) return 'dob';
    if (norm.includes('email')) return 'email';
    if (norm.includes('address')) return 'address';
    return norm;
  }

  // ──────────────────── Attachment Preview ───────────────────

  /**
   * Show image previews in the input area.
   * @param {Array<{dataUrl: string}>} images
   * @param {number[]} [groups] Array of form numbers matching each image index
   */
  renderAttachPreview(images, groups = []) {
    const strip = this.elements.attachPreview;
    if (!strip) return;

    strip.innerHTML = '';

    if (!images || images.length === 0) {
      strip.classList.add('hidden');
      return;
    }

    strip.classList.remove('hidden');

    images.forEach((img, idx) => {
      const thumb = this._createEl('div', 'preview-thumb');
      const imgEl = document.createElement('img');
      imgEl.src = img.dataUrl;
      imgEl.alt = `Image ${idx + 1}`;
      imgEl.style.cursor = 'pointer';
      imgEl.addEventListener('click', () => {
        const allUrls = images.map(i => i.dataUrl);
        this.openLightbox(allUrls, idx);
      });

      const removeBtn = this._createEl('button', 'preview-remove', '✕');
      removeBtn.dataset.index = idx;

      thumb.appendChild(imgEl);
      thumb.appendChild(removeBtn);

      if (groups && groups[idx]) {
        const formIndex = groups[idx] - 1; // groups is 1-indexed (Form 1, Form 2)
        const tag = this._createEl('div', 'preview-group-tag', `Form ${groups[idx]}`);
        tag.style.background = FORM_COLORS[formIndex % FORM_COLORS.length];
        thumb.appendChild(tag);
      }

      strip.appendChild(thumb);
    });
  }

  // ──────────────────── Send Button State ────────────────────

  updateSendButton(hasContent) {
    const btn = this.elements.chatSendBtn;
    if (btn) btn.disabled = !hasContent;
  }

  // ──────────────────── Chat Title ───────────────────────────

  setChatTitle(title) {
    const el = this.elements.chatTitle;
    if (el) el.textContent = title || 'Form Sahayak';
  }

  // ──────────────────── Scroll ───────────────────────────────

  scrollToBottom() {
    const container = this.elements.chatMessages;
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  // ──────────────────── Settings Modal ──────────────────────

  openSettings() {
    const modal = this.elements.settingsModal;
    if (modal && modal.classList.contains('hidden')) {
      this.toggleSettings();
    }
  }

  toggleSettings() {
    const modal = this.elements.settingsModal;
    const overlay = this.elements.settingsOverlay;
    if (!modal) return;

    const isHidden = modal.classList.contains('hidden');
    if (isHidden) {
      modal.classList.remove('hidden');
      if (overlay) overlay.classList.remove('hidden');
    } else {
      this.closeSettings();
    }
  }

  closeSettings() {
    const modal = this.elements.settingsModal;
    const overlay = this.elements.settingsOverlay;
    if (modal) modal.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
  }

  updateStorageStats(stats) {
    const el = this.elements.storageUsed;
    if (el && stats) {
      el.textContent = `${stats.chats} chats, ${stats.estimatedSizeKB} KB`;
    }
  }

  // ──────────────────── Theme ───────────────────────────────

  setTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (_) { }
  }

  getCurrentTheme() {
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (_) { }
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    }
    return 'dark';
  }

  // ──────────────────── Toast ────────────────────────────────

  showToast(message, type = 'info', duration = 3500) {
    const container = this.elements.toastContainer;
    if (!container) return;

    const toast = this._createEl('div', `toast toast-${type}`);
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, duration);
  }

  // ──────────────────── Feedback Modal ──────────────────────

  showFeedbackModal(fieldLabel, onSubmit) {
    this.hideFeedbackModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '601';

    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.style.zIndex = '602';
    modal.style.maxWidth = '400px';

    const title = this._createEl('h3', null, `Feedback — ${fieldLabel}`);
    Object.assign(title.style, { margin: '0 0 16px', fontSize: '1.1rem', fontWeight: '700' });
    modal.appendChild(title);

    const select = document.createElement('select');
    select.style.cssText = 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--glass-border);font-family:inherit;margin-bottom:14px;background:var(--bg-input);color:var(--text-primary);';
    Object.entries(ISSUE_TYPE_LABELS).forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    modal.appendChild(select);

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Aapka feedback...';
    textarea.rows = 3;
    textarea.style.cssText = 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--glass-border);font-family:inherit;resize:vertical;margin-bottom:16px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;';
    modal.appendChild(textarea);

    const btnRow = this._createEl('div', null);
    btnRow.style.cssText = 'display:flex;gap:10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;padding:10px;border-radius:8px;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-primary);cursor:pointer;';
    cancelBtn.addEventListener('click', () => this.hideFeedbackModal());

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Bhejein';
    submitBtn.style.cssText = 'flex:1;padding:10px;border-radius:8px;background:var(--accent-saffron);color:#fff;cursor:pointer;font-weight:600;';
    submitBtn.addEventListener('click', () => {
      if (typeof onSubmit === 'function') {
        onSubmit({ issueType: select.value, comment: textarea.value.trim() });
      }
      this.hideFeedbackModal();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    modal.appendChild(btnRow);

    overlay.addEventListener('click', () => this.hideFeedbackModal());

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    this._feedbackModalEl = { overlay, modal };
  }

  hideFeedbackModal() {
    if (this._feedbackModalEl) {
      const { overlay, modal } = this._feedbackModalEl;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
      if (modal?.parentNode) modal.parentNode.removeChild(modal);
      this._feedbackModalEl = null;
    }
  }

  // ──────────────────── Wizard UI ──────────────────────────────

  showWizard(fields, onNext, onPrev, onClose, currentIdx = 0, formName = '', stateManager = null) {
    this.hideWizard();
    if (!fields || !fields.length) return;

    const overlay = this._createEl('div', 'modal-overlay');
    overlay.id = 'wizardOverlay';
    const modal = this._createEl('div', 'wizard-modal');
    modal.id = 'wizardModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Header
    const header = this._createEl('div', 'wizard-header');
    const headerText = formName ? `${formName} — Step ${currentIdx + 1} of ${fields.length}` : `Step ${currentIdx + 1} of ${fields.length}`;
    const title = this._createEl('h3', null, headerText);
    const closeBtn = this._createEl('button', 'icon-btn', '✖');
    closeBtn.addEventListener('click', onClose);
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body (Field info)
    const body = this._createEl('div', 'wizard-body');
    const field = fields[currentIdx];

    const fLabel = this._createEl('h2', 'wizard-field-label', field.label);
    const fExplain = this._createEl('p', 'wizard-field-explain', field.explanation);
    body.appendChild(fLabel);
    body.appendChild(fExplain);

    // Phase 5: Interactive Input Field
    if (stateManager) {
      const inputWrapper = this._createEl('div', 'wizard-input-wrapper');
      const inputEl = this._createEl('input', 'wizard-text-input');
      inputEl.type = 'text';
      inputEl.placeholder = 'Aapna jawab yahan type karein...';
      inputEl.value = stateManager.get(field.label) || '';
      
      inputEl.addEventListener('input', (e) => {
        stateManager.set(field.label, e.target.value);
      });
      
      inputWrapper.appendChild(inputEl);
      body.appendChild(inputWrapper);
      
      // Auto-focus input
      setTimeout(() => inputEl.focus(), 50);
    }

    if (field.example) {
      const displayType = this._getDisplayType(field.example, field.display_type);
      const exWrapper = this._createEl('div', 'wizard-example-wrapper');
      exWrapper.innerHTML = `<strong>Example:</strong><br/>`;
      if (displayType === 'boxed') {
        exWrapper.appendChild(this.renderExampleBoxes(field.example));
      } else {
        exWrapper.innerHTML += `<div class="example-pill">${field.example}</div>`;
      }
      body.appendChild(exWrapper);
    }

    if (field.tips) {
      const fTips = this._createEl('div', 'wizard-field-tips', `💡 ${field.tips}`);
      body.appendChild(fTips);
    }

    modal.appendChild(body);

    // Footer (Nav buttons)
    const footer = this._createEl('div', 'wizard-footer');
    const prevBtn = this._createEl('button', 'wizard-nav-btn', '← Back');
    prevBtn.disabled = currentIdx === 0;
    prevBtn.addEventListener('click', () => onPrev(currentIdx));

    const nextText = currentIdx === fields.length - 1 ? 'Finish ✓' : 'Next →';
    const nextBtn = this._createEl('button', 'wizard-nav-btn primary', nextText);
    nextBtn.addEventListener('click', () => onNext(currentIdx));

    footer.appendChild(prevBtn);
    footer.appendChild(nextBtn);
    modal.appendChild(footer);

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // Auto-read
    setTimeout(() => {
      const textToRead = `${field.label}. ${field.explanation}`;
      window.__formSahayak?.speech?.speakText(textToRead);
    }, 300);
  }

  hideWizard() {
    const overlay = document.getElementById('wizardOverlay');
    const modal = document.getElementById('wizardModal');
    if (overlay) overlay.remove();
    if (modal) modal.remove();
    window.__formSahayak?.speech?.stop();
  }

  // ──────────────────── Progress Trackers ──────────────────────

  updateChecklistProgress(done, total) {
    const label = document.getElementById('checklistLabel');
    const bar = document.getElementById('checklistBar');
    if (label && bar) {
      label.textContent = `${done}/${total} fields done`;
      const pct = Math.round((done / total) * 100);
      bar.style.width = `${pct}%`;
      if (pct === 100) {
        bar.style.background = 'var(--accent-emerald)';
      } else {
        bar.style.background = 'var(--accent-saffron)';
      }
    }
  }

  updateDocReadiness(done, total) {
    const badge = document.getElementById('docReadinessBadge');
    const banner = document.getElementById('docReadyBanner');
    if (badge) {
      badge.textContent = `${done}/${total} ready`;
      if (done === total && total > 0) {
        badge.style.background = 'rgba(5, 150, 105, 0.12)';
        badge.style.color = 'var(--accent-emerald)';
        badge.style.borderColor = 'rgba(5, 150, 105, 0.2)';
        if (banner) banner.classList.remove('hidden');
      } else {
        badge.style.background = 'var(--glass-bg)';
        badge.style.color = 'var(--text-secondary)';
        badge.style.borderColor = 'var(--glass-border)';
        if (banner) banner.classList.add('hidden');
      }
    }
  }

  // ──────────────────── Message Actions ──────────────────────

  /**
   * Create action bar for a message bubble.
   * @param {'user'|'ai'} type
   * @param {HTMLElement} bubbleEl
   * @returns {HTMLElement}
   */
  _createMessageActions(type, bubbleEl) {
    const meta = this._createEl('div', 'meta');
    const actBar = this._createEl('div', 'act-bar');

    // Copy button (always)
    const copyBtn = this._createEl('button', 'act copy-btn');
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy`;
    copyBtn.title = 'Copy message text';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleCopy(bubbleEl, copyBtn);
    });
    actBar.appendChild(copyBtn);

    // Edit button (user messages only)
    if (type === 'user') {
      const editBtn = this._createEl('button', 'act edit-btn');
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit`;
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleEdit(bubbleEl, editBtn);
      });
      actBar.appendChild(editBtn);

      // Retry button (user messages — regenerate AI response)
      const retryBtn = this._createEl('button', 'act retry-btn');
      retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>Retry`;
      retryBtn.title = 'Retry — regenerate AI response';
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof this.onRetry === 'function') {
          this.onRetry(bubbleEl);
        }
      });
      actBar.appendChild(retryBtn);
    }
    meta.appendChild(actBar);

    // Date tooltip (always)
    const dateEl = this._createEl('span', 'meta-date');
    dateEl.dataset.timestampEl = 'true';
    meta.appendChild(dateEl);

    return meta;
  }

  /**
   * Handle copy button click.
   */
  _handleCopy(bubbleEl, copyBtn) {
    const textEl = bubbleEl.querySelector('.message-text');
    // The result card uses class 'form-card', not 'ai-result-card'
    const cardEl = bubbleEl.querySelector('.form-card') || bubbleEl.querySelector('.ai-result-card');
    let copyText = '';

    if (textEl) {
      copyText = textEl.textContent;
    } else if (cardEl) {
      copyText = cardEl.innerText;
    } else {
      // Fallback: grab all text from the bubble itself (excluding action bar)
      const actBar = bubbleEl.querySelector('.act-bar');
      if (actBar) actBar.style.display = 'none';
      copyText = bubbleEl.innerText;
      if (actBar) actBar.style.display = '';
    }

    if (!copyText.trim()) return;

    navigator.clipboard.writeText(copyText).then(() => {
      const originalHTML = copyBtn.innerHTML;
      copyBtn.innerHTML = '✓ Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = originalHTML;
        copyBtn.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      this.showToast('Copy nahi ho paya', 'error');
    });
  }

  /**
   * Handle edit button click — convert message text to inline textarea.
   */
  _handleEdit(bubbleEl, editBtn) {
    const textEl = bubbleEl.querySelector('.message-text');
    if (!textEl) return;

    // Prevent double-editing
    if (bubbleEl.querySelector('.message-edit-area')) return;

    const originalText = textEl.textContent;
    editBtn.classList.add('editing');
    editBtn.innerHTML = '✏️ Editing...';

    // Hide original text
    textEl.style.display = 'none';

    // Create edit area
    const editArea = this._createEl('div', 'message-edit-area');
    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.rows = 3;
    editArea.appendChild(textarea);

    const btnRow = this._createEl('div', 'message-edit-btns');
    const cancelBtn = this._createEl('button', 'edit-cancel-btn', 'Cancel');
    const saveBtn = this._createEl('button', 'edit-save-btn', '✓ Save');

    cancelBtn.addEventListener('click', () => {
      textEl.style.display = '';
      editArea.remove();
      editBtn.classList.remove('editing');
      editBtn.innerHTML = '✏️ Edit';
    });

    saveBtn.addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (!newText) return;

      textEl.textContent = newText;
      textEl.style.display = '';
      editArea.remove();
      editBtn.classList.remove('editing');
      editBtn.innerHTML = '✏️ Edit';

      if (typeof this.onEditSave === 'function') {
        this.onEditSave(bubbleEl, newText);
      }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    editArea.appendChild(btnRow);

    // Insert after the text element
    textEl.parentNode.insertBefore(editArea, textEl.nextSibling);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  // ──────────────────── Image Lightbox ────────────────────────

  /**
   * Open lightbox with given images.
   * @param {string[]} images — array of image URLs
   * @param {number} startIndex
   */
  openLightbox(images, startIndex = 0) {
    if (!images || images.length === 0) return;
    this.closeLightbox(); // cleanup any existing

    this._lightboxImages = images;
    this._lightboxIndex = startIndex;

    // Create overlay
    const overlay = this._createEl('div', 'lightbox-overlay');
    overlay.id = 'lightboxOverlay';

    // Close button
    const closeBtn = this._createEl('button', 'lightbox-close-btn', '✕');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLightbox();
    });
    overlay.appendChild(closeBtn);

    // Content
    const content = this._createEl('div', 'lightbox-content');
    content.addEventListener('click', (e) => e.stopPropagation());
    const img = document.createElement('img');
    img.id = 'lightboxImage';
    img.src = images[startIndex];
    img.alt = `Image ${startIndex + 1} of ${images.length}`;
    content.appendChild(img);
    overlay.appendChild(content);

    // Nav buttons (if multiple images)
    if (images.length > 1) {
      const prevBtn = this._createEl('button', 'lightbox-nav-btn prev', '‹');
      prevBtn.id = 'lightboxPrev';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._lightboxNavigate(-1);
      });
      overlay.appendChild(prevBtn);

      const nextBtn = this._createEl('button', 'lightbox-nav-btn next', '›');
      nextBtn.id = 'lightboxNext';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._lightboxNavigate(1);
      });
      overlay.appendChild(nextBtn);

      // Counter
      const counter = this._createEl('span', 'lightbox-counter');
      counter.id = 'lightboxCounter';
      counter.textContent = `${startIndex + 1} / ${images.length}`;
      overlay.appendChild(counter);
    }

    // Background click to close
    overlay.addEventListener('click', () => this.closeLightbox());

    // Keyboard handler
    this._lightboxKeyHandler = (e) => {
      if (e.key === 'Escape') this.closeLightbox();
      else if (e.key === 'ArrowLeft') this._lightboxNavigate(-1);
      else if (e.key === 'ArrowRight') this._lightboxNavigate(1);
    };
    document.addEventListener('keydown', this._lightboxKeyHandler);

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    this._lightboxEl = overlay;

    this._updateLightboxNav();
  }

  /**
   * Navigate lightbox by delta (-1 or +1).
   */
  _lightboxNavigate(delta) {
    const newIndex = this._lightboxIndex + delta;
    if (newIndex < 0 || newIndex >= this._lightboxImages.length) return;

    this._lightboxIndex = newIndex;
    const img = document.getElementById('lightboxImage');
    if (img) {
      img.style.animation = 'none';
      img.offsetHeight; // trigger reflow
      img.style.animation = '';
      img.src = this._lightboxImages[newIndex];
      img.alt = `Image ${newIndex + 1} of ${this._lightboxImages.length}`;
    }

    const counter = document.getElementById('lightboxCounter');
    if (counter) {
      counter.textContent = `${newIndex + 1} / ${this._lightboxImages.length}`;
    }

    this._updateLightboxNav();
  }

  /**
   * Update prev/next button disabled states.
   */
  _updateLightboxNav() {
    const prev = document.getElementById('lightboxPrev');
    const next = document.getElementById('lightboxNext');
    if (prev) prev.disabled = this._lightboxIndex === 0;
    if (next) next.disabled = this._lightboxIndex === this._lightboxImages.length - 1;
  }

  /**
   * Close lightbox with animation.
   */
  closeLightbox() {
    if (this._lightboxKeyHandler) {
      document.removeEventListener('keydown', this._lightboxKeyHandler);
      this._lightboxKeyHandler = null;
    }

    const overlay = this._lightboxEl || document.getElementById('lightboxOverlay');
    if (overlay) {
      overlay.classList.add('closing');
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 200);
    }

    document.body.style.overflow = '';
    this._lightboxEl = null;
    this._lightboxImages = [];
    this._lightboxIndex = 0;
  }

  // ──────────────────── Timestamp System ─────────────────────

  /**
   * Start 30-second interval to update all visible timestamps.
   */
  _startTimestampUpdater() {
    // Update immediately once
    this._updateAllTimestamps();

    // Then every 30 seconds
    this._timestampInterval = setInterval(() => {
      this._updateAllTimestamps();
    }, 30000);
  }

  /**
   * Update all timestamp elements on screen.
   */
  _updateAllTimestamps() {
    const bubbles = document.querySelectorAll('.message-bubble[data-timestamp]');
    bubbles.forEach(bubble => {
      const ts = parseInt(bubble.dataset.timestamp, 10);
      if (!ts) return;
      const dateEl = bubble.querySelector('[data-timestamp-el]');
      if (dateEl) {
        dateEl.textContent = this._formatMessageTime(ts);
      }
    });
  }

  /**
   * Format timestamp for message display.
   * @param {number} timestamp
   * @returns {string}
   */
  _formatMessageTime(timestamp) {
    if (!timestamp) return '';
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    // < 1 min
    if (diffMins < 1) return 'Abhi';
    // < 60 min
    if (diffMins < 60) return `${diffMins} min pehle`;

    // Today
    const isToday = now.toDateString() === then.toDateString();
    const timeStr = then.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (isToday) return `Aaj ${timeStr}`;

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.toDateString() === then.toDateString()) return `Kal ${timeStr}`;

    // Same year
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (now.getFullYear() === then.getFullYear()) {
      return `${months[then.getMonth()]} ${then.getDate()}`;
    }

    // Older
    return `${months[then.getMonth()]} ${then.getDate()}, ${then.getFullYear()}`;
  }

  // ──────────────────── Helpers ──────────────────────────────

  updateCompareButtonVisibility(formsCount) {
    const btn = document.getElementById('compareFormsBtn');
    if (!btn) return;
    if (formsCount >= 2) {
      btn.style.display = 'flex';
      btn.title = `${formsCount} forms compare karein`;
    } else {
      btn.style.display = 'none';
    }
  }

  renderCompareResult(compareData, container) {
    if (!container) return;
    const { form1, form2, common, onlyIn1, onlyIn2, commonDocs, uniqueDocs1, uniqueDocs2 } = compareData;

    // We'll use our FORM_COLORS for form 1 and form 2
    const color1 = FORM_COLORS[1]; // Saffron
    const color2 = FORM_COLORS[2]; // Green

    let html = `
      <div class="compare-stats-bar">
        <div class="compare-stat">
          <span class="compare-stat-value">${form1.totalFields}</span> ${form1.name} fields
        </div>
        <div class="compare-stat-dot"></div>
        <div class="compare-stat">
          <span class="compare-stat-value">${form2.totalFields}</span> ${form2.name} fields
        </div>
        <div class="compare-stat-dot"></div>
        <div class="compare-stat">
          <span class="compare-stat-value" style="color:var(--accent-blue)">${common.length}</span> common
        </div>
      </div>
    `;

    // Common fields
    html += `
      <div class="compare-section-title">
        ✅ Common Fields <span class="count-badge">${common.length}</span>
      </div>
    `;

    if (common.length > 0) {
      html += `
        <table class="compare-table">
          <thead>
            <tr>
              <th>Field Name</th>
              <th>${form1.name}</th>
              <th>${form2.name}</th>
            </tr>
          </thead>
          <tbody>
      `;
      common.forEach(match => {
        html += `
            <tr>
              <td class="field-label-cell">${match.field1.label}</td>
              <td class="field-explain-cell">${match.field1.explanation || '-'}</td>
              <td class="field-explain-cell">${match.field2.explanation || '-'}</td>
            </tr>
        `;
      });
      html += `
          </tbody>
        </table>
      `;
    } else {
      html += `<div class="compare-empty-msg">Koi common field nahi mila.</div>`;
    }

    // Unique fields
    html += `
      <div class="compare-unique-cols">
        <div class="compare-unique-col">
          <div class="compare-unique-col-header">
            <div class="color-dot" style="background:${color1}"></div>
            Sirf ${form1.name} mein <span class="count-badge">${onlyIn1.length}</span>
          </div>
          ${onlyIn1.length ? onlyIn1.map(f => `<div class="compare-unique-item">${f.label}</div>`).join('') : '<div class="compare-empty-msg" style="padding:10px 0;">Kuch alag nahi hai</div>'}
        </div>
        
        <div class="compare-unique-col">
          <div class="compare-unique-col-header">
            <div class="color-dot" style="background:${color2}"></div>
            Sirf ${form2.name} mein <span class="count-badge">${onlyIn2.length}</span>
          </div>
          ${onlyIn2.length ? onlyIn2.map(f => `<div class="compare-unique-item">${f.label}</div>`).join('') : '<div class="compare-empty-msg" style="padding:10px 0;">Kuch alag nahi hai</div>'}
        </div>
      </div>
    `;

    // Documents
    if (commonDocs.length || uniqueDocs1.length || uniqueDocs2.length) {
      html += `
        <div class="compare-docs-section">
          <div class="compare-section-title" style="margin-top:0;">📄 Documents Needed</div>
          <div class="compare-docs-row">
            ${commonDocs.map(d => `<span class="compare-doc-chip common">✓ ${d}</span>`).join('')}
            ${uniqueDocs1.map(d => `<span class="compare-doc-chip form1">${d} (Sirf ${form1.name})</span>`).join('')}
            ${uniqueDocs2.map(d => `<span class="compare-doc-chip form2">${d} (Sirf ${form2.name})</span>`).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  _createEl(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent != null) el.textContent = textContent;
    return el;
  }

  _formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'Abhi';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString('hi-IN');
  }
}
