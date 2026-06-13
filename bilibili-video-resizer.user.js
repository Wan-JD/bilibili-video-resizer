// ==UserScript==
// @name         B站视频自由缩放
// @namespace    https://github.com/Wan-JD/bilibili-video-resizer
// @version      1.1.0
// @description  在 B 站普通网页模式下拖动播放器边框，自由拉伸整块播放区域的画幅比例与尺寸。
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
  const DISABLED_CLASS = 'bvr-disabled';
  const HANDLE_CLASS = 'bvr-handle';
  const ACTIVE_CLASS = 'bvr-resizing';
  const MIN_WIDTH = 420;
  const MIN_HEIGHT = 236;
  const EDGE_SIZE = 14;
  const SAVE_DELAY = 160;
  const REFRESH_DELAY = 180;
  const STORAGE_MAX_ENTRIES = 120;
  const RIGHT_GUTTER = 18;
  const BOTTOM_GUTTER = 64;
  const PLAYER_SURFACE_SELECTORS = [
    '.bpx-player-container',
    '#bilibili-player',
    '.bilibili-player',
    '.bilibili-player-video-wrap',
    '.bpx-player-video-wrap',
  ];
  const PLAYER_FRAME_SELECTORS = [
    '#playerWrap',
    '#player_module',
    '#bilibili-player',
    '.bpx-player-container',
    '.player-section',
    '.player-wrap',
    '.player-container',
    '.video-player',
    '.video-player-container',
    '.player-box',
    '.bilibili-player',
  ];
  const PAGE_WIDTH_SELECTORS = [
    '.left-container',
    '.video-left-container',
    '.video-container-v1 .left-container',
    '.video-container .left-container',
    '.playlist-container--left',
    '.player-left',
  ];
  const SIZE_TARGET_SELECTORS = [
    '#playerWrap',
    '#player_module',
    '#bilibili-player',
    '.bpx-player-container',
    '.player-section',
    '.player-wrap',
    '.player-container',
    '.video-player',
    '.video-player-container',
    '.player-box',
    '.bilibili-player',
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
  let sizeTargets = [];
  let pageWidthTargets = [];
  let observer = null;
  let routeTimer = null;
  let saveTimer = null;
  let resizeRaf = null;
  let pendingResize = null;
  let lastAppliedSize = null;
  let currentVideoKey = null;
  let dragState = null;
  let layoutSuspended = false;

  function getStorage() {
    try {
      const value = typeof GM_getValue === 'function' ? GM_getValue(STORAGE_KEY, {}) : localStorage.getItem(STORAGE_KEY);
      if (typeof value === 'string') return JSON.parse(value || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }
  }

  function setStorage(value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEY, value);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      }
    } catch {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Ignore storage failures. The current drag should still work.
      }
    }
  }

  function pruneStorage(store) {
    const entries = Object.entries(store || {});
    if (entries.length <= STORAGE_MAX_ENTRIES) return store;

    entries
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(STORAGE_MAX_ENTRIES)
      .forEach(([key]) => delete store[key]);
    return store;
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

  function matchesAny(el, selectors) {
    return !!(el?.matches && selectors.some((selector) => el.matches(selector)));
  }

  function collectAncestors(el) {
    const nodes = [];
    let node = el;
    while (node && node !== document.body) {
      if (node instanceof HTMLElement) nodes.push(node);
      node = node.parentElement;
    }
    return nodes;
  }

  function rectArea(el) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
    return rect.width * rect.height;
  }

  function findMainVideo() {
    const visibleVideos = Array.from(document.querySelectorAll('.bpx-player-container video, #bilibili-player video, video'))
      .filter((video) => video instanceof HTMLElement)
      .filter((video) => rectArea(video) > 0);

    if (!visibleVideos.length) return null;
    const videos = visibleVideos.filter((video) => rectArea(video) > 240 * 130);
    if (!videos.length) return visibleVideos.reduce((best, video) => (rectArea(video) > rectArea(best) ? video : best));
    return videos.reduce((best, video) => (rectArea(video) > rectArea(best) ? video : best));
  }

  function findPlayer() {
    const video = findMainVideo();
    if (!video) return null;
    const candidates = collectAncestors(video)
      .filter((el) => matchesAny(el, PLAYER_FRAME_SELECTORS))
      .filter(isUsablePlayer);

    if (candidates.length) {
      const videoRect = video.getBoundingClientRect();
      const frameLike = candidates.filter((el) => {
        const rect = el.getBoundingClientRect();
        const maxWidth = Math.max(videoRect.width + 140, videoRect.width * 1.35);
        const maxHeight = Math.max(videoRect.height + 140, videoRect.height * 1.45);
        return rect.width <= maxWidth && rect.height <= maxHeight;
      });
      const pool = frameLike.length ? frameLike : candidates;
      return pool.reduce((best, el) => {
        const bestRect = best.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return rect.width * rect.height > bestRect.width * bestRect.height ? el : best;
      });
    }

    return closestMatch(video, PLAYER_SURFACE_SELECTORS) || video.parentElement;
  }

  function isUsablePlayer(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 240 && rect.height > 130;
  }

  function findResizeModel(base) {
    const sizeSet = new Set();
    const pageWidthSet = new Set();
    const video = base.querySelector?.('video');
    const surface = closestMatch(video || base, PLAYER_SURFACE_SELECTORS) || base;

    [surface, base].forEach((el) => {
      if (el && el instanceof HTMLElement) sizeSet.add(el);
    });

    collectAncestors(base).forEach((el) => {
      if (matchesAny(el, SIZE_TARGET_SELECTORS)) sizeSet.add(el);
      if (matchesAny(el, PAGE_WIDTH_SELECTORS)) pageWidthSet.add(el);
    });

    base.querySelectorAll?.(PLAYER_SURFACE_SELECTORS.join(',')).forEach((el) => {
      if (el instanceof HTMLElement) sizeSet.add(el);
    });

    return {
      sizeTargets: Array.from(sizeSet).filter(isUsablePlayer),
      pageWidthTargets: Array.from(pageWidthSet).filter(isUsablePlayer),
    };
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
    const rect = player?.getBoundingClientRect?.();
    const left = rect ? Math.max(0, rect.left) : 0;
    const top = rect ? Math.max(0, rect.top) : 0;
    const viewportWidthLimit = Math.floor(window.innerWidth - left - RIGHT_GUTTER);
    const viewportHeightLimit = Math.floor(window.innerHeight - top - BOTTOM_GUTTER);
    const relaxedHeightLimit = Math.floor(Math.max(viewportHeightLimit, window.innerWidth * 0.72));
    const maxWidth = Math.max(300, Math.min(1920, viewportWidthLimit));
    const maxHeight = Math.max(170, Math.min(1200, relaxedHeightLimit));
    return {
      minWidth: Math.min(MIN_WIDTH, maxWidth),
      minHeight: Math.min(MIN_HEIGHT, maxHeight),
      maxWidth,
      maxHeight,
    };
  }

  function clampSize(width, height) {
    const { minWidth, minHeight, maxWidth, maxHeight } = getBounds();
    return {
      width: Math.min(Math.max(Math.round(width), minWidth), maxWidth),
      height: Math.min(Math.max(Math.round(height), minHeight), maxHeight),
    };
  }

  function applySize(width, height, persist = true) {
    if (!sizeTargets.length || isFullscreenLike()) return;
    const size = clampSize(width, height);

    sizeTargets.forEach((el) => {
      el.style.setProperty('width', `${size.width}px`, 'important');
      el.style.setProperty('height', `${size.height}px`, 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('aspect-ratio', `${size.width} / ${size.height}`, 'important');
    });

    pageWidthTargets.forEach((el) => {
      el.style.setProperty('width', `${size.width}px`, 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('min-width', `${Math.min(size.width, window.innerWidth - 32)}px`, 'important');
      el.style.setProperty('flex-basis', `${size.width}px`, 'important');
    });

    document.documentElement.style.setProperty('--bvr-width', `${size.width}px`);
    document.documentElement.style.setProperty('--bvr-height', `${size.height}px`);
    lastAppliedSize = size;
    if (persist) scheduleSave(size);
    return size;
  }

  function clearSize() {
    sizeTargets.forEach((el) => {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('max-width');
      el.style.removeProperty('aspect-ratio');
    });
    pageWidthTargets.forEach((el) => {
      el.style.removeProperty('width');
      el.style.removeProperty('max-width');
      el.style.removeProperty('min-width');
      el.style.removeProperty('flex-basis');
    });
    document.documentElement.style.removeProperty('--bvr-width');
    document.documentElement.style.removeProperty('--bvr-height');
    lastAppliedSize = null;
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
      setStorage(pruneStorage(store));
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

  function cursorForDirection(direction) {
    if (direction === 'n' || direction === 's') return 'ns-resize';
    if (direction === 'e' || direction === 'w') return 'ew-resize';
    if (direction === 'ne' || direction === 'sw') return 'nesw-resize';
    return 'nwse-resize';
  }

  function formatSize(size, keepRatio = false) {
    if (!size) return '';
    return `${size.width} x ${size.height}${keepRatio ? ' | Shift 锁定比例' : ''}`;
  }

  function keepAspectRatio(width, height, direction, ratio) {
    if (!ratio || !Number.isFinite(ratio)) return { width, height };

    if (direction === 'e' || direction === 'w') return { width, height: width / ratio };
    if (direction === 'n' || direction === 's') return { width: height * ratio, height };

    const widthDelta = Math.abs(width - dragState.startWidth) / Math.max(1, dragState.startWidth);
    const heightDelta = Math.abs(height - dragState.startHeight) / Math.max(1, dragState.startHeight);
    if (widthDelta >= heightDelta) return { width, height: width / ratio };
    return { width: height * ratio, height };
  }

  function queueResize(width, height, keepRatio) {
    pendingResize = { width, height, keepRatio };
    if (resizeRaf) return;

    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      const next = pendingResize;
      pendingResize = null;
      if (!next) return;
      const size = applySize(next.width, next.height, false);
      if (size) showHint(formatSize(size, next.keepRatio));
    });
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
      handle.title = '拖动缩放整块播放区域，按住 Shift 保持比例，双击重置';
      handle.setAttribute('aria-hidden', 'true');
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
      ratio: rect.width / Math.max(1, rect.height),
    };

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.style.setProperty('--bvr-cursor', cursorForDirection(direction));
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

    const keepRatio = event.shiftKey;
    if (keepRatio) {
      const ratioSize = keepAspectRatio(nextWidth, nextHeight, dir, dragState.ratio);
      nextWidth = ratioSize.width;
      nextHeight = ratioSize.height;
    }

    const size = clampSize(nextWidth, nextHeight);
    queueResize(size.width, size.height, keepRatio);
  }

  function stopResize(event) {
    if (!dragState) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = null;
      if (pendingResize) {
        const size = applySize(pendingResize.width, pendingResize.height, false);
        if (size) showHint(formatSize(size, pendingResize.keepRatio));
        pendingResize = null;
      }
    }
    if (lastAppliedSize) scheduleSave(lastAppliedSize);
    dragState = null;
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.documentElement.style.removeProperty('--bvr-cursor');
    document.removeEventListener('pointermove', onResizeMove, true);
    document.removeEventListener('pointerup', stopResize, true);
    document.removeEventListener('pointercancel', stopResize, true);
    scheduleRefresh();
  }

  function cleanupPlayer(el) {
    if (!el) return;
    el.classList.remove(SCRIPT_CLASS, DISABLED_CLASS);
    el.querySelectorAll(`.${HANDLE_CLASS}, .bvr-hint`).forEach((node) => node.remove());
  }

  function refresh() {
    const nextPlayer = findPlayer();
    if (!nextPlayer) return;

    const routeChanged = currentVideoKey !== getVideoKey();
    if (nextPlayer !== player || routeChanged) {
      clearSize();
      if (nextPlayer !== player) cleanupPlayer(player);
      player = nextPlayer;
      const model = findResizeModel(player);
      sizeTargets = model.sizeTargets;
      pageWidthTargets = model.pageWidthTargets;
      ensureHandles();
      restoreSize();
    } else {
      ensureHandles();
    }

    const suspended = isFullscreenLike();
    player.classList.toggle(DISABLED_CLASS, suspended);
    if (suspended) {
      if (!layoutSuspended) clearSize();
      layoutSuspended = true;
      return;
    }

    if (layoutSuspended) {
      layoutSuspended = false;
      restoreSize();
    }
  }

  function scheduleRefresh() {
    if (dragState || routeTimer) return;
    routeTimer = setTimeout(() => {
      routeTimer = null;
      refresh();
    }, REFRESH_DELAY);
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
        overflow: visible !important;
      }

      .${SCRIPT_CLASS}.${DISABLED_CLASS} .${HANDLE_CLASS} {
        display: none !important;
      }

      .${SCRIPT_CLASS} .bpx-player-container,
      .${SCRIPT_CLASS} .bilibili-player,
      .${SCRIPT_CLASS} .bilibili-player-area,
      .${SCRIPT_CLASS} .bilibili-player-video-wrap,
      .${SCRIPT_CLASS} .bpx-player-video-area,
      .${SCRIPT_CLASS} .bpx-player-video-wrap {
        max-width: 100% !important;
      }

      .${SCRIPT_CLASS} video {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
      }

      .${SCRIPT_CLASS} .${HANDLE_CLASS} {
        position: absolute;
        z-index: 2147483646;
        background: transparent;
        pointer-events: auto;
        touch-action: none;
        opacity: 1;
      }

      .${SCRIPT_CLASS} .${HANDLE_CLASS}::after {
        content: "";
        position: absolute;
        opacity: 0;
        pointer-events: none;
        transition: opacity .14s ease, transform .14s ease;
      }

      .${SCRIPT_CLASS} .${HANDLE_CLASS}:hover::after,
      html.${ACTIVE_CLASS} .${SCRIPT_CLASS} .${HANDLE_CLASS}::after {
        opacity: .95;
      }

      .${SCRIPT_CLASS}:hover .bvr-se::after {
        opacity: .42;
      }

      .${SCRIPT_CLASS} .bvr-n {
        top: -${Math.floor(EDGE_SIZE / 2)}px;
        left: ${EDGE_SIZE * 3}px;
        right: ${EDGE_SIZE * 3}px;
        height: ${EDGE_SIZE}px;
        cursor: ns-resize;
      }

      .${SCRIPT_CLASS} .bvr-n::after,
      .${SCRIPT_CLASS} .bvr-s::after {
        left: 42%;
        right: 42%;
        height: 2px;
        border-radius: 999px;
        background: rgba(0, 174, 236, .85);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .35);
      }

      .${SCRIPT_CLASS} .bvr-n::after {
        top: 6px;
      }

      .${SCRIPT_CLASS} .bvr-s {
        left: ${EDGE_SIZE * 3}px;
        right: ${EDGE_SIZE * 3}px;
        bottom: -${Math.floor(EDGE_SIZE / 2)}px;
        height: ${EDGE_SIZE}px;
        cursor: ns-resize;
      }

      .${SCRIPT_CLASS} .bvr-s::after {
        bottom: 6px;
      }

      .${SCRIPT_CLASS} .bvr-e {
        top: ${EDGE_SIZE * 3}px;
        right: -${Math.floor(EDGE_SIZE / 2)}px;
        bottom: ${EDGE_SIZE * 3}px;
        width: ${EDGE_SIZE}px;
        cursor: ew-resize;
      }

      .${SCRIPT_CLASS} .bvr-e::after,
      .${SCRIPT_CLASS} .bvr-w::after {
        top: 42%;
        bottom: 42%;
        width: 2px;
        border-radius: 999px;
        background: rgba(0, 174, 236, .85);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .35);
      }

      .${SCRIPT_CLASS} .bvr-e::after {
        right: 6px;
      }

      .${SCRIPT_CLASS} .bvr-w {
        top: ${EDGE_SIZE * 3}px;
        left: -${Math.floor(EDGE_SIZE / 2)}px;
        bottom: ${EDGE_SIZE * 3}px;
        width: ${EDGE_SIZE}px;
        cursor: ew-resize;
      }

      .${SCRIPT_CLASS} .bvr-w::after {
        left: 6px;
      }

      .${SCRIPT_CLASS} .bvr-ne,
      .${SCRIPT_CLASS} .bvr-nw,
      .${SCRIPT_CLASS} .bvr-se,
      .${SCRIPT_CLASS} .bvr-sw {
        width: ${EDGE_SIZE * 3}px;
        height: ${EDGE_SIZE * 3}px;
      }

      .${SCRIPT_CLASS} .bvr-ne::after,
      .${SCRIPT_CLASS} .bvr-nw::after,
      .${SCRIPT_CLASS} .bvr-se::after,
      .${SCRIPT_CLASS} .bvr-sw::after {
        width: 18px;
        height: 18px;
        border-color: rgba(0, 174, 236, .9);
        border-style: solid;
        box-sizing: border-box;
      }

      .${SCRIPT_CLASS} .bvr-ne {
        top: -${Math.floor(EDGE_SIZE / 2)}px;
        right: -${Math.floor(EDGE_SIZE / 2)}px;
        cursor: nesw-resize;
      }

      .${SCRIPT_CLASS} .bvr-ne::after {
        top: 7px;
        right: 7px;
        border-width: 2px 2px 0 0;
        border-radius: 0 5px 0 0;
      }

      .${SCRIPT_CLASS} .bvr-nw {
        top: -${Math.floor(EDGE_SIZE / 2)}px;
        left: -${Math.floor(EDGE_SIZE / 2)}px;
        cursor: nwse-resize;
      }

      .${SCRIPT_CLASS} .bvr-nw::after {
        top: 7px;
        left: 7px;
        border-width: 2px 0 0 2px;
        border-radius: 5px 0 0 0;
      }

      .${SCRIPT_CLASS} .bvr-se {
        right: -${Math.floor(EDGE_SIZE / 2)}px;
        bottom: -${Math.floor(EDGE_SIZE / 2)}px;
        cursor: nwse-resize;
      }

      .${SCRIPT_CLASS} .bvr-se::after {
        right: 7px;
        bottom: 7px;
        border-width: 0 2px 2px 0;
        border-radius: 0 0 5px 0;
      }

      .${SCRIPT_CLASS} .bvr-sw {
        left: -${Math.floor(EDGE_SIZE / 2)}px;
        bottom: -${Math.floor(EDGE_SIZE / 2)}px;
        cursor: nesw-resize;
      }

      .${SCRIPT_CLASS} .bvr-sw::after {
        left: 7px;
        bottom: 7px;
        border-width: 0 0 2px 2px;
        border-radius: 0 0 0 5px;
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
        cursor: var(--bvr-cursor, default) !important;
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
