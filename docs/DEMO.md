# Testzugang

Zum Ausprobieren und Vorführen: zwei feste Anmeldungen auf dasselbe
Bauvorhaben, eine als **Bauherr**, eine als **Generalunternehmer**. Ohne
Mailversand, ohne Registrierung, mit einem Link.

Der Zugang ist ausdrücklich eine Behelfstür. Er existiert, weil die richtige
Anmeldung per Magic Link erst funktioniert, wenn in Supabase ein eigener
SMTP-Server hinterlegt ist — bis dahin stellt Supabase Mails **nur an
Mitglieder der eigenen Organisation** zu und weist jede andere Adresse ab.
Steht der Mailversand, kann dieser Zugang ersatzlos verschwinden.

---

## Lokal einrichten

```bash
cp .env.example .env                      # falls noch nicht geschehen
# in der .env einen Schlüssel setzen, mindestens 16 Zeichen:
#   DEMO_LOGIN_KEY=ein-langer-eigener-schluessel

pnpm install
pnpm -r --filter './packages/*' build
docker compose up -d db
pnpm db:reset                             # Schema, Migrationen, Stammdaten
pnpm demo:seed                            # zwei Nutzer, ein Projekt, beide Rollen
pnpm dev
```

`pnpm demo:seed` schreibt am Ende den fertigen Anmeldelink in die Konsole:

```
Anmelden unter:  http://localhost:5173/demo?key=…
```

Link öffnen, auf einen der beiden Knöpfe klicken, drin. Der Schlüssel steht im
Link, es gibt kein Eingabefeld. Wer den Link nicht hat, kommt nicht hinein.

`pnpm demo:seed` legt **ein** Bauvorhaben an. Wer lokal beide sehen will, nimmt
denselben Weg wie im Betrieb und spielt das erzeugte Skript ein:

```bash
pnpm demo:sql
psql "$DATABASE_URL" -f docs/demo-seed.sql
```

## Wer ist wer

| Rolle im Link | Person | Rolle im Projekt | Darf laut Rechtematrix |
|---|---|---|---|
| Bauherr | Familie Sonnenweg | `owner` | alles: einladen, Geld freigeben, Vertrag pflegen |
| Generalunternehmer | Jörg Baumeister | `contractor` | Vorgänge und Termine — **nicht** einladen, **nicht** freigeben |
| *(kein Link)* | Kraft Fliesen | `trade` | nur den eigenen Vorgang, und den nur über einen Abstimmungslink |

Die dritte Zeile hat mit Absicht keine Anmeldung: Ein Einzelgewerk hat in
diesem Produkt kein Konto und soll auch keines brauchen. Wie es trotzdem
hineinkommt, steht unter *Termine abstimmen*.

Angelegt hat beide Projekte der **Bauherr**, nicht der GU. Das ist keine
Bequemlichkeit, sondern Abschnitt 2.1 der Spezifikation: Das Projekt gehört dem
Bauherrn, und nur `owner` und `co_owner` dürfen Mitglieder einladen. Der GU
kommt über eine Einladung hinein.

## Die beiden Bauvorhaben

In der Liste stehen zwei, und der Unterschied ist Absicht. An einem einzigen
Projekt bleiben ganze Teile der Oberfläche unsichtbar.

| | *Musterhaus Sonnenweg* | *Stadthaus Ahornweg* |
|---|---|---|
| Bundesland | Bayern | Niedersachsen |
| Keller | mit, 38 Vorgänge | ohne, 34 Vorgänge |
| Vertragsart | Verbraucherbauvertrag | Einzelgewerke |
| Baubeginn | in vier Wochen | vor acht Wochen |
| Abweichung | rund zwei Wochen **später** | zwanzig Werktage **früher** |
| Bestätigungsgrade | alle grau | alle vier Sorten |

Was das zweite Projekt zeigt und das erste nicht kann:

- **Die Phasenleiste steht mittendrin.** Sie richtet sich nach dem heutigen
  Datum. Ein Bau, der vor acht Wochen begann, steht in Phase vier von neun,
  nicht am Anfang.
- **Die gute Nachricht.** Die Abweichung steht in Grün statt in Tangerine —
  „20 Werktage früher". Am ersten Projekt gibt es nur den anderen Fall.
- **Alle vier Bestätigungsgrade nebeneinander:** grau „Von dir eingetragen",
  blau „Vom GU genannt", grün „Abgestimmt", Tangerine „Zwei Angaben".
- **Ist-Termine und Status.** Was heute vorbei ist, steht als `fertig` in der
  Datenbank, das Laufende als `laeuft`. Die Planansicht zeigt beides noch
  nicht — die Daten stimmen aber schon.

## Rolle wechseln

