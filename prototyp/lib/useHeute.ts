'use client';

import { useState } from 'react';
import { heute as heuteJetzt, type IsoDatum } from './datum';

/**
 * Der heutige Tag, einmal je Aufbau festgehalten.
 *
 * Wichtig ist nicht die Aktualität auf die Minute, sondern dass innerhalb
 * eines Bildschirms überall derselbe Tag gilt — sonst steht die Heute-Marke in
 * der Zeitleiste an einer anderen Stelle als in der Kopfzeile.
 */
export function useHeute(): IsoDatum {
  const [tag] = useState(() => heuteJetzt());
  return tag;
}
