/**
 * Ein Bauvorhaben löschen (Abschnitt 6.5).
 *
 * „Vollständiger Datenexport und Löschung als Selbstbedienung." Daneben steht
 * im selben Abschnitt: „Aufbewahrung bis 5 Jahre nach Abnahme wegen
 * Gewährleistung." Beides gilt, und deshalb ist das hier kein Knopf, der
 * sofort alles wegwirft, sondern ein Antrag mit Frist.
 *
 * Die Alternative wäre schlechter, nicht bequemer: Ein Produkt, das seine
 * Historie mit Triggern und Prüfsummen schützt und sie dann auf einen Klick
 * verliert, schützt sie nicht.
 */

import { useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { Button, Card, Field } from './ui';
import { formatDate } from '../lib/format';
import type { DeletionState } from '../lib/api';

export function DeleteProject({
  state,
  projectName,
  busy,
  onRequest,
  onCancel,
}: {
  state: DeletionState;
  projectName: string;
  busy: boolean;
  onRequest: (reason: string) => void;
  onCancel: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState('');
  const [bestaetigung, setBestaetigung] = useState('');

  if (state.requestedAt !== null) {
    return (
      <Card className="flex flex-col gap-3 border-l-2 border-l-tangerine">
        <p className="text-body-lg font-medium text-charcoal">
          Dieses Bauvorhaben wird gelöscht.
        </p>
        <p className="text-body text-steel">
          {state.purgeAfter === null
            ? 'Die Löschung ist beantragt.'
            : `Am ${formatDate(state.purgeAfter.slice(0, 10))} werden alle Daten entfernt — `
              + 'der Plan, das Bautagebuch mit allen Fotos, die Mängel und die Historie. '
              + 'Bis dahin kannst du es zurückholen.'}
        </p>
        <p className="text-caption text-steel">
          Lade dir vorher die Bauakte und den vollständigen Datenexport herunter. Danach gibt
          es sie nirgends mehr.
        </p>
        <Button variant="primary" className="w-fit" disabled={busy} onClick={onCancel}>
          <Undo2 size={16} aria-hidden />
          Doch behalten
        </Button>
      </Card>
    );
  }

  if (!offen) {
    return (
      <button
        type="button"
        className="w-fit text-caption text-steel underline underline-offset-4 hover:text-alarm-red"
        onClick={() => setOffen(true)}
      >
        Dieses Bauvorhaben löschen
      </button>
    );
  }

  return (
    <Card className="flex flex-col gap-4 border-l-2 border-l-alarm-red">
      <div className="flex flex-col gap-2">
        <p className="text-body-lg font-medium text-charcoal">
          Alles zu diesem Bauvorhaben löschen?
        </p>
        <p className="text-body text-steel">
          Nach {state.graceDays} Tagen werden der Plan, das Bautagebuch mit allen Fotos, die
          Mängel, die Zahlungen und die gesamte Historie entfernt. In diesen {state.graceDays}{' '}
          Tagen kannst du es zurückholen; danach nicht mehr.
        </p>
        {/* Keine Sperre, eine Auskunft: Es sind seine Daten. Er soll nur
            wissen, was er weggibt. */}
        {state.withinWarranty ? (
          <p className="text-body text-tangerine">
            Die Gewährleistung für dieses Bauwerk läuft noch. Bis fünf Jahre nach der Abnahme
            ist die Bauakte das Einzige, worauf du dich bei einem Mangel berufen kannst.
          </p>
        ) : null}
        <p className="text-caption text-steel">
          Lade dir vorher die Bauakte und den vollständigen Datenexport herunter.
        </p>
      </div>

      <Field label="Warum? (freiwillig)">
        <input
          value={grund}
          onChange={(event) => setGrund(event.target.value)}
          className="h-11 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
        />
      </Field>

      {/* Den Namen abtippen. Ein „Wirklich?"-Dialog wird weggeklickt, ein Name
          nicht — und wer ihn tippt, hat gelesen, worum es geht. */}
      <Field
        label={`Tipp zur Bestätigung „${projectName}"`}
        hint="Damit das nicht aus Versehen passiert."
      >
        <input
          value={bestaetigung}
          onChange={(event) => setBestaetigung(event.target.value)}
          className="h-11 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={busy || bestaetigung.trim() !== projectName}
          onClick={() => onRequest(grund.trim())}
        >
          <Trash2 size={16} aria-hidden />
          Löschen beantragen
        </Button>
        <Button variant="ghost" onClick={() => setOffen(false)}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}
