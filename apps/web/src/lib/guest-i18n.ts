/**
 * Die Abstimmungsseite in fünf Sprachen — Abschnitt 2.3.
 *
 *     „Mehrsprachig ausliefern (de, pl, ro, tr, en) — erhöht die Rücklaufquote
 *      auf der Baustelle spürbar und kostet fast nichts."
 *
 * Beides stimmt, und das Zweite ist der Grund, warum hier kein
 * Übersetzungsrahmenwerk steht. Fünfundzwanzig kurze Sätze rechtfertigen keine
 * Bibliothek mit Namensräumen, Pluralregeln und Ladevorgängen — sie
 * rechtfertigen ein getyptes Objekt, bei dem der Übersetzer eine fehlende
 * Zeile sofort als Fehler sieht.
 *
 * Die Sätze sind bewusst kurz und ohne Fachsprache gehalten. Wer sie liest,
 * steht auf einer Baustelle, hält das Handy in einer Hand und ist womöglich in
 * keiner dieser fünf Sprachen zu Hause. „Passt" ist besser als „Termin
 * bestätigen", in jeder Sprache.
 *
 * **Vor dem ersten echten Einsatz gehören pl, ro und tr einmal durch
 * muttersprachliche Augen.** Die Sätze sind sorgfältig gewählt, aber eine
 * Baustelle ist kein Ort für halb richtige Höflichkeitsformen — und der
 * Unterschied zwischen „passt" und „passt schon" entscheidet, ob jemand
 * antwortet.
 */

import type { GuestLocale } from '@meinbaulotse/shared';

export interface GuestStrings {
  site: string;
  question: string;
  confirm: string;
  counter: string;
  reportStart: string;
  reportEnd: string;
  yourName: string;
  company: string;
  continue: string;
  send: string;
  cancel: string;
  newStart: string;
  newEnd: string;
  reason: string;
  thanks: string;
  expired: string;
  nothingOpen: string;
  loading: string;
  whoAreYou: string;
  confirmed: string;
  statedByOwner: string;
  statedByCompany: string;
  twoDates: string;
  yourAnswer: string;
  ownerSees: string;
  notYet: string;
  done: string;
}

/**
 * Deutsch ist die Vorlage, an der alles Weitere gemessen wird. Steht hier ein
 * Satz mit zwei Nebensätzen, ist er in den anderen vier Sprachen auch einer.
 */
const de: GuestStrings = {
  site: 'Baustelle',
  question: 'Passt das?',
  confirm: 'Passt',
  counter: 'Anderer Termin',
  reportStart: 'Angefangen',
  reportEnd: 'Fertig',
  yourName: 'Dein Name',
  company: 'Firma',
  continue: 'Weiter',
  send: 'Senden',
  cancel: 'Zurück',
  newStart: 'Neuer Beginn',
  newEnd: 'Neues Ende',
  reason: 'Warum? (freiwillig)',
  thanks: 'Danke.',
  expired: 'Dieser Link gilt nicht mehr. Frag bitte beim Bauherrn nach einem neuen.',
  nothingOpen: 'Gerade ist nichts abzustimmen.',
  loading: 'Einen Moment.',
  whoAreYou: 'Wer bist du?',
  confirmed: 'Abgestimmt',
  statedByOwner: 'Vom Bauherrn eingetragen',
  statedByCompany: 'Von dir genannt',
  twoDates: 'Zwei Angaben',
  yourAnswer: 'Dein Vorschlag',
  ownerSees: 'Der Bauherr sieht das sofort.',
  notYet: 'Offen',
  done: 'Erledigt',
};

const en: GuestStrings = {
  site: 'Site',
  question: 'Does this work?',
  confirm: 'Works',
  counter: 'Different date',
  reportStart: 'Started',
  reportEnd: 'Finished',
  yourName: 'Your name',
  company: 'Company',
  continue: 'Continue',
  send: 'Send',
  cancel: 'Back',
  newStart: 'New start',
  newEnd: 'New end',
  reason: 'Why? (optional)',
  thanks: 'Thank you.',
  expired: 'This link is no longer valid. Please ask the client for a new one.',
  nothingOpen: 'Nothing to agree on right now.',
  loading: 'One moment.',
  whoAreYou: 'Who are you?',
  confirmed: 'Agreed',
  statedByOwner: 'Entered by the client',
  statedByCompany: 'Stated by you',
  twoDates: 'Two dates',
  yourAnswer: 'Your proposal',
  ownerSees: 'The client sees this immediately.',
  notYet: 'Open',
  done: 'Done',
};

