# MeinBaulotse — Produkt- und Umsetzungsspezifikation

**Produktname:** MeinBaulotse
**Version:** 2.0 — Positionierung „Bauunterstützung für private Bauherren" (B2C)
**Zweck:** vollständige, umsetzbare Grundlage für die Entwicklung mit Claude Code. Gestaltung siehe `meinbaulotse-ci.md`.

> **Was sich gegenüber Version 1.0 geändert hat:** Der Schwerpunkt liegt nicht mehr auf dem Nachweis gegenüber dem GU, sondern auf der Begleitung eines Laien durch ein Verfahren, das er einmal im Leben durchläuft. Die Wissensschicht und der Entscheidungsassistent stehen vorn, die lückenlose Dokumentation läuft im Hintergrund mit und wird erst dann zum Thema, wenn sie gebraucht wird.

---

## 1. Das Produkt

### 1.1 Positionierung

Der Lotse geht an Bord, kennt das Fahrwasser und sagt an, was kommt. Das Kommando behält der Kapitän. Genau so verhält sich dieses Produkt zum Bauherren: Es entscheidet nichts, es baut nichts, es kontrolliert niemanden. **Es sorgt dafür, dass der Bauherr rechtzeitig weiß, was auf ihn zukommt und was er dafür tun muss.**

**Leitsatz für jede Produktentscheidung:** *Du bleibst der Bauherr. Wir sagen dir, was als Nächstes kommt.*

### 1.2 Das eigentliche Problem

Ein privater Bauherr scheitert selten daran, dass er nicht weiß, wann der Fliesenleger kommt. Er scheitert an drei anderen Dingen:

1. **Er weiß nicht, was er nicht weiß.** Dass die Aufbauhöhe des Bodenbelags vor dem Estrich feststehen muss, steht in keinem Vertrag.
2. **Er entscheidet zu spät.** Fliesen werden vier Wochen vor dem Fliesenleger ausgesucht statt acht — die Lieferzeit kippt den Termin.
3. **Er merkt Verschiebungen erst, wenn sie unumkehrbar sind.**

MeinBaulotse beantwortet diese drei Punkte in dieser Reihenfolge.

### 1.3 Die vier tragenden Funktionen

| Rang | Funktion | Was sie leistet |
|---|---|---|
| 1 | **Bauphasen-Wissen** | Zu jedem laufenden und kommenden Vorgang: was gerade passiert, worauf zu achten ist, welche Fragen an den GU sinnvoll sind, was typischerweise schiefgeht |
| 2 | **Entscheidungsassistent** | Jede Bauherren-Entscheidung hängt an einem Vorgang und einer Vorlaufzeit. Verschiebt sich der Vorgang, verschiebt sich die Frist automatisch mit |
| 3 | **Terminplan mit Gewerkelogik** | Vorgefertigter Bauablauf, Abhängigkeiten, technologische Wartezeiten, Puffer je Vorgang — beantwortet, welche Termine fix sind und welche geschoben werden dürfen |
| 4 | **Dokumentation, die im Hintergrund entsteht** | Tagebuch, Fotos, Verschiebehistorie. Wird nicht beworben, ist aber vollständig und belastbar, wenn sie gebraucht wird |

### 1.4 Wo das Produkt seine Grenze zieht

MeinBaulotse ersetzt **keinen Baubegleiter und keinen Bausachverständigen**. Es kann nicht erkennen, ob die Perimeterdämmung falsch verklebt ist. Diese Grenze wird offen benannt — sie ist glaubwürdiger als jedes Versprechen und öffnet zugleich einen Vertriebskanal:

- Zu jeder Bauphase, in der eine Fachprüfung sinnvoll ist (Bodenplatte, Rohbau, Rohinstallation vor Verkleidung, Abnahme), erscheint ein Hinweis mit Weiterleitung zu VPB oder Bauherren-Schutzbund
- Ein Baubegleiter kann als Rolle `expert` in das Projekt eingeladen werden und seine Prüfberichte direkt einstellen
- Der Kostenrahmen wird ehrlich genannt: durchgehende Begleitung 1.500–3.500 €, Einzeltermine ab rund 500 €

### 1.5 Nicht-Ziele

- Keine Ausschreibung, kein Aufmaß, kein GAEB, kein LV-Management
- Keine BIM- oder IFC-Modelle
- Keine Rechnungserstellung, keine Handwerker-Zeiterfassung
- Keine Rechtsberatung. Hinweise nennen Gesetzesstellen und Sachverhalte, sie bewerten nie
- Keine bautechnische Mängelbeurteilung
- Kein natives App-Store-Release in Stufe 1. Installierbare PWA.

### 1.6 Leitsätze für die Umsetzung

1. **Erfassung unter 20 Sekunden.** Fällt die Pflege aus, ist alles Weitere wertlos.
2. **Das Produkt funktioniert allein.** Keine Funktion darf die Mitwirkung des GU voraussetzen.
3. **Nichts wird still überschrieben.** Änderungen erzeugen Einträge, keine Ersetzungen.
4. **Der Ton bleibt beruhigend.** Auch schlechte Nachrichten kommen mit einem nächsten Schritt.

---

## 2. Nutzer und Rechte

### 2.1 Rollen

| Rolle | Beschreibung | Zugang |
|---|---|---|
| `owner` | Bauherr, Eigentümer des Projekts und aller Daten | Konto |
| `co_owner` | Partner, zweiter Bauherr | Konto |
| `contractor` | GU oder Bauleiter des GU | Konto **oder** Gast-Link |
| `trade` | Einzelgewerk | Gast-Link |
| `expert` | Baubegleiter, Sachverständiger, Architekt | Konto, mandantenfähig |
| `viewer` | Familie, Bank, stiller Mitleser | Gast-Link, nur lesend |

### 2.2 Rechtematrix

