/**
 * Die Abstimmungsseite in fünf Sprachen.
 *
 * Abschnitt 2.3: „Mehrsprachig ausliefern (de, pl, ro, tr, en) — erhöht die
 * Rücklaufquote auf der Baustelle spürbar und kostet fast nichts."
 *
 * Deshalb steht hier eine Tabelle und keine Bibliothek: Es sind zwei Dutzend
 * Sätze auf einer einzigen Seite, die jemand einmal öffnet und in zehn
 * Sekunden wieder schließt. Eine Übersetzungsschicht mit Ladevorgang wäre
 * schwerer als die Seite selbst.
 *
 * Die Sprache steht am Gast-Token, nicht im Browser: Der Bauherr weiß, in
 * welcher Sprache er einlädt.
 */

import type { GuestLocale } from '@meinbaulotse/shared';

export interface GuestTexts {
  title: string;
  intro: string;
  scheduled: string;
  question: string;
  yes: string;
  other: string;
  otherDate: string;
  note: string;
  send: string;
  cancel: string;
  thanksYes: string;
  thanksOther: string;
  waiting: string;
  linkInvalid: string;
  linkInvalidHint: string;
  readOnly: string;
  nothing: string;
  wait: string;
  answeredYes: string;
  answeredOther: string;
}

/**
 * Deutsch ist die Ausgangsfassung; die anderen folgen ihr Satz für Satz.
 *
 * Der Ton ist derselbe wie im übrigen Produkt: kurze Sätze, kein Passiv,
 * keine Ausrufezeichen. „Passt das?" ist eine Frage an einen Menschen, der
 * gerade auf einer Baustelle steht.
 */
