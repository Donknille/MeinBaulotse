/**
 * Die Leitplanken aus 3.7, geprüft an der Frage.
 *
 * Diese Datei kennt weder Datenbank noch Netz noch Modell. Das ist der Punkt:
 * Was hier steht, hält auch dann, wenn das Modell einen schlechten Tag hat.
 */

import { describe, expect, it } from 'vitest';
import { hinweiseFuer, karten, leitplanken, rechtsthema } from './lotse-guardrails.js';

describe('Fragen mit rechtlichem Kern', () => {
  it('nennt zur Abschlagsfrage die Stelle, die dazu gehört', () => {
    const hinweise = hinweiseFuer('Der GU will 95 % als Abschlag. Muss ich das zahlen?');
    const recht = hinweise.find((hinweis) => hinweis.art === 'recht');

    expect(recht?.stelle).toBe('§ 650m Abs. 1 BGB');
    expect(recht?.text).toContain('90 %');
    // CI 11.3: Der Zusatz wird nie verkürzt und nie ausgeblendet.
    expect(recht?.titel).toBe('Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.');
    expect(recht?.text).toContain('Fachanwalt für Bau- und Architektenrecht');
  });

  it('erkennt den rechtlichen Kern auch ohne Fachwort', () => {
    // „Darf der das?" ist keine Bauberatung, auch wenn kein Paragraf drinsteht.
    expect(rechtsthema('Darf der einfach zwei Wochen später anfangen?')).not.toBeNull();
    expect(rechtsthema('Darf der einfach zwei Wochen später anfangen?')?.stelle).toBe(
      '§§ 631 ff. BGB',
    );
  });

  it('trifft die spezielle Stelle vor der allgemeinen', () => {
    expect(rechtsthema('Darf ich die Abnahme verweigern?')?.stelle).toBe('§ 640 BGB');
    expect(rechtsthema('Wie lange habe ich Gewährleistung?')?.stelle).toBe(
      '§ 634 BGB, § 634a Abs. 1 Nr. 2 BGB',
    );
  });

  it('lässt eine reine Bau-Frage in Ruhe', () => {
    // Der wichtigste Fall: Ein Hinweis unter jeder Antwort wird nach dem
    // dritten Mal überlesen und ist beim vierten Mal nicht mehr da.
    expect(leitplanken('Wie lange muss der Estrich trocknen?')).toEqual([]);
    expect(leitplanken('Was passiert beim Richtfest?')).toEqual([]);
  });
});

describe('Fragen nach einer Beurteilung', () => {
  it('verweist bei einem Symptom auf den Sachverständigen', () => {
    const hinweise = hinweiseFuer('Im Keller sind Risse in der Bodenplatte, siehe Foto.');
    const mangel = hinweise.find((hinweis) => hinweis.art === 'mangel');

    expect(mangel).toBeDefined();
    expect(mangel?.text).toContain('Bausachverständiger');
    // Jede schlechte Nachricht trägt einen nächsten Schritt (CI 11.4).
    expect(mangel?.text).toContain('Bautagebuch');
  });

  it('fasst beide Leitplanken an, wenn die Frage beide berührt', () => {
    const arten = leitplanken('Der Putz hat Risse. Muss der GU das auf seine Kosten nachbessern?');
    expect(arten).toContain('mangel');
    expect(arten).toContain('recht');
    expect(arten).toContain('kosten');
  });
});

describe('Fragen nach Geld', () => {
  it('sagt, dass Zahlen hier Größenordnungen sind', () => {
    const hinweise = hinweiseFuer('Was kostet eine Wärmepumpe ungefähr?');
    expect(hinweise.map((hinweis) => hinweis.art)).toContain('kosten');
    expect(hinweise.find((hinweis) => hinweis.art === 'kosten')?.text).toContain('Angebot');
  });
});

describe('Verweise auf Lotsenkarten', () => {
  it('zieht die Markierungen heraus und lässt den Text sauber zurück', () => {
    const { text, keys } = karten(
      'Der Estrich braucht Zeit. [[karte:estrich]] Danach wird gemessen.',
      ['estrich', 'innenputz'],
    );
    expect(keys).toEqual(['estrich']);
    expect(text).toBe('Der Estrich braucht Zeit. Danach wird gemessen.');
  });

  it('wirft einen erfundenen Verweis weg', () => {
    // Ein erfundener Verweis wäre schlimmer als keiner: Er sieht aus wie eine
    // Quelle, und genau darauf soll sich der Bauherr verlassen können.
    const { text, keys } = karten('Steht so in der Karte. [[karte:gibtesnicht]]', ['estrich']);
    expect(keys).toEqual([]);
    expect(text).toBe('Steht so in der Karte.');
  });

  it('nennt jede Karte nur einmal', () => {
    const { keys } = karten('[[karte:estrich]] und nochmal [[karte:estrich]]', ['estrich']);
    expect(keys).toEqual(['estrich']);
  });
});
