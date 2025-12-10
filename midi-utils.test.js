import { strictEqual, deepStrictEqual } from 'node:assert';
import test from 'node:test';
import {
  buildMidiFile,
  disableUnsupportedMidiMessages,
  dropLongNotesAndSustain,
  enforceMaxNoteLength,
  parseMidi,
  sanitizeEvents
} from './midi-utils.js';
import { adjustSalsaSegments, prepareSalsaReference } from './salsa-utils.js';

test('enforceMaxNoteLength corta las notas a un máximo de 3 corcheas y fuerza note off faltantes', () => {
  const ppq = 120;
  const tickPerEighth = ppq / 2; // 60
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 100, order: 1 },
    { tick: 400, status: 0x80, d1: 60, d2: 0, order: 1 },
    { tick: 480, status: 0x90, d1: 62, d2: 100, order: 1 }
  ];

  const limited = enforceMaxNoteLength(events, tickPerEighth, 3);
  const offs = limited.filter(e => (e.status & 0xF0) === 0x80);

  // La primera nota se corta a 3 corcheas (180 ticks)
  strictEqual(offs[0].tick, 180);
  // La segunda nota (sin note off) recibe un corte automático a los 3 tiempos permitidos
  strictEqual(offs[1].tick, 480 + (tickPerEighth * 3));
});

test('sanitizeEvents elimina artefactos por solapamiento de notas', () => {
  const events = [
    { tick: 0, status: 0x90, d1: 64, d2: 90, order: 3 },
    { tick: 10, status: 0x90, d1: 64, d2: 95, order: 3 },
    { tick: 20, status: 0x80, d1: 64, d2: 0, order: 3 }
  ];

  const cleaned = sanitizeEvents(events);
  const offs = cleaned.filter(e => (e.status & 0xF0) === 0x80);

  strictEqual(offs.length, 2);
  strictEqual(offs[0].tick, 10);
});

test('sanitizeEvents alinea los note off de notas duplicadas con su origen', () => {
  const originId = 'grp';
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 100, order: 1, originId },
    { tick: 0, status: 0x90, d1: 72, d2: 100, order: 1.1, originId },
    { tick: 120, status: 0x80, d1: 60, d2: 0, order: 1, originId },
    { tick: 140, status: 0x80, d1: 72, d2: 0, order: 1.1, originId },
  ];

  const cleaned = sanitizeEvents(events);
  const offs = cleaned.filter(e => (e.status & 0xF0) === 0x80);

  strictEqual(offs.length, 2);
  deepStrictEqual(offs.map(e => e.tick), [120, 120]);
});

test('buildMidiFile exporta un solo track en formato 0', () => {
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 100, order: 1 },
    { tick: 120, status: 0x80, d1: 60, d2: 0, order: 1 }
  ];

  const bytes = buildMidiFile(120, events);
  const parsed = parseMidi(bytes.buffer);

  strictEqual(parsed.format, 0);
  strictEqual(parsed.tracks.length, 1);
  strictEqual(parsed.tracks[0].events.length, 2);
});

test('disableUnsupportedMidiMessages deja únicamente Note On/Off con nota y velocidad', () => {
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 100 },
    { tick: 5, status: 0xB0, d1: 64, d2: 0 },
    { tick: 10, status: 0xE0, d1: 1, d2: 2 },
    { tick: 15, status: 0x90, d1: 62, d2: 90 },
    { tick: 20, status: 0x80, d1: 60, d2: 0 }
  ];

  const filtered = disableUnsupportedMidiMessages(events);

  const statuses = filtered.map(e => e.status & 0xF0);
  deepStrictEqual(statuses, [0x90, 0x90, 0x80]);
  deepStrictEqual(filtered.map(e => e.d1), [60, 62, 60]);
  deepStrictEqual(filtered.map(e => e.d2), [100, 90, 0]);
});

