/**
 * Bereitstellungszinsen.
 *
 * Die Zahlen hier sind von Hand nachgerechnet, nicht aus einem Lauf
 * übernommen. Bei einer Rechnung, die dem Bauherren sagt, was ihn ein Monat
 * Verzug kostet, ist das der Unterschied zwischen einer Prüfung und einer
 * Bestätigung.
 */

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  commitmentInterest,
  days30E360,
  delayCostInCommitmentInterest,
  lastFreeDay,
} from './interest.js';

/** 400.000 €, 3 % p. a., zwölf Monate frei ab dem 1. April 2026. */
const STANDARD = {
  loanAmountCents: 40_000_000,
  grantedOn: '2026-04-01',
  freeMonths: 12,
  ratePerYearBp: 300,
  drawdowns: [],
  until: '2027-04-01',
} as const;

describe('Die deutsche Zinsmethode', () => {
  it('zählt jeden Monat als dreißig Tage', () => {
    expect(days30E360('2026-01-01', '2026-02-01')).toBe(30);
    expect(days30E360('2026-02-01', '2026-03-01')).toBe(30);
    expect(days30E360('2026-01-01', '2027-01-01')).toBe(360);
  });

  it('zieht den 31. auf den 30.', () => {
    // Das ist keine Ungenauigkeit, sondern die Konvention, nach der
    // abgerechnet wird: Der 31. Januar und der 30. Januar sind derselbe Tag.
    expect(days30E360('2026-01-31', '2026-02-28')).toBe(28);
    expect(days30E360('2026-01-30', '2026-02-28')).toBe(28);
  });

  it('rechnet rückwärts negativ', () => {
    expect(days30E360('2026-03-01', '2026-01-01')).toBe(-60);
  });
});

