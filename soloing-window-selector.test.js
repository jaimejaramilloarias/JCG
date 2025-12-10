import test from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { selectSoloingX32Window } from './soloing-window-selector.js';

const helpers = {
  randInt: () => 0,
  firstNoteOnFrom: () => 0,
  pickWindowWithHistory: (_key, candidates) => candidates?.[0] ?? null,
};

const baseRef = {
  tickPerEighth: 480,
  barsPerFile: 32,
  windowsPerFile: 8,
  winEights: 32,
  winTicks: 32 * 480,
  variant: 'x32',
};

test('selectSoloingX32Window keeps offsets within a single window when wrapping', () => {
  const seg = { startEighth: 8 * 48, durEighth: 32, quality: 'maj7' }; // beyond 32 bars
  const result = selectSoloingX32Window(baseRef, seg, seg.quality, helpers);

  ok(result, 'returns a selection');
  ok(result.windowStartEighth >= 0, 'has a valid window start');
  ok(result.windowStartEighth < baseRef.winEights * baseRef.windowsPerFile, 'window start stays within reference length');

  const offset = (result.startEighthForWindow ?? seg.startEighth) - result.windowStartEighth;
  ok(offset >= 0, 'offset is non-negative');
  ok(offset < baseRef.winEights, 'offset stays inside the selected window');
});

test('selectSoloingX32Window does not wrap when progression fits in reference', () => {
  const seg = { startEighth: 16, durEighth: 16, quality: 'm7' }; // within first bars
  const result = selectSoloingX32Window(baseRef, seg, seg.quality, helpers);

  strictEqual(result.startEighthForWindow, seg.startEighth, 'keeps original start when no wrap is needed');
  strictEqual(result.windowStartEighth, 0, 'chooses the first window given deterministic helpers');
});
