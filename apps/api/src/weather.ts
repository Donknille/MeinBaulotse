/**
 * Das Wetter zu einem Tagebucheintrag.
 *
 * Abschnitt 3.8: „Wetterdaten automatisch von der nächstgelegenen DWD-Station,
 * mit dem Eintrag eingefroren." Beides ist wichtig, und das zweite mehr als das
 * erste: Ein Wetterarchiv lässt sich jederzeit nachschlagen. Was sich nicht
 * nachschlagen lässt, ist, welches Wetter der Bauherr an dem Tag gesehen und
 * deshalb notiert hat. Deshalb wandert die Beobachtung in die Zeile und in den
 * Hash, statt bei Bedarf neu geholt zu werden.
 *
 * Die Quelle ist DWD Open Data, aber nicht direkt: Der DWD liefert seine
 * Tageswerte als ZIP-Archive mit einem Stationskatalog in fester Spaltenbreite
 * daneben. Beides in einer Vercel-Function auszupacken wäre machbar und wäre
 * die falsche Stelle dafür. `api.brightsky.dev` ist ein quelloffener,
 * kostenfreier Dienst, der genau diese Daten als JSON ausliefert und die
 * Stationswahl nach Koordinaten gleich mitmacht — dieselben amtlichen Zahlen,
 * ein handlicher Zugang.
 *
 * `WEATHER_API_URL` ist deshalb einstellbar und nicht fest verdrahtet: Wer die
 * Abfrage nicht aus der Hand geben will, stellt sich Brightsky selbst hin
 * (Docker-Abbild, dieselbe Schnittstelle) und trägt seine eigene Adresse ein.
 * Leer heißt: kein Wetter. Dann steht im Eintrag „Wetter nicht erfasst" — und
 * das ist ehrlicher als eine erfundene Zahl.
 */

import type { WeatherObservation } from '@meinbaulotse/shared';

const STANDARD_URL = 'https://api.brightsky.dev';

/**
 * Fünf Sekunden. Ein Tagebucheintrag darf nicht daran scheitern, dass ein
 * Wetterdienst hängt — das Foto ist die Hauptsache, das Wetter die Zugabe.
 */
const ZEITGRENZE_MS = 5_000;

export function weatherApiUrl(): string | null {
  const roh = process.env['WEATHER_API_URL'];
  if (roh === undefined) return STANDARD_URL;
  const gekuerzt = roh.trim().replace(/\/+$/, '');
  return gekuerzt === '' ? null : gekuerzt;
}

/**
 * Was Brightsky auf `/weather` antwortet — nur die Felder, die hier gebraucht
 * werden. Alles Weitere wird bewusst nicht durchgereicht: Luftdruck und
 * Sichtweite beantworten auf einer Baustelle keine Frage.
 */
interface BrightskyResponse {
  weather?: {
    timestamp?: string;
    temperature?: number | null;
    precipitation?: number | null;
    wind_gust_speed?: number | null;
    condition?: string | null;
  }[];
  sources?: {
    dwd_station_id?: string | null;
    wmo_station_id?: string | null;
    station_name?: string | null;
    distance?: number | null;
  }[];
}

/**
 * Ein winziger Zwischenspeicher je Prozess.
 *
 * Drei Fotos aus dem Funkloch landen als drei Anfragen für denselben Tag am
 * selben Ort. In einer Serverless-Umgebung lebt der Speicher nur so lange wie
 * die Instanz — das genügt genau für diesen Fall und bindet keinen Speicher
 * über die Anfrage hinaus.
 */
const zwischenspeicher = new Map<string, WeatherObservation | null>();

export interface WeatherLookup {
  lat: number;
  lon: number;
  date: string;
}

