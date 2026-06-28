// Localizes static extension pages (popup, options) from _locales/<lang>/messages.json.
// Each element opts in via a data-* attribute naming the message key:
//   data-i18n            -> textContent
//   data-i18n-placeholder-> placeholder
//   data-i18n-label      -> aria-label
//   data-i18n-title      -> title
// Missing keys are left untouched so the page keeps its authored fallback text.
(() => {
  'use strict';

  /**
   * Look up a localized string from the active locale's messages.json.
   * @param {string} key - Message key (a property name in messages.json).
   * @returns {string} The localized text, or '' if missing or the API is unavailable.
   */
  const msg = (key) => {
    try { return chrome.i18n.getMessage(key) || ''; } catch { return ''; }
  };

  /**
   * Apply a localized string to every element matching `selector`, reading the
   * message key from the element's `data-*` entry named `attr`.
   * @param {string} selector - CSS selector for the opt-in elements.
   * @param {string} attr - camelCased dataset key naming the message (e.g. 'i18n').
   * @param {(node: HTMLElement, text: string) => void} apply - Writes the resolved text onto the node.
   * @returns {void}
   */
  const localize = (selector, attr, apply) => {
    document.querySelectorAll(selector).forEach((node) => {
      const text = msg(node.dataset[attr]);
      if (text) apply(node, text);
    });
  };

  localize('[data-i18n]', 'i18n', (n, t) => { n.textContent = t; });
  localize('[data-i18n-placeholder]', 'i18nPlaceholder', (n, t) => { n.placeholder = t; });
  localize('[data-i18n-label]', 'i18nLabel', (n, t) => { n.setAttribute('aria-label', t); });
  localize('[data-i18n-title]', 'i18nTitle', (n, t) => { n.title = t; });

  try {
    const lang = chrome.i18n.getUILanguage?.();
    if (lang) document.documentElement.lang = lang.split('-')[0];
  } catch { /* keep the authored lang attribute */ }
})();
