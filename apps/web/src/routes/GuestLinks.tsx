/**
 * Abstimmungslinks ausstellen — die Bauherrenseite von Abschnitt 2.3.
 *
 * Der Link ist das Werkzeug, mit dem aus einseitigen Terminen abgestimmte
 * werden. Deshalb steht diese Seite nicht unter „Einstellungen", sondern im
 * Weg des Bauherrn: Wer einen Termin einträgt, will als Nächstes wissen, ob
 * das ausführende Unternehmen ihn kennt.
 *
 * Zwei Dinge sind hier anders als bei einer üblichen Einladungsmaske:
 *
 * 1. **Der Klartext des Links erscheint genau einmal.** Danach steht in der
 *    Datenbank nur sein Hash, und niemand kann ihn wiederherstellen — auch
 *    wir nicht. Wer ihn verliert, bekommt einen neuen Link, nicht denselben
 *    zurück. Die Seite sagt das, bevor der Nutzer wegklickt.
 * 2. **Was der Link darf, wird beim Ausstellen entschieden.** Die Scopes aus
 *    Abschnitt 2.3 schneiden die Rechte der Rolle zusätzlich zu: Ein
 *    Bestätigungslink kann bestätigen, mehr nicht.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import type { GuestLinkCreateRequest, GuestLinkSummary, GuestScope } from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Field, Pill, Select, TextInput } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { api } from '../lib/api';
import { GUEST_LOCALE_LABEL } from '../lib/guest-i18n';
import { formatDate } from '../lib/format';
import { ROLE_LABEL } from '../lib/roles';

/** Was ein Scope in der Sprache des Bauherrn bedeutet. */
const SCOPE_LABEL: Record<GuestScope, string> = {
  'confirm:task': 'Termine bestätigen und andere vorschlagen',
  'report:progress': 'Beginn und Ende melden',
  'view:trade': 'Nur die eigenen Vorgänge sehen',
  'view:project': 'Den ganzen Plan sehen',
};

/**
 * Voreinstellungen je Rolle.
 *
 * Sie sind der eigentliche Inhalt dieser Seite: Wer einen Generalunternehmer
 * einlädt, meint fast immer „bestätigen und melden". Eine leere Auswahl mit
 * vier Kästchen davor wäre formal richtig und praktisch eine Hürde.
 */
const VORGABE: Record<GuestLinkCreateRequest['role'], GuestScope[]> = {
  contractor: ['confirm:task', 'report:progress'],
  trade: ['confirm:task', 'report:progress', 'view:trade'],
  viewer: ['view:project'],
};

