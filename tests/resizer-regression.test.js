const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const scriptPath = path.resolve(__dirname, '..', 'bilibili-video-resizer.user.js');

async function mount(page, { preview = false, width = 1280, height = 720 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto('about:blank');

  const previewHtml = preview ? '<div class="preview"><video></video></div>' : '';
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; padding: 32px; background: #f6f7f8; font-family: system-ui, sans-serif; }
    .preview { width: 160px; height: 90px; margin-bottom: 18px; background: #111; }
    .preview video { display: block; width: 160px; height: 90px; background: #333; }
    .video-container-v1 { display: flex; gap: 24px; align-items: flex-start; }
    .left-container { width: 720px; background: #fff; }
    #playerWrap, #bilibili-player, .main-player.bpx-player-container {
      width: 720px; height: 405px; background: #18191c;
    }
    .main-player.bpx-player-container { position: relative; }
    .main-player video { display: block; width: 100%; height: 100%; background: #222; }
    .right-container { width: 320px; height: 520px; background: #fff; }
  </style></head><body>${previewHtml}<main class="video-container-v1"><section class="left-container"><div id="playerWrap"><div id="bilibili-player"><div class="main-player bpx-player-container"><video></video></div></div></div></section><aside class="right-container"></aside></main></body></html>`);

  await page.evaluate(() => {
    window.__gmStore = {};
    window.GM_addStyle = (css) => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    };
    window.GM_getValue = (key, fallback) =>
      Object.prototype.hasOwnProperty.call(window.__gmStore, key) ? window.__gmStore[key] : fallback;
    window.GM_setValue = (key, value) => {
      window.__gmStore[key] = value;
    };
  });

  await page.addScriptTag({ path: scriptPath });
  await page.waitForFunction(() => document.querySelectorAll('.main-player .bvr-handle').length === 8);
}

async function dims(page) {
  return page.evaluate(() => ({
    left: Math.round(document.querySelector('.left-container').getBoundingClientRect().width),
    wrap: Math.round(document.querySelector('#playerWrap').getBoundingClientRect().width),
    player: Math.round(document.querySelector('.main-player').getBoundingClientRect().width),
    height: Math.round(document.querySelector('.main-player').getBoundingClientRect().height),
    mainHandles: document.querySelectorAll('.main-player .bvr-handle').length,
    previewHandles: document.querySelectorAll('.preview .bvr-handle').length,
  }));
}

async function dragRightEdge(page, selector, dx, options = {}) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} must have a bounding box`);

  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + dx, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(280);
}

async function dragBottomEdge(page, selector, dy) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} must have a bounding box`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(280);
}

async function doubleClickReset(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} must have a bounding box`);

  await page.mouse.click(box.x + box.width - 5, box.y + box.height - 5, { clickCount: 2 });
  await page.waitForTimeout(220);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await mount(page, { preview: true });
    const beforeHorizontal = await dims(page);
    assert.equal(beforeHorizontal.mainHandles, 8);
    assert.equal(beforeHorizontal.previewHandles, 0);

    await dragRightEdge(page, '.main-player', 160);
    const afterHorizontal = await dims(page);
    assert.ok(afterHorizontal.left > beforeHorizontal.left + 100);
    assert.equal(afterHorizontal.wrap, afterHorizontal.player);
    assert.equal(afterHorizontal.left, afterHorizontal.player);
    assert.equal(afterHorizontal.height, 405);

    await mount(page);
    await dragBottomEdge(page, '.main-player', 100);
    const afterVertical = await dims(page);
    assert.equal(afterVertical.left, 720);
    assert.equal(afterVertical.player, 720);
    assert.ok(afterVertical.height > 480);

    await mount(page);
    await dragRightEdge(page, '.main-player', 160, { shift: true });
    const afterShift = await dims(page);
    const ratio = afterShift.player / afterShift.height;
    assert.ok(Math.abs(ratio - 16 / 9) < 0.03, `expected 16:9, got ${ratio}`);
    assert.ok(afterShift.height > 470);

    await doubleClickReset(page, '.main-player');
    const afterReset = await dims(page);
    assert.equal(afterReset.player, 720);
    assert.equal(afterReset.height, 405);

    console.log('resizer regression tests passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