| Aktion | owner | co_owner | contractor | trade | expert | viewer |
|---|---|---|---|---|---|---|
| Projekt anlegen/löschen | ✓ | – | – | – | – | – |
| Mitglieder einladen | ✓ | ✓ | – | – | – | – |
| Vorgänge anlegen/löschen | ✓ | ✓ | ✓ | – | – | – |
| Termin ändern | ✓ | ✓ | ✓ | eigener Vorgang | – | – |
| Termin bestätigen | ✓ | ✓ | ✓ | eigener Vorgang | – | – |
| Ist-Beginn/Ist-Ende melden | ✓ | ✓ | ✓ | eigener Vorgang | – | – |
| Entscheidung pflegen | ✓ | ✓ | – | – | Vorschlag | – |
| Tagebucheintrag erstellen | ✓ | ✓ | ✓ | – | ✓ | – |
| Fremden Eintrag ändern | – | – | – | – | – | – |
| Mangel erfassen | ✓ | ✓ | – | – | ✓ | – |
| Mangel auf „behoben" setzen | ✓ | ✓ | Vorschlag | Vorschlag | Vorschlag | – |
| Zahlungsfreigabe | ✓ | ✓ | – | – | – | – |
| Vertragsdaten pflegen | ✓ | ✓ | – | – | ✓ | – |
| Akte exportieren | ✓ | ✓ | – | – | ✓ | – |
| Lesen | ✓ | ✓ | ✓ | eigener Ausschnitt | ✓ | ✓ |

**Kaufmodell:** Nur `owner` zahlt. Alle anderen Rollen sind dauerhaft kostenlos. `expert` bekommt später ein eigenes Mandantenkonto (siehe Abschnitt 9).

### 2.3 Gast-Zugang ohne Registrierung

- Signierter Token im Link, projekt- und rollen-scoped, Standardablauf 180 Tage
- Kein Passwort, keine Registrierung. Erste Nutzung erfasst optional Name und Firma.
- Scopes: `confirm:task`, `report:progress`, `view:trade`, `view:project`
- Token an E-Mail oder Mobilnummer gebunden; abweichende Nutzung wird im Audit-Log vermerkt
- Ratenbegrenzung pro Token, Sperrmöglichkeit durch den `owner`
- Mehrsprachig ausliefern (de, pl, ro, tr, en) — erhöht die Rücklaufquote auf der Baustelle spürbar und kostet fast nichts

---

## 3. Fachliche Kernlogik

### 3.1 Wissensschicht (neu und tragend)

Zu jedem Vorgang im Bauablauf gehört eine **Lotsenkarte**. Sie wird automatisch eingeblendet, sobald der Vorgang in den Blick rückt: sieben Tage vor Beginn, während der Ausführung und beim Abschluss.

Aufbau einer Lotsenkarte:

| Feld | Inhalt |
|---|---|
| `whats_happening` | Was in diesem Vorgang tatsächlich passiert, in zwei bis drei Sätzen, für Laien |
| `watch_for[]` | Worauf der Bauherr selbst achten kann — ohne Fachkenntnis prüfbar |
| `questions_for_contractor[]` | Konkrete Fragen an den GU, wörtlich verwendbar |
| `common_problems[]` | Was hier typischerweise schiefgeht und woran man es erkennt |
| `expert_recommended` | Boolean plus Begründung: ob hier eine Fachprüfung sinnvoll ist |
| `decisions[]` | Verknüpfte Entscheidungen mit Vorlaufzeit |
| `photo_prompts[]` | Was jetzt fotografiert werden sollte, weil es später verdeckt ist |
| `sources[]` | Herkunft der Aussage (Norm, Verband, Fachliteratur) |

Die `photo_prompts` sind der stille Held: Wer beim Rohbau nicht fotografiert, wo die Leitungen liegen, bohrt sechs Jahre später in eine Wasserleitung. Der Nutzer erlebt es als Hilfe, das Produkt bekommt seine Dokumentation.

Der Redaktionsinhalt liegt versioniert in der Datenbank, nicht im Code, und ist ohne Deployment pflegbar.

### 3.2 Entscheidungsassistent

Eine `decision` hängt an einem Vorgang (`blocks_task_id`) und hat eine `lead_time_days`.

```
decision.due_date = werktage_vor(task.current_start, decision.lead_time_days)
```

Verschiebt sich der Vorgang, verschiebt sich die Frist mit. Rückt der Vorgang nach vorn, wird die Frist enger und der Bauherr gewarnt.

Zustände: `offen` → `in_bemusterung` → `entschieden` → `beauftragt`. Zu jeder Entscheidung gehört eine kurze Entscheidungshilfe: worum es geht, was die Optionen unterscheidet, was man später bereut. Keine Produktempfehlungen, keine Affiliate-Links im Entscheidungsfluss — das würde die Neutralität zerstören, die das ganze Produkt trägt.

### 3.3 Vorgangsstatus

```
geplant ──► terminiert ──► bestätigt ──► läuft ──► fertig ──► abgenommen
                 │              │           │
                 └──────────────┴───► verschoben ───► (zurück nach terminiert)
                                            │
                                            └───► entfallen
```

### 3.4 Bestätigungsgrad

| Wert | Anzeige im Produkt | Bedeutung |
|---|---|---|
| `self_stated` | „Von dir eingetragen" | nur eine Seite hat den Termin erfasst |
| `counterparty_stated` | „Vom GU genannt" | vom GU eingetragen, nicht gegenbestätigt |
| `mutual` | „Abgestimmt am 12.05." | beide Seiten haben bestätigt |
| `disputed` | „Zwei Angaben" | Gegenseite hat einen anderen Termin genannt |

Die Wortwahl ist Absicht: *abgestimmt* statt *quittiert*, *zwei Angaben* statt *strittig*. Dieselbe Datenlage, ein anderer Ton.

### 3.5 Terminverschiebung und Fortpflanzung

