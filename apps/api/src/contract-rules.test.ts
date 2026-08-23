/**
 * Die Prüfregeln aus 3.9, geprüft ohne Datenbank.
 *
 * Die Abnahme von AP 8 nennt einen Fall ausdrücklich: „Ein Zahlungsplan mit
 * 95 % erzeugt den Hinweis auf § 650m Abs. 1 BGB."
 */

import { describe, expect, it } from 'vitest';
import { checkContract, commitmentInterest, DESCRIPTION_ITEMS, type ContractFacts } from './contract-rules.js';

const basis: ContractFacts = {
  contractType: 'verbraucherbauvertrag',
  contractSumCents: 45_000_000,
  contractualCompletion: '2027-03-20',
  securityPct: 5,
  milestonePcts: [10, 20, 20, 20, 20],
  agreedChangeOrderCents: 0,
  descriptionReviewed: DESCRIPTION_ITEMS.length,
  descriptionMissing: [],
};

const schluessel = (facts: ContractFacts): string[] =>
  checkContract(facts).map((befund) => befund.ruleKey);

describe('Der Zahlungsplan', () => {
  it('erzeugt bei 95 % den Hinweis auf § 650m Abs. 1 BGB — die Abnahme von AP 8', () => {
    const befunde = checkContract({ ...basis, milestonePcts: [15, 20, 20, 20, 20] });
    const treffer = befunde.find((befund) => befund.ruleKey === 'abschlaege_ueber_90');

    expect(treffer).toBeDefined();
    expect(treffer?.legalReference).toBe('§ 650m Abs. 1 BGB');
    expect(treffer?.message).toContain('95 %');
    expect(treffer?.message).toContain('90 %');
    // Ein Hinweis, keine Bewertung: Nirgends steht, dass etwas unwirksam sei.
    expect(treffer?.message).not.toMatch(/unwirksam|unzulässig|Verstoß/i);
  });

  it('lässt genau 90 % in Ruhe', () => {
    expect(schluessel({ ...basis, milestonePcts: [10, 20, 20, 20, 20] })).not.toContain(
      'abschlaege_ueber_90',
    );
  });

  it('greift nicht beim Einzelgewerkvertrag', () => {
    // § 650m steht in den Vorschriften zum Verbraucherbauvertrag. Wer mit
    // zwanzig Firmen einzeln abschließt, hat keinen.
    expect(
      schluessel({
        ...basis,
        contractType: 'einzelgewerke',
        milestonePcts: [15, 20, 20, 20, 20],
      }),
    ).not.toContain('abschlaege_ueber_90');
  });

  it('sagt nichts, solange kein Zahlungsplan erfasst ist', () => {
    expect(schluessel({ ...basis, milestonePcts: [] })).not.toContain('abschlaege_ueber_90');
  });
});

describe('Die Sicherheit', () => {
  it('fehlt und wird benannt', () => {
    const treffer = checkContract({ ...basis, securityPct: null }).find(
      (befund) => befund.ruleKey === 'sicherheit_fehlt',
    );
    expect(treffer?.legalReference).toBe('§ 650m Abs. 2 BGB');
    expect(treffer?.message).toContain('5 %');
  });

  it('schweigt, wenn sie vereinbart ist', () => {
    expect(schluessel(basis)).not.toContain('sicherheit_fehlt');
  });
});

describe('Nachträge', () => {
  it('meldet sich ab zehn Prozent der ursprünglichen Vergütung', () => {
    const treffer = checkContract({ ...basis, agreedChangeOrderCents: 5_000_000 }).find(
      (befund) => befund.ruleKey === 'nachtraege_ueber_10',
    );
    expect(treffer?.legalReference).toBe('§ 650m Abs. 2 S. 2 BGB');
    expect(treffer?.message).toContain('11,1 %');
  });

  it('schweigt knapp darunter', () => {
    expect(schluessel({ ...basis, agreedChangeOrderCents: 4_400_000 })).not.toContain(
      'nachtraege_ueber_10',
    );
  });
});

