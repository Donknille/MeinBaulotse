-- ---------------------------------------------------------------------------
-- MeinBaulotse — Einladungen einlösen
--
-- Das Recht `member.invite` steht seit 0003 in der Rechtematrix, die Policy
-- seit 0002. Was fehlte, war der Weg vom Eintrag zur Person: Ein Bauherr trägt
-- seinen Generalunternehmer mit E-Mail-Adresse ein, und wenn der sich das
-- erste Mal anmeldet, muss aus dem Eintrag seine Mitgliedschaft werden.
--
-- Das kann keine Policy leisten, und zwar aus einem grundsätzlichen Grund:
-- Solange `user_id` leer ist, ist der Eingeladene für die RLS **kein**
-- Mitglied — er sieht die Zeile nicht, die ihn betrifft, und kann sie
-- deshalb auch nicht ändern. Es braucht genau einen Schritt, der von außen
-- hineinreicht, und der steht hier.
--
-- Er ist so eng gefasst, dass er kein Schlüssel ist: Er verbindet
-- ausschließlich den **gerade angemeldeten** Nutzer mit Zeilen, die
-- **seine eigene** Adresse tragen und noch niemandem gehören. Wer eine fremde
-- Einladung einlösen will, müsste die fremde Adresse besitzen — und dann hat
-- er ohnehin schon gewonnen.
-- ---------------------------------------------------------------------------

create or replace function mbl.claim_invitations()
returns int
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  meine_kennung uuid := auth.uid();
  meine_adresse text;
  getroffen int;
begin
  if meine_kennung is null then
    return 0;
  end if;

  select lower(u.email) into meine_adresse from auth.users u where u.id = meine_kennung;
  if meine_adresse is null or meine_adresse = '' then
    return 0;
  end if;

  update project_member m
     set user_id = meine_kennung,
         accepted_at = coalesce(m.accepted_at, now())
   where m.user_id is null
     and m.revoked_at is null
     and lower(m.email) = meine_adresse;

  get diagnostics getroffen = row_count;
  return getroffen;
end
$$;

comment on function mbl.claim_invitations() is
  'Verbindet den angemeldeten Nutzer mit Einladungen an seine Adresse. Der '
  'einzige Schritt im Produkt, der von außen in ein Projekt hineinreicht — '
  'und er reicht nur zur eigenen Adresse.';

-- ---------------------------------------------------------------------------
-- Zwei Zeilen für dieselbe Adresse im selben Projekt ergäben zwei
-- Mitgliedschaften mit womöglich verschiedenen Rollen. Welche dann gilt,
-- entschiede die Sortierung — also der Zufall.
-- ---------------------------------------------------------------------------

create unique index project_member_email_unique
  on project_member (project_id, lower(email))
  where email is not null and revoked_at is null;

grant execute on all functions in schema mbl to anon, authenticated;
