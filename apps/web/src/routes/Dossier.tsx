/**
 * Die Bauakte — Abschnitt 5.6.
 *
 *     „Auswahl eines Zeitraums oder Vorgangs, dann PDF: Deckblatt mit Projekt-,
 *      Vertrags- und Beteiligtendaten sowie Prüfsumme der Tagebuchkette,
 *      chronologische Darstellung aller Vorgänge, Verschiebungen, Einträge und
 *      Mängel, Fotoanhang mit Zeitstempeln. Bestätigungsgrade sind optisch
 *      unterscheidbar."
 *
 * Diese Seite **ist** das PDF. Der Server stellt die Akte zusammen — die
 * Chronologie, die Prüfsummen, die Reihenfolge —, der Browser setzt sie und
 * druckt sie. Warum nicht andersherum, steht ausführlich in
 * `apps/api/src/dossier.ts`: Der Fotoanhang bräuchte einen Server, der die
 * Bilder lesen kann, und lesen darf sie nur, wer eine Sitzung hat.
 *
 * **Die Unterscheidbarkeit ist die Abnahme.** Sie funktioniert deshalb ohne
 * Farbe: ein Zeichen (● ◐ ○ ⚠), ein Wort und die Rahmenstärke. Ein
 * ausgedrucktes PDF ist oft schwarzweiß, und eine Unterscheidung, die den Weg
 * durch einen Bürodrucker nicht übersteht, ist im Streitfall keine.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  CONFIRMATION_MARK,
  type Dossier as DossierDto,
  type DossierEntry,
} from '@meinbaulotse/shared';
import { Button, Card, Field, TextInput } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { signedUrlsFor } from '../lib/media-store';
import {
  BUILD_TYPE_LABEL,
  CONFIRMATION_LABEL,
  CONTRACT_TYPE_LABEL,
  FEDERAL_STATE_LABEL,
  formatDateWithWeekday,
  formatMoney,
} from '../lib/format';
import { ROLE_LABEL } from '../lib/roles';
import { monateZurueck } from '../lib/period';
import { todayIso } from '../lib/progress';

const KIND_LABEL: Record<DossierEntry['kind'], string> = {
  vorgang: 'Vorgang',
  verschiebung: 'Terminänderung',
  abstimmung: 'Abstimmung',
  tagebuch: 'Tagebuch',
  mangel: 'Mangel',
  zahlung: 'Zahlung',
  entscheidung: 'Entscheidung',
};

/** Der voreingestellte Zeitraum: die letzten drei Monate (Abnahme AP 9). */
function dreiMonateZurueck(bis: string): string {
  return monateZurueck(bis, 3);
}