1. `schedule_change` schreiben (append-only), **bevor** der Vorgang geändert wird
2. Vorwärtsrechnung über den Abhängigkeitsgraphen (topologische Sortierung, dann Forward Pass)
3. Abhängigkeitstypen `FS`, `SS`, `FF` mit `lag_days`
4. `is_wait = true` markiert technologische Wartezeiten (Estrichtrocknung, Betonaushärtung). Nicht verkürzbar, eigene Darstellung.
5. Kalender: Werktage Mo–Fr, Feiertage nach Bundesland, Betriebsferien je Gewerk. Wartezeiten in **Kalendertagen**, Arbeitsvorgänge in **Werktagen**.
6. Betroffene Folgevorgänge als Vorschlag anzeigen, einzeln entkoppelbar
7. Auswirkung auf den prognostizierten Endtermin im `schedule_change` festschreiben
8. **Entscheidungsfristen neu berechnen und Warnungen erzeugen** — das ist der Schritt, der die Verschiebung für den Bauherren handlungsrelevant macht

### 3.6 Kritischer Pfad und Puffer

CPM-Rechnung, Backward Pass vom vertraglich geschuldeten Fertigstellungstermin. Für den Bauherren ist der Gesamtpuffer die interessante Zahl und wird im Klartext ausgegeben:

> „Dieser Termin darf sich um 12 Werktage verschieben, ohne dass der Endtermin kippt."
> „Dieser Termin hat keinen Puffer. Jeder Tag Verzug ist ein Tag später fertig."

### 3.7 Frag den Lotsen (KI-Assistent)

Ein Chat mit Kontext auf das eigene Projekt: aktuelle Bauphase, laufende Vorgänge, offene Entscheidungen, Vertragsdaten, Tagebuch der letzten Wochen.

**Zwingende Leitplanken:**

- Keine Rechtsberatung. Fragen mit rechtlichem Kern werden mit Gesetzesstelle plus Verweis auf anwaltliche Beratung beantwortet.
- Keine bautechnische Mängelbeurteilung aus Fotos. Bei entsprechenden Fragen: Hinweis auf Bausachverständigen, mit Weiterleitung.
- Keine Kostenschätzungen, die als verbindlich missverstanden werden können.
- Jede Antwort, die auf Redaktionsinhalt beruht, verlinkt die zugrunde liegende Lotsenkarte.
- Antworten nennen offen, wenn die Datenlage im Projekt für eine Aussage nicht reicht.

Technisch: Anthropic API, Systemprompt mit Projektkontext, Redaktionsinhalt als abrufbarer Kontext, Gesprächsverlauf projektbezogen gespeichert.

### 3.8 Tagebuch mit Manipulationsschutz

- Eintrag 24 Stunden bearbeitbar, danach versiegelt (`locked_at`)
- Beim Versiegeln: `content_hash = sha256(canonical_json(entry) + prev_hash)`, `prev_hash` vom vorherigen versiegelten Eintrag desselben Projekts
- Fotos: `sha256` des Originals, EXIF-Aufnahmezeit und -Geoposition getrennt vom Nutzerdatum (`exif_taken_at` vs. `stated_date`); Abweichungen werden angezeigt, nicht versteckt
- Wetterdaten automatisch von der nächstgelegenen DWD-Station, mit dem Eintrag eingefroren
- Kein Eintrag löschbar. Zurückgezogene Einträge werden als `retracted` markiert und bleiben sichtbar.

Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum seiner Baustelle. Die Beweisqualität ist ein Nebenprodukt.

### 3.9 Vertragsspiegel und Rechtshinweise

Erfasst werden Vertragstyp, geschuldeter Fertigstellungstermin oder Bauzeitdauer, Gesamtvergütung, Zahlungsplan, vereinbarte Sicherheit, Baubeschreibung.

Automatische **Hinweise**, nie Bewertungen:

| Prüfung | Hinweistext (Kurzform) |
|---|---|
| Summe Abschläge > 90 % | „Der Zahlungsplan summiert sich auf X %. § 650m Abs. 1 BGB begrenzt Abschlagszahlungen bei Verbraucherbauverträgen auf 90 % der Gesamtvergütung einschließlich Nachträgen." |
| Sicherheit fehlt | „Eine Sicherheit für die rechtzeitige Herstellung ohne wesentliche Mängel ist nicht erfasst. § 650m Abs. 2 BGB sieht 5 % der Gesamtvergütung bei der ersten Abschlagszahlung vor, auf Verlangen des Unternehmers als Einbehalt." |
| Nachträge > 10 % | „Die Nachträge übersteigen 10 % der ursprünglichen Vergütung. § 650m Abs. 2 S. 2 BGB sieht dann eine weitere Sicherheit von 5 % des zusätzlichen Vergütungsanspruchs vor." |
| Kein Fertigstellungstermin | „Der Vertrag enthält weder Fertigstellungstermin noch Bauzeitdauer. § 650k Abs. 3 BGB verlangt verbindliche Angaben hierzu." |
| Baubeschreibung unvollständig | Liste der fehlenden Punkte nach Art. 249 EGBGB |

Fester Zusatz an jedem Hinweis: *Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.*

### 3.10 Zahlungsfreigabe an Baufortschritt gekoppelt

Ein `payment_milestone` referenziert Vorgänge. Freigabe erst möglich, wenn alle referenzierten Vorgänge `fertig` oder `abgenommen` sind und kein offener Mangel mit Schwere `wesentlich` daran hängt. Sonst zeigt die Oberfläche, was fehlt, und bietet Teilfreigabe unter Vorbehalt an. Dazu Darlehensabrufe mit Bereitstellungszinsrechner.

### 3.11 Wochenbericht

Montag 06:00, E-Mail und Push:

1. **Diese Woche auf der Baustelle** — Vorgänge mit Start oder Ende in den nächsten 7 Tagen, jeweils mit Kurzfassung der Lotsenkarte
2. **Was du entscheiden musst** — Entscheidungen nach Frist, Restlaufzeit in Werktagen
3. **Was sich verschoben hat** — neue Änderungen der letzten Woche
4. **Prognose** — geschuldeter vs. errechneter Endtermin, Delta in Werktagen
5. **Fotos, die jetzt fällig sind** — aus den `photo_prompts` der laufenden Vorgänge
6. **Geld** — nächste fällige Zahlung und deren Voraussetzung

