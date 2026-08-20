/**
 * Beteiligte — einladen, Rolle ändern, Zugang entziehen.
 *
 * Hier wird die Rolle **wirklich** geändert; die Ansicht in der Kopfzeile ist
 * nur eine Vorschau. Damit das niemand verwechselt, sagt die Seite es einmal
 * ausdrücklich.
 *
 * Zu jeder Rolle steht, was sie darf — aus derselben Tabelle, aus der auch die
 * Datenbank ihre Entscheidung nimmt. Eine Rechtematrix, die in der Oberfläche
 * noch einmal abgetippt wird, ist ein Versprechen, das irgendwann nicht mehr
 * gilt.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import {
  MEMBER_ROLES,
  PERMISSION_LABEL,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type MemberRole,
  type ProjectMemberDto,
} from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Field, Pill, Select, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useRoleMatrix } from '../lib/role-view';
import { useProject } from './ProjectLayout';

/** `owner` steht fest und wird beim Anlegen vergeben — siehe API. */
const INVITABLE = MEMBER_ROLES.filter((role) => role !== 'owner');

export function Members() {
  const { projectId, can } = useProject();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const members = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => api.members(projectId),
  });
  const trades = useQuery({ queryKey: ['trades'], queryFn: () => api.trades(), staleTime: Infinity });
  const matrix = useRoleMatrix();

  const mayInvite = can('member.invite');

  function handleError(cause: unknown): void {
    setError(
      cause instanceof ApiError
        ? [cause.message, cause.hint].filter(Boolean).join(' ')
        : 'Das hat nicht geklappt. Versuch es bitte noch einmal.',
    );
  }

  async function refresh(): Promise<void> {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ['members', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['schedule', projectId] });
  }

  const invite = useMutation({
    mutationFn: (input: Parameters<typeof api.inviteMember>[1]) =>
      api.inviteMember(projectId, input),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
    onError: handleError,
  });

  const change = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: MemberRole; tradeId?: string }) =>
      api.updateMember(projectId, memberId, {
        role,
        ...(role === 'trade' ? { tradeId: trades.data?.trades[0]?.id } : { tradeId: null }),
      }),
    onSuccess: refresh,
    onError: handleError,
  });

  const revoke = useMutation({
    mutationFn: (memberId: string) => api.revokeMember(projectId, memberId),
    onSuccess: refresh,
    onError: handleError,
  });

  const active = (members.data?.members ?? []).filter((member) => member.revokedAt === null);
  const revoked = (members.data?.members ?? []).filter((member) => member.revokedAt !== null);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Beteiligte</h1>
          <p className="max-w-[34rem] text-body text-steel">
            Wer hier steht, sieht dein Projekt. Die Rolle entscheidet, wie viel davon und was er
            damit tun darf.
          </p>
        </div>
        {mayInvite ? (
          <Button variant="primary" onClick={() => setOpen((value) => !value)}>
            <UserPlus size={16} aria-hidden />
            Einladen
          </Button>
        ) : null}
      </header>

      {error !== null ? (
        <Card tone="muted">
          <p className="text-body text-alarm-red">{error}</p>
        </Card>
      ) : null}

      {open && mayInvite ? (
        <InviteForm
          trades={trades.data?.trades ?? []}
          busy={invite.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={(input) => invite.mutate(input)}
        />
      ) : null}

      {members.isPending ? (
        <p className="text-body text-steel">Wird geladen.</p>
      ) : active.length === 0 ? (
        <EmptyState text="Außer dir ist noch niemand dabei. Lade deinen GU ein — er trägt seine Termine dann selbst ein." />
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((member) => (
            <li key={member.id}>
              <MemberCard
                member={member}
                permissions={matrix.data?.matrix[member.role] ?? []}
                editable={mayInvite && !member.isSelf && member.role !== 'owner'}
                busy={change.isPending || revoke.isPending}
                onRole={(role) => change.mutate({ memberId: member.id, role })}
                onRevoke={() => revoke.mutate(member.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-subheading font-medium text-charcoal">Entzogen</h2>
          <p className="text-body text-steel">
            Diese Zugänge sind gesperrt. Die Einträge bleiben stehen — wer wann etwas eingetragen
            hat, gehört zur Bauakte und wird nicht gelöscht.
          </p>
          <ul className="flex flex-col gap-2">
            {revoked.map((member) => (
              <li key={member.id}>
                <Card className="flex items-center justify-between gap-4 opacity-60">
                  <span className="text-body text-charcoal">
                    {member.displayName ?? member.email ?? 'Ohne Namen'}
                  </span>
                  <Pill>{ROLE_LABEL[member.role]}</Pill>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card tone="muted">
        <h2 className="text-subheading font-medium text-charcoal">Was sieht wer?</h2>
        <p className="mt-1 text-body text-steel">
          Die Rolle hier zu ändern, ändert sie für die betroffene Person. Wenn du nur wissen
          willst, wie die Anwendung für jemanden aussieht, wechsle oben rechts die Ansicht — das
          ändert an den Daten nichts.
        </p>
      </Card>
    </>
  );
}

function MemberCard({
  member,
  permissions,
  editable,
  busy,
  onRole,
  onRevoke,
}: {
  member: ProjectMemberDto;
  permissions: readonly string[];
  editable: boolean;
  busy: boolean;
  onRole: (role: MemberRole) => void;
  onRevoke: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-body-lg font-medium text-charcoal">
            {member.displayName ?? member.email ?? 'Ohne Namen'}
            {member.isSelf ? <Pill>das bist du</Pill> : null}
            {member.acceptedAt === null && !member.isSelf ? (
              <Pill tone="amber">Einladung offen</Pill>
            ) : null}
          </span>
          <span className="text-caption text-steel">
            {[member.company, member.email, member.tradeName].filter(Boolean).join(' · ') ||
              'Keine weiteren Angaben'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {editable ? (
            <Select
              value={member.role}
              disabled={busy}
              aria-label={`Rolle von ${member.displayName ?? 'diesem Beteiligten'}`}
              onChange={(event) => onRole(event.target.value as MemberRole)}
              density="compact"
            >
              {INVITABLE.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          ) : (
            <Pill tone={member.role === 'owner' ? 'blue' : 'neutral'}>
              {ROLE_LABEL[member.role]}
            </Pill>
          )}

          {editable ? (
            <Button variant="danger" size="sm" onClick={onRevoke} disabled={busy}>
              <Trash2 size={15} aria-hidden />
              <span className="sr-only">Zugang entziehen</span>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-caption text-steel">{ROLE_DESCRIPTION[member.role]}</p>

      {permissions.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {permissions.map((permission) => (
            <li key={permission}>
              <Pill>{PERMISSION_LABEL[permission] ?? permission}</Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function InviteForm({
  trades,
  busy,
  onCancel,
  onSubmit,
}: {
  trades: readonly { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: Parameters<typeof api.inviteMember>[1]) => void;
}) {
  const [role, setRole] = useState<MemberRole>('contractor');
  const [displayName, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [tradeId, setTradeId] = useState(trades[0]?.id ?? '');

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-subheading font-medium text-charcoal">Wen lädst du ein?</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rolle" hint={ROLE_DESCRIPTION[role]}>
          <Select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
            {INVITABLE.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>

        {role === 'trade' ? (
          <Field
            label="Gewerk"
            hint="Bestimmt, welchen Ausschnitt des Plans dieser Beteiligte sieht."
          >
            <Select value={tradeId} onChange={(event) => setTradeId(event.target.value)}>
              {trades.map((trade) => (
                <option key={trade.id} value={trade.id}>
                  {trade.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Firma" hint="Optional.">
            <TextInput value={company} onChange={(event) => setCompany(event.target.value)} />
          </Field>
        )}

        <Field label="Name">
          <TextInput
            value={displayName}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bauleiter Schmitt"
          />
        </Field>

        <Field label="E-Mail" hint="Optional. Ohne Adresse legst du nur den Eintrag an.">
          <TextInput
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="field"
          disabled={busy || displayName.trim().length < 2}
          onClick={() =>
            onSubmit({
              role,
              displayName: displayName.trim(),
              ...(company.trim() === '' ? {} : { company: company.trim() }),
              ...(email.trim() === '' ? {} : { email: email.trim() }),
              ...(role === 'trade' ? { tradeId } : {}),
            })
          }
        >
          {busy ? 'Wird angelegt …' : 'Beteiligten anlegen'}
        </Button>
        <Button variant="ghost" size="field" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}
