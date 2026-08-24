/**
 * Der Wetterabruf, ohne Netz.
 *
 * Ein Test, der einen fremden Rechner anruft, ist kein Test, sondern eine
 * Wette auf dessen Verfügbarkeit. Geprüft wird deshalb das, was hier
 * tatsächlich entschieden wird: wie aus vierundzwanzig Stundenwerten ein Tag
 * wird, und was passiert, wenn der Dienst schweigt.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { weatherInPlainWords, weatherStoppedWork } from '@meinbaulotse/shared';
import { clearWeatherCache, fetchWeather, summarise, weatherApiUrl } from './weather.js';

afterEach(() => {
  clearWeatherCache();
  delete process.env['WEATHER_API_URL'];
});

/** Eine Antwort in der Form, die Brightsky auf `/weather` liefert. */
function antwort(stunden: { t?: number; n?: number; b?: number; lage?: string }[]): unknown {
  return {
    weather: stunden.map((stunde, index) => ({
      timestamp: `2026-05-04T${String(index).padStart(2, '0')}:00:00+02:00`,
      temperature: stunde.t ?? null,
      precipitation: stunde.n ?? null,
      wind_gust_speed: stunde.b ?? null,
      condition: stunde.lage ?? null,
    })),
    sources: [
      {
        dwd_station_id: '01262',
        station_name: 'München-Stadt',
        distance: 4180,
      },
    ],
  };
}

describe('Aus Stundenwerten wird ein Tag', () => {
  it('nimmt Tiefst- und Höchstwert, nicht den Mittelwert', () => {
    // Der Nachtfrost ist der Grund, warum am nächsten Tag nicht betoniert
    // wurde. Ein Tagesmittel von 6 Grad verschwiege ihn.
    const tag = summarise(
      antwort([{ t: -3 }, { t: 2 }, { t: 9 }, { t: 15 }]) as never,
      '2026-05-04',
    );
    expect(tag?.temperatureMinC).toBe(-3);
    expect(tag?.temperatureMaxC).toBe(15);
  });

  it('summiert den Niederschlag und nimmt die stärkste Böe', () => {
    const tag = summarise(
      antwort([
        { n: 0.4, b: 22 },
        { n: 3.1, b: 61 },
        { n: 0, b: 30 },
      ]) as never,
      '2026-05-04',
    );
    expect(tag?.precipitationMm).toBe(3.5);
    expect(tag?.windGustKmh).toBe(61);
  });

  it('nennt die stärkste Wetterlage, nicht die häufigste', () => {
    // Zwanzig trockene Stunden und vier mit Gewitter sind kein trockener Tag —
    // jedenfalls nicht für den, der auf dem Dach stand.
    const tag = summarise(
      antwort([
        { lage: 'dry' },
        { lage: 'dry' },
        { lage: 'dry' },
        { lage: 'thunderstorm' },
      ]) as never,
      '2026-05-04',
    );
    expect(tag?.condition).toBe('thunderstorm');
  });

  it('trägt Station und Entfernung mit, damit die Angabe nachprüfbar bleibt', () => {
    const tag = summarise(antwort([{ t: 12 }]) as never, '2026-05-04');
    expect(tag?.stationId).toBe('01262');
    expect(tag?.stationName).toBe('München-Stadt');
    expect(tag?.distanceMeters).toBe(4180);
    expect(tag?.source).toContain('DWD');
  });

  it('liefert nichts, wenn die Station für den Tag nichts hat', () => {
    expect(summarise({ weather: [] }, '2026-05-04')).toBeNull();
  });
});

