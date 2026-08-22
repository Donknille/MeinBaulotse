import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Klassen zusammenführen, spätere Angaben schlagen frühere. */
export function cn(...eingaben: ClassValue[]) {
  return twMerge(clsx(eingaben));
}
