(function(){
function prepareSoloingReference(ref) {
  if (!ref?.soloing) return ref;
  if (ref.soloingReady) return ref;

  const events = Array.isArray(ref.events) ? ref.events.slice() : [];
  const winTicks = ref.winTicks;
  const tickPerEighth = ref.tickPerEighth;
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

  return { ...ref, events, soloingReady: true };
}

if (typeof window !== "undefined") {
  window.SoloingUtils = { prepareSoloingReference };
}
})();
