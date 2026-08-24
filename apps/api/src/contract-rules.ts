/**
 * Die Prüfregeln des Vertragsspiegels — Abschnitt 3.9.
 *
 * Fünf Regeln, und über allen fünf steht ein Satz, der wichtiger ist als jede
 * einzelne:
 *
 *     „Automatische **Hinweise**, nie Bewertungen."
 *
 * Der Unterschied ist nicht sprachliche Vorsicht. „Der Zahlungsplan summiert
 * sich auf 95 %, § 650m Abs. 1 BGB begrenzt Abschläge auf 90 %" ist eine
 * Auskunft: zwei Tatsachen, die der Bauherr nebeneinanderlegen kann. „Dein
 * Vertrag ist unwirksam" wäre eine Rechtsberatung — und die darf hier niemand
 * geben, weder das Produkt noch der Assistent.
 *
 * Deshalb nennt jede Regel drei Dinge und nicht mehr: **was im Vertrag steht**,
 * **was im Gesetz steht** und **wo genau**. Die Verbindung zwischen beidem
 * zieht der Bauherr, und wenn ihm das zu heikel ist, sein Anwalt.
 *
 * Reine Funktionen ohne Datenbank: Was hier geprüft wird, kommt als Parameter
 * herein. Damit sind alle fünf Regeln ohne Postgres prüfbar — und das ist der
 * Grund, warum sie in einer eigenen Datei stehen.
 */

import { LEGAL_HINT_SUFFIX, type ContractFinding } from '@meinbaulotse/shared';

export interface ContractFacts {
  contractType: 'verbraucherbauvertrag' | 'einzelgewerke' | 'sonstiges';
  contractualCompletion: string | null;
  buildDurationDays: number | null;
  contractSumCents: number | null;
  securityPct: number | null;
  buildingDescriptionComplete: boolean | null;
  /** Summe aller Abschläge in Prozent, ohne den Einbehalt. */
  paymentPlanPct: number;
  /** Summe der vereinbarten Nachträge. */
  changeOrderSumCents: number;
}

type Regel = (facts: ContractFacts) => Omit<ContractFinding, 'dismissedAt'> | null;

function euro(cents: number): string {
  return `${new Intl.NumberFormat('de-DE').format(Math.round(cents / 100))} €`;
}

function prozent(wert: number): string {
  return `${wert.toFixed(wert % 1 === 0 ? 0 : 1).replace('.', ',')} %`;
}

/**
 * Die fünf Regeln aus der Tabelle in Abschnitt 3.9, in derselben Reihenfolge.
 *
 * Jede gibt `null` zurück, wenn sie nichts zu sagen hat. Eine Regel, die
 * „alles in Ordnung" meldet, ist eine Regel zu viel: Der Vertragsspiegel soll
 * kurz sein, damit man ihn liest.
 */
