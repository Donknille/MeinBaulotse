/**
 * Der Vertragsspiegel — Abschnitte 3.9 und 3.10.
 *
 * Eine Ansicht für drei Fragen, die ein Bauherr sonst an drei Stellen suchen
 * müsste: Was habe ich vereinbart? Was ist fällig? Was spricht dagegen, es zu
 * zahlen?
 *
 * Die Reihenfolge ist dieselbe Überlegung wie im Cockpit: erst die Hinweise
 * (weil sie handlungsrelevant sind), dann der Zahlungsplan (weil er die
 * nächste Handlung ist), dann die Vertragsdaten (weil man sie einmal einträgt
 * und selten wieder ansieht), zuletzt die Finanzierung.
 *
 * Was sich durch die ganze Seite zieht: **Hinweise, nie Bewertungen.** Jeder
 * Prüfbefund nennt, was im Vertrag steht, was im Gesetz steht und wo genau.
 * Die Verbindung zieht der Bauherr — und wenn ihm das zu heikel ist, sein
 * Anwalt.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, Info, Landmark, Lock, TriangleAlert } from 'lucide-react';
import type {
  ContractMirror,
  FinancingDto,
  PaymentMilestoneDto,
} from '@meinbaulotse/shared';
import { Button, Card, Field, Pill, Select, TextInput } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';

export function Contract() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const spiegel = useQuery({
    queryKey: ['contract', projectId],
    queryFn: () => api.contract(projectId!),
    enabled: projectId !== undefined,
  });

  const setzeSpiegel = (mirror: ContractMirror): void => {
    queryClient.setQueryData(['contract', projectId], mirror);
  };

  const vertrag = useMutation({
    mutationFn: (change: Parameters<typeof api.updateContract>[1]) =>
      api.updateContract(projectId!, change),
    onSuccess: setzeSpiegel,
  });

  const zahlung = useMutation({
    mutationFn: ({
      paymentId,
      change,
    }: {
      paymentId: string;
      change: Parameters<typeof api.updatePayment>[2];
    }) => api.updatePayment(projectId!, paymentId, change),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contract', projectId] }),
  });

  const finanzierung = useMutation({
    mutationFn: (daten: FinancingDto) => api.saveFinancing(projectId!, daten),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contract', projectId] }),
  });

  const mirror = spiegel.data;

  return (
    <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-8 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Vertrag und Geld</h1>
        <p className="max-w-[38rem] text-body text-steel">
          Was du vereinbart hast, was fällig ist — und was dagegen spricht, es zu zahlen.
        </p>
      </header>

      {spiegel.isPending ? (
        <p className="text-body text-steel">Wird geladen.</p>
      ) : mirror === undefined ? (
        <p className="text-body text-steel">
          {spiegel.error instanceof ApiError ? spiegel.error.message : 'Das ging gerade nicht.'}
        </p>
      ) : (
        <>
          <Hinweise findings={mirror.findings} />

          <Zahlungsplan
            payments={mirror.payments}
            busy={zahlung.isPending}
            fehler={zahlung.error instanceof ApiError ? zahlung.error.message : null}
            onChange={(paymentId, change) => zahlung.mutate({ paymentId, change })}
          />

          <Vertragsdaten
            mirror={mirror}
            busy={vertrag.isPending}
            onSave={(change) => vertrag.mutate(change)}
          />

          <Finanzierung
            mirror={mirror}
            busy={finanzierung.isPending}
            onSave={(daten) => finanzierung.mutate(daten)}
          />
        </>
      )}
    </main>
  );
}

function Hinweise({ findings }: { findings: ContractMirror['findings'] }) {
  if (findings.length === 0) {
    return (
      <Card tone="muted" className="flex items-start gap-3">
        <Check size={18} className="mt-0.5 shrink-0 text-vivid-green" aria-hidden />
        <p className="text-body text-steel">
          Aus dem, was du erfasst hast, springt uns nichts ins Auge. Das ist keine Prüfung deines
          Vertrags — wir haben ihn nicht.
        </p>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body font-medium text-charcoal">Das ist uns aufgefallen</h2>
      <ul className="flex flex-col gap-3">
        {findings.map((befund) => (
          <li key={befund.ruleKey}>
            <Card
              className={`flex items-start gap-3 ${
                befund.severity === 'warnung' ? 'border-tangerine' : ''
              }`}
            >
              {befund.severity === 'warnung' ? (
                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-tangerine" aria-hidden />
              ) : (
                <Info size={18} className="mt-0.5 shrink-0 text-electric-blue" aria-hidden />
              )}
              <div className="flex flex-col gap-1">
                <p className="text-body text-charcoal">{befund.message}</p>
                {befund.legalReference === null ? null : (
                  <span className="text-caption text-steel">{befund.legalReference}</span>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PAYMENT_LABEL: Record<PaymentMilestoneDto['status'], string> = {
  offen: 'Offen',
  faellig: 'Fällig',
  freigegeben: 'Freigegeben',
  teilfreigabe: 'Teilweise freigegeben',
  bezahlt: 'Bezahlt',
};

function Zahlungsplan({
  payments,
  busy,
  fehler,
  onChange,
}: {
  payments: PaymentMilestoneDto[];
  busy: boolean;
  fehler: string | null;
  onChange: (paymentId: string, change: Parameters<typeof api.updatePayment>[2]) => void;
}) {
  const [vorbehalt, setVorbehalt] = useState<string | null>(null);

  if (payments.length === 0) {
    return (
      <Card tone="muted">
        <p className="text-body text-steel">
          Sobald du unten die Vertragssumme einträgst, entsteht daraus der Zahlungsplan aus
          Abschnitt 7.5 — acht Raten und ein Einbehalt.
        </p>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <Banknote size={18} className="text-vivid-green" aria-hidden />
        Zahlungsplan
      </h2>

      {fehler === null ? null : <p className="text-body text-alarm-red">{fehler}</p>}

      <ul className="flex flex-col">
        {payments.map((rate) => (
          <li key={rate.id} className="border-b border-ash py-4 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="flex flex-wrap items-baseline gap-2 text-body-lg text-charcoal">
                {rate.name}
                {rate.pct === null ? null : (
                  <span className="text-caption text-steel">{rate.pct} %</span>
                )}
                <Pill
                  tone={
                    rate.status === 'bezahlt' || rate.status === 'freigegeben'
                      ? 'green'
                      : rate.status === 'teilfreigabe'
                        ? 'amber'
                        : 'neutral'
                  }
                >
                  {PAYMENT_LABEL[rate.status]}
                </Pill>
              </span>
              <span className="text-body-lg font-medium text-charcoal">
                {formatMoney(rate.amountCents)}
              </span>
            </div>

            {rate.triggerText === null ? null : (
              <p className="mt-0.5 text-caption text-steel">{rate.triggerText}</p>
            )}

            {/* Was der Freigabe im Weg steht — vorher, nicht erst beim Klicken.
                Eine Sperre, die erst zuschlägt, wenn man sie auslöst, ist eine
                Falle und keine Hilfe. */}
            {rate.blockers.length > 0 && rate.status !== 'freigegeben' ? (
              <div className="mt-2 flex flex-col gap-1 rounded-[var(--radius-card)] bg-soft-amber p-3">
                <span className="flex items-center gap-2 text-caption font-medium text-charcoal">
                  <Lock size={14} aria-hidden />
                  Dafür fehlt noch:
                </span>
                <ul className="ml-6 list-disc text-caption text-charcoal">
                  {rate.blockers.map((hindernis, index) => (
                    <li key={`${hindernis.label}-${index}`}>
                      {hindernis.label}
                      {hindernis.kind === 'defect' ? ' (wesentlicher Mangel)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rate.withheldCents > 0 ? (
              <p className="mt-2 text-caption text-tangerine">
                Einbehalten: {formatMoney(rate.withheldCents)}
                {rate.withheldReason === null ? '' : ` — ${rate.withheldReason}`}
              </p>
            ) : null}

            {rate.releasedAt === null ? null : (
              <p className="mt-1 text-caption text-steel">
                Freigegeben am {formatDate(rate.releasedAt.slice(0, 10))}
                {rate.releasedBy === null ? '' : ` von ${rate.releasedBy}`}
              </p>
            )}

            {rate.status === 'offen' || rate.status === 'faellig' ? (
              vorbehalt === rate.id ? (
                <Teilfreigabe
                  rate={rate}
                  busy={busy}
                  abbrechen={() => setVorbehalt(null)}
                  senden={(cents, grund) => {
                    onChange(rate.id, {
                      status: 'teilfreigabe',
                      withheldCents: cents,
                      withheldReason: grund,
                    });
                    setVorbehalt(null);
                  }}
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || rate.blockers.length > 0}
                    onClick={() => onChange(rate.id, { status: 'freigegeben' })}
                  >
                    Freigeben
                  </Button>
                  {rate.blockers.length > 0 ? (
                    <Button size="sm" disabled={busy} onClick={() => setVorbehalt(rate.id)}>
                      Teil freigeben, Rest einbehalten
                    </Button>
                  ) : null}
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-caption text-steel">
        Freigeben heißt hier: Du bestätigst, dass diese Rate fällig ist. Überwiesen wird bei
        deiner Bank — das kann und soll diese Anwendung nicht.
      </p>
    </section>
  );
}

function Teilfreigabe({
  rate,
  busy,
  abbrechen,
  senden,
}: {
  rate: PaymentMilestoneDto;
  busy: boolean;
  abbrechen: () => void;
  senden: (cents: number, grund: string) => void;
}) {
  const [euro, setEuro] = useState(String(Math.round(rate.amountCents / 100 / 10)));
  const [grund, setGrund] = useState(
    rate.blockers.find((hindernis) => hindernis.kind === 'defect')?.label ?? '',
  );
  const cents = Math.round(Number(euro.replace(',', '.')) * 100);

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-card)] bg-paper-mist p-3">
      <Field label="Einbehalt in Euro" hint={`Von ${formatMoney(rate.amountCents)}.`}>
        <TextInput
          inputMode="decimal"
          value={euro}
          onChange={(event) => setEuro(event.target.value)}
        />
      </Field>
      <Field
        label="Warum"
        hint="Ohne Grund ist ein Einbehalt in einem halben Jahr nicht mehr erklärbar."
      >
        <TextInput value={grund} onChange={(event) => setGrund(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !Number.isFinite(cents) || cents <= 0 || grund.trim().length < 3}
          onClick={() => senden(cents, grund.trim())}
        >
          Teil freigeben
        </Button>
        <Button variant="ghost" size="sm" onClick={abbrechen}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function Vertragsdaten({
  mirror,
  busy,
  onSave,
}: {
  mirror: ContractMirror;
  busy: boolean;
  onSave: (change: Parameters<typeof api.updateContract>[1]) => void;
}) {
  const [summe, setSumme] = useState('');
  const [sicherheit, setSicherheit] = useState('');
  const [termin, setTermin] = useState('');
  const [dauer, setDauer] = useState('');
  const [unterschrieben, setUnterschrieben] = useState('');
  const [baubeschreibung, setBaubeschreibung] = useState('');

  // Die Felder folgen dem, was der Server zuletzt gesagt hat. Ein Formular,
  // das nach dem Speichern den alten Stand zeigt, lädt zum Doppeltippen ein.
  useEffect(() => {
    setSumme(mirror.contractSumCents === null ? '' : String(mirror.contractSumCents / 100));
    setSicherheit(mirror.securityPct === null ? '' : String(mirror.securityPct));
    setTermin(mirror.contractualCompletion ?? '');
    setDauer(mirror.buildDurationDays === null ? '' : String(mirror.buildDurationDays));
    setUnterschrieben(mirror.contractSignedOn ?? '');
    setBaubeschreibung(
      mirror.buildingDescriptionComplete === null
        ? ''
        : mirror.buildingDescriptionComplete
          ? 'ja'
          : 'nein',
    );
  }, [mirror]);

  const zahl = (wert: string): number | null => {
    const geparst = Number(wert.replace(',', '.'));
    return wert.trim() === '' || !Number.isFinite(geparst) ? null : geparst;
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-body font-medium text-charcoal">Was im Vertrag steht</h2>
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Gesamtvergütung in Euro" hint="Daraus entsteht der Zahlungsplan.">
          <TextInput
            inputMode="decimal"
            value={summe}
            onChange={(event) => setSumme(event.target.value)}
          />
        </Field>
        <Field label="Sicherheit in Prozent" hint="§ 650m Abs. 2 BGB sieht 5 % vor.">
          <TextInput
            inputMode="decimal"
            value={sicherheit}
            onChange={(event) => setSicherheit(event.target.value)}
          />
        </Field>
        <Field label="Geschuldeter Fertigstellungstermin">
          <TextInput
            type="date"
            value={termin}
            onChange={(event) => setTermin(event.target.value)}
          />
        </Field>
        <Field label="Oder Bauzeit in Kalendertagen" hint="§ 650k Abs. 3 BGB verlangt eines von beidem.">
          <TextInput
            inputMode="numeric"
            value={dauer}
            onChange={(event) => setDauer(event.target.value)}
          />
        </Field>
        <Field label="Vertrag unterschrieben am">
          <TextInput
            type="date"
            value={unterschrieben}
            onChange={(event) => setUnterschrieben(event.target.value)}
          />
        </Field>
        <Field
          label="Baubeschreibung vollständig?"
          hint="Nach Art. 249 § 2 EGBGB. Deine Einschätzung — wir haben den Vertrag nicht."
        >
          <Select
            value={baubeschreibung}
            onChange={(event) => setBaubeschreibung(event.target.value)}
          >
            <option value="">Noch nicht geprüft</option>
            <option value="ja">Ja, alles drin</option>
            <option value="nein">Nein, da fehlt etwas</option>
          </Select>
        </Field>
      </Card>

      <Button
        variant="primary"
        size="field"
        disabled={busy}
        onClick={() =>
          onSave({
            contractSumCents: zahl(summe) === null ? null : Math.round(zahl(summe)! * 100),
            securityPct: zahl(sicherheit),
            contractualCompletion: termin === '' ? null : termin,
            buildDurationDays: zahl(dauer),
            contractSignedOn: unterschrieben === '' ? null : unterschrieben,
            buildingDescriptionComplete:
              baubeschreibung === '' ? null : baubeschreibung === 'ja',
          })
        }
      >
        Vertragsdaten speichern
      </Button>
    </section>
  );
}

function Finanzierung({
  mirror,
  busy,
  onSave,
}: {
  mirror: ContractMirror;
  busy: boolean;
  onSave: (daten: FinancingDto) => void;
}) {
  const vorhanden = mirror.financing;
  const [darlehen, setDarlehen] = useState('');
  const [eigen, setEigen] = useState('');
  const [satz, setSatz] = useState('');
  const [frei, setFrei] = useState('');
  const [zusage, setZusage] = useState('');
  const [bank, setBank] = useState('');

  useEffect(() => {
    setDarlehen(vorhanden?.loanAmountCents == null ? '' : String(vorhanden.loanAmountCents / 100));
    setEigen(vorhanden?.ownFundsCents == null ? '' : String(vorhanden.ownFundsCents / 100));
    setSatz(vorhanden?.commitmentRateBp == null ? '' : String(vorhanden.commitmentRateBp / 100));
    setFrei(vorhanden?.commitmentFreeMonths == null ? '' : String(vorhanden.commitmentFreeMonths));
    setZusage(vorhanden?.loanGrantedOn ?? '');
    setBank(vorhanden?.bankName ?? '');
  }, [vorhanden]);

  const zahl = (wert: string): number | null => {
    const geparst = Number(wert.replace(',', '.'));
    return wert.trim() === '' || !Number.isFinite(geparst) ? null : geparst;
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        <Landmark size={18} className="text-electric-blue" aria-hidden />
        Finanzierung
      </h2>

      {/* Die Zahl, die eine Verschiebung greifbar macht. Sie steht **über** dem
          Formular, weil sie die Antwort ist und das Formular nur die Frage. */}
      {mirror.interest !== null ? (
        <Card tone="muted" className="flex flex-col gap-2">
          <p className="text-body-lg text-charcoal">
            Solange dein Darlehen bereitsteht und nicht abgerufen ist, kostet dich jeder weitere
            Monat rund{' '}
            <strong>{formatMoney(mirror.interest.costPerFurtherMonthCents)}</strong>{' '}
            Bereitstellungszinsen.
          </p>
          {mirror.interest.chargeableFrom === null ? (
            <p className="text-body text-steel">
              Bis dahin ist es bereitstellungsfrei — es kostet dich also noch nichts.
            </p>
          ) : (
            <p className="text-body text-steel">
              Ab {formatDate(mirror.interest.chargeableFrom)}. Bis zum geschuldeten Endtermin sind
              das nach unserer Rechnung {formatMoney(mirror.interest.totalCents)}.
            </p>
          )}
          {mirror.interest.delayCostCents !== null && mirror.interest.delayCostCents > 0 ? (
            <p className="text-body text-tangerine">
              Der errechnete Verzug kostet zusätzlich rund{' '}
              {formatMoney(mirror.interest.delayCostCents)}.
            </p>
          ) : null}
          <p className="text-caption text-steel">
            Gerechnet nach der deutschen Zinsmethode (30/360). Banken rechnen unterschiedlich —
            das hier ist eine belastbare Schätzung, keine Abrechnung.
          </p>
        </Card>
      ) : null}

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Darlehenssumme in Euro">
          <TextInput
            inputMode="decimal"
            value={darlehen}
            onChange={(event) => setDarlehen(event.target.value)}
          />
        </Field>
        <Field label="Eigenkapital in Euro">
          <TextInput
            inputMode="decimal"
            value={eigen}
            onChange={(event) => setEigen(event.target.value)}
          />
        </Field>
        <Field label="Bereitstellungszins in Prozent p. a." hint="Steht im Darlehensvertrag, oft 3 %.">
          <TextInput
            inputMode="decimal"
            value={satz}
            onChange={(event) => setSatz(event.target.value)}
          />
        </Field>
        <Field label="Bereitstellungsfrei für ... Monate" hint="Oft sechs oder zwölf.">
          <TextInput
            inputMode="numeric"
            value={frei}
            onChange={(event) => setFrei(event.target.value)}
          />
        </Field>
        <Field label="Darlehenszusage vom">
          <TextInput
            type="date"
            value={zusage}
            onChange={(event) => setZusage(event.target.value)}
          />
        </Field>
        <Field label="Bank">
          <TextInput value={bank} onChange={(event) => setBank(event.target.value)} />
        </Field>
      </Card>

      <Button
        variant="primary"
        size="field"
        disabled={busy}
        onClick={() =>
          onSave({
            loanAmountCents: zahl(darlehen) === null ? null : Math.round(zahl(darlehen)! * 100),
            ownFundsCents: zahl(eigen) === null ? null : Math.round(zahl(eigen)! * 100),
            commitmentRateBp: zahl(satz) === null ? null : Math.round(zahl(satz)! * 100),
            commitmentFreeMonths: zahl(frei) === null ? null : Math.round(zahl(frei)!),
            loanGrantedOn: zusage === '' ? null : zusage,
            bankName: bank.trim() === '' ? null : bank.trim(),
          })
        }
      >
        Finanzierung speichern
      </Button>
    </section>
  );
}
