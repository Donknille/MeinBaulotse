/**
 * Der Wochenbericht als Ansicht — Abschnitt 3.11 der Spezifikation.
 *
 * Dieselben sechs Blöcke in derselben Reihenfolge wie in der Montagsmail. Der
 * Inhalt kommt aus derselben Antwort; die Textfassung für die Mail steht in
 * `@meinbaulotse/shared`. Zwei Fassungen desselben Berichts würden
 * auseinanderlaufen, und die eine davon läse niemand gegen.
 *
 * Der Versand fehlt noch: Er braucht einen transaktionalen Anbieter mit
 * EU-Verarbeitung (Abschnitt 6.1), und den kann kein Code herbeiführen. Was
 * hier steht, ist der Bericht — nicht der Briefkasten.
 */

import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Camera, CircleDot, Euro, Scale, TriangleAlert } from 'lucide-react';
import { decisionInPlainWords, type WeeklyReport as WeeklyReportDto } from '@meinbaulotse/shared';
import { Button, Card } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { formatDate, formatRange } from '../lib/format';

/** Dieselben Beschriftungen wie im Vorgangsblatt — ein Grund heißt überall gleich. */
const REASON_LABEL: Record<string, string> = {
  witterung: 'Witterung',
  lieferzeit: 'Lieferzeit',
  kapazitaet: 'Kapazität beim Gewerk',
  planungsaenderung: 'Planungsänderung',
  bauherren_entscheidung: 'Entscheidung des Bauherrn',
  vorgewerk_verzug: 'Vorgewerk in Verzug',
  behoerde: 'Behörde',
  mangelbeseitigung: 'Mängelbeseitigung',
  nachtrag: 'Nachtrag',
  sonstiges: 'Sonstiges',
};