const pl: GuestStrings = {
  site: 'Budowa',
  question: 'Czy ten termin pasuje?',
  confirm: 'Pasuje',
  counter: 'Inny termin',
  reportStart: 'Zaczęte',
  reportEnd: 'Gotowe',
  yourName: 'Twoje imię i nazwisko',
  company: 'Firma',
  continue: 'Dalej',
  send: 'Wyślij',
  cancel: 'Wróć',
  newStart: 'Nowy początek',
  newEnd: 'Nowy koniec',
  reason: 'Dlaczego? (opcjonalnie)',
  thanks: 'Dziękujemy.',
  expired: 'Ten link już nie działa. Poproś inwestora o nowy.',
  nothingOpen: 'Teraz nie ma nic do uzgodnienia.',
  loading: 'Chwileczkę.',
  whoAreYou: 'Kim jesteś?',
  confirmed: 'Uzgodnione',
  statedByOwner: 'Wpisane przez inwestora',
  statedByCompany: 'Podane przez ciebie',
  twoDates: 'Dwie różne daty',
  yourAnswer: 'Twoja propozycja',
  ownerSees: 'Inwestor widzi to od razu.',
  notYet: 'Otwarte',
  done: 'Zrobione',
};

const ro: GuestStrings = {
  site: 'Șantier',
  question: 'Termenul se potrivește?',
  confirm: 'Se potrivește',
  counter: 'Alt termen',
  reportStart: 'Început',
  reportEnd: 'Terminat',
  yourName: 'Numele tău',
  company: 'Firma',
  continue: 'Continuă',
  send: 'Trimite',
  cancel: 'Înapoi',
  newStart: 'Început nou',
  newEnd: 'Sfârșit nou',
  reason: 'De ce? (opțional)',
  thanks: 'Mulțumim.',
  expired: 'Acest link nu mai este valabil. Cere beneficiarului unul nou.',
  nothingOpen: 'Momentan nu este nimic de stabilit.',
  loading: 'Un moment.',
  whoAreYou: 'Cine ești?',
  confirmed: 'Stabilit',
  statedByOwner: 'Introdus de beneficiar',
  statedByCompany: 'Indicat de tine',
  twoDates: 'Două date diferite',
  yourAnswer: 'Propunerea ta',
  ownerSees: 'Beneficiarul vede imediat.',
  notYet: 'Deschis',
  done: 'Gata',
};

const tr: GuestStrings = {
  site: 'Şantiye',
  question: 'Bu tarih uygun mu?',
  confirm: 'Uygun',
  counter: 'Başka tarih',
  reportStart: 'Başladı',
  reportEnd: 'Bitti',
  yourName: 'Adınız',
  company: 'Firma',
  continue: 'Devam',
  send: 'Gönder',
  cancel: 'Geri',
  newStart: 'Yeni başlangıç',
  newEnd: 'Yeni bitiş',
  reason: 'Neden? (isteğe bağlı)',
  thanks: 'Teşekkürler.',
  expired: 'Bu bağlantı artık geçerli değil. Lütfen yapı sahibinden yeni bir tane isteyin.',
  nothingOpen: 'Şu anda kararlaştırılacak bir şey yok.',
  loading: 'Bir dakika.',
  whoAreYou: 'Kimsiniz?',
  confirmed: 'Onaylandı',
  statedByOwner: 'Yapı sahibi girdi',
  statedByCompany: 'Sizin bildirdiğiniz',
  twoDates: 'İki farklı tarih',
  yourAnswer: 'Öneriniz',
  ownerSees: 'Yapı sahibi bunu hemen görür.',
  notYet: 'Açık',
  done: 'Tamam',
};

const ALLE: Record<GuestLocale, GuestStrings> = { de, en, pl, ro, tr };

export function stringsFor(locale: GuestLocale): GuestStrings {
  return ALLE[locale] ?? de;
}

/**
 * Ein Datumsbereich in der Sprache des Empfängers.
 *
 * `Intl` kann das, ohne dass eine einzige Zeichenkette hier stehen müsste —
 * und es kennt die Eigenheiten, die man beim Nachbauen übersieht: Im Türkischen
 * steht der Monat hinter dem Tag mit Punkt, im Rumänischen mit Punkt und ohne
 * führende Null.
 */
export function formatGuestRange(
  start: string | null,
  end: string | null,
  locale: GuestLocale,
): string {
  if (start === null && end === null) return '—';
  const format = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const tag = (iso: string): string => format.format(new Date(`${iso}T12:00:00Z`));
  if (start === null) return tag(end!);
  if (end === null || end === start) return tag(start);
  return `${tag(start)} – ${tag(end)}`;
}

/** Die Sprachen als Auswahl, jede in sich selbst benannt. */
export const GUEST_LOCALE_LABEL: Record<GuestLocale, string> = {
  de: 'Deutsch',
  en: 'English',
  pl: 'Polski',
  ro: 'Română',
  tr: 'Türkçe',
};