Dieser Bericht ist der Retention-Anker und gehört ins MVP.

---

## 4. Datenmodell

Postgres. Alle Tabellen mit `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`. RLS auf allen Tabellen über `project_member`.

```sql
-- Projekt und Beteiligte -------------------------------------------------

project (
  id, name, address, postal_code, city, federal_state,
  lat, lon,
  build_type,           -- efh_massiv | efh_fertighaus | sanierung | sonstiges
  contract_type,        -- verbraucherbauvertrag | einzelgewerke | sonstiges
  planned_start date, contractual_completion date,
  contract_sum_cents bigint, security_pct numeric(4,2),
  diary_head_hash text, baseline_locked_at timestamptz,
  created_by uuid
)

project_member (
  id, project_id, user_id nullable, role,
  display_name, company, email, phone, trade_id nullable,
  invited_at, accepted_at, revoked_at
)

guest_token (
  id, project_id, member_id, token_hash, scopes text[],
  locale, expires_at, last_used_at, use_count, revoked_at
)

-- Ablauf -----------------------------------------------------------------

trade (id, project_id nullable, code, name, sort_order, color_key)

task (
  id, project_id, trade_id, name, description,
  wbs_code, phase_key,                 -- Zuordnung zur Bauphase
  is_milestone boolean, is_wait boolean,
  duration_days int, duration_unit,    -- werktage | kalendertage
  baseline_start date, baseline_end date,
  current_start date, current_end date,
  actual_start date, actual_end date,
  status, confirmation,
  confirmed_by uuid, confirmed_at timestamptz,
  responsible_member_id uuid,
  total_float_days int, is_critical boolean,
  guide_card_id uuid                   -- Verknüpfung zur Lotsenkarte
)

dependency (
  id, project_id, predecessor_id, successor_id,
  type, lag_days int, lag_unit
)

-- APPEND-ONLY. Anwendungsrolle hat nur INSERT.
schedule_change (
  id, project_id, task_id, field,
  old_value jsonb, new_value jsonb,
  actor_member_id, actor_role, actor_channel,   -- app | guest_link | import
  reason_code,   -- witterung|lieferzeit|kapazitaet|planungsaenderung
                 -- |bauherren_entscheidung|vorgewerk_verzug|behoerde
                 -- |mangelbeseitigung|nachtrag|sonstiges
  reason_text, effect_days_on_completion int,
  propagated_from_change_id uuid nullable,
  created_at timestamptz
)

-- Wissensschicht ---------------------------------------------------------

guide_card (
  id, phase_key, trade_code, build_types text[],
  title, whats_happening text,
  watch_for jsonb,                    -- [{text, why}]
  questions_for_contractor jsonb,     -- [{question, why_it_matters}]
  common_problems jsonb,              -- [{problem, how_to_spot}]
  photo_prompts jsonb,                -- [{what, why, before_which_task}]
  expert_recommended boolean, expert_reason text,
  sources jsonb,
  version int, published_at timestamptz, superseded_by uuid
)

guide_card_read (            -- was der Nutzer gesehen hat, für Wiedervorlage
  id, project_id, guide_card_id, member_id, read_at, helpful boolean nullable
)

checklist_item (
  id, project_id, task_id, guide_card_id nullable,
  text, is_done boolean, done_at, done_by, note
)

-- Entscheidungen ---------------------------------------------------------

decision (
  id, project_id, template_key nullable,
  title, description, help_text,
  blocks_task_id, lead_time_days, lead_time_unit,
  due_date date,
  status,                 -- offen|in_bemusterung|entschieden|beauftragt|hinfaellig
  decided_at, decided_note, estimated_cost_cents bigint nullable
)

-- Tagebuch ---------------------------------------------------------------

diary_entry (
  id, project_id, entry_date date, body text,
  author_member_id, author_role,
  weather jsonb, task_ids uuid[],
  locked_at, content_hash, prev_hash,
  retracted_at, retraction_reason
)

media (
  id, project_id, diary_entry_id nullable, defect_id nullable,
  storage_path, mime, bytes, sha256,
  exif_taken_at, exif_lat, exif_lon,
  floorplan_x, floorplan_y, floor,
  photo_prompt_key nullable,           -- erfüllt einen photo_prompt
  caption
)

-- Mängel, Nachträge, Geld ------------------------------------------------

defect (
  id, project_id, task_id nullable, trade_id nullable,
  title, description, location_text,
  severity,        -- geringfuegig | wesentlich
  reported_at, deadline date, status, escalation_level int,
  resolved_at, accepted_at, reserved_at_handover boolean
)

change_order (
  id, project_id, title, trigger, bgb_basis,
  amount_cents bigint, days_impact int, affected_task_ids uuid[],
  status, requested_at, agreed_at
)

payment_milestone (
  id, project_id, name, pct numeric(5,2), amount_cents bigint,
  requires_task_ids uuid[],
  invoice_number, invoice_date, due_date, status,
  released_by, released_at, paid_at,
  withheld_cents bigint, withheld_reason
)

loan_drawdown (
  id, project_id, amount_cents, requested_at, paid_at,
  commitment_interest_cents bigint
)

-- Assistent und Protokoll ------------------------------------------------

assistant_thread (id, project_id, member_id, title, created_at)
assistant_message (
  id, thread_id, role, content text,
  context_snapshot jsonb,     -- was dem Modell mitgegeben wurde
  cited_guide_card_ids uuid[], created_at
)

contract_check (
  id, project_id, rule_key, severity, message, legal_reference,
  dismissed_at, dismissed_reason
)

audit_log (
  id, project_id, actor_member_id, actor_channel,
  action, entity_type, entity_id, meta jsonb,
  ip_hash, user_agent_hash, created_at
)
```

### 4.1 Datenbank-Invarianten (Constraints und Trigger, nicht nur Anwendungscode)

