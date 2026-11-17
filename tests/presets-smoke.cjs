const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const expected = {
  cadence: [
    'E4 E4 F4 F4 E4', 'C4 C4 C4 B3 C4',
    'G3 B♭3 A3 G3 G3', 'C3 G3 F3 D3 C3'
  ],
  sample2: [
    'C4 D4 E4 E4 F4 G4 F4 F4 E4',
    'C4 C4 C4 C4 C4 C4 C4 B3 C4',
    'C4 B3 A3 B♭3 A3 G3 A3 G3 G3',
    'C4 B3 A3 G3 F3 E3 D3 D3 C3'
  ],
  sample3: [
    'C3 D3 E3 F3 G3 A3 B3 C4 D4 E4',
    'C3 D3 E3 F3 G3 A3 B3 C4 C4 C4',
    'C3 D3 E3 F3 G3 G3 G3 G3 A♭3 G3',
    'C3 C3 C3 C3 C3 C3 C3 C3 F3 C3'
  ]
};

(async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => setTab('progress'));
    assert.deepEqual(await page.locator('#pPreset option').allTextContents(),
      ['— プリセットを選択 —', 'サンプル１', 'サンプル2', 'サンプル3']);
    assert.deepEqual(await page.evaluate(() => Object.keys(pPresetLibrary)), Object.keys(expected));
    for (const [code, voices] of Object.entries(expected)) {
      await page.selectOption('#pPreset', code);
      if (code === 'sample2') assert.equal(await page.evaluate(() => pChords.length), 9, 'sample2 has exactly nine chords');
      const actual = await page.evaluate(() => [0, 1, 2, 3].map(i =>
        pChords.map(chord => chord[i] ? chord[i].name + chord[i].oct : 'rest').join(' ')));
      assert.deepEqual(actual, voices, code + ': exact voice order, notes and octaves');
      const displayed = await page.locator('#pGrid tbody tr').evaluateAll(rows => rows.map(row =>
        [...row.querySelectorAll('.pnote-pickers')].map(pickers => {
          const value = kind => pickers.querySelector(`[data-kind="${kind}"]`).value;
          return value('letter') + value('acc') + value('oct');
        }).join(' ')));
      assert.deepEqual(displayed, voices, code + ': displayed note pickers match the requested pitches');
      assert.ok((await page.locator('#pPresetStatus').textContent()).includes(`${voices[0].split(' ').length}和音`));
      assert.equal(await page.locator('#pGrid td select[data-kind="letter"]').count(), voices[0].split(' ').length * 4);
      console.log(`PASS: ${code}, exact four-part pitches and rendered chord count`);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
