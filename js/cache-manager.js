/**
 * @fileoverview IndexedDB-based template cache and analysis history for Form Sahayak.
 * Replaces a server-side Redis cache with a fully client-side solution.
 *
 * Object Stores:
 *   - templateCache  (keyPath: 'fingerprint', index: 'timestamp')
 *   - history        (keyPath: 'id',          index: 'timestamp')
 *
 * Cache hit/miss counters are stored in localStorage because they are tiny
 * scalar values and don't warrant a dedicated IDB store.
 *
 * @module cache-manager
 */

const LOG_PREFIX = '[FormSahayak]';
const HISTORY_LIMIT = 20;

/**
 * @typedef {Object} CacheEntry
 * @property {string}  fingerprint  Perceptual hash of the form image
 * @property {Object}  result       Parsed analysis JSON
 * @property {Object}  metadata     Arbitrary metadata (provider, language, …)
 * @property {number}  timestamp    Unix epoch ms when cached
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string}  id           Unique hex ID
 * @property {string}  formName     Detected form name
 * @property {string}  purpose      One-line purpose
 * @property {number}  fieldsCount  Number of fields extracted
 * @property {string}  language     Analysis language
 * @property {number}  timestamp    Unix epoch ms
 */

/**
 * @typedef {Object} CacheStats
 * @property {number} totalEntries
 * @property {number} hitCount
 * @property {number} missCount
 */

export class CacheManager {
  /**
   * @param {string} [dbName='formSahayakDB']
   * @param {number} [version=1]
   */
  constructor(dbName = 'formSahayakDB', version = 1) {
    /** @type {string} */
    this.dbName = dbName;
    /** @type {number} */
    this.version = version;
    /** @type {IDBDatabase|null} */
    this.db = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Initialisation                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Open (or create) the IndexedDB database and object stores.
   * Safe to call multiple times — subsequent calls are no-ops if already open.
   * @returns {Promise<void>}
   */
  async init() {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(this.dbName, this.version);
      } catch (err) {
        console.error(LOG_PREFIX, 'IndexedDB open failed:', err);
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }

      request.onupgradeneeded = (event) => {
        /** @type {IDBDatabase} */
        const db = event.target.result;

        // templateCache store
        if (!db.objectStoreNames.contains('templateCache')) {
          const cacheStore = db.createObjectStore('templateCache', { keyPath: 'fingerprint' });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // history store
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        console.log(LOG_PREFIX, 'IndexedDB stores created / upgraded');
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;

        // Handle unexpected close (e.g. version change in another tab)
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          console.warn(LOG_PREFIX, 'Database closed due to version change in another tab.');
        };

        console.log(LOG_PREFIX, 'IndexedDB initialised');
        resolve();
      };

      request.onerror = (event) => {
        console.error(LOG_PREFIX, 'IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn(LOG_PREFIX, 'IndexedDB open blocked — close other tabs using this DB.');
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Ensure the database is open; throw a clear error if not.
   * @private
   */
  _ensureDb() {
    if (!this.db) {
      throw new Error('CacheManager not initialised. Call init() first.');
    }
  }

  /**
   * Wrap an IDBRequest in a Promise.
   * @private
   * @param {IDBRequest} request
   * @returns {Promise<*>}
   */
  _promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror   = () => reject(request.error);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Template Cache                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Retrieve a cached analysis result by perceptual hash fingerprint.
   * @param {string} fingerprint  Hex hash from ImageProcessor.computePerceptualHash
   * @returns {Promise<Object|null>} Cached result JSON or null
   */
  async getCachedResult(fingerprint) {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('templateCache', 'readonly');
      const store = tx.objectStore('templateCache');
      const entry = await this._promisify(store.get(fingerprint));

      if (entry) {
        console.log(LOG_PREFIX, 'Cache HIT for fingerprint:', fingerprint.slice(0, 8) + '…');
        await this.incrementHit();
        return entry.result;
      }

      console.log(LOG_PREFIX, 'Cache MISS for fingerprint:', fingerprint.slice(0, 8) + '…');
      await this.incrementMiss();
      return null;
    } catch (err) {
      console.error(LOG_PREFIX, 'getCachedResult error:', err);
      return null;
    }
  }

  /**
   * Store an analysis result keyed by perceptual hash.
   * @param {string} fingerprint
   * @param {Object} result       Parsed analysis JSON
   * @param {Object} [metadata={}] Extra info (provider, language, etc.)
   * @returns {Promise<void>}
   */
  async setCachedResult(fingerprint, result, metadata = {}) {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('templateCache', 'readwrite');
      const store = tx.objectStore('templateCache');

      /** @type {CacheEntry} */
      const entry = {
        fingerprint,
        result,
        metadata,
        timestamp: Date.now(),
      };

      await this._promisify(store.put(entry));
      console.log(LOG_PREFIX, 'Cached result for fingerprint:', fingerprint.slice(0, 8) + '…');
    } catch (err) {
      console.error(LOG_PREFIX, 'setCachedResult error:', err);
    }
  }

  /**
   * Return aggregate cache statistics.
   * @returns {Promise<CacheStats>}
   */
  async getCacheStats() {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('templateCache', 'readonly');
      const store = tx.objectStore('templateCache');
      const totalEntries = await this._promisify(store.count());

      return {
        totalEntries,
        hitCount:  this._getCounter('cacheHits'),
        missCount: this._getCounter('cacheMisses'),
      };
    } catch (err) {
      console.error(LOG_PREFIX, 'getCacheStats error:', err);
      return { totalEntries: 0, hitCount: 0, missCount: 0 };
    }
  }

