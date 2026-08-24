/**
 * Nachweise für die Datenbank-Invarianten aus Abschnitt 4.1 der Spezifikation.
 *
 * Sie werden bewusst gegen die Datenbank geprüft, nicht gegen den
 * Anwendungscode: Eine Invariante, die nur der Anwendungscode einhält, ist
 * keine Invariante.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withAdminTx, withUserTx } from './client.js';
import { createProjectFixture, truncateAll, type ProjectFixture } from './test-fixtures.js';

let fixture: ProjectFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await createProjectFixture('inv');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

const asOwner = <T>(run: Parameters<typeof withUserTx<T>>[1], options = {}): Promise<T> =>
  withUserTx({ sub: fixture.ownerUserId }, run, options);

describe('(1) schedule_change ist append-only', () => {
  it('lässt sich als Anwendungsrolle nicht ändern', async () => {
    await expect(
      asOwner(async (tx) => tx.query('update schedule_change set reason_text = $1', ['manipuliert'])),
    ).rejects.toThrow();
  });

  it('lässt sich als Anwendungsrolle nicht löschen', async () => {
    await expect(
      asOwner(async (tx) => tx.query('delete from schedule_change')),
    ).rejects.toThrow();
  });

  it('lässt sich auch mit den Rechten des Eigentümers nicht ändern', async () => {
    // Zweite Sperre: der Trigger greift unabhängig von den vergebenen Rechten.
    await expect(
      withAdminTx(async (tx) => tx.query("update schedule_change set reason_text = 'manipuliert'")),
    ).rejects.toThrow(/append-only/i);
  });

  it('nimmt neue Einträge an', async () => {
    const before = await countChanges();
    await asOwner(async (tx) =>
      tx.query(
        `insert into schedule_change (project_id, task_id, field, new_value)
         values ($1, $2, 'probe', '"wert"'::jsonb)`,
        [fixture.projectId, fixture.tileTaskId],
      ),
    );
    expect(await countChanges()).toBe(before + 1);
  });
});

describe('(4) Jede Terminänderung erzeugt einen Eintrag', () => {
  it('protokolliert das Anlegen eines Vorgangs', async () => {
    const entries = await withAdminTx(async (tx) =>
      (
        await tx.query<{ field: string; reason_code: string }>(
          `select field, reason_code from schedule_change
           where task_id = $1 and field = 'task_created'`,
          [fixture.tileTaskId],
        )
      ).rows,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason_code).toBe('planinitialisierung');
  });

  it('protokolliert eine Terminverschiebung mit altem und neuem Wert', async () => {
    await asOwner(
      async (tx) =>
        tx.query("update task set current_start = date '2026-09-16' where id = $1", [
          fixture.tileTaskId,
        ]),
      { changeReason: 'lieferzeit', changeReasonText: 'Fliesen kommen später' },
    );

    const entry = await withAdminTx(async (tx) =>
      (
        await tx.query<{
          old_value: string;
          new_value: string;
          reason_code: string;
          reason_text: string;
          actor_role: string;
          actor_channel: string;
        }>(
          `select old_value, new_value, reason_code, reason_text, actor_role, actor_channel
           from schedule_change
           where task_id = $1 and field = 'current_start'
           order by created_at desc limit 1`,
          [fixture.tileTaskId],
        )
      ).rows[0],
    );

    expect(entry).toBeDefined();
    expect(entry!.old_value).toBe('2026-09-09');
    expect(entry!.new_value).toBe('2026-09-16');
    expect(entry!.reason_code).toBe('lieferzeit');
    expect(entry!.reason_text).toBe('Fliesen kommen später');
    expect(entry!.actor_role).toBe('owner');
    expect(entry!.actor_channel).toBe('app');
  });

  it('hält den Kanal fest, über den die Änderung kam', async () => {
    await withUserTx(
      { sub: fixture.ownerUserId },
      async (tx) =>
        tx.query("update task set current_end = date '2026-09-25' where id = $1", [
          fixture.tileTaskId,
        ]),
      { actorChannel: 'guest_link' },
    );

    const channel = await withAdminTx(async (tx) =>
      (
        await tx.query<{ actor_channel: string }>(
          `select actor_channel from schedule_change
           where task_id = $1 and field = 'current_end'
           order by created_at desc limit 1`,
          [fixture.tileTaskId],
        )
      ).rows[0]!.actor_channel,
    );
    expect(channel).toBe('guest_link');
  });

  it('protokolliert Statuswechsel und Dauerkorrekturen', async () => {
    await asOwner(async (tx) =>
      tx.query("update task set status = 'laeuft', duration_days = 9 where id = $1", [
        fixture.tileTaskId,
      ]),
    );
    const fields = await withAdminTx(async (tx) =>
      (
        await tx.query<{ field: string }>(
          `select field from schedule_change where task_id = $1 and field in ('status','duration_days')`,
          [fixture.tileTaskId],
        )
      ).rows.map((row) => row.field),
    );
    expect(new Set(fields)).toEqual(new Set(['status', 'duration_days']));
  });

  it('schreibt nichts, wenn sich nichts ändert', async () => {
    const before = await countChanges();
    await asOwner(async (tx) =>
      tx.query('update task set name = name where id = $1', [fixture.tileTaskId]),
    );
    expect(await countChanges()).toBe(before);
  });
});

describe('(3) Die Baseline ist nach dem Sperren unveränderlich', () => {
  it('lässt Baseline-Termine vor dem Sperren zu', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query("update task set baseline_start = date '2026-09-09' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it('verweigert die Änderung nach dem Sperren', async () => {
    await withAdminTx(async (tx) =>
      tx.query('update project set baseline_locked_at = now() where id = $1', [fixture.projectId]),
    );

    await expect(
      asOwner(async (tx) =>
        tx.query("update task set baseline_start = date '2026-10-01' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).rejects.toThrow(/gesperrt/i);
  });

  it('lässt andere Felder weiterhin zu', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query("update task set current_start = date '2026-09-22' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).resolves.toBeDefined();

    await withAdminTx(async (tx) =>
      tx.query('update project set baseline_locked_at = null where id = $1', [fixture.projectId]),
    );
  });
});

describe('(5) Abhängigkeiten dürfen keinen Zyklus schließen', () => {
  it('verweigert die Rückkante', async () => {
    // fliesen → maler besteht bereits; maler → fliesen schlösse den Kreis.
    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
          [fixture.projectId, fixture.paintTaskId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow(/Zyklus/i);
  });

  it('verweigert den Selbstbezug', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $2)',
          [fixture.projectId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('verweigert einen Zyklus über drei Ecken', async () => {
    const thirdId = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into task (project_id, name, phase_key, duration_days)
           values ($1, 'Bodenbeläge', 'endausbau', 5) returning id`,
          [fixture.projectId],
        )
      ).rows[0]!.id,
    );

    await asOwner(async (tx) =>
      tx.query(
        'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
        [fixture.projectId, fixture.paintTaskId, thirdId],
      ),
    );

    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
          [fixture.projectId, thirdId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow(/Zyklus/i);
  });
});

describe('(6) Eine veröffentlichte Lotsenkarte ist unveränderlich', () => {
  /**
   * Die Abnahmebedingung von AP 2 lautet wörtlich: „Eine veröffentlichte Karte
   * lässt sich per SQL nicht ändern." Deshalb wird hier mit den Rechten des
   * Eigentümers geprüft und nicht als Anwendungsrolle — die hat ohnehin kein
   * UPDATE auf `guide_card`. Was die Sperre wert ist, entscheidet sich dort,
   * wo jemand alle Rechte hat.
   */
  const einKartenSchluessel = 'estrich';

  it('lässt sich auch mit den Rechten des Eigentümers nicht ändern', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query('update guide_card set title = $1 where key = $2', [
          'Anders',
          einKartenSchluessel,
        ]),
      ),
    ).rejects.toThrow(/unveränderlich/i);
  });

  it('lässt auch eine Änderung am Inhalt nicht zu', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query('update guide_card set watch_for = $1 where key = $2', [
          '[]',
          einKartenSchluessel,
        ]),
      ),
    ).rejects.toThrow(/unveränderlich/i);
  });

  it('lässt sich nicht löschen', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query('delete from guide_card where key = $1', [einKartenSchluessel]),
      ),
    ).rejects.toThrow(/nicht gelöscht/i);
  });

  it('lässt sich genau einmal ablösen', async () => {
    // Der ganze Nachweis läuft in einer Transaktion, die am Ende absichtlich
    // zurückgerollt wird.
    //
    // Der Grund ist die Invariante selbst: Eine abgelöste Karte lässt sich
    // nicht wieder lösen, auch nicht zum Aufräumen. Ein Test, der den
    // Redaktionsinhalt dauerhaft umhängt, wäre deshalb nicht wiederholbar —
    // und der zweite Lauf prüfte etwas anderes als der erste.
    class Zurueckrollen extends Error {}

    const gesehen: { abgeloestMit: string | null; zweiterVersuch: string } = {
      abgeloestMit: null,
      zweiterVersuch: '',
    };

    await expect(
      withAdminTx(async (tx) => {
        const neu = await tx.query<{ id: string }>(
          `insert into guide_card (key, version, phase_key, title, whats_happening)
           values ($1, 2, 'ausbau', 'Estrich und Belegreife', 'Zweite Fassung.')
           returning id`,
          [einKartenSchluessel],
        );
        const nachfolger = neu.rows[0]!.id;

        await tx.query('update guide_card set superseded_by = $1 where key = $2 and version = 1', [
          nachfolger,
          einKartenSchluessel,
        ]);

        const gelesen = await tx.query<{ superseded_by: string | null }>(
          'select superseded_by from guide_card where key = $1 and version = 1',
          [einKartenSchluessel],
        );
        gesehen.abgeloestMit =
          gelesen.rows[0]!.superseded_by === nachfolger ? 'der neuen Fassung' : 'etwas anderem';

        // Eine bereits abgelöste Karte bleibt, wie sie ist. Sonst ließe sich
        // die Kette umhängen, und die Frage „welchen Rat bekam der Bauherr
        // damals" wäre wieder offen.
        try {
          await tx.query(
            'update guide_card set superseded_by = null where key = $1 and version = 1',
            [einKartenSchluessel],
          );
          gesehen.zweiterVersuch = 'ging durch';
        } catch (cause) {
          gesehen.zweiterVersuch = cause instanceof Error ? cause.message : String(cause);
        }

        throw new Zurueckrollen('Absicht: Der Nachweis hinterlässt nichts.');
      }),
    ).rejects.toBeInstanceOf(Zurueckrollen);

    expect(gesehen.abgeloestMit).toBe('der neuen Fassung');
    expect(gesehen.zweiterVersuch).toMatch(/bereits abgelöst/i);
  });

  it('lässt eine unveröffentlichte Karte in Ruhe ändern', async () => {
    await withAdminTx(async (tx) => {
      await tx.query(
        `insert into guide_card (key, version, phase_key, title, whats_happening)
         values ('entwurf', 1, 'rohbau', 'Entwurf', 'Noch nicht veröffentlicht.')`,
      );
      await tx.query("update guide_card set title = 'Immer noch Entwurf' where key = 'entwurf'");
      await tx.query("delete from guide_card where key = 'entwurf'");
    });
  });

  it('verlangt zu einer empfohlenen Fachprüfung eine Begründung', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into guide_card (key, version, phase_key, title, whats_happening, expert_recommended)
           values ('ohne-grund', 1, 'rohbau', 'Ohne Grund', 'Text.', true)`,
        ),
      ),
    ).rejects.toThrow(/guide_card_expert_reason/);
  });
});

describe('Die Wissensschicht hängt an den Vorgängen', () => {
  it('ordnet jeder Karte höchstens einen Vorgang der Vorlage zu', async () => {
    // Zwei Karten am selben Vorlagenvorgang wären keine Datenfrage, sondern
    // eine Redaktionsfrage — und sie machten die Zuordnung beim Anlegen eines
    // Projekts vom Zufall abhängig. Der Generator lehnt das ab; hier steht die
    // Gegenprobe an den Daten, die tatsächlich eingespielt wurden.
    const doppelt = await withAdminTx(async (tx) => {
      const result = await tx.query<{ code: string; anzahl: string }>(
        `select code, count(*)::text as anzahl
           from guide_card c, unnest(c.task_codes) as code
          where c.published_at is not null and c.superseded_by is null
          group by code having count(*) > 1`,
      );
      return result.rows;
    });
    expect(doppelt).toEqual([]);
  });

  it('nennt zu jeder Karte mindestens eine Quelle', async () => {
    // Keine Aussage ohne Quelle (Abschnitt 6.3). An dieser Stelle steht die
    // Glaubwürdigkeit des ganzen Produkts.
    const ohneQuelle = await withAdminTx(async (tx) => {
      const result = await tx.query<{ key: string }>(
        "select key from guide_card where jsonb_array_length(sources) = 0",
      );
      return result.rows.map((row) => row.key);
    });
    expect(ohneQuelle).toEqual([]);
  });

  it('deckt die fünf Prüftermine aus Abschnitt 7.4 ab', async () => {
    // Bodenplatte, Kellerabdichtung, Rohinstallation vor Verkleidung,
    // Blower-Door, Abnahme. Die Rohinstallation steht als zwei Karten da —
    // Elektro und Sanitär —, gemeint ist ein Termin, an dem beides offen liegt.
    const empfohlen = await withAdminTx(async (tx) => {
      const result = await tx.query<{ key: string }>(
        'select key from guide_card where expert_recommended order by key',
      );
      return result.rows.map((row) => row.key);
    });
    expect(empfohlen).toContain('bodenplatte');
    expect(empfohlen).toContain('kellerabdichtung');
    expect(empfohlen).toContain('blower_door');
    expect(empfohlen).toContain('abnahme');
    expect(
      empfohlen.some((key) => key.startsWith('rohinstallation')),
      'die Rohinstallation vor der Verkleidung',
    ).toBe(true);
  });
});

describe('Eine Entscheidung gehört dem Bauherrn', () => {
  /**
   * Die Stelle, an der es interessant wird: Der Generalunternehmer verschiebt
   * einen Vorgang, und die Anwendung rechnet die Entscheidungsfristen neu. Er
   * darf die Entscheidung aber nicht pflegen. Ohne die Trennung stünde die
   * Anwendung vor der Wahl, entweder veraltete Fristen anzuzeigen oder dem GU
   * Schreibrechte auf Entscheidungen zu geben.
   */
  async function anlegen(): Promise<string> {
    return withAdminTx(async (tx) => {
      const result = await tx.query<{ id: string }>(
        `insert into decision
           (project_id, title, blocks_task_id, lead_time_days, due_date)
         values ($1, 'Fliesen: Auswahl und Verlegemuster', $2, 40, date '2026-07-15')
         returning id`,
        [fixture.projectId, fixture.tileTaskId],
      );
      return result.rows[0]!.id;
    });
  }

  async function dueDateOf(id: string): Promise<string | null> {
    return withAdminTx(async (tx) => {
      const result = await tx.query<{ due_date: string | null }>(
        'select due_date::text from decision where id = $1',
        [id],
      );
      return result.rows[0]!.due_date;
    });
  }

  const alsRolle = <T>(
    role: 'contractor' | 'viewer' | 'expert',
    run: Parameters<typeof withUserTx<T>>[1],
  ): Promise<T> => withUserTx({ sub: fixture.actors[role].userId }, run);

  it('lässt den Generalunternehmer die Frist nachziehen', async () => {
    const id = await anlegen();
    await alsRolle('contractor', async (tx) =>
      tx.query('update decision set due_date = $2::date where id = $1', [id, '2026-07-29']),
    );

    expect(await dueDateOf(id)).toBe('2026-07-29');
  });

  it('lässt ihn den Zustand aber nicht ändern', async () => {
    const id = await anlegen();
    await expect(
      alsRolle('contractor', async (tx) =>
        tx.query("update decision set status = 'entschieden' where id = $1", [id]),
      ),
    ).rejects.toThrow(/pflegt der Bauherr/i);
  });

  it('lässt ihn auch die Notiz nicht ändern', async () => {
    const id = await anlegen();
    await expect(
      alsRolle('contractor', async (tx) =>
        tx.query("update decision set decided_note = 'in meinem Namen' where id = $1", [id]),
      ),
    ).rejects.toThrow(/pflegt der Bauherr/i);
  });

  it('lässt den Mitleser überhaupt nichts ändern', async () => {
    const id = await anlegen();
    const vorher = await dueDateOf(id);

    // Kein Fehler, sondern kein Treffer: Die Policy filtert die Zeile aus der
    // Änderungsmenge, statt sie abzulehnen. Für den Mitleser ist das Ergebnis
    // dasselbe, und die API macht daraus einen 404 — ob es diese Entscheidung
    // gibt, geht ihn in dieser Rolle nichts an.
    const betroffen = await alsRolle('viewer', async (tx) => {
      const result = await tx.query('update decision set due_date = $2::date where id = $1', [
        id,
        '2026-07-01',
      ]);
      return result.rowCount;
    });

    expect(betroffen).toBe(0);
    expect(await dueDateOf(id)).toBe(vorher);
  });

  it('stempelt das Datum, sobald die Entscheidung getroffen ist', async () => {
    const id = await anlegen();
    await asOwner(async (tx) =>
      tx.query("update decision set status = 'entschieden' where id = $1", [id]),
    );

    const nachher = await withAdminTx(async (tx) => {
      const result = await tx.query<{ decided_at: string | null }>(
        'select decided_at from decision where id = $1',
        [id],
      );
      return result.rows[0]!.decided_at;
    });
    expect(nachher).not.toBeNull();
  });

  it('räumt das Datum wieder ab, wenn der Zustand zurückgenommen wird', async () => {
    const id = await anlegen();
    await asOwner(async (tx) =>
      tx.query("update decision set status = 'beauftragt' where id = $1", [id]),
    );
    await asOwner(async (tx) =>
      tx.query("update decision set status = 'offen' where id = $1", [id]),
    );

    const nachher = await withAdminTx(async (tx) => {
      const result = await tx.query<{ decided_at: string | null }>(
        'select decided_at from decision where id = $1',
        [id],
      );
      return result.rows[0]!.decided_at;
    });
    // Sonst stünde da „entschieden am 3. Juli" bei einer Entscheidung, die
    // wieder offen ist — und das ist keine Auskunft, sondern eine falsche.
    expect(nachher).toBeNull();
  });

  it('kennt die vierzehn Vorlagen aus Abschnitt 7.3', async () => {
    const vorlagen = await withAdminTx(async (tx) => {
      const result = await tx.query<{ anzahl: string; ohne_hilfe: string }>(
        `select count(*)::text as anzahl,
                count(*) filter (where help = '{}'::jsonb)::text as ohne_hilfe
           from decision_template`,
      );
      return result.rows[0]!;
    });
    expect(Number(vorlagen.anzahl)).toBe(14);
    // Eine Frist ohne Entscheidungshilfe ist eine Aufforderung ohne Auskunft.
    expect(Number(vorlagen.ohne_hilfe)).toBe(0);
  });
});

describe('Prüfregeln des Schemas', () => {
  it('erzwingt bei Meilensteinen die Dauer 0', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into task (project_id, name, phase_key, is_milestone, duration_days)
           values ($1, 'Falscher Meilenstein', 'abnahme', true, 3)`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('erzwingt bei Wartezeiten Kalendertage', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into task (project_id, name, phase_key, is_wait, duration_unit, duration_days)
           values ($1, 'Falsche Wartezeit', 'ausbau', true, 'werktage', 35)`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('erzwingt bei Einzelgewerken die Zuordnung eines Gewerks', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into project_member (project_id, role, display_name) values ($1, 'trade', 'Ohne Gewerk')`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lässt eine Mandantenzuordnung nur bei der Rolle expert zu', async () => {
    const orgId = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>('select id from expert_org limit 1')
      ).rows[0]!.id,
    );
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into project_member (project_id, role, display_name, expert_org_id)
           values ($1, 'viewer', 'Falsche Rolle', $2)`,
          [fixture.projectId, orgId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('(2) Ein versiegelter Tagebucheintrag ist unveränderlich', () => {
  /**
   * Invariante 2 aus Abschnitt 4.1: „nach `locked_at` sind nur `retracted_at`
   * und `retraction_reason` änderbar."
   *
   * Der Rest des Tagebuchs — Kette, Wetter, Fotoaufträge — steht in
   * `apps/api/src/diary.test.ts`, wo er über die Anwendung geprüft wird. Hier
   * geht es nur um die Sperre selbst, und zwar auf der Ebene, auf der sie
   * gelten muss: gegen jeden, der SQL sprechen kann.
   */
  async function eintragAnlegen(alterStunden: number): Promise<string> {
    return withAdminTx(async (tx) => {
      const result = await tx.query<{ id: string }>(
        `insert into diary_entry
           (project_id, entry_date, body, author_member_id, author_role, created_at)
         values ($1, date '2026-05-04', 'Estrich eingebracht.', $2, 'owner',
                 now() - ($3 || ' hours')::interval)
         returning id`,
        [fixture.projectId, fixture.actors.owner.memberId, String(alterStunden)],
      );
      return result.rows[0]!.id;
    });
  }

  it('versiegelt erst nach 24 Stunden', async () => {
    const frisch = await eintragAnlegen(2);
    const reif = await eintragAnlegen(30);
    await asOwner(async (tx) => tx.query('select mbl.seal_due_diary_entries($1)', [fixture.projectId]));

    const zustand = await withAdminTx(async (tx) =>
      tx.query<{ id: string; locked: boolean }>(
        'select id, locked_at is not null as locked from diary_entry where id = any($1::uuid[])',
        [[frisch, reif]],
      ),
    );
    const nach = new Map(zustand.rows.map((row) => [row.id, row.locked]));
    expect(nach.get(frisch)).toBe(false);
    expect(nach.get(reif)).toBe(true);
  });

  it('lässt den Text danach nicht mehr ändern, auch nicht dem Eigentümer', async () => {
    const id = await eintragAnlegen(30);
    await asOwner(async (tx) => tx.query('select mbl.seal_due_diary_entries($1)', [fixture.projectId]));

    await expect(
      withAdminTx(async (tx) =>
        tx.query('update diary_entry set body = $2 where id = $1', [id, 'Doch nicht.']),
      ),
    ).rejects.toThrow(/versiegelt/i);
  });

  it('lässt das Zurückziehen zu — der Eintrag bleibt stehen', async () => {
    const id = await eintragAnlegen(30);
    await asOwner(async (tx) => tx.query('select mbl.seal_due_diary_entries($1)', [fixture.projectId]));

    await asOwner(async (tx) =>
      tx.query(
        `update diary_entry set retracted_at = now(), retraction_reason = $2 where id = $1`,
        [id, 'Falscher Vorgang.'],
      ),
    );

    const zeile = await withAdminTx(async (tx) =>
      tx.query<{ retraction_reason: string | null; body: string }>(
        'select retraction_reason, body from diary_entry where id = $1',
        [id],
      ),
    );
    expect(zeile.rows[0]!.retraction_reason).toBe('Falscher Vorgang.');
    expect(zeile.rows[0]!.body).toBe('Estrich eingebracht.');
  });

  it('kennt kein Löschen — das Recht dazu ist gar nicht vergeben', async () => {
    const id = await eintragAnlegen(2);
    await expect(
      asOwner(async (tx) => tx.query('delete from diary_entry where id = $1', [id])),
    ).rejects.toThrow();
  });

  it('verlangt zu jedem Zurückziehen einen Grund', async () => {
    const id = await eintragAnlegen(2);
    await expect(
      withAdminTx(async (tx) =>
        tx.query('update diary_entry set retracted_at = now() where id = $1', [id]),
      ),
    ).rejects.toThrow();
  });
});

async function countChanges(): Promise<number> {
  return withAdminTx(
    async (tx) =>
      Number(
        (await tx.query<{ count: string }>('select count(*)::text as count from schedule_change'))
          .rows[0]!.count,
      ),
  );
}
