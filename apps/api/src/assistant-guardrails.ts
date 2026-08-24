/**
 * Die Leitplanken aus Abschnitt 3.7 — als Code, nicht als Bitte.
 *
 * Der Systemprompt enthält sie ebenfalls, und ein gutes Modell hält sich
 * daran. Aber „hält sich meistens daran" ist bei Rechtsfragen und
 * Mängelbeurteilungen die falsche Zusicherung: Genau die eine Antwort, in der
 * der Hinweis fehlt, ist die, die vor Gericht zitiert wird.
 *
 * Deshalb zweimal:
 *
 *   1. Der Systemprompt bekommt für die erkannte Fragenart eine zusätzliche,
 *      ausdrückliche Anweisung. Das ist die weiche Ebene — sie formt die
 *      Antwort.
 *   2. Der Hinweis wird der fertigen Antwort **angehängt**, ob das Modell ihn
 *      selbst schon gab oder nicht. Das ist die harte Ebene — sie garantiert
 *      ihn.
 *
 * Die zweite Ebene ist der Grund, warum diese Datei ohne Netz prüfbar ist. Ob
 * ein Anwaltshinweis unter einer Rechtsfrage steht, entscheidet hier eine
 * Zeichenkette, kein Sprachmodell.
 */

export type Guardrail = 'recht' | 'mangel' | 'kosten';

/**
 * Was eine Frage zu einer Rechtsfrage macht.
 *
 * Bewusst eng gehalten. „Verzug" allein reicht nicht — das Wort steht in jeder
 * zweiten Frage nach einem Termin, und ein Anwaltshinweis unter „warum ist der
 * Estrich in Verzug" wäre die Sorte Warnung, die man nach dreimal überliest.
 * Was zählt, sind Wörter, die es außerhalb eines rechtlichen Zusammenhangs
 * nicht gibt.
 */
const RECHT: readonly RegExp[] = [
  /§/,
  /\bbgb\b/i,
  /\bvob\b/i,
  /\begbgb\b/i,
  /verjähr/i,
  /gewährleist/i,
  /\bkündig/i,
  /\bklag(e|en|t)\b/i,
  /anwalt|anwält|rechtsanwalt/i,
  /vertragsstrafe/i,
  /schadenersatz|schadensersatz/i,
  /\bhaftung\b|\bhaftbar\b/i,
  /\bminderung\b/i,
  /\bzurückbehalt/i,
  /\bmahnung\b|\bin verzug setzen\b/i,
  /\babnahmeverweigerung\b/i,
  /\brechtlich\b|\brechtens\b|\bdarf (er|der gu|die firma)\b/i,
];

/**
 * Was eine Frage zu einer Mängelbeurteilung macht.
 *
 * Zwei Bedingungen, und beide müssen zutreffen: Es geht um einen Befund am Bau
 * **und** um dessen Bewertung. „Wann wird der Estrich geschliffen" nennt keinen
 * Befund; „hier ist ein Riss" nennt einen, fragt aber nichts. Erst
 * „hier ist ein Riss — ist das schlimm?" ist die Frage, die ein
 * Sachverständiger beantworten muss und kein Sprachmodell.
 */
const BEFUND: readonly RegExp[] = [
  /\bmangel\b|\bmängel\b|\bmangelhaft\b/i,
  /\briss\b|\brisse\b|\brissbildung\b/i,
  /\bfeucht/i,
  /\bschimmel\b/i,
  /\babplatzung|\babgeplatzt\b/i,
  /\bhohlstelle|\bhohl klingt\b/i,
  /\bkiesnest\b|\blunker\b/i,
  /\bverfärb/i,
  /\bschief\b|\buneben\b|\bnicht im lot\b|\bnicht in waage\b/i,
  /\bfleck(en)?\b/i,
];

const BEWERTUNG: readonly RegExp[] = [
  /ist das (schlimm|normal|ein mangel|noch in ordnung|so richtig|zulässig)/i,
  /muss das so/i,
  /darf das so/i,
  /\bfoto\b|\bbild\b|\baufnahme\b/i,
  /siehst du|erkennst du|was sagst du dazu/i,
  /\bschlimm\b|\bnormal\b|\bin ordnung\b|\bakzeptabel\b|\btolerierbar\b/i,
  /\bbedenklich\b|\bgefährlich\b/i,
];

