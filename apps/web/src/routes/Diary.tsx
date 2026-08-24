/**
 * Das Bautagebuch — Abschnitt 3.8, letzter Satz:
 *
 *     „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum seiner
 *      Baustelle. Die Beweisqualität ist ein Nebenprodukt."
 *
 * Deshalb sieht diese Seite aus wie ein Album und nicht wie ein Protokoll.
 * Versiegelung, Hash-Kette und Prüfsumme stehen zwar da, aber klein, am Rand
 * und in Worten statt in Hexadezimal: „Vollständig und unverändert" ist eine
 * Zeile, die niemand liest, solange sie stimmt — und die einzige, die zählt,
 * wenn sie einmal nicht stimmt.
 *
 * Die einzige Stelle, an der die Mechanik nach vorn tritt, ist ein Bruch in
 * der Kette. Dann steht er oben und in Rot, denn dann ist er die Nachricht.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CloudSun,
  Lock,
  ShieldCheck,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import {
  weatherInPlainWords,
  weatherStoppedWork,
  type DiaryEntryDto,
  type MediaDto,
} from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Pill } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { api } from '../lib/api';
import { signedUrlsFor } from '../lib/media-store';
import { formatDateWithWeekday } from '../lib/format';

export function Diary() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const tagebuch = useQuery({
    queryKey: ['diary', projectId],
    queryFn: () => api.diary(projectId!),
    enabled: projectId !== undefined,
  });

  const kette = useQuery({
    queryKey: ['diary-chain', projectId],
    queryFn: () => api.verifyDiary(projectId!),
    enabled: projectId !== undefined,
  });

  const zurueckziehen = useMutation({
    mutationFn: ({ entryId, grund }: { entryId: string; grund: string }) =>
      api.updateDiaryEntry(projectId!, entryId, { retract: grund }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['diary', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['diary-chain', projectId] });
    },
  });

  const eintraege = tagebuch.data?.entries ?? [];

  return (
    <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Bautagebuch</h1>
          <p className="text-body text-steel">
            {eintraege.length === 0
              ? 'Noch nichts festgehalten.'
              : `${eintraege.length} ${eintraege.length === 1 ? 'Eintrag' : 'Einträge'}`}
          </p>
        </div>
        <Link
          to={`/projekt/${projectId ?? ''}/erfassen`}
          className="inline-flex h-14 items-center gap-2 rounded-[var(--radius-button)] bg-midnight-ink px-6 text-body-lg font-medium text-canvas-white"
        >
          <Camera size={20} aria-hidden />
          Foto aufnehmen
        </Link>
      </header>

      {/* Ein Bruch ist die Nachricht. Alles andere steht unten und klein. */}
      {kette.data !== undefined && !kette.data.intact ? (
        <Card className="flex flex-col gap-2 border-alarm-red">
          <span className="flex items-center gap-2 text-body-lg font-medium text-alarm-red">
            <TriangleAlert size={20} aria-hidden />
            Diese Chronik stimmt nicht mehr mit sich selbst überein.
          </span>
          <p className="text-body text-steel">
            {kette.data.breaks.length === 1
              ? 'Ein Eintrag wurde nach seiner Versiegelung verändert.'
              : `${kette.data.breaks.length} Einträge wurden nach ihrer Versiegelung verändert.`}{' '}
            Für eine Bauakte zählt ab hier nur, was davor liegt. Sprich uns bitte an.
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {kette.data.breaks.map((bruch) => (
              <li key={bruch.entryId} className="text-caption text-steel">
                {formatDateWithWeekday(bruch.entryDate)} — {bruch.reason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tagebuch.isPending ? (
        <p className="text-body text-steel">Das Tagebuch wird geladen.</p>
      ) : eintraege.length === 0 ? (
        <EmptyState
          text="Hier entsteht die Chronik deiner Baustelle. Ein Foto vom Leitungsverlauf, bevor der Estrich kommt, ist in sechs Jahren mehr wert als jede Erinnerung."
          action={
            <Link
              to={`/projekt/${projectId ?? ''}/erfassen`}
              className="inline-flex h-14 items-center gap-2 rounded-[var(--radius-button)] bg-midnight-ink px-6 text-body-lg font-medium text-canvas-white"
            >
              <Camera size={20} aria-hidden />
              Erstes Foto
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {eintraege.map((eintrag) => (
            <li key={eintrag.id}>
              <Eintrag
                eintrag={eintrag}
                zurueckziehen={(grund) =>
                  zurueckziehen.mutate({ entryId: eintrag.id, grund })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* Die Zusicherung, ganz unten. Wer sie sucht, findet sie; wer sein
          Fotoalbum ansieht, wird nicht damit behelligt. */}
      {kette.data !== undefined && kette.data.intact && kette.data.sealedCount > 0 ? (
        <p className="flex items-start gap-2 text-caption text-steel">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-vivid-green" aria-hidden />
          <span>
            {kette.data.sealedCount === 1
              ? 'Ein Eintrag ist versiegelt'
              : `${kette.data.sealedCount} Einträge sind versiegelt`}{' '}
            und lückenlos miteinander verkettet — vollständig und unverändert.
            {kette.data.openCount > 0
              ? ` ${kette.data.openCount === 1 ? 'Ein Eintrag ist' : `${kette.data.openCount} Einträge sind`} noch keine 24 Stunden alt und damit noch änderbar.`
              : ''}
          </span>
        </p>
      ) : null}
    </main>
  );
}

function Eintrag({
  eintrag,
  zurueckziehen,
}: {
  eintrag: DiaryEntryDto;
  zurueckziehen: (grund: string) => void;
}) {
  const [grundGefragt, setGrundGefragt] = useState(false);
  const [grund, setGrund] = useState('');
  const wetterhinweis = weatherStoppedWork(eintrag.weather);

  return (
    <Card
      className={`flex flex-col gap-3 ${eintrag.retractedAt === null ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-body-lg font-medium text-charcoal">
          {formatDateWithWeekday(eintrag.entryDate)}
        </h2>
        {eintrag.authorName === null ? null : (
          <span className="text-caption text-steel">{eintrag.authorName}</span>
        )}
        {eintrag.retractedAt !== null ? (
          <Pill tone="neutral" icon={<Undo2 size={12} aria-hidden />}>
            Zurückgezogen
          </Pill>
        ) : eintrag.sealedAt !== null ? (
          // Klein und grau: Versiegelt zu sein ist der Normalfall, keine
          // Auszeichnung.
          <span className="inline-flex items-center gap-1 text-caption text-fog">
            <Lock size={12} aria-hidden />
            versiegelt
          </span>
        ) : (
          <span className="text-caption text-steel">
            {eintrag.editableForMinutes === null || eintrag.editableForMinutes < 60
              ? 'noch kurz änderbar'
              : `noch ${Math.floor(eintrag.editableForMinutes / 60)} Stunden änderbar`}
          </span>
        )}
      </div>

      {eintrag.body === '' ? null : (
        <p className="text-body-lg whitespace-pre-wrap text-charcoal">{eintrag.body}</p>
      )}

      {eintrag.retractionReason === null ? null : (
        <p className="text-body text-steel">Zurückgezogen: {eintrag.retractionReason}</p>
      )}

      {eintrag.media.length > 0 ? <Album media={eintrag.media} /> : null}

      {eintrag.taskNames.length > 0 ? (
        <p className="text-caption text-steel">Zu: {eintrag.taskNames.join(', ')}</p>
      ) : null}

      {eintrag.weather !== null ? (
        <p className="flex items-start gap-2 text-caption text-steel">
          <CloudSun size={14} className="mt-0.5 shrink-0 text-lavender" aria-hidden />
          <span>
            {weatherInPlainWords(eintrag.weather)}
            {eintrag.weather.stationName === null
              ? ''
              : ` Station ${eintrag.weather.stationName}${
                  eintrag.weather.distanceMeters === null
                    ? ''
                    : `, ${Math.round(eintrag.weather.distanceMeters / 1000)} km`
                }.`}
            {wetterhinweis === null ? '' : ` ${wetterhinweis}`}
          </span>
        </p>
      ) : null}

      {eintrag.retractedAt === null ? (
        grundGefragt ? (
          <div className="flex flex-col gap-2">
            <input
              value={grund}
              onChange={(event) => setGrund(event.target.value)}
              placeholder="Warum ziehst du den Eintrag zurück?"
              className="h-11 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body text-charcoal placeholder:text-fog"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={grund.trim().length < 3}
                onClick={() => zurueckziehen(grund.trim())}
              >
                Zurückziehen
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setGrundGefragt(false)}>
                Abbrechen
              </Button>
            </div>
            {/* Kein Löschen, und der Grund steht dabei. Wer nur „gelöscht"
                liest, hält es für einen Fehler der Anwendung. */}
            <p className="text-caption text-steel">
              Der Eintrag bleibt sichtbar und trägt deinen Grund. Gelöscht wird hier nichts —
              eine Chronik mit Lücken wäre keine.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setGrundGefragt(true)}
            className="self-start text-caption text-steel underline underline-offset-2 hover:text-charcoal"
          >
            Zurückziehen
          </button>
        )
      ) : null}
    </Card>
  );
}

/**
 * Die Bilder eines Eintrags.
 *
 * Die Adressen sind kurzlebig und werden für alle Bilder auf einmal geholt
 * (Abschnitt 6.4). Ein Album mit dreißig Bildern wären sonst dreißig Anfragen,
 * und das ist auf einer Baustelle der Unterschied zwischen „lädt" und „lädt
 * nicht".
 */
function Album({ media }: { media: MediaDto[] }) {
  const [adressen, setAdressen] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let abgebrochen = false;
    void signedUrlsFor(media.map((foto) => foto.storagePath)).then((karte) => {
      if (!abgebrochen) setAdressen(karte);
    });
    return () => {
      abgebrochen = true;
    };
  }, [media]);

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {media.map((foto) => {
        const adresse = adressen.get(foto.storagePath);
        return (
          <li
            key={foto.id}
            className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] bg-paper-mist"
          >
            {adresse === undefined ? (
              <span className="flex h-full w-full items-center justify-center p-2 text-center text-caption text-fog">
                {foto.caption ?? 'Bild'}
              </span>
            ) : (
              <img
                src={adresse}
                alt={foto.caption ?? 'Baustellenfoto'}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
            {/* Abweichungen werden angezeigt, nicht versteckt (Abschnitt 3.8).
                Ein Foto, das laut Kamera von einem anderen Tag stammt, ist
                keine Panne, sondern eine Auskunft. */}
            {abweichung(foto) === null ? null : (
              <span className="absolute right-1 bottom-1 left-1 rounded-[var(--radius-pill)] bg-midnight-ink/80 px-2 py-0.5 text-center text-caption text-canvas-white">
                {abweichung(foto)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Wann sagt die Kamera etwas anderes als der Nutzer? */
function abweichung(foto: MediaDto): string | null {
  if (foto.exifTakenAt === null || foto.statedDate === null) return null;
  const ausDerKamera = foto.exifTakenAt.slice(0, 10);
  if (ausDerKamera === foto.statedDate) return null;
  return `Kamera: ${formatDateWithWeekday(ausDerKamera)}`;
}
