/**
 * Ein Foto aus der Bauakte.
 *
 * Die Adresse zum Ansehen ist signiert und läuft nach einer Stunde ab
 * (Abschnitt 6.4). Deshalb wird sie beim Anzeigen geholt und nicht
 * mitgeliefert — eine dauerhafte öffentliche Adresse wäre ein
 * Baustellenfoto im offenen Netz, für immer.
 *
 * Weicht die Aufnahmezeit vom angegebenen Tag ab, steht das darunter. Nicht
 * als Vorwurf, sondern als Angabe: Kameras haben oft die falsche Uhrzeit, und
 * wer das später erklären muss, ist froh, dass es dokumentiert ist.
 */

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { MediaItemDto } from '@meinbaulotse/shared';
import { viewUrl } from '../lib/media';
import { formatDate } from '../lib/format';

export function Photo({ item }: { item: MediaItemDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fehlt, setFehlt] = useState(false);

  useEffect(() => {
    let aktuell = true;
    void viewUrl(item.storagePath).then((adresse) => {
      if (!aktuell) return;
      if (adresse === null) setFehlt(true);
      else setUrl(adresse);
    });
    return () => {
      aktuell = false;
    };
  }, [item.storagePath]);

  const abweichung =
    item.exifTakenAt !== null &&
    item.statedDate !== null &&
    item.exifTakenAt.slice(0, 10) !== item.statedDate;

  return (
    <figure className="flex flex-col gap-1">
      <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border border-ash bg-paper-mist">
        {url !== null ? (
          <img
            src={url}
            alt={item.caption ?? 'Foto von der Baustelle'}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-steel">
            <ImageOff size={20} aria-hidden />
          </div>
        )}
      </div>
      <figcaption className="text-caption text-steel">
        {item.caption ?? (fehlt ? 'Bild nicht abrufbar' : '')}
        {item.exifTakenAt !== null ? (
          <span className="block">
            Aufgenommen {new Date(item.exifTakenAt).toLocaleString('de-DE')}
          </span>
        ) : null}
        {abweichung ? (
          <span className="block text-tangerine">
            Eingetragen für den {formatDate(item.statedDate)}.
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
