/**
 * Die Bauakte (Abschnitt 5.6).
 *
 * „Im Produkt heißt das **Bauakte**, nicht Beweisakte. Der Nutzer soll sie
 * anlegen, weil sie ordentlich ist, nicht weil er Streit erwartet."
 *
 * Diese Seite **ist** die Akte. Es gibt keinen Erzeuger auf dem Server, der
 * ein PDF bastelt — der Browser druckt diese Seite, und „Als PDF sichern" ist
 * auf jedem Gerät derselbe Griff. Zwei Gründe, und der zweite wiegt schwerer:
 *
 * 1. Der Browser hat die CI-Schriften und setzt sie besser, als eine
 *    Bibliothek im Serverbündel es je täte.
 * 2. **Fotos gehen nie durch den Anwendungsserver** (Abschnitt 6.1). Ein
 *    Erzeuger dort müsste jedes Baustellenfoto durch die Function ziehen.
 *    Hier holt sie der Browser mit der Sitzung des Nutzers direkt aus der
 *    Ablage, wie überall sonst.
 *
 * Die Abnahme von AP 9 verlangt, dass „abgestimmte, einseitige und
 * widersprüchliche Angaben optisch unterscheidbar" sind. Das ist der Grund
 * für `Grad` weiter unten — und dafür, dass dort **nie die Farbe allein**
 * unterscheidet: Eine Akte wird gedruckt, und gedruckt wird oft in Graustufen.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import type { Dossier as DossierData, DossierEvent } from '@meinbaulotse/shared';
import { Button } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { Photo } from '../components/Photo';
import { api } from '../lib/api';
import {
  BUILD_TYPE_LABEL,
  CONFIRMATION_LABEL,
  CONTRACT_TYPE_LABEL,
  FEDERAL_STATE_LABEL,
  formatDate,
  formatDateWithWeekday,
} from '../lib/format';
import { ROLE_LABEL } from '../lib/roles';

const KIND_LABEL: Record<DossierEvent['kind'], string> = {
  vorgang: 'Vorgang',
  aenderung: 'Terminänderung',
  tagebuch: 'Bautagebuch',
  mangel: 'Mangel',
  zahlung: 'Zahlung',
};

function vorMonaten(monate: number): string {
  const heute = new Date();
  heute.setMonth(heute.getMonth() - monate);
  return heute.toISOString().slice(0, 10);
}

export function Dossier() {
  const { projectId } = useParams<{ projectId: string }>();
  const [von, setVon] = useState(vorMonaten(3));
  const [bis, setBis] = useState(new Date().toISOString().slice(0, 10));

  const akte = useQuery({
    queryKey: ['dossier', projectId, von, bis],
    queryFn: () => api.dossier(projectId!, von, bis),
    enabled: projectId !== undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 py-6 sm:px-6 print:max-w-none print:px-0 print:py-0">
      {/* Alles, was nicht zur Akte gehört, verschwindet im Druck. */}
      <div className="flex flex-col gap-6 print:hidden">
        <TopBar
          back={{ to: `/projekt/${projectId ?? ''}`, label: akte.data?.project.name ?? 'Zurück' }}
        />

        <header className="flex flex-col gap-1">
          <p className="text-caption text-steel">Bauakte</p>
          <h1 className="display-title text-heading-lg text-charcoal">Deine Akte zum Bau</h1>
          <p className="max-w-[38rem] text-body text-steel">
            Alles, was in einem Zeitraum passiert ist, in einem Strang: Vorgänge,
            Terminänderungen, Tagebucheinträge, Mängel und Zahlungen — mit den Fotos und der
            Prüfsumme der Tagebuchkette.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-steel">Von</span>
            <input
              type="date"
              value={von}
              onChange={(event) => setVon(event.target.value)}
              className="h-11 rounded-[var(--radius-input)] border border-pebble px-3 text-body"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-steel">Bis</span>
            <input
              type="date"
              value={bis}
              onChange={(event) => setBis(event.target.value)}
              className="h-11 rounded-[var(--radius-input)] border border-pebble px-3 text-body"
            />
          </label>
          <Button variant="primary" size="field" onClick={() => window.print()}>
            <Printer size={18} aria-hidden />
            Drucken oder als PDF sichern
          </Button>
          <a
            href={`/api/v1/projects/${projectId ?? ''}/export`}
            className="inline-flex h-14 items-center gap-2 rounded-[var(--radius-button)] border border-ash px-6 text-body-lg text-charcoal hover:bg-paper-mist"
          >
            <Download size={18} aria-hidden />
            Alle Daten als Datei
          </a>
        </div>
      </div>

      {akte.isPending ? <p className="text-body text-steel">…</p> : null}
      {akte.isError ? (
        <p className="text-body text-charcoal">
          Die Akte legt der Bauherr an — oder ein Sachverständiger.
        </p>
      ) : null}

      {akte.data === undefined ? null : <Akte akte={akte.data} />}
    </main>
  );
}

