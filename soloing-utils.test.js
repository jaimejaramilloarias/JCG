import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import test from 'node:test';
import { adjustSoloingWindowTranspose, prepareSoloingReference } from './soloing-utils.js';

test('prepareSoloingReference agrega notas dummy silenciosas en ventanas sin actividad en los bordes', () => {
  const tickPerEighth = 240;
  const winTicks = 32 * tickPerEighth; // 32 corcheas

  const ref = {
    ppq: tickPerEighth * 2,
    tickPerEighth,
    winEights: 32,
    winTicks,
    windowsPerFile: 3,
    soloing: true,
    events: [
      // Ventana 0: notas después de la primera corchea
      { tick: tickPerEighth * 2, status: 0x90, d1: 60, d2: 90 },
      { tick: tickPerEighth * 3, status: 0x80, d1: 60, d2: 0 },

      // Ventana 1: con actividad en los bordes, no debería agregar dummies
      { tick: winTicks + tickPerEighth * 31, status: 0x90, d1: 62, d2: 100 },
      { tick: winTicks + tickPerEighth * 32, status: 0x80, d1: 62, d2: 0 },

      // Ventana 2: notas antes de la última corchea
      { tick: winTicks * 2 + tickPerEighth * 10, status: 0x90, d1: 64, d2: 100 },
      { tick: winTicks * 2 + tickPerEighth * 11, status: 0x80, d1: 64, d2: 0 },
    ],
  };
  const prepared = prepareSoloingReference(ref);

  const { tickPerEighth: refTickPerEighth, winTicks: refWinTicks } = ref;

  // Ventana 0: silencio en la primera corchea -> dummy al inicio
  const firstOn = prepared.events.find((e) => e.tick === 0 && (e.status & 0xF0) === 0x90);
  const firstOff = prepared.events.find((e) => e.tick === refTickPerEighth && (e.status & 0xF0) === 0x80);
  ok(firstOn && firstOff, 'Se agregan notas dummy al inicio de la primera ventana');
  strictEqual(firstOn.d2, 0);
  strictEqual(firstOff.d2, 0);

  // Ventana 2: silencio en la última corchea -> dummy al final
  const win2Start = 2 * refWinTicks;
  const win2End = win2Start + refWinTicks;
  const tailOn = prepared.events.find((e) => e.tick === (win2End - refTickPerEighth) && (e.status & 0xF0) === 0x90);
  const tailOff = prepared.events.find((e) => e.tick === win2End && (e.status & 0xF0) === 0x80);
  ok(tailOn && tailOff, 'Se agregan notas dummy al cierre de la tercera ventana');
  strictEqual(tailOn.d2, 0);
  strictEqual(tailOff.d2, 0);

  // Ventana 1 tiene actividad en los bordes: no debería recibir dummies extra
  const win1End = refWinTicks * 2;
  const dummyAtWin1Tail = prepared.events.some(
    (e) => e.tick === (win1End - refTickPerEighth) && e.d1 === 0 && (e.status & 0xF0) === 0x90 && e.d2 === 0,
  );
  strictEqual(dummyAtWin1Tail, false);
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

test('prepareSoloingReference ignora notas dummy al elegir anclas', () => {
  const tickPerEighth = 120;
  const winTicks = 480;
  const ref = {
    soloing: true,
    events: [
      { tick: 0, status: 0x90, d1: 0, d2: 0, dummy: true },
      { tick: 0, status: 0x80, d1: 0, d2: 0, dummy: true },
      { tick: winTicks, status: 0x80, d1: 70, d2: 0 },
      { tick: winTicks, status: 0x90, d1: 72, d2: 100 },
      { tick: winTicks + 120, status: 0x80, d1: 72, d2: 0 },
    ],
    tickPerEighth,
    winTicks,
    windowsPerFile: 2,
  };

  const prepared = prepareSoloingReference(ref);

  deepStrictEqual(prepared.soloingWindowAnchors, [
    { first: 70, last: 70 },
    { first: 72, last: 72 },
  ]);
});