export const GUEST_TEXTS: Readonly<Record<GuestLocale, GuestTexts>> = {
  de: {
    title: 'Baustelle',
    intro: 'Du musst dich nicht anmelden. Ein Klick genügt.',
    scheduled: 'Eingetragen ist',
    question: 'Passt das?',
    yes: 'Passt',
    other: 'Anderer Termin',
    otherDate: 'Wann passt es?',
    note: 'Kurz warum (freiwillig)',
    send: 'Antwort senden',
    cancel: 'Zurück',
    thanksYes: 'Danke. Der Termin gilt jetzt als abgestimmt.',
    thanksOther: 'Danke. Der Bauherr sieht deinen Vorschlag.',
    waiting: 'Wird gesendet.',
    linkInvalid: 'Dieser Link gilt nicht mehr.',
    linkInvalidHint: 'Bitte den Bauherrn um einen neuen. Links laufen nach 180 Tagen ab.',
    readOnly: 'Dieser Link ist zum Mitlesen.',
    nothing: 'Zurzeit steht nichts zur Abstimmung an.',
    wait: 'Wartezeit — nicht verkürzbar.',
    answeredYes: 'Von dir bestätigt.',
    answeredOther: 'Du hast einen anderen Termin genannt.',
  },
  en: {
    title: 'Site',
    intro: 'No sign-in needed. One tap is enough.',
    scheduled: 'Scheduled',
    question: 'Does that work?',
    yes: 'Works',
    other: 'Different date',
    otherDate: 'When would work?',
    note: 'Briefly why (optional)',
    send: 'Send answer',
    cancel: 'Back',
    thanksYes: 'Thank you. The date now counts as agreed.',
    thanksOther: 'Thank you. The client can see your proposal.',
    waiting: 'Sending.',
    linkInvalid: 'This link is no longer valid.',
    linkInvalidHint: 'Ask the client for a new one. Links expire after 180 days.',
    readOnly: 'This link is read-only.',
    nothing: 'Nothing to confirm right now.',
    wait: 'Waiting time — cannot be shortened.',
    answeredYes: 'Confirmed by you.',
    answeredOther: 'You proposed a different date.',
  },
  pl: {
    title: 'Budowa',
    intro: 'Nie musisz się logować. Wystarczy jedno kliknięcie.',
    scheduled: 'Zaplanowano',
    question: 'Czy to pasuje?',
    yes: 'Pasuje',
    other: 'Inny termin',
    otherDate: 'Kiedy pasuje?',
    note: 'Krótko dlaczego (opcjonalnie)',
    send: 'Wyślij odpowiedź',
    cancel: 'Wstecz',
    thanksYes: 'Dziękujemy. Termin jest teraz uzgodniony.',
    thanksOther: 'Dziękujemy. Inwestor widzi twoją propozycję.',
    waiting: 'Wysyłanie.',
    linkInvalid: 'Ten link już nie działa.',
    linkInvalidHint: 'Poproś inwestora o nowy. Linki wygasają po 180 dniach.',
    readOnly: 'Ten link służy tylko do podglądu.',
    nothing: 'Obecnie nic nie wymaga potwierdzenia.',
    wait: 'Czas oczekiwania — nie da się skrócić.',
    answeredYes: 'Potwierdzone przez ciebie.',
    answeredOther: 'Zaproponowałeś inny termin.',
  },
  ro: {
    title: 'Șantier',
    intro: 'Nu trebuie să te autentifici. Un clic este suficient.',
    scheduled: 'Programat',
    question: 'Se potrivește?',
    yes: 'Se potrivește',
    other: 'Altă dată',
    otherDate: 'Când se potrivește?',
    note: 'Pe scurt de ce (opțional)',
    send: 'Trimite răspunsul',
    cancel: 'Înapoi',
    thanksYes: 'Mulțumim. Data este acum confirmată de ambele părți.',
    thanksOther: 'Mulțumim. Beneficiarul vede propunerea ta.',
    waiting: 'Se trimite.',
    linkInvalid: 'Acest link nu mai este valabil.',
    linkInvalidHint: 'Cere beneficiarului unul nou. Linkurile expiră după 180 de zile.',
    readOnly: 'Acest link este doar pentru vizualizare.',
    nothing: 'Momentan nu este nimic de confirmat.',
    wait: 'Timp de așteptare — nu poate fi scurtat.',
    answeredYes: 'Confirmat de tine.',
    answeredOther: 'Ai propus o altă dată.',
  },
  tr: {
    title: 'Şantiye',
    intro: 'Giriş yapmanız gerekmez. Bir tık yeterli.',
    scheduled: 'Planlanan',
    question: 'Uygun mu?',
    yes: 'Uygun',
    other: 'Başka tarih',
    otherDate: 'Ne zaman uygun?',
    note: 'Kısaca neden (isteğe bağlı)',
    send: 'Yanıtı gönder',
    cancel: 'Geri',
    thanksYes: 'Teşekkürler. Tarih artık karşılıklı onaylı.',
    thanksOther: 'Teşekkürler. Yapı sahibi önerinizi görüyor.',
    waiting: 'Gönderiliyor.',
    linkInvalid: 'Bu bağlantı artık geçerli değil.',
    linkInvalidHint: 'Yapı sahibinden yeni bir bağlantı isteyin. Bağlantılar 180 gün sonra sona erer.',
    readOnly: 'Bu bağlantı yalnızca okumak içindir.',
    nothing: 'Şu anda onaylanacak bir şey yok.',
    wait: 'Bekleme süresi — kısaltılamaz.',
    answeredYes: 'Sizin tarafınızdan onaylandı.',
    answeredOther: 'Farklı bir tarih önerdiniz.',
  },
};

export function textsFor(locale: string | undefined): GuestTexts {
  return GUEST_TEXTS[(locale ?? 'de') as GuestLocale] ?? GUEST_TEXTS.de;
}

/**
 * Datumsspanne ohne Sprachabhängigkeit.
 *
 * `12.–21.05.2026` liest sich in jeder der fünf Sprachen richtig, solange die
 * Reihenfolge Tag-Monat-Jahr bleibt. Übersetzte Monatsnamen wären hübscher
 * und eine Fehlerquelle mehr.
 */
export function guestRange(start: string | null, end: string | null): string {
  if (start === null) return '—';
  const [jahr, monat, tag] = start.split('-');
  if (end === null || end === start) return `${tag}.${monat}.${jahr}`;
  const [endJahr, endMonat, endTag] = end.split('-');
  if (jahr === endJahr && monat === endMonat) return `${tag}.–${endTag}.${monat}.${jahr}`;
  return `${tag}.${monat}.${jahr} – ${endTag}.${endMonat}.${endJahr}`;
}
