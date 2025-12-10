const pickDefault = (_, candidates) => (candidates && candidates.length ? candidates[0] : null);
const randDefault = (max) => Math.floor(Math.random() * max);
const firstNoteDefault = () => Infinity;

export function selectSoloingX32Window(ref, seg, qualityKey, helpers={}) {
  const randInt = helpers.randInt ?? randDefault;
  const pickWindowWithHistory = helpers.pickWindowWithHistory ?? pickDefault;
  const firstNoteOnFrom = helpers.firstNoteOnFrom ?? firstNoteDefault;

  if (!ref || !seg) return { windowStartEighth: 0, windowIndex: 0, startEighthForWindow: 0 };

  const tickPerEighth = ref.tickPerEighth ?? 0;
  const barsPerFile = ref.barsPerFile ?? 0;
  const totalWindows = Math.max(1, ref.windowsPerFile ?? 1);
  const winEights = ref.winEights ?? 32;
  const maxStartBar = Math.max(0, Math.floor(barsPerFile - 4));
  const segStartEighth = seg.startEighth ?? 0;

  const wrapWindow = (segBar) => {
    const windowIndex = ((segBar % totalWindows) + totalWindows) % totalWindows;
    return { windowStartEighth: windowIndex * winEights, windowIndex, startEighthForWindow: segBar * 8 };
  };

  if (!Number.isFinite(barsPerFile) || !Number.isFinite(segStartEighth) || winEights <= 0) {
    const segBar = Math.floor(segStartEighth / 8) || 0;
    return wrapWindow(segBar);
  }

  let effectiveStartEighth = segStartEighth;

  if (segStartEighth > maxStartBar * 8) {
    const loop = maxStartBar + 1;
    const loopEighths = loop * 8;
    if (loopEighths > 0) {
      const offset = randInt(loopEighths);
      effectiveStartEighth = (segStartEighth + offset) % loopEighths;
    }
  }

  let segBar = Math.floor(effectiveStartEighth / 8);
  const minBar = Math.max(0, segBar - 3);
  const validStartBarMax = Math.min(maxStartBar, segBar);

  if (minBar > validStartBarMax) {
    return wrapWindow(segBar);
  }

  const candidates = [];
  for (let bar = minBar; bar <= validStartBarMax; bar++) {
    const startEighth = bar * 8;
    const windowOffsetEighths = effectiveStartEighth - startEighth;
    if (windowOffsetEighths < 0 || windowOffsetEighths >= winEights) continue;

    const windowStartTick = startEighth * tickPerEighth;
    const windowOffsetTicks = windowOffsetEighths * tickPerEighth;
    const remainingWindowTicks = (ref.winTicks ?? 0) - windowOffsetTicks;
    const effectiveSpan = Math.min((seg.durEighth ?? 0) * tickPerEighth, remainingWindowTicks);
    const noteHorizon = firstNoteOnFrom(ref, windowStartTick);
    const withinSpan = noteHorizon < (windowOffsetTicks + effectiveSpan);

    candidates.push({
      id: `bar-${bar}`,
      windowStartEighth: startEighth,
      windowIndex: Math.floor(startEighth / winEights),
      score: withinSpan ? 1 : 0,
      startEighthForWindow: effectiveStartEighth,
    });
  }

  const viable = candidates.filter((c) => c.score > 0);
  const pick = pickWindowWithHistory(`${qualityKey || "?"}_${ref.variant || "x32"}`, viable.length ? viable : candidates);

  if (pick) return pick;

  return wrapWindow(segBar);
}

(function(){
  if (typeof window !== "undefined") {
    window.SoloingWindowSelector = { selectSoloingX32Window };
  }
})();
