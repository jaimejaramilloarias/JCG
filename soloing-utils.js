export function prepareSoloingReference(ref) {
  if (!ref?.soloing) return ref;
  if (ref.soloingReady) return ref;

  const events = Array.isArray(ref.events) ? ref.events.slice() : [];
  const winTicks = ref.winTicks;
  const tickPerEighth = ref.tickPerEighth;
  const totalWindows = ref.windowsPerFile;
  const anchors = Array.from({ length: totalWindows || 0 }, () => ({
    first: null,
    firstTick: null,
    last: null,
    lastTick: null,
    firstOff: null,
    firstOffTick: null,
    lastOff: null,
    lastOffTick: null,
  }));

  const pushDummy = (tickOn, tickOff) => {
    const on = { tick: tickOn, status: 0x90, d1: 0, d2: 0, dummy: true };
    const off = { tick: tickOff, status: 0x80, d1: 0, d2: 0, dummy: true };
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
    const win = Math.floor((e.tick ?? 0) / winTicks);
    if (win < 0 || win >= totalWindows) continue;
    const note = (e.d1 ?? 0) & 0x7F;

    if (e.dummy) continue;

    const windows = [win];
    if (status === 0x80 && win > 0 && (e.tick % winTicks) === 0) {
      windows.push(win - 1);
    }

    for (const w of windows) {
      const anchor = anchors[w];
      if (!anchor) continue;

      if (status === 0x90) {
        const vel = (e.d2 ?? 0) & 0x7F;
        if (vel <= 0) continue;

        if (anchor.firstTick == null || e.tick < anchor.firstTick) {
          anchor.firstTick = e.tick;
          anchor.first = note;
        }
        if (anchor.lastTick == null || e.tick >= anchor.lastTick) {
          anchor.lastTick = e.tick;
          anchor.last = note;
        }
      } else if (status === 0x80) {
        if (anchor.firstOffTick == null || e.tick < anchor.firstOffTick) {
          anchor.firstOffTick = e.tick;
          anchor.firstOff = note;
        }
        if (anchor.lastOffTick == null || e.tick >= anchor.lastOffTick) {
          anchor.lastOffTick = e.tick;
          anchor.lastOff = note;
        }
      }
    }
  }

  const soloingWindowAnchors = anchors.map(({ first, last, firstOff, lastOff }) => ({
    first: first ?? firstOff,
    last: last ?? lastOff,
  }));

  return { ...ref, events, soloingWindowAnchors, soloingReady: true };
}

export function adjustSoloingWindowTranspose(prevNote, nextFirstNote, baseTranspose = 0) {
  if (!Number.isFinite(prevNote) || !Number.isFinite(nextFirstNote)) return baseTranspose;

  const limit = 11;
  let transpose = baseTranspose;
  let target = nextFirstNote + transpose;
  let interval = target - prevNote;

  while (interval > limit) {
    transpose -= 12;
    target -= 12;
    interval -= 12;
  }

  while (interval < -limit) {
    transpose += 12;
    target += 12;
    interval += 12;
  }

  return transpose;
}

(function(){
  if (typeof window !== "undefined") {
    window.SoloingUtils = { prepareSoloingReference, adjustSoloingWindowTranspose };
  }
})();
