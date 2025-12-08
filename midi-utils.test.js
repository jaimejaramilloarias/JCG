import { strictEqual, deepStrictEqual } from 'node:assert';
import test from 'node:test';
import {
  buildMidiFile,
  disableUnsupportedMidiMessages,
  enforceMaxNoteLength,
  parseMidi,
  sanitizeEvents
} from './midi-utils.js';

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
