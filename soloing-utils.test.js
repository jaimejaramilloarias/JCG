import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMidi } from './midi-utils.js';
import { adjustSoloingWindowTranspose, prepareSoloingReference } from './soloing-utils.js';

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

test('prepareSoloingReference captura primeras y últimas notas por ventana', () => {
  const ref = {
    soloing: true,
    events: [
      { tick: 0, status: 0x90, d1: 60, d2: 90 },
      { tick: 120, status: 0x80, d1: 60, d2: 0 },
      { tick: 480, status: 0x90, d1: 64, d2: 100 },
      { tick: 600, status: 0x80, d1: 64, d2: 0 },
      { tick: 700, status: 0x90, d1: 67, d2: 80 },
    ],
    tickPerEighth: 120,
    winTicks: 480,
    windowsPerFile: 2,
  };

  const prepared = prepareSoloingReference(ref);

  strictEqual(prepared.soloingWindowAnchors.length, 2);
  deepStrictEqual(prepared.soloingWindowAnchors[0], { first: 60, last: 60 });
  deepStrictEqual(prepared.soloingWindowAnchors[1], { first: 64, last: 67 });
});

test('adjustSoloingWindowTranspose reduce saltos mayores a una séptima mayor', () => {
  strictEqual(adjustSoloingWindowTranspose(72, 60, 0), 12, 'Ajusta hacia arriba cuando la distancia supera 11 semitonos');
  strictEqual(adjustSoloingWindowTranspose(60, 84, 0), -24, 'Puede necesitar más de una octava para respetar la distancia máxima');
  strictEqual(adjustSoloingWindowTranspose(72, 48, 0), 24, 'Sube tantas octavas como sea necesario para acercar la siguiente ventana');
});

test('prepareSoloingReference usa NoteOff en los bordes cuando no hay NoteOn', () => {
  const ref = {
    soloing: true,
    events: [
      // Ventana 0: actividad normal
      { tick: 0, status: 0x90, d1: 60, d2: 90 },
      { tick: 120, status: 0x80, d1: 60, d2: 0 },
      // Ventana 1: sin NoteOn, solo NoteOff al inicio y al final
      { tick: 480, status: 0x80, d1: 65, d2: 0 },
      { tick: 700, status: 0x80, d1: 67, d2: 0 },
    ],
    tickPerEighth: 120,
    winTicks: 480,
    windowsPerFile: 2,
  };

  const prepared = prepareSoloingReference(ref);

  deepStrictEqual(prepared.soloingWindowAnchors[0], { first: 60, last: 60 });
  deepStrictEqual(prepared.soloingWindowAnchors[1], { first: 65, last: 67 });
});
