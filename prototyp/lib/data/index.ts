/*
 * Die einzige Tür zu den Projektdaten.
 *
 * Der Store ruft ausschließlich Funktionen aus dieser Schicht auf,
 * Komponenten ausschließlich Selektoren des Stores. Damit steht zwischen
 * Oberfläche und Datenhaltung genau eine Naht — und dort lässt sich später
 * Supabase einsetzen, ohne eine einzige Komponente anzufassen.
 */

export * from './lesen';
export * from './schreiben';
