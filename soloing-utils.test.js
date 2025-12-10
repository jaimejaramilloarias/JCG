import { strictEqual, ok } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMidi } from './midi-utils.js';
import { prepareSoloingReference } from './soloing-utils.js';

function loadSoloingReference(path, winEights) {
  const buf = readFileSync(path);
  const midi = parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  let events = [];
  let trackLenTicks = 0;

  for (const tr of midi.tracks || []) {
    trackLenTicks = Math.max(trackLenTicks, tr.endTick || 0);
    const channelEvents = (tr.events || []).filter((e) => {
      const status = (e.status ?? 0) & 0xF0;
      return status >= 0x80 && status <= 0xE0;
    });
    events.push(...channelEvents);
  }

  const tickPerEighth = midi.ppq / 2;
  const winTicks = winEights * tickPerEighth;
  const totalEighths = trackLenTicks / tickPerEighth;
  const windowsPerFile = totalEighths / winEights;

  // Anchors en el inicio de cada ventana, igual que la indexación de referencias.
  for (let w = 0; w < windowsPerFile; w++) {
    const startTick = w * winTicks;
    events.push({ tick: startTick, status: 0x90, d1: 0, d2: 0 });
    events.push({ tick: startTick, status: 0x80, d1: 0, d2: 0 });
  }

  return {
    ppq: midi.ppq,
    tickPerEighth,
    winEights,
    winTicks,
    windowsPerFile,
    events,
    variant: winEights === 8 ? 'x24' : 'x32',
    soloing: true,
  };
}

test('prepareSoloingReference agrega notas dummy silenciosas en ventanas sin actividad en los bordes', () => {
  const ref = loadSoloingReference('JCG_reference_midi_files/Soloing/tonic_min_x32.mid', 32);
  const prepared = prepareSoloingReference(ref);

  const { tickPerEighth, winTicks } = ref;

  // Ventana 0: silencio en la primera corchea -> dummy al inicio
  const firstOn = prepared.events.find((e) => e.tick === 0 && (e.status & 0xF0) === 0x90);
  const firstOff = prepared.events.find((e) => e.tick === tickPerEighth && (e.status & 0xF0) === 0x80);
  ok(firstOn && firstOff, 'Se agregan notas dummy al inicio de la primera ventana');
  strictEqual(firstOn.d2, 0);
  strictEqual(firstOff.d2, 0);

  // Ventana 2: silencio en la última corchea -> dummy al final
  const win2Start = 2 * winTicks;
  const win2End = win2Start + winTicks;
  const tailOn = prepared.events.find((e) => e.tick === (win2End - tickPerEighth) && (e.status & 0xF0) === 0x90);
  const tailOff = prepared.events.find((e) => e.tick === win2End && (e.status & 0xF0) === 0x80);
  ok(tailOn && tailOff, 'Se agregan notas dummy al cierre de la tercera ventana');
  strictEqual(tailOn.d2, 0);
  strictEqual(tailOff.d2, 0);

  // Ventana 3 tiene actividad al final: no debería recibir dummy en la última corchea
  const win3End = 3 * winTicks + winTicks;
  const dummyAtWin3Tail = prepared.events.some(
    (e) => e.tick === (win3End - tickPerEighth) && e.d1 === 0 && (e.status & 0xF0) === 0x90 && e.d2 === 0,
  );
  strictEqual(dummyAtWin3Tail, false);
});
