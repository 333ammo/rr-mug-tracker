// ==UserScript==
// @name         RR Mug Tracker
// @namespace    fatboy.torn
// @version      0.1.5
// @description  Russian Roulette lobby tracker for Torn PDA (iOS): observe active games, log events, show elapsed time.
// @author       FATBOY [572123]
// @match        https://www.torn.com/page.php*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/*
 * RR Mug Tracker v0.1.5 — fix player name extraction.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.1.5 changes:
 *   - parseRRLobby() name extraction: profile link direct text nodes are now
 *     the PRIMARY source (via getPlayerName). honorWrap.textContent is the
 *     fallback only when the link has no readable text.
 *     Root cause: another userscript injects battle-stat estimates ("2.4b",
 *     "26k") into the honorWrap element, polluting its textContent.  The
 *     profile link itself is always clean.
 *   - Comment in parseRRLobby updated to reflect confirmed name order.
 *   - Suite I added: 4 regression tests for the battle-stat injection pattern.
 *
 * v0.1.4 — implement confirmed live Torn PDA lobby structure.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.1.4 changes:
 *   - parseRRLobby() rewritten from profile-link ancestor search to proper
 *     row-based parsing using the confirmed Torn RR DOM (v0.1.3 diagnostics):
 *       • findGamesSection() returns the [class*="joinWrap"] container.
 *       • findRowsWrap() locates [class*="rowsWrap"] within that container.
 *       • Each direct child of rowsWrap is a game row.
 *       • Game ID: numeric row.id attribute (primary); button[data-id] (secondary);
 *         link href ?game=N (tertiary fallback for older DOM patterns).
 *       • Player ID: XID from the profile link inside the row.
 *       • Player name: [class*="honorWrap"] inside the row, or link text nodes.
 *       • Bet: parseBet(row.textContent) scoped to each row — no cross-row leakage.
 *   - findGamesSection() CSS fallback gains [class*="joinWrap"] (confirmed).
 *   - findRowsWrap() extracted as a testable helper.
 *   - Suite H added: 6 regression tests for confirmed joinWrap/rowsWrap/row
 *     structure with numeric IDs, profile links, honorWrap and bet isolation.
 *   - F1 fixture updated to confirmed div-row structure (old table-based guess
 *     replaced with the actual Torn DOM layout).
 *
 * CONFIRMED DOM (v0.1.3 live diagnostics, page.php?sid=russianRoulette):
 *   DIV[class*="joinWrap"]
 *     DIV.title-black  "List of available games"
 *     DIV.cont-gray
 *       DIV[class*="columnsWrap"]  (column headers)
 *       DIV[class*="rowsWrap"]
 *         DIV[class*="row"] id="<numeric game ID>"
 *         ...
 *   • Class suffixes are build-generated and may change between Torn deploys.
 *   • Profile links inside rows: a[href="/profiles.php?XID=<id>"].
 *   • Join buttons: button[data-id="<gameId>"].
 *
 * UNCONFIRMED (require next live test):
 *   • Player name source: assumed [class*="honorWrap"] inside the row.
 *   • Exact bet amount element/format inside each row.
 *   • Player count display format.
 *
 * v0.1.3 changes:
 *   - findGamesSection() rewritten.  "[class*="available"]" is removed from
 *     all CSS fallback selectors — it matched SPAN.bustr-stats__availableBusts
 *     (a different userscript's element) instead of the RR game list.
 *   - Heading search now covers any element type (not just h1-h6), since Torn
 *     may use div/span/th for the "List of available games" label.
 *   - _isSectionCandidate() helper: rejects any element with 0 children so a
 *     leaf/chrome element can never be accepted as the game list container.
 *   - CSS fallback list is now RR-specific: createWrap, gameWrap, etc.
 *   - captureDomDiag() gains three new sections: headingPath (ancestry of the
 *     "List of available games" heading), profileLinks (sample of 8 body-level
 *     profile links with parent/sibling context), rowDataAttrs (data-* attrs on
 *     section children — candidate game-ID carriers).
 *
 * v0.1.2 changes (diagnostic only — parser unchanged):
 *   - captureDomDiag() completely rewritten. No longer relies on profile
 *     links (which were 0 in live test). Instead captures:
 *       • page pathname + sid parameter
 *       • all headings on the page
 *       • candidate RR containers found by CSS-module-aware selectors
 *       • findGamesSection() result with parent, sibling, ANY link sample
 *       • direct children of the found section (up to 12 "rows")
 *       • bounded depth-3 element tree of the section
 *       • body-level counts for profile links AND ?game= links
 *   - Diagnostic output now shown in a visible, selectable textarea inside
 *     the panel so it can be manually copied if navigator.clipboard fails
 *     (triple-tap → select all → copy on iOS).
 *   - Copy button shows "Copied!" / "See text ↓" feedback.
 *   - safeClass() and sanitizeHref() extracted as testable helpers.
 *
 * v0.1.1 fixes (live Torn PDA test):
 *   - findRowContainer: now returns parent row div (was returning player cell).
 *   - Player name: direct text nodes only (excludes nested <span>).
 *   - UI-chrome "View Profile" links filtered by UI_LABEL.
 *   - Own panel host excluded from DOM scans.
 *   - findGamesSection() added.
 *
 * DOM ASSUMPTIONS — require live Torn PDA re-verification:
 *   1. Player profile links: href="/profiles.php?XID=[id]"  (0 found in last test)
 *   2. Bet amounts appear as "$[digits,]+" in row text.
 *   3. Game IDs in link hrefs (?game=N) or data-game-id.
 *   These assumptions may be wrong — the v0.1.2 diagnostic output will
 *   reveal the actual DOM structure for the next parser rewrite.
 */
(function () {
  'use strict';

  const VERSION = '0.1.5';
  if (window.top !== window.self) return;

  /* isRRPage accepts optional (pn, qs) args for test-harness use */
  const isRRPage = function (pn, qs) {
    const p = pn !== undefined ? pn : location.pathname;
    const s = qs !== undefined ? qs : location.search;
    return /\/page\.php/.test(p) && /[?&]sid=russianRoulette(?:&|$)/.test(s);
  };

  /* URL guard — bypassed when __RRMT_EXPOSE__ is set by the test harness */
  if (!isRRPage() && window.__RRMT_EXPOSE__ !== true) return;

  const PRIOR = window.__RRMT__;
  if (PRIOR && PRIOR.version === VERSION && typeof PRIOR.isAlive === 'function' && PRIOR.isAlive()) return;
  if (PRIOR && typeof PRIOR.destroy === 'function') { try { PRIOR.destroy(); } catch (e) { /* gone */ } }

  /* ============================ 1. CONSTANTS ============================ */
  const NS               = 'rrmt1';
  const THROTTLE_MS      = 800;
  const RENDER_TICK_MS   = 30000;
  const LOG_MAX          = 200;
  const DEFAULT_MIN_BET  = 200000000;
  const GAME_TIMEOUT_EST = 15 * 60 * 1000;

  /* Profile-link texts that are UI chrome, not player names */
  const UI_LABEL = /^(view\s+profile\.?|premium\s+data|follow|unfollow|report|trade|send\s+message|send\s+gift|bounty|add\s+to\s+friend)$/i;

  /* ============================ 2. STATE ============================ */
  const State = {
    games:     new Map(),  // key → GameEntry
    log:       [],
    tracking:  false,
    parseOk:   null,       // null=not tried, true=ok, false=failed
    parseNote: '',
    minBet:    DEFAULT_MIN_BET,
    diagOutput: null,      // set when user presses Copy DOM diagnostics
    diagMsg:    null,      // transient copy feedback message
  };

  /* ============================ 3. PARSING ============================ */
  function parseBet(text) {
    if (!text) return null;
    const m = /\$\s*([\d,]+)/.exec(String(text));
    if (!m) return null;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  function parseMinBet(text) {
    if (!text) return null;
    const c = String(text).trim().replace(/[$,\s]/g, '');
    const mB = /^([\d.]+)[Bb]$/.exec(c); if (mB) return Math.round(parseFloat(mB[1]) * 1e9);
    const mM = /^([\d.]+)[Mm]$/.exec(c); if (mM) return Math.round(parseFloat(mM[1]) * 1e6);
    const mK = /^([\d.]+)[Kk]$/.exec(c); if (mK) return Math.round(parseFloat(mK[1]) * 1e3);
    const n = parseInt(c, 10);
    return isNaN(n) ? null : n;
  }

  function gameKey(gameId, playerId) {
    return gameId ? ('g' + gameId) : ('p' + playerId);
  }

  /* safeClass — safely read className as string (handles SVGAnimatedString) */
  function safeClass(el) {
    const c = el.className;
    return (typeof c === 'string') ? c : ((c && c.baseVal) ? c.baseVal : '');
  }

  /* sanitizeHref — mask player/game IDs and remove credential params */
  function sanitizeHref(raw) {
    return (raw || '')
      .replace(/XID=\d+/g, 'XID=X')
      .replace(/\bgame=\d+/g, 'game=N')
      .replace(/[?&](?:key|token|auth|api[-_]?key)=[^&#]*/gi, '')
      .slice(0, 80);
  }

  function getPlayerName(link) {
    let name = '';
    for (let i = 0; i < link.childNodes.length; i++) {
      if (link.childNodes[i].nodeType === 3) name += link.childNodes[i].nodeValue;
    }
    name = name.trim();
    if (!name) {
      name = link.textContent
        .replace(/\bPremium\s*data\b/gi, '')
        .replace(/\bView\s*Profile\b/gi, '')
        .trim();
    }
    return name;
  }

  function extractGameIdFromEl(el) {
    const links = el.querySelectorAll ? Array.from(el.querySelectorAll('a[href]')) : [];
    if (el.tagName === 'A' && el.href) links.unshift(el);
    for (const a of links) {
      const m = /[?&#]game=(\d+)/i.exec(a.href || '');
      if (m) return m[1];
    }
    const d = (el.closest && el.closest('[data-game-id]')) ||
              (el.querySelector && el.querySelector('[data-game-id]'));
    return d ? (d.dataset && d.dataset.gameId) || null : null;
  }

  function findRowContainer(el) {
    const STOP = { LI: 1, TR: 1, ARTICLE: 1, SECTION: 1 };
    let cur = el.parentElement;
    for (let depth = 0; cur && depth < 10; depth++, cur = cur.parentElement) {
      if (STOP[cur.tagName]) return cur;
      if (cur.tagName === 'DIV' && cur.parentElement) {
        const par = cur.parentElement;
        const peers = Array.from(par.children).filter(c => c !== cur && c.tagName === 'DIV');
        if (peers.length >= 1) return par;
      }
    }
    return el.parentElement;
  }

  /*
   * _isSectionCandidate — a container is trustworthy only if it has child
   * elements.  This rejects leaf nodes, body/html, and 0-children elements
   * such as SPAN.bustr-stats__availableBusts (a different userscript's stat
   * badge that matches "[class*="available"]" but contains no game rows).
   */
  function _isSectionCandidate(el) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) return false;
    return el.children.length > 0;
  }

  function findGamesSection() {
    try {
      /*
       * 1. Search for the "List of available games" heading in any element
       *    type — Torn may use div/span/th, not only h1-h6.
       *    Only consider elements whose full textContent is short (≤ 120 chars)
       *    so we don't accidentally match large page containers.
       */
      const headEls = document.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,strong,b,span,div,p,label,th,td'
      );
      for (let i = 0; i < headEls.length; i++) {
        const el = headEls[i];
        const tx = el.textContent.replace(/\s+/g, ' ').trim();
        if (tx.length > 120 || !/list of available games/i.test(tx)) continue;
        /* Walk up: first ancestor with >1 child (heading + at least one row) */
        let cur = el.parentElement;
        for (let d = 0; cur && d < 8; d++, cur = cur.parentElement) {
          if (cur === document.body || cur === document.documentElement) break;
          if (cur.children.length > 1 && _isSectionCandidate(cur)) return cur;
        }
        /* The next sibling of the heading element might be the list */
        const sib = el.nextElementSibling;
        if (sib && _isSectionCandidate(sib)) return sib;
        /* Direct parent as last resort */
        if (el.parentElement && _isSectionCandidate(el.parentElement)) {
          return el.parentElement;
        }
      }
    } catch (e) { /* ignore */ }

    /*
     * 2. RR-specific CSS-module class fragments.
     *    "[class*="available"]" is deliberately absent — it is too broad and
     *    matched SPAN.bustr-stats__availableBusts in live testing.
     *    All candidates here must also pass _isSectionCandidate().
     */
    const rrSels = [
      '[class*="joinWrap"]',      /* confirmed v0.1.3 live: joinWrap___iOAr4 */
      '[class*="createWrap"]',
      '[class*="gameWrap"]',
      '[class*="rouletteLobby"]',
      '[class*="rouletteList"]',
      '[class*="russianRoulette"]',
      '[class*="game-list"]', '[class*="gameList"]',
      '[id*="available"]',    '[id*="game-list"]',
    ];
    for (let j = 0; j < rrSels.length; j++) {
      try {
        const el = document.querySelector(rrSels[j]);
        if (el && _isSectionCandidate(el)) return el;
      } catch (e) { /* skip */ }
    }

    return null;
  }

  /*
   * findRowsWrap — locate the direct row container within the section.
   *
   * Confirmed Torn structure: [class*="rowsWrap"] is a direct descendant of
   * [class*="joinWrap"].  Fallbacks handle test fixtures and unknown DOM changes.
   */
  function findRowsWrap(section) {
    if (!section) return null;
    try {
      const rw = section.querySelector('[class*="rowsWrap"]');
      if (rw) return rw;
    } catch (e) { /* skip */ }
    /* UL/OL: children are natural row elements (test fixture compatibility) */
    if (section.tagName === 'UL' || section.tagName === 'OL') return section;
    /* Generic: treat the section itself as the rows container */
    return section;
  }

  /*
   * parseRRLobby — row-based parser using confirmed Torn DOM structure.
   *
   * Flow: section → rowsWrap → direct children (game rows).
   * Game ID : row.id (numeric)  →  button[data-id]  →  link-href ?game=N.
   * Player  : a[href*="/profiles.php?XID="] inside the row.
   * Name    : direct text nodes of profile link (getPlayerName) → honorWrap fallback.
   * Bet     : parseBet(row.textContent) — scoped per row, no cross-row leakage.
   */
  function parseRRLobby(root) {
    const section = root || findGamesSection();
    if (!section) {
      return { ok: false, reason: 'RR game list section not found', games: [] };
    }

    const ownHost  = document.getElementById(NS + '-host');
    const rowsWrap = findRowsWrap(section);
    const rows     = rowsWrap ? Array.from(rowsWrap.children) : [];

    if (!rows.length) {
      return { ok: false, reason: 'No game rows found — lobby may not be loaded yet', games: [] };
    }

    const games = [], seen = new Set();
    for (const row of rows) {
      if (ownHost && ownHost.contains(row)) continue;

      /* Game ID: numeric row.id  →  button[data-id]  →  link-href fallback */
      let gId = null;
      if (row.id && /^\d+$/.test(row.id)) {
        gId = row.id;
      }
      if (!gId) {
        try {
          const btn = row.querySelector('button[data-id]');
          if (btn) gId = btn.getAttribute('data-id') || null;
        } catch (e) { /* skip */ }
      }
      if (!gId) gId = extractGameIdFromEl(row);

      /* Player: profile link for pid; honorWrap or link text nodes for name */
      let link = null;
      try { link = row.querySelector('a[href*="/profiles.php?XID="]'); } catch (e) { /* skip */ }
      if (!link) continue;

      const pidMatch = /XID=(\d+)/.exec(link.getAttribute('href') || link.href || '');
      if (!pidMatch) continue;
      const pid = pidMatch[1];

      /* Name: profile link direct text nodes first (always clean); fall back to
         honorWrap only if the link yields nothing.  Another userscript injects
         battle-stat estimates ("2.4b", "26k") into honorWrap, so honorWrap
         textContent cannot be used as the primary source. */
      let name = getPlayerName(link);
      if (!name) {
        try {
          const honorEl = row.querySelector('[class*="honorWrap"]');
          if (honorEl) name = honorEl.textContent.replace(/\s+/g, ' ').trim();
        } catch (e) { /* skip */ }
      }
      if (!name || UI_LABEL.test(name)) continue;

      const key = gameKey(gId, pid);
      if (seen.has(key)) continue;
      seen.add(key);

      /* Bet and player count: scoped to this row's textContent only */
      const bet         = parseBet(row.textContent);
      const pcm         = /(\d+)\s*\/\s*\d+\s*player|(\d+)\s*player/i.exec(row.textContent);
      const playerCount = pcm ? parseInt(pcm[1] || pcm[2], 10) : null;
      games.push({ key, gameId: gId, playerId: pid, playerName: name, bet, playerCount });
    }

    if (!games.length) {
      return { ok: false, reason: 'No valid game entries extracted from rows', games: [] };
    }
    return { ok: true, reason: '', games };
  }

  /*
   * captureDomDiag — v0.1.2 rewrite.
   *
   * Does NOT rely on profile links.  Captures structural information about the
   * RR lobby DOM regardless of how game rows are implemented.  Designed to
   * answer: what elements are inside the found section, what links exist,
   * what class names does Torn use, what does the element tree look like?
   *
   * Safe to call at any time.  Only runs when the button is pressed.
   * Does NOT transmit data anywhere — clipboard or visible textarea only.
   */
  function captureDomDiag() {
    const own = document.getElementById(NS + '-host');
    const ts  = new Date().toISOString().slice(0, 19);
    const skip = el => !!(own && own.contains(el));
    const clsOf = el => safeClass(el).slice(0, 100);
    const txOf  = el => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);

    /* 1 — page location */
    const loc = {
      pn:  location.pathname,
      qs:  location.search,
      sid: ((/[?&]sid=([^&#]*)/.exec(location.search)) || [])[1] || null,
    };

    /* 2 — body-level link counts (quick orientation) */
    let bodyProfile = 0, bodyGame = 0;
    try { bodyProfile = document.querySelectorAll('a[href*="/profiles.php"]').length; } catch(e){}
    try { bodyGame    = document.querySelectorAll('a[href*="game="]').length; } catch(e){}

    /* 3 — headings visible on the page */
    const heads = [];
    try {
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
        if (skip(h) || heads.length >= 8) return;
        heads.push({ tag: h.tagName, cls: clsOf(h), tx: h.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) });
      });
    } catch(e) {}

    /* 4 — candidate containers via CSS-module-aware selectors
           These are NOT profile-link based — they probe class names directly */
    const candSels = [
      '[class*="available"]', '[class*="game-list"]', '[class*="gameList"]',
      '[class*="roulette"]',  '[class*="russian"]',   '[class*="lobby"]',
      '[class*="waiting"]',   '[class*="tableWrap"]', '[class*="tableRow"]',
      '[class*="gameRow"]',   '[class*="listItem"]',  '[class*="rowWrap"]',
      '[class*="createWrap"]','[class*="playerWrap"]','[class*="betWrap"]',
    ];
    const cands = []; const seenC = new WeakSet();
    for (const sel of candSels) {
      if (cands.length >= 14) break;
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (skip(el) || seenC.has(el) || cands.length >= 14) return;
          seenC.add(el);
          cands.push({
            sel,
            tag: el.tagName,
            cls: clsOf(el),
            id:  el.id || undefined,
            kids: el.children.length,
            anyLinks: el.querySelectorAll('a[href]').length,
            tx:  txOf(el).slice(0, 60),
          });
        });
      } catch(e) {}
    }

    /* 5 — findGamesSection() result with richer context */
    const sec = findGamesSection();
    let secInfo = null;
    if (sec) {
      let secAnyLinks = 0, secPLinks = 0;
      try { secAnyLinks = sec.querySelectorAll('a[href]').length; } catch(e){}
      try { secPLinks   = sec.querySelectorAll('a[href*="/profiles.php"]').length; } catch(e){}
      const linkSample = [];
      try {
        sec.querySelectorAll('a[href]').forEach(a => {
          if (linkSample.length >= 8) return;
          linkSample.push({
            href: sanitizeHref(a.getAttribute('href') || ''),
            tx:   a.textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
            pCls: clsOf(a.parentElement || a).slice(0, 50),
          });
        });
      } catch(e) {}
      secInfo = {
        tag:          sec.tagName,
        cls:          clsOf(sec),
        id:           sec.id || undefined,
        kids:         sec.children.length,
        anyLinks:     secAnyLinks,
        profileLinks: secPLinks,
        linkSample,
        parent: sec.parentElement ? {
          tag:  sec.parentElement.tagName,
          cls:  clsOf(sec.parentElement).slice(0, 80),
          kids: sec.parentElement.children.length,
        } : null,
        prevSib: sec.previousElementSibling ? {
          tag: sec.previousElementSibling.tagName,
          cls: clsOf(sec.previousElementSibling).slice(0, 70),
          tx:  txOf(sec.previousElementSibling).slice(0, 40),
        } : null,
        nextSib: sec.nextElementSibling ? {
          tag:  sec.nextElementSibling.tagName,
          cls:  clsOf(sec.nextElementSibling).slice(0, 70),
          kids: sec.nextElementSibling.children.length,
        } : null,
      };
    }

    /* 6 — direct children of the section (up to 12 potential game rows) */
    const rows = [];
    if (sec) {
      Array.from(sec.children).slice(0, 12).forEach(el => {
        const elLinks = [];
        try {
          el.querySelectorAll('a[href]').forEach(a => {
            if (elLinks.length >= 4) return;
            elLinks.push({
              href: sanitizeHref(a.getAttribute('href') || ''),
              tx:   a.textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
            });
          });
        } catch(e) {}
        rows.push({
          tag:  el.tagName,
          cls:  clsOf(el).slice(0, 80),
          id:   el.id || undefined,
          kids: el.children.length,
          links: elLinks,
          tx:   txOf(el).slice(0, 80),
        });
      });
    }

    /* 7 — bounded depth tree of the section (tag / safe-attrs / direct-text / children)
           Depth ≤ 3, ≤ 8 children per node.  Skips sensitive attribute names. */
    const SKIP_ATTR = /^(value|src|action|data-token|data-auth|data-key|data-user|data-api|data-csrf)$/i;
    function treeOf(el, d) {
      if (!el || d > 3 || skip(el)) return null;
      const node = { t: el.tagName };
      const a = {};
      for (const attr of el.attributes) {
        if (SKIP_ATTR.test(attr.name)) continue;
        const v = attr.name === 'href'
          ? sanitizeHref(attr.value)
          : attr.value.slice(0, 60);
        a[attr.name] = v;
      }
      if (Object.keys(a).length) node.a = a;
      let tx = '';
      for (const n of el.childNodes) if (n.nodeType === 3) tx += n.nodeValue;
      tx = tx.replace(/\s+/g, ' ').trim();
      if (tx) node.tx = tx.slice(0, 40);
      const ch = [];
      for (let i = 0; i < Math.min(el.children.length, 8); i++) {
        const c = treeOf(el.children[i], d + 1);
        if (c) ch.push(c);
      }
      if (ch.length) node.ch = ch;
      return node;
    }
    let tree = sec ? treeOf(sec, 0) : null;

    /* 8 — ancestry path of the "List of available games" heading element */
    let headingPath = null;
    try {
      const hEls = document.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,strong,b,span,div,p,label,th,td'
      );
      for (let i = 0; i < hEls.length; i++) {
        const el = hEls[i];
        const tx = el.textContent.replace(/\s+/g, ' ').trim();
        if (tx.length > 120 || !/list of available games/i.test(tx)) continue;
        headingPath = [];
        let cur = el;
        for (let d = 0; cur && cur !== document.body && d < 6; d++, cur = cur.parentElement) {
          headingPath.push({
            tag:  cur.tagName,
            cls:  clsOf(cur).slice(0, 80),
            id:   cur.id || undefined,
            kids: cur.children.length,
          });
        }
        break;
      }
    } catch (e) {}

    /* 9 — sample of up to 8 body-level profile links with parent/sibling context */
    const profileLinkSample = [];
    try {
      document.querySelectorAll('a[href*="/profiles.php"]').forEach(a => {
        if (skip(a) || profileLinkSample.length >= 8) return;
        const par = a.parentElement;
        const gpar = par && par.parentElement;
        const sibs = par ? Array.from(par.children).filter(c => c !== a) : [];
        profileLinkSample.push({
          href:   sanitizeHref(a.getAttribute('href') || ''),
          tx:     a.textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
          pTag:   par ? par.tagName : null,
          pCls:   par ? clsOf(par).slice(0, 60) : null,
          gpTag:  gpar ? gpar.tagName : null,
          gpCls:  gpar ? clsOf(gpar).slice(0, 60) : null,
          sibTx:  sibs.slice(0, 3).map(s => s.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)).join(' | '),
        });
      });
    } catch (e) {}

    /* 10 — data-* attributes on section children (candidate game-ID carriers) */
    const rowDataAttrs = [];
    if (sec) {
      try {
        Array.from(sec.children).slice(0, 6).forEach(el => {
          const attrs = {};
          for (const attr of el.attributes) {
            if (/^data-/i.test(attr.name) && !/token|auth|key|api|csrf/i.test(attr.name)) {
              attrs[attr.name] = attr.value.slice(0, 40);
            }
          }
          /* Also check shallow descendants for game-ID data attrs */
          try {
            el.querySelectorAll('[data-id],[data-game],[data-game-id],[data-entry-id]').forEach(sub => {
              for (const attr of sub.attributes) {
                if (/^data-/i.test(attr.name) && !/token|auth|key|api|csrf/i.test(attr.name)) {
                  const k = 'sub.' + sub.tagName + '.' + attr.name;
                  attrs[k] = attr.value.slice(0, 40);
                }
              }
            });
          } catch (e) {}
          if (Object.keys(attrs).length || el.id) {
            rowDataAttrs.push({
              tag:  el.tagName,
              cls:  clsOf(el).slice(0, 60),
              id:   el.id || undefined,
              attrs,
            });
          }
        });
      } catch (e) {}
    }

    const diag = {
      v: VERSION, ts, loc,
      bodyLinks: { profile: bodyProfile, withGame: bodyGame },
      heads, cands, sec: secInfo, rows, tree,
      headingPath, profileLinks: profileLinkSample, rowDataAttrs,
    };

    let out = JSON.stringify(diag, null, 2);
    /* Size guard — drop tree if output too large */
    if (out.length > 18000) {
      diag.tree = { note: 'omitted — size limit', chars: out.length };
      out = JSON.stringify(diag, null, 2);
    }
    return out;
  }

  /* ============================ 4. LOG ============================ */
  function logEvent(type, info) {
    const e = Object.assign({ type, ts: Date.now() }, info || {});
    State.log.push(e);
    if (State.log.length > LOG_MAX) State.log.shift();
  }

  function exportLog(n) {
    return State.log.slice(-(n || 50)).map(e => {
      let line = new Date(e.ts).toISOString().slice(11, 19) + ' ' + e.type;
      if (e.gameKey) line += ' game=' + e.gameKey;
      if (e.playerName) line += ' player=' + e.playerName;
      if (e.bet != null) line += ' bet=$' + e.bet.toLocaleString();
      return line;
    }).join('\n');
  }

  /* ============================ 5. TIMERS ============================ */
  function formatAge(firstSeen, now) {
    if (firstSeen == null) return 'Age unknown';
    const ms = (now != null ? now : Date.now()) - firstSeen;
    if (ms < 0) return 'Age unknown';
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    if (h > 0) return h + 'h ' + (m % 60) + 'm';
    if (m > 0) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  function estimatedRemaining(firstSeen, now) {
    if (firstSeen == null) return null;
    return Math.max(0, GAME_TIMEOUT_EST - ((now != null ? now : Date.now()) - firstSeen));
  }

  /* ============================ 6. GAME PROCESSING ============================ */
  function processGames(games, isInitial, now) {
    const currentKeys = new Set(games.map(g => g.key));
    for (const g of games) {
      const ex = State.games.get(g.key);
      if (!ex) {
        State.games.set(g.key, {
          gameKey: g.key, gameId: g.gameId, playerId: g.playerId,
          playerName: g.playerName, bet: g.bet, playerCount: g.playerCount,
          firstSeen: isInitial ? null : now, lastSeen: now,
        });
        logEvent('GAME_SEEN', { gameKey: g.key, gameId: g.gameId,
          playerId: g.playerId, playerName: g.playerName, bet: g.bet });
      } else {
        const changed = ex.bet !== g.bet || ex.playerName !== g.playerName ||
                        ex.playerCount !== g.playerCount;
        ex.bet = g.bet; ex.playerName = g.playerName;
        ex.playerCount = g.playerCount; ex.lastSeen = now;
        if (changed) logEvent('GAME_UPDATED', { gameKey: g.key, gameId: g.gameId,
          playerId: g.playerId, playerName: g.playerName, bet: g.bet });
      }
    }
    State.games.forEach((entry, key) => {
      if (!currentKeys.has(key)) {
        State.games.delete(key);
        logEvent('GAME_DISAPPEARED', { gameKey: key, gameId: entry.gameId,
          playerId: entry.playerId, playerName: entry.playerName, bet: entry.bet });
      }
    });
  }

  function scanLobby(isInitial) {
    const result = parseRRLobby();
    State.parseOk = result.ok;
    State.parseNote = result.reason;
    if (!result.ok) { UI.render(); return; }
    processGames(result.games, isInitial, Date.now());
    UI.render();
  }

  /* ============================ 7. OBSERVER ============================ */
  let _observer = null, _throttleTimer = null, _renderTimer = null;

  function scheduleScan() {
    if (_throttleTimer) return;
    _throttleTimer = setTimeout(() => {
      _throttleTimer = null;
      if (State.tracking) scanLobby(false);
    }, THROTTLE_MS);
  }

  function findLobbyContainer() {
    const section = findGamesSection();
    if (section) return section;
    const sels = [
      '[class*="roulette-lobby"]', '[class*="russianRoulette"]', '[class*="rr-lobby"]',
      '[class*="lobby"]', '[id*="roulette"]', '[id*="lobby"]', 'main', '#mainContainer',
    ];
    for (const sel of sels) {
      try { const el = document.querySelector(sel); if (el) return el; } catch (e) { /* skip */ }
    }
    return document.body;
  }

  function startTracking() {
    if (State.tracking) return;
    State.tracking = true;
    logEvent('TRACKING_RESUMED');
    scanLobby(true);
    _observer = new MutationObserver(scheduleScan);
    _observer.observe(findLobbyContainer(), { childList: true, subtree: true });
    _renderTimer = setInterval(() => { if (State.tracking) UI.render(); }, RENDER_TICK_MS);
  }

  function stopTracking() {
    if (!State.tracking) return;
    State.tracking = false;
    logEvent('TRACKING_PAUSED');
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null; }
    if (_renderTimer) { clearInterval(_renderTimer); _renderTimer = null; }
    UI.render();
  }

  /* ============================ 8. UI ============================ */
  const UI = (function () {
    let host = null, shadow = null, _open = false;
    let $fab, $ov, $tgl, $cls, $bd;

    const CSS = [
      ':host{all:initial}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
      '.fab{position:fixed;z-index:2147483000;right:10px;bottom:calc(var(--y,120px) + env(safe-area-inset-bottom,0px));padding:8px 14px;border-radius:20px;border:1px solid #6a2a9a;background:rgba(16,10,26,.93);color:#c080f0;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);touch-action:manipulation;cursor:pointer}',
      '.fab.hide{display:none}',
      '.ov{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483001;background:rgba(0,0,0,.55);display:none}.ov.open{display:block}',
      '.pn{position:absolute;top:max(8px,env(safe-area-inset-top,0px));bottom:max(8px,env(safe-area-inset-bottom,0px));left:max(6px,env(safe-area-inset-left,0px));right:max(6px,env(safe-area-inset-right,0px));max-width:520px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;background:#0c0816;color:#ddd0f0;border:1px solid #3a1a5a;border-radius:12px;box-shadow:0 6px 30px rgba(0,0,0,.7);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}',
      '.hd{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 12px;background:#140c20;border-bottom:1px solid #3a1a5a;flex:0 0 auto}',
      '.ttl{flex:1;font-weight:700;color:#c080f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ttl small{color:#6a4a80;font-weight:400;margin-left:6px;font-size:11px}',
      'button{font:inherit;color:inherit;cursor:pointer}',
      '.ib{width:38px;height:38px;border-radius:8px;border:1px solid #3a1a5a;background:#180c28;color:#ddd0f0;font-size:16px;line-height:1;touch-action:manipulation}',
      '.ib.x{background:#501020;border-color:#802030;color:#fff;font-weight:700}.ib:disabled{opacity:.4}',
      '.bd{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px 10px 10px}',
      '.bar{display:flex;align-items:center;gap:8px;padding:5px 0 4px;font-size:11px;color:#6a4a80;border-bottom:1px solid #1e1030;margin-bottom:6px}',
      '.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}.dot.on{background:#5cb85c}.dot.off{background:#555}',
      '.gm{padding:6px 8px;margin-bottom:4px;border-radius:7px;border:1px solid #1e1030;background:#100820}',
      '.gm.hi{border-color:#6a2a9a;background:#16082a}',
      '.gn{font-weight:600;color:#c080f0;font-size:13px}',
      '.gx{font-size:11px;color:#8060a0;margin-top:2px}',
      '.ga{font-size:11px;color:#4a3060;margin-top:1px}',
      '.ge{font-size:10px;color:#6a4a7a;font-style:italic}',
      '.ok{color:#5cb85c}',
      '.empty{padding:18px 0;text-align:center;color:#4a3060;font-size:12px}',
      '.warn{padding:7px 9px;margin-bottom:5px;border-radius:6px;background:#1e1010;border:1px solid #4a1a1a;color:#b07070;font-size:11px}',
      '.cfg{padding:6px 0 3px;border-top:1px solid #1e1030;margin-top:4px;font-size:11px;color:#6a4a80;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.cfg input{flex:1;min-width:90px;max-width:150px;padding:4px 7px;border-radius:5px;border:1px solid #3a1a5a;background:#080410;color:#ddd0f0;font:11px inherit}',
      '.lbtn{margin-top:5px;padding:5px 10px;border-radius:6px;border:1px solid #3a1a5a;background:#100820;color:#8060a0;font-size:11px;touch-action:manipulation}',
      /* diagnostic output panel */
      '.dg-wrap{margin-top:7px;border-top:1px solid #2a1040;padding-top:5px}',
      '.dg-hd{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#8060b0;margin-bottom:3px}',
      '.dg-msg{font-size:10px;color:#5cb85c;margin-bottom:3px}',
      '.dg-hint{font-size:10px;color:#4a3060;font-style:italic;margin-bottom:4px}',
      '.dg-ta{display:block;width:100%;height:130px;background:#040110;color:#9080c0;border:1px solid #2a1040;border-radius:4px;font:10px/1.3 "Courier New",monospace;padding:5px;resize:none;-webkit-user-select:text;user-select:text;white-space:pre;overflow:auto}',
    ].join('');

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function fmtBet(n) {
      if (n == null) return 'Unknown';
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      return '$' + n.toLocaleString();
    }

    function render() {
      if (!host || !host.isConnected || !$bd) return;
      const now = Date.now();
      const games = Array.from(State.games.values());
      let html = '';

      html += '<div class="bar"><span class="dot ' + (State.tracking ? 'on' : 'off') + '"></span>';
      html += '<strong style="color:#c080f0">' + games.length + '</strong>&nbsp;game' + (games.length !== 1 ? 's' : '') + ' observed';
      const q = games.filter(g => g.bet == null || g.bet >= State.minBet).length;
      if (q !== games.length) html += '&nbsp;&middot;&nbsp;<strong style="color:#c080f0">' + q + '</strong>&nbsp;&ge;&nbsp;min bet';
      html += '</div>';

      if (State.parseOk === false) {
        html += '<div class="warn">\u26A0\uFE0F ' + esc(State.parseNote || 'Could not parse RR lobby') + '</div>';
      }

      if (!games.length) {
        html += '<div class="empty">' + (State.tracking ? 'Watching for games\u2026' : 'Paused. Tap \u25B6 to start.') + '</div>';
      } else {
        games.sort((a, b) => {
          if (a.bet == null && b.bet != null) return 1;
          if (a.bet != null && b.bet == null) return -1;
          if (a.bet !== b.bet) return (b.bet || 0) - (a.bet || 0);
          return (a.firstSeen || 0) - (b.firstSeen || 0);
        });
        for (const g of games) {
          const hi = g.bet != null && g.bet >= State.minBet;
          html += '<div class="gm' + (hi ? ' hi' : '') + '">';
          html += '<div class="gn">' + esc(g.playerName) + '</div>';
          html += '<div class="gx">Bet:&nbsp;<span' + (hi ? ' class="ok"' : '') + '>' + esc(fmtBet(g.bet)) + '</span>';
          if (g.playerCount != null) html += '&nbsp;&middot;&nbsp;Players:&nbsp;' + g.playerCount;
          if (g.gameId) html += '&nbsp;&middot;&nbsp;<span style="color:#3a2050;font-size:10px">ID:' + esc(g.gameId) + '</span>';
          html += '</div><div class="ga">Observed: ' + esc(formatAge(g.firstSeen, now)) + '</div>';
          if (g.firstSeen != null) {
            const rem = estimatedRemaining(g.firstSeen, now);
            const rm = Math.floor(rem / 60000), rs = Math.floor((rem % 60000) / 1000);
            html += '<div class="ge">Est. remaining (\u224815 min, not guaranteed): ' + rm + 'm ' + rs + 's</div>';
          }
          html += '</div>';
        }
      }

      html += '<div class="cfg"><label>Min bet:&nbsp;<input id="rrmt-mb" type="text" value="' + esc(fmtBet(State.minBet)) + '" placeholder="e.g. 200M"></label></div>';
      html += '<button class="lbtn" id="rrmt-lb">Copy log (last 50)</button>';
      html += '&nbsp;<button class="lbtn" id="rrmt-diag">Copy DOM diagnostics</button>';

      /* diagnostic output area — only rendered when State.diagOutput is set */
      if (State.diagOutput) {
        html += '<div class="dg-wrap">';
        html += '<div class="dg-hd"><span>\uD83D\uDD0D Diagnostics captured</span>';
        html += '<button class="lbtn" id="rrmt-dgclr">\u2715 Clear</button></div>';
        if (State.diagMsg) {
          html += '<div class="dg-msg">' + esc(State.diagMsg) + '</div>';
        }
        html += '<div class="dg-hint">If copy failed: tap text area below \u2192 triple-tap \u2192 select all \u2192 copy</div>';
        html += '<textarea class="dg-ta" id="rrmt-dgta" readonly></textarea>';
        html += '</div>';
      }

      $bd.innerHTML = html;

      if ($tgl) $tgl.textContent = State.tracking ? '\u23F8' : '\u25B6';

      /* set textarea value after innerHTML (avoids HTML-escaping the JSON) */
      if (State.diagOutput) {
        const ta = shadow.getElementById('rrmt-dgta');
        if (ta) ta.value = State.diagOutput;
        const clrBtn = shadow.getElementById('rrmt-dgclr');
        if (clrBtn) clrBtn.addEventListener('click', () => {
          State.diagOutput = null;
          State.diagMsg    = null;
          render();
        });
      }

      const mbEl = shadow.getElementById('rrmt-mb');
      if (mbEl) mbEl.addEventListener('change', function () {
        const v = parseMinBet(this.value);
        if (v && v > 0) { State.minBet = v; render(); }
      });

      const lbEl = shadow.getElementById('rrmt-lb');
      if (lbEl) lbEl.addEventListener('click', () => {
        const txt = exportLog(50);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).catch(() => fbCopy(txt));
        } else { fbCopy(txt); }
      });

      const diagEl = shadow.getElementById('rrmt-diag');
      if (diagEl) diagEl.addEventListener('click', () => {
        const txt = captureDomDiag();
        State.diagOutput = txt;
        State.diagMsg    = null;
        render();

        /* attempt clipboard copy after render (button ref may be stale — look it up again) */
        const btn = shadow.getElementById('rrmt-diag');
        const setMsg = (msg, colour) => {
          State.diagMsg = msg;
          const ta = shadow.getElementById('rrmt-dghd');
          if (btn) { btn.textContent = msg; setTimeout(() => { btn.textContent = 'Copy DOM diagnostics'; }, 2500); }
          render();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt)
            .then(() => setMsg('\u2713 Copied to clipboard', '#5cb85c'))
            .catch(() => setMsg('Clipboard failed \u2014 see text \u2193', '#b07070'));
        } else {
          setMsg('See text \u2193 to copy manually', '#8060a0');
        }
      });
    }

    function fbCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* silent */ }
      document.body.removeChild(ta);
    }

    function open()  { _open = true; if ($ov) $ov.classList.add('open'); if ($fab) $fab.classList.add('hide'); if (!State.tracking) startTracking(); render(); }
    function close() { _open = false; if ($ov) $ov.classList.remove('open'); if ($fab) $fab.classList.remove('hide'); }
    function isOpen()  { return _open; }
    function isAlive() { return !!(host && host.isConnected); }

    function destroy() {
      stopTracking();
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null; shadow = null; $fab = $ov = $tgl = $cls = $bd = null;
    }

    function attach() {
      const p = document.body || document.documentElement;
      if (p && host && !host.isConnected) p.appendChild(host);
    }

    function build() {
      const old = document.getElementById(NS + '-host');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      host = document.createElement('div');
      host.id = NS + '-host';
      host.setAttribute('data-version', VERSION);
      host.style.cssText = 'all:initial;display:block;position:static';
      shadow = typeof host.attachShadow === 'function'
        ? host.attachShadow({ mode: 'open' }) : host;
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      const tpl = document.createElement('template');
      tpl.innerHTML =
        '<button class="fab" id="rrmt-fab">\uD83C\uDFB2 RR</button>' +
        '<div class="ov" id="rrmt-ov"><div class="pn" role="dialog" aria-modal="true" aria-label="RR Mug Tracker">' +
          '<div class="hd"><div class="ttl">RR Mug Tracker<small>v' + VERSION + '</small></div>' +
            '<button class="ib" id="rrmt-tgl" title="Toggle tracking">\u25B6</button>' +
            '<button class="ib x" id="rrmt-cls">\u2715</button>' +
          '</div><div class="bd" id="rrmt-bd"></div></div></div>';
      shadow.appendChild(tpl.content ? tpl.content.cloneNode(true) : tpl);
      $fab = shadow.getElementById('rrmt-fab');
      $ov  = shadow.getElementById('rrmt-ov');
      $tgl = shadow.getElementById('rrmt-tgl');
      $cls = shadow.getElementById('rrmt-cls');
      $bd  = shadow.getElementById('rrmt-bd');
      if ($fab) $fab.addEventListener('click', open);
      if ($cls) $cls.addEventListener('click', close);
      if ($tgl) $tgl.addEventListener('click', () => State.tracking ? stopTracking() : (startTracking(), render()));
      const mo = new MutationObserver(() => { if (host && !host.isConnected) attach(); });
      mo.observe(document.documentElement, { childList: true, subtree: false });
      attach();
    }

    return { build, destroy, render, open, close, isOpen, isAlive };
  })();

  /* ============================ 9. NAVIGATION ============================ */
  window.addEventListener('popstate', function onNav() {
    if (!isRRPage()) { stopTracking(); UI.destroy(); window.removeEventListener('popstate', onNav); }
  }, { passive: true });

  /* ============================ 10. BOOT ============================ */
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    UI.build();
    window.__RRMT__ = { version: VERSION, isAlive: UI.isAlive, destroy: UI.destroy, open: UI.open, close: UI.close };
    if (window.__RRMT_EXPOSE__ === true) {
      window.__RRMT_TEST__ = {
        VERSION, isRRPage, parseBet, parseMinBet, gameKey,
        formatAge, estimatedRemaining,
        safeClass, sanitizeHref, getPlayerName,
        _isSectionCandidate, findGamesSection, findRowsWrap, findRowContainer, extractGameIdFromEl,
        parseRRLobby, processGames,
        logEvent, exportLog, captureDomDiag,
        startTracking, stopTracking, State, UI,
        UI_LABEL,
      };
    }
  }

  boot();
})();
