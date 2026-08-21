/**
 * Das Cockpit — Abschnitt 5.1 der Spezifikation.
 *
 * Es beantwortet die vier Fragen, mit denen jemand die Anwendung öffnet, und
 * zwar **bevor** irgendeine Liste kommt:
 *
 *   Wo stehen wir?   →  Phase, Endtermin, wie viel schon fertig ist
 *   Was ist heute?   →  was gerade läuft
 *   Was kommt?       →  die nächsten Vorgänge, im Klartext „in vier Tagen"
 *   Was klemmt?      →  was verschoben ist und was das kostet
 *
 * Die Reihenfolge ist inhaltlich begründet und laut CI 10.2 nicht
 * verhandelbar: erst wo wir stehen, dann was kommt, dann was **du** tun musst,
 * dann erst was schiefgeht. Wer mit der Fehlerliste anfängt, erzieht zum
 * Wegsehen.
 *
 * Warum es das braucht: Vorher begann die Planansicht mit 34 Vorgängen am
 * Stück. Für jemanden, der zum ersten Mal baut, ist das keine Auskunft,
 * sondern eine Zumutung — er sieht alles und weiß nichts.
 *
 * **Die Ansicht unterscheidet sich nach Rolle**, und zwar dort, wo es einen
 * echten Unterschied gibt: Der GU führt aus und muss melden, der Bauherr
 * schaut zu und muss entscheiden. Beide sehen denselben Bau, aber nicht
 * dieselbe Aufforderung.
 *
 * Was noch fehlt und deshalb hier nicht steht: Entscheidungsfristen (AP 3) und
 * Fotoaufträge (AP 5). Ein leerer Kasten mit einer Überschrift wäre ein
 * Versprechen, das die Anwendung nicht hält.
 */

import { ArrowRight, Check, CircleDot, Flag, TriangleAlert } from 'lucide-react';
import type { ProjectSchedule, ScheduledTaskDto } from '@meinbaulotse/shared';
import { Card } from './ui';
import { PhaseBar } from './schedule';
import { formatDate, formatRange } from '../lib/format';
import { inTagen, istHeute, meldungOffen, progressOf, todayIso, zaehle } from '../lib/progress';

const MAX_ZEILEN = 4;

