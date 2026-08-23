/**
 * Geld und Vertragsspiegel (Abschnitt 3.9 und 3.10).
 *
 * Zwei Dinge auf einer Seite, weil sie beim Bauherrn auch zusammen auftreten:
 * Er bekommt eine Rechnung und will wissen, ob er zahlen muss.
 *
 * Die Antwort darauf gibt diese Seite nicht — sie zeigt, was der Fall ist:
 * welche Vorgänge fertig sind, welcher Mangel offen ist, was der Zahlungsplan
 * vorsieht und welche Gesetzesstelle dazu gehört. Der Unterschied zwischen
 * „du musst nicht zahlen" und „§ 641 Abs. 3 BGB erlaubt einen Einbehalt in
 * Höhe des doppelten Beseitigungsaufwands" ist der ganze Unterschied zwischen
 * einer Rechtsberatung und einem Werkzeug.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeEuro, Landmark, Lock, Scale, ScrollText } from 'lucide-react';
import {
  LEGAL_DISCLAIMER,
  type ContractMirror,
  type MoneyView,
  type PaymentMilestoneDto,
} from '@meinbaulotse/shared';
import { Button, Card, Field, Pill } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';

const euro = (cents: number | null): string =>
  cents === null ? '—' : `${Math.round(cents / 100).toLocaleString('de-DE')} €`;

export function Money() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [fehler, setFehler] = useState<string | null>(null);

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const money = useQuery({
    queryKey: ['money', projectId],
    queryFn: () => api.money(projectId!),
    enabled: projectId !== undefined,
  });

  const contract = useQuery({
    queryKey: ['contract', projectId],
    queryFn: () => api.contract(projectId!),
    enabled: projectId !== undefined,
  });

  /**
   * Jede Änderung am Vertragsspiegel antwortet mit dem neuen Spiegel.
   *
   * Der wird eingesetzt, statt die Abfrage für ungültig zu erklären. Der
   * Unterschied fiel beim Durchspielen auf: Wer die Punkte der
   * Baubeschreibung schnell hintereinander abhakt, sah den zweiten Haken
   * wieder verschwinden — das Nachladen kam zurück, während der nächste Klick
   * schon unterwegs war, und schrieb den alten Stand darüber.
   */
  const spiegeln = useMutation({
    mutationFn: (aktion: () => Promise<ContractMirror>) => aktion(),
    onSuccess: (mirror) => queryClient.setQueryData(['contract', projectId], mirror),
    onError: (error) =>
      setFehler(error instanceof ApiError ? error.message : 'Das hat nicht geklappt.'),
  });

  const freigeben = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.releasePayment>[2] }) =>
      api.releasePayment(projectId!, id, body),
    onSuccess: () => {
      setFehler(null);
      void queryClient.invalidateQueries({ queryKey: ['money', projectId] });
    },
    onError: (error) =>
      setFehler(error instanceof ApiError ? error.message : 'Das hat nicht geklappt.'),
  });

  return (
    <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-8 px-4 py-6 sm:px-6">
      <TopBar
        back={{ to: `/projekt/${projectId ?? ''}`, label: plan.data?.project.name ?? 'Zurück' }}
      />

      <header className="flex flex-col gap-1">
        <p className="text-caption text-steel">Geld</p>
        <h1 className="display-title text-heading-lg text-charcoal">
          {money.data === undefined
            ? 'Zahlungen'
            : `${euro(money.data.releasedCents)} von ${euro(money.data.contractSumCents)} freigegeben`}
        </h1>
      </header>

      {fehler === null ? null : (
        <Card className="border-l-2 border-l-tangerine">
          <p className="text-body text-charcoal">{fehler}</p>
        </Card>
      )}

      {money.data === undefined ? null : (
        <>
          <Zahlungen
            money={money.data}
            busy={freigeben.isPending}
            onRelease={(id, body) => freigeben.mutate({ id, body })}
          />
          {money.data.loan === null ? null : <Darlehen loan={money.data.loan} />}
          {money.data.changeOrders.length === 0 ? null : (
            <Nachtraege orders={money.data.changeOrders} />
          )}
        </>
      )}

      {contract.data === undefined ? null : (
        <Vertragsspiegel
          mirror={contract.data}
          busy={spiegeln.isPending}
          onDismiss={(findingId, reason) =>
            spiegeln.mutate(() => api.dismissFinding(projectId!, findingId, reason))
          }
          onSaveItems={(items) =>
            spiegeln.mutate(() => api.updateContract(projectId!, { descriptionItems: items }))
          }
        />
      )}
    </main>
  );
}