describe('Der Fertigstellungstermin', () => {
  it('fehlt und bekommt einen nächsten Schritt', () => {
    const treffer = checkContract({ ...basis, contractualCompletion: null }).find(
      (befund) => befund.ruleKey === 'kein_fertigstellungstermin',
    );
    expect(treffer?.legalReference).toBe('§ 650k Abs. 3 BGB');
    // CI 11.4: Jede schlechte Nachricht trägt einen nächsten Schritt.
    expect(treffer?.message).toContain('trag ihn ein');
  });
});

describe('Die Baubeschreibung', () => {
  it('sagt „noch nicht durchgesehen" statt „alles fehlt"', () => {
    const befunde = checkContract({
      ...basis,
      descriptionReviewed: 0,
      descriptionMissing: DESCRIPTION_ITEMS.map((punkt) => punkt.label),
    });
    expect(befunde.map((befund) => befund.ruleKey)).toContain('baubeschreibung_ungeprueft');
    // Der andere Befund wäre eine Behauptung über einen Vertrag, den niemand
    // gelesen hat.
    expect(befunde.map((befund) => befund.ruleKey)).not.toContain(
      'baubeschreibung_unvollstaendig',
    );
  });

  it('nennt beim Durchsehen, welcher Punkt fehlt', () => {
    const treffer = checkContract({
      ...basis,
      descriptionReviewed: DESCRIPTION_ITEMS.length - 1,
      descriptionMissing: ['Verbindliche Angabe zum Zeitpunkt der Fertigstellung'],
    }).find((befund) => befund.ruleKey === 'baubeschreibung_unvollstaendig');

    expect(treffer?.message).toContain('Verbindliche Angabe zum Zeitpunkt der Fertigstellung');
    expect(treffer?.message).toContain('zulasten des Unternehmers');
  });

  it('schweigt, wenn alles drinsteht', () => {
    expect(schluessel(basis)).toEqual([]);
  });
});

describe('Bereitstellungszinsen', () => {
  it('rechnet erst nach der bereitstellungsfreien Zeit', () => {
    const ohne = commitmentInterest({
      totalCents: 40_000_000,
      pctPerYear: 3,
      freeMonths: 12,
      from: '2026-01-01',
      until: '2026-11-01',
      drawdowns: [],
    });
    expect(ohne.cents).toBe(0);
  });

  it('rechnet auf das, was noch nicht abgerufen ist', () => {
    // 400.000 Euro, 3 % p. a., ein Jahr lang gar nichts abgerufen: 12.000 Euro.
    const voll = commitmentInterest({
      totalCents: 40_000_000,
      pctPerYear: 3,
      freeMonths: 0,
      from: '2026-01-01',
      until: '2027-01-01',
      drawdowns: [],
    });
    expect(voll.cents).toBe(1_200_000);
    expect(voll.days).toBe(360);
  });

  it('senkt die Zinsen mit jedem Abruf', () => {
    // Nach einem halben Jahr die Hälfte abgerufen: 6.000 + 3.000 Euro.
    const mit = commitmentInterest({
      totalCents: 40_000_000,
      pctPerYear: 3,
      freeMonths: 0,
      from: '2026-01-01',
      until: '2027-01-01',
      drawdowns: [{ amountCents: 20_000_000, date: '2026-07-01' }],
    });
    expect(mit.cents).toBe(900_000);
  });

  it('hört auf, wenn alles abgerufen ist', () => {
    const fertig = commitmentInterest({
      totalCents: 40_000_000,
      pctPerYear: 3,
      freeMonths: 0,
      from: '2026-01-01',
      until: '2027-01-01',
      drawdowns: [{ amountCents: 40_000_000, date: '2026-04-01' }],
    });
    // Ein Vierteljahr auf die volle Summe: 3.000 Euro, danach nichts mehr.
    expect(fertig.cents).toBe(300_000);
  });
});