export function WeeklyReport() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = useQuery({
    queryKey: ['weekly-report', projectId],
    queryFn: () => api.weeklyReport(projectId!),
    enabled: projectId !== undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      {query.isPending ? (
        <p className="text-body text-steel">Der Bericht wird zusammengestellt.</p>
      ) : query.isError || query.data === undefined ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="max-w-[34rem] text-body text-charcoal">
            Der Wochenbericht ließ sich gerade nicht laden. Deine Daten sind davon nicht betroffen.
          </p>
          <p className="max-w-[34rem] text-body text-steel">
            {query.error instanceof ApiError
              ? query.error.message
              : 'Versuch es bitte noch einmal.'}
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
  const referenceYear = Number(report.generatedFor.slice(0, 4));

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Diese Woche</h1>
        <p className="text-body text-steel">
          {report.projectName} · Stand {formatDate(report.generatedFor)}
        </p>
      </header>

      {/* 1 */}
      <Block
        titel="Diese Woche auf der Baustelle"
        icon={<CircleDot size={18} className="text-electric-blue" aria-hidden />}
        leer="Diese Woche steht nichts an."
        anzahl={report.thisWeek.length}
      >
        <ul className="flex flex-col">
          {report.thisWeek.map((eintrag) => (
            <li key={eintrag.taskId} className="border-b border-ash py-3 last:border-b-0">
              <p className="flex flex-wrap items-baseline gap-x-2 text-body-lg font-medium text-charcoal">
                {eintrag.name}
                <span className="text-caption font-normal text-steel">
                  {eintrag.starts && eintrag.ends
                    ? 'beginnt und endet'
                    : eintrag.starts
                      ? 'beginnt'
                      : 'endet'}{' '}
                  {formatRange(eintrag.start, eintrag.end, referenceYear)}
                  {eintrag.tradeName === null ? '' : ` · ${eintrag.tradeName}`}
                </span>
              </p>
              {/* Die Kurzfassung der Lotsenkarte: ein Satz. Wer mehr will,
                  öffnet die Karte im Plan — dort steht sie mit Quellen. */}
              {eintrag.guideCard !== null ? (
                <p className="mt-1 flex items-start gap-2 text-body text-steel">
                  <BookOpen size={14} className="mt-1 shrink-0 text-lavender" aria-hidden />
                  {eintrag.guideCard.summary}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Block>

      {/* 2 */}
      <Block
        titel="Was du entscheiden musst"
        icon={<Scale size={18} className="text-tangerine" aria-hidden />}
        leer="Nichts offen. Alle Fristen sind erledigt oder liegen weiter vorn."
        anzahl={report.decisions.length}
      >
        <ul className="flex flex-col">
          {report.decisions.map((eintrag) => (
            <li
              key={eintrag.id}
              className="flex flex-col gap-0.5 border-b border-ash py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span
                className={`text-body font-medium sm:min-w-[11rem] ${
                  eintrag.isOverdue ? 'text-alarm-red' : 'text-tangerine'
                }`}
              >
                {decisionInPlainWords(eintrag.remainingWorkdays)}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2 text-body-lg text-charcoal">
                {eintrag.title}
                {eintrag.blocksTaskName === null ? null : (
                  <span className="text-caption text-steel">vor {eintrag.blocksTaskName}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {/* 3 */}
      <Block
        titel="Was sich verschoben hat"
        icon={<TriangleAlert size={18} className="text-tangerine" aria-hidden />}
        leer="Seit der letzten Woche hat sich nichts verschoben."
        anzahl={report.shifted.length}
      >
        <ul className="flex flex-col">
          {report.shifted.map((eintrag, index) => (
            <li key={`${eintrag.at}-${index}`} className="border-b border-ash py-3 last:border-b-0">
              <p className="text-body-lg text-charcoal">
                {eintrag.taskNames.slice(0, 3).join(', ')}
                {eintrag.taskNames.length > 3 ? ` und ${eintrag.taskNames.length - 3} weitere` : ''}
              </p>
              <p className="mt-0.5 text-body text-steel">
                {eintrag.reasonCode === null
                  ? 'Ohne Grund'
                  : (REASON_LABEL[eintrag.reasonCode] ?? eintrag.reasonCode)}
                {eintrag.reasonText === null ? '' : ` · ${eintrag.reasonText}`}
                {' · '}
                {eintrag.effectWorkdays === null || eintrag.effectWorkdays === 0
                  ? 'ohne Auswirkung auf den Endtermin'
                  : `${eintrag.effectWorkdays > 0 ? '+' : ''}${eintrag.effectWorkdays} Werktage auf den Endtermin`}
              </p>
            </li>
          ))}
        </ul>
      </Block>

      {/* 4 */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-body font-medium text-charcoal">Prognose</h2>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Kennzahl label="Errechnetes Ende" value={formatDate(report.forecast.computedEnd)} />
          <Kennzahl
            label="Geschuldet"
            value={
              report.forecast.contractualEnd === null
                ? 'nicht erfasst'
                : formatDate(report.forecast.contractualEnd)
            }
          />
          {report.forecast.deviationWorkdays !== null ? (
            <Kennzahl
              label="Abweichung"
              value={
                report.forecast.deviationWorkdays === 0
                  ? 'genau im Plan'
                  : `${Math.abs(report.forecast.deviationWorkdays)} Werktage ${
                      report.forecast.deviationWorkdays > 0 ? 'später' : 'früher'
                    }`
              }
              tone={report.forecast.deviationWorkdays > 0 ? 'warn' : 'ok'}
            />
          ) : null}
        </dl>
      </Card>

      {/* 5 */}
      <Block
        titel="Fotos, die jetzt fällig sind"
        icon={<Camera size={18} className="text-lavender" aria-hidden />}
        leer="Nichts, was diese Woche verdeckt wird."
        anzahl={report.photoPrompts.length}
      >
        <ul className="flex flex-col">
          {report.photoPrompts.map((eintrag) => (
            <li
              key={`${eintrag.taskId}-${eintrag.key}`}
              className="border-b border-ash py-3 last:border-b-0"
            >
              <p className="text-body-lg text-charcoal">{eintrag.what}</p>
              <p className="mt-0.5 text-body text-steel">
                {eintrag.taskName}
                {eintrag.why === null ? '' : ` · ${eintrag.why}`}
              </p>
            </li>
          ))}
        </ul>
      </Block>

      {/* 6 */}
      <Card tone="muted" className="flex items-start gap-3">
        <Euro size={18} className="mt-0.5 shrink-0 text-steel" aria-hidden />
        <div>
          <h2 className="text-body font-medium text-charcoal">Geld</h2>
          <p className="mt-0.5 text-body text-steel">{report.money.note}</p>
        </div>
      </Card>
    </>
  );
}

function Block({
  titel,
  icon,
  leer,
  anzahl,
  children,
}: {
  titel: string;
  icon: React.ReactNode;
  leer: string;
  anzahl: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        {icon}
        {titel}
      </h2>
      {/* Ein leerer Block bleibt stehen und sagt, dass er leer ist. Ein
          weggelassener sieht aus, als hätte niemand nachgesehen. */}
      {anzahl === 0 ? <p className="text-body text-steel">{leer}</p> : children}
    </Card>
  );
}

function Kennzahl({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const farbe = tone === 'warn' ? 'text-tangerine' : tone === 'ok' ? 'text-vivid-green' : '';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd className={`text-body-xl font-medium ${farbe === '' ? 'text-charcoal' : farbe}`}>
        {value}
      </dd>
    </div>
  );
}

/** Der Weg zum Bericht, aus der Planansicht heraus. */
export function WeeklyReportLink({ projectId }: { projectId: string }) {
  return (
    <a
      href={`/projekt/${projectId}/wochenbericht`}
      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-button)] px-3 text-body font-medium text-electric-blue transition-colors duration-[var(--motion-micro)] hover:bg-soft-blue"
    >
      Wochenbericht ansehen
      <ArrowRight size={16} aria-hidden />
    </a>
  );
}
