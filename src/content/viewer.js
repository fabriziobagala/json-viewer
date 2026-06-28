// Content script: when a page is served as JSON, replaces it with an interactive
// viewer (tree + raw view, search, copy, keyboard navigation). Runs at
// document_start and bails out immediately on non-JSON responses.
(() => {
  'use strict';

  /**
   * @typedef {object} Prefs
   * @property {'auto'|'light'|'dark'} theme - Colour theme for the viewer.
   * @property {'formatted'|'raw'} defaultView - View shown first when JSON loads.
   * @property {number} expandDepth - Tree levels expanded automatically.
   * @property {number} fontSize - Base font size in px.
   * @property {'original'|'2'|'4'|'tab'} rawIndent - Indentation used in the raw view.
   * @property {boolean} wrapText - Whether long lines wrap instead of scrolling.
   * @property {boolean} sortKeys - Whether object keys are sorted alphabetically.
   * @property {number} maxSizeMb - Largest payload formatted, in megabytes.
   */

  /**
   * @typedef {object} ParseResult
   * @property {string} raw - The original, trimmed JSON text.
   * @property {*} data - The parsed JSON value.
   */

  /**
   * Resolve a localized message, optionally substituting $1, $2… placeholders.
   * @param {string} key - Message key from messages.json.
   * @param {string|string[]} [subs] - Substitution(s) for the placeholders.
   * @returns {string} The localized text, or '' when missing.
   */
  const i18n = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || ''; } catch { return ''; }
  };

  const JSON_CT = /^(?:application|text)\/(?:[a-z.+-]*\+)?json\b/i;
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

  const contentType = (document.contentType || '').toLowerCase();
  if (!JSON_CT.test(contentType)) return;

  document.documentElement.dataset.jvActive = '1';

  /**
   * Load display preferences from sync storage, falling back to defaults.
   * @returns {Promise<Prefs>} The stored preferences (or defaults on failure).
   */
  const loadPrefs = async () => {
    try {
      return await chrome.storage.sync.get(DEFAULTS);
    } catch {
      return { ...DEFAULTS };
    }
  };

  /**
   * Parse text as JSON if it is non-empty and within the size limit.
   * @param {string} text - Candidate JSON text.
   * @param {number} maxBytes - Maximum allowed byte size; 0 disables the check.
   * @returns {ParseResult|null} The parsed result, or null if empty/too large/invalid.
   */
  function tryParse(text, maxBytes) {
    const t = (text || '').trim();
    if (!t) return null;
    if (maxBytes && new Blob([t]).size > maxBytes) return null;
    try { return { raw: t, data: JSON.parse(t) }; } catch { return null; }
  }

  /**
   * Return the first parseable JSON among several candidate strings.
   * @param {string[]} texts - Candidate texts, tried in order.
   * @param {number} maxBytes - Maximum allowed byte size per candidate.
   * @returns {ParseResult|null} The first successful parse, or null.
   */
  function firstJson(texts, maxBytes) {
    for (const text of texts) {
      const ok = tryParse(text, maxBytes);
      if (ok) return ok;
    }
    return null;
  }

  /**
   * Obtain the page's JSON, preferring text already in the DOM and falling back
   * to re-fetching the URL from cache.
   * @param {number} maxBytes - Maximum payload size to parse.
   * @returns {Promise<ParseResult|null>} The parsed JSON, or null if unavailable.
   */
  async function getRawJson(maxBytes) {
    const fromDom = [];
    if (document.body) {
      const first = document.body.firstElementChild;
      if (first?.tagName === 'PRE') fromDom.push(first.textContent);
      const anyPre = document.body.querySelector('pre');
      if (anyPre) fromDom.push(anyPre.textContent);
      fromDom.push(document.body.textContent);
    }
    const parsed = firstJson(fromDom, maxBytes);
    if (parsed) return parsed;
    try {
      const res = await fetch(location.href, { cache: 'force-cache', credentials: 'same-origin' });
      return tryParse(await res.text(), maxBytes);
    } catch {
      return null;
    }
  }

  /**
   * Resolve once document.body exists (immediately, or on DOMContentLoaded).
   * @returns {Promise<void>}
   */
  const whenBodyReady = () =>
    new Promise((resolve) => {
      if (document.body) return resolve();
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });

  (async () => {
    const prefs = await loadPrefs();
    const maxBytes = Math.max(1, Number(prefs.maxSizeMb) || DEFAULTS.maxSizeMb) * 1024 * 1024;
    const parsed = await getRawJson(maxBytes);
    if (!parsed) {
      delete document.documentElement.dataset.jvActive;
      return;
    }
    const { raw: trimmed, data } = parsed;
    await whenBodyReady();
    document.body.textContent = '';
    document.body.classList.add('jv-body');
    document.documentElement.dataset.jvTheme = prefs.theme;
    const size = Math.max(10, Math.min(24, Number(prefs.fontSize) || DEFAULTS.fontSize));
    document.body.style.setProperty('--jv-font-size', size + 'px');
    document.body.dataset.jvWrap = prefs.wrapText ? 'on' : 'off';
    await render(document.body, data, trimmed, prefs);
  })();

  /**
   * Create an element with an optional class and text content.
   * @param {string} tag - Tag name.
   * @param {string} [className] - Class attribute to set.
   * @param {string} [text] - textContent to set.
   * @returns {HTMLElement} The created element.
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Build a toolbar button with a glyph, an accessible label, and a click handler.
   * @param {string} label - Accessible label and tooltip text.
   * @param {string} glyph - Symbol shown in the button.
   * @param {(ev: MouseEvent) => void} onClick - Click handler.
   * @returns {HTMLButtonElement} The configured button.
   */
  function iconButton(label, glyph, onClick) {
    const btn = el('button', 'jv-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.appendChild(el('span', 'jv-btn__glyph', glyph));
    btn.appendChild(el('span', 'jv-btn__label', label));
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Build the full viewer UI (header, tabs, toolbar, tree, raw pane), wire up its
   * interactions, and append it to `root`.
   * @param {HTMLElement} root - Container to render into (document.body).
   * @param {*} value - The parsed JSON value.
   * @param {string} raw - The original JSON text (for raw view and copy).
   * @param {Prefs} prefs - Display preferences.
   * @returns {Promise<void>}
   */
  async function render(root, value, raw, prefs) {
    const shell = el('div', 'jv-shell');

    const header = el('header', 'jv-header');
    const title = el('div', 'jv-title');
    const logo = el('img', 'jv-logo');
    logo.src = chrome.runtime.getURL('icons/icon128.png');
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    title.appendChild(logo);
    title.appendChild(el('span', 'jv-title__text', 'JSON Viewer'));
    header.appendChild(title);

    const tabs = el('div', 'jv-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabFormatted = el('button', 'jv-tab', i18n('viewerTabFormatted'));
    const tabRaw = el('button', 'jv-tab', i18n('viewerTabRaw'));
    tabFormatted.type = 'button';
    tabRaw.type = 'button';
    tabFormatted.id = 'jv-tab-formatted';
    tabRaw.id = 'jv-tab-raw';
    tabFormatted.setAttribute('role', 'tab');
    tabRaw.setAttribute('role', 'tab');
    tabFormatted.setAttribute('aria-controls', 'jv-panel-formatted');
    tabRaw.setAttribute('aria-controls', 'jv-panel-raw');
    tabs.appendChild(tabFormatted);
    tabs.appendChild(tabRaw);
    header.appendChild(tabs);

    const actions = el('div', 'jv-actions');
    const search = el('input', 'jv-search');
    search.type = 'search';
    search.placeholder = i18n('viewerSearchPlaceholder');
    search.setAttribute('aria-label', i18n('viewerSearchLabel'));
    actions.appendChild(search);
    header.appendChild(actions);
    shell.appendChild(header);

    const toolbar = el('div', 'jv-toolbar');
    toolbar.appendChild(iconButton(i18n('viewerExpandAll'), '+', () => setExpanded(tree, true)));
    toolbar.appendChild(iconButton(i18n('viewerCollapseAll'), '−', () => setExpanded(tree, false)));
    toolbar.appendChild(iconButton(i18n('viewerCopyJson'), '⧉', copyRaw));
    const status = el('span', 'jv-status');
    status.setAttribute('role', 'status');
    toolbar.appendChild(status);
    shell.appendChild(toolbar);

    const main = el('main', 'jv-main');

    const formattedPanel = el('div', 'jv-panel');
    formattedPanel.id = 'jv-panel-formatted';
    formattedPanel.setAttribute('role', 'tabpanel');
    formattedPanel.setAttribute('aria-labelledby', 'jv-tab-formatted');
    const tree = el('div', 'jv-tree');
    tree.setAttribute('role', 'tree');
    formattedPanel.appendChild(tree);

    const rawPanel = el('div', 'jv-panel');
    rawPanel.id = 'jv-panel-raw';
    rawPanel.setAttribute('role', 'tabpanel');
    rawPanel.setAttribute('aria-labelledby', 'jv-tab-raw');
    rawPanel.tabIndex = 0;
    const rawPane = el('pre', 'jv-raw');
    rawPane.textContent = reindentRaw(value, raw, prefs.rawIndent);
    rawPanel.appendChild(rawPane);

    main.appendChild(formattedPanel);
    main.appendChild(rawPanel);
    shell.appendChild(main);

    root.appendChild(shell);

    const syncHeaderHeight = () => {
      shell.style.setProperty('--jv-header-h', `${header.offsetHeight}px`);
    };
    syncHeaderHeight();
    new ResizeObserver(syncHeaderHeight).observe(header);

    const opts = { expandDepth: prefs.expandDepth, sortKeys: !!prefs.sortKeys };

    let view = prefs.defaultView === 'raw' ? 'raw' : 'formatted';
    const applyView = () => {
      shell.dataset.view = view;
      tabFormatted.classList.toggle('is-active', view === 'formatted');
      tabRaw.classList.toggle('is-active', view === 'raw');
      tabFormatted.setAttribute('aria-selected', view === 'formatted');
      tabRaw.setAttribute('aria-selected', view === 'raw');
      tabFormatted.tabIndex = view === 'formatted' ? 0 : -1;
      tabRaw.tabIndex = view === 'raw' ? 0 : -1;
    };
    tabFormatted.addEventListener('click', () => { view = 'formatted'; applyView(); });
    tabRaw.addEventListener('click', () => { view = 'raw'; applyView(); });
    applyView();

    let searchTimer;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyFilter(tree, search.value, status), 120);
    });

    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && !ev.altKey && ev.code === 'KeyF') {
        if (view === 'raw') return;
        ev.preventDefault();
        search.focus();
        search.select();
      }
    });

    const tabButtons = [tabFormatted, tabRaw];
    tabs.addEventListener('keydown', (ev) => {
      const i = tabButtons.indexOf(document.activeElement);
      if (i < 0) return;
      const last = tabButtons.length - 1;
      let next;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % tabButtons.length;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i + last) % tabButtons.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = last;
      else return;
      ev.preventDefault();
      tabButtons[next].focus();
    });

    tree.addEventListener('click', (ev) => {
      const row = ev.target.closest('.jv-row--parent');
      if (!row) return;
      const node = row.closest('.jv-node');
      if (node) setNodeExpanded(node, !node.classList.contains('is-open'));
    });

    const rootNode = await buildTree(value, opts);
    tree.appendChild(rootNode);
    setupTreeKeyboard(tree);

    async function copyRaw() {
      try {
        await navigator.clipboard.writeText(raw);
        flash(status, i18n('viewerCopied'));
      } catch {
        flash(status, i18n('viewerCopyFailed'));
      }
    }
  }

  /**
   * Yield to the event loop so large trees build without freezing the tab.
   * @returns {Promise<void>}
   */
  const yieldToMain = () =>
    typeof scheduler !== 'undefined' && scheduler.yield
      ? scheduler.yield()
      : new Promise((resolve) => setTimeout(resolve));

  /**
   * Create a tree node for a value. Leaves are fully built; objects/arrays return
   * pending work so their children can be built incrementally.
   * @param {*} value - The value at this node.
   * @param {string|number|null} key - The key/index, or null for the root.
   * @param {number} depth - Depth from the root (controls auto-expansion).
   * @param {{expandDepth: number, sortKeys: boolean}} opts - Build options.
   * @returns {{node: HTMLElement, pending: ?{entries: Array<[string|number, *]>, container: HTMLElement, depth: number}}} The node and any deferred child-build work.
   */
  function makeNode(value, key, depth, opts) {
    const type = typeOf(value);
    const node = el('div', 'jv-node jv-node--' + type);
    node.setAttribute('role', 'treeitem');
    node.dataset.type = type;

    if (type !== 'object' && type !== 'array') {
      const row = el('div', 'jv-row jv-row--leaf');
      if (key !== null) {
        row.appendChild(renderKey(key));
        row.appendChild(el('span', 'jv-colon', ': '));
      }
      row.appendChild(renderPrimitive(value, type));
      node.appendChild(row);
      return { node, pending: null };
    }

    const entries = entriesOf(value, type, opts.sortKeys);
    const openChar = type === 'array' ? '[' : '{';
    const closeChar = type === 'array' ? ']' : '}';

    const header = el('div', 'jv-row jv-row--parent');
    const toggle = el('button', 'jv-toggle');
    toggle.type = 'button';
    toggle.tabIndex = -1;
    toggle.setAttribute('aria-label', i18n('viewerToggleLabel'));
    header.appendChild(toggle);

    if (key !== null) {
      header.appendChild(renderKey(key));
      header.appendChild(el('span', 'jv-colon', ': '));
    }

    header.appendChild(el('span', 'jv-bracket', openChar));
    const count = String(entries.length);
    header.appendChild(el('span', 'jv-summary', i18n(entries.length === 1 ? 'viewerItemsOne' : 'viewerItemsMany', [count])));
    header.appendChild(el('span', 'jv-bracket jv-bracket--close', closeChar));

    const children = el('div', 'jv-children');
    children.setAttribute('role', 'group');

    const footer = el('div', 'jv-row jv-row--close');
    footer.appendChild(el('span', 'jv-bracket', closeChar));

    node.appendChild(header);
    node.appendChild(children);
    node.appendChild(footer);
    setNodeExpanded(node, depth < opts.expandDepth);

    return { node, pending: entries.length ? { entries, container: children, depth: depth + 1 } : null };
  }

  /**
   * Build the DOM tree for a JSON value, yielding periodically to stay responsive.
   * @param {*} value - The root JSON value.
   * @param {{expandDepth: number, sortKeys: boolean}} opts - Build options.
   * @returns {Promise<HTMLElement>} The root tree node element.
   */
  async function buildTree(value, opts) {
    const root = makeNode(value, null, 0, opts);
    const stack = root.pending ? [root.pending] : [];
    let deadline = performance.now() + 50;
    while (stack.length) {
      const { entries, container, depth } = stack.pop();
      const last = entries.length - 1;
      for (let idx = 0; idx <= last; idx++) {
        const [k, v] = entries[idx];
        const child = makeNode(v, k, depth, opts);
        if (idx < last) child.node.dataset.trailing = ',';
        container.appendChild(child.node);
        if (child.pending) stack.push(child.pending);
        if (performance.now() >= deadline) {
          await yieldToMain();
          deadline = performance.now() + 50;
        }
      }
    }
    return root.node;
  }

  /**
   * Render an object key or array index as a styled span.
   * @param {string|number} key - The key (string) or index (number).
   * @returns {HTMLSpanElement} The key element.
   */
  function renderKey(key) {
    const span = el('span', typeof key === 'number' ? 'jv-index' : 'jv-key');
    span.textContent = typeof key === 'number' ? String(key) : JSON.stringify(key);
    return span;
  }

  /**
   * Render a primitive value, linkifying http(s) URL strings.
   * @param {*} value - The primitive value.
   * @param {string} type - Its type tag ('string'|'number'|'boolean'|'null').
   * @returns {HTMLSpanElement} The value element.
   */
  function renderPrimitive(value, type) {
    const span = el('span', 'jv-value jv-value--' + type);
    if (type === 'string') {
      const text = JSON.stringify(value);
      if (/^"https?:\/\/[^\s"]+"$/.test(text)) {
        const link = el('a', 'jv-link');
        link.href = value;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        span.appendChild(link);
      } else {
        span.textContent = text;
      }
    } else if (type === 'null') {
      span.textContent = 'null';
    } else {
      span.textContent = String(value);
    }
    return span;
  }

  /**
   * Classify a JSON value into a viewer type tag.
   * @param {*} v - The value.
   * @returns {'null'|'array'|'object'|'string'|'number'|'boolean'} The type tag.
   */
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  /**
   * Return the [key, value] entries of a container, optionally sorted by key.
   * @param {object|Array} value - The object or array.
   * @param {string} type - 'array' or 'object'.
   * @param {boolean} sortKeys - Sort object keys alphabetically when true.
   * @returns {Array<[string|number, *]>} The entries.
   */
  function entriesOf(value, type, sortKeys) {
    if (type === 'array') return value.map((v, i) => [i, v]);
    const entries = Object.entries(value);
    if (sortKeys) entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return entries;
  }

  /**
   * Reformat raw JSON to the requested indentation, or keep the original bytes.
   * @param {*} value - The parsed value (used when re-serializing).
   * @param {string} raw - The original JSON text.
   * @param {'original'|'tab'|string} indent - Indent mode, or a space count.
   * @returns {string} The (re)indented JSON text.
   */
  function reindentRaw(value, raw, indent) {
    if (indent === 'original') return raw;
    const space = indent === 'tab' ? '\t' : Number(indent) || 2;
    try { return JSON.stringify(value, null, space); } catch { return raw; }
  }

  /**
   * Open or close a single tree node and update its toggle's aria-expanded.
   * @param {HTMLElement} node - The .jv-node element.
   * @param {boolean} open - Whether to expand it.
   * @returns {void}
   */
  function setNodeExpanded(node, open) {
    node.classList.toggle('is-open', open);
    const toggle = node.querySelector(':scope > .jv-row > .jv-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  /**
   * Expand or collapse every object/array node in the tree, yielding periodically
   * so a large tree does not freeze the tab.
   * @param {HTMLElement} tree - The tree container.
   * @param {boolean} open - Expand all (true) or collapse all (false).
   * @returns {Promise<void>}
   */
  async function setExpanded(tree, open) {
    const nodes = tree.querySelectorAll('.jv-node--object, .jv-node--array');
    let deadline = performance.now() + 50;
    for (const n of nodes) {
      setNodeExpanded(n, open);
      if (performance.now() >= deadline) {
        await yieldToMain();
        deadline = performance.now() + 50;
      }
    }
  }

  /**
   * Wire up roving-tabindex keyboard navigation (arrows, Home/End, Enter/Space)
   * for the tree.
   * @param {HTMLElement} tree - The tree container.
   * @returns {void}
   */
  function setupTreeKeyboard(tree) {
    const isParent = (n) =>
      n.classList.contains('jv-node--object') || n.classList.contains('jv-node--array');
    const isOpen = (n) => n.classList.contains('is-open');
    const isHidden = (n) => n.classList.contains('is-hidden');

    // Navigation works by local DOM traversal (O(depth) per keystroke) instead of
    // rebuilding a flat list of every visible node. It never reads layout
    // (`offsetParent`), so a single keypress stays cheap even on huge trees.
    const childGroup = (node) => {
      for (const c of node.children) {
        if (c.classList.contains('jv-children')) return c;
      }
      return null;
    };
    const firstVisibleChild = (node) => {
      if (!isParent(node) || !isOpen(node)) return null;
      const group = childGroup(node);
      for (const c of group?.children || []) {
        if (c.classList.contains('jv-node') && !isHidden(c)) return c;
      }
      return null;
    };
    const lastVisibleChild = (node) => {
      if (!isParent(node) || !isOpen(node)) return null;
      const group = childGroup(node);
      const kids = group ? group.children : [];
      for (let i = kids.length - 1; i >= 0; i--) {
        if (kids[i].classList.contains('jv-node') && !isHidden(kids[i])) return kids[i];
      }
      return null;
    };
    const nextSibling = (node) => {
      for (let s = node.nextElementSibling; s; s = s.nextElementSibling) {
        if (s.classList.contains('jv-node') && !isHidden(s)) return s;
      }
      return null;
    };
    const prevSibling = (node) => {
      for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.classList.contains('jv-node') && !isHidden(s)) return s;
      }
      return null;
    };
    const parentNode = (node) => node.parentElement?.closest('.jv-node') || null;

    const nextVisible = (node) => {
      const down = firstVisibleChild(node);
      if (down) return down;
      for (let cur = node; cur; cur = parentNode(cur)) {
        const sib = nextSibling(cur);
        if (sib) return sib;
      }
      return null;
    };
    const prevVisible = (node) => {
      const sib = prevSibling(node);
      if (sib) {
        let cur = sib;
        for (let last = lastVisibleChild(cur); last; last = lastVisibleChild(cur)) cur = last;
        return cur;
      }
      return parentNode(node);
    };
    const lastVisible = () => {
      let cur = tree.querySelector('.jv-node');
      if (!cur) return null;
      for (let last = lastVisibleChild(cur); last; last = lastVisibleChild(cur)) cur = last;
      return cur;
    };

    let current = tree.querySelector('.jv-node');
    if (current) current.tabIndex = 0;

    const focusItem = (node) => {
      if (!node) return;
      if (current && current !== node) current.tabIndex = -1;
      current = node;
      node.tabIndex = 0;
      node.focus();
    };

    tree.addEventListener('focusin', (ev) => {
      const node = ev.target.closest('.jv-node');
      if (node && node !== current) {
        if (current) current.tabIndex = -1;
        current = node;
        node.tabIndex = 0;
      }
    });

    tree.addEventListener('keydown', (ev) => {
      const active = current && !isHidden(current) ? current : tree.querySelector('.jv-node');
      if (!active) return;
      const toggle = () => setNodeExpanded(active, !isOpen(active));
      const moveTo = (node) => focusItem(node || active);
      const actions = {
        ArrowDown: () => moveTo(nextVisible(active)),
        ArrowUp: () => moveTo(prevVisible(active)),
        ArrowRight: () =>
          isParent(active) && !isOpen(active) ? setNodeExpanded(active, true) : moveTo(nextVisible(active)),
        ArrowLeft: () =>
          isParent(active) && isOpen(active) ? setNodeExpanded(active, false) : moveTo(parentNode(active)),
        Home: () => moveTo(tree.querySelector('.jv-node')),
        End: () => moveTo(lastVisible()),
        Enter: () => isParent(active) && toggle(),
        ' ': () => isParent(active) && toggle(),
      };
      const action = actions[ev.key];
      if (!action) return;
      ev.preventDefault();
      action();
    });
  }

  /**
   * Yield to the main thread, then report whether a newer run has superseded
   * this one so the caller can bail out.
   * @param {() => boolean} stale - Returns true when this run is outdated.
   * @returns {Promise<boolean>} True if the caller should stop.
   */
  const breath = async (stale) => {
    await yieldToMain();
    return stale();
  };

  /**
   * First filter pass: tag each node with whether its own row matches the query,
   * yielding periodically so a large tree does not freeze the tab.
   * @param {NodeListOf<HTMLElement>} nodes - All tree nodes.
   * @param {string} q - The lowercased query.
   * @param {() => boolean} stale - Returns true when this run is outdated.
   * @returns {Promise<?{map: WeakMap<HTMLElement, boolean>, count: number}>} The
   *   per-node match map and total match count, or null if superseded.
   */
  async function markMatches(nodes, q, stale) {
    const map = new WeakMap();
    let count = 0;
    let deadline = performance.now() + 50;
    for (const n of nodes) {
      const row = n.querySelector(':scope > .jv-row');
      const hit = !!row && row.textContent.toLowerCase().includes(q);
      map.set(n, hit);
      n.classList.toggle('is-match', hit);
      if (hit) count += 1;
      if (performance.now() >= deadline) {
        if (await breath(stale)) return null;
        deadline = performance.now() + 50;
      }
    }
    return { map, count };
  }

  /**
   * Record that a node's parent has a matching descendant.
   * @param {HTMLElement} node - The in-subtree node.
   * @param {WeakMap<HTMLElement, boolean>} childMatch - Parent → has-match map.
   * @returns {void}
   */
  const linkParent = (node, childMatch) => {
    const parent = node.parentElement?.closest('.jv-node');
    if (parent) childMatch.set(parent, true);
  };

  /**
   * Second filter pass (leaves → root): hide nodes outside any matching subtree
   * and expand ancestors of matches, yielding periodically.
   * @param {NodeListOf<HTMLElement>} nodes - All tree nodes, in document order.
   * @param {WeakMap<HTMLElement, boolean>} selfMatch - Per-node self-match map.
   * @param {() => boolean} stale - Returns true when this run is outdated.
   * @returns {Promise<boolean>} True if a newer run superseded this one.
   */
  async function hideUnmatched(nodes, selfMatch, stale) {
    const childMatch = new WeakMap();
    let deadline = performance.now() + 50;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const hasDescendantMatch = childMatch.get(n) === true;
      const inSubtree = selfMatch.get(n) || hasDescendantMatch;
      n.classList.toggle('is-hidden', !inSubtree);
      if (hasDescendantMatch) setNodeExpanded(n, true);
      if (inSubtree) linkParent(n, childMatch);
      if (performance.now() >= deadline) {
        if (await breath(stale)) return true;
        deadline = performance.now() + 50;
      }
    }
    return false;
  }

  /**
   * Filter the tree to nodes matching a query, expanding ancestors of matches and
   * updating the result count.
   * @param {HTMLElement} tree - The tree container.
   * @param {string} rawQuery - The user's search text.
   * @param {HTMLElement} status - Element receiving the result-count message.
   * @returns {Promise<void>}
   */
  let filterGen = 0;
  async function applyFilter(tree, rawQuery, status) {
    const gen = ++filterGen;
    const q = rawQuery.trim().toLowerCase();
    const nodes = tree.querySelectorAll('.jv-node');
    if (!q) {
      nodes.forEach((n) => n.classList.remove('is-hidden', 'is-match'));
      status.textContent = '';
      return;
    }

    const stale = () => gen !== filterGen;
    const marked = await markMatches(nodes, q, stale);
    if (!marked) return;
    if (await hideUnmatched(nodes, marked.map, stale)) return;
    status.textContent = i18n(marked.count === 1 ? 'viewerResultsOne' : 'viewerResultsMany', [String(marked.count)]);
  }

  /**
   * Show a transient message in an element, clearing it after 1.8 s.
   * @param {HTMLElement} target - Element to write the message into.
   * @param {string} message - Text to display.
   * @returns {void}
   */
  function flash(target, message) {
    target.textContent = message;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      target.textContent = '';
    }, 1800);
  }
})();
