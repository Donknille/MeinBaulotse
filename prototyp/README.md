# MeinBaulotse — klickbarer Prototyp

Ein eigenständiges Next.js-Projekt für den Konzepttest an echten Nutzern.
Ohne Anmeldung, ohne Datenbank, ohne Backend: die Startseite lässt eine von
drei Betriebsarten wählen, danach arbeitet alles auf vorbefüllten Demo-Daten im
lokalen Speicher des Geräts.

Das Projekt liegt bewusst **außerhalb** des pnpm-Workspace der Produktivfassung
(`apps/`, `packages/`). Es hat eigene Abhängigkeiten, eine eigene Lockfile und
eine eigene Lint-Einrichtung und berührt Build, CI und Auslieferung des
Hauptprojekts nicht.

## Befehle

```bash
pnpm install
pnpm dev        # Entwicklungsserver auf http://localhost:3000
pnpm test       # Kettenrechnung und Demo-Daten
pnpm typecheck
pnpm lint
pnpm build
```

## Aufbau

| Pfad | Inhalt |
|---|---|
| `app/tokens.css` | Einzige Stelle für Farbe, Radius, Abstand und Schrift |
| `lib/types.ts` | Datenmodell |
| `lib/datum.ts` | Arbeitstage, Kalendertage, deutsche Schreibweisen |
| `lib/planung.ts` | Kettenrechnung: was eine Verschiebung nach sich zieht |
| `lib/rechte.ts` | Rechtematrix als Datenstruktur |
| `lib/stammdaten.ts` | Bauablauf eines Einfamilienhauses, 23 Gewerke |
| `lib/seed.ts` | Demoprojekt, aus dem heutigen Tag gerechnet |
| `lib/data/` | Lese- und Schreibfunktionen — die einzige Naht zur Datenhaltung |
| `lib/store.ts` | Zustand-Store mit lokaler Ablage, ein Projekt je Betriebsart |

Komponenten greifen nie unmittelbar auf den Store zu, sondern über die
Selektoren aus `lib/store.ts`; der Store wiederum kennt nur `lib/data/`. Wer
später Supabase einsetzt, tauscht `lib/data/` aus und fasst keine Komponente an.

## Was der Prototyp bewusst nicht tut

Keine Anmeldung, keine Serverdaten, keine Netzaufrufe. Alles, was eingetragen
wird, bleibt im Browser des Geräts und ist mit „Demo zurücksetzen" wieder weg.