export async function fetchWeather(
  suche: WeatherLookup,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherObservation | null> {
  const basis = weatherApiUrl();
  if (basis === null) return null;

  const schluessel = `${suche.lat.toFixed(3)}|${suche.lon.toFixed(3)}|${suche.date}`;
  const bekannt = zwischenspeicher.get(schluessel);
  if (bekannt !== undefined) return bekannt;

  const adresse =
    `${basis}/weather?lat=${suche.lat}&lon=${suche.lon}` +
    `&date=${suche.date}&last_date=${suche.date}&tz=Europe/Berlin`;

  let beobachtung: WeatherObservation | null = null;
  try {
    const antwort = await fetchImpl(adresse, {
      signal: AbortSignal.timeout(ZEITGRENZE_MS),
      headers: { accept: 'application/json' },
    });
    if (antwort.ok) {
      beobachtung = summarise((await antwort.json()) as BrightskyResponse, suche.date);
    }
  } catch (error) {
    // Ein ausgefallener Wetterdienst ist kein Grund, einen Tagebucheintrag
    // scheitern zu lassen. Er wird vermerkt und der Eintrag entsteht ohne
    // Wetter — nachträglich ergänzen ließe es sich ohnehin nicht, denn nach
    // dem Versiegeln ist die Zeile unveränderlich.
    console.warn('Wetter nicht abrufbar:', error instanceof Error ? error.message : error);
  }

  zwischenspeicher.set(schluessel, beobachtung);
  return beobachtung;
}

/**
 * Vierundzwanzig Stundenwerte werden zu einem Tag.
 *
 * Die Zusammenfassung ist eine fachliche Entscheidung, keine Formsache:
 * Tiefst- und Höchsttemperatur, Niederschlagssumme, stärkste Böe. Das sind
 * genau die vier Zahlen, an denen auf einer Baustelle Arbeit ausfällt. Ein
 * Mittelwert der Temperatur verschweigt den Nachtfrost, und der ist der Grund,
 * warum am nächsten Tag nicht betoniert wurde.
 */
export function summarise(antwort: BrightskyResponse, date: string): WeatherObservation | null {
  const stunden = antwort.weather ?? [];
  if (stunden.length === 0) return null;

  const quelle = antwort.sources?.[0];
  const temperaturen = stunden
    .map((stunde) => stunde.temperature)
    .filter((wert): wert is number => typeof wert === 'number');
  const niederschlag = stunden
    .map((stunde) => stunde.precipitation)
    .filter((wert): wert is number => typeof wert === 'number');
  const boeen = stunden
    .map((stunde) => stunde.wind_gust_speed)
    .filter((wert): wert is number => typeof wert === 'number');

  return {
    date,
    stationId: quelle?.dwd_station_id ?? quelle?.wmo_station_id ?? null,
    stationName: quelle?.station_name ?? null,
    distanceMeters:
      typeof quelle?.distance === 'number' ? Math.round(quelle.distance) : null,
    temperatureMinC: temperaturen.length === 0 ? null : round1(Math.min(...temperaturen)),
    temperatureMaxC: temperaturen.length === 0 ? null : round1(Math.max(...temperaturen)),
    precipitationMm:
      niederschlag.length === 0
        ? null
        : round1(niederschlag.reduce((summe, wert) => summe + wert, 0)),
    windGustKmh: boeen.length === 0 ? null : round1(Math.max(...boeen)),
    condition: dominantCondition(stunden.map((stunde) => stunde.condition ?? null)),
    source: 'DWD Open Data über Brightsky',
  };
}

/**
 * Welche Wetterlage prägt den Tag?
 *
 * Nicht die häufigste, sondern die stärkste. Zwanzig trockene Stunden und vier
 * mit Gewitter sind kein trockener Tag — jedenfalls nicht für den, der auf dem
 * Dach stand.
 */
function dominantCondition(werte: readonly (string | null)[]): string | null {
  const rang = ['thunderstorm', 'hail', 'snow', 'sleet', 'rain', 'fog', 'dry'];
  for (const lage of rang) {
    if (werte.includes(lage)) return lage;
  }
  return null;
}

function round1(wert: number): number {
  return Math.round(wert * 10) / 10;
}

/** Nur für die Gegenproben: Der Zwischenspeicher überlebt sonst den Testlauf. */
export function clearWeatherCache(): void {
  zwischenspeicher.clear();
}
