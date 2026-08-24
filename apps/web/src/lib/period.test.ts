import { describe, expect, it } from 'vitest';
import { monateZurueck } from './period';

describe('Drei Monate zurück', () => {
  it('rechnet im laufenden Jahr', () => {
    expect(monateZurueck('2026-08-24', 3)).toBe('2026-05-24');
  });

  it('rechnet über den Jahreswechsel', () => {
    expect(monateZurueck('2026-02-14', 3)).toBe('2025-11-14');
    expect(monateZurueck('2026-01-01', 1)).toBe('2025-12-01');
  });

  it('klemmt den 31. auf das Monatsende', () => {
    // Der Fall, für den es diese Datei gibt: „31. Februar" gibt es nicht.
    expect(monateZurueck('2026-05-31', 3)).toBe('2026-02-28');
    expect(monateZurueck('2026-07-31', 1)).toBe('2026-06-30');
  });

  it('kennt den Schalttag', () => {
    expect(monateZurueck('2024-05-31', 3)).toBe('2024-02-29');
  });

  it('lässt einen unbrauchbaren Wert unangetastet', () => {
    expect(monateZurueck('', 3)).toBe('');
  });
});
