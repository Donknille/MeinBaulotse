import { describe, expect, it } from 'vitest';
import { GUEST_TEXTS, guestRange, textsFor } from './guest-i18n';

describe('Fünf Sprachen', () => {
  it('deckt alle Sprachen aus Abschnitt 2.3 ab', () => {
    expect(Object.keys(GUEST_TEXTS).sort()).toEqual(['de', 'en', 'pl', 'ro', 'tr']);
  });

  it('lässt in keiner Sprache einen Satz aus', () => {
    const deutsch = Object.keys(GUEST_TEXTS.de).sort();
    for (const [sprache, texte] of Object.entries(GUEST_TEXTS)) {
      expect(Object.keys(texte).sort(), sprache).toEqual(deutsch);
      for (const [schluessel, satz] of Object.entries(texte)) {
        expect(satz.trim(), `${sprache}.${schluessel}`).not.toBe('');
      }
    }
  });

  it('übersetzt wirklich, statt Deutsch durchzureichen', () => {
    // Ein durchgereichter deutscher Satz wäre schlimmer als keine Übersetzung:
    // Er sieht aus wie eine.
    for (const sprache of ['en', 'pl', 'ro', 'tr'] as const) {
      expect(GUEST_TEXTS[sprache].yes, sprache).not.toBe(GUEST_TEXTS.de.yes);
      expect(GUEST_TEXTS[sprache].question, sprache).not.toBe(GUEST_TEXTS.de.question);
    }
  });

  it('fällt bei unbekannter Sprache auf Deutsch zurück', () => {
    expect(textsFor('xx')).toBe(GUEST_TEXTS.de);
    expect(textsFor(undefined)).toBe(GUEST_TEXTS.de);
    expect(textsFor('pl')).toBe(GUEST_TEXTS.pl);
  });
});

describe('Die Datumsspanne', () => {
  it('kürzt bei gleichem Monat', () => {
    expect(guestRange('2026-05-12', '2026-05-21')).toBe('12.–21.05.2026');
  });

  it('schreibt beide Daten aus, wenn der Monat wechselt', () => {
    expect(guestRange('2026-05-28', '2026-06-03')).toBe('28.05.2026 – 03.06.2026');
  });

  it('zeigt einen einzelnen Tag als einen Tag', () => {
    expect(guestRange('2026-05-12', '2026-05-12')).toBe('12.05.2026');
    expect(guestRange('2026-05-12', null)).toBe('12.05.2026');
  });

  it('kommt ohne Termin zurecht', () => {
    expect(guestRange(null, null)).toBe('—');
  });
});