1. `schedule_change`: Anwendungsrolle hat nur `INSERT`. Ein `BEFORE UPDATE OR DELETE`-Trigger wirft zusätzlich eine Exception.
2. `diary_entry`: nach `locked_at` sind nur `retracted_at` und `retraction_reason` änderbar.
3. `task.baseline_start/baseline_end`: nach `project.baseline_locked_at` unveränderlich.
4. Jede Änderung an `task.current_start`, `current_end`, `duration_days` oder `status` erzeugt per Trigger zwingend einen `schedule_change`.
5. `dependency`: kein Zyklus, Prüfung per rekursiver CTE vor dem Insert.
6. `guide_card`: unveränderlich nach `published_at`. Änderungen erzeugen eine neue Version, die alte wird über `superseded_by` verkettet — sonst lässt sich später nicht mehr sagen, welchen Rat der Nutzer damals bekommen hat.
7. RLS: jede Tabelle prüft Projektmitgliedschaft. `role=trade` sieht nur Zeilen mit passender `trade_id`.

---

## 5. Oberflächen

### 5.1 Cockpit

```
┌──────────────────────────────────────────────────────────────┐
│  Ihr seid in Phase 5 von 9 · Ausbau                          │
│  ●───●───●───●───◉───○───○───○───○                           │
│  Geschuldet 14.08.26 · Errechnet 02.10.26 · 34 Werktage      │
├──────────────────────────────────────────────────────────────┤
│  Diese Woche                                                 │
│  Mo–Mi  Estrich                             [Was passiert?]  │
│  Do     Blower-Door-Vorabtest               [Was passiert?]  │
├──────────────────────────────────────────────────────────────┤
│  Du musst entscheiden                                        │
│  Fliesen Bad OG        noch  4 Werktage      [Ansehen]       │
│  Innentüren            noch 19 Werktage      [Ansehen]       │
├──────────────────────────────────────────────────────────────┤
│  Jetzt fotografieren                                         │
│  Leitungsverlauf vor dem Estrich — danach nicht mehr sichtbar│
│  [Kamera öffnen]                                             │
├──────────────────────────────────────────────────────────────┤
│  Verschoben seit Montag                                      │
│  Fliesen 12.05 → 26.05  vom GU · Lieferzeit · +10 Tage Ende  │
└──────────────────────────────────────────────────────────────┘
```

Reihenfolge ist Absicht: erst wo stehen wir, dann was kommt, dann was **du** tun musst, dann erst was schiefgeht.

### 5.2 Lotsenkarte

Vollbild-Ansicht zu einem Vorgang: was passiert, worauf achten, Fragen an den GU (mit Kopieren-Knopf, damit sie direkt in eine Nachricht wandern), typische Probleme, verknüpfte Entscheidungen, Fotoaufträge, gegebenenfalls Hinweis auf eine Fachprüfung. Am Ende: „War das hilfreich?" — die einzige Metrik, die für die Redaktion zählt.

### 5.3 Terminplan

- **Liste** (mobil, Standard): nach Datum gruppiert, Gewerk, Status, Bestätigungsgrad, Puffer im Klartext
- **Zeitachse** (Desktop): waagerechte Achse mit den Bauphasen als Marken. Je Vorgang zwei Spuren, Baseline blass darüber, Ist-Stand darunter; der Zwischenraum ist die Verschiebung. Entscheidungsfristen liegen als Marken **vor** dem zugehörigen Vorgang auf der Achse.

### 5.4 Schnellerfassung

Ein Knopf, Kamera öffnet sofort. Nach dem Foto: Datum, Wetter und Ort automatisch, Vorgang vorbelegt, optionale Notiz, Abzweig „als Mangel erfassen". Ziel unter 20 Sekunden, mit Handschuhen bedienbar, offlinefähig.

### 5.5 Abstimmungsseite für den GU (kein Konto)

```
Baustelle Musterweg 4

Für den Innenputz ist der 12.–21.05. eingetragen.
Passt das?

[ Passt ]   [ Anderer Termin ]   [ Antworten ]
```

Kein Login, keine App, unter zehn Sekunden erledigt, in der Sprache des Empfängers.

### 5.6 Bauakte

Auswahl eines Zeitraums oder Vorgangs, dann PDF: Deckblatt mit Projekt-, Vertrags- und Beteiligtendaten sowie Prüfsumme der Tagebuchkette, chronologische Darstellung aller Vorgänge, Verschiebungen, Einträge und Mängel, Fotoanhang mit Zeitstempeln. Bestätigungsgrade sind optisch unterscheidbar.

Im Produkt heißt das **Bauakte**, nicht Beweisakte. Der Nutzer soll sie anlegen, weil sie ordentlich ist, nicht weil er Streit erwartet.

---

## 6. Technik

### 6.1 Stack

| Schicht | Wahl | Begründung |
|---|---|---|
| Frontend | React + Vite + TypeScript, installierbare **PWA** | Kamera und Offline ohne App-Store-Verfahren |
| Server-Sync | TanStack Query mit Offline-Mutationsqueue | Erfassung muss ohne Netz funktionieren |
| Lokale Persistenz | IndexedDB für Queue und Fotocache | |
| Backend | Node, Hono oder Express, serverless deploybar | |
| Datenbank | Postgres mit RLS | Rechte gehören in die Datenbank |
| ORM | Drizzle | versionierte Migrationen, SQL bleibt sichtbar |
| Dateien | S3-kompatibel, signierte Upload-URLs | Fotos gehen nie durch den Anwendungsserver |
| E-Mail | transaktionaler Anbieter mit EU-Verarbeitung | Wochenbericht, Abstimmungslinks |
| PDF | serverseitig, React-PDF oder Headless-Chromium | |
| Wetter | DWD Open Data, Station per Koordinaten | kostenfrei, amtlich |
| KI | Anthropic API | „Frag den Lotsen", optional Vertragsauslesung |
| Zahlungen | Stripe | |