function Zahlungen({
  money,
  busy,
  onRelease,
}: {
  money: MoneyView;
  busy: boolean;
  onRelease: (id: string, body: { withheldCents?: number; withheldReason?: string }) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <BadgeEuro size={18} aria-hidden />
        Zahlungsplan
      </h2>
      {money.payments.length === 0 ? (
        <Card>
          <p className="text-body text-steel">
            Noch kein Zahlungsplan erfasst. Er steht im Vertrag — meist als Tabelle mit
            Prozentsätzen je Bauabschnitt.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {money.payments.map((zahlung) => (
            <li key={zahlung.id}>
              <Zahlung zahlung={zahlung} busy={busy} onRelease={onRelease} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Zahlung({
  zahlung,
  busy,
  onRelease,
}: {
  zahlung: PaymentMilestoneDto;
  busy: boolean;
  onRelease: (id: string, body: { withheldCents?: number; withheldReason?: string }) => void;
}) {
  const [einbehalt, setEinbehalt] = useState('');
  const [grund, setGrund] = useState('');
  const [teil, setTeil] = useState(false);
  const gesperrt = zahlung.blockers.length > 0;
  const erledigt = zahlung.status !== 'geplant' && zahlung.status !== 'faellig';

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body-lg font-medium text-charcoal">{zahlung.name}</span>
        <span className="text-body-lg text-charcoal">
          {euro(zahlung.amountCents)}
          {zahlung.pct === null ? '' : ` · ${zahlung.pct} %`}
        </span>
      </div>

      {zahlung.dueDate === null ? null : (
        <p className="text-caption text-steel">Fällig {formatDate(zahlung.dueDate)}</p>
      )}

      {erledigt ? (
        <p className="flex flex-wrap items-center gap-2 text-body text-steel">
          <Pill tone={zahlung.status === 'teilfreigabe' ? 'amber' : 'green'}>
            {zahlung.status === 'teilfreigabe' ? 'Teilfreigabe' : 'Freigegeben'}
          </Pill>
          {zahlung.withheldCents === null ? null : (
            <span>
              {euro(zahlung.withheldCents)} einbehalten — {zahlung.withheldReason}
            </span>
          )}
        </p>
      ) : gesperrt ? (
        <>
          {/* Nicht „gesperrt", sondern was fehlt (Abschnitt 3.10). */}
          <div className="flex items-start gap-2 rounded-[var(--radius-card)] bg-paper-mist p-3">
            <Lock size={18} className="mt-0.5 shrink-0 text-charcoal" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-body font-medium text-charcoal">Dafür fehlt noch:</p>
              <ul className="flex flex-col gap-0.5">
                {zahlung.blockers.map((hindernis) => (
                  <li key={`${hindernis.kind}-${hindernis.label}`} className="text-body text-steel">
                    {hindernis.kind === 'mangel' ? 'Mangel: ' : ''}
                    {hindernis.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {!teil ? (
            <Button className="w-fit" onClick={() => setTeil(true)}>
              Teil unter Vorbehalt freigeben
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <Field
                label="Wie viel behältst du ein?"
                hint="Bei einem Mangel erlaubt § 641 Abs. 3 BGB den doppelten Beseitigungsaufwand."
              >
                <input
                  type="number"
                  value={einbehalt}
                  onChange={(event) => setEinbehalt(event.target.value)}
                  placeholder="Betrag in Euro"
                  className="h-12 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
                />
              </Field>
              <Field label="Wofür?" hint="Ein Einbehalt ohne Grund ist im Streit wertlos.">
                <input
                  value={grund}
                  onChange={(event) => setGrund(event.target.value)}
                  className="h-12 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy || einbehalt === '' || grund.trim().length < 3}
                  onClick={() =>
                    onRelease(zahlung.id, {
                      withheldCents: Math.round(Number(einbehalt) * 100),
                      withheldReason: grund.trim(),
                    })
                  }
                >
                  Rest freigeben
                </Button>
                <Button variant="ghost" onClick={() => setTeil(false)}>
                  Zurück
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Button
          variant="primary"
          className="w-fit"
          disabled={busy}
          onClick={() => onRelease(zahlung.id, {})}
        >
          Freigeben
        </Button>
      )}
    </Card>
  );
}

function Darlehen({ loan }: { loan: NonNullable<MoneyView['loan']> }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <Landmark size={18} aria-hidden />
        Darlehen
      </h2>
      <Card className="flex flex-col gap-2">
        <p className="text-body text-charcoal">
          {euro(loan.drawnCents)} von {euro(loan.totalCents)} abgerufen.
        </p>
        {/* Null Euro ist eine Aussage und keine Leerstelle — sie will
            erklärt werden, sonst liest sie sich wie ein Fehler. */}
        {loan.commitmentInterestCents === null ? null : loan.commitmentInterestCents === 0 ? (
          <p className="text-body text-steel">
            Bereitstellungszinsen fallen noch keine an
            {loan.freeMonths === null || loan.freeMonths === 0
              ? '.'
              : `: Die bereitstellungsfreie Zeit von ${loan.freeMonths} Monaten läuft noch.`}
          </p>
        ) : (
          <p className="text-body text-steel">
            Bereitstellungszinsen bis heute: {euro(loan.commitmentInterestCents)}
            {loan.interestPct === null ? '' : ` (${loan.interestPct} % p. a.`}
            {loan.commitmentDays === null ? '' : `, ${loan.commitmentDays} Tage)`}
          </p>
        )}
        {/* Die Zahl, die sonst erst auf der Abrechnung auftaucht. Bei einem
            Bau, der sich verzögert, wird sie schnell vierstellig. */}
        <p className="text-caption text-fog">
          Die Bank verlangt sie für zugesagtes Geld, das noch nicht abgerufen ist. Wer den Plan
          nach hinten schiebt, schiebt auch diese Zahl nach oben.
        </p>
      </Card>
    </section>
  );
}

function Nachtraege({ orders }: { orders: MoneyView['changeOrders'] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <ScrollText size={18} aria-hidden />
        Nachträge
      </h2>
      <Card className="flex flex-col gap-2 py-3">
        {orders.map((nachtrag) => (
          <div key={nachtrag.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-body text-charcoal">{nachtrag.title}</span>
            <span className="text-body text-steel">
              {euro(nachtrag.amountCents)}
              {nachtrag.daysImpact === null ? '' : ` · ${nachtrag.daysImpact} Tage`}
              {' · '}
              {nachtrag.status}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

function Vertragsspiegel({
  mirror,
  busy,
  onDismiss,
  onSaveItems,
}: {
  mirror: ContractMirror;
  busy: boolean;
  onDismiss: (findingId: string, reason: string) => void;
  onSaveItems: (items: { key: string; present: boolean }[]) => void;
}) {
  const offen = mirror.findings.filter((befund) => befund.dismissedAt === null);
  const beiseite = mirror.findings.filter((befund) => befund.dismissedAt !== null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <Scale size={18} aria-hidden />
        Vertragsspiegel
      </h2>

      {offen.length === 0 ? (
        <Card>
          <p className="text-body text-steel">
            Zu deinem Vertrag fällt uns nichts auf. Das ist keine Prüfung des Vertrags, nur ein
            Abgleich der Angaben, die hier erfasst sind.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {offen.map((befund) => (
            <li key={befund.id}>
              <Befund befund={befund} busy={busy} onDismiss={onDismiss} />
            </li>
          ))}
        </ul>
      )}

      {beiseite.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-caption text-steel">
            Beiseitegelegt · {beiseite.length}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {beiseite.map((befund) => (
              <li key={befund.id} className="text-caption text-steel">
                {befund.legalReference} — {befund.dismissedReason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Baubeschreibung items={mirror.descriptionItems} busy={busy} onSave={onSaveItems} />
    </section>
  );
}

/**
 * Die elf Punkte nach Art. 249 § 2 EGBGB — als Formular, nicht als Schalter.
 *
 * Beim Durchspielen hat sich jeder zweite Haken selbst wieder aufgehoben:
 * Elf Schalter sind elf Anfragen, und jede Antwort schrieb den Stand, den sie
 * beim Losschicken vorfand, über die inzwischen gesetzten Haken.
 *
 * Der Ausweg ist keine Optimierung, sondern die passendere Form. Eine
 * Baubeschreibung geht man einmal im Sitzen durch, mit dem Vertrag daneben.
 * Also: lokal abhaken, einmal übernehmen.
 */
function Baubeschreibung({
  items,
  busy,
  onSave,
}: {
  items: ContractMirror['descriptionItems'];
  busy: boolean;
  onSave: (items: { key: string; present: boolean }[]) => void;
}) {
  const [haken, setHaken] = useState<Record<string, boolean>>({});
  const stand = (key: string, vorgabe: boolean): boolean => haken[key] ?? vorgabe;
  const offen = Object.keys(haken).length > 0;
  const gesetzt = items.filter((punkt) => stand(punkt.key, punkt.present)).length;

  return (
    <details className="flex flex-col gap-2">
      <summary className="cursor-pointer text-body text-steel">
        Baubeschreibung durchgehen · {gesetzt} von {items.length}
      </summary>
      <p className="mt-2 text-caption text-steel">
        Art. 249 § 2 EGBGB zählt auf, was drinstehen muss. Hak ab, was du in deiner
        Baubeschreibung findest — was übrig bleibt, fehlt.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((punkt) => (
          <li key={punkt.key}>
            <label className="flex items-start gap-2 py-1 text-body text-charcoal">
              <input
                type="checkbox"
                checked={stand(punkt.key, punkt.present)}
                onChange={(event) =>
                  setHaken((vorher) => ({ ...vorher, [punkt.key]: event.target.checked }))
                }
                className="mt-1 h-5 w-5"
              />
              {punkt.label}
            </label>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        className="mt-3 w-fit"
        disabled={busy || !offen}
        onClick={() => {
          onSave(items.map((punkt) => ({ key: punkt.key, present: stand(punkt.key, punkt.present) })));
          setHaken({});
        }}
      >
        Übernehmen
      </Button>
    </details>
  );
}

function Befund({
  befund,
  busy,
  onDismiss,
}: {
  befund: ContractMirror['findings'][number];
  busy: boolean;
  onDismiss: (findingId: string, reason: string) => void;
}) {
  const [grund, setGrund] = useState('');
  const [erledigen, setErledigen] = useState(false);

  return (
    <Card
      className={`flex flex-col gap-2 border-l-2 ${
        befund.severity === 'wichtig' ? 'border-l-tangerine' : 'border-l-ash'
      }`}
    >
      <p className="text-body text-charcoal">{befund.message}</p>
      {/* CI 11.3: nie verkürzt, nie ausgeblendet, nie hinter einem Aufklapper. */}
      <p className="text-caption text-steel">
        <em>{LEGAL_DISCLAIMER}</em>
      </p>

      {!erledigen ? (
        <Button className="w-fit" onClick={() => setErledigen(true)}>
          Für uns erledigt
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Field label="Warum ist das erledigt?" hint="Bleibt am Befund stehen, auch später.">
            <input
              value={grund}
              onChange={(event) => setGrund(event.target.value)}
              className="h-11 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy || grund.trim().length < 3}
              onClick={() => onDismiss(befund.id, grund.trim())}
            >
              Beiseitelegen
            </Button>
            <Button variant="ghost" onClick={() => setErledigen(false)}>
              Zurück
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
