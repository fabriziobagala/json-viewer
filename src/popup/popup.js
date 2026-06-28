// Popup UI: shows the extension version, opens the options page, and toggles
// the keyboard-shortcuts list.
(() => {
  'use strict';

  const versionEl = document.getElementById('pp-version');
  try {
    versionEl.textContent = chrome.runtime.getManifest().version;
  } catch {
    versionEl.textContent = '?';
  }

  const lead = document.querySelector('.pp-lead');
  if (lead) {
    const SENTINEL = '\uE000';
    let text = '';
    try { text = chrome.i18n.getMessage('popupLead', [SENTINEL]) || ''; } catch { /* keep fallback */ }
    if (text.includes(SENTINEL)) {
      const [before, after = ''] = text.split(SENTINEL);
      const code = document.createElement('code');
      code.textContent = 'application/json';
      lead.replaceChildren(before, code, after);
    }
  }

  document.getElementById('pp-options').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  const tips = document.getElementById('pp-tips');
  const shortcutsBtn = document.getElementById('pp-shortcuts');
  shortcutsBtn.addEventListener('click', () => {
    tips.hidden = !tips.hidden;
    shortcutsBtn.setAttribute('aria-expanded', String(!tips.hidden));
  });
})();