### 6.2 Berechnungskern isolieren

`packages/schedule/` als framework-freies TypeScript-Paket:

```ts
computeSchedule(tasks, dependencies, calendar): ScheduleResult
propagateShift(taskId, newStart, graph): ProposedChange[]
criticalPath(graph, contractualEnd): { critical: TaskId[], floats: Map<TaskId, number> }
decisionDueDates(decisions, tasks, calendar): Map<DecisionId, Date>
workdayOffset(date, days, calendar): Date
```

Reine Funktionen, keine Datenbank, `date` statt `timestamp`, vollständig unit-getestet.

### 6.3 Redaktionssystem für die Wissensschicht

Der Inhalt der Lotsenkarten ist die eigentliche Wertschöpfung und muss ohne Deployment pflegbar sein:

- Ablage als Markdown mit Frontmatter im Repository, Import über eine Migration in `guide_card`
- Jede Karte trägt `version` und `sources`; veröffentlichte Karten sind unveränderlich
- Ein einfacher Redaktionsmodus in der Anwendung für `owner` mit Admin-Flag reicht in Stufe 1
- Qualitätsanspruch: Jede Aussage ist auf eine Norm, eine Verbandsempfehlung oder Fachliteratur zurückführbar. Keine Behauptung ohne Quelle — an dieser Stelle steht die Glaubwürdigkeit des gesamten Produkts.

### 6.4 Sicherheit

- RLS auf jeder Tabelle, kein Zugriff über eine privilegierte Rolle aus dem Anwendungscode
- Gast-Token nur als Hash in der Datenbank
- Signierte, kurzlebige URLs für Fotoabruf
- Rate Limiting auf allen Gast- und Assistenten-Endpunkten
- Automatisierte Negativtests je Rolle: fremde Projektdaten sind nicht erreichbar
- Keine personenbezogenen Daten in URLs oder Query-Parametern
- Der Assistent bekommt ausschließlich Daten des eigenen Projekts in den Kontext; der Kontextaufbau ist serverseitig und nicht vom Client steuerbar

### 6.5 Datenschutz

- Baustellenfotos können Beschäftigte zeigen: Hinweis beim ersten Upload, Unkenntlichmachung im Editor
- Auftragsverarbeitungsverhältnisse dokumentieren, KI-Anbieter eingeschlossen
- Vollständiger Datenexport und Löschung als Selbstbedienung
- Aufbewahrung bis 5 Jahre nach Abnahme wegen Gewährleistung, danach Erinnerung statt stiller Löschung

---

## 7. Seed-Daten

### 7.1 Bauphasen (Gliederung für Fortschritt und Wissensschicht)

| # | `phase_key` | Bezeichnung |
|---|---|---|
| 1 | `vorbereitung` | Vorbereitung und Vertrag |
| 2 | `gruendung` | Gründung und Keller |
| 3 | `rohbau` | Rohbau |
| 4 | `dach_huelle` | Dach und Gebäudehülle |
| 5 | `rohinstallation` | Rohinstallationen |
| 6 | `ausbau` | Innenausbau |
| 7 | `endausbau` | Endausbau |
| 8 | `aussenanlagen` | Außenanlagen |
| 9 | `abnahme` | Abnahme und Übergabe |

### 7.2 Ablaufvorlage „Einfamilienhaus massiv, unterkellert"

Dauer in Werktagen, sofern nicht anders angegeben.

| # | Vorgang | Gewerk | Phase | Dauer | Vorgänger |
|---|---|---|---|---|---|
| 1 | Baugrundgutachten | Gutachter | 1 | 10 | – |
| 2 | Vermessung, Absteckung, Schnurgerüst | Vermesser | 1 | 1 | – |
| 3 | Baustelleneinrichtung, Bauwasser, Baustrom | GU | 1 | 2 | 2 |
| 4 | Erdarbeiten, Baugrube | Erdbau | 2 | 3 | 3 |
| 5 | Sauberkeitsschicht, Fundamenterder | Rohbau | 2 | 2 | 4 |
| 6 | Bodenplatte | Rohbau | 2 | 4 | 5 |
| 7 | Aushärtung Bodenplatte | – | 2 | 3 KT *(wait)* | 6 |
| 8 | Kellerwände | Rohbau | 2 | 8 | 7 |
| 9 | Kellerdecke | Rohbau | 2 | 4 | 8 |
| 10 | Abdichtung, Perimeterdämmung, Drainage | Rohbau | 2 | 3 | 9 |
| 11 | Verfüllung Arbeitsraum | Erdbau | 2 | 2 | 10 |
| 12 | Erdgeschoss-Mauerwerk | Rohbau | 3 | 8 | 9 |
| 13 | Geschossdecke EG | Rohbau | 3 | 4 | 12 |
| 14 | Obergeschoss, Drempel, Ringanker | Rohbau | 3 | 7 | 13 |
| 15 | **Rohbau fertig / Richtfest** | – | 3 | Meilenstein | 14 |
| 16 | Dachstuhl | Zimmerer | 4 | 4 | 15 |
| 17 | Dacheindeckung, Klempnerarbeiten | Dachdecker | 4 | 6 | 16 |
| 18 | Fenster und Haustür | Fensterbau | 4 | 3 | 16 |
| 19 | **Gebäude dicht** | – | 4 | Meilenstein | 17, 18 |
| 20 | Rohinstallation Elektro | Elektro | 5 | 8 | 19 |
| 21 | Rohinstallation Sanitär und Heizung | SHK | 5 | 8 | 19 |
| 22 | Lüftungsanlage | SHK | 5 | 4 | 21 |
| 23 | Blower-Door-Vorabtest | Prüfer | 5 | 1 | 20, 21, 22 |
| 24 | Innenputz | Putzer | 6 | 8 | 23 |
| 25 | Trockenbau, Dachgeschossausbau | Trockenbau | 6 | 10 | 23 |
| 26 | Estrich | Estrich | 6 | 3 | 24, 25 |
| 27 | **Trocknung bis Belegreife** | – | 6 | 35 KT *(wait)* | 26 |
| 28 | Fliesenarbeiten | Fliesen | 7 | 8 | 27 |
| 29 | Innentüren | Tischler | 7 | 3 | 24 |
| 30 | Malerarbeiten | Maler | 7 | 8 | 28, 29 |
| 31 | Bodenbeläge | Bodenleger | 7 | 5 | 30 |
| 32 | Treppe | Treppenbau | 7 | 2 | 30 |
| 33 | Endmontage Elektro | Elektro | 7 | 4 | 31 |
| 34 | Endmontage Sanitär | SHK | 7 | 4 | 28, 31 |
| 35 | Außenanlagen, Zufahrt, Pflaster | GaLaBau | 8 | 10 | 19 |
| 36 | Baureinigung | Reinigung | 9 | 2 | 33, 34 |
| 37 | **Abnahme und Übergabe** | – | 9 | Meilenstein | 36 |
| 38 | Schlussrechnung, Restzahlung | – | 9 | – | 37 |

