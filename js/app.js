/**
 * @fileoverview Main application orchestrator for Form Sahayak (Chat UI).
 * Manages the chat-based workflow: sidebar, messages, AI integration, voice, feedback.
 * @module app
 */

import { ChatDB } from './chat-db.js';
import { ImageProcessor } from './image-processor.js';
import { AIService } from './ai-service.js';
import { SpeechService } from './speech-service.js';
import { UIRenderer } from './ui-renderer.js?v=2';
import { TemplateLibrary } from './template-library.js';
import { AnalyticsService } from './analytics-service.js';
import { pLimit } from './utils.js';

const LOG_PREFIX = '[FormSahayak]';

const LANGUAGES = [
  { id: 'hinglish', label: 'Hinglish', native: 'Hinglish' },
  { id: 'hindi', label: 'Hindi', native: 'हिन्दी' },
  { id: 'english', label: 'English', native: 'English' },
  { id: 'bengali', label: 'Bengali', native: 'বাংলা' },
  { id: 'tamil', label: 'Tamil', native: 'தமிழ்' },
  { id: 'telugu', label: 'Telugu', native: 'తెలుగు' },
  { id: 'marathi', label: 'Marathi', native: 'मराठी' },
  { id: 'gujarati', label: 'Gujarati', native: 'ગુજરાતી' },
  { id: 'kannada', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { id: 'malayalam', label: 'Malayalam', native: 'മലയാളം' },
  { id: 'punjabi', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { id: 'odia', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { id: 'assamese', label: 'Assamese', native: 'অসমীয়া' },
  { id: 'urdu', label: 'Urdu', native: 'اردو' },
];

class App {
  constructor() {
    this.chatDB = new ChatDB();
    this.imageProcessor = new ImageProcessor();
    this.ai = new AIService();
    this.speech = new SpeechService();
    this.ui = new UIRenderer();
    this.templates = new TemplateLibrary();
    this.analytics = new AnalyticsService();

    // State
    this.pendingImages = [];      // images waiting to be sent
    this.activeChatId = null;     // current chat ID
    this.lastResult = null;       // last AI result (for follow-up context)
    this.currentLanguage = localStorage.getItem('fs_language') || 'hinglish';
    this.isProcessing = false;
    this.wizardState = {};        // Phase 5: stores typed answers across forms
    this._draftTimer = null;      // auto-save interval ID
    this._isRecordingSTT = false; // speech-to-text state
  }

  async init() {
    console.log(LOG_PREFIX, 'Initialising...');

    this.ui.init();

    // Theme
    const theme = this.ui.getCurrentTheme();
    this.ui.setTheme(theme);

    // Database
    try {
      await this.chatDB.init();
    } catch (e) {
      console.warn(LOG_PREFIX, 'ChatDB init failed:', e.message);
    }

    // Speech
    try {
      await this.speech.init();
      this.speech.setLanguage(this.currentLanguage);
    } catch (e) {
      console.warn(LOG_PREFIX, 'Speech not available:', e.message);
    }

    // Populate language selector
    this._populateLanguageSelect();

    // Bind events
    this._bindEvents();

    // Wire up UI callbacks for message actions
    this.ui.onEditSave = (bubbleEl, newText) => this._handleEditSave(bubbleEl, newText);
    this.ui.onRetry = (bubbleEl) => this._handleRetry(bubbleEl);

    // Show greeting + load chat list
    this.ui.showGreeting();
    await this._refreshChatList();

    // Update storage stats
    this._updateStorageStats();

    // Restore draft if any
    this._restoreDraft();

    // Start auto-save draft timer (every 3 seconds)
    this._draftTimer = setInterval(() => this._saveDraft(), 3000);

    // Network status listener for Offline Mode
    window.addEventListener('online', () => this._handleNetworkChange());
    window.addEventListener('offline', () => this._handleNetworkChange());
    this._handleNetworkChange(); // Initial check

    // Notification Reminders (Phase 4)
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    this._lastActiveTime = Date.now();
    window.addEventListener('mousemove', () => { this._lastActiveTime = Date.now(); });
    window.addEventListener('keydown', () => { this._lastActiveTime = Date.now(); });
    window.addEventListener('touchstart', () => { this._lastActiveTime = Date.now(); }, { passive: true });

    setInterval(() => {
      this._checkIncompleteFormNotification();
    }, 60000); // Check every minute

    console.log(LOG_PREFIX, 'Ready! 🚀');
  }

  // ──────────────────── Notification Reminders ────────────────
  _checkIncompleteFormNotification() {
    if (!this.activeChatId || !this.lastResult || !this.lastResult.fields) return;

    const inactiveTime = Date.now() - this._lastActiveTime;
    // 5 minutes = 300000 ms
    if (inactiveTime > 300000 && document.visibilityState === 'hidden') {
      const key = `fs_checklist_${this.activeChatId}`;
      let state = {};
      try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { }

      const total = this.lastResult.fields.length;
      const done = Object.values(state).filter(v => v === true).length;

      // If form is started but not completed
      if (done > 0 && done < total) {
        // Prevent spamming notification (store last notified time)
        const lastNotified = parseInt(localStorage.getItem('fs_last_notified') || '0', 10);
        if (Date.now() - lastNotified > 3600000) { // Only once per hour
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Form Sahayak', {
              body: `Aapka form abhi adhoora hai (${done}/${total} fields). Wapas aakar poora karein!`,
              icon: '/icons/icon-192.png'
            });
            localStorage.setItem('fs_last_notified', Date.now().toString());
          }
        }
      }
    }
  }

  // ──────────────────── Event Binding ───────────────────────

  _bindEvents() {
    const el = this.ui.elements;

    // Sidebar toggle
    if (el.sidebarToggle) {
      el.sidebarToggle.addEventListener('click', () => this.ui.toggleSidebar());
    }
    if (el.sidebarClose) {
      el.sidebarClose.addEventListener('click', () => this.ui.closeSidebar());
    }
    if (el.sidebarOverlay) {
      el.sidebarOverlay.addEventListener('click', () => this.ui.closeSidebar());
    }

    // New chat
    if (el.newChatBtn) {
      el.newChatBtn.addEventListener('click', () => this._newChat());
    }

    // Chat search
    if (el.chatSearchInput) {
      el.chatSearchInput.addEventListener('input', (e) => this._filterChats(e.target.value));
    }

    // Chat list clicks (delegate)
    if (el.chatList) {
      el.chatList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.chat-item-delete');
        if (deleteBtn) {
          e.stopPropagation();
          const chatId = Number(deleteBtn.dataset.chatId);
          this._deleteChat(chatId);
          return;
        }
        const item = e.target.closest('.chat-list-item');
        if (item) {
          const chatId = Number(item.dataset.chatId);
          this._loadChat(chatId);
        }
      });
    }

    // Clear history
    if (el.clearHistoryBtn) {
      el.clearHistoryBtn.addEventListener('click', () => this._clearAllHistory());
    }

    // Settings
    if (el.settingsBtn) {
      el.settingsBtn.addEventListener('click', () => {
        this._updateAnalyticsUI();
        this.ui.toggleSettings();
        this.ui.closeSidebar();
      });
    }
    if (el.settingsClose) {
      el.settingsClose.addEventListener('click', () => this.ui.closeSettings());
    }
    if (el.settingsOverlay) {
      el.settingsOverlay.addEventListener('click', () => this.ui.closeSettings());
    }

    // Theme toggle
    if (el.themeToggle) {
      el.themeToggle.addEventListener('click', () => {
        const current = this.ui.getCurrentTheme();
        this.ui.setTheme(current === 'dark' ? 'light' : 'dark');
      });
    }

    // File attach
    if (el.chatAttachBtn) {
      el.chatAttachBtn.addEventListener('click', () => el.chatFileInput?.click());
    }
    if (el.chatFileInput) {
      el.chatFileInput.addEventListener('change', (e) => this._handleFiles(e.target.files));
    }

    // Camera capture
    if (el.chatCameraBtn) {
      el.chatCameraBtn.addEventListener('click', () => el.chatCameraInput?.click());
    }
    if (el.chatCameraInput) {
      el.chatCameraInput.addEventListener('change', (e) => this._handleFiles(e.target.files));
    }

    // Text input
    if (el.chatTextInput) {
      el.chatTextInput.addEventListener('input', () => {
        this._updateSendState();
      });
      el.chatTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._send();
        }
      });
    }

    // Send button
    if (el.chatSendBtn) {
      el.chatSendBtn.addEventListener('click', () => this._send());
    }

    // Language selector
    if (el.chatLangSelect) {
      el.chatLangSelect.addEventListener('change', (e) => {
        this.currentLanguage = e.target.value;
        localStorage.setItem('fs_language', this.currentLanguage);
        this.speech.setLanguage(this.currentLanguage);
        this.ui.showToast(`भाषा: ${this._getLanguageLabel(this.currentLanguage)}`, 'info');
      });
    }

    // Voice speed
    if (el.voiceSpeedRange) {
      el.voiceSpeedRange.addEventListener('input', (e) => {
        this.speech.setRate(parseFloat(e.target.value));
      });
    }

    // Voice button — short press = TTS, long press = STT
    if (el.chatVoiceBtn) {
      let pressTimer = null;
      let isLongPress = false;
      let sttStartedLocally = false;

      const handlePressStart = () => {
        isLongPress = false;
        sttStartedLocally = true;
        
        // Start STT immediately to preserve user gesture on mobile
        this._startSTT(true); // true = silent start
        
        pressTimer = setTimeout(() => {
          isLongPress = true;
          // Now show UI feedback for long press
          el.chatVoiceBtn.classList.add('stt-active');
          this.ui.showToast('\ud83c\udf99\ufe0f Boliye... sunna shuru', 'info', 2000);
        }, 400);

        // Catch pointer up/cancel ANYWHERE on the screen
        window.addEventListener('pointerup', handlePressEnd);
        window.addEventListener('pointercancel', handlePressEnd);
      };

      const handlePressEnd = () => {
        window.removeEventListener('pointerup', handlePressEnd);
        window.removeEventListener('pointercancel', handlePressEnd);
        clearTimeout(pressTimer);
        
        if (sttStartedLocally) {
          if (!isLongPress) {
            // Short tap: abort STT and toggle TTS
            this._stopSTT(true); // true = silent stop
            this._toggleVoice();
          } else {
            // Long press release: stop STT
            this._stopSTT();
          }
          sttStartedLocally = false;
        }
      };

      el.chatVoiceBtn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // only left click
        handlePressStart();
      });
      
      el.chatVoiceBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Prevent long press context menu on mobile
      });
    }

    // Share
    if (el.shareBtn) {
      el.shareBtn.addEventListener('click', () => this._shareResult());
    }

    // WhatsApp Share
    if (el.whatsappShareBtn) {
      el.whatsappShareBtn.addEventListener('click', () => this._shareViaWhatsApp());
    }

    // Analytics Dashboard (Phase 3)
    if (el.analyticsBtn) {
      el.analyticsBtn.addEventListener('click', () => {
        this._updateAnalyticsUI();
        this.ui.openSettings();
      });
    }

    // Suggestion chips (Template Library)
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
      if (chip.id === 'compareFormsBtn') {
        chip.addEventListener('click', () => this._openCompareModal());
        return;
      }
      chip.addEventListener('click', () => {
        const templateId = chip.dataset.templateId;
        if (templateId) {
          this._loadTemplate(templateId);
        } else {
          el.chatFileInput?.click();
        }
      });
    });

    // Compare Modal events
    document.getElementById('compareClose')?.addEventListener('click', () => this._closeCompareModal());
    document.getElementById('compareOverlay')?.addEventListener('click', () => this._closeCompareModal());
    document.getElementById('compareActionBtn')?.addEventListener('click', () => this._compareForms());

    // Share Modal events
    const shareBtn = document.getElementById('shareBtn');
    const shareModal = document.getElementById('shareModal');
    const shareOverlay = document.getElementById('shareOverlay');
    const shareClose = document.getElementById('shareClose');
    const shareCancelBtn = document.getElementById('shareCancelBtn');
    const shareActionBtn = document.getElementById('shareActionBtn');
    const shareLinkContainer = document.getElementById('shareLinkContainer');
    const shareLinkInput = document.getElementById('shareLinkInput');
    const shareCopyBtn = document.getElementById('shareCopyBtn');

    const closeShareModal = () => {
      shareModal?.classList.add('hidden');
      shareOverlay?.classList.add('hidden');
      if (shareLinkContainer) shareLinkContainer.classList.add('hidden');
    };

    shareBtn?.addEventListener('click', () => {
      if (!this.activeChatId) {
        this.ui.showToast('Pehle koi chat open karein', 'info');
        return;
      }
      shareModal?.classList.remove('hidden');
      shareOverlay?.classList.remove('hidden');
      if (shareLinkContainer) shareLinkContainer.classList.add('hidden');
    });

    shareClose?.addEventListener('click', closeShareModal);
    shareOverlay?.addEventListener('click', closeShareModal);
    shareCancelBtn?.addEventListener('click', closeShareModal);

    shareActionBtn?.addEventListener('click', async () => {
      const visibility = document.querySelector('input[name="shareVisibility"]:checked')?.value;
      if (visibility === 'private') {
        closeShareModal();
        this.ui.showToast('Chat private rakhi gayi hai', 'info');
        return;
      }

      const isChecked = document.getElementById('sharePrivacyCheck')?.checked;
      if (!isChecked) {
        this.ui.showToast('Please confirm you are not sharing personal info (PAN/Aadhaar)', 'error');
        return;
      }

      this.ui.showToast('Link ban raha hai...', 'info');
      shareActionBtn.disabled = true;

      try {
        const messages = await this.chatDB.getMessages(this.activeChatId);

        // Strip Images
        const safeMessages = messages.map(msg => {
          if (msg.role !== 'user') return msg;
          return {
            ...msg,
            images: [],
            imageBlobs: [],
            content: typeof msg.content === 'string'
              ? msg.content
              : (msg.content || []).filter(c => c.type === 'text')
          };
        });

        const response = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: this.activeChatId, messages: safeMessages })
        });

        if (!response.ok) throw new Error('Share link banne mein error aayi');

        const data = await response.json();
        if (shareLinkContainer && shareLinkInput) {
          shareLinkContainer.classList.remove('hidden');
          shareLinkInput.value = data.shareUrl;
          shareLinkInput.select();
        }
      } catch (err) {
        console.error(err);
        this.ui.showToast(err.message, 'error');
      } finally {
        shareActionBtn.disabled = false;
      }
    });

    shareCopyBtn?.addEventListener('click', () => {
      if (shareLinkInput && shareLinkInput.value) {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(shareLinkInput.value)
            .then(() => this.ui.showToast('Link copy ho gaya ✓', 'success'))
            .catch(() => this.ui.showToast('Copy nahi ho paya, manually copy karein', 'error'));
        } else {
          // Fallback for mobile / non-https
          shareLinkInput.select();
          try {
            document.execCommand('copy');
            this.ui.showToast('Link copy ho gaya ✓', 'success');
          } catch (err) {
            this.ui.showToast('Copy nahi ho paya, manually copy karein', 'error');
          }
        }
      }
    });

    // Paste images
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        this._handleFiles(files);
        this.ui.showToast('Image paste se add hui ✓', 'success');
      }
    });

    // Drag and drop on main area
    const mainArea = el.mainArea;
    if (mainArea) {
      mainArea.addEventListener('dragover', (e) => { e.preventDefault(); });
      mainArea.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) {
          this._handleFiles(e.dataTransfer.files);
        }
      });
    }

    if (el.chatMessages) {
      el.chatMessages.addEventListener('click', (e) => {
        // PDF download
        const pdfBtn = e.target.closest('.download-pdf-btn');
        if (pdfBtn) {
          const formIdx = pdfBtn.dataset.formIndex;
          const parsedIdx = formIdx !== undefined && formIdx !== '' ? parseInt(formIdx, 10) : null;
          this._downloadPDF(parsedIdx);
          return;
        }

        // Start Wizard
        const wizardBtn = e.target.closest('.start-wizard-btn');
        if (wizardBtn) {
          const formIdx = wizardBtn.dataset.formIndex;
          const parsedIdx = formIdx !== undefined && formIdx !== '' ? parseInt(formIdx, 10) : null;
          this._startWizard(parsedIdx);
          return;
        }
      });

      // Checkbox changes (field checklist + doc readiness)
      el.chatMessages.addEventListener('change', (e) => {
        const fieldCheck = e.target.closest('.field-done-check');
        if (fieldCheck) {
          const idx = fieldCheck.dataset.fieldIndex;
          this._onFieldCheckChange(idx, fieldCheck.checked);
          return;
        }

        const docCheck = e.target.closest('.doc-ready-check');
        if (docCheck) {
          const idx = docCheck.dataset.docIndex;
          this._onDocCheckChange(idx, docCheck.checked);
          return;
        }
      });
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.ui.closeSettings();
        this.ui.hideFeedbackModal();
        this.ui.closeLightbox();
      }
    });
    // Cleaned up fs:startWizard listener
  }

  // ──────────────────── File Handling ───────────────────────

  async _handleFiles(fileList) {
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (!files.length) return;

    try {
      if (this.pendingImages.length + files.length > 8) {
        throw new Error('Total max 8 images allowed per batch.');
      }
      const existingHashes = new Set(this.pendingImages.map(img => img.hash));
      const processed = await this.imageProcessor.processFiles(files, existingHashes);
      this.pendingImages.push(...processed);
      this._updateSendState();
      this.ui.showToast(`${processed.length} photo add hui ✓`, 'success', 2000);

      // Update preview asynchronously to show grouping tags
      await this._updatePreview();
    } catch (err) {
      console.error(LOG_PREFIX, 'File processing error:', err);
      this.ui.showToast(err.message || 'Photo process karne mein dikkat aayi', 'error');
    }

    if (this.ui.elements.chatFileInput) {
      this.ui.elements.chatFileInput.value = '';
    }
  }

  async _updatePreview() {
    let groups = [];
    if (this.pendingImages.length > 0) {
      try {
        const detection = await this.ai.groupImagesHeuristically(this.pendingImages);
        groups = new Array(this.pendingImages.length).fill(1);
        if (detection && detection.forms) {
          detection.forms.forEach((form, formIdx) => {
            form.image_indices.forEach(idx => {
              if (idx < groups.length) groups[idx] = formIdx + 1;
            });
          });
        }
      } catch (e) {
        console.warn(LOG_PREFIX, 'Preview grouping failed', e);
        groups = new Array(this.pendingImages.length).fill(1);
      }
    }

    this.ui.renderAttachPreview(this.pendingImages, groups);
    this._bindPreviewRemove();
  }

  _bindPreviewRemove() {
    const strip = this.ui.elements.attachPreview;
    if (!strip) return;

    strip.querySelectorAll('.preview-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        this.pendingImages.splice(idx, 1);
        this._updateSendState();
        await this._updatePreview();
      });
    });
  }

  // ──────────────────── Send Message ───────────────────────

  // ──────────────────── Network Status (Offline Mode) ────────

  _handleNetworkChange() {
    const isOffline = !navigator.onLine;
    const banner = document.getElementById('offlineBanner');

    if (isOffline) {
      if (banner) banner.classList.remove('hidden');
      this.ui.updateSendButton(false); // Disable send
      const chatInput = this.ui.elements.chatTextInput;
      if (chatInput) {
        chatInput.placeholder = "Offline mode - History aur templates check karein";
        chatInput.disabled = true;
      }
      this.ui.showToast('You are offline. AI is paused.', 'info');
    } else {
      if (banner) banner.classList.add('hidden');
      const chatInput = this.ui.elements.chatTextInput;
      if (chatInput) {
        chatInput.placeholder = "Form ki photo upload karein ya sawal poochein...";
        chatInput.disabled = false;
      }
      this._updateSendState();
      this.ui.showToast('You are back online!', 'success');
    }
  }

  // ──────────────────── Input Handling ───────────────────────

  _updateSendState() {
    if (!navigator.onLine) {
      this.ui.updateSendButton(false);
      return;
    }
    const text = this.ui.elements.chatTextInput?.value?.trim() || '';
    const hasContent = text.length > 0 || this.pendingImages.length > 0;
    this.ui.updateSendButton(hasContent && !this.isProcessing);
  }

  async _send() {
    if (this.isProcessing) return;

    if (!navigator.onLine) {
      this.ui.showToast('Internet connection nahi hai', 'error');
      return;
    }

    const textInput = this.ui.elements.chatTextInput;
    const text = textInput?.value?.trim() || '';
    const hasImages = this.pendingImages.length > 0;

    if (!text && !hasImages) return;

    this.isProcessing = true;
    this._updateSendState();

    // Create chat if none active
    if (!this.activeChatId) {
      try {
        this.activeChatId = await this.chatDB.createChat('New Chat');
        await this._refreshChatList();
      } catch (e) {
        console.warn(LOG_PREFIX, 'Failed to create chat:', e.message);
      }
    }

    // Collect image data URLs for the user bubble
    const imageDataUrls = this.pendingImages.map(img => img.dataUrl);

    // Add user message bubble
    this.ui.addUserMessage({ text: text || (hasImages ? 'Form analyze karein' : ''), imageDataUrls });

    // Save user message to DB
    try {
      await this.chatDB.addMessage({
        chatId: this.activeChatId,
        role: 'user',
        content: text || 'Form analyze karein',
        imageDataUrls: imageDataUrls
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to save user message:', e.message);
    }

    // Clear inputs
    if (textInput) { textInput.value = ''; textInput.style.height = 'auto'; }
    const currentImages = [...this.pendingImages];
    this.pendingImages = [];
    this.ui.renderAttachPreview([]);
    this._clearDraft();

    // Show typing indicator
    this.ui.addTypingIndicator();

    try {
      let result = { forms: [] };

      if (hasImages) {
        // === Image analysis with Progressive Rendering ===
        const imagesForApi = currentImages.map(img => ({
          base64: img.base64,
          mediaType: img.mediaType,
          file: img.file
        }));

        this.lastResult = result; // Initialize immediately so early wizard clicks work
        this.ui.removeTypingIndicator();

        if (imagesForApi.length === 1) {
          // Single image -> No detection needed
          const bubbleContext = this.ui.createEmptyAIBubble(1);
          try {
            const res = await this.ai.analyzeForm(imagesForApi, {
              language: this.currentLanguage,
              maxRetries: 2
            });
            result.forms.push(res);
            this.ui.addFormCardToBubble(bubbleContext, res, 0, 1);
          } catch (err) {
            this.ui.addErrorCardToBubble(bubbleContext, err, 0);
          }
        } else {
          // Multiple images -> Heuristic grouping
          const detection = await this.ai.groupImagesHeuristically(imagesForApi);

          const totalForms = detection && detection.forms ? detection.forms.length : 1;
          const bubbleContext = this.ui.createEmptyAIBubble(totalForms);

          if (detection && detection.forms && detection.forms.length > 0) {
            const limit = pLimit(2); // Concurrency limit of 2

            // Progressive parallel analysis
            const promises = detection.forms.map((detectedForm, idx) => {
              const subsetImages = detectedForm.image_indices
                .map(index => imagesForApi[index])
                .filter(img => img);

              if (subsetImages.length === 0) return Promise.resolve(null);

              return limit(() => this.ai.analyzeForm(subsetImages, {
                language: this.currentLanguage,
                maxRetries: 2
              }))
                .then(res => {
                  result.forms[idx] = res; // Assign by index to preserve mapping!
                  this.lastResult = result; // Update progressively
                  this.ui.addFormCardToBubble(bubbleContext, res, idx, detection.forms.length);
                  return res;
                })
                .catch(err => {
                  this.ui.addErrorCardToBubble(bubbleContext, err, idx);
                  return null;
                });
            });

            await Promise.allSettled(promises);
            this.ui.updateCompareButtonVisibility(result.forms.filter(Boolean).length);
          } else {
            this.ui.addErrorCardToBubble(bubbleContext, new Error('Could not group forms properly.'), 0);
          }
        }

        this.lastResult = result;
        this.analytics.track('form_analyzed', {
          language: this.currentLanguage,
          formsCount: result.forms.length
        });

        // Update chat title
        const firstFormName = result.forms[0]?.form_name || 'Form Analysis';
        const chatTitle = result.forms.length > 1
          ? `${firstFormName} & ${result.forms.length - 1} more`
          : firstFormName;

        this.ui.setChatTitle(chatTitle);
        try {
          await this.chatDB.updateChat(this.activeChatId, {
            title: chatTitle,
            updatedAt: Date.now()
          });
          await this._refreshChatList();
        } catch (e) {
          console.warn(LOG_PREFIX, 'Failed to update chat:', e.message);
        }

        // Save AI message to DB
        try {
          await this.chatDB.addMessage({
            chatId: this.activeChatId,
            role: 'ai',
            content: chatTitle,
            resultData: result
          });
        } catch (e) {
          console.warn(LOG_PREFIX, 'Failed to save AI message:', e.message);
        }

        // Clear image data from memory
        currentImages.forEach(img => { img.base64 = null; img.dataUrl = null; });

      } else if (text) {
        // === Text follow-up (no image re-send!) ===
        const contextJson = this.lastResult ? JSON.stringify(this.lastResult) : '';

        const response = await this.ai.sendTextMessage(text, contextJson, this.currentLanguage);

        this.ui.removeTypingIndicator();
        this.ui.addAITextMessage(response);

        // Save AI text message
        try {
          await this.chatDB.addMessage({
            chatId: this.activeChatId,
            role: 'ai',
            content: response
          });
          await this.chatDB.updateChat(this.activeChatId, { updatedAt: Date.now() });
        } catch (e) {
          console.warn(LOG_PREFIX, 'Failed to save AI message:', e.message);
        }
      }

      this.ui.showToast('✅ Response ready!', 'success', 2000);

    } catch (err) {
      console.error(LOG_PREFIX, 'AI call failed:', err);
      this.ui.removeTypingIndicator();
      this.ui.addAITextMessage(`⚠️ Error: ${err.message || 'Kuch galat ho gaya. Phir try karein.'}`);
      this.ui.showToast('Analysis failed', 'error');
    } finally {
      this.isProcessing = false;
      this._updateSendState();
    }
  }

  // ──────────────────── Template Library ───────────────────

  async _loadTemplate(templateId) {
    const template = this.templates.getTemplateById(templateId);
    if (!template) return;

    this.ui.showToast(`Loading template: ${template.name}...`, 'info');

    // Create new chat if none
    if (!this.activeChatId) {
      try {
        this.activeChatId = await this.chatDB.createChat(template.name);
        await this._refreshChatList();
      } catch (e) { }
    }

    // Hide greeting
    const el = this.ui.elements;
    if (el.chatGreeting) el.chatGreeting.style.display = 'none';

    // Show result
    const result = template.result;
    this.lastResult = result;
    this.ui.addAIResultMessage(result);

    // Track
    this.analytics.track('template_used', { templateId });
    this.analytics.track('form_analyzed', { category: template.category, template: true });

    // Save to DB
    try {
      await this.chatDB.addMessage({
        chatId: this.activeChatId,
        role: 'user',
        content: `Loaded template: ${template.name}`
      });
      await this.chatDB.addMessage({
        chatId: this.activeChatId,
        role: 'ai',
        content: result.form_name || 'Analysis complete',
        resultData: result
      });
      this.ui.setChatTitle(template.name);
      await this.chatDB.updateChat(this.activeChatId, {
        title: template.name,
        updatedAt: Date.now()
      });
      await this._refreshChatList();
      this.ui.updateCompareButtonVisibility(0); // templates don't add to forms array yet
    } catch (e) { }
  }

  // ──────────────────── Chat Management ────────────────────

  async _newChat() {
    this.activeChatId = null;
    this.lastResult = null;
    this.pendingImages = [];
    this.wizardState = {};
    this.ui.renderAttachPreview([]);
    this.ui.setChatTitle('Form Sahayak');
    this.ui.showGreeting();
    this.ui.closeSidebar();
    this.ui.updateCompareButtonVisibility(0);
    await this._refreshChatList();
  }

  async _loadChat(chatId) {
    try {
      this.activeChatId = chatId;
      this.wizardState = {}; // clear on load
      const messages = await this.chatDB.getMessages(chatId);

      // Find last AI result for context
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].resultData) {
          this.lastResult = messages[i].resultData;
          break;
        }
      }

      // Get chat title
      const chats = await this.chatDB.getAllChats();
      const chat = chats.find(c => c.id === chatId);
      this.ui.setChatTitle(chat?.title || 'Chat');

      // Restore messages in UI
      this.ui.restoreMessages(messages);

      const formsCount = this.lastResult?.forms ? this.lastResult.forms.filter(Boolean).length : 0;
      this.ui.updateCompareButtonVisibility(formsCount);

      this.ui.closeSidebar();
      await this._refreshChatList();

    } catch (e) {
      console.error(LOG_PREFIX, 'Failed to load chat:', e);
      this.ui.showToast('Chat load nahi ho paya', 'error');
    }
  }

  async _deleteChat(chatId) {
    try {
      await this.chatDB.deleteChat(chatId);
      if (this.activeChatId === chatId) {
        this._newChat();
      }
      await this._refreshChatList();
      this.ui.showToast('Chat delete hua ✓', 'info');
    } catch (e) {
      this.ui.showToast('Delete nahi ho paya', 'error');
    }
  }

  async _clearAllHistory() {
    if (!confirm('Saari chat history delete karein? Yeh undo nahi ho sakta.')) return;
    try {
      await this.chatDB.clearAll();
      this._newChat();
      this.ui.showToast('Saari history clear ho gayi ✓', 'success');
    } catch (e) {
      this.ui.showToast('Clear nahi ho paya', 'error');
    }
  }

  async _refreshChatList() {
    try {
      const chats = await this.chatDB.getAllChats();
      this.ui.renderChatList(chats, this.activeChatId);
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to refresh chat list:', e.message);
    }
  }

  async _filterChats(query) {
    try {
      let chats = await this.chatDB.getAllChats();
      if (query && query.trim()) {
        const q = query.toLowerCase();
        chats = chats.filter(c => c.title.toLowerCase().includes(q));
      }
      this.ui.renderChatList(chats, this.activeChatId);
    } catch (e) {
      console.warn(LOG_PREFIX, 'Search failed:', e.message);
    }
  }

  // ──────────────────── Voice ──────────────────────────────

  _toggleVoice(formIndex = null) {
    if (!this.speech.isSupported) {
      this.ui.showToast('Voice support nahi hai', 'error');
      return;
    }
    // lastResult has structure { forms: [...] } — flatten fields from all forms
    const allFields = this._getAllFieldsFromResult(this.lastResult, formIndex);
    if (!allFields.length) {
      this.ui.showToast('Pehle form analyze karein', 'info');
      return;
    }
    if (this.speech.isPlaying && !this.speech.isPaused) {
      this.speech.pause();
      return;
    }
    if (this.speech.isPaused) {
      this.speech.resume();
      return;
    }
    this.speech.speakFields(allFields, () => { }, () => {
      this.ui.showToast('🔊 Sab fields sun liye ✓', 'success');
    });
  }

  /** Helper: flatten all fields from lastResult (which may have forms array) */
  _getAllFieldsFromResult(result, filterFormIndex = null) {
    if (!result) return [];
    // New structure: { forms: [{ sections: [{ fields: [...] }] }] }
    if (Array.isArray(result.forms)) {
      const fields = [];
      result.forms.forEach((form, idx) => {
        if (filterFormIndex !== null && filterFormIndex !== undefined && filterFormIndex !== idx) {
          return;
        }
        if (Array.isArray(form.sections)) {
          form.sections.forEach(sec => {
            if (Array.isArray(sec.fields)) fields.push(...sec.fields);
          });
        } else if (Array.isArray(form.fields)) {
          fields.push(...form.fields);
        }
      });
      return fields;
    }
    // Legacy structure: { fields: [...] } or { sections: [...] }
    if (Array.isArray(result.fields)) return result.fields;
    if (Array.isArray(result.sections)) {
      const fields = [];
      result.sections.forEach(sec => {
        if (Array.isArray(sec.fields)) fields.push(...sec.fields);
      });
      return fields;
    }
    return [];
  }

  // ──────────────────── Share ──────────────────────────────

  async _shareResult() {
    if (!this.lastResult) {
      this.ui.showToast('Koi result share karne ke liye nahi hai', 'info');
      return;
    }
    const r = this.lastResult;
    let text = `📄 ${r.form_name}\n${r.purpose}\n\n`;
    if (r.fields?.length) {
      text += `--- Fields ---\n`;
      r.fields.forEach((f, i) => {
        text += `${i + 1}. ${f.label}\n   ${f.explanation}\n`;
        if (f.example) text += `   Example: ${f.example}\n`;
        text += '\n';
      });
    }
    if (r.tips) text += `💡 Tips: ${r.tips}\n`;
    text += `\n— Form Sahayak se samjha`;

    if (navigator.share) {
      try {
        await navigator.share({ title: `Form Sahayak: ${r.form_name}`, text });
      } catch (e) {
        if (e.name !== 'AbortError') this._copyText(text);
      }
    } else {
      this._copyText(text);
    }
  }

  async _copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.ui.showToast('Clipboard pe copy hua ✓', 'success');
    } catch (e) {
      this.ui.showToast('Copy nahi ho paya', 'error');
    }
  }

  // ──────────────────── WhatsApp Share ─────────────────────

  async _shareViaWhatsApp() {
    if (!this.activeChatId) {
      this.ui.showToast('Pehle koi chat open karein', 'info');
      return;
    }

    this.ui.showToast('WhatsApp link ban raha hai...', 'info');

    try {
      const messages = await this.chatDB.getMessages(this.activeChatId);

      const safeMessages = messages.map(msg => {
        if (msg.role !== 'user') return msg;
        return {
          ...msg,
          images: [],
          imageBlobs: [],
          content: typeof msg.content === 'string'
            ? msg.content
            : (msg.content || []).filter(c => c.type === 'text')
        };
      });

      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: this.activeChatId, messages: safeMessages })
      });

      if (!response.ok) throw new Error('Share link banne mein error aayi');

      const data = await response.json();
      const text = `Dekhiye mera form analysis Form Sahayak par:\n${data.shareUrl}`;
      const encodedText = encodeURIComponent(text);
      window.open(`https://wa.me/?text=${encodedText}`, '_blank');
      this.ui.showToast('WhatsApp open ho raha hai...', 'info', 2000);
    } catch (err) {
      console.error(err);
      this.ui.showToast('WhatsApp share fail ho gaya', 'error');
    }
  }

  // ──────────────────── Message Edit & Retry ───────────────

  /**
   * Handle user message edit — re-send the edited text to AI.
   */
  async _handleEditSave(bubbleEl, newText) {
    if (this.isProcessing || !newText.trim()) return;

    // Remove any AI response bubbles that came after this user bubble
    let sibling = bubbleEl.nextElementSibling;
    while (sibling) {
      const next = sibling.nextElementSibling;
      if (sibling.classList.contains('message-bubble') && sibling.dataset.role === 'ai') {
        sibling.remove();
        break; // Only remove the immediate next AI response
      }
      sibling = next;
    }

    this.isProcessing = true;
    this._updateSendState();

    // Show typing indicator
    this.ui.addTypingIndicator();

    try {
      const contextJson = this.lastResult ? JSON.stringify(this.lastResult) : '';
      const response = await this.ai.sendTextMessage(newText, contextJson, this.currentLanguage);

      this.ui.removeTypingIndicator();
      this.ui.addAITextMessage(response);

      // Save to DB
      try {
        await this.chatDB.addMessage({
          chatId: this.activeChatId,
          role: 'ai',
          content: response
        });
        await this.chatDB.updateChat(this.activeChatId, { updatedAt: Date.now() });
      } catch (e) {
        console.warn(LOG_PREFIX, 'Failed to save edited response:', e.message);
      }

      this.ui.showToast('✅ Response updated!', 'success', 2000);
    } catch (err) {
      console.error(LOG_PREFIX, 'Edit re-send failed:', err);
      this.ui.removeTypingIndicator();
      this.ui.addAITextMessage(`⚠️ Error: ${err.message || 'Re-send fail hua. Phir try karein.'}`);
    } finally {
      this.isProcessing = false;
      this._updateSendState();
    }
  }

  /**
   * Handle retry — regenerate AI response for the user message.
   */
  async _handleRetry(bubbleEl) {
    if (this.isProcessing) return;

    // Get user message text
    const textEl = bubbleEl.querySelector('.message-text');
    const userText = textEl ? textEl.textContent.trim() : '';
    if (!userText) return;

    // Remove the AI response that follows this user bubble
    let sibling = bubbleEl.nextElementSibling;
    while (sibling) {
      const next = sibling.nextElementSibling;
      if (sibling.classList.contains('message-bubble') && sibling.dataset.role === 'ai') {
        sibling.remove();
        break;
      }
      sibling = next;
    }

    this.isProcessing = true;
    this._updateSendState();

    // Show typing indicator
    this.ui.addTypingIndicator();

    try {
      const contextJson = this.lastResult ? JSON.stringify(this.lastResult) : '';
      const response = await this.ai.sendTextMessage(userText, contextJson, this.currentLanguage);

      this.ui.removeTypingIndicator();
      this.ui.addAITextMessage(response);

      // Save to DB
      try {
        await this.chatDB.addMessage({
          chatId: this.activeChatId,
          role: 'ai',
          content: response
        });
        await this.chatDB.updateChat(this.activeChatId, { updatedAt: Date.now() });
      } catch (e) {
        console.warn(LOG_PREFIX, 'Failed to save retry response:', e.message);
      }

      this.ui.showToast('🔄 Response regenerated!', 'success', 2000);
    } catch (err) {
      console.error(LOG_PREFIX, 'Retry failed:', err);
      this.ui.removeTypingIndicator();
      this.ui.addAITextMessage(`⚠️ Error: ${err.message || 'Retry fail hua. Phir try karein.'}`);
    } finally {
      this.isProcessing = false;
      this._updateSendState();
    }
  }

  // ──────────────────── Helpers ────────────────────────────

  _populateLanguageSelect() {
    const select = this.ui.elements.chatLangSelect;
    if (!select) return;
    select.innerHTML = '';
    LANGUAGES.forEach(lang => {
      const opt = document.createElement('option');
      opt.value = lang.id;
      opt.textContent = lang.native;
      if (lang.id === this.currentLanguage) opt.selected = true;
      select.appendChild(opt);
    });
  }

  _getLanguageLabel(langId) {
    const lang = LANGUAGES.find(l => l.id === langId);
    return lang ? lang.native : langId;
  }

  async _updateStorageStats() {
    try {
      const stats = await this.chatDB.getStorageStats();
      this.ui.updateStorageStats(stats);
    } catch (_) { }
  }

  // ──────────────────── Auto-Save Draft ────────────────────

  _saveDraft() {
    try {
      const text = this.ui.elements.chatTextInput?.value || '';
      if (text.trim().length === 0 && this.pendingImages.length === 0) {
        localStorage.removeItem('fs_draft');
        return;
      }
      const draft = {
        text,
        imageCount: this.pendingImages.length,
        timestamp: Date.now()
      };
      localStorage.setItem('fs_draft', JSON.stringify(draft));
    } catch (_) { }
  }

  _restoreDraft() {
    try {
      const raw = localStorage.getItem('fs_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Only restore if less than 1 hour old
      if (Date.now() - draft.timestamp > 3600000) {
        localStorage.removeItem('fs_draft');
        return;
      }
      if (draft.text && this.ui.elements.chatTextInput) {
        this.ui.elements.chatTextInput.value = draft.text;
        this._updateSendState();
        this.ui.showToast('Draft restored ✓', 'info', 2000);
      }
    } catch (_) {
      localStorage.removeItem('fs_draft');
    }
  }

  _clearDraft() {
    try {
      localStorage.removeItem('fs_draft');
    } catch (_) { }
  }

  // ──────────────────── PDF Download ──────────────────────

  _downloadPDF(formIndex = null) {
    if (!this.lastResult) return;

    this.ui.showToast('PDF ban raha hai...', 'info');

    // lastResult has structure { forms: [...] }
    let formsList = Array.isArray(this.lastResult.forms) && this.lastResult.forms.length > 0
      ? this.lastResult.forms
      : [this.lastResult]; // legacy fallback

    if (formIndex !== null && formIndex >= 0 && formIndex < formsList.length) {
      formsList = [formsList[formIndex]];
    }

    const title = formsList.length === 1
      ? (formsList[0].form_name || 'Form_Sahayak_Guide')
      : 'Form Sahayak Guide';

    // Build HTML for the PDF
    let html = `
      <html>
      <head>
        <title>${title}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap');
          body {
            font-family: 'Inter', 'Noto Sans Devanagari', sans-serif;
            color: #111;
            line-height: 1.5;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
          }
          h1 { color: #FF6B35; font-size: 22px; border-bottom: 2px solid #FF6B35; padding-bottom: 8px; margin-bottom: 16px; }
          h2.form-title { color: #FF6B35; font-size: 20px; border-bottom: 2px solid #FF6B35; padding-bottom: 8px; margin: 30px 0 16px; }
          .purpose { font-size: 14px; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #FF6B35; }
          .field { margin-bottom: 20px; page-break-inside: avoid; }
          .field-label { font-size: 15px; font-weight: 700; color: #2c3e50; margin-bottom: 4px; }
          .field-expl { font-size: 13px; color: #34495e; margin-bottom: 4px; }
          .field-example { font-size: 12px; background: #e8f5e9; padding: 6px 10px; border-radius: 4px; color: #1b5e20; display: inline-block; border: 1px solid #c8e6c9; margin-bottom: 4px; }
          .user-answer { font-size: 14px; font-weight: 600; color: #b45309; background: #fef3c7; padding: 8px 12px; border-radius: 6px; border: 1px dashed #f59e0b; display: inline-block; margin-top: 4px; }
          .section-title { font-size: 14px; font-weight: 600; color: #555; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
          .docs-title { font-size: 16px; color: #2c3e50; margin-top: 30px; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          ul { padding-left: 20px; }
          li { font-size: 13px; margin-bottom: 6px; color: #34495e; }
          .footer { margin-top: 50px; font-size: 11px; color: #7f8c8d; text-align: center; border-top: 1px solid #eee; padding-top: 16px; }
          .form-divider { border: none; border-top: 2px dashed #ddd; margin: 30px 0; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
    `;

    formsList.forEach((r, formIdx) => {
      if (formsList.length > 1) {
        html += `<h2 class="form-title">${formIdx + 1}. ${r.form_name || 'Form'}</h2>`;
      }

      if (r.purpose) {
        html += `<div class="purpose"><strong>Purpose:</strong> ${r.purpose}</div>`;
      }

      // Render from sections if available
      if (r.sections && r.sections.length) {
        r.sections.forEach(sec => {
          if (sec.fields && sec.fields.length) {
            html += `<div class="section-title">${sec.section_name || ''}</div>`;
            html += `<div>`;
            sec.fields.forEach((f, i) => {
              html += `<div class="field">
                <div class="field-label">${i + 1}. ${f.label}</div>
                <div class="field-expl">${f.explanation || ''}</div>`;
              if (f.example) {
                html += `<div class="field-example"><strong>Example:</strong> ${f.example}</div><br>`;
              }
              const ans = this._getWizardFieldValue(f.label);
              if (ans) {
                html += `<div class="user-answer">✍️ ${ans}</div>`;
              }
              html += `</div>`;
            });
            html += `</div>`;
          }
        });
      } else if (r.fields && r.fields.length) {
        // Legacy fields array
        html += `<div>`;
        r.fields.forEach((f, i) => {
          html += `<div class="field">
            <div class="field-label">${i + 1}. ${f.label}</div>
            <div class="field-expl">${f.explanation || ''}</div>`;
          if (f.example) {
            html += `<div class="field-example"><strong>Example:</strong> ${f.example}</div><br>`;
          }
          const ans = this._getWizardFieldValue(f.label);
          if (ans) {
            html += `<div class="user-answer">✍️ ${ans}</div>`;
          }
          html += `</div>`;
        });
        html += `</div>`;
      }

      if (r.documents_needed && r.documents_needed.length) {
        html += `<h3 class="docs-title">Documents Needed</h3><ul>`;
        r.documents_needed.forEach(docItem => {
          html += `<li>${docItem}</li>`;
        });
        html += `</ul>`;
      }

      if (r.tips) {
        html += `<h3 class="docs-title">Tips</h3>
                 <div class="purpose" style="border-left-color: #059669; background: #ecfdf5;">${r.tips}</div>`;
      }

      if (formIdx < formsList.length - 1) {
        html += `<hr class="form-divider">`;
      }
    });

    html += `
        <div class="footer">Generated by Form Sahayak (Offline AI)</div>
      </body>
      </html>
    `;

    let printWin = window.open('', '_blank');
    let isIframe = false;

    // Fallback if popup blocker prevents window.open
    if (!printWin) {
      isIframe = true;
      printWin = document.createElement('iframe');
      printWin.style.position = 'absolute';
      printWin.style.width = '0';
      printWin.style.height = '0';
      printWin.style.border = 'none';
      document.body.appendChild(printWin);
      printWin = printWin.contentWindow;
    }

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();

    // Wait for fonts to load, then print
    setTimeout(() => {
      printWin.focus();
      printWin.print();

      // Cleanup after print dialog is closed (or after a delay) if using iframe
      if (isIframe) {
        setTimeout(() => {
          if (printWin.frameElement && document.body.contains(printWin.frameElement)) {
            document.body.removeChild(printWin.frameElement);
          }
        }, 2000);
      } else {
        // Optional: close the new window after printing (user can close it manually too)
        // printWin.close();
      }
    }, 500);
  }

  // ──────────────────── Field Checklist ────────────────────

  _onFieldCheckChange(fieldIndex, checked) {
    if (!this.activeChatId) return;

    this.analytics.track('field_checked', { fieldIndex, checked });

    const key = `fs_checklist_${this.activeChatId}`;
    let state = {};
    try {
      state = JSON.parse(localStorage.getItem(key) || '{}');
    } catch (_) { }
    state[fieldIndex] = checked;
    localStorage.setItem(key, JSON.stringify(state));

    // Update progress
    this._updateChecklistProgress();
  }

  _updateChecklistProgress() {
    if (!this.lastResult?.fields?.length) return;
    const key = `fs_checklist_${this.activeChatId}`;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { }

    const total = this.lastResult.fields.length;
    const done = Object.values(state).filter(v => v === true).length;
    this.ui.updateChecklistProgress(done, total);
  }

  _restoreChecklistState() {
    if (!this.activeChatId || !this.lastResult?.fields?.length) return;
    const key = `fs_checklist_${this.activeChatId}`;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { }

    // Restore checkbox states in DOM
    document.querySelectorAll('.field-done-check').forEach(cb => {
      const idx = cb.dataset.fieldIndex;
      if (state[idx] === true) cb.checked = true;
    });
    this._updateChecklistProgress();
  }

  // ──────────────────── Document Readiness ─────────────────

  _onDocCheckChange(docIndex, checked) {
    if (!this.activeChatId) return;
    const key = `fs_docs_${this.activeChatId}`;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { }
    state[docIndex] = checked;
    localStorage.setItem(key, JSON.stringify(state));
    this._updateDocReadiness();
  }

  _updateDocReadiness() {
    if (!this.lastResult?.documents_needed?.length) return;
    const key = `fs_docs_${this.activeChatId}`;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { }

    const total = this.lastResult.documents_needed.length;
    const done = Object.values(state).filter(v => v === true).length;
    this.ui.updateDocReadiness(done, total);
  }

  // ──────────────────── Voice Input (STT) ──────────────────

  _startSTT(silent = false) {
    if (!this.speech.isRecognitionSupported) {
      if (!silent) this.ui.showToast('Speech recognition is not supported in this browser', 'error');
      return;
    }
    if (window.isSecureContext === false) {
      if (!silent) this.ui.showToast('Mic works only on HTTPS or Localhost. Mobile par HTTP block ho jata hai.', 'error', 4000);
      return;
    }
    this._isRecordingSTT = true;
    const voiceBtn = this.ui.elements.chatVoiceBtn;
    
    if (!silent) {
      if (voiceBtn) voiceBtn.classList.add('stt-active');
      this.ui.showToast('\ud83c\udf99\ufe0f Boliye... sunna shuru', 'info', 2000);
    }

    const input = this.ui.elements.chatTextInput;
    const existingText = input && input.value ? input.value : '';

    this.speech.startRecognition(
      (transcript, isFinal) => {
        if (input) {
          const space = existingText && !existingText.endsWith(' ') ? ' ' : '';
          input.value = existingText + space + transcript;
          this._updateSendState();
        }
      },
      () => {
        // On end
        this._isRecordingSTT = false;
        if (voiceBtn) voiceBtn.classList.remove('stt-active');
      }
    );
  }

  _stopSTT(silent = false) {
    if (!this._isRecordingSTT) return;
    this.speech.stopRecognition();
    this._isRecordingSTT = false;
    const voiceBtn = this.ui.elements.chatVoiceBtn;
    if (voiceBtn) voiceBtn.classList.remove('stt-active');
  }
  
  _updateAnalyticsUI() {
    // Basic restore of _updateAnalyticsUI to prevent crashes
    const el = this.ui.elements;
    const summary = this.analytics.getSummary();
    if (el.statForms) el.statForms.textContent = summary.totalForms;
    if (el.statTemplates) el.statTemplates.textContent = summary.templateUses;
    if (el.statFields) el.statFields.textContent = summary.totalFieldsChecked;
    if (el.statLang) {
      const topLangNative = this._getLanguageLabel(summary.topLanguage);
      el.statLang.textContent = topLangNative;
    }
  }

  // ──────────────────── Wizard (Step-by-Step) ──────────────────

  _getWizardFieldValue(label) {
    const key = this._normalizeFieldLabel(label);
    return this.wizardState[key] || '';
  }

  _setWizardFieldValue(label, value) {
    const key = this._normalizeFieldLabel(label);
    this.wizardState[key] = value;
  }

  _startWizard(formIndex) {
    // Use the shared helper to flatten fields from forms array structure
    const fields = this._getAllFieldsFromResult(this.lastResult, formIndex);
    if (!fields.length) {
      this.ui.showToast('Wizard ke liye pehle form analyze karein', 'info');
      return;
    }

    let formName = '';
    if (formIndex !== null && formIndex !== undefined && this.lastResult && Array.isArray(this.lastResult.forms) && this.lastResult.forms[formIndex]) {
      formName = this.lastResult.forms[formIndex].form_name || `Form ${formIndex + 1}`;
    } else if (this.lastResult && !Array.isArray(this.lastResult.forms)) {
      formName = this.lastResult.form_name || 'Form';
    } else if (this.lastResult && Array.isArray(this.lastResult.forms) && this.lastResult.forms.length === 1) {
      formName = this.lastResult.forms[0].form_name || 'Form';
    }

    this.analytics.track('wizard_started', {
      totalFields: fields.length
    });

    const onNext = (idx) => {
      if (idx < fields.length - 1) {
        this.ui.showWizard(fields, onNext, onPrev, onClose, idx + 1, formName);
      } else {
        onClose();
        this.ui.showToast('🎉 Wizard complete! Form bharne ke liye shubhkaamnayein!', 'success', 3000);
      }
    };

    const onPrev = (idx) => {
      if (idx > 0) {
        this.ui.showWizard(fields, onNext, onPrev, onClose, idx - 1, formName);
      }
    };

    const onClose = () => {
      this.ui.hideWizard();
    };

    this.ui.showWizard(fields, onNext, onPrev, onClose, 0, formName);
  }

  // ──────────────────── Compare Modal (Phase 4) ────────────────

  /**
   * Normalize a form object into a common schema for comparison.
   * Handles both analyzed forms (form_name, sections[].fields[]) and
   * template library forms (name, result.fields[]).
   */
  _normalizeFormForComparison(form, source) {
    if (source === 'analyzed') {
      const fields = [];
      if (Array.isArray(form.sections)) {
        form.sections.forEach(sec => {
          if (Array.isArray(sec.fields)) fields.push(...sec.fields);
        });
      } else if (Array.isArray(form.fields)) {
        fields.push(...form.fields);
      }
      return {
        name: form.form_name || 'Form',
        fields,
        documents: form.documents_needed || [],
        tips: form.tips || '',
        purpose: form.purpose || ''
      };
    }
    if (source === 'template') {
      return {
        name: form.result?.form_name || form.name || 'Template',
        fields: (form.result?.fields || []).map(f => ({
          label: f.label || '',
          explanation: f.explanation || f.description || '',
          example: f.example || '',
          is_common: f.is_common || false
        })),
        documents: form.result?.documents_needed || [],
        tips: form.result?.tips || '',
        purpose: form.result?.purpose || ''
      };
    }
    return null;
  }

  /**
   * Normalize a field label for fuzzy matching.
   * Strips punctuation, parentheses content, and maps known aliases.
   */
  _normalizeFieldLabel(label) {
    return (label || '').toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/date\s*of\s*birth|d\s*o\s*b/g, 'dob')
      .replace(/mobile\s*no|mobile\s*number|phone\s*number|phone\s*no/g, 'mobile')
      .replace(/aadhaa?r\s*no|aadhaa?r\s*number|aadhaa?r\s*card/g, 'aadhaar')
      .replace(/pan\s*no|pan\s*number|pan\s*card/g, 'pan')
      .replace(/fathers?\s*name/g, 'fathername')
      .replace(/mothers?\s*name/g, 'mothername')
      .replace(/full\s*name|applicant\s*name/g, 'name')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if two field labels refer to the same concept.
   * 3-tier matching: exact normalized → contains → skip.
   */
  _fieldsMatch(label1, label2) {
    const n1 = this._normalizeFieldLabel(label1);
    const n2 = this._normalizeFieldLabel(label2);

    // Tier 1: exact normalized match
    if (n1 === n2) return true;

    // Tier 2: one contains the other (min 3 chars to avoid false positives)
    if (n1.length >= 3 && n2.length >= 3) {
      if (n1.includes(n2) || n2.includes(n1)) return true;
    }

    return false;
  }

  /**
   * Match fields from two forms, splitting into common / unique sets.
   * @returns {{ common: Array<{field1, field2}>, onlyIn1: Array, onlyIn2: Array }}
   */
  _matchFields(fields1, fields2) {
    const common = [];
    const onlyIn1 = [];
    const remaining2 = [...fields2]; // copy — splice matched out

    fields1.forEach(f1 => {
      const matchIdx = remaining2.findIndex(f2 => this._fieldsMatch(f1.label, f2.label));
      if (matchIdx !== -1) {
        common.push({ field1: f1, field2: remaining2[matchIdx] });
        remaining2.splice(matchIdx, 1);
      } else {
        onlyIn1.push(f1);
      }
    });

    return { common, onlyIn1, onlyIn2: remaining2 };
  }

  /**
   * Resolve a compare dropdown value (e.g. "analyzed-0" or "template-sbi-account")
   * into a normalized form object.
   */
  _resolveCompareForm(value) {
    if (value.startsWith('analyzed-')) {
      const idx = parseInt(value.replace('analyzed-', ''), 10);
      const form = this.lastResult?.forms?.[idx];
      return form ? this._normalizeFormForComparison(form, 'analyzed') : null;
    }
    if (value.startsWith('template-')) {
      const id = value.replace('template-', '');
      const t = this.templates.getTemplateById(id);
      return t ? this._normalizeFormForComparison(t, 'template') : null;
    }
    return null;
  }

  _openCompareModal() {
    const s1 = document.getElementById('compareSelect1');
    const s2 = document.getElementById('compareSelect2');
    const res = document.getElementById('compareResult');
    if (!s1 || !s2) return;

    // Build option HTML
    let optionsHTML = '<option value="">— Form chunein —</option>';

    // Group 1: Analyzed forms from lastResult
    const analyzedForms = this.lastResult?.forms?.filter(Boolean) || [];
    if (analyzedForms.length > 0) {
      optionsHTML += '<optgroup label="📸 Analyzed Forms">';
      analyzedForms.forEach((form, idx) => {
        const name = form.form_name || `Form ${idx + 1}`;
        optionsHTML += `<option value="analyzed-${idx}">${name}</option>`;
      });
      optionsHTML += '</optgroup>';
    }

    // Group 2: Template Library
    const templates = this.templates.getTemplates();
    if (templates.length > 0) {
      optionsHTML += '<optgroup label="📚 Template Library">';
      templates.forEach(t => {
        optionsHTML += `<option value="template-${t.id}">${t.icon} ${t.name}</option>`;
      });
      optionsHTML += '</optgroup>';
    }

    // Check if we have at least 2 options total
    const totalOptions = analyzedForms.length + templates.length;
    if (totalOptions < 2) {
      this.ui.showToast('Compare ke liye kam se kam 2 forms chahiye', 'info');
      return;
    }

    s1.innerHTML = optionsHTML;
    s2.innerHTML = optionsHTML;
    if (res) res.innerHTML = '';

    document.getElementById('compareModal')?.classList.remove('hidden');
    document.getElementById('compareOverlay')?.classList.remove('hidden');
  }

  _closeCompareModal() {
    document.getElementById('compareModal')?.classList.add('hidden');
    document.getElementById('compareOverlay')?.classList.add('hidden');
  }

  _compareForms() {
    const sel1 = document.getElementById('compareSelect1');
    const sel2 = document.getElementById('compareSelect2');
    if (!sel1?.value || !sel2?.value) {
      this.ui.showToast('Dono forms select karein', 'error');
      return;
    }
    if (sel1.value === sel2.value) {
      this.ui.showToast('Alag forms choose karein comparison ke liye', 'info');
      return;
    }

    const form1 = this._resolveCompareForm(sel1.value);
    const form2 = this._resolveCompareForm(sel2.value);
    if (!form1 || !form2) {
      this.ui.showToast('Form data nahi mila', 'error');
      return;
    }

    // Field matching
    const { common, onlyIn1, onlyIn2 } = this._matchFields(form1.fields, form2.fields);

    // Document comparison — index-safe filtering
    const docs1Lower = form1.documents.map(d => d.toLowerCase().trim());
    const docs2Lower = form2.documents.map(d => d.toLowerCase().trim());

    const commonDocsOriginal = form1.documents.filter((_orig, i) =>
      docs2Lower.some(d2 => d2.includes(docs1Lower[i]) || docs1Lower[i].includes(d2))
    );
    const uniqueDocs1 = form1.documents.filter((_orig, i) =>
      !docs2Lower.some(d2 => d2.includes(docs1Lower[i]) || docs1Lower[i].includes(d2))
    );
    const uniqueDocs2 = form2.documents.filter((_orig, i) =>
      !docs1Lower.some(d1 => d1.includes(docs2Lower[i]) || docs2Lower[i].includes(d1))
    );

    const compareData = {
      form1: { name: form1.name, totalFields: form1.fields.length },
      form2: { name: form2.name, totalFields: form2.fields.length },
      common,
      onlyIn1,
      onlyIn2,
      commonDocs: commonDocsOriginal,
      uniqueDocs1,
      uniqueDocs2
    };

    const container = document.getElementById('compareResult');
    this.ui.renderCompareResult(compareData, container);

    this.analytics.track('forms_compared', {
      form1: form1.name,
      form2: form2.name,
      commonFields: common.length
    });
  }

  // ──────────────────── Analytics ───────────────────────────

  _updateAnalyticsUI() {
    const summary = this.analytics.getSummary();
    const el = this.ui.elements;
    if (el.statForms) el.statForms.textContent = summary.totalForms;
    if (el.statTemplates) el.statTemplates.textContent = summary.templateUses;
    if (el.statFields) el.statFields.textContent = summary.totalFieldsChecked;
    if (el.statLang) {
      const topLangNative = this._getLanguageLabel(summary.topLanguage);
      el.statLang.textContent = topLangNative;
    }
  }
}

// ──────────────────── Bootstrap ───────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(err => {
    console.error(LOG_PREFIX, 'Init failed:', err);
  });

  window.__formSahayak = app;
});
