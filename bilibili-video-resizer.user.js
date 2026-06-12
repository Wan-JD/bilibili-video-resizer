// ==UserScript==
// @name         B站视频自由缩放
// @namespace    https://github.com/Wan-JD/bilibili-video-resizer
// @version      1.0.0
// @description  在 B 站普通网页模式下拖动视频边框，自由拉伸播放器画幅比例与尺寸。
// @author       Wan-JD
// @license      MIT
// @homepageURL  https://github.com/Wan-JD/bilibili-video-resizer
// @supportURL   https://github.com/Wan-JD/bilibili-video-resizer/issues
// @updateURL    https://github.com/Wan-JD/bilibili-video-resizer/raw/main/bilibili-video-resizer.user.js
// @downloadURL  https://github.com/Wan-JD/bilibili-video-resizer/raw/main/bilibili-video-resizer.user.js
// @contributionURL https://ifdian.net/a/jd0512
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/list/*
// @match        *://www.bilibili.com/bangumi/play/*
// @match        *://www.bilibili.com/cheese/play/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'bilibili_video_resizer_state';
  const SCRIPT_CLASS = 'bvr-enabled';
  const HANDLE_CLASS = 'bvr-handle';
  const ACTIVE_CLASS = 'bvr-resizing';
  const MIN_WIDTH = 420;
  const MIN_HEIGHT = 236;
  const EDGE_SIZE = 10;
  const SAVE_DELAY = 160;
  const PLAYER_SELECTORS = [
    '#bilibili-player',
    '#playerWrap',
    '#player_module',
    '.bpx-player-container',
    '.bilibili-player',
    '.player-wrap',
    '.player-container',
  ];
  const OUTER_SELECTORS = [
    '#playerWrap',
    '#player_module',
    '#bilibili-player',
    '.bpx-player-container',
    '.bilibili-player',
    '.player-wrap',
    '.player-container',
  ];
  const FULLSCREEN_SELECTORS = [
    '.mode-webfullscreen',
    '.bpx-state-webfull',
    '.bpx-player-container[data-screen="web"]',
    '.bpx-player-container[data-screen="full"]',
    '.bpx-player-container[data-screen="mini"]',
    '.bpx-player-container.bpx-player-web-fullscreen',
    '.bpx-player-container.bpx-player-fullscreen',
    '.bpx-player-container.bpx-player-mini',
  ];
  const HANDLE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

  let player = null;
  let resizeTargets = [];
  let observer = null;
  let routeTimer = null;
  let saveTimer = null;
  let currentVideoKey = null;
  let dragState = null;

  function getStorage() {
    try {
      const value = GM_getValue(STORAGE_KEY, {});
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function setStorage(value) {
    try {
      GM_setValue(STORAGE_KEY, value);
    } catch {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Ignore storage failures. The current drag should still work.
      }
    }
  }

  function getVideoKey() {
    const path = location.pathname;
    const bv = path.match(/\/video\/(BV[\w]+)/i);
    if (bv) return `video:${bv[1].toUpperCase()}`;
    const av = path.match(/\/video\/av(\d+)/i);
    if (av) return `video:av${av[1]}`;
    const ep = path.match(/\/bangumi\/play\/(ep\d+)/i);
    if (ep) return `bangumi:${ep[1]}`;
    const ss = path.match(/\/bangumi\/play\/(ss\d+)/i);
    if (ss) return `bangumi:${ss[1]}`;
    const cheese = path.match(/\/cheese\/play\/(ep\d+)/i);
    if (cheese) return `cheese:${cheese[1]}`;
    return `page:${path}`;
  }

  function closestMatch(el, selectors) {
    let node = el;
    while (node && node !== document.body) {
      if (node.matches && selectors.some((selector) => node.matches(selector))) return node;
      node = node.parentElement;
    }
    return null;
  }

  function findPlayer() {
    for (const selector of PLAYER_SELECTORS) {
      const el = document.querySelector(selector);
      if (isUsablePlayer(el)) return el;
    }

    const video = document.querySelector('.bpx-player-container video, #bilibili-player video, video');
    if (!video) return null;
    return closestMatch(video, PLAYER_SELECTORS) || video.parentElement;
  }

  function isUsablePlayer(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 240 && rect.height > 130;
  }

  function findResizeTargets(base) {
    const targets = new Set();
    const video = base.querySelector?.('video');
    const playerContainer = closestMatch(video || base, PLAYER_SELECTORS) || base;
    const outer = closestMatch(playerContainer, OUTER_SELECTORS);

    [outer, playerContainer, base].forEach((el) => {
      if (el && el instanceof HTMLElement) targets.add(el);
    });

    return Array.from(targets).filter(isUsablePlayer);
  }

  function isFullscreenLike() {
    if (document.fullscreenElement) return true;
    if (!player) return false;
    if (FULLSCREEN_SELECTORS.some((selector) => player.matches(selector) || player.closest(selector))) return true;

    const rect = player.getBoundingClientRect();
    const fillsViewport = rect.width >= window.innerWidth - 2 && rect.height >= window.innerHeight - 2;
    return fillsViewport;
  }

  function getBounds() {
    const maxWidth = Math.max(MIN_WIDTH, Math.floor(window.innerWidth - 32));
    const maxHeight = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - 96));
    return { maxWidth, maxHeight };
  }

  function clampSize(width, height) {
    const { maxWidth, maxHeight } = getBounds();
    return {
      width: Math.min(Math.max(Math.round(width), MIN_WIDTH), maxWidth),
      height: Math.min(Math.max(Math.round(height), MIN_HEIGHT), maxHeight),
    };
  }

  function applySize(width, height, persist = true) {
    if (!resizeTargets.length || isFullscreenLike()) return;
    const size = clampSize(width, height);

    resizeTargets.forEach((el) => {
      el.style.setProperty('width', `${size.width}px`, 'important');
      el.style.setProperty('height', `${size.height}px`, 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('aspect-ratio', `${size.width} / ${size.height}`, 'important');
    });

    document.documentElement.style.setProperty('--bvr-width', `${size.width}px`);
    document.documentElement.style.setProperty('--bvr-height', `${size.height}px`);
    if (persist) scheduleSave(size);
  }

  function clearSize() {
    resizeTargets.forEach((el) => {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('max-width');
      el.style.removeProperty('aspect-ratio');
    });
    document.documentElement.style.removeProperty('--bvr-width');
    document.documentElement.style.removeProperty('--bvr-height');
  }

  function scheduleSave(size) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const store = getStorage();
      store[currentVideoKey || getVideoKey()] = {
        width: size.width,
        height: size.height,
        updatedAt: Date.now(),
      };
      setStorage(store);
    }, SAVE_DELAY);
  }

  function restoreSize() {
    currentVideoKey = getVideoKey();
    const store = getStorage();
    const saved = store[currentVideoKey];
    if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return;
    applySize(saved.width, saved.height, false);
  }

  function resetSize() {
    clearTimeout(saveTimer);
    const key = currentVideoKey || getVideoKey();
    const store = getStorage();
    delete store[key];
    setStorage(store);
    clearSize();
    showHint('已重置播放器尺寸');
  }

  function showHint(text) {
    if (!player) return;
    let hint = player.querySelector('.bvr-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'bvr-hint';
      player.appendChild(hint);
    }
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hint._hideTimer);
    hint._hideTimer = setTimeout(() => hint.classList.remove('show'), 900);
  }

  function ensureHandles() {
    if (!player) return;
    player.classList.add(SCRIPT_CLASS);
    if (getComputedStyle(player).position === 'static') {
      player.style.setProperty('position', 'relative', 'important');
    }
    if (player.querySelector(`.${HANDLE_CLASS}`)) return;

    const fragment = document.createDocumentFragment();
    HANDLE_DIRECTIONS.forEach((direction) => {
      const handle = document.createElement('div');
      handle.className = `${HANDLE_CLASS} bvr-${direction}`;
      handle.dataset.direction = direction;
      handle.title = direction.includes('s') || direction.includes('n') ? '拖动缩放视频画幅，双击重置' : '拖动缩放视频画幅';
      handle.addEventListener('pointerdown', startResize);
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetSize();
      });
      fragment.appendChild(handle);
    });
    player.appendChild(fragment);
  }

  function startResize(event) {
    if (event.button !== 0 || !player || isFullscreenLike()) return;

    const direction = event.currentTarget.dataset.direction || '';
    const rect = player.getBoundingClientRect();
    dragState = {
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add(ACTIVE_CLASS);
    document.addEventListener('pointermove', onResizeMove, true);
    document.addEventListener('pointerup', stopResize, true);
    document.addEventListener('pointercancel', stopResize, true);
  }

  function onResizeMove(event) {
    if (!dragState) return;
    event.preventDefault();
    event.stopPropagation();

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const dir = dragState.direction;
    let nextWidth = dragState.startWidth;
    let nextHeight = dragState.startHeight;

    if (dir.includes('e')) nextWidth += dx;
    if (dir.includes('w')) nextWidth -= dx;
    if (dir.includes('s')) nextHeight += dy;
    if (dir.includes('n')) nextHeight -= dy;

    const size = clampSize(nextWidth, nextHeight);
    applySize(size.width, size.height);
    showHint(`${size.width} x ${size.height}`);
  }

  function stopResize(event) {
    if (!dragState) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dragState = null;
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.removeEventListener('pointermove', onResizeMove, true);
    document.removeEventListener('pointerup', stopResize, true);
    document.removeEventListener('pointercancel', stopResize, true);
  }

  function refresh() {
    const nextPlayer = findPlayer();
    if (!nextPlayer) return;

    const routeChanged = currentVideoKey !== getVideoKey();
    if (nextPlayer !== player || routeChanged) {
      if (nextPlayer !== player) player?.classList.remove(SCRIPT_CLASS);
      player = nextPlayer;
      resizeTargets = findResizeTargets(player);
      ensureHandles();
      if (routeChanged) clearSize();
      restoreSize();
    } else {
      ensureHandles();
    }

    if (isFullscreenLike()) clearSize();
  }

  function scheduleRefresh() {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(refresh, 120);
  }

  function watchRouteChanges() {
    let lastUrl = location.href;
    setInterval(() => {
      if (lastUrl === location.href) return;
      lastUrl = location.href;
      scheduleRefresh();
    }, 500);
  }

  function installStyles() {
    GM_addStyle(`
      .${SCRIPT_CLASS} {
        outline: 0 solid transparent;
      }

      .${SCRIPT_CLASS} .${HANDLE_CLASS} {
        position: absolute;
        z-index: 2147483646;
        background: transparent;
        pointer-events: auto;
        touch-action: none;
        opacity: 0;
        transition: opacity .16s ease, background-color .16s ease;
      }

      .${SCRIPT_CLASS}:hover .${HANDLE_CLASS},
      html.${ACTIVE_CLASS} .${SCRIPT_CLASS} .${HANDLE_CLASS} {
        opacity: 1;
      }

      .${SCRIPT_CLASS}:hover .${HANDLE_CLASS}::after,
      html.${ACTIVE_CLASS} .${SCRIPT_CLASS} .${HANDLE_CLASS}::after {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(0, 174, 236, .28);
      }

      .${SCRIPT_CLASS} .bvr-n {
        top: 0;
        left: ${EDGE_SIZE * 2}px;
        right: ${EDGE_SIZE * 2}px;
        height: ${EDGE_SIZE}px;
        cursor: ns-resize;
      }

      .${SCRIPT_CLASS} .bvr-s {
        left: ${EDGE_SIZE * 2}px;
        right: ${EDGE_SIZE * 2}px;
        bottom: 0;
        height: ${EDGE_SIZE}px;
        cursor: ns-resize;
      }

      .${SCRIPT_CLASS} .bvr-e {
        top: ${EDGE_SIZE * 2}px;
        right: 0;
        bottom: ${EDGE_SIZE * 2}px;
        width: ${EDGE_SIZE}px;
        cursor: ew-resize;
      }

      .${SCRIPT_CLASS} .bvr-w {
        top: ${EDGE_SIZE * 2}px;
        left: 0;
        bottom: ${EDGE_SIZE * 2}px;
        width: ${EDGE_SIZE}px;
        cursor: ew-resize;
      }

      .${SCRIPT_CLASS} .bvr-ne,
      .${SCRIPT_CLASS} .bvr-nw,
      .${SCRIPT_CLASS} .bvr-se,
      .${SCRIPT_CLASS} .bvr-sw {
        width: ${EDGE_SIZE * 2}px;
        height: ${EDGE_SIZE * 2}px;
      }

      .${SCRIPT_CLASS} .bvr-ne {
        top: 0;
        right: 0;
        cursor: nesw-resize;
      }

      .${SCRIPT_CLASS} .bvr-nw {
        top: 0;
        left: 0;
        cursor: nwse-resize;
      }

      .${SCRIPT_CLASS} .bvr-se {
        right: 0;
        bottom: 0;
        cursor: nwse-resize;
      }

      .${SCRIPT_CLASS} .bvr-sw {
        left: 0;
        bottom: 0;
        cursor: nesw-resize;
      }

      .${SCRIPT_CLASS} .bvr-hint {
        position: absolute;
        right: 12px;
        top: 12px;
        z-index: 2147483647;
        padding: 5px 9px;
        border-radius: 6px;
        background: rgba(24, 25, 28, .84);
        color: #fff;
        font: 12px/1.4 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        opacity: 0;
        transform: translateY(-4px);
        pointer-events: none;
        transition: opacity .16s ease, transform .16s ease;
      }

      .${SCRIPT_CLASS} .bvr-hint.show {
        opacity: 1;
        transform: translateY(0);
      }

      html.${ACTIVE_CLASS},
      html.${ACTIVE_CLASS} body {
        cursor: inherit !important;
        user-select: none !important;
      }
    `);
  }

  function init() {
    installStyles();
    refresh();
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleRefresh);
    document.addEventListener('fullscreenchange', scheduleRefresh);
    watchRouteChanges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
