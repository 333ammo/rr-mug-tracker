// ==UserScript==
// @name         RR Mug Tracker
// @namespace    fatboy.torn
// @version      0.3.2
// @description  Russian Roulette lobby tracker with disappearance-watch intelligence for Torn PDA (iOS) and desktop.
// @author       FATBOY [572123]
// @match        https://www.torn.com/page.php*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// ==/UserScript==

/*
 * RR Mug Tracker v0.3.2 — persistent disappearance history.
 *
 * v0.3.2 changes:
 *   - PersistenceStore: new module (section 9) persists DisappearanceEngine state across
 *     page reloads, Torn PDA restarts and userscript restarts.
 *     Storage: GM_getValue/GM_setValue (TM/VM/PDA) with localStorage fallback.
 *     Schema: { version: 1, savedAt: ms, watches: [...], history: [...] }.
 *     Probe verifies storage before first write.  Throttle: max 1 write per 5 s.
 *     Key: "rrmt_de_store".  API keys/credentials are never stored.
 *   - History limit raised from 50 to 2,000 entries.
 *   - DisappearanceEngine: _dirty flag; exportState(), importState(), importFromBackup().
 *     importState safety: CANDIDATE → WATCHING on reload; WATCHING entries older than
 *     DE_EXPIRE_MS (30 min save-age) dropped to prevent false positives; CONFIRMED and
 *     HOSPITAL preserved; EXPIRED/DISMISSED/MOOT entries load as history only.
 *     _absCount cleared on import (no stale absent counts carried over).
 *   - Export History buttons: JSON (full lossless dataset) and CSV (one row per game).
 *     Download attempted first; falls back to textarea display for Torn PDA.
 *   - Import JSON: paste-and-apply pane with validation and gameId deduplication.
 *   - History section: paginated (DE_HIST_PAGE_SIZE = 20), shows accurate total count.
 *   - Metadata: @grant GM_getValue, @grant GM_setValue added.
 *   - Suite S added: 20 regression tests (S1–S20) covering persistence, export/import.
 *   - All 122 v0.3.1 regression tests preserved.
 *
 * RR Mug Tracker v0.3.1 — correctness hotfix for Phase 2B.
 *
 * v0.3.1 fixes:
 *   - R11 test: snapshot state string value before resume() mutates the object.
 *   - PDA_httpGet: switched to Promise-based API (PDA-native preferred over GM).
 *   - StatusChecker.tick: fills slot by direct reference; calls _updateStatusResult
 *     instead of observePlayerStatus, eliminating proximity-based slot misassignment.
 *   - _parseResp: captures apiTs from json.timestamp * 1000; passes as third callback arg.
 *   - _updateStatusResult: added isLatest guard so older Hospital cannot suppress a
 *     more recent Okay (out-of-order response protection).
 *   - CANDIDATE→CONFIRMED: requires (timestamp − candidateTs) ≥ DE_CONFIRM_DEBOUNCE_MS
 *     (800 ms) to prevent rapid MutationObserver callbacks from confirming too quickly.
 *   - _computePriority: filters slots and ok15 check where apiTs < confirmedTs (stale
 *     pre-disappearance cached API data must not contribute to priority score).
 *   - Suite R extended: R21 (out-of-order Hospital), R22 (debounce), R23 (no +15s bonus).
 *
 * v0.3.0 — Phase 2B: Disappearance Intelligence Engine.
 * No auto-play, no attacks, no mugging, no automatic actions.
 *
 * v0.3.0 changes:
 *   - DisappearanceEngine: independent module watching for game disappearances and
 *     scoring them as potential investigation opportunities (NOT win probabilities).
 *     Interface: observeSnapshot(games, ts, valid), observePlayerStatus(pid, status, ts),
 *     tick(ts), getCandidates(), getHistory(), resetOrSuspend(), resume(),
 *     getDueChecks(ts), setOutcome(gameId, label), dismiss(gameId).
 *     State machine: WATCHING → CANDIDATE → CONFIRMED → HOSPITAL|EXPIRED|DISMISSED.
 *     Confirmation requires absence from two consecutive valid lobby scans.
 *     Parser failures, invalid scans, and page suspension do not advance state.
 *     CANDIDATE entries are reset (→ WATCHING) on page resume to prevent false detections.
 *   - StatusChecker: bounded, rate-limited status check scheduler.
 *     Schedules host status checks at +0, +15, +30, +45, +60, +90 s after confirmed
 *     disappearance.  Disabled by default.  Uses Torn API v2:
 *       GET https://api.torn.com/v2/user/{id}/basic?key={key}
 *       Expected field: response.profile.status.state (also handles v1 shape).
 *     API key: injected by Torn PDA via ###PDA-APIKEY### or entered manually in TM/VM.
 *     Key is never logged, exported or stored beyond State.apiKey in memory.
 *     Request method: GM_xmlhttpRequest (TM/VM), PDA_httpGet (PDA native), fetch() fallback.
 *     Rate: max 1 request per 2.5 s across all candidates; concurrency limit 1.
 *   - Priority score (0–100): heuristic investigation priority, NOT win probability.
 *     Base 50 (35 for pre-existing games).  +20 for Okay at +15 s.  +10 for any Okay.
 *     +5 per extra Okay (cap 90).  Hospital → 0.  No status data → cap 60.
 *     Linear decay from full at 5 min to floor 5 at 30 min.
 *   - "Disappearance Watch" section in panel: shows confirmed candidates with priority
 *     badge, player info, bet, status, reason, Profile/Attack links, Dismiss button,
 *     and manual outcome labels (Won/Lost/Timeout/Unknown) for future calibration.
 *   - Status checks enable/disable toggle + API key entry in panel.
 *   - processGames() feeds DisappearanceEngine after each valid scan.
 *   - tickTimers() advances DisappearanceEngine.tick() and StatusChecker.tick() each second.
 *   - Visibility-change handler calls resetOrSuspend()/resume() on tab hide/show.
 *   - Metadata: @grant GM_xmlhttpRequest, @connect api.torn.com (status checks only).
 *   - Suite R added: 20 regression tests (R1–R20) covering 15 engine scenarios.
 *   - All 99 v0.2.1 regression tests preserved.
 *
 * RR Mug Tracker v0.2.1 — open Profile and Attack links in a new tab.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.2.1 changes:
 *   - Profile and Attack anchors now include target="_blank" rel="noopener noreferrer"
 *     so tapping either link opens the Torn page in a new tab rather than
 *     navigating away from the RR lobby.  Uses native anchor behaviour only —
 *     no window.open(), no JS click interception.
 *   - Suite Q added: 4 regression tests (Q1-Q4) verifying the target and rel
 *     attributes on both link types for a game with a valid player ID.
 *
 * RR Mug Tracker v0.2.0 — Phase 2A: player profile and attack links.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.2.0 changes:
 *   - tornProfileURL(pid) / tornAttackURL(pid): pure URL builders that validate
 *     the player ID with /^\d+$/ before constructing any URL.  Both return null
 *     for empty, null, or non-numeric IDs; links are rendered disabled in that case.
 *   - Each game card in the panel now shows:
 *       • Player name  +  #playerID  (same line, flex-spaced)
 *       • Bet, player count, game ID  (existing row, label changed to "Game:")
 *       • Observed age and countdown   (unchanged)
 *       • [Profile]  [Attack]  tap-only link row at the bottom of each card
 *   - Profile opens https://www.torn.com/profiles.php?XID={pid}
 *   - Attack  opens https://www.torn.com/loader.php?sid=attack&user2ID={pid}
 *     Both are standard Torn URLs confirmed compatible with Torn PDA iOS.
 *     Navigation requires an explicit user tap; nothing is visited automatically.
 *   - New CSS classes: .gnm .gid .gl and variants for the link row.
 *   - .gn updated to a flex row so name + ID are spaced on one line.
 *   - Suite O added: 7 regression tests for URL building and validation (O1-O7).
 *
 * RR Mug Tracker v0.1.8 — make inline lobby countdown visible on Torn PDA iOS.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.1.8 changes:
 *   - injectLobbyTimers() now overrides the statusBlock cell's CSS before
 *     appending the timer span:
 *       statusCell.style.position = 'relative'  — makes cell a positioning ctx
 *       statusCell.style.overflow = 'visible'   — overrides Torn's clip rule
 *     The span itself is position:absolute anchored to the cell bottom, so it
 *     never pushes "Waiting..." out of view and is not clipped by fixed row height.
 *     Root cause: display:block pushed the timer below the text, and the cell's
 *     overflow:hidden clipped the second line.  Confirmed via live DOM text:
 *     "Seaso1 Waiting...14:22$10,000,000" — span present but invisible.
 *   - injectLobbyTimers(now) accepts an optional timestamp so tests can inject a
 *     fixed time without race conditions.
 *   - scanLobby() captures Date.now() once and passes it to both processGames()
 *     and injectLobbyTimers() for consistency.
 *   - tickTimers() passes its captured now to injectLobbyTimers(now).
 *   - MutationObserver callback also skips mutations whose addedNodes include a
 *     [data-rrmt-timer] span (prevents the span-append itself from triggering a
 *     spurious re-scan).
 *   - removeInlineTimers() restores statusCell.style.overflow and .position to ''
 *     on cleanup.
 *   - captureDomDiag() gains a timerDiag section: bounding rects, computed
 *     display/visibility/overflow/position for every injected span and its parent.
 *   - Suite N added: 6 regression tests for visibility-fix changes (N1-N6).
 *   - Tests J8 and M5 corrected (J8 fixture lacked statusBlock; M5 timestamp
 *     mismatch fixed by passing explicit now to injectLobbyTimers).
 *
 * RR Mug Tracker v0.1.7 — fix inline timer position and bet parsing corruption.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * v0.1.7 changes:
 *   - injectLobbyTimers() now targets [class*="statusBlock"] inside each game
 *     row rather than appending to the row element itself.  Appending to the row
 *     placed the countdown outside the visible table columns (confirmed iOS bug).
 *     Rows where no statusBlock cell is found are skipped — no fallback append.
 *   - parseRRLobby() bet extraction now prefers a dedicated bet cell
 *     ([class*="betBlock"], [class*="betAmount"], [class*="betWrap"]) over
 *     row.textContent.  If no cell is found, the fallback strips all
 *     [data-rrmt-timer] spans from a row clone before parsing.
 *     Root cause: injected timer text (e.g. "14:54") was concatenated into
 *     row.textContent, corrupting parseBet output (live: $10 read as $1,014).
 *   - Player-count regex now also runs on timer-stripped row text.
 *   - Suite M added: 9 regression tests for bet isolation and timer placement.
 *
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

  const VERSION = '0.3.2';
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

  /* DisappearanceEngine constants */
  const DE_EXPIRE_MS      = 30 * 60 * 1000;
  const DE_DECAY_START_MS =  5 * 60 * 1000;
  const DE_DECAY_END_MS   = 30 * 60 * 1000;
  const DE_DECAY_FLOOR    = 5;
  const DE_STATUS_OFFSETS = [0, 15000, 30000, 45000, 60000, 90000];
  const DE_HISTORY_MAX          = 2000;   /* raised from 50 for 12–24 h experiments */
  const DE_HIST_PAGE_SIZE       = 20;
  const DE_RATE_MS              = 2500;   /* max ~24 status requests / min */
  const DE_TIMEOUT_MS           = 10000;
  const DE_PDA_KEY              = '###PDA-APIKEY###';  /* PDA replaces at install time */
  const DE_CONFIRM_DEBOUNCE_MS  = 800;    /* min ms between CANDIDATE and CONFIRMED */
  const DE_STORE_KEY            = 'rrmt_de_store';
  const DE_STORE_VERSION        = 1;
  const DE_SAVE_THROTTLE_MS     = 5000;

  /* Profile-link texts that are UI chrome, not player names */
  const UI_LABEL = /^(view\s+profile\.?|premium\s+data|follow|unfollow|report|trade|send\s+message|send\s+gift|bounty|add\s+to\s+friend)$/i;

  /* ============================ 2. STATE ============================ */
  const State = {
    games:         new Map(),  // key → GameEntry
    log:           [],
    tracking:      false,
    parseOk:       null,       // null=not tried, true=ok, false=failed
    parseNote:     '',
    minBet:        DEFAULT_MIN_BET,
    diagOutput:    null,       // set when user presses Copy DOM diagnostics
    diagMsg:       null,       // transient copy feedback message
    statusEnabled: false,      // status checks opt-in (off by default)
    apiKey:        '',         // user-entered API key for TM/VM (never logged)
    dwHistOpen:    false,      // disappearance watch history panel open/closed
    dwHistPage:    0,          // current history page (0-indexed)
    dwImportOpen:  false,      // import JSON pane visible
    dwImportError: '',         // last import error message
    exportOutput:  null,       // fallback textarea content for export
    exportOutputFn: '',        // filename hint for export display
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

  /* tornProfileURL / tornAttackURL — build validated Torn navigation URLs.
     Both accept only a strictly numeric playerId string.  Any other input
     (null, empty, non-numeric, mixed) returns null so the caller can render
     the link in a disabled state rather than constructing a broken URL. */
  function tornProfileURL(pid) {
    if (!pid || !/^\d+$/.test(String(pid))) return null;
    return 'https://www.torn.com/profiles.php?XID=' + pid;
  }

  function tornAttackURL(pid) {
    if (!pid || !/^\d+$/.test(String(pid))) return null;
    return 'https://www.torn.com/loader.php?sid=attack&user2ID=' + pid;
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
   * Bet     : [class*="betBlock"] cell text (preferred) → timer-stripped row text.
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

      /* Row text with injected timer spans removed (avoids "14:54" polluting numbers) */
      const timerEls = row.querySelectorAll('[data-rrmt-timer]');
      const rowText  = timerEls.length ? (function () {
        const c = row.cloneNode(true);
        Array.from(c.querySelectorAll('[data-rrmt-timer]')).forEach(function (s) {
          if (s.parentNode) s.parentNode.removeChild(s);
        });
        return c.textContent;
      }()) : row.textContent;

      /* Bet: prefer dedicated bet cell — immune to timer injection in any cell */
      let betText = null;
      try {
        const betCell = row.querySelector('[class*="betBlock"]') ||
                        row.querySelector('[class*="betAmount"]') ||
                        row.querySelector('[class*="betWrap"]');
        if (betCell) betText = betCell.textContent;
      } catch (e) { /* skip */ }
      const bet         = parseBet(betText != null ? betText : rowText);
      const pcm         = /(\d+)\s*\/\s*\d+\s*player|(\d+)\s*player/i.exec(rowText);
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

    /* 11 — injected timer span visibility (bounding rects + computed styles) */
    const timerDiag = [];
    try {
      document.querySelectorAll('[data-rrmt-timer]').forEach(function (span) {
        const r   = span.getBoundingClientRect();
        const cs  = window.getComputedStyle(span);
        const par = span.parentElement;
        const pcs = par ? window.getComputedStyle(par) : null;
        timerDiag.push({
          gId:     span.getAttribute('data-rrmt-timer'),
          text:    span.textContent.slice(0, 20),
          visible: r.width > 0 && r.height > 0 &&
                   cs.visibility !== 'hidden' && cs.display !== 'none',
          rect:    { t: Math.round(r.top), l: Math.round(r.left),
                     w: Math.round(r.width), h: Math.round(r.height) },
          cs:      { display: cs.display, visibility: cs.visibility,
                     overflow: cs.overflow, opacity: cs.opacity,
                     position: cs.position, bottom: cs.bottom },
          par: par ? {
            cls:      safeClass(par).slice(0, 60),
            overflow: pcs ? pcs.overflow : null,
            position: pcs ? pcs.position : null,
            height:   pcs ? pcs.height : null,
          } : null,
        });
      });
    } catch (e) { /* defensive */ }

    const diag = {
      v: VERSION, ts, loc,
      bodyLinks: { profile: bodyProfile, withGame: bodyGame },
      heads, cands, sec: secInfo, rows, tree,
      headingPath, profileLinks: profileLinkSample, rowDataAttrs,
      timerDiag,
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

  function formatCountdown(firstSeen, now) {
    if (firstSeen == null) return 'Age unknown';
    const rem = GAME_TIMEOUT_EST - ((now != null ? now : Date.now()) - firstSeen);
    if (rem <= 0) return 'Estimate reached';
    const totalSec = Math.floor(rem / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' + s : '' + s);
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
    State.parseOk   = result.ok;
    State.parseNote = result.reason;
    const now = Date.now();
    if (result.ok) {
      processGames(result.games, isInitial, now);
      injectLobbyTimers(now);
      /* Enrich with firstSeen/lastSeen from State before feeding engine */
      const enriched = result.games.map(function (g) {
        const st = State.games.get(g.key);
        return { gameId: g.gameId, playerId: g.playerId, playerName: g.playerName,
                 bet: g.bet, firstSeen: st ? st.firstSeen : null, lastSeen: now };
      });
      DisappearanceEngine.observeSnapshot(enriched, now, true);
    } else {
      DisappearanceEngine.observeSnapshot([], now, false);
    }
    DisappearanceEngine.tick(now);
    StatusChecker.tick(now);
    UI.render();
  }

  /* ============================ 7. OBSERVER ============================ */
  let _observer = null, _throttleTimer = null, _renderTimer = null, _tickTimer = null;

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
    DisappearanceEngine.resume();
    logEvent('TRACKING_RESUMED');
    scanLobby(true);
    _observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const tgt = mutations[i].target;
        if (tgt && tgt.hasAttribute && tgt.hasAttribute('data-rrmt-timer')) continue;
        if (tgt && tgt.parentElement && tgt.parentElement.hasAttribute &&
            tgt.parentElement.hasAttribute('data-rrmt-timer')) continue;
        /* Skip if the mutation is our own timer-span insertion */
        const added = mutations[i].addedNodes;
        let ourSpan = false;
        for (let j = 0; j < added.length; j++) {
          if (added[j].hasAttribute && added[j].hasAttribute('data-rrmt-timer')) {
            ourSpan = true; break;
          }
        }
        if (ourSpan) continue;
        scheduleScan();
        return;
      }
    });
    _observer.observe(findLobbyContainer(), { childList: true, subtree: true });
    _renderTimer = setInterval(() => { if (State.tracking) UI.render(); }, RENDER_TICK_MS);
    _tickTimer = setInterval(tickTimers, 1000);
  }

  function stopTracking() {
    if (!State.tracking) return;
    State.tracking = false;
    logEvent('TRACKING_PAUSED');
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null; }
    if (_renderTimer) { clearInterval(_renderTimer); _renderTimer = null; }
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
    removeInlineTimers();
    DisappearanceEngine.resetOrSuspend();
    UI.render();
  }

  /* injectLobbyTimers — inject countdown inside each game row's status cell.
     Targets [class*="statusBlock"] so the timer stays inside the correct column.
     Rows that have no statusBlock are skipped.  Idempotent: row.querySelector
     finds existing span and skips the row.  React rerenders that clear
     statusBlock innerHTML cause the span to disappear; re-injected next tick.
     Visibility fix (v0.1.8): statusCell gets position:relative/overflow:visible
     so the absolutely-positioned span is not clipped by the cell's fixed height.
     Accepts an optional `now` timestamp for deterministic testing. */
  function injectLobbyTimers(now) {
    var t = (now !== undefined) ? now : Date.now();
    try {
      const section = findGamesSection();
      if (!section) return;
      const rowsWrap = findRowsWrap(section);
      if (!rowsWrap) return;
      const ownHost = document.getElementById(NS + '-host');
      Array.from(rowsWrap.children).forEach(function (row) {
        if (!row.id || !/^\d+$/.test(row.id)) return;
        if (ownHost && ownHost.contains(row)) return;
        /* Skip if our span is already present anywhere in the row */
        if (row.querySelector('[data-rrmt-timer]')) return;
        /* Inject only into the status cell — skip if not found */
        let statusCell = null;
        try { statusCell = row.querySelector('[class*="statusBlock"]'); } catch (e) { /* skip */ }
        if (!statusCell) return;
        /* Override CSS that would clip the absolutely-positioned child */
        statusCell.style.position = 'relative';
        statusCell.style.overflow = 'visible';
        const gId = row.id;
        let entry = null;
        State.games.forEach(function (e) { if (e.gameId === gId) entry = e; });
        const span = document.createElement('span');
        span.setAttribute('data-rrmt-timer', gId);
        /* Absolute positioning anchored to bottom of status cell.
           pointer-events:none — never blocks the Join tap. */
        span.style.cssText = [
          'position:absolute',
          'bottom:1px',
          'left:0',
          'right:0',
          'text-align:center',
          'font-size:9px',
          'font-weight:600',
          'line-height:1.2',
          'color:#c080f0',
          'pointer-events:none',
          'z-index:100',
          'white-space:nowrap',
          'overflow:hidden',
          'text-overflow:ellipsis',
        ].join(';');
        span.textContent = entry ? formatCountdown(entry.firstSeen, t) : 'Age unknown';
        statusCell.appendChild(span);
      });
    } catch (e) { /* defensive — never crash the tracker */ }
  }

  function updateLobbyTimers(now) {
    try {
      const spans = document.querySelectorAll('[data-rrmt-timer]');
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const gId = span.getAttribute('data-rrmt-timer');
        let entry = null;
        State.games.forEach(function (e) { if (e.gameId === gId) entry = e; });
        span.textContent = entry ? formatCountdown(entry.firstSeen, now) : 'Age unknown';
      }
    } catch (e) { /* defensive */ }
  }

  function removeInlineTimers() {
    try {
      const spans = document.querySelectorAll('[data-rrmt-timer]');
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        /* Restore CSS overrides we applied to the parent status cell */
        const par = s.parentElement;
        if (par) { par.style.overflow = ''; par.style.position = ''; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e) { /* defensive */ }
  }

  function tickTimers() {
    if (!State.tracking) return;
    const now = Date.now();
    /* Lightweight panel timer updates — avoid full render() each second */
    try {
      State.games.forEach(function (g) {
        const el = UI.getTimerEl(g.gameKey);
        if (el) el.textContent = formatCountdown(g.firstSeen, now);
      });
    } catch (e) { /* defensive */ }
    updateLobbyTimers(now);
    injectLobbyTimers(now);
    DisappearanceEngine.tick(now);
    StatusChecker.tick(now);
    if (DisappearanceEngine.isDirty()) {
      PersistenceStore.save(now);
      DisappearanceEngine.clearDirty();
    }
  }

  /* ============================ 8. DISAPPEARANCE ENGINE ============================ */
  /*
   * Self-contained state machine.  No DOM access, no network calls.
   * All time parameters are explicit timestamps so tests can use a fake clock.
   *
   * Priority (0–100) is a heuristic investigation score, not a win probability.
   * Human-readable reason strings are built alongside every score update.
   *
   * States
   *   WATCHING  — game is currently visible in the lobby
   *   CANDIDATE — absent from 1 valid scan; awaiting confirmation
   *   CONFIRMED — absent from 2+ valid scans; status checks scheduled
   *   HOSPITAL  — confirmed disappeared, host found in hospital (suppressed)
   *   MOOT      — game reappeared after candidate/confirmed
   *   EXPIRED   — confirmed >30 min ago; moved to history
   *   DISMISSED — user dismissed
   */
  const DisappearanceEngine = (function () {
    let _watches   = new Map();  /* gameId → entry */
    let _history   = [];
    let _absCount  = new Map();  /* gameId → consecutive valid-scan absent count */
    let _suspended = false;
    let _dirty     = false;      /* set when state needs saving */

    function _makeEntry(g) {
      return {
        gameId:        g.gameId,
        playerId:      g.playerId,
        playerName:    g.playerName,
        bet:           g.bet != null ? g.bet : null,
        firstSeen:     g.firstSeen != null ? g.firstSeen : null,
        lastSeen:      g.lastSeen  != null ? g.lastSeen  : null,
        state:         'WATCHING',
        stateReason:   'Game observed in lobby',
        candidateTs:   null,
        confirmedTs:   null,
        statusChecks:  DE_STATUS_OFFSETS.map(function (o) {
          return { offset: o, scheduledAt: null, result: null, error: null, ts: null, apiTs: null };
        }),
        latestStatus:  null,
        latestStatusTs:null,
        priority:      0,
        priorityReason:'',
        outcome:       null,
      };
    }

    function _scheduleChecks(entry, ts) {
      entry.statusChecks = DE_STATUS_OFFSETS.map(function (o) {
        return { offset: o, scheduledAt: ts + o, result: null, error: null, ts: null, apiTs: null };
      });
    }

    function _computePriority(entry, now) {
      if (entry.state === 'HOSPITAL') return { score: 0, reason: 'Host in hospital — not actionable' };
      if (!entry.confirmedTs)         return { score: 0, reason: '' };

      const base   = (entry.firstSeen === null) ? 35 : 50;
      /* Filter out ERROR slots and stale results (API data predates disappearance) */
      const checks = entry.statusChecks.filter(function (c) {
        if (!c.result || c.result === 'ERROR') return false;
        if (c.apiTs !== null && typeof c.apiTs === 'number' && c.apiTs < entry.confirmedTs) return false;
        return true;
      });
      const okays  = checks.filter(function (c) { return c.result === 'Okay'; });
      /* +15s bonus only if that specific slot carries a fresh Okay */
      const ok15   = entry.statusChecks.find(function (c) {
        if (c.offset !== 15000 || c.result !== 'Okay') return false;
        if (c.apiTs !== null && typeof c.apiTs === 'number' && c.apiTs < entry.confirmedTs) return false;
        return true;
      });

      let bonus = 0;
      var reasons = [];
      if (ok15)          { bonus += 20; reasons.push('Okay at +15 s'); }
      else if (okays.length) { bonus += 10; reasons.push('Okay status seen'); }
      if (okays.length > 1) {
        bonus += Math.min(5 * (okays.length - 1), 10);
        reasons.push('Confirmed Okay ×' + okays.length);
      }

      let score = Math.min(base + bonus, 90);

      if (!checks.length)       score = Math.min(score, 60);   /* no status data */
      else if (!okays.length)   score = Math.min(score, 50);   /* all non-Okay */

      /* Age decay */
      const elapsed = now - entry.confirmedTs;
      if (elapsed >= DE_DECAY_END_MS) {
        score = DE_DECAY_FLOOR;
      } else if (elapsed > DE_DECAY_START_MS) {
        const frac = (elapsed - DE_DECAY_START_MS) / (DE_DECAY_END_MS - DE_DECAY_START_MS);
        score = Math.round(score * (1 - frac) + DE_DECAY_FLOOR * frac);
      }
      score = Math.max(DE_DECAY_FLOOR, Math.min(100, score));

      const ageMin = Math.round(elapsed / 60000);
      const ageStr = ageMin > 0 ? '; ' + ageMin + 'm ago' : '';
      const reasonStr = reasons.length
        ? reasons.join('; ') + ageStr
        : (checks.length ? 'Status checked — not Okay' : 'Status unknown') + ageStr;

      return { score: score, reason: reasonStr };
    }

    function _archiveIfDone(entry) {
      var terminal = entry.state === 'EXPIRED' || entry.state === 'DISMISSED' || entry.state === 'MOOT';
      if (!terminal) return;
      _history.unshift(Object.assign({}, entry, {
        statusChecks: entry.statusChecks.map(function (s) { return Object.assign({}, s); }),
      }));
      if (_history.length > DE_HISTORY_MAX) _history.pop();
      _watches.delete(entry.gameId);
      _absCount.delete(entry.gameId);
      _dirty = true;
    }

    /* ── public interface ── */

    function observeSnapshot(games, timestamp, scanValid) {
      if (_suspended) return;

      var presentIds = new Set();
      for (var i = 0; i < games.length; i++) {
        if (games[i].gameId) presentIds.add(games[i].gameId);
      }

      /* Register new games / update existing ones */
      for (var j = 0; j < games.length; j++) {
        var g = games[j];
        if (!g.gameId) continue;
        var ex = _watches.get(g.gameId);
        if (!ex) {
          var entry = _makeEntry(g);
          entry.lastSeen = timestamp;
          _watches.set(g.gameId, entry);
          _absCount.delete(g.gameId);
        } else {
          /* Game (re)appeared — cancel disappearance candidate if pending */
          if (ex.state === 'CANDIDATE' || ex.state === 'CONFIRMED') {
            ex.state       = 'MOOT';
            ex.stateReason = 'Game reappeared';
            _archiveIfDone(ex);
          } else {
            ex.lastSeen    = timestamp;
            ex.playerName  = g.playerName;
            ex.bet         = g.bet;
            _absCount.delete(g.gameId);
          }
        }
      }

      /* Invalid scan: hold state, don't advance disappearance */
      if (!scanValid) return;

      /* Check for absent games */
      _watches.forEach(function (entry, gameId) {
        if (entry.state !== 'WATCHING' && entry.state !== 'CANDIDATE') return;
        if (presentIds.has(gameId)) return; /* still present */

        var abs = (_absCount.get(gameId) || 0) + 1;
        _absCount.set(gameId, abs);

        if (abs === 1 && entry.state === 'WATCHING') {
          entry.state       = 'CANDIDATE';
          entry.stateReason = 'Absent from 1 valid scan — awaiting confirmation';
          entry.candidateTs = timestamp;
          _dirty = true;
        } else if (abs >= 2 && entry.state === 'CANDIDATE') {
          /* Require a real debounce interval — prevents rapid MutationObserver callbacks
             from confirming a game that may be in the middle of a React rerender */
          if (entry.candidateTs !== null &&
              (timestamp - entry.candidateTs) >= DE_CONFIRM_DEBOUNCE_MS) {
            entry.state       = 'CONFIRMED';
            entry.stateReason = 'Confirmed absent across ' + abs + ' valid scans';
            entry.confirmedTs = timestamp;
            _scheduleChecks(entry, timestamp);
            var pr = _computePriority(entry, timestamp);
            entry.priority       = pr.score;
            entry.priorityReason = pr.reason;
            _dirty = true;
          }
        }
      });

      /* Expire old confirmed entries */
      var now = timestamp;
      _watches.forEach(function (entry) {
        if ((entry.state === 'CONFIRMED' || entry.state === 'HOSPITAL') &&
            entry.confirmedTs && (now - entry.confirmedTs) >= DE_EXPIRE_MS) {
          entry.state       = 'EXPIRED';
          entry.stateReason = 'Expired after 30 minutes';
          _archiveIfDone(entry);
        }
      });
    }

    function observePlayerStatus(playerId, status, timestamp) {
      _watches.forEach(function (entry) {
        if (entry.playerId !== String(playerId)) return;
        if (entry.state !== 'CONFIRMED' && entry.state !== 'HOSPITAL') return;

        /* Fill the most overdue unfilled slot */
        var bestSlot = null, bestDiff = Infinity;
        for (var i = 0; i < entry.statusChecks.length; i++) {
          var slot = entry.statusChecks[i];
          if (slot.result !== null) continue;
          if (slot.scheduledAt === null) continue;
          var diff = Math.abs(timestamp - slot.scheduledAt);
          if (diff < bestDiff) { bestDiff = diff; bestSlot = slot; }
        }
        if (bestSlot) { bestSlot.result = status; bestSlot.ts = timestamp; }

        /* Track latest by timestamp — older out-of-order results must not overwrite newer */
        var isLatest = (entry.latestStatusTs === null || timestamp >= entry.latestStatusTs);
        if (isLatest) {
          entry.latestStatus   = status;
          entry.latestStatusTs = timestamp;
        }

        /* Hospital suppression — only if this is the latest evidence */
        if (status === 'Hospital' && isLatest) {
          entry.state       = 'HOSPITAL';
          entry.stateReason = 'Host in hospital — not actionable';
        }

        /* Recompute priority */
        var pr = _computePriority(entry, timestamp);
        entry.priority       = pr.score;
        entry.priorityReason = pr.reason;
        _dirty = true;
      });
    }

    function tick(timestamp) {
      if (_suspended) return;
      _watches.forEach(function (entry) {
        if (entry.state !== 'CONFIRMED') return;
        var pr = _computePriority(entry, timestamp);
        entry.priority       = pr.score;
        entry.priorityReason = pr.reason;
      });
    }

    function getDueChecks(timestamp) {
      var due = [];
      _watches.forEach(function (entry) {
        if (entry.state !== 'CONFIRMED') return;
        if (!entry.playerId || !/^\d+$/.test(entry.playerId)) return;
        for (var i = 0; i < entry.statusChecks.length; i++) {
          var slot = entry.statusChecks[i];
          if (slot.result !== null) continue;
          if (slot.scheduledAt === null) continue;
          if (timestamp >= slot.scheduledAt) {
            due.push({ gameId: entry.gameId, playerId: entry.playerId,
                       offset: slot.offset, slot: slot });
            break; /* one per entry */
          }
        }
      });
      return due;
    }

    function getCandidates() {
      var out = [];
      _watches.forEach(function (entry) {
        if (entry.state === 'CONFIRMED' || entry.state === 'HOSPITAL') {
          out.push(Object.assign({}, entry));
        }
      });
      out.sort(function (a, b) {
        return b.priority - a.priority || (b.confirmedTs || 0) - (a.confirmedTs || 0);
      });
      return out;
    }

    function getHistory() { return _history.slice(); }

    function resetOrSuspend() {
      _suspended = true;
      /* Freeze state — do not clear confirmed candidates */
    }

    function resume() {
      _suspended = false;
      /* Reset unstable candidates to avoid false positives after suspension */
      _watches.forEach(function (entry) {
        if (entry.state === 'CANDIDATE') {
          entry.state       = 'WATCHING';
          entry.stateReason = 'Reset after page suspension';
          entry.candidateTs = null;
          _dirty = true;
        }
      });
      _absCount.clear();
    }

    function setOutcome(gameId, outcome) {
      var entry = _watches.get(gameId);
      if (entry) { entry.outcome = outcome; _dirty = true; return; }
      for (var i = 0; i < _history.length; i++) {
        if (_history[i].gameId === gameId) { _history[i].outcome = outcome; _dirty = true; return; }
      }
    }

    function dismiss(gameId) {
      var entry = _watches.get(gameId);
      if (!entry) return;
      entry.state       = 'DISMISSED';
      entry.stateReason = 'Dismissed by user';
      _dirty = true;
      _archiveIfDone(entry);
    }

    /* Production path: called by StatusChecker after it fills the slot directly.
       Does NOT do proximity slot-matching — the slot was already filled by reference.
       Updates latestStatus, handles hospital suppression, recomputes priority. */
    function _updateStatusResult(gameId, status, ts, apiTs) {
      var entry = _watches.get(gameId);
      if (!entry) return;
      if (entry.state !== 'CONFIRMED' && entry.state !== 'HOSPITAL') return;
      var isLatest = (entry.latestStatusTs === null || ts >= entry.latestStatusTs);
      if (isLatest) {
        entry.latestStatus   = status;
        entry.latestStatusTs = ts;
      }
      if (status === 'Hospital' && isLatest) {
        entry.state       = 'HOSPITAL';
        entry.stateReason = 'Host in hospital — not actionable';
      }
      var pr = _computePriority(entry, ts);
      entry.priority       = pr.score;
      entry.priorityReason = pr.reason;
      _dirty = true;
    }

    function exportState() {
      var watches = [];
      _watches.forEach(function (entry) {
        watches.push(Object.assign({}, entry, {
          statusChecks: entry.statusChecks.map(function (s) { return Object.assign({}, s); }),
        }));
      });
      return {
        watches: watches,
        history: _history.map(function (e) {
          return Object.assign({}, e, {
            statusChecks: Array.isArray(e.statusChecks)
              ? e.statusChecks.map(function (s) { return Object.assign({}, s); }) : [],
          });
        }),
      };
    }

    function importState(data) {
      if (!data || !Array.isArray(data.watches) || !Array.isArray(data.history)) return false;
      var savedAt = (data.savedAt && typeof data.savedAt === 'number') ? data.savedAt : 0;
      var ageMs   = savedAt > 0 ? Math.max(0, Date.now() - savedAt) : Infinity;

      for (var i = 0; i < data.watches.length; i++) {
        var w = data.watches[i];
        if (!w || !w.gameId) continue;
        if (_watches.has(w.gameId)) continue;
        var restored = Object.assign({}, w, {
          statusChecks: Array.isArray(w.statusChecks)
            ? w.statusChecks.map(function (s) { return Object.assign({}, s); })
            : DE_STATUS_OFFSETS.map(function (o) {
                return { offset: o, scheduledAt: null, result: null, error: null, ts: null, apiTs: null };
              }),
        });
        /* Terminal states belong in history, not watches */
        if (restored.state === 'EXPIRED' || restored.state === 'DISMISSED' || restored.state === 'MOOT') continue;
        /* Normalize unstable candidate state */
        if (restored.state === 'CANDIDATE') {
          restored.state       = 'WATCHING';
          restored.stateReason = 'Restored after reload';
          restored.candidateTs = null;
        }
        /* Drop stale WATCHING entries (save is older than DE_EXPIRE_MS) */
        if (restored.state === 'WATCHING' && ageMs > DE_EXPIRE_MS) continue;
        _watches.set(w.gameId, restored);
      }

      /* Merge history, deduplicate by gameId */
      var existingIds = new Set(_history.map(function (h) { return h.gameId; }));
      for (var j = 0; j < data.history.length; j++) {
        var h = data.history[j];
        if (!h || !h.gameId || existingIds.has(h.gameId)) continue;
        _history.push(Object.assign({}, h, {
          statusChecks: Array.isArray(h.statusChecks)
            ? h.statusChecks.map(function (s) { return Object.assign({}, s); }) : [],
        }));
        existingIds.add(h.gameId);
      }
      if (_history.length > DE_HISTORY_MAX) _history = _history.slice(0, DE_HISTORY_MAX);
      _absCount.clear();
      return true;
    }

    function importFromBackup(data) {
      if (!data || typeof data.version !== 'number') {
        return { ok: false, added: 0, error: 'Invalid backup format' };
      }
      if (data.version !== DE_STORE_VERSION) {
        return { ok: false, added: 0, error: 'Schema version mismatch (got v' + data.version + ', expected v' + DE_STORE_VERSION + ')' };
      }
      var allEntries = [];
      if (Array.isArray(data.watches)) allEntries = allEntries.concat(data.watches);
      if (Array.isArray(data.history)) allEntries = allEntries.concat(data.history);
      var existingIds = new Set();
      _watches.forEach(function (e) { existingIds.add(e.gameId); });
      _history.forEach(function (e) { existingIds.add(e.gameId); });
      var added = 0;
      for (var i = 0; i < allEntries.length; i++) {
        var e = allEntries[i];
        if (!e || !e.gameId || existingIds.has(e.gameId)) continue;
        _history.push(Object.assign({}, e, {
          statusChecks: Array.isArray(e.statusChecks)
            ? e.statusChecks.map(function (s) { return Object.assign({}, s); }) : [],
        }));
        existingIds.add(e.gameId);
        added++;
      }
      if (_history.length > DE_HISTORY_MAX) _history = _history.slice(0, DE_HISTORY_MAX);
      if (added > 0) _dirty = true;
      return { ok: true, added: added, error: null };
    }

    function isDirty()    { return _dirty; }
    function clearDirty() { _dirty = false; }

    function _getWatches() { return _watches; } /* test-only */
    function _reset() {                          /* test-only */
      _watches.clear(); _history = []; _absCount.clear(); _suspended = false; _dirty = false;
    }

    return {
      observeSnapshot, observePlayerStatus, tick, getDueChecks,
      getCandidates, getHistory, resetOrSuspend, resume,
      setOutcome, dismiss, _updateStatusResult,
      exportState, importState, importFromBackup,
      isDirty, clearDirty,
      _getWatches, _reset,
    };
  })();

  /* ============================ 9. PERSISTENCE STORE ============================ */
  /*
   * Persists DisappearanceEngine state across reloads and restarts.
   * Storage: GM_getValue/GM_setValue (TM/VM/Torn PDA) with localStorage fallback.
   * probe() verifies storage before the first write; save() is throttled to
   * DE_SAVE_THROTTLE_MS; load() is called once at boot.
   * API keys are NEVER stored — only gameIds, timestamps, scores and outcomes.
   */
  const PersistenceStore = (function () {
    let _available = false;
    let _probed    = false;
    let _lastSave  = 0;
    let _timer     = null;

    function _gmGet(key, def) {
      if (typeof GM_getValue === 'function') {
        try {
          var v = GM_getValue(key, def);
          return (v !== undefined && v !== null) ? v : def;
        } catch (e) { /* fall through */ }
      }
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? def : JSON.parse(raw);
      } catch (e) {}
      return def;
    }

    function _gmSet(key, val) {
      if (typeof GM_setValue === 'function') {
        try { GM_setValue(key, val); return true; } catch (e) { /* fall through */ }
      }
      try {
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        return true;
      } catch (e) {}
      return false;
    }

    function probe() {
      var sentinel = { _probe: 1 };
      if (!_gmSet(DE_STORE_KEY + '_probe', sentinel)) {
        _available = false; _probed = true; return false;
      }
      var back = _gmGet(DE_STORE_KEY + '_probe', null);
      if (back && typeof back === 'object') {
        _available = back._probe === 1;
      } else if (typeof back === 'string') {
        try { _available = JSON.parse(back)._probe === 1; } catch (e) { _available = false; }
      } else {
        _available = false;
      }
      _probed = true;
      return _available;
    }

    function _doSave(ts) {
      _lastSave = ts;
      var state = DisappearanceEngine.exportState();
      _gmSet(DE_STORE_KEY, {
        version: DE_STORE_VERSION,
        savedAt: ts,
        watches: state.watches,
        history: state.history,
      });
    }

    function save(now) {
      if (!_available) return;
      var ts  = now || Date.now();
      var gap = ts - _lastSave;
      if (gap >= DE_SAVE_THROTTLE_MS) {
        if (_timer) { clearTimeout(_timer); _timer = null; }
        _doSave(ts);
        return;
      }
      if (!_timer) {
        var remain = DE_SAVE_THROTTLE_MS - gap;
        _timer = setTimeout(function () { _timer = null; _doSave(Date.now()); }, remain + 50);
      }
    }

    function load() {
      if (!_probed) probe();
      var data = _gmGet(DE_STORE_KEY, null);
      if (!data || typeof data !== 'object') return false;
      if (data.version !== DE_STORE_VERSION) return false;
      return DisappearanceEngine.importState(data);
    }

    function isAvailable() { return _available; }
    function _forceNow(ts) { _lastSave = 0; _doSave(ts || Date.now()); } /* test-only: bypass throttle */

    return { probe, save, load, isAvailable, _forceNow };
  })();

  /* ============================ 10. STATUS CHECKER ============================ */
  /*
   * Rate-limited scheduler for Torn API status checks.
   * Calls DisappearanceEngine.observePlayerStatus() on success.
   * All network calls are opt-in (State.statusEnabled) and keyed (State.apiKey
   * or PDA-injected key).  A key is never written to any log, DOM attribute,
   * or console output.
   */
  const StatusChecker = (function () {
    let _inFlight = false;
    let _lastAt   = 0;

    function _effectiveKey() {
      /* PDA replaces DE_PDA_KEY at install time; in TM/VM user enters key in UI */
      if (DE_PDA_KEY.indexOf('#') === -1) return DE_PDA_KEY; /* PDA injected */
      if (State.apiKey && State.apiKey.length >= 8 &&
          State.apiKey.indexOf('#') === -1) return State.apiKey;
      return null;
    }

    function _parseResp(text, cb) {
      try {
        var json = JSON.parse(text);
        /* v2: { profile: { status: { state } } }
           alt: { basic: { status: { state } } }  or v1: { status: { state } } */
        var state =
          (json.profile && json.profile.status && json.profile.status.state) ||
          (json.basic   && json.basic.status   && json.basic.status.state)   ||
          (json.status  && json.status.state)   ||
          null;
        var apiTs = (json.timestamp && typeof json.timestamp === 'number')
                    ? json.timestamp * 1000 : null;
        if (!state) {
          var apiErr = json.error ? (json.error.error || String(json.error)) : 'No state in response';
          cb(null, apiErr); return;
        }
        cb(state, null, apiTs);
      } catch (e) { cb(null, 'Parse error'); }
    }

    function _doFetch(playerId, key, cb) {
      var url = 'https://api.torn.com/v2/user/' + encodeURIComponent(playerId) +
                '/basic?key=' + encodeURIComponent(key);
      if (typeof PDA_httpGet === 'function') {
        try {
          var p = PDA_httpGet(url);
          if (p && typeof p.then === 'function') {
            p.then(function (resp) {
              if (resp == null) { cb(null, 'No response'); return; }
              if (typeof resp === 'string') {
                _parseResp(resp, cb);
              } else {
                var code = resp.status != null ? Number(resp.status) : 200;
                if (code !== 200) { cb(null, 'HTTP ' + code); return; }
                _parseResp(resp.responseText || resp.body || resp.data || '', cb);
              }
            }).catch(function (e) { cb(null, e ? String(e) : 'PDA error'); });
            return;
          }
        } catch (e) { /* fall through */ }
      }
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: DE_TIMEOUT_MS,
          onload:   function (r) {
            if (r.status !== 200) { cb(null, 'HTTP ' + r.status); return; }
            _parseResp(r.responseText, cb);
          },
          onerror:   function () { cb(null, 'Network error'); },
          ontimeout: function () { cb(null, 'Timeout'); },
        });
        return;
      }
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tid  = ctrl ? setTimeout(function () { ctrl.abort(); }, DE_TIMEOUT_MS) : null;
      fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) {
          clearTimeout(tid);
          if (!r.ok) { cb(null, 'HTTP ' + r.status); return Promise.reject(null); }
          return r.text();
        })
        .then(function (t) { _parseResp(t, cb); })
        .catch(function (e) { if (e) { clearTimeout(tid); cb(null, 'Fetch error'); } });
    }

    function tick(now) {
      if (!State.statusEnabled) return;
      if (_inFlight) return;
      var key = _effectiveKey();
      if (!key) return;
      if (now - _lastAt < DE_RATE_MS) return;

      var due = DisappearanceEngine.getDueChecks(now);
      if (!due.length) return;

      var item = due[0];
      _inFlight = true;
      _lastAt   = now;

      _doFetch(item.playerId, key, function (status, err, apiTs) {
        _inFlight = false;
        var ts = Date.now();
        if (status) {
          item.slot.result = status;
          item.slot.ts     = ts;
          item.slot.apiTs  = apiTs || null;
          DisappearanceEngine._updateStatusResult(item.gameId, status, ts, apiTs);
        } else {
          /* Mark slot errored so it is not re-queued */
          item.slot.result = 'ERROR';
          item.slot.error  = err || 'Unknown';
          item.slot.ts     = ts;
        }
        DisappearanceEngine.tick(ts);
        UI.render();
      });
    }

    function canCheck() { return State.statusEnabled && !!_effectiveKey(); }
    function _parseRespTest(text, cb) { _parseResp(text, cb); } /* test-only */

    return { tick, canCheck, _parseRespTest };
  })();

  /* ============================ 11. EXPORT / IMPORT HELPERS ============================ */

  function _sanitizeForExport(entry) {
    var copy = Object.assign({}, entry);
    delete copy.apiKey; delete copy.key; delete copy.token;
    if (Array.isArray(copy.statusChecks)) {
      copy.statusChecks = copy.statusChecks.map(function (s) {
        var sc = Object.assign({}, s);
        delete sc.apiKey; delete sc.key; delete sc.token;
        return sc;
      });
    }
    return copy;
  }

  function exportHistoryJSON() {
    var state = DisappearanceEngine.exportState();
    return JSON.stringify({
      version:    DE_STORE_VERSION,
      exportedAt: Date.now(),
      watches:    state.watches.map(_sanitizeForExport),
      history:    state.history.map(_sanitizeForExport),
    }, null, 2);
  }

  function exportHistoryCSV() {
    function csvField(v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var state = DisappearanceEngine.exportState();
    var all = state.history.concat(
      state.watches.filter(function (w) {
        return w.state === 'CONFIRMED' || w.state === 'HOSPITAL';
      })
    );
    var rows = ['gameId,playerName,playerId,bet,confirmedAt,outcome,latestStatus,priority,state'];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      rows.push([
        csvField(e.gameId), csvField(e.playerName), csvField(e.playerId),
        csvField(e.bet),    csvField(e.confirmedTs), csvField(e.outcome),
        csvField(e.latestStatus), csvField(e.priority), csvField(e.state),
      ].join(','));
    }
    return rows.join('\r\n');
  }

  function importHistoryJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, added: 0, error: 'Invalid JSON' }; }
    return DisappearanceEngine.importFromBackup(data);
  }

  function downloadText(filename, mimeType, text) {
    try {
      var blob = new Blob([text], { type: mimeType });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1000);
      return true;
    } catch (e) { return false; }
  }

  /* ============================ 12. UI ============================ */
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
      '.gn{display:flex;align-items:baseline;justify-content:space-between;gap:4px;flex-wrap:nowrap}',
      '.gnm{font-weight:600;color:#c080f0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 0}',
      '.gid{font-size:10px;color:#4a3060;flex-shrink:0;font-weight:400;white-space:nowrap}',
      '.gx{font-size:11px;color:#8060a0;margin-top:2px}',
      '.ga{font-size:11px;color:#4a3060;margin-top:1px}',
      '.ge{font-size:10px;color:#6a4a7a;font-style:italic}',
      '.gl{display:flex;gap:5px;margin-top:5px}',
      '.gl a{flex:1;padding:5px 2px;text-align:center;border-radius:5px;border:1px solid #3a1a5a;background:#0c0420;color:#9070b0;font-size:11px;font-weight:600;text-decoration:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;display:block;cursor:pointer}',
      '.gl a.dis{opacity:.35;pointer-events:none;cursor:default}',
      '.gl a.atk{border-color:#4a1a2a;color:#c06070}',
      '.ok{color:#5cb85c}',
      '.empty{padding:18px 0;text-align:center;color:#4a3060;font-size:12px}',
      '.warn{padding:7px 9px;margin-bottom:5px;border-radius:6px;background:#1e1010;border:1px solid #4a1a1a;color:#b07070;font-size:11px}',
      '.cfg{padding:6px 0 3px;border-top:1px solid #1e1030;margin-top:4px;font-size:11px;color:#6a4a80;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.cfg input{flex:1;min-width:90px;max-width:150px;padding:4px 7px;border-radius:5px;border:1px solid #3a1a5a;background:#080410;color:#ddd0f0;font:11px inherit}',
      '.lbtn{margin-top:5px;padding:5px 10px;border-radius:6px;border:1px solid #3a1a5a;background:#100820;color:#8060a0;font-size:11px;touch-action:manipulation}',
      /* disappearance watch */
      '.dws{margin-top:8px;border-top:1px solid #2a1040;padding-top:6px}',
      '.dwsh{font-size:11px;font-weight:700;color:#c080f0;margin-bottom:4px;display:flex;align-items:center;gap:5px}',
      '.dwsc{font-size:10px;background:#3a1a5a;border-radius:8px;padding:1px 6px;color:#d0a0f0}',
      '.dwc{padding:6px 8px;margin-bottom:4px;border-radius:7px;border:1px solid #3a2050;background:#0e0620}',
      '.dwc.act{border-color:#6a2030;background:#160810}',
      '.dwc.sup{opacity:.55;border-color:#1a1a3a}',
      '.dwp{display:inline-block;min-width:26px;height:16px;border-radius:8px;text-align:center;font-size:9px;font-weight:700;line-height:16px;padding:0 4px;margin-right:4px;background:#2a1040;color:#c080f0}',
      '.dwp.hi{background:#4a1020;color:#f08080}',
      '.dwn{font-weight:600;color:#c080f0;font-size:12px}',
      '.dwid{font-size:10px;color:#4a3060;margin-left:3px}',
      '.dwx{font-size:11px;color:#8060a0;margin-top:2px}',
      '.dwst{font-size:10px;color:#6a4a7a;margin-top:1px}',
      '.dwst.ok{color:#5cb85c}',
      '.dwst.ho{color:#c09040}',
      '.dwrsn{font-size:10px;color:#a070c0;margin-top:2px;font-style:italic}',
      '.dwbr{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}',
      '.dwbr a,.dwbr button{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;text-decoration:none;border:1px solid #3a1a5a;background:#0c0420;color:#9070b0;cursor:pointer;font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.dwbr a.atk{border-color:#4a1a2a;color:#c06070}',
      '.dwbr .dis{opacity:.35;pointer-events:none}',
      '.dwbr .dsm{color:#4a3060}',
      '.dwbr .oc{color:#6a4a60}',
      '.dwbr .oc.sel{border-color:#5a3060;color:#c080f0}',
      '.dw-cfg{margin-top:5px;font-size:10px;color:#6a4a80;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:5px;border-top:1px solid #1e1030}',
      '.dw-cfg label{display:flex;align-items:center;gap:4px;cursor:pointer}',
      '.dw-cfg input[type=checkbox]{width:13px;height:13px;accent-color:#8040c0;cursor:pointer}',
      '.dw-cfg input[type=password]{max-width:130px;padding:3px 6px;border-radius:4px;border:1px solid #3a1a5a;background:#080410;color:#ddd0f0;font:10px inherit}',
      '.dw-hist{margin-top:4px;padding-top:4px;border-top:1px solid #1e1030;font-size:10px;color:#5a4070}',
      '.dw-hist-item{padding:2px 0;display:flex;gap:5px;align-items:baseline;flex-wrap:wrap}',
      '.dw-hist-nm{color:#6a5070}',
      '.dw-hist-oc{color:#5cb85c}',
      '.dw-hist-oc.L{color:#c06070}',
      '.dw-hist-oc.T{color:#6070a0}',
      '.dw-empty{font-size:11px;color:#3a2050;padding:8px 0;text-align:center}',
      '.dw-exp-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;padding-top:4px;border-top:1px solid #1e1030}',
      '.dw-imp{margin-top:4px}',
      '.dw-imp textarea{display:block;width:100%;height:90px;background:#040110;color:#9080c0;border:1px solid #2a1040;border-radius:4px;font:10px/1.3 "Courier New",monospace;padding:5px;resize:none;-webkit-user-select:text;user-select:text}',
      '.dw-imp-err{font-size:10px;color:#f06060;margin-bottom:3px}',
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
          const hi       = g.bet != null && g.bet >= State.minBet;
          const profURL  = tornProfileURL(g.playerId);
          const atkURL   = tornAttackURL(g.playerId);
          html += '<div class="gm' + (hi ? ' hi' : '') + '">';
          /* Name row: player name (truncatable) + numeric player ID */
          html += '<div class="gn"><span class="gnm">' + esc(g.playerName) + '</span>';
          if (g.playerId) html += '<span class="gid">#' + esc(g.playerId) + '</span>';
          html += '</div>';
          /* Bet row */
          html += '<div class="gx">Bet:&nbsp;<span' + (hi ? ' class="ok"' : '') + '>' + esc(fmtBet(g.bet)) + '</span>';
          if (g.playerCount != null) html += '&nbsp;&middot;&nbsp;Players:&nbsp;' + g.playerCount;
          if (g.gameId) html += '&nbsp;&middot;&nbsp;<span style="color:#3a2050;font-size:10px">Game:' + esc(g.gameId) + '</span>';
          html += '</div>';
          /* Age + countdown */
          html += '<div class="ga">Observed: ' + esc(formatAge(g.firstSeen, now)) + '</div>';
          html += '<div class="ge" id="rrmt-tm-' + esc(g.gameKey) + '">Est. remaining (\u224815 min, not guaranteed): ' + esc(formatCountdown(g.firstSeen, now)) + '</div>';
          /* Profile / Attack tap links — disabled if playerId is invalid */
          html += '<div class="gl">';
          html += '<a' + (profURL ? ' href="' + esc(profURL) + '"' : '') + ' target="_blank" rel="noopener noreferrer" class="prf' + (profURL ? '' : ' dis') + '">Profile</a>';
          html += '<a' + (atkURL  ? ' href="' + esc(atkURL)  + '"' : '') + ' target="_blank" rel="noopener noreferrer" class="atk' + (atkURL  ? '' : ' dis') + '">Attack</a>';
          html += '</div>';
          html += '</div>';
        }
      }

      /* ── Disappearance Watch ── */
      var dwCands = DisappearanceEngine.getCandidates();
      var dwHist  = DisappearanceEngine.getHistory();
      html += '<div class="dws">';
      html += '<div class="dwsh">\uD83D\uDC41 Disappearance Watch';
      if (dwCands.length) html += '<span class="dwsc">' + dwCands.length + '</span>';
      html += '</div>';

      if (!dwCands.length) {
        html += '<div class="dw-empty">No confirmed disappearances yet</div>';
      } else {
        for (var di = 0; di < dwCands.length; di++) {
          var dc = dwCands[di];
          var isAct = dc.priority >= 60;
          var isSup = dc.state === 'HOSPITAL';
          html += '<div class="dwc' + (isSup ? ' sup' : isAct ? ' act' : '') + '">';
          /* Name + priority badge */
          html += '<div>';
          html += '<span class="dwp' + (isAct ? ' hi' : '') + '">' + dc.priority + '</span>';
          html += '<span class="dwn">' + esc(dc.playerName) + '</span>';
          html += '<span class="dwid">#' + esc(dc.playerId) + '</span>';
          html += '</div>';
          /* Bet + game */
          html += '<div class="dwx">Bet:&nbsp;' + esc(fmtBet(dc.bet));
          if (dc.gameId) html += '&nbsp;&middot;&nbsp;Game:&nbsp;' + esc(dc.gameId);
          html += '</div>';
          /* Time info */
          var dwElapsed = dc.confirmedTs ? formatAge(dc.confirmedTs, now) : '?';
          var dwObs     = formatAge(dc.firstSeen, now);
          html += '<div class="dwx">Gone:&nbsp;' + esc(dwElapsed) + '&nbsp;&middot;&nbsp;Observed:&nbsp;' + esc(dwObs) + '</div>';
          /* Status */
          var dwStCls = dc.latestStatus === 'Okay' ? 'ok' : dc.latestStatus === 'Hospital' ? 'ho' : '';
          html += '<div class="dwst ' + dwStCls + '">';
          if (!State.statusEnabled) {
            html += 'Status: checks disabled';
          } else if (dc.latestStatus) {
            var dwStAge = dc.latestStatusTs ? ('&nbsp;(' + esc(formatAge(dc.latestStatusTs, now)) + ' ago)') : '';
            html += 'Status:&nbsp;<strong>' + esc(dc.latestStatus) + '</strong>' + dwStAge;
          } else if (StatusChecker.canCheck()) {
            html += 'Status: checking\u2026';
          } else {
            html += 'Status: no API key';
          }
          html += '</div>';
          /* Priority reason */
          if (dc.priorityReason) {
            html += '<div class="dwrsn">' + esc(dc.priorityReason) + '</div>';
          }
          /* Action row */
          var dwProfURL = tornProfileURL(dc.playerId);
          var dwAtkURL  = tornAttackURL(dc.playerId);
          html += '<div class="dwbr">';
          html += '<a' + (dwProfURL ? ' href="' + esc(dwProfURL) + '"' : '') +
                  ' target="_blank" rel="noopener noreferrer"' +
                  ' class="prf' + (dwProfURL ? '' : ' dis') + '">Profile</a>';
          html += '<a' + (dwAtkURL ? ' href="' + esc(dwAtkURL) + '"' : '') +
                  ' target="_blank" rel="noopener noreferrer"' +
                  ' class="atk' + (dwAtkURL ? '' : ' dis') + '">Attack</a>';
          html += '<button class="dsm" data-dw-dismiss="' + esc(dc.gameId) + '">Dismiss</button>';
          var ocLabels = [['Won','W'],['Lost','L'],['Timeout','T'],['Unknown','?']];
          for (var oi = 0; oi < ocLabels.length; oi++) {
            var oLabel = ocLabels[oi][0], oShort = ocLabels[oi][1];
            var oSel   = dc.outcome === oLabel ? ' sel' : '';
            html += '<button class="oc' + oSel + '" data-dw-outcome="' + esc(dc.gameId) +
                    '" data-dw-label="' + oLabel + '">' + oShort + '</button>';
          }
          html += '</div>';
          html += '</div>'; /* /dwc */
        }
      }

      /* Status check config */
      html += '<div class="dw-cfg">';
      html += '<label><input type="checkbox" id="rrmt-sc-on"' +
              (State.statusEnabled ? ' checked' : '') + '>&nbsp;Status checks</label>';
      var pdaKeyLive = DE_PDA_KEY.indexOf('#') === -1;
      if (State.statusEnabled && !pdaKeyLive) {
        html += '<input type="password" id="rrmt-sc-key" placeholder="API key" value=""' +
                ' title="Enter your Torn API key (read-only)">';
      } else if (State.statusEnabled && pdaKeyLive) {
        html += '<span style="color:#5cb85c;font-size:9px">\u2713 PDA key active</span>';
      }
      html += '</div>';

      /* History — paginated, accurate count */
      html += '<div class="dw-hist">';
      html += '<strong>' + dwHist.length + ' in history</strong>';
      html += '&nbsp;<button class="lbtn" id="rrmt-dw-hist-tgl">' +
              (State.dwHistOpen ? '\u25B2 Hide' : '\u25BC History') + '</button>';
      if (State.dwHistOpen && dwHist.length > 0) {
        var pageSize  = DE_HIST_PAGE_SIZE;
        var pageCount = Math.max(1, Math.ceil(dwHist.length / pageSize));
        var page      = Math.min(Math.max(0, State.dwHistPage), pageCount - 1);
        var hStart    = page * pageSize;
        var showH     = dwHist.slice(hStart, hStart + pageSize);
        for (var hi = 0; hi < showH.length; hi++) {
          var hc = showH[hi];
          var ocCls = hc.outcome === 'Won' ? '' : hc.outcome === 'Lost' ? ' L' : ' T';
          html += '<div class="dw-hist-item">';
          html += '<span class="dw-hist-nm">' + esc(hc.playerName || '') + ' (' + esc(hc.gameId) + ')</span>';
          html += '<span>' + esc(hc.state) + '</span>';
          if (hc.outcome) html += '<span class="dw-hist-oc' + ocCls + '">' + esc(hc.outcome) + '</span>';
          html += '</div>';
        }
        if (pageCount > 1) {
          html += '<div style="display:flex;gap:4px;margin-top:3px;align-items:center;font-size:10px;color:#6a4a7a">';
          html += '<button class="lbtn" id="rrmt-dw-hist-prev"' + (page === 0 ? ' disabled' : '') + '>&laquo;</button>';
          html += '<span>' + (page + 1) + '\u202F/\u202F' + pageCount + '</span>';
          html += '<button class="lbtn" id="rrmt-dw-hist-next"' + (page >= pageCount - 1 ? ' disabled' : '') + '>&raquo;</button>';
          html += '</div>';
        }
      }
      html += '</div>';

      /* Export / Import row */
      html += '<div class="dw-exp-row">';
      html += '<button class="lbtn" id="rrmt-dw-exp-json">Export JSON</button>';
      html += '<button class="lbtn" id="rrmt-dw-exp-csv">Export CSV</button>';
      html += '<button class="lbtn" id="rrmt-dw-imp-tgl">' + (State.dwImportOpen ? 'Cancel Import' : 'Import JSON') + '</button>';
      if (PersistenceStore.isAvailable()) {
        html += '<span style="font-size:9px;color:#5a8060;margin-left:2px">\u2713&nbsp;saved</span>';
      }
      html += '</div>';

      /* Import textarea — visible when dwImportOpen */
      if (State.dwImportOpen) {
        html += '<div class="dw-imp">';
        if (State.dwImportError) {
          html += '<div class="dw-imp-err">' + esc(State.dwImportError) + '</div>';
        }
        html += '<textarea id="rrmt-dw-imp-ta" placeholder="Paste exported JSON here\u2026"></textarea>';
        html += '<div style="display:flex;gap:4px;margin-top:3px">';
        html += '<button class="lbtn" id="rrmt-dw-imp-apply">Apply Import</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; /* /dws */

      /* Export output fallback — shown when download failed (e.g. Torn PDA) */
      if (State.exportOutput) {
        html += '<div class="dg-wrap">';
        html += '<div class="dg-hd"><span>\uD83D\uDCE4 ' + esc(State.exportOutputFn || 'Export') + '</span>';
        html += '<button class="lbtn" id="rrmt-exp-clr">\u2715 Clear</button></div>';
        html += '<div class="dg-hint">Select all \u2192 copy, or long-press to share</div>';
        html += '<textarea class="dg-ta" id="rrmt-exp-ta" readonly></textarea>';
        html += '</div>';
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

      /* Export output fallback textarea */
      if (State.exportOutput) {
        const expTa = shadow.getElementById('rrmt-exp-ta');
        if (expTa) expTa.value = State.exportOutput;
        const expClr = shadow.getElementById('rrmt-exp-clr');
        if (expClr) expClr.addEventListener('click', function () {
          State.exportOutput = null; State.exportOutputFn = ''; render();
        });
      }

      /* Disappearance Watch event listeners */
      shadow.querySelectorAll('[data-dw-dismiss]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          DisappearanceEngine.dismiss(this.getAttribute('data-dw-dismiss'));
          render();
        });
      });
      shadow.querySelectorAll('[data-dw-outcome]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          DisappearanceEngine.setOutcome(this.getAttribute('data-dw-outcome'),
                                         this.getAttribute('data-dw-label'));
          render();
        });
      });
      const scOnEl = shadow.getElementById('rrmt-sc-on');
      if (scOnEl) scOnEl.addEventListener('change', function () {
        State.statusEnabled = this.checked; render();
      });
      const scKeyEl = shadow.getElementById('rrmt-sc-key');
      if (scKeyEl) scKeyEl.addEventListener('change', function () {
        /* Store key in State — never log it */
        State.apiKey = this.value.trim();
      });
      const dwHistTgl = shadow.getElementById('rrmt-dw-hist-tgl');
      if (dwHistTgl) dwHistTgl.addEventListener('click', function () {
        State.dwHistOpen = !State.dwHistOpen; render();
      });

      const dwHistPrev = shadow.getElementById('rrmt-dw-hist-prev');
      if (dwHistPrev) dwHistPrev.addEventListener('click', function () {
        if (State.dwHistPage > 0) { State.dwHistPage--; render(); }
      });
      const dwHistNext = shadow.getElementById('rrmt-dw-hist-next');
      if (dwHistNext) dwHistNext.addEventListener('click', function () {
        State.dwHistPage++; render();
      });

      function _doExport(text, fname, mime) {
        var downloaded = downloadText(fname, mime, text);
        if (!downloaded) {
          State.exportOutput   = text;
          State.exportOutputFn = fname;
          render();
          var ta = shadow.getElementById('rrmt-exp-ta');
          if (ta) ta.value = text;
        }
      }
      const expJsonEl = shadow.getElementById('rrmt-dw-exp-json');
      if (expJsonEl) expJsonEl.addEventListener('click', function () {
        var ts = new Date().toISOString().slice(0, 10);
        _doExport(exportHistoryJSON(), 'rrmt-history-' + ts + '.json', 'application/json');
      });
      const expCsvEl = shadow.getElementById('rrmt-dw-exp-csv');
      if (expCsvEl) expCsvEl.addEventListener('click', function () {
        var ts = new Date().toISOString().slice(0, 10);
        _doExport(exportHistoryCSV(), 'rrmt-history-' + ts + '.csv', 'text/csv');
      });
      const impTglEl = shadow.getElementById('rrmt-dw-imp-tgl');
      if (impTglEl) impTglEl.addEventListener('click', function () {
        State.dwImportOpen  = !State.dwImportOpen;
        State.dwImportError = '';
        render();
      });
      const impApplyEl = shadow.getElementById('rrmt-dw-imp-apply');
      if (impApplyEl) impApplyEl.addEventListener('click', function () {
        var ta   = shadow.getElementById('rrmt-dw-imp-ta');
        var text = ta ? ta.value.trim() : '';
        if (!text) { State.dwImportError = 'No data to import'; render(); return; }
        var result = importHistoryJSON(text);
        if (result.ok) {
          State.dwImportOpen  = false;
          State.dwImportError = '';
          PersistenceStore.save(Date.now());
          DisappearanceEngine.clearDirty();
        } else {
          State.dwImportError = result.error || 'Import failed';
        }
        render();
      });

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
    function getTimerEl(key) { return shadow ? shadow.getElementById('rrmt-tm-' + key) : null; }

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

    return { build, destroy, render, open, close, isOpen, isAlive, getTimerEl };
  })();

  /* ============================ 9. NAVIGATION ============================ */
  window.addEventListener('popstate', function onNav() {
    if (!isRRPage()) { stopTracking(); UI.destroy(); window.removeEventListener('popstate', onNav); }
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
      DisappearanceEngine.resetOrSuspend();
    } else {
      DisappearanceEngine.resume();
      if (State.tracking && !_tickTimer) _tickTimer = setInterval(tickTimers, 1000);
    }
  }, { passive: true });

  /* ============================ 10. BOOT ============================ */
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    PersistenceStore.probe();
    PersistenceStore.load();
    UI.build();
    window.__RRMT__ = { version: VERSION, isAlive: UI.isAlive, destroy: UI.destroy, open: UI.open, close: UI.close };
    if (window.__RRMT_EXPOSE__ === true) {
      window.__RRMT_TEST__ = {
        VERSION, isRRPage, parseBet, parseMinBet, gameKey,
        formatAge, estimatedRemaining, formatCountdown,
        tornProfileURL, tornAttackURL,
        safeClass, sanitizeHref, getPlayerName,
        _isSectionCandidate, findGamesSection, findRowsWrap, findRowContainer, extractGameIdFromEl,
        parseRRLobby, processGames,
        logEvent, exportLog, captureDomDiag,
        startTracking, stopTracking,
        injectLobbyTimers, updateLobbyTimers, removeInlineTimers, tickTimers,
        State, UI,
        UI_LABEL,
        DisappearanceEngine, StatusChecker,
        PersistenceStore,
        DE_HISTORY_MAX, DE_STORE_VERSION,
        exportHistoryJSON, exportHistoryCSV, importHistoryJSON,
      };
    }
  }

  boot();
})();
