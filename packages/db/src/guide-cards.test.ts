/**
 * Prüft das Redaktionsformat — ohne Datenbank.
 *
 * Der Schwerpunkt liegt auf dem, was schiefgehen darf: Eine Karte mit einem
 * Tippfehler im Abschnittstitel muss **abbrechen**, nicht stillschweigend
 * einen leeren Abschnitt liefern. Ein Bauherr merkt an einer fehlenden Liste
 * nicht, dass sie fehlt.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guideCardId, parseGuideCard, renderGuideCardSql } from './guide-cards.js';

const sha1 = (input: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(input).digest());

const VOLLSTAENDIG = `---
key: estrich
titel: Estrich und Belegreife
phase: ausbau
gewerk: estrich
vorgaenge: t26, t27
fassung: 1
fachpruefung: nein
---

## Was passiert

Der Estrich wird eingebracht und muss danach trocknen.

## Worauf du achten kannst

- Randdämmstreifen ringsum sichtbar — ohne ihn überträgt der Estrich Schall
- Fugen nach Plan — ein Estrich ohne Fugenplan reißt an der ungünstigsten Stelle

## Fragen an den GU

- Wann wird die Belegreife gemessen? — vor dieser Messung wird kein Belag verlegt

## Was oft schiefgeht

- Zu früh belegt — der Belag wirft Blasen oder löst sich

## Jetzt fotografieren

- Die Fläche vor dem Estrich — danach ist die Leitungslage nicht mehr sichtbar

## Quellen

- DIN 18560 — Estriche im Bauwesen
`;

describe('Redaktionsformat', () => {
  it('liest eine vollständige Karte', () => {
    const card = parseGuideCard('estrich.md', VOLLSTAENDIG);

    expect(card.key).toBe('estrich');
    expect(card.version).toBe(1);
    expect(card.phaseKey).toBe('ausbau');
    expect(card.tradeCode).toBe('estrich');
    expect(card.templateTaskCodes).toEqual(['t26', 't27']);
    expect(card.whatsHappening).toContain('trocknen');
    expect(card.watchFor).toHaveLength(2);
    expect(card.watchFor[0]).toEqual({
      text: 'Randdämmstreifen ringsum sichtbar',
      why: 'ohne ihn überträgt der Estrich Schall',
    });
    expect(card.questionsForContractor[0]?.question).toBe('Wann wird die Belegreife gemessen?');
    expect(card.commonProblems[0]?.howToSpot).toContain('Blasen');
    expect(card.photoPrompts[0]?.what).toContain('vor dem Estrich');
    expect(card.expertRecommended).toBe(false);
    expect(card.expertReason).toBeNull();
    expect(card.sources[0]?.reference).toBe('DIN 18560');
  });

  it('trennt am ersten Geviertstrich, nicht am letzten', () => {
    const markdown = VOLLSTAENDIG.replace(
      '- Zu früh belegt — der Belag wirft Blasen oder löst sich',
      '- Zu früh belegt — der Belag wirft Blasen — und löst sich',
    );
    const card = parseGuideCard('estrich.md', markdown);
    expect(card.commonProblems[0]?.problem).toBe('Zu früh belegt');
    expect(card.commonProblems[0]?.howToSpot).toBe('der Belag wirft Blasen — und löst sich');
  });

  it('bricht ab, wenn eine Aussage keine Begründung trägt', () => {
    const markdown = VOLLSTAENDIG.replace(
      '- Fugen nach Plan — ein Estrich ohne Fugenplan reißt an der ungünstigsten Stelle',
      '- Fugen nach Plan',
    );
    expect(() => parseGuideCard('estrich.md', markdown)).toThrow(/keine Begründung/);
  });

  it('bricht bei einem unbekannten Abschnitt ab, statt ihn zu verschlucken', () => {
    const markdown = VOLLSTAENDIG.replace('## Quellen', '## Quelle');
    expect(() => parseGuideCard('estrich.md', markdown)).toThrow(/Unbekannter Abschnitt/);
  });

  it('verlangt zu jeder empfohlenen Fachprüfung eine Begründung', () => {
    const markdown = VOLLSTAENDIG.replace('fachpruefung: nein', 'fachpruefung: ja');
    expect(() => parseGuideCard('estrich.md', markdown)).toThrow(/Angstmache/);
  });

  it('lehnt eine Begründung ohne Empfehlung ab', () => {
    const markdown = VOLLSTAENDIG.replace(
      '## Quellen',
      '## Warum eine Fachprüfung\n\nWeil es wichtig ist.\n\n## Quellen',
    );
    expect(() => parseGuideCard('estrich.md', markdown)).toThrow(/ohne „fachpruefung: ja"/);
  });

  it('lehnt einen Vorgangscode ab, den die Ablaufvorlage nicht kennt', () => {
    const markdown = VOLLSTAENDIG.replace('vorgaenge: t26, t27', 'vorgaenge: estrich');
    expect(() => parseGuideCard('estrich.md', markdown)).toThrow(/kein Vorlagencode/);
  });

  it('nennt in jeder Meldung die Datei', () => {
    expect(() => parseGuideCard('kaputt.md', 'ohne Frontmatter')).toThrow(/^kaputt\.md:/);
  });
});

describe('Kennung je Karte und Fassung', () => {
  it('ist stabil — derselbe Import legt keine Doppelgänger an', () => {
    expect(guideCardId(sha1, 'estrich', 1)).toBe(guideCardId(sha1, 'estrich', 1));
  });

  it('unterscheidet Fassungen und Karten', () => {
    expect(guideCardId(sha1, 'estrich', 1)).not.toBe(guideCardId(sha1, 'estrich', 2));
    expect(guideCardId(sha1, 'estrich', 1)).not.toBe(guideCardId(sha1, 'innenputz', 1));
  });

  it('ist eine UUID der Fassung 5', () => {
    expect(guideCardId(sha1, 'estrich', 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('Import-SQL', () => {
  const karte = parseGuideCard('estrich.md', VOLLSTAENDIG);

  it('lässt sich mehrfach einspielen', () => {
    expect(renderGuideCardSql([karte], sha1)).toContain('on conflict (id) do nothing');
  });

  it('maskiert Apostrophe im Text', () => {
    const mitApostroph = {
      ...karte,
      whatsHappening: "Der Estrich der 60er's trocknet langsam.",
    };
    const sql = renderGuideCardSql([mitApostroph], sha1);
    expect(sql).toContain("60er''s");
  });

  it('verkettet eine neue Fassung mit ihrer Vorgängerin', () => {
    const zweite = { ...karte, version: 2 };
    const sql = renderGuideCardSql([karte, zweite], sha1);

    expect(sql).toContain(
      `update guide_card set superseded_by = '${guideCardId(sha1, 'estrich', 2)}'`,
    );
    expect(sql).toContain(`where id = '${guideCardId(sha1, 'estrich', 1)}'`);
  });

  it('verkettet nichts, solange es nur eine Fassung gibt', () => {
    // Auf das Wort zu prüfen genügt nicht: Der Kopfkommentar erklärt die
    // Verkettung, ohne eine anzulegen.
    expect(renderGuideCardSql([karte], sha1)).not.toContain('update guide_card set superseded_by');
  });
});

describe('Die zwölf Karten aus Abschnitt 7.4', () => {
  const verzeichnis = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'lotsenkarten');
  const dateien = readdirSync(verzeichnis).filter((name) => name.endsWith('.md'));
  const karten = dateien.map((name) =>
    parseGuideCard(name, readFileSync(join(verzeichnis, name), 'utf8')),
  );

  it('sind zwölf', () => {
    expect(karten).toHaveLength(12);
  });

  it('lassen sich alle lesen und tragen jede einen Schlüssel genau einmal', () => {
    const schluessel = karten.map((card) => `${card.key}@${card.version}`);
    expect(new Set(schluessel).size).toBe(karten.length);
  });

  // Die Aussage aus Abschnitt 6.3: keine Behauptung ohne Quelle.
  it('nennen jede mindestens eine Quelle', () => {
    for (const card of karten) {
      expect(card.sources.length, card.key).toBeGreaterThan(0);
    }
  });

  it('empfehlen bei genau fünf Karten eine Fachprüfung', () => {
    const mitPruefung = karten.filter((card) => card.expertRecommended).map((card) => card.key);
    expect(mitPruefung.sort()).toEqual(
      ['abnahme', 'blower-door', 'bodenplatte', 'kellerabdichtung', 'rohinstallation-shk'].sort(),
    );
  });

  it('verweisen nur auf Vorgänge, die es in der Ablaufvorlage gibt', () => {
    const codes = new Set(karten.flatMap((card) => card.templateTaskCodes));
    for (const code of codes) {
      const nummer = Number(code.slice(1));
      expect(nummer, code).toBeGreaterThanOrEqual(1);
      expect(nummer, code).toBeLessThanOrEqual(38);
    }
  });

  it('belegen jeden Vorgang höchstens einmal', () => {
    const belegt = karten.flatMap((card) => card.templateTaskCodes);
    expect(new Set(belegt).size).toBe(belegt.length);
  });
});
