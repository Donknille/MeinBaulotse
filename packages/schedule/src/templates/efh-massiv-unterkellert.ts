/**
 * Ablaufvorlage „Einfamilienhaus massiv, unterkellert" aus Abschnitt 7.2 der
 * Spezifikation.
 *
 * Diese Datei ist die **Erstbefüllung**, nicht die Laufzeitquelle. Zur Laufzeit
 * liest die Anwendung die Vorlage aus der Datenbank (`plan_template*`), damit
 * sie ohne Deployment pflegbar bleibt. Aus dieser Datei erzeugt
 * `packages/db` die Seed-Migration; hier steht sie zusätzlich, weil der
 * Berechnungskern sie für seinen Golden-Test braucht und dabei ohne
 * Datenbankzugriff auskommen muss.
 */

import type { PlanTemplate, PlanTemplateDependency, PlanTemplateTask } from '../instantiate.js';

export interface Phase {
  key: string;
  name: string;
  ordinal: number;
}

/** Die neun Bauphasen aus Abschnitt 7.1. */
export const PHASES: readonly Phase[] = [
  { key: 'vorbereitung', name: 'Vorbereitung und Vertrag', ordinal: 1 },
  { key: 'gruendung', name: 'Gründung und Keller', ordinal: 2 },
  { key: 'rohbau', name: 'Rohbau', ordinal: 3 },
  { key: 'dach_huelle', name: 'Dach und Gebäudehülle', ordinal: 4 },
  { key: 'rohinstallation', name: 'Rohinstallationen', ordinal: 5 },
  { key: 'ausbau', name: 'Innenausbau', ordinal: 6 },
  { key: 'endausbau', name: 'Endausbau', ordinal: 7 },
  { key: 'aussenanlagen', name: 'Außenanlagen', ordinal: 8 },
  { key: 'abnahme', name: 'Abnahme und Übergabe', ordinal: 9 },
];

export interface TradeSeed {
  code: string;
  name: string;
  sortOrder: number;
}

export const TRADES: readonly TradeSeed[] = [
  { code: 'gutachter', name: 'Gutachter', sortOrder: 10 },
  { code: 'vermesser', name: 'Vermesser', sortOrder: 20 },
  { code: 'gu', name: 'Generalunternehmer', sortOrder: 30 },
  { code: 'erdbau', name: 'Erdbau', sortOrder: 40 },
  { code: 'rohbau', name: 'Rohbau', sortOrder: 50 },
  { code: 'zimmerer', name: 'Zimmerer', sortOrder: 60 },
  { code: 'dachdecker', name: 'Dachdecker', sortOrder: 70 },
  { code: 'fensterbau', name: 'Fensterbau', sortOrder: 80 },
  { code: 'elektro', name: 'Elektro', sortOrder: 90 },
  { code: 'shk', name: 'Sanitär, Heizung, Klima', sortOrder: 100 },
  { code: 'pruefer', name: 'Prüfer', sortOrder: 110 },
  { code: 'putzer', name: 'Putzer', sortOrder: 120 },
  { code: 'trockenbau', name: 'Trockenbau', sortOrder: 130 },
  { code: 'estrich', name: 'Estrich', sortOrder: 140 },
  { code: 'fliesen', name: 'Fliesenleger', sortOrder: 150 },
  { code: 'tischler', name: 'Tischler', sortOrder: 160 },
  { code: 'maler', name: 'Maler', sortOrder: 170 },
  { code: 'bodenleger', name: 'Bodenleger', sortOrder: 180 },
  { code: 'treppenbau', name: 'Treppenbau', sortOrder: 190 },
  { code: 'galabau', name: 'Garten- und Landschaftsbau', sortOrder: 200 },
  { code: 'reinigung', name: 'Reinigung', sortOrder: 210 },
];

