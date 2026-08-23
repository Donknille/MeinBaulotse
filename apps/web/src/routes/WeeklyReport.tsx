/**
 * Der Wochenbericht als Ansicht — Abschnitt 3.11.
 *
 * Derselbe Bericht, den die Montagsmail verschickt. Er steht hier, weil die
 * Mail eine Einbahnstraße ist: Wer sie zwei Wochen später sucht, findet sie
 * nicht mehr, und wer sie nie bekommen hat, soll trotzdem sehen können, was
 * darin gestanden hätte.
 *
 * Die sechs Blöcke stehen in der Reihenfolge aus 3.11 — dieselbe wie im
 * Cockpit, und aus demselben Grund.
 */

import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  Camera,
  CircleDot,
  Coins,
  FolderOpen,
  TrendingUp,
} from 'lucide-react';
import type { WeeklyReport as WeeklyReportDto } from '@meinbaulotse/shared';
import { Button, Card, SectionPill } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { formatDate, formatRange } from '../lib/format';

export function WeeklyReport() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = useQuery({
    queryKey: ['weekly-report', projectId],
    queryFn: () => api.weeklyReport(projectId!),
    enabled: projectId !== undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-[840px] flex-col gap-8 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      {query.isPending ? (
        <p className="text-body text-steel">Der Bericht wird zusammengestellt.</p>
      ) : query.isError || query.data === undefined ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="max-w-[34rem] text-body text-charcoal">
            Der Wochenbericht ließ sich gerade nicht laden. Deine Daten sind davon nicht betroffen.
          </p>
          <p className="max-w-[34rem] text-body text-steel">
            {query.error instanceof ApiError ? query.error.message : 'Versuch es noch einmal.'}
          </p>
          <Button variant="primary" size="field" onClick={() => void query.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      ) : (
        <Bericht report={query.data} />
      )}
    </main>
  );
}