export function Cockpit({
  schedule,
  currentPhase,
  onSelect,
}: {
  schedule: ProjectSchedule;
  currentPhase: string | undefined;
  onSelect?: (task: ScheduledTaskDto) => void;
}) {
  const today = todayIso();
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const istGu = schedule.project.role !== 'owner' && schedule.project.role !== 'co_owner';
  const zahlen = zaehle(schedule.tasks);

  const heute = schedule.tasks.filter((task) => istHeute(task, today));
  const alsNaechstes = schedule.tasks
    .filter(
      (task) =>
        progressOf(task) === 'geplant' && task.currentStart !== null && task.currentStart > today,
    )
    .sort((a, b) => a.currentStart!.localeCompare(b.currentStart!))
    .slice(0, MAX_ZEILEN);
  const zuletzt = schedule.tasks
    .filter((task) => progressOf(task) === 'fertig')
    .sort((a, b) =>
      (b.actualEnd ?? b.currentEnd ?? '').localeCompare(a.actualEnd ?? a.currentEnd ?? ''),
    )
    .slice(0, 3);

  // Was Aufmerksamkeit braucht, unterscheidet sich nach Rolle — und nur hier.
  const offeneMeldungen = schedule.tasks.filter((task) => meldungOffen(task, today));
  const verschoben = schedule.tasks.filter(
    (task) => task.earliestStart !== null && progressOf(task) !== 'fertig',
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Wo ihr steht */}
      <Card className="flex flex-col gap-5">
        <PhaseBar
          phases={schedule.phases}
          {...(currentPhase === undefined ? {} : { currentKey: currentPhase })}
        />

        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Kennzahl label="Errechnetes Ende" value={formatDate(schedule.computedEnd)} strong />
          <Kennzahl
            label="Geschuldet"
            value={
              schedule.contractualEnd === null
                ? 'nicht erfasst'
                : formatDate(schedule.contractualEnd)
            }
          />
          {schedule.deviationWorkdays !== null ? (
            <Kennzahl
              label="Abweichung"
              value={abweichungInWorten(schedule.deviationWorkdays)}
              tone={schedule.deviationWorkdays > 0 ? 'warn' : 'ok'}
            />
          ) : null}
        </dl>

        {schedule.contractualEnd === null ? (
          // Auch der Hinweis auf eine Luecke traegt den naechsten Schritt.
          <p className="text-caption text-steel">
            Sobald du den vertraglich geschuldeten Fertigstellungstermin erfasst, sagen wir dir, wie
            weit der errechnete Plan davon abweicht.
          </p>
        ) : null}

        {/* Fortschritt als Satz und als Balken. Kein Prozentwert — der wäre
            eine Behauptung, die niemand belegen kann (CI 9.6). Gezählt werden
            Vorgänge, und das steht auch so da. */}
        <div className="flex flex-col gap-2">
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-ash"
            role="img"
            aria-label={`${zahlen.fertig} von ${zahlen.gesamt} Vorgängen fertig`}
          >
            <span
              className="bg-vivid-green"
              style={{ width: `${(zahlen.fertig / zahlen.gesamt) * 100}%` }}
            />
            <span
              className="bg-electric-blue"
              style={{ width: `${(zahlen.laeuft / zahlen.gesamt) * 100}%` }}
            />
          </div>
          <p className="text-body text-steel">
            <strong className="font-medium text-charcoal">
              {zahlen.fertig} von {zahlen.gesamt} Vorgängen
            </strong>{' '}
            sind fertig
            {zahlen.laeuft > 0
              ? `, ${zahlen.laeuft === 1 ? 'einer läuft' : `${zahlen.laeuft} laufen`} gerade`
              : ''}
            .
          </p>
        </div>
      </Card>

      {/* 2. Heute */}
      <Abschnitt
        titel="Heute auf der Baustelle"
        icon={<CircleDot size={18} className="text-electric-blue" aria-hidden />}
      >
        {heute.length === 0 ? (
          <p className="text-body text-steel">
            Heute steht nichts an.
            {alsNaechstes[0]?.currentStart !== undefined
              ? ` Weiter geht es ${inTagen(alsNaechstes[0].currentStart!, today)}, mit „${alsNaechstes[0].name}".`
              : ''}
          </p>
        ) : (
          <ul className="flex flex-col">
            {heute.map((task) => (
              <Zeile
                key={task.id}
                task={task}
                referenceYear={referenceYear}
                vorne={formatRange(task.currentStart, task.currentEnd, referenceYear)}
                {...(onSelect === undefined ? {} : { onSelect })}
              />
            ))}
          </ul>
        )}
      </Abschnitt>

      {/* 3. Was kommt */}
      {alsNaechstes.length > 0 ? (
        <Abschnitt
          titel="Als Nächstes"
          icon={<ArrowRight size={18} className="text-electric-blue" aria-hidden />}
        >
          <ul className="flex flex-col">
            {alsNaechstes.map((task) => (
              <Zeile
                key={task.id}
                task={task}
                referenceYear={referenceYear}
                vorne={inTagen(task.currentStart!, today)}
                {...(onSelect === undefined ? {} : { onSelect })}
              />
            ))}
          </ul>
        </Abschnitt>
      ) : null}

      {/* 4. Was du tun musst.
             Hier, und nur hier, unterscheiden sich die Rollen: Der GU fuehrt
             aus und schuldet die Meldung; der Bauherr schaut zu und kann sie
             nicht abgeben. Ein Kasten „das solltest du melden" waere fuer ihn
             eine Aufforderung ins Leere. Alles andere sehen beide gleich — es
             ist derselbe Bau. */}
      {istGu && offeneMeldungen.length > 0 ? (
        <Abschnitt
          titel="Das solltest du melden"
          icon={<Flag size={18} className="text-tangerine" aria-hidden />}
          hinweis="Der Termin ist vorbei, fertig gemeldet ist der Vorgang nicht. Solange das offen bleibt, rechnet der Plan mit falschen Zahlen."
        >
          <ul className="flex flex-col">
            {offeneMeldungen.slice(0, MAX_ZEILEN).map((task) => (
              <Zeile
                key={task.id}
                task={task}
                referenceYear={referenceYear}
                vorne={inTagen(task.currentEnd!, today)}
                {...(onSelect === undefined ? {} : { onSelect })}
              />
            ))}
          </ul>
        </Abschnitt>
      ) : null}

      {/* Was geschafft ist, sehen beide. Es war zwischenzeitlich nur fuer den
          Bauherrn da — aber „was ist durch" ist keine Rollenfrage, und ohne
          diesen Kasten endete die GU-Ansicht bei „was kommt". */}
      {zuletzt.length > 0 ? (
        <Abschnitt
          titel="Zuletzt geschafft"
          icon={<Check size={18} className="text-vivid-green" aria-hidden />}
        >
          <ul className="flex flex-col">
            {zuletzt.map((task) => (
              <Zeile
                key={task.id}
                task={task}
                referenceYear={referenceYear}
                vorne={formatDate(task.actualEnd ?? task.currentEnd, referenceYear)}
                {...(onSelect === undefined ? {} : { onSelect })}
              />
            ))}
          </ul>
        </Abschnitt>
      ) : null}

      {/* 5. Erst zum Schluss, was schiefgeht. */}
      {verschoben.length > 0 ? (
        <Abschnitt
          titel="Verschoben"
          icon={<TriangleAlert size={18} className="text-tangerine" aria-hidden />}
          hinweis={
            verschoben.some((task) => task.isCritical)
              ? 'Mindestens einer davon hat keinen Puffer — er verschiebt den Endtermin mit.'
              : 'Alle mit Puffer. Der Endtermin bleibt, wie er ist.'
          }
        >
          <ul className="flex flex-col">
            {verschoben.slice(0, MAX_ZEILEN).map((task) => (
              <Zeile
                key={task.id}
                task={task}
                referenceYear={referenceYear}
                vorne={formatRange(task.currentStart, task.currentEnd, referenceYear)}
                {...(onSelect === undefined ? {} : { onSelect })}
              />
            ))}
          </ul>
        </Abschnitt>
      ) : null}
    </div>
  );
}

