const SALSA_WINDOW_EIGHTS = 16;

export function adjustSalsaSegments(segments, totalEighth) {
  if (!Array.isArray(segments) || !segments.length) return { segments, totalEighth };

  const adjusted = segments.map((s) => ({ ...s }));

  for (let i = 0; i < adjusted.length; i++) {
    const seg = adjusted[i];
    if (seg.startEighth <= 0) continue;

    const inWindow = seg.startEighth % SALSA_WINDOW_EIGHTS;
    const shift = inWindow === 0 ? 2 : 1;
    seg.startEighth = Math.max(0, seg.startEighth - shift);

    if (i > 0 && seg.startEighth <= adjusted[i - 1].startEighth) {
      seg.startEighth = adjusted[i - 1].startEighth + 1;
    }
  }

  for (let i = 0; i < adjusted.length - 1; i++) {
    adjusted[i].durEighth = adjusted[i + 1].startEighth - adjusted[i].startEighth;
  }
  adjusted[adjusted.length - 1].durEighth = totalEighth - adjusted[adjusted.length - 1].startEighth;

  return { segments: adjusted, totalEighth };
}

export function prepareSalsaReference(ref) {
  if (!ref) return ref;
  if (ref.windowsPerFile !== 4) {
    throw new Error("Los MIDIs de Salsa 2-3 deben tener exactamente 64 corcheas (4 ventanas).");
  }
  if (ref.salsaReady) return ref;

  const events = Array.isArray(ref.events) ? ref.events.slice() : [];
  const winTicks = ref.winTicks;
  const totalWindows = ref.windowsPerFile;

  const pushDummy = (tickOn, tickOff) => {
    const on = { tick: tickOn, status: 0x90, d1: 0, d2: 0 };
    const off = { tick: tickOff, status: 0x80, d1: 0, d2: 0 };
    events.push(on, off);
  };

  for (let w = 0; w < totalWindows; w++) {
    const startTick = w * winTicks;
    const endTick = startTick + winTicks;
    const windowEvents = events.filter((e) => e.tick >= startTick && e.tick < endTick);

    const earliest = windowEvents.length ? Math.min(...windowEvents.map((e) => e.tick)) : Infinity;
    const latest = windowEvents.length ? Math.max(...windowEvents.map((e) => e.tick)) : -Infinity;

    if (windowEvents.length === 0) {
      pushDummy(startTick, endTick);
      continue;
    }

    if (earliest > startTick) {
      pushDummy(startTick, Math.min(earliest, endTick));
    }

    if (latest < endTick) {
      pushDummy(Math.max(latest, startTick), endTick);
    }
  }

  events.sort((a, b) => (a.tick - b.tick) || (((a.status ?? 0) & 0xF0) - ((b.status ?? 0) & 0xF0)));

  return { ...ref, events, salsaReady: true };
}

if (typeof window !== "undefined") {
  window.SalsaUtils = { adjustSalsaSegments, prepareSalsaReference };
}