function Bericht({ report }: { report: WeeklyReportDto }) {
  const referenceYear = Number(report.weekStart.slice(0, 4));

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Die Woche im Überblick</h1>
        <p className="text-body text-steel">
          {report.project.name} · {formatDate(report.weekStart, referenceYear)} bis{' '}
          {formatDate(report.weekEnd, referenceYear)}
          {report.phase === null
            ? ''
            : ` · Phase ${report.phase.ordinal} von ${report.phase.total}, ${report.phase.name}`}
        </p>
      </header>

      <Abschnitt
        titel="Diese Woche auf der Baustelle"
        icon={<CircleDot size={18} className="text-electric-blue" />}
      >
        {report.thisWeek.length === 0 ? (
          <Leer text="Diese Woche steht nichts an. Der nächste Vorgang steht im Ablauf." />
        ) : (
          <ul className="flex flex-col">
            {report.thisWeek.map((task) => (
              <li key={task.id} className="border-b border-ash py-3 last:border-b-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-caption text-steel">
                    {formatRange(task.start, task.end, referenceYear)}
                  </span>
                  <span className="text-body-lg font-medium text-charcoal">{task.name}</span>
                  {task.tradeName !== null ? (
                    <span className="text-caption text-steel">{task.tradeName}</span>
                  ) : null}
                </p>
                {task.isWait ? (
                  <p className="text-caption text-steel">Wartezeit — nicht verkürzbar.</p>
                ) : null}
                {task.guideCardSummary !== null ? (
                  <p className="mt-0.5 text-body text-steel">{task.guideCardSummary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Was du entscheiden musst"
        icon={<CalendarClock size={18} className="text-electric-blue" />}
      >
        {report.decisions.length === 0 ? (
          <Leer text="Nichts Offenes. Alles Anstehende ist entschieden." />
        ) : (
          <ul className="flex flex-col">
            {report.decisions.map((decision) => (
              <li key={decision.id} className="border-b border-ash py-3 last:border-b-0">
                <p className="text-body-lg font-medium text-charcoal">{decision.title}</p>
                <p
                  className={`text-body ${
                    decision.remainingWorkdays !== null && decision.remainingWorkdays <= 10
                      ? 'text-tangerine'
                      : 'text-steel'
                  }`}
                >
                  {fristText(decision.remainingWorkdays)}
                  {decision.dueDate === null
                    ? ''
                    : ` · bis ${formatDate(decision.dueDate, referenceYear)}`}
                  {decision.blocksTaskName === null
                    ? ''
                    : ` · hängt an „${decision.blocksTaskName}"`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Was sich verschoben hat"
        icon={<ArrowRight size={18} className="text-tangerine" />}
      >
        {report.changes.length === 0 ? (
          <Leer text="Nichts. Der Plan steht wie letzte Woche." />
        ) : (
          <ul className="flex flex-col">
            {report.changes.map((change, index) => (
              <li key={index} className="border-b border-ash py-3 last:border-b-0">
                <p className="text-body-lg text-charcoal">
                  {change.taskName ?? 'Vorgang'}:{' '}
                  <span className="font-mono text-body">
                    {formatDate(change.from, referenceYear)} →{' '}
                    {formatDate(change.to, referenceYear)}
                  </span>
                </p>
                {change.reasonText !== null && change.reasonText !== '' ? (
                  <p className="text-body text-steel">„{change.reasonText}"</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      <Abschnitt titel="Prognose" icon={<TrendingUp size={18} className="text-electric-blue" />}>
        <p className="text-body-lg text-charcoal">
          {report.forecast.computedEnd === null
            ? 'Für den Endtermin fehlen noch Termine im Plan.'
            : report.forecast.contractualEnd === null
              ? `Nach dem heutigen Plan seid ihr am ${formatDate(report.forecast.computedEnd)} fertig.`
              : `Geschuldet ist der ${formatDate(report.forecast.contractualEnd)}, errechnet der ${formatDate(report.forecast.computedEnd)}.`}
        </p>
        {report.forecast.deviationWorkdays !== null ? (
          <p
            className={`text-body ${
              report.forecast.deviationWorkdays > 0 ? 'text-tangerine' : 'text-vivid-green'
            }`}
          >
            {abweichung(report.forecast.deviationWorkdays)}
          </p>
        ) : null}
      </Abschnitt>

      {report.photos.length > 0 ? (
        <Abschnitt
          titel="Fotos, die jetzt fällig sind"
          icon={<Camera size={18} className="text-lavender" />}
        >
          <ul className="flex flex-col">
            {report.photos.map((photo, index) => (
              <li key={index} className="border-b border-ash py-3 last:border-b-0">
                <p className="text-body-lg text-charcoal">{photo.what}</p>
                <p className="text-body text-steel">
                  {photo.why} · {photo.taskName}
                </p>
              </li>
            ))}
          </ul>
        </Abschnitt>
      ) : null}

      {report.money !== null ? (
        <Abschnitt titel="Geld" icon={<Coins size={18} className="text-electric-blue" />}>
          <p className="text-body-lg font-medium text-charcoal">
            {report.money.name}
            {report.money.amountCents === null
              ? ''
              : ` · ${Math.round(report.money.amountCents / 100).toLocaleString('de-DE')} €`}
          </p>
          <p className="text-body text-steel">{report.money.requirement}</p>
        </Abschnitt>
      ) : null}

      {/* Die Aufbewahrungserinnerung aus Abschnitt 6.5. Ganz unten, weil sie
          keine Aufgabe der Woche ist, sondern eine Sache, die einmal im Leben
          des Bauvorhabens zu entscheiden ist. */}
      {report.retention !== null ? (
        <Abschnitt
          titel="Deine Bauakte"
          icon={<FolderOpen size={18} className="text-electric-blue" />}
        >
          <p className="text-body text-charcoal">
            Die Abnahme war am {formatDate(report.retention.acceptedOn)}, also vor{' '}
            {report.retention.years} Jahren — die Gewährleistung ist abgelaufen.
          </p>
          <p className="text-body text-steel">
            Gelöscht wird trotzdem nichts. Das entscheidest du; die Akte liegt weiter für dich
            bereit.
          </p>
        </Abschnitt>
      ) : null}
    </>
  );
}

function Abschnitt({
  titel,
  icon,
  children,
}: {
  titel: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionPill tone="blue" icon={icon}>
        {titel}
      </SectionPill>
      <Card className="py-0">{children}</Card>
    </section>
  );
}

/** Leere Zustände nach CI 9.10: ein Satz, der sagt, was hier stehen wird. */
function Leer({ text }: { text: string }) {
  return <p className="py-4 text-body text-steel">{text}</p>;
}

function fristText(remainingWorkdays: number | null): string {
  if (remainingWorkdays === null) return 'Ohne Frist';
  if (remainingWorkdays < 0) {
    const tage = Math.abs(remainingWorkdays);
    return `Seit ${tage === 1 ? 'einem Werktag' : `${tage} Werktagen`} offen`;
  }
  if (remainingWorkdays === 0) return 'Heute ist der letzte Tag';
  return `Noch ${remainingWorkdays === 1 ? 'ein Werktag' : `${remainingWorkdays} Werktage`}`;
}

function abweichung(workdays: number): string {
  if (workdays === 0) return 'Das ist genau im Plan.';
  const tage = Math.abs(workdays) === 1 ? '1 Werktag' : `${Math.abs(workdays)} Werktage`;
  return workdays > 0 ? `${tage} später als geschuldet.` : `${tage} früher als geschuldet.`;
}
