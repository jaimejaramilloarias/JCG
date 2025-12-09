function readU32(dv, o){ return dv.getUint32(o, false); }
function readU16(dv, o){ return dv.getUint16(o, false); }

function readVarLen(u8, i) {
  let value = 0;
  for (let k=0; k<4; k++){
    const b = u8[i++];
    value = (value << 7) | (b & 0x7F);
    if ((b & 0x80) === 0) return [value, i];
  }
  return [value, i];
}

function writeVarLen(n) {
  let buffer = n & 0x7F;
  const bytes = [];
  while ((n >>= 7) > 0) {
    buffer <<= 8;
    buffer |= ((n & 0x7F) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return Uint8Array.from(bytes);
}

function str4(u8, o) {
  return String.fromCharCode(u8[o],u8[o+1],u8[o+2],u8[o+3]);
}

function parseTrack(trackU8) {
  let i = 0;
  let absTick = 0;
  let runningStatus = null;
  let trackName = null;
  const events = [];

  while (i < trackU8.length) {
    let delta; [delta, i] = readVarLen(trackU8, i);
    absTick += delta;

    let status = trackU8[i++];

    if (status < 0x80) {
      if (runningStatus === null) throw new Error("Running status inválido.");
      i--;
      status = runningStatus;
    } else {
      runningStatus = status;
    }

    if (status === 0xFF) {
      const type = trackU8[i++];
      let mlen; [mlen, i] = readVarLen(trackU8, i);
      const meta = trackU8.slice(i, i+mlen);
      i += mlen;

      if (type === 0x03) {
        try { trackName = new TextDecoder().decode(meta).trim(); } catch(_){}
      }
      continue;
    }

    if (status === 0xF0 || status === 0xF7) {
      let slen; [slen, i] = readVarLen(trackU8, i);
      i += slen;
      runningStatus = null;
      continue;
    }

    const hi = status & 0xF0;
    let d1, d2;
    if (hi === 0xC0 || hi === 0xD0) {
      d1 = trackU8[i++]; d2 = null;
    } else {
      d1 = trackU8[i++]; d2 = trackU8[i++];
    }

    events.push({ tick: absTick, status, ch: status & 0x0F, d1, d2 });
  }

  return { name: trackName, events, endTick: absTick };
}

function parseMidi(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let i = 0;

  if (str4(u8,i) !== "MThd") throw new Error("No es un MIDI válido (falta MThd).");
  const hlen = readU32(dv, i+4);
  const format = readU16(dv, i+8);
  const ntrks = readU16(dv, i+10);
  const division = readU16(dv, i+12);
  if (division & 0x8000) throw new Error("SMPTE timecode no soportado.");
  const ppq = division;
  i += 8 + hlen;

  const tracks = [];
  for (let t=0; t<ntrks; t++){
    if (str4(u8,i) !== "MTrk") throw new Error("No es un MIDI válido (falta MTrk).");
    const len = readU32(dv, i+4);
    const start = i + 8;
    const end = start + len;
    const data = u8.slice(start, end);
    tracks.push(parseTrack(data));
    i = end;
  }

  return { format, ppq, tracks };
}

function buildMidiFile(ppq, channelEventsAbsTicks) {
  const trackBytes = [];

  const push = (arr) => { for (const b of arr) trackBytes.push(b); };
  const pushU8 = (b) => trackBytes.push(b & 0xFF);

  function pushMeta(delta, type, dataU8) {
    push(writeVarLen(delta));
    pushU8(0xFF);
    pushU8(type);
    push(writeVarLen(dataU8.length));
    push(dataU8);
  }
  function pushTrackName(name) {
    const data = new TextEncoder().encode(name);
    pushMeta(0, 0x03, data);
  }
  function pushTempo(bpm) {
    const mpqn = Math.round(60000000 / bpm);
    const data = Uint8Array.from([(mpqn>>16)&255, (mpqn>>8)&255, mpqn&255]);
    pushMeta(0, 0x51, data);
  }
  function pushTimeSig(nn, dd) {
    const denomPow = Math.log2(dd) | 0;
    const data = Uint8Array.from([nn&255, denomPow&255, 24, 8]);
    pushMeta(0, 0x58, data);
  }

  pushTrackName("generated");
  pushTempo(120);
  pushTimeSig(4,4);

  let running = null;
  let lastTick = 0;
  const evs = channelEventsAbsTicks.slice().sort((a,b)=> (a.tick - b.tick) || ((a.order ?? 0) - (b.order ?? 0)));
  for (const e of evs) {
    const delta = Math.max(0, (e.tick|0) - lastTick);
    lastTick = (e.tick|0);
    push(writeVarLen(delta));

    const status = e.status & 0xFF;
    const hi = status & 0xF0;

    if (running !== status) {
      pushU8(status);
      running = status;
    }

    pushU8(e.d1 & 0x7F);
    if (!(hi === 0xC0 || hi === 0xD0)) pushU8((e.d2 ?? 0) & 0x7F);
  }

  pushMeta(0, 0x2F, Uint8Array.from([]));

  const trackU8 = Uint8Array.from(trackBytes);
  const trackLen = trackU8.length;

  const header = new Uint8Array(14);
  header.set([0x4D,0x54,0x68,0x64]);
  header.set([0x00,0x00,0x00,0x06], 4);
  header.set([0x00,0x00], 8);
  header.set([0x00,0x01], 10);
  header[12] = (ppq >> 8) & 255;
  header[13] = ppq & 255;

  const trkh = new Uint8Array(8);
  trkh.set([0x4D,0x54,0x72,0x6B]);
  trkh[4] = (trackLen >>> 24) & 255;
  trkh[5] = (trackLen >>> 16) & 255;
  trkh[6] = (trackLen >>> 8) & 255;
  trkh[7] = trackLen & 255;

  const out = new Uint8Array(header.length + trkh.length + trackU8.length);
  out.set(header, 0);
  out.set(trkh, header.length);
  out.set(trackU8, header.length + trkh.length);
  return out;
}

function alignDerivedNoteOffs(events) {
  if (!events?.length) return events;

  const byOrigin = new Map();
  const isOn = (e) => {
    const hi = e.status & 0xF0;
    const vel = (e.d2 ?? 0) & 0x7F;
    return hi === 0x90 && vel > 0;
  };
  const isOff = (e) => {
    const hi = e.status & 0xF0;
    const vel = (e.d2 ?? 0) & 0x7F;
    return hi === 0x80 || (hi === 0x90 && vel === 0);
  };

  for (const e of events) {
    if (!e?.originId) continue;
    if (!isOn(e) && !isOff(e)) continue;
    if (!byOrigin.has(e.originId)) byOrigin.set(e.originId, { ons: [], offs: [] });
    const bucket = byOrigin.get(e.originId);
    if (isOn(e)) bucket.ons.push(e);
    if (isOff(e)) bucket.offs.push(e);
  }

  for (const { offs } of byOrigin.values()) {
    if (!offs?.length) continue;
    const canonical = offs.reduce((best, ev) => {
      if (!best) return ev;
      const bestOrder = typeof best.order === "number" ? best.order : 0;
      const evOrder = typeof ev.order === "number" ? ev.order : 0;
      if (evOrder < bestOrder) return ev;
      if (evOrder === bestOrder && ev.tick < best.tick) return ev;
      return best;
    }, null);

    const offTick = canonical?.tick;
    if (typeof offTick !== "number") continue;
    for (const offEv of offs) {
      offEv.tick = offTick;
    }
  }

  return events;
}

function sanitizeEvents(events) {
  const evs = alignDerivedNoteOffs(events.slice().sort((a,b)=> (a.tick-b.tick) || (a.order-b.order)));
  const active = new Map();
  const cleaned = [];

  const keyOf = (ch, note) => ch + "-" + note;
  const pushOff = (tick, ch, note, order) => cleaned.push({ tick, status: (0x80 | ch), d1: note, d2: 0, order });

  let lastTick = 0;

  for (const e of evs) {
    const status = e.status & 0xFF;
    const hi = status & 0xF0;
    const ch = status & 0x0F;
    const d1 = e.d1 & 0x7F;
    const d2 = (e.d2 ?? 0) & 0x7F;

    if (typeof e.tick === "number") lastTick = Math.max(lastTick, e.tick);

    if (hi === 0xB0 && (d1 === 120 || d1 === 123 || d1 === 121)) {
      active.clear();
      cleaned.push({ ...e, d1, d2 });
      continue;
    }

    if (hi === 0x90 && d2 > 0) {
      const k = keyOf(ch, d1);
      const prevCount = active.get(k) || 0;
      if (prevCount > 0) {
        const offOrder = (typeof e.order === "number") ? Math.max(0, e.order - 1) : 2;
        for (let i=0; i<prevCount; i++) pushOff(e.tick, ch, d1, offOrder);
      }
      active.set(k, 1);
      cleaned.push({ ...e, d1, d2 });
      continue;
    }

    if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
      const k = keyOf(ch, d1);
      const prevCount = active.get(k) || 0;
      if (prevCount > 0) {
        active.set(k, prevCount - 1);
      }
      cleaned.push({ ...e, d1, d2 });
      continue;
    }

    cleaned.push({ ...e, d1, d2 });
  }

  if (active.size) {
    const cleanupTick = lastTick + 1;
    for (const [key, count] of active.entries()) {
      if (count <= 0) continue;
      const [chStr, noteStr] = key.split("-");
      const ch = parseInt(chStr, 10);
      const note = parseInt(noteStr, 10);
      const safeCount = Math.max(1, count);
      for (let i=0; i<safeCount; i++) pushOff(cleanupTick, ch, note, 5);
    }
  }

  return cleaned;
}

function enforceMaxNoteLength(events, tickPerEighth, maxEighths=3) {
  if (!events?.length) return events;
  const maxDur = tickPerEighth * Math.max(1, maxEighths);
  const evs = events.slice().sort((a,b)=> (a.tick - b.tick) || ((a.order ?? 0) - (b.order ?? 0)));
  const active = new Map();
  const out = [];
  let lastTick = 0;

  const keyOf = (ch, note) => `${ch}-${note}`;
  const pushOff = (tick, ch, note, order=3) => {
    out.push({ tick, status: 0x80 | (ch & 0x0F), d1: note & 0x7F, d2: 0, order });
  };

  for (const e of evs) {
    const status = e.status & 0xFF;
    const hi = status & 0xF0;
    const ch = status & 0x0F;
    const note = e.d1 & 0x7F;
    const vel = (e.d2 ?? 0) & 0x7F;
    const order = e.order;

    if (typeof e.tick === "number") lastTick = Math.max(lastTick, e.tick);

    if (hi === 0x90 && vel > 0) {
      const entry = active.get(keyOf(ch, note)) || [];
      entry.push({ deadline: e.tick + maxDur, order });
      active.set(keyOf(ch, note), entry);
      out.push({ ...e, d1: note, d2: vel });
      continue;
    }

    if (hi === 0x80 || (hi === 0x90 && vel === 0)) {
      const key = keyOf(ch, note);
      const stack = active.get(key);
      if (stack?.length) {
        const state = stack.shift();
        if (!stack.length) active.delete(key);
        const offTick = Math.min(e.tick, state.deadline);
        lastTick = Math.max(lastTick, offTick);
        out.push({ ...e, tick: offTick, d1: note, d2: 0 });
      } else {
        out.push({ ...e, d1: note, d2: 0 });
      }
      continue;
    }

    out.push({ ...e, d1: note, d2: vel });
  }

  if (active.size) {
    for (const [key, stack] of active.entries()) {
      const [chStr, noteStr] = key.split("-");
      const ch = parseInt(chStr, 10) || 0;
      const note = parseInt(noteStr, 10) || 0;
      for (const state of stack) {
        const offTick = Math.max(lastTick, state.deadline);
        pushOff(offTick, ch, note, state.order ?? 3);
      }
    }
  }

  return out.sort((a,b)=> (a.tick - b.tick) || ((a.order ?? 0) - (b.order ?? 0)));
}

function dropLongNotesAndSustain(events, tickPerEighth, maxEighths=4) {
  if (!events?.length || !tickPerEighth) return events;

  const indexed = events.map((e, idx) => ({ ...e, _idx: idx }));
  const sorted = indexed.slice().sort((a,b)=> (a.tick - b.tick) || ((a.order ?? 0) - (b.order ?? 0)));

  const active = new Map();
  const toRemove = new Set();
  const durations = [];
  const trimmedOffTicks = new Map();

  const keyOf = (ch, note) => `${ch}-${note}`;

  for (const ev of sorted) {
    const status = ev.status & 0xFF;
    const hi = status & 0xF0;
    const ch = status & 0x0F;
    const note = ev.d1 & 0x7F;
    const vel = (ev.d2 ?? 0) & 0x7F;

    if (hi === 0xB0 && note === 64) {
      toRemove.add(ev._idx);
      continue;
    }

    if (hi === 0x90 && vel > 0) {
      const stack = active.get(keyOf(ch, note)) || [];
      stack.push(ev);
      active.set(keyOf(ch, note), stack);
      continue;
    }

    const isOff = hi === 0x80 || (hi === 0x90 && vel === 0);
    if (isOff) {
      const key = keyOf(ch, note);
      const stack = active.get(key);
      const onEv = stack?.shift();
      if (stack && stack.length === 0) active.delete(key);

      if (onEv) {
        const dur = ev.tick - onEv.tick;
        durations.push({ dur, onIdx: onEv._idx, offIdx: ev._idx, onTick: onEv.tick });
      }
    }
  }

  if (active.size) {
    for (const stack of active.values()) {
      for (const onEv of stack) {
        toRemove.add(onEv._idx);
      }
    }
  }

  if (durations.length) {
    const hardLimit = tickPerEighth * Math.max(1, maxEighths);

    const sortedDur = durations.slice().sort((a,b)=> a.dur - b.dur);
    const globalShortPool = (sortedDur.length === 3)
      ? sortedDur.slice(0, 2)
      : sortedDur.slice(0, Math.max(1, sortedDur.length - 2));
    const globalShortAvg = globalShortPool.reduce((sum,d)=> sum + d.dur, 0) / globalShortPool.length;

    const byOnTick = new Map();
    for (const info of durations) {
      if (!byOnTick.has(info.onTick)) byOnTick.set(info.onTick, []);
      byOnTick.get(info.onTick).push(info);
    }

    for (const group of byOnTick.values()) {
      const sortedGroup = group.slice().sort((a,b)=> a.dur - b.dur);
      const shortPool = (sortedGroup.length === 3)
        ? sortedGroup.slice(0, 2)
        : sortedGroup.slice(0, Math.max(1, sortedGroup.length - 2));
      const shortAvg = shortPool.reduce((sum,d)=> sum + d.dur, 0) / shortPool.length;

      const refAvg = (sortedGroup.length > 1) ? shortAvg : globalShortAvg;
      const targetDur = Math.min(hardLimit, Math.max(refAvg, tickPerEighth));

      for (const cand of sortedGroup) {
        if (cand.dur <= targetDur) continue;

        const ratioBad = cand.dur > targetDur * 1.75;
        const absoluteBad = cand.dur > hardLimit;
        if (!ratioBad && !absoluteBad) continue;

        const desiredTick = Math.max(cand.onTick + 1, Math.round(cand.onTick + targetDur));
        const cappedTick = Math.min(desiredTick, cand.onTick + hardLimit);
        trimmedOffTicks.set(cand.offIdx, cappedTick);
      }
    }
  }

  return events
    .map((e, idx) => {
      if (trimmedOffTicks.has(idx)) {
        return { ...e, tick: trimmedOffTicks.get(idx) };
      }
      return e;
    })
    .filter((_, idx) => !toRemove.has(idx));
}

function disableUnsupportedMidiMessages(events) {
  if (!events?.length) return events;

  const allowed = [];
  for (const e of events) {
    const status = e.status & 0xFF;
    const hi = status & 0xF0;
    const d1 = e.d1 & 0x7F;
    const vel = (e.d2 ?? 0) & 0x7F;

    const isNoteOn = hi === 0x90 && vel > 0;
    const isNoteOff = hi === 0x80 || (hi === 0x90 && vel === 0);
    if (isNoteOn || isNoteOff) {
      allowed.push({ ...e, d1, d2: vel });
    }
  }

  return allowed;
}

const MidiUtils = {
  readU32,
  readU16,
  readVarLen,
  writeVarLen,
  str4,
  parseTrack,
  parseMidi,
  buildMidiFile,
  sanitizeEvents,
  enforceMaxNoteLength,
  dropLongNotesAndSustain,
  disableUnsupportedMidiMessages,
};

if (typeof globalThis !== "undefined") {
  globalThis.MidiUtils = MidiUtils;
}
