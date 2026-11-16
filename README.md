# harmonic-analyzer
Harmonic Analyzer development

## Playback regression checks

In the prepared cloud environment, run `node tests/playback-smoke.cjs`.
The checks use Node.js, Playwright, and `/usr/bin/chromium`; no application server needs to be started separately.
They verify audio signals and stopping for all playback modes, closed-context recovery, and the mobile toolbar.
The pending-resume compatibility check simulates a browser condition; it does not replace testing on iPhone/iPad Safari.