describe('Der Abruf', () => {
  it('bleibt aus, wenn keine Adresse eingestellt ist', async () => {
    process.env['WEATHER_API_URL'] = '';
    expect(weatherApiUrl()).toBeNull();

    let gerufen = false;
    const wetter = await fetchWeather({ lat: 48.14, lon: 11.58, date: '2026-05-04' }, () => {
      gerufen = true;
      return Promise.reject(new Error('darf nicht passieren'));
    });
    expect(wetter).toBeNull();
    expect(gerufen).toBe(false);
  });

  it('lässt einen Tagebucheintrag nicht an einem schweigenden Dienst scheitern', async () => {
    process.env['WEATHER_API_URL'] = 'https://wetter.example';
    const wetter = await fetchWeather({ lat: 48.14, lon: 11.58, date: '2026-05-04' }, () =>
      Promise.reject(new Error('Zeitüberschreitung')),
    );
    // Kein geworfener Fehler: Das Foto ist die Hauptsache, das Wetter die
    // Zugabe. Ein Eintrag ohne Wetter ist besser als kein Eintrag.
    expect(wetter).toBeNull();
  });

  it('fragt für dieselbe Stelle am selben Tag nur einmal', async () => {
    process.env['WEATHER_API_URL'] = 'https://wetter.example';
    let aufrufe = 0;
    const dienst = (): Promise<Response> => {
      aufrufe += 1;
      return Promise.resolve(new Response(JSON.stringify(antwort([{ t: 14, lage: 'dry' }]))));
    };

    // Drei Fotos aus dem Funkloch, ein Tag, ein Ort.
    await fetchWeather({ lat: 48.14, lon: 11.58, date: '2026-05-04' }, dienst as typeof fetch);
    await fetchWeather({ lat: 48.14, lon: 11.58, date: '2026-05-04' }, dienst as typeof fetch);
    await fetchWeather({ lat: 48.14, lon: 11.58, date: '2026-05-04' }, dienst as typeof fetch);
    expect(aufrufe).toBe(1);
  });

  it('gibt zurück, was der Dienst geliefert hat', async () => {
    process.env['WEATHER_API_URL'] = 'https://wetter.example';
    const wetter = await fetchWeather(
      { lat: 48.14, lon: 11.58, date: '2026-05-04' },
      (() =>
        Promise.resolve(
          new Response(JSON.stringify(antwort([{ t: 3, n: 24 }, { t: 8, n: 1.2 }]))),
        )) as typeof fetch,
    );
    expect(wetter?.temperatureMinC).toBe(3);
    expect(wetter?.precipitationMm).toBe(25.2);
  });
});

describe('Was der Bauherr davon liest', () => {
  it('nennt nur die Angaben, an denen Arbeit ausfällt', () => {
    const tag = summarise(
      antwort([
        { t: -1, n: 2.5, b: 65, lage: 'snow' },
        { t: 4, n: 0, b: 20 },
      ]) as never,
      '2026-05-04',
    );
    const satz = weatherInPlainWords(tag);
    expect(satz).toContain('-1 bis 4 °C');
    expect(satz).toContain('2,5 mm Niederschlag');
    expect(satz).toContain('Böen bis 65 km/h');
    expect(satz).toContain('Schnee');
    // Luftdruck und Sichtweite stehen nicht drin. Sie beantworten auf einer
    // Baustelle keine Frage.
    expect(satz).not.toContain('hPa');
  });

  it('sagt offen, wenn nichts erfasst wurde', () => {
    expect(weatherInPlainWords(null)).toBe('Wetter nicht erfasst.');
  });

  it('erklärt den Verzugsgrund, wenn das Wetter einer ist', () => {
    const frost = summarise(antwort([{ t: -8 }, { t: -2 }]) as never, '2026-01-20');
    expect(weatherStoppedWork(frost)).toContain('Beton- und Mauerarbeiten');

    const sturm = summarise(antwort([{ t: 9, b: 78 }]) as never, '2026-01-20');
    expect(weatherStoppedWork(sturm)).toContain('Kranbetrieb');

    const normal = summarise(antwort([{ t: 14, n: 0.2, b: 18 }]) as never, '2026-05-04');
    expect(weatherStoppedWork(normal)).toBeNull();
  });
});
