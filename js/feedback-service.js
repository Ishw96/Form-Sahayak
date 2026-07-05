/**
 * @fileoverview FeedbackService — User feedback collection stored in IndexedDB.
 * Part of Form Sahayak PWA.
 * @module feedback-service
 */

import { generateId } from './utils.js';

/**
 * Allowed issue types for field-level feedback.
 * @type {Set<string>}
 */
const VALID_ISSUE_TYPES = new Set([
  'wrong_explanation',
  'missing_field',
  'unclear',
  'other',
]);

/**
 * Collects and persists user feedback (field-level issues, overall ratings)
 * in IndexedDB. The database reference is provided by CacheManager after it
 * opens / upgrades the database with the required 'feedback' object store.
 *
 * @example
 * const fb = new FeedbackService();
 * await fb.init(db); // db from CacheManager
 * await fb.submitFieldFeedback('job-1', 'PAN Number', 'wrong_explanation', 'Galat bataya');
 */
export class FeedbackService {
  constructor() {
    /** @type {IDBDatabase|null} */
    this.db = null;

    /** @type {string} IndexedDB object store name */
    this.storeName = 'feedback';
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  /**
   * Receive the IndexedDB database reference from CacheManager.
   * The 'feedback' object store (keyPath = 'id') must already exist.
   *
   * @param {IDBDatabase} db — open IndexedDB database instance.
   * @returns {Promise<FeedbackService>} — this instance, for chaining.
   * @throws {Error} If db is not provided or store doesn't exist.
   */
  async init(db) {
    if (!db) {
      throw new Error('[FeedbackService] A valid IDBDatabase instance is required.');
    }

    // Verify the object store exists
    if (!db.objectStoreNames.contains(this.storeName)) {
      console.warn(
        `[FeedbackService] Object store "${this.storeName}" not found. ` +
        'Make sure CacheManager creates it during DB upgrade.'
      );
    }

    this.db = db;
    return this;
  }

  // ───────────────────────── Public API ────────────────────────

  /**
   * Submit feedback about a specific form field.
   *
   * @param {string} jobId      — analysis job / session identifier.
   * @param {string} fieldLabel — the label of the field the feedback is about.
   * @param {string} issueType  — one of: 'wrong_explanation', 'missing_field',
   *                              'unclear', 'other'.
   * @param {string} [comment]  — optional free-text comment from the user.
   * @returns {Promise<boolean>} true on success, false on failure.
   */
  async submitFieldFeedback(jobId, fieldLabel, issueType, comment = '') {
    // ── Input validation ──
    if (!jobId || typeof jobId !== 'string') {
      console.error('[FeedbackService] jobId is required.');
      return false;
    }

    if (!fieldLabel || typeof fieldLabel !== 'string') {
      console.error('[FeedbackService] fieldLabel is required.');
      return false;
    }

    if (!VALID_ISSUE_TYPES.has(issueType)) {
      console.error(
        `[FeedbackService] Invalid issueType "${issueType}". ` +
        `Allowed: ${[...VALID_ISSUE_TYPES].join(', ')}`
      );
      return false;
    }

    const entry = {
      id: generateId(),
      jobId,
      fieldLabel,
      issueType,
      comment: String(comment || ''),
      type: 'field',
      timestamp: Date.now(),
    };

    try {
      const store = this._getStore('readwrite');
      await this._promisifyRequest(store.add(entry));
      return true;
    } catch (err) {
      console.error('[FeedbackService] Failed to submit field feedback:', err);
      return false;
    }
  }

  /**
   * Submit an overall rating for a form analysis.
   *
   * @param {string}  jobId   — analysis job / session identifier.
   * @param {number}  rating  — star rating, 1–5.
   * @param {string}  [comment] — optional free-text comment.
   * @returns {Promise<boolean>} true on success, false on failure.
   */
  async submitOverallRating(jobId, rating, comment = '') {
    // ── Input validation ──
    if (!jobId || typeof jobId !== 'string') {
      console.error('[FeedbackService] jobId is required.');
      return false;
    }

    const r = Number(rating);
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      console.error('[FeedbackService] rating must be between 1 and 5.');
      return false;
    }

    const entry = {
      id: generateId(),
      jobId,
      type: 'overall',
      rating: Math.round(r), // ensure integer
      comment: String(comment || ''),
      timestamp: Date.now(),
    };

    try {
      const store = this._getStore('readwrite');
      await this._promisifyRequest(store.add(entry));
      return true;
    } catch (err) {
      console.error('[FeedbackService] Failed to submit overall rating:', err);
      return false;
    }
  }

  /**
   * Retrieve all feedback entries, sorted by timestamp descending
   * (newest first).
   *
   * @returns {Promise<Array<Object>>} feedback entries.
   */
  async getAllFeedback() {
    try {
      const store = this._getStore('readonly');
      const entries = await this._promisifyRequest(store.getAll());

      // Sort newest-first
      return (entries || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } catch (err) {
      console.error('[FeedbackService] Failed to get all feedback:', err);
      return [];
    }
  }

  /**
   * Export all feedback as a pretty-printed JSON string.
   * Includes metadata useful for analysis / download.
   *
   * @returns {Promise<string>} JSON string.
   */
  async exportAsJSON() {
    try {
      const entries = await this.getAllFeedback();

      const exportData = {
        exportDate: new Date().toISOString(),
        totalEntries: entries.length,
        version: '1.0.0',
        feedback: entries,
      };

      return JSON.stringify(exportData, null, 2);
    } catch (err) {
      console.error('[FeedbackService] Failed to export feedback:', err);
      return JSON.stringify({
        exportDate: new Date().toISOString(),
        totalEntries: 0,
        version: '1.0.0',
        feedback: [],
        error: 'Export mein dikkat aayi.',
      }, null, 2);
    }
  }

  /**
   * Get the total number of stored feedback entries.
   *
   * @returns {Promise<number>}
   */
  async getFeedbackCount() {
    try {
      const store = this._getStore('readonly');
      return await this._promisifyRequest(store.count());
    } catch (err) {
      console.error('[FeedbackService] Failed to get feedback count:', err);
      return 0;
    }
  }

  // ───────────────────────── Private helpers ───────────────────

  /**
   * Open a transaction and return the object store.
   *
   * @param {IDBTransactionMode} [mode='readonly']
   * @returns {IDBObjectStore}
   * @throws {Error} If the database has not been initialised.
   * @private
   */
  _getStore(mode = 'readonly') {
    if (!this.db) {
      throw new Error(
        '[FeedbackService] Database not initialised. Call init(db) first.'
      );
    }

    const tx = this.db.transaction(this.storeName, mode);
    return tx.objectStore(this.storeName);
  }

  /**
   * Wrap an IDBRequest in a Promise.
   *
   * @param {IDBRequest} request
   * @returns {Promise<*>} resolves with request.result.
   * @private
   */
  _promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error('IDBRequest failed.'));
    });
  }
}