function Akte({ akte }: { akte: DossierData }) {
  return (
    <article className="flex flex-col gap-8 print:gap-6 print:text-[10.5pt]">
      <Deckblatt akte={akte} />

      <section className="flex flex-col gap-4 print:break-before-page">
        <h2 className="text-heading-sm text-charcoal">Chronologie</h2>
        {akte.events.length === 0 ? (
          <p className="text-body text-steel">
            In diesem Zeitraum ist nichts erfasst worden.
          </p>
        ) : (
          <ul className="flex flex-col">
            {akte.events.map((ereignis, index) => (
              <li
                key={`${ereignis.kind}-${ereignis.date}-${index}`}
                className="flex flex-col gap-1 border-t border-ash py-3 print:break-inside-avoid"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-caption text-steel tabular-nums">
                    {formatDate(ereignis.date)}
                  </span>
                  <span className="text-caption text-fog">{KIND_LABEL[ereignis.kind]}</span>
                  <span className="text-body font-medium text-charcoal">{ereignis.title}</span>
                  {ereignis.confirmation === undefined ? null : (
                    <Grad wert={ereignis.confirmation} />
                  )}
                  {ereignis.sealed === true ? (
                    <span className="text-caption text-steel">versiegelt</span>
                  ) : null}
                  {ereignis.retracted === true ? (
                    <span className="text-caption text-tangerine">zurückgezogen</span>
                  ) : null}
                </div>
                <p className="whitespace-pre-line text-body text-steel">{ereignis.detail}</p>
                {ereignis.actor === null || ereignis.actor === undefined ? null : (
                  <p className="text-caption text-fog">
                    {ereignis.actor}
                    {ereignis.channel === undefined || ereignis.channel === 'app'
                      ? ''
                      : ` · ${ereignis.channel}`}
                  </p>
                )}
                {ereignis.hash === null || ereignis.hash === undefined ? null : (
                  <p className="font-mono text-[9px] break-all text-fog">{ereignis.hash}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {akte.photos.length === 0 ? null : (
        <section className="flex flex-col gap-4 print:break-before-page">
          <h2 className="text-heading-sm text-charcoal">Fotos</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {akte.photos.map((foto) => (
              <li key={foto.id} className="flex flex-col gap-1 print:break-inside-avoid">
                {/* Dasselbe Bauteil wie im Tagebuch — samt der Regel, dass
                    eine abweichende Aufnahmezeit angezeigt wird. */}
                <Photo item={foto} />
                {/* Die Prüfsumme steht am Bild und nicht in einer Fußnote:
                    Sie gehört zu diesem Foto und zu keinem anderen. */}
                <p className="font-mono text-[8px] break-all text-fog">{foto.sha256}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-ash pt-3 text-caption text-fog">
        Erstellt am {formatDateWithWeekday(akte.createdAt.slice(0, 10))} mit MeinBaulotse.
        Diese Akte gibt wieder, was zu diesem Zeitpunkt erfasst war.
      </footer>
    </article>
  );
}

function Deckblatt({ akte }: { akte: DossierData }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-caption text-steel">Bauakte</p>
        <h1 className="display-title text-heading-lg text-charcoal">{akte.project.name}</h1>
        <p className="text-body text-steel">
          {akte.project.address === ''
            ? (FEDERAL_STATE_LABEL[akte.project.federalState] ?? akte.project.federalState)
            : akte.project.address}
        </p>
        <p className="text-body text-charcoal">
          Zeitraum {formatDate(akte.period.from)} bis {formatDate(akte.period.to)}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-body">
        <Zeile
          begriff="Vertragsart"
          wert={CONTRACT_TYPE_LABEL[akte.project.contractType] ?? akte.project.contractType}
        />
        <Zeile
          begriff="Bauweise"
          wert={BUILD_TYPE_LABEL[akte.project.buildType] ?? akte.project.buildType}
        />
        <Zeile
          begriff="Bundesland"
          wert={FEDERAL_STATE_LABEL[akte.project.federalState] ?? akte.project.federalState}
        />
        <Zeile begriff="Keller" wert={akte.project.hasBasement ? 'ja' : 'nein'} />
        <Zeile begriff="Baubeginn" wert={formatDate(akte.project.plannedStart)} />
        <Zeile
          begriff="Geschuldete Fertigstellung"
          wert={
            akte.project.contractualCompletion === null
              ? 'nicht erfasst'
              : formatDate(akte.project.contractualCompletion)
          }
        />
        <Zeile
          begriff="Gesamtvergütung"
          wert={
            akte.project.contractSumCents === null
              ? 'nicht erfasst'
              : `${Math.round(akte.project.contractSumCents / 100).toLocaleString('de-DE')} €`
          }
        />
        <Zeile
          begriff="Sicherheit"
          wert={akte.project.securityPct === null ? 'nicht erfasst' : `${akte.project.securityPct} %`}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h2 className="text-body font-medium text-charcoal">Beteiligte</h2>
        <ul className="flex flex-col gap-0.5">
          {akte.members.map((mitglied, index) => (
            <li key={index} className="text-body text-steel">
              {mitglied.displayName ?? '—'}
              {mitglied.company === null ? '' : `, ${mitglied.company}`}
              {' · '}
              {ROLE_LABEL[mitglied.role as keyof typeof ROLE_LABEL] ?? mitglied.role}
              {mitglied.tradeName === null ? '' : ` (${mitglied.tradeName})`}
            </li>
          ))}
        </ul>
      </div>

      {/* Die Prüfsumme gehört aufs Deckblatt (Abschnitt 5.6). Sie ist der
          Grund, warum diese Akte etwas anderes ist als ein Ausdruck: Wer sie
          hat, kann später zeigen, dass an den Einträgen nichts geändert
          wurde. */}
      <div className="flex flex-col gap-1 border border-ash p-3">
        <p className="text-body font-medium text-charcoal">Tagebuchkette</p>
        <p className="text-body text-steel">
          {akte.chain.sealedCount === 0
            ? 'Noch kein Eintrag versiegelt.'
            : `${akte.chain.sealedCount} versiegelte Einträge, Kette ${
                akte.chain.intact ? 'lückenlos' : 'unterbrochen'
              }.`}
        </p>
        {akte.chain.headHash === null ? null : (
          <p className="font-mono text-[9px] break-all text-charcoal">{akte.chain.headHash}</p>
        )}
        <p className="text-caption text-fog">
          Jeder versiegelte Eintrag trägt die Prüfsumme des vorherigen. Ändert sich einer
          nachträglich, passt diese Zahl nicht mehr.
        </p>
      </div>
    </section>
  );
}

function Zeile({ begriff, wert }: { begriff: string; wert: string }) {
  return (
    <>
      <dt className="text-steel">{begriff}</dt>
      <dd className="text-charcoal">{wert}</dd>
    </>
  );
}

/**
 * Der Bestätigungsgrad, optisch unterscheidbar — die Abnahme von AP 9.
 *
 * Und zwar **nicht durch Farbe allein**. Eine Akte wird gedruckt, und
 * gedruckt wird oft in Graustufen; dann sähen Grün und Tangerine gleich aus,
 * und ausgerechnet der Unterschied zwischen „abgestimmt" und „zwei Angaben"
 * wäre verschwunden. Deshalb trägt jeder Grad ein eigenes Zeichen und seinen
 * Namen ausgeschrieben. Die Farbe kommt dazu, sie trägt nicht.
 */
function Grad({ wert }: { wert: string }) {
  const stil = {
    self_stated: { zeichen: '○', klasse: 'text-steel' },
    counterparty_stated: { zeichen: '◐', klasse: 'text-electric-blue' },
    mutual: { zeichen: '●', klasse: 'text-vivid-green' },
    disputed: { zeichen: '◑', klasse: 'text-tangerine' },
  }[wert] ?? { zeichen: '○', klasse: 'text-steel' };

  const label =
    CONFIRMATION_LABEL[wert as keyof typeof CONFIRMATION_LABEL] ?? wert;

  return (
    <span
      className={`inline-flex items-center gap-1 border border-current px-1.5 text-caption ${stil.klasse}`}
    >
      <span aria-hidden>{stil.zeichen}</span>
      {label}
    </span>
  );
}
