/**
 * @fileoverview Utility functions for Form Sahayak PWA.
 * Pure vanilla JS — zero external dependencies.
 * @module utils
 */

const LOG_PREFIX = '[FormSahayak]';

/**
 * Generate a cryptographically random 12-character hex string.
 * Falls back to Math.random if crypto API is unavailable.
 * @returns {string} 12-char lowercase hex ID
 */
export function generateId() {
  try {
    const bytes = new Uint8Array(6); // 6 bytes → 12 hex chars
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn(LOG_PREFIX, 'crypto.getRandomValues unavailable, using fallback', err);
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
  }
}

/**
 * Standard debounce — delays invocation until `ms` milliseconds have elapsed
 * since the last call.
 * @param {Function} fn  The function to debounce
 * @param {number}   ms  Delay in milliseconds
 * @returns {Function} Debounced wrapper
 */
export function debounce(fn, ms) {
  let timerId = null;

  /** @param {...*} args */
  const debounced = function (...args) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, ms);
  };

  /** Cancel any pending invocation. */
  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced;
}

/**
 * Format a Date into "DD MMM YYYY, HH:MM" (24-hour, IST-friendly).
 * @param {Date|string|number} date — value convertible to Date
 * @returns {string} e.g. "23 Jun 2026, 15:44"
 */
export function formatDate(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) {
      console.warn(LOG_PREFIX, 'formatDate received invalid date:', date);
      return 'Invalid Date';
    }

    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    const day   = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year  = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins  = String(d.getMinutes()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${mins}`;
  } catch (err) {
    console.error(LOG_PREFIX, 'formatDate error:', err);
    return 'Invalid Date';
  }
}

/**
 * Escape HTML entities to prevent XSS when injecting user-supplied text into
 * the DOM via innerHTML.
 * @param {string} str Raw string
 * @returns {string} Escaped string safe for HTML insertion
 */
export function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';

  const map = {
    '&':  '&amp;',
    '<':  '&lt;',
    '>':  '&gt;',
    '"':  '&quot;',
    "'":  '&#039;',
    '/':  '&#x2F;',
    '`':  '&#x60;',
  };

  return str.replace(/[&<>"'`/]/g, (ch) => map[ch]);
}

/**
 * Promise-based delay.
 * @param {number} ms Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple async concurrency limiter.
 * @param {number} concurrency Maximum number of concurrent promises
 * @returns {Function} A function that takes a promise-returning function and returns a promise
 */
export function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      run(fn, resolve, reject);
    }
  };

  const run = async (fn, resolve, reject) => {
    activeCount++;
    try {
      resolve(await fn());
    } catch (err) {
      reject(err);
    } finally {
      next();
    }
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      if (activeCount < concurrency) {
        run(fn, resolve, reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
  };
}

/**
 * Format bytes into a human-readable string (B / KB / MB / GB / TB).
 * @param {number} bytes
 * @param {number} [decimals=2] Decimal places
 * @returns {string} e.g. "1.45 MB"
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes == null || Number.isNaN(bytes)) return '0 B';
  if (bytes === 0) return '0 B';

  const sign = bytes < 0 ? '-' : '';
  const absBytes = Math.abs(bytes);
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(
    Math.floor(Math.log(absBytes) / Math.log(k)),
    units.length - 1,
  );

  const value = absBytes / Math.pow(k, i);
  return `${sign}${value.toFixed(decimals)} ${units[i]}`;
}
