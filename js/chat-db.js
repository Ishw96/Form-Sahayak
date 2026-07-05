/**
 * @fileoverview Chat Database — Dexie.js wrapper for IndexedDB.
 * Manages chat history, messages, and auto-expiry of image blobs.
 * 
 * Schema:
 *   chats:    ++id, title, createdAt, updatedAt
 *   messages: ++id, chatId, role, content, imageDataUrls, timestamp
 * 
 * @module chat-db
 */

// Dexie is loaded via CDN in index.html (global `Dexie`)

const DB_NAME = 'FormSahayakChat';
const IMAGE_RETENTION_DAYS = 7;

export class ChatDB {
  constructor() {
    /** @type {Dexie} */
    this.db = null;
  }

  /**
   * Initialize the database with schema.
   */
  async init() {
    if (typeof Dexie === 'undefined') {
      console.warn('[ChatDB] Dexie.js not loaded, falling back to in-memory');
      this._fallbackMode = true;
      this._memChats = [];
      this._memMessages = [];
      this._memIdCounter = 1;
      return;
    }

    this.db = new Dexie(DB_NAME);

    this.db.version(1).stores({
      chats:    '++id, title, createdAt, updatedAt',
      messages: '++id, chatId, role, timestamp'
    });

    await this.db.open();
    console.log('[ChatDB] Database ready');

    // Run image cleanup on startup
    await this._cleanupExpiredImages();
  }

  // ──────────────────── Chats ────────────────────

  /**
   * Create a new chat.
   * @param {string} title — initial title (e.g. "New Chat")
   * @returns {Promise<number>} chat ID
   */
  async createChat(title = 'New Chat') {
    const now = Date.now();
    if (this._fallbackMode) {
      const id = this._memIdCounter++;
      this._memChats.push({ id, title, createdAt: now, updatedAt: now });
      return id;
    }
    return await this.db.chats.add({
      title,
      createdAt: now,
      updatedAt: now
    });
  }

  /**
   * Get all chats, newest first.
   * @returns {Promise<Array>}
   */
  async getAllChats() {
    if (this._fallbackMode) {
      return [...this._memChats].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return await this.db.chats.orderBy('updatedAt').reverse().toArray();
  }

  /**
   * Update a chat's title and/or updatedAt.
   * @param {number} chatId
   * @param {Object} updates — e.g. { title: 'KYC Form', updatedAt: Date.now() }
   */
  async updateChat(chatId, updates) {
    if (this._fallbackMode) {
      const chat = this._memChats.find(c => c.id === chatId);
      if (chat) Object.assign(chat, updates);
      return;
    }
    await this.db.chats.update(chatId, updates);
  }

  /**
   * Delete a single chat and its messages.
   * @param {number} chatId
   */
  async deleteChat(chatId) {
    if (this._fallbackMode) {
      this._memChats = this._memChats.filter(c => c.id !== chatId);
      this._memMessages = this._memMessages.filter(m => m.chatId !== chatId);
      return;
    }
    await this.db.transaction('rw', this.db.chats, this.db.messages, async () => {
      await this.db.messages.where('chatId').equals(chatId).delete();
      await this.db.chats.delete(chatId);
    });
  }

  /**
   * Clear ALL history — chats and messages.
   */
  async clearAll() {
    if (this._fallbackMode) {
      this._memChats = [];
      this._memMessages = [];
      return;
    }
    await this.db.transaction('rw', this.db.chats, this.db.messages, async () => {
      await this.db.chats.clear();
      await this.db.messages.clear();
    });
  }

  // ──────────────────── Messages ────────────────────

  /**
   * Add a message to a chat.
   * @param {Object} msg — { chatId, role: 'user'|'ai'|'system', content, imageDataUrls?, resultData? }
   * @returns {Promise<number>} message ID
   */
  async addMessage(msg) {
    const record = {
      chatId: msg.chatId,
      role: msg.role,
      content: msg.content || '',
      imageDataUrls: msg.imageDataUrls || null,
      resultData: msg.resultData || null, // structured AI response
      timestamp: Date.now()
    };

    if (this._fallbackMode) {
      const id = this._memIdCounter++;
      this._memMessages.push({ id, ...record });
      return id;
    }
    return await this.db.messages.add(record);
  }

  /**
   * Get all messages for a chat, oldest first.
   * @param {number} chatId
   * @returns {Promise<Array>}
   */
  async getMessages(chatId) {
    if (this._fallbackMode) {
      return this._memMessages
        .filter(m => m.chatId === chatId)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    return await this.db.messages
      .where('chatId').equals(chatId)
      .sortBy('timestamp');
  }

  // ──────────────────── Cleanup & Privacy ────────────────────

  /**
   * Remove image data from messages older than IMAGE_RETENTION_DAYS.
   * Keeps text content and resultData — only strips imageDataUrls.
   * @private
   */
  async _cleanupExpiredImages() {
    if (this._fallbackMode) return;

    const cutoff = Date.now() - (IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    try {
      const oldMessages = await this.db.messages
        .where('timestamp').below(cutoff)
        .toArray();

      let cleaned = 0;
      for (const msg of oldMessages) {
        if (msg.imageDataUrls && msg.imageDataUrls.length > 0) {
          await this.db.messages.update(msg.id, { imageDataUrls: null });
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[ChatDB] Cleaned images from ${cleaned} old messages (>${IMAGE_RETENTION_DAYS} days)`);
      }
    } catch (e) {
      console.warn('[ChatDB] Image cleanup failed:', e.message);
    }
  }

  /**
   * Get approximate storage usage.
   * @returns {Promise<{chats: number, messages: number, estimatedSizeKB: number}>}
   */
  async getStorageStats() {
    if (this._fallbackMode) {
      return { chats: this._memChats.length, messages: this._memMessages.length, estimatedSizeKB: 0 };
    }
    const chats = await this.db.chats.count();
    const messages = await this.db.messages.count();

    // Estimate storage via navigator.storage if available
    let estimatedSizeKB = 0;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        estimatedSizeKB = Math.round((est.usage || 0) / 1024);
      } catch (_) {}
    }

    return { chats, messages, estimatedSizeKB };
  }
}
