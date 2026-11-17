const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      assert.equal(await page.locator('.f1f2-caption, #harmAnalysisStatus, #diffAnalysisStatus, #diffZoomIn, #diffZoomOut, #diffZoomReset, #diffZoomLabel').count(), 0);
      // Inspect hidden controls too: defaults must exist before their first paint.
      for (const tab of ['tuning', 'harm', 'diff', 'wave', 'progress', 'modes', 'visual']) {
        await page.evaluate(tab => setTab(tab), tab);
        const missing = await page.locator('select').evaluateAll(selects => selects
          .filter(select => select.selectedIndex < 0)
          .map(select => select.id || select.className));
        assert.deepEqual(missing, [], `${width}px ${tab}: dropdown defaults`);
      }
      assert.equal(await page.locator('#pitch').inputValue(), '440');
      assert.equal(await page.locator('#harmMax').inputValue(), '10');
      assert.equal(await page.locator('#harmRange').inputValue(), '4000');
      assert.equal(await page.locator('#harmTolerance').inputValue(), '2');
      await page.evaluate(() => {
        setTab('harm');
        $('harmRange').value = '8000';
        $('harmRange').dispatchEvent(new Event('change'));
        setTab('diff');
        setTab('harm');
      });
      assert.equal(await page.locator('#harmRange').inputValue(), '8000', 'tab changes preserve the user selection');

      await page.evaluate(() => { setTab('diff'); $('diffChart').scrollIntoView(); });
      const chart = await page.locator('#diffChart').boundingBox();
      const session = await page.context().newCDPSession(page);
      const touch = (x, id) => ({ x: chart.x + chart.width * x, y: chart.y + chart.height / 2, id });
      const initial = await page.evaluate(() => diffZoom);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(.4, 1), touch(.6, 2)] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(.2, 1), touch(.8, 2)] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(await page.evaluate(initial => diffZoom > initial, initial), 'difference spectrum still zooms with pinch');

      await page.evaluate(() => {
        setTab('visual');
        vizPaused = true;
        vizAdd('fourier');
      });
      const canvas = page.locator('.viz-fourier-card canvas');
      await canvas.scrollIntoViewIfNeeded();
      await page.evaluate(() => vizDraw(vizCards.find(card => card.type === 'fourier'), vizAvailable()));
      assert.equal(await page.locator('.viz-fourier-view').count(), 0);
      const before = await canvas.evaluate(el => el.toDataURL());
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7);
      await page.mouse.up();
      await canvas.dispatchEvent('wheel', { deltaY: -100 });
      await canvas.dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 100, clientY: 100 });
      await canvas.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', clientX: 200, clientY: 100 });
      await canvas.dispatchEvent('pointermove', { pointerId: 12, pointerType: 'touch', clientX: 300, clientY: 100 });
      await page.evaluate(() => vizDraw(vizCards.find(card => card.type === 'fourier'), vizAvailable()));
      assert.equal(await canvas.evaluate(el => el.toDataURL()), before, 'Fourier plot stays fixed after drag, wheel and pinch');
      assert.deepEqual(errors, []);
      console.log(`PASS: ${width}px captions/controls removed, all tab defaults, retained selections, difference pinch, fixed Fourier plot`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