const REGELN: readonly { key: string; run: Regel }[] = [
  {
    // § 650m Abs. 1 BGB gilt nur für Verbraucherbauverträge. Bei
    // Einzelgewerken gibt es diese Grenze nicht, und ein Hinweis darauf wäre
    // schlicht falsch.
    key: 'abschlaege_ueber_90',
    run: (facts) => {
      if (facts.contractType !== 'verbraucherbauvertrag') return null;
      if (facts.paymentPlanPct <= 90) return null;
      return {
        ruleKey: 'abschlaege_ueber_90',
        severity: 'warnung',
        message:
          `Der Zahlungsplan summiert sich auf ${prozent(facts.paymentPlanPct)}. ` +
          '§ 650m Abs. 1 BGB begrenzt Abschlagszahlungen bei Verbraucherbauverträgen auf ' +
          '90 % der Gesamtvergütung einschließlich Nachträgen. ' +
          LEGAL_HINT_SUFFIX,
        legalReference: '§ 650m Abs. 1 BGB',
      };
    },
  },
  {
    key: 'sicherheit_fehlt',
    run: (facts) => {
      if (facts.contractType !== 'verbraucherbauvertrag') return null;
      if (facts.securityPct !== null && facts.securityPct > 0) return null;
      const betrag =
        facts.contractSumCents === null
          ? ''
          : ` Das wären hier ${euro(Math.round(facts.contractSumCents * 0.05))}.`;
      return {
        ruleKey: 'sicherheit_fehlt',
        severity: 'warnung',
        message:
          'Eine Sicherheit für die rechtzeitige Herstellung ohne wesentliche Mängel ist nicht ' +
          'erfasst. § 650m Abs. 2 BGB sieht 5 % der Gesamtvergütung bei der ersten ' +
          `Abschlagszahlung vor, auf Verlangen des Unternehmers als Einbehalt.${betrag} ` +
          LEGAL_HINT_SUFFIX,
        legalReference: '§ 650m Abs. 2 BGB',
      };
    },
  },
  {
    key: 'nachtraege_ueber_10',
    run: (facts) => {
      if (facts.contractSumCents === null || facts.contractSumCents <= 0) return null;
      if (facts.changeOrderSumCents <= facts.contractSumCents * 0.1) return null;
      return {
        ruleKey: 'nachtraege_ueber_10',
        severity: 'hinweis',
        message:
          `Die Nachträge summieren sich auf ${euro(facts.changeOrderSumCents)} und übersteigen ` +
          `damit 10 % der ursprünglichen Vergütung von ${euro(facts.contractSumCents)}. ` +
          '§ 650m Abs. 2 S. 2 BGB sieht dann eine weitere Sicherheit von 5 % des ' +
          'zusätzlichen Vergütungsanspruchs vor. ' +
          LEGAL_HINT_SUFFIX,
        legalReference: '§ 650m Abs. 2 S. 2 BGB',
      };
    },
  },
  {
    key: 'kein_fertigstellungstermin',
    run: (facts) => {
      if (facts.contractualCompletion !== null) return null;
      if (facts.buildDurationDays !== null && facts.buildDurationDays > 0) return null;
      return {
        ruleKey: 'kein_fertigstellungstermin',
        severity: 'warnung',
        message:
          'Im Vertragsspiegel steht weder ein Fertigstellungstermin noch eine Bauzeitdauer. ' +
          '§ 650k Abs. 3 BGB verlangt bei Verbraucherbauverträgen verbindliche Angaben ' +
          'hierzu. Ohne einen der beiden Werte lässt sich außerdem nicht sagen, ob dein ' +
          'Bau im Plan liegt. ' +
          LEGAL_HINT_SUFFIX,
        legalReference: '§ 650k Abs. 3 BGB',
      };
    },
  },
  {
    key: 'baubeschreibung_unvollstaendig',
    run: (facts) => {
      if (facts.contractType !== 'verbraucherbauvertrag') return null;
      if (facts.buildingDescriptionComplete !== false) return null;
      return {
        ruleKey: 'baubeschreibung_unvollstaendig',
        severity: 'hinweis',
        message:
          'Du hast angegeben, dass die Baubeschreibung Punkte aus Art. 249 § 2 EGBGB nicht ' +
          'enthält. Dort steht, was sie mindestens beschreiben muss — unter anderem Art und ' +
          'Umfang der Leistungen, Gebäudedaten, Baustoffe, die Beschaffenheit der Ver- und ' +
          'Entsorgung sowie den Ausbaustandard. Fehlt etwas, gehen Zweifel bei der Auslegung ' +
          'zu Lasten des Unternehmers. ' +
          LEGAL_HINT_SUFFIX,
        legalReference: 'Art. 249 § 2 EGBGB',
      };
    },
  },
];

export function runContractChecks(facts: ContractFacts): Omit<ContractFinding, 'dismissedAt'>[] {
  return REGELN.map((regel) => regel.run(facts)).filter(
    (befund): befund is Omit<ContractFinding, 'dismissedAt'> => befund !== null,
  );
}

/** Alle Regelschlüssel — die Anwendung räumt damit veraltete Befunde ab. */
export const CONTRACT_RULE_KEYS: readonly string[] = REGELN.map((regel) => regel.key);