  /**
   * Increment the cache-hit counter in localStorage.
   * @returns {Promise<void>}
   */
  async incrementHit() {
    this._incrementCounter('cacheHits');
  }

  /**
   * Increment the cache-miss counter in localStorage.
   * @returns {Promise<void>}
   */
  async incrementMiss() {
    this._incrementCounter('cacheMisses');
  }

  /**
   * Read a numeric counter from localStorage.
   * @private
   * @param {string} key
   * @returns {number}
   */
  _getCounter(key) {
    try {
      return parseInt(localStorage.getItem(`formSahayak_${key}`) || '0', 10);
    } catch {
      return 0;
    }
  }

  /**
   * Atomically increment a localStorage counter.
   * @private
   * @param {string} key
   */
  _incrementCounter(key) {
    try {
      const current = this._getCounter(key);
      localStorage.setItem(`formSahayak_${key}`, String(current + 1));
    } catch (err) {
      console.warn(LOG_PREFIX, 'localStorage counter update failed:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Analysis History                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Add an entry to the analysis history.
   * Automatically trims the store to the newest {@link HISTORY_LIMIT} entries.
   * @param {HistoryEntry} entry
   * @returns {Promise<void>}
   */
  async addToHistory(entry) {
    try {
      this._ensureDb();
      const record = {
        ...entry,
        timestamp: entry.timestamp || Date.now(),
      };

      const tx    = this.db.transaction('history', 'readwrite');
      const store = tx.objectStore('history');
      await this._promisify(store.put(record));

      // Enforce max history length
      await this._trimHistory();

      console.log(LOG_PREFIX, 'Added to history:', record.formName || record.id);
    } catch (err) {
      console.error(LOG_PREFIX, 'addToHistory error:', err);
    }
  }

  /**
   * Retrieve analysis history sorted by timestamp descending (newest first).
   * @returns {Promise<HistoryEntry[]>} Max {@link HISTORY_LIMIT} entries
   */
  async getHistory() {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('history', 'readonly');
      const store = tx.objectStore('history');
      const index = store.index('timestamp');

      return new Promise((resolve, reject) => {
        const results = [];
        const cursorReq = index.openCursor(null, 'prev'); // descending

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && results.length < HISTORY_LIMIT) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch (err) {
      console.error(LOG_PREFIX, 'getHistory error:', err);
      return [];
    }
  }

  /**
   * Delete all history entries.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('history', 'readwrite');
      const store = tx.objectStore('history');
      await this._promisify(store.clear());
      console.log(LOG_PREFIX, 'History cleared');
    } catch (err) {
      console.error(LOG_PREFIX, 'clearHistory error:', err);
    }
  }

  /**
   * Keep only the newest {@link HISTORY_LIMIT} entries in the history store.
   * @private
   * @returns {Promise<void>}
   */
  async _trimHistory() {
    try {
      this._ensureDb();
      const tx    = this.db.transaction('history', 'readwrite');
      const store = tx.objectStore('history');
      const index = store.index('timestamp');

      const count = await this._promisify(store.count());
      if (count <= HISTORY_LIMIT) return;

      const excess = count - HISTORY_LIMIT;
      let deleted = 0;

      return new Promise((resolve, reject) => {
        const cursorReq = index.openCursor(null, 'next'); // oldest first

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && deleted < excess) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            resolve();
          }
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch (err) {
      console.warn(LOG_PREFIX, 'trimHistory error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Remove template-cache entries older than a given number of days.
   * @param {number} [maxAgeDays=30]
   * @returns {Promise<number>} Number of entries removed
   */
  async clearOldEntries(maxAgeDays = 30) {
    try {
      this._ensureDb();
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const tx     = this.db.transaction('templateCache', 'readwrite');
      const store  = tx.objectStore('templateCache');
      const index  = store.index('timestamp');
      const range  = IDBKeyRange.upperBound(cutoff);

      let removed = 0;

      return new Promise((resolve, reject) => {
        const cursorReq = index.openCursor(range);

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            removed++;
            cursor.continue();
          } else {
            console.log(LOG_PREFIX, `Cleaned up ${removed} stale cache entries (>${maxAgeDays} days)`);
            resolve(removed);
          }
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch (err) {
      console.error(LOG_PREFIX, 'clearOldEntries error:', err);
      return 0;
    }
  }
}
