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
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.addInitScript(() => {
      window.outputConnections = new Set();
      const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
      AudioNode.prototype.connect = function (to, ...args) {
        if (to === this.context.destination) window.outputConnections.add(this);
        return connect.call(this, to, ...args);
      };
      AudioNode.prototype.disconnect = function (...args) {
        window.outputConnections.delete(this);
        return disconnect.apply(this, args);
      };
      const waves = new WeakMap(), create = AudioContext.prototype.createPeriodicWave;
      AudioContext.prototype.createPeriodicWave = function (real, imag, options) {
        const wave = create.call(this, real, imag, options);
        waves.set(wave, Array.from(imag));
        return wave;
      };
      const set = OscillatorNode.prototype.setPeriodicWave;
      OscillatorNode.prototype.setPeriodicWave = function (wave) {
        this.testCoefficients = waves.get(wave);
        return set.call(this, wave);
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.mixer-source').first().selectOption('i');
    await page.click('#audioPlay');
    await page.waitForFunction(() => audioPlaying);
    const before = await page.evaluate(() => audioVoices.get(selected[0].id).source.osc.testCoefficients);
    await page.evaluate(() => {
      const oct = document.querySelector('#pitchrows select[aria-label$="のオクターブ"]');
      oct.value = '5'; oct.dispatchEvent(new Event('change'));
    });
    const after = await page.evaluate(() => {
      const n = selected[0], actual = audioVoices.get(n.id).source.osc;
      const reference = createVoiceOscillator(audioContext, frequency(n), n.voice, n.id);
      return { actual: actual.testCoefficients, expected: reference.testCoefficients };
    });
    assert.notDeepEqual(after.actual, before);
    assert.deepEqual(after.actual, after.expected, 'pitch update matches a fresh vowel generator at the new pitch');
    await page.evaluate(() => $('addnote').click());
    assert.equal(await page.evaluate(() => audioVoices.size), 5, 'added notes join basic playback');
    await page.evaluate(() => document.querySelector('#pitchrows .pitchrow:last-child button').click());
    assert.equal(await page.evaluate(() => audioVoices.size), 4, 'removed notes leave basic playback');
    await page.click('#audioStop');
    await page.click('#vizPlayHold');
    await page.waitForFunction(() => !!pPlaySession);
    await page.evaluate(() => { for (let i = 0; i < 6; i++) refreshPlayingTimbres(); });
    await page.waitForFunction(() => window.outputConnections.size === 2);
    await page.click('#audioStop');
    await page.waitForFunction(() => window.outputConnections.size === 1 && mixerGainNodes.size === 0);
    console.log('PASS: vowel pitch coefficients and output cleanup after six session replacements');

    await page.evaluate(() => {
      $('addnote').click();
      const extra = selected.at(-1); mixerTrack(extra).source = 'i';
      setTab('visual'); vizPaused = true;
      window.testCard = vizAdd('fourier');

    });
    const card = page.locator('.viz-fourier-card').first();
    await card.scrollIntoViewIfNeeded();
    await card.locator('.viz-source').selectOption('basic');
    const counts = await page.evaluate(() => {
      const extra = selected.at(-1), info = vizReferenceInfo(testCard, vizAvailable());
      testCard.fourierVoice = `n${extra.id}:h1`;
      vizDraw(testCard, vizAvailable());
      return { notes: selected.length, candidates: info.values.length, max: Number($('harmMax').value),
        foot: testCard.element.querySelector('.viz-foot').textContent };
    });
    assert.equal(counts.candidates, counts.notes * counts.max);
    assert.ok(!counts.foot.includes('有効円1個'), 'second Lead uses its own vowel timbre');
    assert.match(counts.foot, /構成音5/);
    await page.evaluate(() => {
      testCard.fourierVoice = `n${selected.at(-1).id}:h3`;
      vizDraw(testCard, vizAvailable());
    });
    assert.match(await card.locator('.viz-foot').textContent(), /第3倍音.*有効円1個/);
    assert.equal(await card.locator('.viz-fourier-count').isDisabled(), true);
    console.log('PASS: all basic notes and harmonics selectable, duplicate voice IDs remain distinct');

    // Different progression chords must drive the same harmonic key at new frequencies.
    await card.locator('.viz-source').selectOption('progression');
    await card.locator('.viz-fourier-voice').selectOption('p0:h2');
    assert.equal(await card.locator('.viz-fourier-count').isDisabled(), true);
    const following = await page.evaluate(() => {
      pLoadPreset('sample2'); testCard.referenceSource = 'progression'; testCard.fourierVoice = 'p0:h2';
      const first = vizReferenceInfo(testCard, vizAvailable()).values.find(v => v.key === 'p0:h2').f;
      pSelected = 1;
      const second = vizReferenceInfo(testCard, vizAvailable()).values.find(v => v.key === 'p0:h2').f;
      return { first, second, key: testCard.fourierVoice };
    });
    assert.notEqual(following.first, following.second);
    await page.evaluate(() => {
      testCard.referenceSource = 'progression'; pSelected = 0;
      $('pBpm').value = '240'; $('pBeats').selectedIndex = 0;
    });
    await page.click('#pPlay');
    await page.waitForFunction(() => !!pPlaySession);
    await page.waitForFunction(() => vizReferenceInfo(testCard, vizAvailable()).source.endsWith('和音 2'), null, { timeout: 5000 });
    await page.click('#audioStop');
    console.log('PASS: progression harmonic references follow selected and playing chords');

    const hidden = await page.evaluate(() => {
      let harmonic = 0, difference = 0, scores = 0;
      const a = drawSpectrum, b = drawDifferenceSpectrum, c = pScoreRender;
      drawSpectrum = (...args) => { harmonic++; return a(...args); };
      drawDifferenceSpectrum = (...args) => { difference++; return b(...args); };
      pScoreRender = (...args) => { scores++; return c(...args); };
      setTab('harm'); const first = { harmonic, difference };
      setTab('diff'); const second = { harmonic, difference };
      setTab('visual'); pRender();
      return { first, second, scores };
    });
    assert.deepEqual(hidden, { first: { harmonic: 1, difference: 0 }, second: { harmonic: 1, difference: 1 }, scores: 0 });
    console.log('PASS: hidden spectrum and progression views skip calculation/rendering');

    await page.evaluate(() => {
      testCard.referenceSource = 'basic'; testCard.localAnimate = false;
      testCard._lastStaticKey = null;
      for (let i = 0; i < 3; i++) vizAdd('fourier');
      window.cardDraws = new Map(); const draw = vizDraw;
      vizDraw = function (card, info) {
        cardDraws.set(card.id, (cardDraws.get(card.id) || 0) + 1);
        return draw(card, info);
      };
      vizPaused = false;
    });
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!testCard._lastStaticKey);
    await page.waitForTimeout(100); // Let queued control repaints settle before measuring steady state.
    await page.evaluate(() => cardDraws.clear());
    const baseline = 0;
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => cardDraws.get(testCard.id) || 0), baseline, 'static Fourier is not redrawn while unchanged');
    assert.equal(await page.evaluate(() => vizCards.filter(c => !vizCardVisible(c)).every(c => !cardDraws.has(c.id))), true);
    await page.setViewportSize({ width: 320, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const canvas = testCard.element.querySelector('canvas');
      return canvas.width === Math.round(canvas.getBoundingClientRect().width * Math.min(devicePixelRatio, 2));
    });
    assert.ok(await page.evaluate(old => cardDraws.get(testCard.id) > old, baseline), 'resize invalidates static drawing');
    console.log('PASS: offscreen skipping, static drawing reuse and resize invalidation');
    await page.evaluate(() => { vizPaused = true; });
    for (const type of ['liss', 'harm', 'rose', 'spiro', 'lorenz', 'chladni']) {
      const result = await page.evaluate(type => {
        const card = vizAdd(type); card.referenceSource = card.lorenzSource = 'basic';
        card.lorenzVoices = 'one';
        const n = selected.at(-1), key = `n${n.id}:h3`;
        card.x = key; card.y = `n${n.id}:h2`; card.lorenzVoice = key;
        vizRefreshVoiceOptions(card); if (type === 'lorenz') vizRefreshLorenzVoiceOptions(card);
        card.element.scrollIntoView(); vizDraw(card, vizAvailable());
        return { foot: card.element.querySelector('.viz-foot').textContent,
          selected: card.x, lorenz: card.lorenzVoice, key };
      }, type);
      assert.equal(result.selected, result.key, `${type}: selected harmonic survives option refresh`);
      if (type === 'lorenz') assert.equal(result.lorenz, result.key);
      assert.ok(!result.foot.includes('描画エラー'), `${type}: valid rendering at phone width`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: all six other visualization types accept basic-note harmonic references at phone width');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