type Row = [
  code: string,
  name: string,
  tradeCode: string | null,
  phaseKey: string,
  durationDays: number,
  unit: 'werktage' | 'kalendertage',
  flags: '' | 'milestone' | 'wait',
  includeWhen: 'always' | 'with_basement' | 'without_basement',
];

/** Reihenfolge und Nummerierung entsprechen der Tabelle in Abschnitt 7.2. */
const ROWS: readonly Row[] = [
  ['t01', 'Baugrundgutachten', 'gutachter', 'vorbereitung', 10, 'werktage', '', 'always'],
  ['t02', 'Vermessung, Absteckung, Schnurgerüst', 'vermesser', 'vorbereitung', 1, 'werktage', '', 'always'],
  ['t03', 'Baustelleneinrichtung, Bauwasser, Baustrom', 'gu', 'vorbereitung', 2, 'werktage', '', 'always'],
  ['t04', 'Erdarbeiten, Baugrube', 'erdbau', 'gruendung', 3, 'werktage', '', 'always'],
  ['t05', 'Sauberkeitsschicht, Fundamenterder', 'rohbau', 'gruendung', 2, 'werktage', '', 'always'],
  ['t06', 'Bodenplatte', 'rohbau', 'gruendung', 4, 'werktage', '', 'always'],
  ['t07', 'Aushärtung Bodenplatte', null, 'gruendung', 3, 'kalendertage', 'wait', 'always'],
  ['t08', 'Kellerwände', 'rohbau', 'gruendung', 8, 'werktage', '', 'with_basement'],
  ['t09', 'Kellerdecke', 'rohbau', 'gruendung', 4, 'werktage', '', 'with_basement'],
  ['t10', 'Abdichtung, Perimeterdämmung, Drainage', 'rohbau', 'gruendung', 3, 'werktage', '', 'with_basement'],
  ['t11', 'Verfüllung Arbeitsraum', 'erdbau', 'gruendung', 2, 'werktage', '', 'with_basement'],
  ['t12', 'Erdgeschoss-Mauerwerk', 'rohbau', 'rohbau', 8, 'werktage', '', 'always'],
  ['t13', 'Geschossdecke EG', 'rohbau', 'rohbau', 4, 'werktage', '', 'always'],
  ['t14', 'Obergeschoss, Drempel, Ringanker', 'rohbau', 'rohbau', 7, 'werktage', '', 'always'],
  ['t15', 'Rohbau fertig, Richtfest', null, 'rohbau', 0, 'werktage', 'milestone', 'always'],
  ['t16', 'Dachstuhl', 'zimmerer', 'dach_huelle', 4, 'werktage', '', 'always'],
  ['t17', 'Dacheindeckung, Klempnerarbeiten', 'dachdecker', 'dach_huelle', 6, 'werktage', '', 'always'],
  ['t18', 'Fenster und Haustür', 'fensterbau', 'dach_huelle', 3, 'werktage', '', 'always'],
  ['t19', 'Gebäude dicht', null, 'dach_huelle', 0, 'werktage', 'milestone', 'always'],
  ['t20', 'Rohinstallation Elektro', 'elektro', 'rohinstallation', 8, 'werktage', '', 'always'],
  ['t21', 'Rohinstallation Sanitär und Heizung', 'shk', 'rohinstallation', 8, 'werktage', '', 'always'],
  ['t22', 'Lüftungsanlage', 'shk', 'rohinstallation', 4, 'werktage', '', 'always'],
  ['t23', 'Blower-Door-Vorabtest', 'pruefer', 'rohinstallation', 1, 'werktage', '', 'always'],
  ['t24', 'Innenputz', 'putzer', 'ausbau', 8, 'werktage', '', 'always'],
  ['t25', 'Trockenbau, Dachgeschossausbau', 'trockenbau', 'ausbau', 10, 'werktage', '', 'always'],
  ['t26', 'Estrich', 'estrich', 'ausbau', 3, 'werktage', '', 'always'],
  ['t27', 'Trocknung bis Belegreife', null, 'ausbau', 35, 'kalendertage', 'wait', 'always'],
  ['t28', 'Fliesenarbeiten', 'fliesen', 'endausbau', 8, 'werktage', '', 'always'],
  ['t29', 'Innentüren', 'tischler', 'endausbau', 3, 'werktage', '', 'always'],
  ['t30', 'Malerarbeiten', 'maler', 'endausbau', 8, 'werktage', '', 'always'],
  ['t31', 'Bodenbeläge', 'bodenleger', 'endausbau', 5, 'werktage', '', 'always'],
  ['t32', 'Treppe', 'treppenbau', 'endausbau', 2, 'werktage', '', 'always'],
  ['t33', 'Endmontage Elektro', 'elektro', 'endausbau', 4, 'werktage', '', 'always'],
  ['t34', 'Endmontage Sanitär', 'shk', 'endausbau', 4, 'werktage', '', 'always'],
  ['t35', 'Außenanlagen, Zufahrt, Pflaster', 'galabau', 'aussenanlagen', 10, 'werktage', '', 'always'],
  ['t36', 'Baureinigung', 'reinigung', 'abnahme', 2, 'werktage', '', 'always'],
  ['t37', 'Abnahme und Übergabe', null, 'abnahme', 0, 'werktage', 'milestone', 'always'],
  ['t38', 'Schlussrechnung, Restzahlung', null, 'abnahme', 0, 'werktage', 'milestone', 'always'],
];

