/**
 * Verträge zwischen Web und API, an einer Stelle gebündelt.
 *
 * `contracts.ts` trägt die Zod-Schemata, `roles.ts` die Wortwahl zu den
 * Rollen und Rechten. Die Rechtematrix selbst steht in keiner der beiden
 * Dateien — sie liegt als Daten in der Datenbank und kommt über
 * `GET /api/v1/roles` herein.
 */

export * from './contracts.js';
export * from './roles.js';