describe('Monate addieren', () => {
  it('behält den Tag im Monat', () => {
    expect(addMonths('2026-04-15', 12)).toBe('2027-04-15');
    expect(addMonths('2026-04-15', 6)).toBe('2026-10-15');
  });

  it('lässt den 31. auf den Monatsletzten rutschen', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('kommt über den Jahreswechsel', () => {
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10');
    expect(addMonths('2026-02-10', -3)).toBe('2025-11-10');
  });
});

describe('Solange die bereitstellungsfreie Zeit läuft', () => {
  it('kostet nichts', () => {
    const ergebnis = commitmentInterest({ ...STANDARD, until: '2027-03-31' });
    expect(ergebnis.totalCents).toBe(0);
    expect(ergebnis.chargeableFrom).toBeNull();
  });

  it('nennt trotzdem, was ein Monat danach kosten würde', () => {
    // Die eigentliche Auskunft: 400.000 € × 3 % ÷ 12 = 1.000 € im Monat.
    const ergebnis = commitmentInterest({ ...STANDARD, until: '2027-03-31' });
    expect(ergebnis.costPerFurtherMonthCents).toBe(100_000);
  });

  it('nennt den letzten freien Tag', () => {
    expect(lastFreeDay('2026-04-01', 12)).toBe('2027-03-31');
  });
});

describe('Danach', () => {
  it('kostet ein voller Monat auf das ganze Darlehen tausend Euro', () => {
    // 40.000.000 ct × 300 bp × 30 Tage ÷ 10.000 ÷ 360 = 100.000 ct = 1.000 €.
    const ergebnis = commitmentInterest({ ...STANDARD, until: '2027-05-01' });
    expect(ergebnis.totalCents).toBe(100_000);
    expect(ergebnis.chargeableFrom).toBe('2027-04-01');
    expect(ergebnis.segments).toHaveLength(1);
    expect(ergebnis.segments[0]!.days).toBe(30);
  });

  it('sinkt mit jedem Abruf', () => {
    // Erst 30 Tage auf 400.000 €, dann 30 Tage auf 250.000 €.
    //   100.000 ct + 25.000.000 × 300 × 30 ÷ 10.000 ÷ 360 = 100.000 + 62.500
    const ergebnis = commitmentInterest({
      ...STANDARD,
      drawdowns: [{ date: '2027-05-01', amountCents: 15_000_000 }],
      until: '2027-06-01',
    });
    expect(ergebnis.totalCents).toBe(162_500);
    expect(ergebnis.segments).toHaveLength(2);
    expect(ergebnis.segments[1]!.undrawnCents).toBe(25_000_000);
  });

  it('hört auf, sobald das Darlehen ganz abgerufen ist', () => {
    const ergebnis = commitmentInterest({
      ...STANDARD,
      drawdowns: [{ date: '2027-05-01', amountCents: 40_000_000 }],
      until: '2027-09-01',
    });
    expect(ergebnis.totalCents).toBe(100_000);
    expect(ergebnis.undrawnAtEndCents).toBe(0);
    expect(ergebnis.costPerFurtherMonthCents).toBe(0);
  });

  it('zählt einen Abruf ab dem Tag, an dem das Geld floss', () => {
    // Der Abschnitt davor endet an diesem Tag, der danach beginnt mit dem
    // niedrigeren Betrag — nicht umgekehrt.
    const ergebnis = commitmentInterest({
      ...STANDARD,
      drawdowns: [{ date: '2027-04-16', amountCents: 20_000_000 }],
      until: '2027-05-01',
    });
    expect(ergebnis.segments[0]!.undrawnCents).toBe(40_000_000);
    expect(ergebnis.segments[1]!.undrawnCents).toBe(20_000_000);
  });

  it('ignoriert einen Abruf, der noch nicht ausgezahlt ist', () => {
    // Ein angeforderter Abruf senkt die Bereitstellungszinsen nicht — nur ein
    // geflossener. Deshalb steht in `drawdowns` das Zahlungsdatum.
    const ohne = commitmentInterest({ ...STANDARD, until: '2027-05-01' });
    const mitSpaeterem = commitmentInterest({
      ...STANDARD,
      drawdowns: [{ date: '2027-06-01', amountCents: 20_000_000 }],
      until: '2027-05-01',
    });
    expect(mitSpaeterem.totalCents).toBe(ohne.totalCents);
  });
});

describe('Was ein Verzug kostet', () => {
  it('ist die Zahl, die eine Verschiebung greifbar macht', () => {
    // Zwei Monate später fertig, 400.000 € stehen noch bereit: 2.000 €.
    const zusatz = delayCostInCommitmentInterest(
      { ...STANDARD, until: '2027-05-01' },
      '2027-07-01',
    );
    expect(zusatz).toBe(200_000);
  });

  it('ist null, wenn der Endtermin nicht später wird', () => {
    expect(delayCostInCommitmentInterest({ ...STANDARD, until: '2027-05-01' }, '2027-04-01')).toBe(
      0,
    );
  });
});

describe('Randfälle, die im Betrieb auftreten', () => {
  it('kein Darlehen, kein Zins', () => {
    expect(commitmentInterest({ ...STANDARD, loanAmountCents: 0 }).totalCents).toBe(0);
  });

  it('kein Zinssatz erfasst, kein Zins behauptet', () => {
    // Lieber nichts sagen als eine Zahl erfinden: Wer den Satz nicht kennt,
    // bekommt keine Schätzung, sondern eine Null und die Aufforderung, ihn
    // nachzutragen.
    expect(
      commitmentInterest({ ...STANDARD, ratePerYearBp: 0, until: '2027-12-01' }).totalCents,
    ).toBe(0);
  });

  it('keine bereitstellungsfreie Zeit', () => {
    const ergebnis = commitmentInterest({
      ...STANDARD,
      freeMonths: 0,
      until: '2026-05-01',
    });
    expect(ergebnis.chargeableFrom).toBe('2026-04-01');
    expect(ergebnis.totalCents).toBe(100_000);
  });
});
