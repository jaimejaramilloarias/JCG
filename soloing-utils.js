export function prepareSoloingReference(ref) {
  if (!ref?.soloing) return ref;
  if (ref.soloingReady) return ref;

  const events = Array.isArray(ref.events) ? ref.events.slice() : [];
  const winTicks = ref.winTicks;
  const tickPerEighth = ref.tickPerEighth;
  const totalWindows = ref.windowsPerFile;
  const anchors = Array.from({ length: totalWindows || 0 }, () => ({ first: null, firstTick: null, last: null, lastTick: null }));

  const pushDummy = (tickOn, tickOff) => {
    const on = { tick: tickOn, status: 0x90, d1: 0, d2: 0 };
    const off = { tick: tickOff, status: 0x80, d1: 0, d2: 0 };
    events.push(on, off);
  };

  for (let w = 0; w < totalWindows; w++) {
    const startTick = w * winTicks;
    const endTick = startTick + winTicks;

    const windowEvents = events.filter((e) => e.tick >= startTick && e.tick < endTick);
    const noteOns = windowEvents.filter((e) => ((e.status ?? 0) & 0xF0) === 0x90 && ((e.d2 ?? 0) & 0x7F) > 0);

    const hasFirstEighth = noteOns.some((e) => e.tick < startTick + tickPerEighth);
    if (!hasFirstEighth) {
      pushDummy(startTick, startTick + tickPerEighth);
    }

    const hasLastEighth = noteOns.some((e) => e.tick >= endTick - tickPerEighth && e.tick <= endTick);
    if (!hasLastEighth) {
      pushDummy(endTick - tickPerEighth, endTick);
    }
  }

  events.sort((a, b) => (a.tick - b.tick) || (((a.status ?? 0) & 0xF0) - ((b.status ?? 0) & 0xF0)));

  for (const e of events) {
    const status = (e.status ?? 0) & 0xF0;
    const vel = (e.d2 ?? 0) & 0x7F;
    if (status !== 0x90 || vel <= 0) continue;

    const win = Math.floor((e.tick ?? 0) / winTicks);
    if (win < 0 || win >= totalWindows) continue;
    const note = (e.d1 ?? 0) & 0x7F;
    const anchor = anchors[win];

    if (anchor.firstTick == null || e.tick < anchor.firstTick) {
      anchor.firstTick = e.tick;
      anchor.first = note;
    }
    if (anchor.lastTick == null || e.tick >= anchor.lastTick) {
      anchor.lastTick = e.tick;
      anchor.last = note;
    }
  }

  const soloingWindowAnchors = anchors.map(({ first, last }) => ({ first, last }));

  return { ...ref, events, soloingWindowAnchors, soloingReady: true };
}

export function adjustSoloingWindowTranspose(prevNote, nextFirstNote, baseTranspose = 0) {
  if (!Number.isFinite(prevNote) || !Number.isFinite(nextFirstNote)) return baseTranspose;

  const target = nextFirstNote + baseTranspose;
  const interval = target - prevNote;
  if (Math.abs(interval) <= 12) return baseTranspose;

  const down = target - 12;
  const up = target + 12;
  const downGap = Math.abs(down - prevNote);
  const upGap = Math.abs(up - prevNote);

  return baseTranspose + (downGap <= upGap ? -12 : 12);
}

(function(){
  if (typeof window !== "undefined") {
    window.SoloingUtils = { prepareSoloingReference, adjustSoloingWindowTranspose };
  }
})();