### 7.3 Entscheidungsvorlagen mit Vorlaufzeiten

| Entscheidung | Blockiert | Vorlauf | Grund |
|---|---|---|---|
| Fenster: Farbe, Verglasung, Rollladen, Griffe | 18 | 60 WT | Fertigung und Lieferzeit |
| Heizsystem und Wärmepumpe final | 21 | 40 WT | Lieferzeit, Förderantrag |
| Sanitärobjekte und Vorwandpositionen | 21 | 20 WT | Position bestimmt die Rohinstallation |
| Elektroplanung: Steckdosen, Schalter, Netzwerk | 20 | 15 WT | danach ist jede Änderung ein Nachtrag |
| Küchenplanung mit Anschlusspunkten | 20 | 20 WT | Starkstrom und Wasser müssen vorher stehen |
| Dachziegel: Modell und Farbe | 17 | 20 WT | |
| Fassade: Putz oder Klinker, Farbton | 17 | 25 WT | Gerüststandzeit |
| Fliesen: Auswahl und Verlegemuster | 28 | 40 WT | Lieferzeit, häufigster Verzugsgrund |
| Bodenbelag und Aufbauhöhe | 26 | 15 WT | Aufbauhöhe bestimmt den Estrich |
| Innentüren: Modell, Zargen, Beschläge | 29 | 50 WT | lange Lieferzeiten |
| Treppe: Material und Geländer | 32 | 50 WT | Aufmaß nach Rohbau, dann Fertigung |
| Außenanlagen: Zufahrt, Terrasse, Zaun | 35 | 25 WT | |
| Bauherrenhaftpflicht und Bauleistungsversicherung | 3 | 10 WT | muss vor Baubeginn stehen |
| Bauhelfer bei der BG Bau anmelden | 3 | 5 WT | gesetzliche Pflicht bei Eigenleistung |

### 7.4 Lotsenkarten für das MVP

Zwölf Karten reichen für den ersten Test — sie decken die Phasen ab, in denen am meisten schiefgeht:

Bodenplatte und Fundamenterder · Kellerabdichtung und Drainage · Rohbau-Mauerwerk · Dachstuhl und Eindeckung · Fenstereinbau und Anschlussdichtung · Rohinstallation Elektro · Rohinstallation Sanitär und Heizung · Blower-Door-Vorabtest · Innenputz · Estrich und Belegreife · Fliesenarbeiten · Abnahme und Übergabe

Bei fünf davon steht `expert_recommended = true`: Bodenplatte, Kellerabdichtung, Rohinstallation vor Verkleidung, Blower-Door, Abnahme. Das entspricht genau den Terminen, die auch Baubegleiter üblicherweise setzen.

### 7.5 Zahlungsplan-Vorlage

| Rate | Auslöser | Vorgang | Anteil |
|---|---|---|---|
| 1 | Vertragsschluss, Baufreigabe | 3 | 10 % |
| 2 | Kellergeschoss fertig | 11 | 15 % |
| 3 | Rohbau fertig | 15 | 20 % |
| 4 | Gebäude dicht | 19 | 15 % |
| 5 | Rohinstallationen fertig | 23 | 10 % |
| 6 | Innenputz und Estrich fertig | 26 | 10 % |
| 7 | Fliesen und Maler fertig | 30 | 10 % |
| 8 | Abnahme | 37 | 5 % |
| — | Einbehalt Sicherheit | – | 5 % |

Summiert bewusst auf 90 % Abschläge plus 5 % Einbehalt.

---

## 8. Arbeitspakete für Claude Code

Reihenfolge folgt der neuen Positionierung: **erst Wissen und Entscheidungen, dann Termine, dann Dokumentation.**

### AP 1 — Fundament und Ablauf (Woche 1–2)

- Projekt-Setup, Datenbank, Migrationen, RLS-Grundgerüst, Auth
- Tabellen `project`, `project_member`, `trade`, `task`, `dependency`
- `packages/schedule`: Werktagsrechnung, Feiertagskalender je Bundesland, Forward Pass, Zyklusprüfung
- Seed-Migration mit Phasen und Ablaufvorlage aus Abschnitt 7

**Abnahme:** Onboarding mit fünf Fragen (Bauweise, Keller ja/nein, Baustart, Bundesland, GU oder Einzelgewerke) erzeugt einen vollständigen Plan mit 38 Vorgängen und plausiblen Terminen. Unit-Tests für Werktagsrechnung inklusive Jahreswechsel bestehen.

### AP 2 — Wissensschicht (Woche 3–4)

- `guide_card` mit Versionierung und Unveränderlichkeit nach Veröffentlichung
- Markdown-Import als Migration, zwölf Karten aus 7.4 redaktionell erstellt
- Lotsenkarten-Ansicht, Einblendung sieben Tage vor Vorgangsbeginn
- Checklisten mit Nutzerzustand, Rückmeldung „war das hilfreich"