test('dropLongNotesAndSustain recorta al promedio de notas cortas y elimina sustain', () => {
  const tickPerEighth = 60;
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 90 },
    { tick: 50, status: 0xB0, d1: 64, d2: 127 }, // sustain -> se elimina
    { tick: 120, status: 0x90, d1: 62, d2: 80 },
    { tick: 240, status: 0x80, d1: 62, d2: 0 }, // 2 corcheas -> referencia "corta"
    { tick: 480, status: 0x90, d1: 64, d2: 70 },
    { tick: 780, status: 0x80, d1: 64, d2: 0 }, // 5 corcheas -> aún razonable
    { tick: 960, status: 0x80, d1: 60, d2: 0 }, // 16 corcheas -> outlier a recortar
  ];

  const filtered = dropLongNotesAndSustain(events, tickPerEighth, 4);

  const sustainMessages = filtered.filter(e => (e.status & 0xF0) === 0xB0);
  strictEqual(sustainMessages.length, 0);

  const off60 = filtered.find(e => (e.status & 0xF0) === 0x80 && e.d1 === 60);
  strictEqual(off60.tick, 210); // recortada a la media de las notas cortas (aprox 3.5 corcheas)

  const off62 = filtered.find(e => (e.status & 0xF0) === 0x80 && e.d1 === 62);
  strictEqual(off62.tick, 240);

  const off64 = filtered.find(e => (e.status & 0xF0) === 0x80 && e.d1 === 64);
  strictEqual(off64.tick, 690); // recorta incluso notas moderadamente largas al promedio corto
});

test('dropLongNotesAndSustain promedia por acorde y recorta notas largas desalineadas', () => {
  const tickPerEighth = 100;
  const events = [
    { tick: 0, status: 0x90, d1: 60, d2: 90 },
    { tick: 0, status: 0x90, d1: 64, d2: 85 },
    { tick: 0, status: 0x90, d1: 67, d2: 80 },
    { tick: 120, status: 0x80, d1: 60, d2: 0 }, // 1.2 corcheas
    { tick: 120, status: 0x80, d1: 64, d2: 0 }, // 1.2 corcheas
    { tick: 330, status: 0x80, d1: 67, d2: 0 }, // outlier dentro del acorde
  ];

  const filtered = dropLongNotesAndSustain(events, tickPerEighth, 4);

  const off67 = filtered.find(e => (e.status & 0xF0) === 0x80 && e.d1 === 67);
  strictEqual(off67.tick, 120); // se recorta a la media corta del acorde (antes quedaba largo)
});

test('adjustSalsaSegments aplica las anticipaciones del modo Salsa 2-3', () => {
  const segments = [0, 4, 8, 12, 16].map((start, idx) => ({
    startEighth: start,
    durEighth: 4,
    token: `A${idx + 1}`,
    quality: 'A',
    refVariant: '1',
    transpose: 0
  }));

  const { segments: adjusted } = adjustSalsaSegments(segments, 24);

  deepStrictEqual(adjusted.map(s => s.startEighth), [0, 3, 7, 11, 14]);
  deepStrictEqual(adjusted.map(s => s.durEighth), [3, 4, 4, 3, 10]);
});

test('prepareSalsaReference ancla ventanas silenciosas con notas dummy sin sonido', () => {
  const tickPerEighth = 60;
  const winTicks = tickPerEighth * 16;
  const events = [
    { tick: tickPerEighth, status: 0x90, d1: 60, d2: 90 },
    { tick: tickPerEighth * 2, status: 0x80, d1: 60, d2: 0 },
  ];

  const prepared = prepareSalsaReference({
    tickPerEighth,
    winTicks,
    windowsPerFile: 4,
    events,
  });

  const startAnchor = prepared.events.find(e => e.tick === 0 && (e.status & 0xF0) === 0x90);
  const endAnchor = prepared.events.find(e => e.tick === winTicks && (e.status & 0xF0) === 0x80);

  deepStrictEqual(startAnchor?.d2, 0);
  deepStrictEqual(endAnchor?.d2, 0);
});