export function GuestLinks() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [frisch, setFrisch] = useState<{ url: string; name: string } | null>(null);
  const [kopiert, setKopiert] = useState(false);

  const links = useQuery({
    queryKey: ['guest-links', projectId],
    queryFn: () => api.guestLinks(projectId!),
    enabled: projectId !== undefined,
  });

  const anlegen = useMutation({
    mutationFn: (wunsch: GuestLinkCreateRequest) => api.createGuestLink(projectId!, wunsch),
    onSuccess: (angelegt) => {
      setFrisch({ url: angelegt.url, name: angelegt.link.displayName ?? 'Beteiligter' });
      setKopiert(false);
      void queryClient.invalidateQueries({ queryKey: ['guest-links', projectId] });
    },
  });

  const zurueckziehen = useMutation({
    mutationFn: (linkId: string) => api.revokeGuestLink(projectId!, linkId),
    onSuccess: (antwort) => queryClient.setQueryData(['guest-links', projectId], antwort),
  });

  return (
    <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Beteiligte einladen</h1>
        <p className="max-w-[38rem] text-body text-steel">
          Ein Link, kein Konto. Wer ihn öffnet, sieht seinen Termin und kann in einem Tipp
          antworten — auf der Baustelle, mit Handschuhen, in seiner Sprache.
        </p>
      </header>

      {/* Der Klartext, genau einmal. */}
      {frisch !== null ? (
        <Card className="flex flex-col gap-3 border-vivid-green">
          <span className="flex items-center gap-2 text-body-lg font-medium text-charcoal">
            <Check size={20} className="text-vivid-green" aria-hidden />
            Link für {frisch.name}
          </span>
          <p className="font-mono text-caption break-all text-charcoal">{frisch.url}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                void navigator.clipboard.writeText(frisch.url).then(() => setKopiert(true));
              }}
            >
              {kopiert ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {kopiert ? 'Kopiert' : 'Link kopieren'}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setFrisch(null)}>
              Fertig
            </Button>
          </div>
          <p className="text-caption text-steel">
            Schick ihn per Nachricht oder Mail. Wir zeigen ihn dir kein zweites Mal — in der
            Datenbank steht nur seine Prüfsumme. Geht er verloren, stell einfach einen neuen aus.
          </p>
        </Card>
      ) : null}

      <NeuerLink
        laeuft={anlegen.isPending}
        fehler={anlegen.error instanceof Error ? anlegen.error.message : null}
        anlegen={(wunsch) => anlegen.mutate(wunsch)}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-body font-medium text-charcoal">Ausgestellte Links</h2>
        {links.isPending ? (
          <p className="text-body text-steel">Wird geladen.</p>
        ) : (links.data?.links ?? []).length === 0 ? (
          <EmptyState text="Noch niemand eingeladen. Solange nur du Termine einträgst, bleibt jeder von ihnen eine einseitige Angabe." />
        ) : (
          <ul className="flex flex-col">
            {(links.data?.links ?? []).map((link) => (
              <li key={link.id}>
                <LinkZeile
                  link={link}
                  zurueckziehen={() => zurueckziehen.mutate(link.id)}
                  laeuft={zurueckziehen.isPending}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function NeuerLink({
  laeuft,
  fehler,
  anlegen,
}: {
  laeuft: boolean;
  fehler: string | null;
  anlegen: (wunsch: GuestLinkCreateRequest) => void;
}) {
  const [rolle, setRolle] = useState<GuestLinkCreateRequest['role']>('contractor');
  const [name, setName] = useState('');
  const [firma, setFirma] = useState('');
  const [mail, setMail] = useState('');
  const [gewerk, setGewerk] = useState('');
  const [sprache, setSprache] = useState<GuestLinkCreateRequest['locale']>('de');
  const [scopes, setScopes] = useState<GuestScope[]>(VORGABE.contractor);

  function rolleWechseln(neu: GuestLinkCreateRequest['role']): void {
    setRolle(neu);
    setScopes(VORGABE[neu]);
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-body font-medium text-charcoal">Neuen Link ausstellen</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Wer?">
          <Select
            value={rolle}
            onChange={(event) =>
              rolleWechseln(event.target.value as GuestLinkCreateRequest['role'])
            }
          >
            <option value="contractor">Generalunternehmer oder Bauleiter</option>
            <option value="trade">Einzelgewerk</option>
            <option value="viewer">Nur mitlesen</option>
          </Select>
        </Field>

        <Field label="Name">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jörg Baumeister"
          />
        </Field>

        <Field label="Firma">
          <TextInput value={firma} onChange={(event) => setFirma(event.target.value)} />
        </Field>

        <Field
          label="E-Mail"
          hint="Der Link wird daran gebunden. Eine abweichende Nutzung steht später im Protokoll."
        >
          <TextInput
            type="email"
            value={mail}
            onChange={(event) => setMail(event.target.value)}
          />
        </Field>

        {rolle === 'trade' ? (
          <Field label="Gewerk" hint="Ohne Gewerk sähe ein Einzelgewerk alles oder nichts.">
            <TextInput
              value={gewerk}
              onChange={(event) => setGewerk(event.target.value)}
              placeholder="fliesen"
            />
          </Field>
        ) : null}

        <Field label="Sprache" hint="Die Sprache hängt am Link, nicht am Handy.">
          <Select
            value={sprache}
            onChange={(event) =>
              setSprache(event.target.value as GuestLinkCreateRequest['locale'])
            }
          >
            {Object.entries(GUEST_LOCALE_LABEL).map(([wert, name_]) => (
              <option key={wert} value={wert}>
                {name_}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body font-medium text-charcoal">Was darf dieser Link?</legend>
        {(Object.keys(SCOPE_LABEL) as GuestScope[]).map((scope) => (
          <label key={scope} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) =>
                setScopes((vorher) =>
                  event.target.checked
                    ? [...vorher, scope]
                    : vorher.filter((eintrag) => eintrag !== scope),
                )
              }
              className="size-5 accent-midnight-ink"
            />
            <span className="text-body text-charcoal">{SCOPE_LABEL[scope]}</span>
          </label>
        ))}
      </fieldset>

      {fehler !== null ? <p className="text-caption text-alarm-red">{fehler}</p> : null}

      <Button
        variant="primary"
        size="field"
        disabled={laeuft || name.trim() === '' || scopes.length === 0}
        onClick={() =>
          anlegen({
            role: rolle,
            displayName: name.trim(),
            scopes,
            locale: sprache,
            daysValid: 180,
            ...(firma.trim() === '' ? {} : { company: firma.trim() }),
            ...(mail.trim() === '' ? {} : { email: mail.trim() }),
            ...(rolle === 'trade' && gewerk.trim() !== '' ? { tradeCode: gewerk.trim() } : {}),
          })
        }
      >
        {laeuft ? (
          <Loader2 size={20} className="animate-spin" aria-hidden />
        ) : (
          <Link2 size={20} aria-hidden />
        )}
        Link ausstellen
      </Button>
    </Card>
  );
}

function LinkZeile({
  link,
  zurueckziehen,
  laeuft,
}: {
  link: GuestLinkSummary;
  zurueckziehen: () => void;
  laeuft: boolean;
}) {
  const abgelaufen = new Date(link.expiresAt) < new Date();
  const tot = link.revokedAt !== null || abgelaufen;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-ash py-3 ${
        tot ? 'opacity-50' : ''
      }`}
    >
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-body-lg text-charcoal">
          {link.claimedName ?? link.displayName ?? 'Ohne Namen'}
          <Pill tone={link.role === 'viewer' ? 'neutral' : 'blue'}>{ROLE_LABEL[link.role]}</Pill>
          {link.tradeName === null ? null : <Pill tone="neutral">{link.tradeName}</Pill>}
          <Pill tone="neutral">{GUEST_LOCALE_LABEL[link.locale]}</Pill>
        </span>
        <span className="text-caption text-steel">
          {link.revokedAt !== null
            ? 'Zurückgezogen'
            : abgelaufen
              ? 'Abgelaufen'
              : `Gültig bis ${formatDate(link.expiresAt.slice(0, 10))}`}
          {' · '}
          {link.useCount === 0
            ? 'noch nicht geöffnet'
            : `${link.useCount}× geöffnet, zuletzt ${formatDate((link.lastUsedAt ?? '').slice(0, 10))}`}
        </span>
      </div>

      {tot ? null : (
        <Button variant="danger" size="sm" disabled={laeuft} onClick={zurueckziehen}>
          <Trash2 size={16} aria-hidden />
          Zurückziehen
        </Button>
      )}
    </div>
  );
}
