/**
 * @fileoverview Analytics Service
 * Tracks client-side usage, events, and provides simple data for the dashboard.
 * @module analytics-service
 */

export class AnalyticsService {
  constructor() {
    this.storageKey = 'fs_analytics_events';
    this._initStorage();
  }

  _initStorage() {
    if (!localStorage.getItem(this.storageKey)) {
      localStorage.setItem(this.storageKey, JSON.stringify([]));
    }
  }

  /**
   * Track an event
   * @param {string} eventName - e.g. 'form_analyzed', 'template_used', 'feature_used'
   * @param {Object} data - Context data
   */
  track(eventName, data = {}) {
    try {
      const events = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      events.push({
        event: eventName,
        data,
        timestamp: Date.now()
      });
      // Keep only last 1000 events
      if (events.length > 1000) events.shift();
      localStorage.setItem(this.storageKey, JSON.stringify(events));
      console.log('[Analytics] Tracked:', eventName, data);
    } catch (_) {}
  }

  getEvents() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch (_) {
      return [];
    }
  }

  getSummary() {
    const events = this.getEvents();
    
    let totalForms = 0;
    let templateUses = 0;
    let totalFieldsChecked = 0;
    const languages = {};
    const categories = {};

    events.forEach(e => {
      if (e.event === 'form_analyzed') {
        totalForms++;
        const lang = e.data.language || 'hinglish';
        languages[lang] = (languages[lang] || 0) + 1;
        const cat = e.data.category || 'other';
        categories[cat] = (categories[cat] || 0) + 1;
      }
      if (e.event === 'template_used') {
        templateUses++;
      }
      if (e.event === 'field_checked') {
        totalFieldsChecked++;
      }
    });

    // Find top language
    let topLanguage = 'hinglish';
    let maxLang = 0;
    for (const [lang, count] of Object.entries(languages)) {
      if (count > maxLang) {
        maxLang = count;
        topLanguage = lang;
      }
    }

    return {
      totalForms,
      templateUses,
      totalFieldsChecked,
      topLanguage,
      categories
    };
  }
}