export function Dossier() {
  const { projectId } = useParams<{ projectId: string }>();
  const heute = todayIso();
  const [von, setVon] = useState(() => dreiMonateZurueck(heute));
  const [bis, setBis] = useState(heute);
  const [zeitraum, setZeitraum] = useState({ from: dreiMonateZurueck(heute), to: heute });
  const [exportFehler, setExportFehler] = useState<string | null>(null);

  const akte = useQuery({
    queryKey: ['dossier', projectId, zeitraum.from, zeitraum.to],
    queryFn: () => api.dossier(projectId!, zeitraum.from, zeitraum.to),
    enabled: projectId !== undefined,
  });

  async function exportieren(): Promise<void> {
    setExportFehler(null);
    try {
      const daten = await api.exportProject(projectId!);
      const blob = new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' });
      const adresse = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = adresse;
      link.download = `meinbaulotse-export-${heute}.json`;
      link.click();
      URL.revokeObjectURL(adresse);
    } catch (fehler) {
      setExportFehler(
        fehler instanceof ApiError ? fehler.message : 'Der Export ging gerade nicht.',
      );
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 py-8 print:max-w-none print:px-0 print:py-0 sm:px-6">
      {/* Alles, was zur Bedienung gehört, verschwindet im Druck. */}
      <div className="flex flex-col gap-6 print:hidden">
        <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

        <header className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Bauakte</h1>
          <p className="max-w-[38rem] text-body text-steel">
            Deine Chronik als Dokument: was wann passiert ist, wer es gesagt hat, und ob die
            Gegenseite zugestimmt hat. Zum Sichern als PDF: drucken und „Als PDF sichern" wählen.
          </p>
        </header>

        <Card className="flex flex-wrap items-end gap-4">
          <Field label="Von">
            <TextInput type="date" value={von} onChange={(event) => setVon(event.target.value)} />
          </Field>
          <Field label="Bis">
            <TextInput type="date" value={bis} onChange={(event) => setBis(event.target.value)} />
          </Field>
          <Button size="md" onClick={() => setZeitraum({ from: von, to: bis })}>
            Zeitraum übernehmen
          </Button>
          <Button variant="primary" size="md" onClick={() => window.print()}>
            <Printer size={16} aria-hidden />
            Drucken oder als PDF sichern
          </Button>
          <Button size="md" onClick={() => void exportieren()}>
            <Download size={16} aria-hidden />
            Alle Daten als JSON
          </Button>
        </Card>

        {exportFehler === null ? null : (
          <p className="text-body text-alarm-red">{exportFehler}</p>
        )}
      </div>

      {akte.isPending ? (
        <p className="text-body text-steel print:hidden">Die Akte wird zusammengestellt.</p>
      ) : akte.data === undefined ? (
        <p className="text-body text-steel print:hidden">
          {akte.error instanceof ApiError ? akte.error.message : 'Das ging gerade nicht.'}
        </p>
      ) : (
        <Akte akte={akte.data} />
      )}
    </main>
  );
}

function Akte({ akte }: { akte: DossierDto }) {
  return (
    <article className="flex flex-col gap-8 text-charcoal">
      <Deckblatt akte={akte} />
      <Chronik entries={akte.entries} />
      <Fotoanhang media={akte.media} />

      <footer className="border-t border-ash pt-3 text-caption text-steel">
        Erstellt am {new Date(akte.generatedAt).toLocaleString('de-DE')} mit MeinBaulotse. Diese
        Akte gibt wieder, was in der Anwendung erfasst wurde. Sie ist kein Sachverständigengutachten
        und keine rechtliche Bewertung.
      </footer>
    </article>
  );
}

function Deckblatt({ akte }: { akte: DossierDto }) {
  const { project, chain, confirmationCounts } = akte;

  return (
    <section className="flex flex-col gap-5 break-after-page">
      <div className="flex flex-col gap-1 border-b-2 border-midnight-ink pb-4">
        <h2 className="display-title text-heading-lg">Bauakte</h2>
        <p className="text-body-xl">{project.name}</p>
        <p className="text-body text-steel">
          {[project.address, [project.postalCode, project.city].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ')}
        </p>
        <p className="text-body text-steel">
          Zeitraum {formatDateWithWeekday(akte.period.from)} bis{' '}
          {formatDateWithWeekday(akte.period.to)}
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Zeile
          label="Vertragsart"
          wert={CONTRACT_TYPE_LABEL[project.contractType] ?? project.contractType}
        />
        <Zeile label="Bauweise" wert={BUILD_TYPE_LABEL[project.buildType] ?? project.buildType} />
        {/* Das Bundesland steht hier, weil an ihm die Feiertage hängen — und
            damit jeder Werktag in dieser Akte. */}
        <Zeile
          label="Bundesland"
          wert={FEDERAL_STATE_LABEL[project.federalState] ?? project.federalState}
        />
        <Zeile label="Baubeginn geplant" wert={formatDateWithWeekday(project.plannedStart)} />
        <Zeile
          label="Geschuldete Fertigstellung"
          wert={
            project.contractualCompletion === null
              ? 'nicht erfasst'
              : formatDateWithWeekday(project.contractualCompletion)
          }
        />
        <Zeile
          label="Errechnete Fertigstellung"
          wert={
            project.computedEnd === null ? '—' : formatDateWithWeekday(project.computedEnd)
          }
        />
        <Zeile
          label="Gesamtvergütung"
          wert={project.contractSumCents === null ? 'nicht erfasst' : formatMoney(project.contractSumCents)}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-body font-medium">Beteiligte</h3>
        <ul className="flex flex-col gap-1">
          {akte.members.map((mitglied, index) => (
            <li key={`${mitglied.displayName ?? ''}-${index}`} className="text-body">
              <span className="font-medium">{mitglied.displayName ?? 'Ohne Namen'}</span>
              {' · '}
              {ROLE_LABEL[mitglied.role]}
              {mitglied.tradeName === null ? '' : ` · ${mitglied.tradeName}`}
              {mitglied.company === null ? '' : ` · ${mitglied.company}`}
            </li>
          ))}
        </ul>
      </div>

      {/* Die Prüfsumme der Tagebuchkette gehört laut 5.6 aufs Deckblatt. Sie ist
          die eine Zeile, die eine Chronik von einer Sammlung unterscheidet. */}
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-ash p-4">
        <h3 className="flex items-center gap-2 text-body font-medium">
          {chain.intact ? (
            <ShieldCheck size={16} className="text-vivid-green" aria-hidden />
          ) : (
            <TriangleAlert size={16} className="text-alarm-red" aria-hidden />
          )}
          Tagebuchkette
        </h3>
        {chain.intact ? (
          <p className="text-body">
            {chain.sealedCount === 0
              ? 'Noch nichts versiegelt.'
              : chain.sealedCount === 1
                ? 'Ein versiegelter Eintrag, unverändert seit dem Schreiben.'
                : `${chain.sealedCount} versiegelte Einträge, lückenlos verkettet und unverändert.`}
            {chain.openCount === 0
              ? ''
              : chain.openCount === 1
                ? ' Ein weiterer ist noch keine 24 Stunden alt und damit noch änderbar.'
                : ` ${chain.openCount} weitere sind noch keine 24 Stunden alt und damit noch änderbar.`}
          </p>
        ) : (
          <p className="text-body text-alarm-red">
            Die Kette ist an {chain.breaks.length}{' '}
            {chain.breaks.length === 1 ? 'Stelle' : 'Stellen'} unterbrochen. Für diese Akte zählt
            damit nur, was davor liegt.
          </p>
        )}
        {chain.headHash === null ? null : (
          <p className="font-mono text-caption break-all text-steel">
            Prüfsumme: {chain.headHash}
          </p>
        )}
      </div>

      {/* Die Legende. Sie steht aufs Deckblatt, weil die Unterscheidung ohne
          sie nur ein Zeichen ist — und mit ihr eine Aussage. */}
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-paper-mist p-4">
        <h3 className="text-body font-medium">Wie Termine in dieser Akte gekennzeichnet sind</h3>
        <ul className="flex flex-col gap-1 text-body">
          <li>
            <span className="font-mono">{CONFIRMATION_MARK.mutual}</span> {CONFIRMATION_LABEL.mutual}{' '}
            — beide Seiten haben zugestimmt ({confirmationCounts.mutual})
          </li>
          <li>
            <span className="font-mono">{CONFIRMATION_MARK.counterparty_stated}</span>{' '}
            {CONFIRMATION_LABEL.counterparty_stated} — vom ausführenden Unternehmen genannt,
            nicht gegenbestätigt ({confirmationCounts.counterparty_stated})
          </li>
          <li>
            <span className="font-mono">{CONFIRMATION_MARK.self_stated}</span>{' '}
            {CONFIRMATION_LABEL.self_stated} — einseitig, von der Bauherrenseite (
            {confirmationCounts.self_stated})
          </li>
          <li>
            <span className="font-mono">{CONFIRMATION_MARK.disputed}</span>{' '}
            {CONFIRMATION_LABEL.disputed} — beide Seiten haben verschiedene Termine genannt (
            {confirmationCounts.disputed})
          </li>
        </ul>
      </div>
    </section>
  );
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd className="text-body">{wert}</dd>
    </div>
  );
}

function Chronik({ entries }: { entries: DossierEntry[] }) {
  if (entries.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-subheading font-medium">Chronologie</h2>
        <p className="text-body text-steel">In diesem Zeitraum ist nichts erfasst.</p>
      </section>
    );
  }

  const nachTag = new Map<string, DossierEntry[]>();
  for (const eintrag of entries) {
    nachTag.set(eintrag.on, [...(nachTag.get(eintrag.on) ?? []), eintrag]);
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-subheading font-medium">Chronologie</h2>
      {[...nachTag.entries()].map(([tag, desTages]) => (
        <div key={tag} className="flex break-inside-avoid flex-col gap-2">
          <h3 className="border-b border-ash pb-1 text-body font-medium">
            {formatDateWithWeekday(tag)}
          </h3>
          <ul className="flex flex-col gap-2">
            {desTages.map((eintrag, index) => (
              <li key={`${eintrag.at}-${index}`}>
                <Eintrag eintrag={eintrag} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Eintrag({ eintrag }: { eintrag: DossierEntry }) {
  // Die Rahmenstärke ist die dritte Ebene der Unterscheidung — sie trägt auch
  // dann, wenn Zeichen und Wort im Ausdruck verrutschen.
  const rahmen =
    eintrag.confirmation === 'mutual'
      ? 'border-l-4 border-l-midnight-ink'
      : eintrag.confirmation === 'disputed'
        ? 'border-l-4 border-l-tangerine border-dashed'
        : eintrag.confirmation === 'counterparty_stated'
          ? 'border-l-2 border-l-steel'
          : eintrag.confirmation === 'self_stated'
            ? 'border-l border-l-fog'
            : 'border-l border-l-ash';

  return (
    <div className={`flex break-inside-avoid flex-col gap-0.5 pl-3 ${rahmen}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-body">
        {eintrag.confirmation === null ? null : (
          <span className="font-mono" aria-hidden>
            {CONFIRMATION_MARK[eintrag.confirmation]}
          </span>
        )}
        <span className="font-medium">{eintrag.title}</span>
        <span className="text-caption text-steel">{KIND_LABEL[eintrag.kind]}</span>
        {eintrag.confirmation === null ? null : (
          <span className="text-caption text-steel">
            {CONFIRMATION_LABEL[eintrag.confirmation]}
          </span>
        )}
      </p>
      {eintrag.detail === null || eintrag.detail === '' ? null : (
        <p className="text-body whitespace-pre-wrap text-charcoal">{eintrag.detail}</p>
      )}
      {eintrag.actor === null && eintrag.channel === null ? null : (
        <p className="text-caption text-steel">
          {[eintrag.actor, eintrag.actorRole === null ? null : ROLE_LABEL[eintrag.actorRole], eintrag.channel]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {eintrag.hash === null ? null : (
        <p className="font-mono text-caption break-all text-fog">{eintrag.hash}</p>
      )}
    </div>
  );
}

/**
 * Der Fotoanhang.
 *
 * Die Bilder holt der Browser mit seiner eigenen Sitzung — sie kommen nie an
 * einem Server vorbei, der sie lesen könnte. Unter jedem steht, was es belegt
 * und wann es aufgenommen wurde, und die Prüfsumme dazu: Ohne sie ist ein Bild
 * in einer Akte ein Bild, mit ihr ein Beleg.
 */
function Fotoanhang({ media }: { media: DossierDto['media'] }) {
  const [adressen, setAdressen] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let abgebrochen = false;
    void signedUrlsFor(
      media.map((foto) => foto.storagePath),
      3600,
    ).then((karte) => {
      if (!abgebrochen) setAdressen(karte);
    });
    return () => {
      abgebrochen = true;
    };
  }, [media]);

  if (media.length === 0) {
    return (
      <section className="break-before-page">
        <h2 className="mb-3 text-subheading font-medium">Fotoanhang</h2>
        <p className="text-body text-steel">In diesem Zeitraum sind keine Fotos erfasst.</p>
      </section>
    );
  }

  return (
    <section className="flex break-before-page flex-col gap-4">
      <h2 className="text-subheading font-medium">
        Fotoanhang · {media.length} {media.length === 1 ? 'Aufnahme' : 'Aufnahmen'}
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {media.map((foto) => {
          const adresse = adressen.get(foto.storagePath);
          return (
            <li key={foto.id} className="flex break-inside-avoid flex-col gap-1">
              <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border border-ash bg-paper-mist">
                {adresse === undefined ? (
                  <span className="flex h-full w-full items-center justify-center p-2 text-center text-caption text-fog">
                    Bild nicht abrufbar
                  </span>
                ) : (
                  <img
                    src={adresse}
                    alt={foto.caption ?? 'Baustellenfoto'}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <p className="text-body">{foto.caption ?? foto.taskName ?? 'Ohne Beschriftung'}</p>
              <p className="text-caption text-steel">
                {[
                  foto.statedDate === null ? null : formatDateWithWeekday(foto.statedDate),
                  foto.capturedAt === null
                    ? null
                    : `Gerät: ${new Date(foto.capturedAt).toLocaleString('de-DE')}`,
                  foto.exifTakenAt === null
                    ? null
                    : `Kamera: ${new Date(foto.exifTakenAt).toLocaleString('de-DE')}`,
                  foto.taskName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="font-mono text-caption break-all text-fog">sha256 {foto.sha256}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
