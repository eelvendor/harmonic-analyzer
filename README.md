# Harmony Visualizer
Harmony Visualizer development

## Playback regression checks

In the prepared cloud environment, run `node tests/playback-smoke.cjs`.
The checks use Node.js, Playwright, and `/usr/bin/chromium`; no application server needs to be started separately.
They verify audio signals and stopping for all playback modes, closed-context recovery, and the mobile toolbar.
The startup compatibility checks simulate delayed/resolving audio states, output-route activation, cancellation, and timeout conditions; they do not replace testing on iPhone/iPad Safari.

## UI, preset and runtime regression checks

Run `node tests/ui-smoke.cjs`, `node tests/presets-smoke.cjs`, and
`node tests/runtime-regressions.cjs` in addition to the playback checks.
The runtime checks verify vowel waveform updates after pitch changes, retired
output cleanup, per-note harmonic references from Basic Settings or the playing
progression, hidden-view and offscreen-card skipping, and static-canvas resizing.
Visualization reference candidates use the harmonic-order setting in the Harmonics tab.
