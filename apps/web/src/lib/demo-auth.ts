/**
 * Testzugang im Browser.
 *
 * Solange kein Mailversand eingerichtet ist, kommt niemand über den Magic Link
 * in die Anwendung. Diese Datei hält deshalb ein zweites, klar getrenntes
 * Anmeldegedächtnis: ein Token vom eigenen Server, im `localStorage`, mit
 * eigenem Schlüssel.
 *
 * Bewusst neben und nicht in der Supabase-Sitzung. Wenn der Mailversand steht,
 * fällt diese Datei samt `/demo` ersatzlos weg — an der echten Anmeldung wurde
 * dafür nichts geändert.
 */

const STORAGE_KEY = 'mbl.demo-session';

/**
 * Der Schlüssel aus dem Link, gemerkt für den Rollenwechsel.
 *
 * „Rolle wechseln" führt zurück auf `/demo`, und dort steht kein `key` in der
 * Adresse. Ohne dieses Gedächtnis stünde man vor einem Eingabefeld, obwohl man
 * gerade angemeldet war. Der Schlüssel liegt damit im Browser, so wie er
 * ohnehin in der Adresszeile und im Verlauf steht.
 */
const KEY_STORAGE = 'mbl.demo-key';

export interface DemoSession {
  token: string;
  role: string;
  label: string;
  displayName: string;
  projectRole: string;
}

/** Wird bei jedem Wechsel gefeuert, damit `App` die Sitzung neu einliest. */
const CHANGE_EVENT = 'mbl:demo-session';

export function readDemoSession(): DemoSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    return typeof parsed.token === 'string' && parsed.token !== '' ? parsed : null;
  } catch {
    // Kaputter Eintrag ist wie kein Eintrag — die Anmeldemaske hilft weiter.
    return null;
  }
}

export function writeDemoSession(session: DemoSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Wirft die Sitzung weg, **behält aber den Schlüssel**.
 *
 * Für den Fall, dass ein Token abgelaufen ist. Das passiert nach zwölf Stunden
 * zwangsläufig, und es ist kein Grund, den Türschlüssel wegzuwerfen: Das Token
 * ist verbraucht, der Schlüssel aus dem Link nicht. Wer ihn behält, ist einen
 * Klick von einem neuen Token entfernt; wer ihn verliert, steht vor
 * „Dieser Link ist nicht vollständig" und muss den Link suchen gehen.
 *
 * Genau das ist im Betrieb passiert — über Nacht lief das Token ab, der erste
 * Aufruf am Morgen kam mit 401 zurück, und die Aufräumaktion nahm den
 * Schlüssel gleich mit.
 */
export function clearDemoSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Räumt vollständig auf: Sitzung **und** Schlüssel.
 *
 * Nur für „Abmelden". Wer sich bewusst abmeldet, soll ohne den Link nicht
 * wieder hineinkommen — sonst wäre das Abmelden auf einem geteilten Rechner
 * eine Geste ohne Wirkung.
 */
export function forgetDemoAccess(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(KEY_STORAGE);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readDemoKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function onDemoSessionChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  // Ein zweiter Tab meldet sich über `storage`; ohne das bliebe er angemeldet,
  // nachdem sich der erste abgemeldet hat.
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * Die Anmeldung geht per GET, ohne Anfragekörper.
 *
 * Das ist eine Lehre aus dem Betrieb: Der Körper einer POST-Anfrage erreichte
 * die Vercel-Function nicht, sie antwortete gar nicht, und der Knopf blieb auf
 * „Einen Moment." stehen, bis die Plattform mit 504 abbrach. Ohne Körper kann
 * das nicht passieren. Der Schlüssel steht ohnehin im Link.
 */
export async function startDemoSession(role: string, key: string): Promise<DemoSession> {
  const query = new URLSearchParams({ role, key });
  const response = await fetch(`/api/demo/session?${query.toString()}`, {
    headers: { accept: 'application/json' },
  });

  const body = (await response.json().catch(() => null)) as
    (DemoSession & { error?: string }) | null;

  if (!response.ok || body === null) {
    throw new Error(body?.error ?? 'Die Anmeldung hat nicht geklappt.');
  }

  writeDemoSession(body);
  window.localStorage.setItem(KEY_STORAGE, key);
  return body;
}