**Abnahme:** Zu jedem der zwölf Vorgänge erscheint rechtzeitig die passende Karte mit Quellenangaben. Eine veröffentlichte Karte lässt sich per SQL nicht ändern.

### AP 3 — Entscheidungsassistent (Woche 5)

- `decision` mit Vorlagen aus 7.3, automatische Fristberechnung
- Neuberechnung bei jeder Terminänderung, Warnung bei Unterschreitung
- Entscheidungsansicht mit Entscheidungshilfe

**Abnahme:** Wird der Fliesenvorgang um zehn Werktage vorgezogen, rückt die Bemusterungsfrist mit und erzeugt eine Warnung. Liegt die Frist in der Vergangenheit, wird sie als überfällig geführt und als möglicher Verzugsgrund angeboten.

### AP 4 — Verschiebungen und Wochenbericht (Woche 6–7)

- Verschieben mit Fortpflanzungsvorschlag und Einzelentkopplung
- `schedule_change` mit Trigger und entzogenen Update-Rechten
- Kritischer Pfad und Puffer, im Klartext ausgegeben
- Wochenbericht als E-Mail und Cockpit-Ansicht

**Abnahme:** Ein verschobener Vorgang schlägt korrekt sieben Folgevorgänge vor, der Endtermin verschiebt sich um den erwarteten Wert, der Änderungseintrag ist per SQL nicht änderbar. Die Montagsmail enthält alle sechs Blöcke aus 3.11.

### AP 5 — Erfassung und Tagebuch (Woche 8–9)

- PWA mit Kamera, Offline-Queue, Hintergrundsynchronisation
- Tagebuch mit Versiegelung, Hash-Kette, DWD-Wetteranbindung
- Fotoaufträge aus den Lotsenkarten, Erfüllungsstatus je Vorgang

**Abnahme:** Im Flugmodus drei Fotos mit Notiz erfassen, Gerät online bringen, alle drei landen mit korrektem Aufnahmezeitpunkt. Ein manipulierter Eintrag bricht die Kettenprüfung.

### AP 6 — Abstimmung mit dem GU (Woche 10)

- Gast-Token, Scopes, Abstimmungsseite, Gegenvorschlag, mehrsprachig
- Bestätigungsgrad-Logik, Anzeige in allen Ansichten, Audit-Log

**Abnahme:** Abstimmungslink in fremdem Browser ohne Konto bestätigen, Status wechselt auf `mutual`. Ein Gegenvorschlag erzeugt `disputed` und einen Änderungseintrag mit Kanal `guest_link`.

### AP 7 — Frag den Lotsen (Woche 11)

- Serverseitiger Kontextaufbau, Systemprompt, Leitplanken aus 3.7
- Verlinkung der zugrunde liegenden Lotsenkarten in der Antwort
- Rate Limiting, Kostendeckel je Projekt

**Abnahme:** Eine Rechtsfrage wird mit Gesetzesstelle und Verweis auf anwaltliche Beratung beantwortet, nicht mit einer Bewertung. Eine Frage zu einem Fotomangel führt zum Hinweis auf einen Sachverständigen. Der Kontext enthält nachweislich keine Daten fremder Projekte.

### AP 8 — Mängel, Geld, Vertragsspiegel (Woche 12–13)

- Mängelverfolgung mit Fristen und Eskalationsstufen
- Zahlungsmeilensteine mit Freigabesperre, Darlehensabrufe, Bereitstellungszinsen
- Vertragsspiegel mit Prüfregeln und Hinweistexten

**Abnahme:** Eine Zahlung mit offenem wesentlichen Mangel lässt sich nicht freigeben und die Oberfläche nennt die Voraussetzung. Ein Zahlungsplan mit 95 % erzeugt den Hinweis auf § 650m Abs. 1 BGB.

### AP 9 — Bauakte (Woche 14)

- PDF-Erzeugung, Chronologie, Fotoanhang, Prüfsummen, vollständiger Datenexport

**Abnahme:** Export über drei Monate ergibt ein PDF, in dem abgestimmte, einseitige und widersprüchliche Angaben optisch unterscheidbar sind.

---

## 9. Offene Entscheidungen vor AP 1

1. **Preismodell.** Einmallizenz 249–399 € oder Abo 15–25 €/Monat. Die Wissensschicht spricht eher für ein Abo mit kostenloser Planungsphase — der Nutzen beginnt vor dem Baustart und die Karten werden laufend gepflegt.
2. **Redaktionsaufwand realistisch ansetzen.** Zwölf gute Lotsenkarten mit Quellenarbeit sind etwa zwei Wochen Arbeit. Vollausbau auf 38 Vorgänge plus Sanierungsvariante ist ein eigenes Projekt. Ohne fachlich belastbaren Inhalt trägt die Positionierung nicht — hier gegebenenfalls einen Bausachverständigen als fachlichen Prüfer einbinden, gegen Honorar oder Beteiligung.
3. **Verhältnis zu Baubegleitern.** Kanal, Partner oder Wettbewerb? Empfehlung: Partner. Dann braucht AP 1 bereits das Mandantenkonzept für `expert`.
4. **KI-Assistent im MVP oder danach.** Er ist ein starkes Verkaufsargument, aber ohne die Wissensschicht darunter halluziniert er. Deshalb steht er als AP 7 hinter der Redaktion, nicht davor.
5. **Grundriss-Verortung.** Hochgeladener Plan als Bild mit Koordinaten reicht für Stufe 1.

---

## 10. Vor der ersten Zeile Code

Acht bis zehn Gespräche mit Menschen, die gerade bauen oder gerade fertig sind, plus zwei bis drei mit Bausachverständigen. Die entscheidende Frage lautet nicht „wäre das nützlich", sondern:

> „Zeig mir, wie du heute den Überblick behältst."

Und für die neue Positionierung zusätzlich:

> „Was hättest du gern früher gewusst?"

Die Antworten auf die zweite Frage sind das Inhaltsverzeichnis der Wissensschicht.
