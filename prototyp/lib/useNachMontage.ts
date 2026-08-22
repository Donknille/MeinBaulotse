'use client';

import { useSyncExternalStore } from 'react';

/** Nie ein Abonnement: der Wert wechselt genau einmal, beim Übergang zum Browser. */
const ohneAbonnement = () => () => {};
const imBrowser = () => true;
const aufDemServer = () => false;

/**
 * Steht erst nach dem ersten Aufbau im Browser auf `true`.
 *
 * Die Projektdaten liegen im lokalen Speicher. Den gibt es auf dem Server
 * nicht, und zustand liest ihn schon beim Laden des Moduls — der erste Aufbau
 * im Browser hätte also andere Daten als der auf dem Server, und React würde
 * ihn verwerfen.
 *
 * Deshalb zeigen alle Bauteile, die Projektdaten anfassen, im ersten Durchgang
 * dasselbe wie der Server: nichts. Erst danach die Daten. `useSyncExternalStore`
 * mit getrenntem Server- und Browserwert ist dafür der vorgesehene Weg — ein
 * `useEffect`, der `setState` ruft, erzwingt einen zweiten Durchlauf mehr.
 */
export function useNachMontage(): boolean {
  return useSyncExternalStore(ohneAbonnement, imBrowser, aufDemServer);
}