const KOSTEN: readonly RegExp[] = [
  /\bkostet\b|\bkosten\b|\bpreis\b|\bpreise\b/i,
  /\bteuer\b|\bgünstig\b/i,
  /\beuro\b|€/,
  /\bbudget\b/i,
  /was zahle ich|was muss ich zahlen/i,
];

const trifft = (muster: readonly RegExp[], text: string): boolean =>
  muster.some((regel) => regel.test(text));

export function classifyQuestion(question: string): Guardrail[] {
  const gefunden: Guardrail[] = [];
  if (trifft(RECHT, question)) gefunden.push('recht');
  if (trifft(BEFUND, question) && trifft(BEWERTUNG, question)) gefunden.push('mangel');
  if (trifft(KOSTEN, question)) gefunden.push('kosten');
  return gefunden;
}

/**
 * Was dem Modell zusätzlich gesagt wird, wenn eine Leitplanke greift.
 *
 * Formuliert als Anweisung, nicht als Verbot. „Antworte mit der Gesetzesstelle"
 * bringt eine brauchbare Antwort; „gib keine Rechtsberatung" bringt eine
 * Ausrede.
 */
export const GUARDRAIL_INSTRUCTION: Record<Guardrail, string> = {
  recht:
    'Diese Frage hat einen rechtlichen Kern. Nenne die einschlägige Gesetzesstelle ' +
    '(BGB, VOB/B, EGBGB) und was dort steht — sachlich, ohne sie auf diesen Fall ' +
    'anzuwenden. Sag ausdrücklich, dass die Bewertung des Einzelfalls zu einem ' +
    'Anwalt gehört. Bewerte nicht, wer im Recht ist.',
  mangel:
    'Diese Frage zielt auf die Bewertung eines Befundes am Bau. Beschreibe, was ' +
    'typischerweise dahintersteckt und woran man es unterscheidet, aber urteile ' +
    'nicht, ob es ein Mangel ist — das kann niemand aus der Ferne und schon gar ' +
    'nicht von einem Foto. Verweise auf einen Bausachverständigen vor Ort und ' +
    'sag, was der Bauherr bis dahin dokumentieren sollte.',
  kosten:
    'Diese Frage berührt Geld. Nenne höchstens Größenordnungen und sag dazu, ' +
    'woher sie stammen. Gib keine Zahl, die als verbindliche Schätzung ' +
    'missverstanden werden kann — verbindlich ist nur ein Angebot.',
};

/**
 * Der feste Zusatz, der an die Antwort gehängt wird.
 *
 * Wortlaut für `recht` aus CI 11.3, unverändert. Die anderen beiden folgen
 * demselben Bau: ein Satz, der sagt, wo die Grenze dieser Auskunft liegt, und
 * ein zweiter, der den nächsten Schritt nennt. Eine Grenze ohne nächsten
 * Schritt wäre gegen Regel 8 — auch schlechte Nachrichten kommen mit einem
 * Weg nach vorn.
 */
export const GUARDRAIL_NOTE: Record<Guardrail, string> = {
  recht:
    'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung. Ob sie in deinem Fall ' +
    'greift, sagt dir ein Anwalt für Bau- und Architektenrecht — für die erste ' +
    'Einschätzung genügt oft ein Beratungsgespräch.',
  mangel:
    'Ob das ein Mangel ist, entscheidet niemand aus der Ferne. Das kann nur ein ' +
    'Bausachverständiger vor Ort, und bis dahin hilft eines: fotografieren, mit ' +
    'Maßstab daneben, und ins Bautagebuch eintragen.',
  kosten:
    'Größenordnungen, keine Kostenschätzung. Verbindlich ist allein ein Angebot — ' +
    'hol dir zwei, dann siehst du auch, wie belastbar die Zahl ist.',
};

/**
 * Hängt die fälligen Hinweise an die Antwort.
 *
 * Bewusst auch dann, wenn das Modell sie schon selbst gab: Ein doppelter
 * Hinweis ist eine Doppelung, ein fehlender ist ein Fehler. Wiederholt wird
 * nur, was wörtlich schon dasteht — das fängt den häufigsten Fall ab, ohne
 * sich auf eine Ähnlichkeitsprüfung zu verlassen.
 */
export function withGuardrailNotes(answer: string, guardrails: readonly Guardrail[]): string {
  const fehlende = guardrails
    .map((rail) => GUARDRAIL_NOTE[rail])
    .filter((note) => !answer.includes(note));
  if (fehlende.length === 0) return answer;
  return `${answer.trimEnd()}\n\n${fehlende.join('\n\n')}`;
}