function Abschnitt({
  titel,
  icon,
  hinweis,
  children,
}: {
  titel: string;
  icon: React.ReactNode;
  hinweis?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-body font-medium text-charcoal">
        {icon}
        {titel}
      </h2>
      {hinweis !== undefined ? <p className="text-caption text-steel">{hinweis}</p> : null}
      {children}
    </Card>
  );
}

/**
 * Eine Zeile im Cockpit: links wann, rechts was.
 *
 * Bewusst knapper als die Zeile im vollständigen Ablauf — hier zählt der
 * Überblick. Wer mehr wissen will, klickt und bekommt das Blatt.
 */
function Zeile({
  task,
  vorne,
  referenceYear,
  onSelect,
}: {
  task: ScheduledTaskDto;
  vorne: string;
  referenceYear: number;
  onSelect?: (task: ScheduledTaskDto) => void;
}) {
  const Element = onSelect === undefined ? 'div' : 'button';
  // Vorne steht je nach Abschnitt etwas anderes: mal der Zeitraum selbst, mal
  // „in vier Tagen". Nur im zweiten Fall fehlt einer Vorlesesoftware das Datum
  // — sonst stuende es zweimal da.
  const zeitraum = formatRange(task.currentStart, task.currentEnd, referenceYear);
  return (
    <li className="border-b border-ash last:border-b-0">
      <Element
        {...(onSelect === undefined
          ? {}
          : { type: 'button' as const, onClick: () => onSelect(task) })}
        className={`flex w-full flex-col gap-0.5 py-2.5 text-left sm:flex-row sm:items-baseline sm:gap-3 ${
          onSelect === undefined
            ? ''
            : 'cursor-pointer transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist'
        }`}
      >
        <span className="text-body text-steel sm:min-w-[9rem]">{vorne}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 text-body-lg font-medium text-charcoal">
          {task.isMilestone ? <Flag size={14} className="text-electric-blue" aria-hidden /> : null}
          {task.name}
          {task.tradeName !== null ? (
            <span className="text-caption font-normal text-steel">{task.tradeName}</span>
          ) : null}
        </span>
      </Element>
      {vorne === zeitraum ? null : <span className="sr-only">{zeitraum}</span>}
    </li>
  );
}

function Kennzahl({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'ok' | 'warn';
}) {
  const farbe = tone === 'warn' ? 'text-tangerine' : tone === 'ok' ? 'text-vivid-green' : '';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd
        className={`${strong === true ? 'text-heading-sm' : 'text-body-xl'} font-medium ${farbe === '' ? 'text-charcoal' : farbe}`}
      >
        {value}
      </dd>
    </div>
  );
}

function abweichungInWorten(workdays: number): string {
  if (workdays === 0) return 'genau im Plan';
  const tage = Math.abs(workdays) === 1 ? '1 Werktag' : `${Math.abs(workdays)} Werktage`;
  return workdays > 0 ? `${tage} später` : `${tage} früher`;
}
