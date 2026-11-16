const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const pageErrors = [];

async function instrument(page, pendingResume = false) {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(({ pendingResume }) => {
    const taps = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination === this.context.destination) {
        const tap = this.context.createAnalyser();
        tap.fftSize = 1024;
        connect.call(this, tap);
        taps.push(tap);
      }
      return result;
    };
    window.playbackRms = () => Math.max(0, ...taps.map(tap => {
      if (tap.context.state !== 'running') return 0;
      const samples = new Float32Array(tap.fftSize);
      tap.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    }));
    // Compatibility simulation: redundant resume() never settles on a running context.
    // This is a regression model, not an actual Safari engine test.
    if (pendingResume) {
      const Context = window.AudioContext || window.webkitAudioContext;
      const resume = Context.prototype.resume;
      Context.prototype.resume = function () {
        return this.state === 'running' ? new Promise(() => {}) : resume.call(this);
      };
    }
  }, { pendingResume });
}

async function audible(page, button) {
  await page.click('#' + button);
  await page.waitForFunction(() => window.playbackRms() > 0.0001, null, { timeout: 4000 });
  const mode = button.endsWith('1') || button === 'audioPlay' ? 'basic' :
    button.endsWith('3') || button === 'vizPlayHold' ? 'held' : 'progression';
  assert.ok(await page.evaluate(mode => mode === 'basic' ? audioPlaying :
    !!pPlaySession && pPlaySession.hold === (mode === 'held'), mode));
}

async function stopped(page, button = 'audioStop') {
  await page.click('#' + button);
  await page.waitForFunction(() => !audioPlaying && !pPlaySession && window.playbackRms() < 0.0001,
    null, { timeout: 4000 });
}

(async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') return response.writeHead(204).end();
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const pendingResume of [false, true]) {
      for (const button of ['audioPlay', 'pPlay', 'vizPlayHold']) {
        const page = await browser.newPage();
        await instrument(page, pendingResume);
        await page.goto(url);
        await audible(page, button);
        await stopped(page);
        await page.close();
        console.log(`PASS: cold ${button}, audible output and stop${pendingResume ? ' (pending-resume simulation)' : ''}`);
      }
    }

    const recovery = await browser.newPage();
    await instrument(recovery);
    await recovery.goto(url);
    await audible(recovery, 'audioPlay');
    await recovery.evaluate(() => audioContext.close());
    await audible(recovery, 'pPlay');
    await stopped(recovery);
    await recovery.close();
    console.log('PASS: progression recovers from a closed audio context after basic playback');

    for (const button of ['pPlay', 'vizPlayHold']) {
      const page = await browser.newPage();
      await instrument(page);
      await page.goto(url);
      await page.evaluate(async () => {
        audioContext = new AudioContext();
        await audioContext.suspend();
        const resume = audioContext.resume.bind(audioContext);
        audioContext.resume = () => new Promise((resolve, reject) => {
          window.finishDeferredResume = () => resume().then(resolve, reject);
        });
      });
      await page.click('#' + button);
      await page.waitForFunction(() => typeof window.finishDeferredResume === 'function');
      assert.equal(await page.evaluate(() => audioContext.state), 'suspended');
      await page.click('#audioStop');
      await page.evaluate(() => window.finishDeferredResume());
      assert.ok(await page.evaluate(() => audioContext.state === 'running' &&
        !pPlaySession && !audioPlaying && window.playbackRms() === 0));
      await page.close();
      console.log(`PASS: Stop cancels ${button} while audio resume is deferred`);
    }

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await instrument(mobile, true);
    await mobile.goto(url);
    for (const button of ['mobilePlay2', 'mobilePlay3']) {
      await audible(mobile, button);
      await stopped(mobile, 'mobileStop');
    }
    await mobile.close();
    assert.deepEqual(pageErrors, [], 'No browser JavaScript errors');
    console.log('PASS: mobile progression/selected chord toolbar, audible output and stop (simulation)');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); if (pageErrors.length) console.error(pageErrors); process.exitCode = 1; });
