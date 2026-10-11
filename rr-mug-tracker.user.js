// ==UserScript==
// @name         RR Mug Tracker
// @namespace    fatboy.torn
// @version      0.1.0
// @description  Russian Roulette lobby tracker for Torn PDA (iOS): observe active games, log events, show elapsed time.
// @author       FATBOY [572123]
// @match        https://www.torn.com/page.php*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/*
 * RR Mug Tracker v0.1.0 — Phase 1: read-only lobby observer.
 * No API calls, no auto-play, no attacks, no mugging.
 *
 * DOM ASSUMPTIONS — require live Torn PDA verification:
 *   1. Player profile links: href="/profiles.php?XID=[id]"
 *   2. Each game row groups the host profile link, bet text, and a game link.
 *   3. Bet amounts appear as "$[digits,]+" within the row.
 *   4. Game IDs are in link hrefs (?game=N) or data-game-id attributes.
 *   5. Player count appears as "[n]/[m] player" text within the row.
 */
(function () {
  'use strict';

  const VERSION = '0.1.0';
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

  /* ============================ 2. STATE ============================ */
  const State = {
    games:    new Map(),  // key → GameEntry
    log:      [],
    tracking: false,
    parseOk:  null,       // null=not tried, true=ok, false=failed
    parseNote: '',
    minBet:   DEFAULT_MIN_BET,
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
        const peers = Array.from(cur.parentElement.children)
          .filter(c => c !== cur && c.tagName === 'DIV');
        if (peers.length >= 1 && cur.querySelector('a[href*="/profiles.php"]')) return cur;
      }
    }
    return el.parentElement;
  }

  function parseRRLobby(root) {
    const r = root || document.body || document;
    const links = Array.from(r.querySelectorAll('a[href*="/profiles.php?XID="]'));
    if (!links.length) {
      return { ok: false, reason: 'No player profile links found — lobby may not be loaded yet', games: [] };
    }
    const games = [], seen = new Set();
    for (const link of links) {
      const pid = (/XID=(\d+)/.exec(link.href) || [])[1];
      if (!pid) continue;
      const row   = findRowContainer(link);
      const gId   = row ? extractGameIdFromEl(row) : null;
      const key   = gameKey(gId, pid);
      if (seen.has(key)) continue;
      seen.add(key);
      const name  = link.textContent.trim() || ('Player ' + pid);
      const bet   = row ? parseBet(row.textContent) : null;
      const pcm   = row && /(\d+)\s*\/\s*\d+\s*player|(\d+)\s*player/i.exec(row.textContent);
      const playerCount = pcm ? parseInt(pcm[1] || pcm[2], 10) : null;
      games.push({ key, gameId: gId, playerId: pid, playerName: name, bet, playerCount });
    }
    if (!games.length) {
      return { ok: false, reason: 'Profile links found but no game entries extracted — DOM structure may differ', games: [] };
    }
    return { ok: true, reason: '', games };
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
      $bd.innerHTML = html;

      if ($tgl) $tgl.textContent = State.tracking ? '\u23F8' : '\u25B6';

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
        VERSION, isRRPage, parseBet, parseMinBet, gameKey, formatAge, estimatedRemaining,
        parseRRLobby, processGames, logEvent, exportLog,
        startTracking, stopTracking, State, UI,
        findRowContainer, extractGameIdFromEl,
      };
    }
  }

  boot();
})();