/** Vorgänger je Vorgang, exakt nach der Spalte „Vorgänger" aus 7.2. */
const PREDECESSORS: Readonly<Record<string, readonly string[]>> = {
  t03: ['t02'],
  t04: ['t03'],
  t05: ['t04'],
  t06: ['t05'],
  t07: ['t06'],
  t08: ['t07'],
  t09: ['t08'],
  t10: ['t09'],
  t11: ['t10'],
  t12: ['t09'],
  t13: ['t12'],
  t14: ['t13'],
  t15: ['t14'],
  t16: ['t15'],
  t17: ['t16'],
  t18: ['t16'],
  t19: ['t17', 't18'],
  t20: ['t19'],
  t21: ['t19'],
  t22: ['t21'],
  t23: ['t20', 't21', 't22'],
  t24: ['t23'],
  t25: ['t23'],
  t26: ['t24', 't25'],
  t27: ['t26'],
  t28: ['t27'],
  t29: ['t24'],
  t30: ['t28', 't29'],
  t31: ['t30'],
  t32: ['t30'],
  t33: ['t31'],
  t34: ['t28', 't31'],
  t35: ['t19'],
  t36: ['t33', 't34'],
  t37: ['t36'],
  t38: ['t37'],
};

const TASKS: readonly PlanTemplateTask[] = ROWS.map((row, index) => {
  const [code, name, tradeCode, phaseKey, durationDays, durationUnit, flags, includeWhen] = row;
  return {
    code,
    name,
    phaseKey,
    durationDays,
    durationUnit,
    isMilestone: flags === 'milestone',
    isWait: flags === 'wait',
    includeWhen,
    sortOrder: (index + 1) * 10,
    ...(tradeCode === null ? {} : { tradeCode }),
  };
});

const DEPENDENCIES: readonly PlanTemplateDependency[] = Object.entries(PREDECESSORS).flatMap(
  ([successorCode, predecessors]) =>
    predecessors.map((predecessorCode) => ({
      predecessorCode,
      successorCode,
      type: 'FS' as const,
      lagDays: 0,
      lagUnit: 'werktage' as const,
    })),
);

export const EFH_MASSIV_UNTERKELLERT: PlanTemplate = {
  key: 'efh_massiv_unterkellert',
  name: 'Einfamilienhaus massiv, unterkellert',
  tasks: TASKS,
  dependencies: DEPENDENCIES,
};