Oben rechts steht im Testzugang, aus wessen Sicht du gerade schaust
(„Generalunternehmer · Rolle wechseln"). Der Link führt zurück auf `/demo`,
und dort genügt wieder ein Klick: Der Schlüssel aus dem Link ist gemerkt.
*Abmelden* wirft beide Anmeldungen weg, die echte wie die Test-Anmeldung, und
vergisst den Schlüssel.

Das Testtoken gilt zwölf Stunden. Läuft es ab — über Nacht also zwangsläufig —,
landest du wieder auf der Anmeldemaske. Der Schlüssel bleibt dabei gemerkt: Auf
`/demo` stehen die beiden Knöpfe, ein Klick genügt, den Link brauchst du nicht
noch einmal. Nur *Abmelden* vergisst ihn, und zwar mit Absicht.

## Was du sehen wirst

Der Plan trägt neben dem Projektnamen deine Rolle, und darunter steht, was du
in diesem Bauvorhaben tun kannst. Diese Liste ist nicht im Code notiert: Sie
kommt aus `role_permission`, also aus derselben Tabelle, die `mbl.has_perm()`
für die RLS befragt. Was die Karte verspricht, lässt die Datenbank auch zu.

Als **Bauherr** stehen dort dreizehn Zeilen und der Satz „Du hast in diesem
Bauvorhaben alle Rechte". Als **Generalunternehmer** sind es sechs, und die
Fehlanzeige nennt die Grenze beim Namen: Mängel erfassen, Entscheidungen
pflegen, Mitglieder einladen, Zahlungen freigeben — „Das entscheidet der
Bauherr."

## Termine ändern

Ein Klick auf einen Vorgang öffnet ein Blatt mit zwei Abschnitten, und die
Trennung ist der ganze Punkt:

- **Verschieben** ist eine Absicht: „nicht vor dem 02.11." Die Folgevorgänge
  ziehen nach, der Endtermin rechnet sich neu, und ohne Grund geht es nicht.
- **Was wirklich passiert ist** sind Tatsachen: Stand, Ist-Beginn, Ist-Ende.
  Sie überschreiben die Rechnung, statt sie zu beschränken. Ein Vorgang, der
  schon begonnen hat, lässt sich deshalb nicht mehr verschieben — das Blatt
  sagt es.

Zum Ausprobieren: *Estrich* im Bauvorhaben Ahornweg vier Wochen nach hinten
schieben. Danach steht oben statt „20 Werktage früher" in Grün ein „1 Werktag
später" in Tangerine, und alles ab dem Estrich liegt später — bis in den Januar.

**Was zieht das nach?** rechnet die Folgen vor, bevor etwas passiert — und
verlangt dafür keinen Grund: Wer erst begründen muss, um die Folgen zu sehen,
begründet, bevor er sie kennt.

Neben jedem mitgezogenen Vorgang steht *wartet nicht auf …*. Das ist die
Einzelentkopplung aus Abschnitt 3.5, Punkt 6. In der Vorlage steht die Kante,
weil sie meistens stimmt; manchmal stimmt sie nicht — der Maler im Erdgeschoss
wartet nicht auf den Estrich im Obergeschoss. Ein Klick, ein Satz zur
Begründung, und der Vorgang bleibt, wo er ist.

Die Abhängigkeit wird dabei **nicht gelöscht**, sondern gelöst: Sie bleibt mit
Grund und Datum stehen und rechnet nur nicht mehr mit. Wenn in vier Wochen
jemand fragt, warum der Maler vor dem Estrich dran war, steht die Antwort in
der Zeile. Rückgängig machen geht jederzeit.

Jede Verschiebung landet mit ihrem Grund in `schedule_change`. Diese Historie
ist append-only; nachträglich ändern lässt sich dort nichts.

Wer verschieben darf, entscheidet die Datenbank über `task.schedule`. Bauherr
und GU dürfen es beide; wer es nicht darf, sieht statt der Felder einen Satz,
der sagt warum.

## Die Lotsenkarten

Zu sechzehn der Vorgänge gibt es eine Karte: was dort passiert, worauf du
selbst achten kannst, welche Fragen an den GU sinnvoll sind, was typischerweise
schiefgeht und was jetzt fotografiert werden sollte.

Sie meldet sich von selbst, sieben Tage vor Beginn des Vorgangs — im Cockpit
unter **Lies dich ein**. Wer sie gelesen hat, sieht die Aufforderung nicht mehr;
über **Was passiert?** ist die Karte trotzdem jederzeit erreichbar.

Am *Stadthaus Ahornweg* ist das gleich zu sehen: Der Bau steht mitten in der
Gebäudehülle, und Dacheindeckung wie Fenstereinbau haben beide eine Karte. Am
*Musterhaus Sonnenweg* steht der Abschnitt nicht — dort beginnt der Bau erst in
vier Wochen, und nichts rückt in den Blick. Das ist kein Fehler, sondern die
Regel aus Abschnitt 3.1 der Spezifikation.

Zum Ausprobieren: eine Karte öffnen, einen Punkt unter *Worauf du achten
kannst* abhaken, eine Frage über den Knopf kopieren, am Fuß **War das
hilfreich?** beantworten. Der Haken gehört dem Bauvorhaben und bleibt; die
Rückmeldung gehört dir und steht beim nächsten Öffnen wieder da.

Fünf Karten empfehlen eine Fachprüfung — Bodenplatte, Kellerabdichtung,
Rohinstallation, Blower-Door und Abnahme. Dort steht auch, was eine
Baubegleitung ungefähr kostet. Das ist Absicht: Die Grenze des Produkts wird
offen benannt, statt sie zu verschweigen.

## Die Entscheidungen

Vierzehn Entscheidungen hängen an je einem Vorgang und einer Vorlaufzeit. Die
Frist ist **kein eigener Termin**, sondern eine abgeleitete Größe: Sie liegt so
viele Werktage vor dem Beginn des Vorgangs, wie die Vorlage vorgibt. Verschiebt
sich der Vorgang, verschiebt sich die Frist mit.

Im Cockpit steht das unter **Du musst entscheiden**, die dringendste zuerst.
Ein Klick öffnet die Entscheidungshilfe: worum es geht, was die Optionen
unterscheidet, was man später bereut. Dort setzt du auch den Stand und
schreibst auf, was ihr euch überlegt habt.

Am *Stadthaus Ahornweg* ist der Bau seit acht Wochen im Gang: Was vor heute
fällig war, steht auf *entschieden*, drei Fristen stehen noch aus. Am
*Musterhaus Sonnenweg* sind alle vierzehn offen — der Bau beginnt erst.

Zum Ausprobieren: *Fliesen: Auswahl und Verlegemuster* öffnen, dann den
Fliesenvorgang im Ablauf um vier Wochen verschieben. Die Frist wandert um
dieselbe Strecke mit, ohne dass jemand sie anfasst.

## Der Wochenbericht

Über dem Cockpit steht **Die Woche im Überblick**. Das ist derselbe Bericht,
den die Montagsmail verschickt: was diese Woche auf der Baustelle passiert
(mit der Kurzfassung der Lotsenkarte), was du entscheiden musst, was sich
verschoben hat, die Prognose und die Fotos, die jetzt fällig sind.

Im Terminal zeigt `pnpm report:weekly`, wie die Mail aussähe — ohne etwas zu
verschicken. Einzelheiten in `docs/BETRIEB.md`.

## Das Bautagebuch

Unter dem Projektnamen steht **Bautagebuch**. Dort hältst du fest, was auf der
Baustelle passiert ist — mit Foto, Datum und Verfasser.

Drei Dinge laufen darunter mit, ohne dass man sie bedienen müsste:

- **Nach 24 Stunden wird versiegelt.** Wer am Abend etwas nachträgt,
  korrigiert sich; wer nach drei Wochen etwas ändert, schriebe Geschichte um.
  Die Grenze zieht die Datenbank, nicht die Oberfläche.
- **Die Einträge sind verkettet.** Jeder versiegelte Eintrag trägt die
  Prüfsumme des vorherigen. Wird einer nachträglich verändert, meldet die
  Ansicht genau ihn.
- **Erfasst wird zuerst im Gerät.** Ohne Netz — Keller, Rohbau, Funkloch —
  bleibt die Erfassung liegen und geht von selbst hinaus, sobald wieder
  Verbindung da ist. Der Zeitpunkt kommt aus dem Foto, nicht aus dem Upload.

Fotos brauchen die Ablage des Supabase-Projekts (siehe `docs/SETUP.md`).
Lokal ohne Supabase sagt die Erfassung das offen und nimmt Notizen entgegen.

**Gesichter verpixeln.** Beim ersten Foto auf einem Gerät steht einmalig der
Hinweis, dass auf Baustellenfotos oft Menschen zu sehen sind. Zu jedem Foto
gibt es *Gesichter verpixeln*: ein Rechteck über jedes Gesicht ziehen, fertig.
Das passiert im Browser — hochgeladen wird das bearbeitete Bild, das Original
verlässt das Gerät nie.

Das muss vorher passieren, und zwar zwingend: Ein Foto in der Bauakte ist
nicht löschbar. Ein Werkzeug, das nachträglich verpixelt, käme immer zu spät.

Beides lässt sich auch ohne Ablage ansehen — im [Styleguide](/styleguide)
unter *Fotos und Datenschutz*.

## Jemanden dazunehmen

Im Plan unter **Wer mitmacht** steht *Jemanden dazunehmen*. Die Rolle wird
zuerst gewählt, weil sie alles Weitere bestimmt:

- **Zweiter Bauherr, Generalunternehmer, Baubegleiter, Mitleser** brauchen ein
  Konto. Sie werden mit ihrer E-Mail-Adresse eingetragen und stehen dann als
  *Eingeladen*. Sobald sich jemand mit genau dieser Adresse anmeldet, steht
  das Bauvorhaben in seiner Liste — mit **seiner** Rolle.
- **Ein Gewerk** braucht kein Konto und soll auch keins brauchen (Leitsatz
  1.6.2). Statt einer Adresse wird das Gewerk gewählt, und statt einer
  Einladung gibt es einen Abstimmungslink.

Zum Ausprobieren: einen Baubegleiter mit Adresse eintragen und einen
Elektriker ohne. Beim Elektriker verschwindet das Adressfeld, dafür kommt die
Gewerkeauswahl — und ohne Gewerk bleibt der Knopf grau. Ein „Gewerk" ohne
Gewerk schneidet nichts zu, und die Zeilenschärfe hängt genau daran.

*Aus dem Bauvorhaben nehmen* sperrt die Mitgliedschaft und alle Links dieser
Person. Gelöscht wird nichts: Was jemand eingetragen oder bestätigt hat,
bleibt in der Historie stehen — es ist ja passiert. Sich selbst kann der
Bauherr nicht hinausnehmen; sonst käme niemand mehr an das Bauvorhaben heran.

## Termine abstimmen

Im Plan steht unter dem Ablauf der Abschnitt **Beteiligte**. Neben jedem
Mitglied ohne Konto — im Demostand *Kraft Fliesen* — steht *Abstimmungslink*.
Ein Klick erzeugt ihn, und er steht genau einmal da: Danach liegt in der
Datenbank nur noch sein Hash.

Der Link führt auf eine Seite ohne Kopf, ohne Navigation und ohne Anmeldung:

```
Baustelle Stadthaus Ahornweg

Eingetragen ist  12.–21.05.2027
Passt das?

[ Passt ]   [ Anderer Termin ]
```

Am besten in einem privaten Fenster öffnen — dann ist zu sehen, dass die Seite
wirklich ohne jede Anmeldung auskommt.

- **Passt** hebt den Bestätigungsgrad auf *Abgestimmt* (grün). Im Plan des
  Bauherrn steht das sofort.
- **Anderer Termin** verschiebt **nichts**. Es erzeugt *Zwei Angaben*
  (Tangerine) und einen Eintrag in der Historie mit Kanal `guest_link`. Der
  Plan gehört dem Bauherrn; wer widerspricht, wird gehört, nicht ausgeführt.

Die Seite spricht fünf Sprachen — Deutsch, Englisch, Polnisch, Rumänisch,
Türkisch. Welche, entscheidet der Bauherr beim Anlegen des Links, nicht der
Browser des Empfängers.

Ein Einzelgewerk sieht dabei nur seinen eigenen Vorgang. Das ist keine
Höflichkeit der Oberfläche, sondern dieselbe RLS, die auch die App bindet: Für
die Datenbank ist ein Gast ein Mitglied wie jedes andere, nur eines, das sich
mit einem Token ausweist statt mit einem Konto.

Links laufen nach 180 Tagen ab und lassen sich jederzeit sperren. Wer einen
Link zu oft in der Minute aufruft, wird für eine Minute gebremst — der Link
bleibt gültig.

## Frag den Lotsen

Im Plan steht neben *Bautagebuch* der Verweis **Frag den Lotsen**. Dahinter
liegt ein Chat, der dein Bauvorhaben kennt: den Plan, die offenen
Entscheidungen, die Verschiebungen der letzten Wochen, das Bautagebuch und die
Lotsenkarten zu den Vorgängen, die gerade im Blick sind.

Lokal ist er nur da, wenn in der `.env` ein `ANTHROPIC_API_KEY` steht. Fehlt
er, sagt die Seite das offen und verweist auf die Karten — genauso wie im
Betrieb.

Drei Fragen zeigen, worum es hier eigentlich geht:

| Frage | Was zusätzlich erscheint |
|---|---|
| „Wie lange muss der Estrich trocknen?" | nichts — eine Bau-Frage bleibt eine Bau-Frage |
| „Der GU verlangt 95 % als Abschlag. Muss ich das zahlen?" | *Hinweis auf eine Gesetzesstelle, keine Rechtsberatung* mit § 650m Abs. 1 BGB und dem Verweis auf einen Fachanwalt |
| „Im Keller sind Risse. Ist das schlimm?" | der Hinweis auf einen Bausachverständigen, mit Kostenrahmen und drei Schritten für bis dahin |

Die Hinweise stehen abgesetzt und stammen **nicht** vom Modell. Sie hängen an
der Frage, nicht an der Antwort: Ein Systemprompt ist eine Bitte, und eine
Bitte ist keine Leitplanke. Deshalb stehen sie auch dann da, wenn das Modell
sich nicht daran hält.

Sie bleiben stehen. Wer das Gespräch morgen wieder öffnet, sieht denselben
Hinweis unter derselben Antwort — der Zusatz wird nach CI 11.3 nie verkürzt
und nie ausgeblendet, und „nur bis zum Neuladen" wäre ausgeblendet.

Der Lotse kennt nur **ein** Bauvorhaben: das, aus dem heraus du fragst. Wer im
Demostand beide angelegt hat, kann das prüfen — im Gespräch am *Stadthaus
Ahornweg* kommt das *Musterhaus Sonnenweg* nicht vor, obwohl derselbe Bauherr
beide besitzt.

## Mängel

Im Plan steht der Verweis **Mängel**. Am *Stadthaus Ahornweg* liegen drei
davon, und sie zeigen die drei Zustände, auf die es ankommt:

| Mangel | Stufe | Was oben steht |
|---|---|---|
| Feuchter Fleck an der Kellerwand (*wesentlich*) | Frist läuft | „Warte die Frist ab. Was in der Zeit passiert, gehört ins Bautagebuch." |
| Fensterbank sitzt schief | Frist abgelaufen | „Jetzt hast du die Wahl" — mit §§ 637, 638, 641 Abs. 3 BGB und dem Hinweis, dass sich hier ein Fachanwalt rechnet |
| Kratzer in der Haustür | erledigt | steht unter *Erledigt* |

Der nächste Schritt steht immer da, ohne Aufklappen. Er ist der eigentliche
Inhalt: Ein Bauherr weiß nicht, dass aus einem Mangel erst dann ein Recht
wird, wenn er ihn schriftlich angezeigt und eine **Frist** gesetzt hat. Ohne
Frist ändert auch zwei Jahre Ärger nichts.

Was die Seite nicht sagt: ob es ein Mangel *ist*. Das entscheidet ein
Sachverständiger — und wo es darauf ankommt, steht das auch da.

Zum Ausprobieren: einen Mangel aufklappen, eine Frist eintragen, den Verlauf
ansehen. Jeder Schritt steht darin, und keiner lässt sich nachträglich
ändern — auch nicht mit den Rechten des Eigentümers.

## Geld und Vertragsspiegel

Der Verweis **Geld** führt auf den Zahlungsplan. Die beiden Bauvorhaben zeigen
die zwei Seiten der Sache:

**Am *Stadthaus Ahornweg*** ist der Vertrag in Ordnung — 90 %, Sicherheit
vereinbart, Termin erfasst. Dafür ist eine Zahlung gesperrt, und darunter
steht, warum:

```
Nach Gebäude dicht                          114.000 € · 30 %

  Dafür fehlt noch:
    Gebäude dicht
    Mangel: Feuchter Fleck an der Innenseite der Kellerwand

  [ Teil unter Vorbehalt freigeben ]
```

Nicht „gesperrt", sondern was fehlt. Und daneben der Weg, den Abschnitt 3.10
ausdrücklich verlangt: Teilfreigabe mit Einbehalt. Der Einbehalt braucht einen
Grund — ein Einbehalt ohne Grund ist im Streit wertlos.

Die Sperre sitzt in der Datenbank, nicht in der Ansicht. Das lässt sich prüfen:

```sql
update payment_milestone set status = 'freigegeben' where name like 'Nach Gebäude%';
-- ERROR: Diese Zahlung ist noch nicht freizugeben: Gebäude dicht, Feuchter Fleck …
```

**Am *Musterhaus Sonnenweg*** ist es umgekehrt: Der Bau hat noch nicht
begonnen, dafür stimmt am Vertrag etwas nicht. Der Vertragsspiegel nennt drei
Befunde — Zahlungsplan bei 95 % (§ 650m Abs. 1 BGB), fehlende Sicherheit
(§ 650m Abs. 2 BGB), Baubeschreibung noch nicht durchgesehen (Art. 249 EGBGB).

Unter jedem steht unverändert und sichtbar: *Hinweis auf eine Gesetzesstelle,
keine Rechtsberatung.* Nie verkürzt, nie eingeklappt (CI 11.3).

Zum Ausprobieren: *Baubeschreibung durchgehen* aufklappen, zehn der elf Punkte
abhaken, **Übernehmen**. Der Befund ändert sich von „noch nicht durchgesehen"
zu „es fehlt 1 von 11 Punkten" und nennt den fehlenden beim Namen. Das ist der
Unterschied, um den es geht: „Die Baubeschreibung ist unvollständig" ist keine
Hilfe, „es fehlt die verbindliche Angabe zur Bauzeit" ist eine.

Darunter stehen die **Nachträge**. Der Abschnitt ist auch dann da, wenn keiner
erfasst ist — mit einem Satz, warum er wichtig ist: Nachträge sind der
häufigste Weg, auf dem ein Bau teurer wird als vereinbart, und einzeln fallen
sie kaum auf.

Zum Ausprobieren: am *Musterhaus Sonnenweg* einen vereinbarten Nachtrag über
48.000 Euro erfassen. Das sind mehr als zehn Prozent der Vergütung, und der
Vertragsspiegel meldet daraufhin sofort § 650m Abs. 2 S. 2 BGB — die weitere
Sicherheit von fünf Prozent des zusätzlichen Vergütungsanspruchs.

Darunter steht das **Darlehen** mit den Bereitstellungszinsen — die Zahl, die
sonst erst auf einer Abrechnung auftaucht und bei einem verzögerten Bau
schnell vierstellig wird.

## Die Bauakte

Der letzte Verweis im Plan heißt **Bauakte**. Er führt auf eine Seite, die
gedruckt werden will: Deckblatt mit Projekt-, Vertrags- und
Beteiligtendaten, die Prüfsumme der Tagebuchkette, danach die Chronologie und
zuletzt die Fotos.

Voreingestellt sind drei Monate zurück; der Zeitraum lässt sich ändern.

Das Besondere ist die **Chronologie**: fünf Quellen in einem Strang —
Vorgänge, Terminänderungen, Tagebucheinträge, Mängel und Zahlungen. Was am
selben Tag passiert ist, steht am selben Tag. Das ist der Unterschied zu fünf
Listen, zwischen denen man hin- und herblättert.

Die Bestätigungsgrade sind darin **optisch unterscheidbar** — und nicht durch
Farbe allein:

| Zeichen | Grad |
|---|---|
| ○ | Von dir eingetragen |
| ◐ | Vom GU genannt |
| ● | Abgestimmt |
| ◑ | Zwei Angaben |

Der Grund ist banal und wichtig: Eine Akte wird gedruckt, und gedruckt wird
oft in Graustufen. Dann sähen Grün und Tangerine gleich aus, und ausgerechnet
der Unterschied zwischen „abgestimmt" und „zwei Angaben" wäre verschwunden.

**Das PDF macht der Browser.** „Drucken → Als PDF sichern" ist auf jedem Gerät
derselbe Griff, und das Ergebnis ist ein PDF wie jedes andere. Es gibt keinen
Erzeuger auf dem Server, und das ist kein Sparzwang: Fotos gehen nie durch den
Anwendungsserver (Abschnitt 6.1), ein Erzeuger dort müsste jedes einzelne
durchziehen.

Daneben steht **Alle Daten als Datei** — der vollständige Export nach
Abschnitt 6.5, als JSON, mit allem, was zu diesem Bauvorhaben in der Datenbank
steht. Gelesen unter deinen Rechten, also genau das, was du ohnehin sehen
darfst.

Anlegen darf die Akte, wer laut Rechtematrix `export.run` hat: Bauherr,
Zweitbauherr, Sachverständiger. Der GU sieht den Verweis nicht und käme auch
über die Adresse nicht hinein.

## Ein Bauvorhaben löschen

Ganz unten im Plan, ohne Überschrift: *Dieses Bauvorhaben löschen*. Löschen
ist keine Aufgabe, die jemand sucht, sondern eine, die es geben muss
(Abschnitt 6.5).

Es ist ein Antrag mit Frist, kein Knopf. Zum Bestätigen wird der Projektname
abgetippt — ein „Wirklich?"-Dialog wird weggeklickt, ein Name nicht. Danach
verschwindet das Bauvorhaben aus der Liste, und dreißig Tage lang steht oben
*Doch behalten*.

Gelöscht ist in dieser Zeit nichts. Entfernt werden die Daten erst vom
Betreiber, mit `pnpm project:purge`. Der Grund steht in `docs/BETRIEB.md`: Die
Anwendungsrolle darf Historie gar nicht löschen, und das soll so bleiben.

Läuft die Gewährleistung noch — also weniger als fünf Jahre seit der Abnahme —
steht das im Dialog. Als Auskunft, nicht als Sperre: Es sind die Daten des
Bauherrn.

## Was noch fehlt

- **Wetterdaten vom DWD.** Abschnitt 3.8 sieht vor, dass die Wetterlage
  automatisch von der nächstgelegenen Station kommt und mit dem Eintrag
  eingefroren wird. Dafür braucht es die Koordinaten des Bauvorhabens, die das
  Onboarding heute nicht erhebt, und einen Abruf bei `opendata.dwd.de`. Von
  Hand erfasstes Wetter wird bereits mit dem Eintrag eingefroren.
- **Push zum Wochenbericht.** Er geht als Mail hinaus (`pnpm report:weekly
  --send`). Der zweite Kanal aus 3.11 fehlt: Er verlangt eigene Schlüssel und
  einen Umbau am Service Worker, den Regel 7 des Repositoriums nicht ohne Not
  angefasst sehen will.

- **Lotsenkarten für die übrigen Vorgänge.** Zwölf Karten decken die Phasen ab,
  in denen am meisten schiefgeht; die anderen 22 Vorgänge sagen ehrlich, dass es
  zu ihnen noch keine gibt. Und die fachliche Prüfung durch einen
  Sachverständigen steht aus, siehe `docs/REDAKTION.md`.

## Nach `pnpm db:test`

Die RLS-Tests leeren die lokale Datenbank. Danach ist auch die Demolage weg —
einfach `pnpm demo:seed` erneut aufrufen.

Ein zweiter Aufruf bei bestehender Demolage ändert nichts: Ein Projekt lässt
sich nicht löschen, solange `schedule_change` daran hängt, denn diese Historie
ist append-only. Für einen frischen Plan `pnpm db:reset && pnpm demo:seed`.

## Online vorführen: Supabase und Vercel

Der Weg ohne einen einzigen Befehl auf deinem Rechner. Reihenfolge einhalten —
die Datenlage muss stehen, bevor sich jemand anmeldet.

### 1. Datenlage in Supabase anlegen

Voraussetzung: Die Dateien aus `supabase/migrations` sind in diesem Projekt
eingespielt (siehe `docs/SETUP.md`, Abschnitt 2).

Dann im Dashboard: **SQL Editor → New query**, den Inhalt von
[`docs/demo-seed.sql`](demo-seed.sql) einfügen, **Run**.

Das Skript legt die beiden Demo-Nutzer an und dazu **beide Bauvorhaben** mit
je drei Mitgliedschaften — 38 und 34 Vorgänge. Am Ende zeigt es eine
Gegenprobe:

```
bauvorhaben          | beteiligte | vorgaenge | abhaengigkeiten | errechnetes_ende | geschuldet
Stadthaus Ahornweg   |          3 |        34 |              39 | …                | …
Musterhaus Sonnenweg |          3 |        38 |              43 | …                | …
```

Ein zweiter Lauf ändert nichts und bricht nicht ab: Jedes `insert` endet auf
`on conflict do nothing`, alle Kennungen sind fest. Wer das Skript später
erneut einfügt, bekommt also nur das, was ihm fehlt — ein bestehendes
Bauvorhaben bleibt samt seiner Termine unangetastet. Gelöscht wird nie,
`schedule_change` ist append-only.

Das Skript schreibt bewusst nicht als Datenbankeigentümer: Es setzt den
JWT-Claim des Bauherrn und wechselt auf die Rolle `authenticated`. Damit greifen
dieselben Policies wie im Betrieb, und die Historie nennt einen Verursacher
statt einer Leerstelle. Wer einen anderen Baustart braucht, ruft `pnpm demo:sql`
auf und erzeugt das Skript neu.

### 2. Umgebungsvariablen in Vercel

Settings → Environment Variables. Vier Variablen braucht die Anwendung ohnehin,
die fünfte schaltet den Testzugang frei:

| Variable | Wert |
|---|---|
| `DATABASE_URL` | Transaction-Pooler des Projekts, Port 6543 |
| `SUPABASE_JWT_SECRET` | Settings → JWT Keys → Legacy JWT Secret |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Settings → API Keys |
| `DEMO_LOGIN_KEY` | dein Schlüssel, mindestens 16 Zeichen |
| `ANTHROPIC_API_KEY` | nur wenn „Frag den Lotsen" vorgeführt werden soll |

`SUPABASE_JWT_SECRET` ist hier nicht optional: Mit genau diesem Geheimnis
unterschreibt der Testzugang seine Token, und mit ihm prüft die API sie.
Stimmt es nicht, endet jede Anmeldung in „Deine Anmeldung ist abgelaufen".

**Nach dem Eintragen neu deployen.** Umgebungsvariablen wirken nicht
rückwirkend, und die beiden `VITE_`-Werte werden beim Bauen ins Bundle gebacken.

### 3. Wo der Zugang liegt

Sauberer ist *Preview*: Dann gibt es die Tür in der Produktionsumgebung gar
nicht. Achte aber darauf, dass **Deployment Protection** für Previews
abgeschaltet ist — sonst steht dein Gast vor der Vercel-Anmeldung statt vor der
Anwendung.

Willst du unter der Produktionsadresse vorführen, trägst du `DEMO_LOGIN_KEY` in
*Production* ein. Das ist vertretbar, solange der Schlüssel lang ist und du ihn
danach wieder entfernst — die drei Riegel unten gelten dort genauso. **Lösch die
Variable nach der Vorführung und deploye neu**; dann ist die Route wieder weg.

### 4. Anmelden

Ein Link, ein Klick:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>
```

Die Seite zeigt zwei Knöpfe, *Als Bauherr starten* und *Als Generalunternehmer
starten*. Ein Klick genügt, ein Eingabefeld gibt es nicht.

Oder je ein Link pro Person — steht die Rolle im Link, meldet die Seite direkt
an, ganz ohne Klick:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=bauherr
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=gu
```

Für die Vorführung zu zweit: Einer nimmt den Bauherrn, der andere den
Generalunternehmer, beide sehen dieselben Bauvorhaben aus ihrer Rolle.

Alle Links tragen denselben Schlüssel — wer einen davon hat, kommt über
*Rolle wechseln* auch in die andere Rolle, ohne ihn erneut einzugeben. Der
Browser merkt sich den Schlüssel dafür, und *Abmelden* vergisst ihn wieder.
Für getrennte Zugänge im Wortsinn bräuchte es je Rolle einen eigenen Schlüssel;
für eine Vorführung zu zweit ist das unnötig.

Fehlt der Schlüssel im Link, etwa weil ein Messenger ihn abgeschnitten hat,
sagt die Seite das und bietet ein Feld zum Einfügen an.

## Wenn die Liste leer bleibt

„Hier stehen deine Bauvorhaben. Leg eines an" — obwohl das Skript gelaufen ist.
Drei Ursachen kommen in Frage. Der Reihe nach, jede mit einem Aufruf zu prüfen.

### 1. Kommt die API an die Datenbank?

```
https://<deine-adresse>/api/health/db
```

- `{"ok":true,"phases":9,"roles":47}` → die Verbindung steht und die
  Migrationen sind eingespielt.
- `{"ok":false,…}` → der Grund steht in `detail`, Zugangsdaten sind maskiert.
  Daneben steht `connection` und nennt die **Form** der Adresse, ohne Host,
  Benutzer oder Passwort:

  | Was dort steht | Was es bedeutet |
  |---|---|
  | `configured: false` | `DATABASE_URL` ist in dieser Umgebung nicht gesetzt |
  | `port: 5432`, `poolerUser: false` | Direct connection — von Vercel aus **nicht erreichbar**, sie ist nur über IPv6 zu haben. Nimm den Transaction-Pooler |
  | `port: 6543`, `poolerUser: false` | Pooler-Adresse, aber der Benutzername ist nicht `postgres.<projektkennung>` — der Pooler weist das als `Tenant or user not found` ab |
  | `port: 6543`, `poolerUser: true` | Die Adresse hat die richtige Form; dann steht die Ursache in `detail` |
- `phases: 0` bekommst du hier nie zu sehen; fehlen die Migrationen, scheitert
  schon die Abfrage und der Grund steht in `detail`.

### 2. Wen sieht die Datenbank?

Steht die Liste leer da, nennt die Seite darunter in kleiner Schrift, wen die
Datenbank erkannt hat:

```
Angemeldet als bauherr@demo.meinbaulotse.de · keine Beteiligung eingetragen
```

- **Deine eigene Adresse** statt der des Testzugangs → du schaust mit deinem
  Supabase-Konto auf eine Liste, in der nichts steht. Einmal *Abmelden*, dann
  den Demo-Link öffnen. Das passiert von selbst, wenn das Testtoken nach zwölf
  Stunden abläuft und daneben eine echte Anmeldung liegt; dann steht dort auch
  „Du warst zuletzt im Testzugang".
- **„Die Datenbank erkennt diese Anmeldung nicht"** → `auth.uid()` löst den
  JWT-Claim nicht auf. Dann bleibt jede Liste leer, egal was in den Tabellen
  steht.

Dieselbe Auskunft gibt es als Aufruf, mit dem Token im Kopf der Anfrage:
`GET /api/v1/me` liefert `tokenSub`, `databaseUserId`, `email` und
`memberships`.

### 3. Ist die Datenlage in *dieser* Datenbank?

Im SQL Editor genau die Abfrage, die die API stellt — als Demo-Bauherr:

```sql
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select set_config('role', 'authenticated', false);

select p.name, m.role
  from project p
  join project_member m on m.project_id = p.id
 where m.user_id = mbl.current_user_id() and m.revoked_at is null;

reset role;
```

Zwei Zeilen → die Datenlage steht, es liegt an der Anwendung. Null Zeilen →
das Skript ist hier nicht angekommen, und dann ist es die falsche Datenbank.

Was es **nicht** ist: der `DEMO_LOGIN_KEY`. Der bewacht allein die
Anmelderoute. Stimmt er nicht, sagt die Seite beim Klick „Dieser
Zugangsschlüssel stimmt nicht" — bis zur Liste kommt man damit gar nicht.
Sobald das Token ausgestellt ist, entscheidet allein die RLS, was zu sehen ist.

## Warum das vertretbar ist

Drei Riegel, nachzulesen in `apps/api/src/demo.ts`:

1. Ohne `DEMO_LOGIN_KEY` wird die Route nicht montiert.
2. Der Schlüssel muss mitkommen, ist mindestens 16 Zeichen lang und wird
   zeitkonstant verglichen. Ein kürzerer gilt als nicht gesetzt.
3. Es gibt genau zwei fest verdrahtete Identitäten. Ein Token auf einen echten
   Nutzer lässt sich hierüber nicht ausstellen.

Das Token sagt nur, *wer* fragt. Was diese Kennung darf, entscheidet
unverändert die RLS in der Datenbank — der Testzugang hebelt keine einzige
Policy aus.

## Rückbau

Wenn der Mailversand steht, fällt der Zugang in einem Rutsch weg:

```
apps/api/src/demo.ts
apps/api/scripts/demo.ts
apps/api/scripts/demo-sql.ts
apps/web/src/lib/demo-auth.ts
apps/web/src/routes/DemoLogin.tsx
docs/demo-seed.sql
```

dazu die vier Stellen, die darauf verweisen: `apps/api/src/app.ts`,
`apps/web/src/App.tsx`, `apps/web/src/lib/api.ts`,
`apps/web/src/routes/Projects.tsx`. An der echten Anmeldung wurde nichts
geändert.
