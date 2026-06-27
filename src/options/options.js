// Options page: loads display preferences from sync storage into the form and
// persists changes back (debounced), with a reset to defaults.
(() => {
  'use strict';

  /**
   * @typedef {object} Prefs
   * @property {'auto'|'light'|'dark'} theme - Colour theme for the viewer.
   * @property {'formatted'|'raw'} defaultView - View shown first when JSON loads.
   * @property {number} expandDepth - Tree levels expanded automatically (0-10).
   * @property {number} fontSize - Base font size in px (10-24).
   * @property {'original'|'2'|'4'|'tab'} rawIndent - Indentation used in the raw view.
   * @property {boolean} wrapText - Whether long lines wrap instead of scrolling.
   * @property {boolean} sortKeys - Whether object keys are sorted alphabetically.
   * @property {number} maxSizeMb - Largest payload formatted, in megabytes (1-100).
   */

  /** @type {Prefs} */
  const DEFAULTS = {
    theme: 'auto',
    defaultView: 'formatted',
    expandDepth: 2,
    fontSize: 14,
    rawIndent: 'original',
    wrapText: true,
    sortKeys: false,
    maxSizeMb: 10,
  };

  const status = document.getElementById('op-status');
  const depth = document.getElementById('op-depth');
  const depthOut = document.getElementById('op-depth-out');
  const font = document.getElementById('op-font');
  const fontOut = document.getElementById('op-font-out');
  const wrap = document.getElementById('op-wrap');
  const sort = document.getElementById('op-sort');
  const maxSize = document.getElementById('op-maxsize');
  const resetBtn = document.getElementById('op-reset');

  const themeInputs = document.querySelectorAll('input[name="theme"]');
  const viewInputs = document.querySelectorAll('input[name="defaultView"]');
  const indentInputs = document.querySelectorAll('input[name="rawIndent"]');

  /**
   * Resolve a localized message, optionally substituting $1, $2… placeholders.
   * @param {string} key - Message key from messages.json.
   * @param {string|string[]} [subs] - Substitution(s) for the placeholders.
   * @returns {string} The localized text, or '' when missing.
   */
  const i18n = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || ''; } catch { return ''; }
  };

  /**
   * Return the value of the checked radio in a group, if any.
   * @param {Iterable<HTMLInputElement>} inputs - The radio group inputs.
   * @returns {string|undefined} The checked input's value, or undefined.
   */
  const checked = (inputs) => [...inputs].find((i) => i.checked)?.value;
  /**
   * Mirror a switch's native checked state onto its aria-checked attribute.
   * role="switch" requires aria-checked to track the native checked state.
   * @param {HTMLInputElement} input - The element with role="switch".
   * @returns {void}
   */
  const syncSwitch = (input) => input.setAttribute('aria-checked', String(input.checked));
  /**
   * Parse an integer and constrain it to [lo, hi], falling back when unparseable.
   * @param {string|number} v - The raw value to parse.
   * @param {number} lo - Lower bound (inclusive).
   * @param {number} hi - Upper bound (inclusive).
   * @param {number} fallback - Value used when `v` is not a number.
   * @returns {number} The clamped integer.
   */
  const clamp = (v, lo, hi, fallback) => {
    const n = Number.parseInt(v, 10);
    return Math.max(lo, Math.min(hi, Number.isNaN(n) ? fallback : n));
  };

  let saveTimer;
  /**
   * Debounce a save by 250 ms so rapid edits persist only once.
   * @returns {void}
   */
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  };

  /**
   * Read stored preferences from chrome.storage.sync, merged over the defaults.
   * @returns {Promise<Prefs>} The effective preferences.
   */
  const load = async () => {
    const prefs = await chrome.storage.sync.get(DEFAULTS);
    return { ...DEFAULTS, ...prefs };
  };

  /**
   * Populate the form controls from a preferences object.
   * @param {Prefs} prefs - Preferences to display.
   * @returns {void}
   */
  function apply(prefs) {
    themeInputs.forEach((i) => { i.checked = i.value === prefs.theme; });
    viewInputs.forEach((i) => { i.checked = i.value === prefs.defaultView; });
    indentInputs.forEach((i) => { i.checked = i.value === prefs.rawIndent; });
    depth.value = String(prefs.expandDepth);
    depthOut.textContent = String(prefs.expandDepth);
    font.value = String(prefs.fontSize);
    fontOut.textContent = prefs.fontSize + ' px';
    wrap.checked = !!prefs.wrapText;
    sort.checked = !!prefs.sortKeys;
    syncSwitch(wrap);
    syncSwitch(sort);
    maxSize.value = String(prefs.maxSizeMb);
  }

  /**
   * Read the current form state into a validated preferences object.
   * @returns {Prefs} The collected, clamped preferences.
   */
  function collect() {
    return {
      theme: checked(themeInputs) || DEFAULTS.theme,
      defaultView: checked(viewInputs) || DEFAULTS.defaultView,
      expandDepth: clamp(depth.value, 0, 10, DEFAULTS.expandDepth),
      fontSize: clamp(font.value, 10, 24, DEFAULTS.fontSize),
      rawIndent: checked(indentInputs) || DEFAULTS.rawIndent,
      wrapText: wrap.checked,
      sortKeys: sort.checked,
      maxSizeMb: clamp(maxSize.value, 1, 100, DEFAULTS.maxSizeMb),
    };
  }

  /**
   * Show a transient status message that clears itself after 1.6 s.
   * @param {string} message - Text to display.
   * @returns {void}
   */
  function flashStatus(message) {
    status.textContent = message;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => { status.textContent = ''; }, 1600);
  }

  /**
   * Persist the current form state to chrome.storage.sync and report the outcome.
   * @returns {Promise<void>}
   */
  async function save() {
    const prefs = collect();
    try {
      await chrome.storage.sync.set(prefs);
      flashStatus(i18n('optionsStatusSaved'));
    } catch (err) {
      status.textContent = i18n('optionsStatusError', [err.message]);
    }
  }

  themeInputs.forEach((i) => i.addEventListener('change', scheduleSave));
  viewInputs.forEach((i) => i.addEventListener('change', scheduleSave));
  indentInputs.forEach((i) => i.addEventListener('change', scheduleSave));
  wrap.addEventListener('change', () => { syncSwitch(wrap); scheduleSave(); });
  sort.addEventListener('change', () => { syncSwitch(sort); scheduleSave(); });
  maxSize.addEventListener('input', scheduleSave);
  depth.addEventListener('input', () => {
    depthOut.textContent = depth.value;
    scheduleSave();
  });
  font.addEventListener('input', () => {
    fontOut.textContent = font.value + ' px';
    scheduleSave();
  });

  resetBtn.addEventListener('click', async () => {
    apply(DEFAULTS);
    await chrome.storage.sync.set(DEFAULTS);
    flashStatus(i18n('optionsStatusReset'));
  });

  (async () => { apply(await load()); })();
})();
