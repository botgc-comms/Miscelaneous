import {
  canHost,
  requireThat,
  text,
  rosterEligible,
  notify,
  teamManagers,
  type State,
  type Fixture,
  type Member,
  type Action,
} from './model';

export type DeskField = {
  id: string;
  label: string;
  options: string[];
  multiple: boolean;
};
export const deskFieldsKey = (fields: DeskField[]) =>
  JSON.stringify(
    fields.map((f) => ({
      id: f.id,
      label: f.label,
      multiple: f.multiple,
      options: f.options,
    })),
  );
export type DeskEntry = {
  playerId: string;
  status: 'expected' | 'arrived' | 'absent';
  answers: Record<string, string[]>;
  note: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type RegistrationDesk = { fields: DeskField[]; entries: DeskEntry[] };
export type DeskSuggestion = {
  kind: 'reserve' | 'split' | 'group';
  playerId?: string;
  pairId: string;
  targetId: string;
  label: string;
  detail: string;
  siblings?: boolean;
};
export const deskKey = (s: State, f: Fixture) =>
  JSON.stringify([
    f.pairs,
    f.slots,
    Object.entries(f.scores).map(([k, v]) => [k, v.version]),
    (f.desk?.entries || []).map((e) => [e.playerId, e.version]),
    s.reserves?.filter((r) => r.fixtureId === f.id),
    s.availability?.filter(
      (a) =>
        a.fixtureId === f.id &&
        deskPlayers(s, f).some((p) => p.id === a.playerId),
    ),
  ]);
export const pairHasScores = (f: Fixture, id: string) =>
  Object.keys(f.scores).some((k) => k.startsWith(id + ':'));
export function deskPlayers(s: State, f: Fixture) {
  const ids = new Set([
    ...f.pairs.flatMap((p) => p.players),
    ...(s.reserves || [])
      .filter((r) => r.fixtureId === f.id)
      .map((r) => r.playerId),
    ...(f.desk?.entries || []).map((e) => e.playerId),
  ]);
  return s.players
    .filter((p) => ids.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function deskSuggestions(s: State, f: Fixture): DeskSuggestion[] {
  const suggestions: DeskSuggestion[] = [];
  const available = (id: string) =>
    !f.desk?.entries.some((e) => e.playerId === id && e.status === 'absent') &&
    !s.availability?.some(
      (a) => a.fixtureId === f.id && a.playerId === id && a.status === 'no',
    );
  for (const pair of f.pairs.filter(
    (p) => p.players.length < 2 && !pairHasScores(f, p.id),
  )) {
    for (const reserve of (s.reserves || []).filter(
      (r) =>
        r.fixtureId === f.id &&
        r.teamId === pair.teamId &&
        available(r.playerId) &&
        !f.pairs.some((p) => p.players.includes(r.playerId)),
    )) {
      const player = s.players.find((p) => p.id === reserve.playerId);
      if (player)
        suggestions.push({
          kind: 'reserve',
          playerId: player.id,
          pairId: pair.id,
          targetId: pair.id,
          label: `Bring in ${player.name}`,
          detail: `Named reserve · ${f.desk?.entries.find((e) => e.playerId === player.id)?.status === 'arrived' ? 'already here' : s.availability?.some((a) => a.fixtureId === f.id && a.playerId === player.id && a.status === 'yes') ? 'available; confirm they can attend' : 'availability not confirmed; contact the family first'}`,
        });
    }
    if (pair.players.length === 0)
      for (const source of f.pairs.filter(
        (p) =>
          p.teamId === pair.teamId &&
          p.players.length === 2 &&
          !pairHasScores(f, p.id),
      )) {
        const family = s.players.find(
          (p) => p.id === source.players[0],
        )?.parentId;
        const siblings =
          !!family &&
          family ===
            s.players.find((p) => p.id === source.players[1])?.parentId;
        for (const playerId of source.players.filter(available)) {
          const player = s.players.find((p) => p.id === playerId);
          if (player)
            suggestions.push({
              kind: 'split',
              playerId,
              pairId: source.id,
              targetId: pair.id,
              label: `Ask ${player.name} to play individually`,
              detail: `Creates two individual scorecards for this team. ${siblings ? 'This would separate siblings; consider another pair first.' : 'Keeps existing sibling pairs together.'} Agree with both players and their organiser before applying.`,
              siblings,
            });
        }
      }
  }
  for (const slot of f.slots) {
    const active = f.pairs.filter(
      (p) => p.slotId === slot.id && p.players.length,
    );
    if (active.length !== 1 || pairHasScores(f, active[0].id)) continue;
    for (const target of f.slots.filter((v) => v.id !== slot.id)) {
      const others = f.pairs.filter(
        (p) => p.slotId === target.id && p.players.length,
      );
      if (
        others.length &&
        others.length < target.capacity &&
        others.every((p) => !pairHasScores(f, p.id))
      )
        suggestions.push({
          kind: 'group',
          pairId: active[0].id,
          targetId: target.id,
          label: `Move ${s.teams.find((t) => t.id === active[0].teamId)?.name || 'pair'} to ${target.label}`,
          detail:
            'Keeps this scorecard with another pair for marking. Tell everyone in the affected groups about the new start.',
        });
    }
  }
  return suggestions.sort(
    (a, b) =>
      Number(a.kind !== 'reserve') - Number(b.kind !== 'reserve') ||
      Number(!!a.siblings) - Number(!!b.siblings),
  );
}
export function applyDeskAction(
  source: State,
  m: Member,
  a: Action,
  now: string,
): State {
  const s = structuredClone(source),
    f = s.fixtures.find((f) => f.id === a.fixtureId);
  requireThat(
    f && canHost(s, m, f),
    'Only the fixture host or its Foundation administrator can manage registration.',
    403,
  );
  requireThat(
    ['scheduled', 'live'].includes(f.status),
    'Registration is closed for this fixture.',
  );
  f.desk ??= { fields: [], entries: [] };
  const desk = f.desk;
  if (a.type === 'desk-fields') {
    requireThat(
      a.expectedKey === deskFieldsKey(desk.fields),
      'Registration questions changed. Reload before editing.',
      409,
    );
    requireThat(
      Array.isArray(a.fields) && a.fields.length <= 12,
      'Use up to 12 registration questions.',
    );
    const fields: DeskField[] = a.fields.map((field: DeskField) => ({
      id: text(field.id, 'Question ID', 100),
      label: text(field.label, 'Question', 100),
      multiple: field.multiple === true,
      options: Array.isArray(field.options)
        ? field.options.map((o) => text(o, 'Choice', 80))
        : [],
    }));
    requireThat(
      new Set(fields.map((v) => v.id)).size === fields.length &&
        fields.every(
          (v) =>
            v.options.length > 0 &&
            v.options.length <= 15 &&
            new Set(v.options).size === v.options.length,
        ),
      'Each question needs distinct choices (up to 15).',
    );
    for (const old of desk.fields)
      if (desk.entries.some((e) => e.answers[old.id]?.length))
        requireThat(
          fields.some(
            (v) =>
              v.id === old.id && deskFieldsKey([v]) === deskFieldsKey([old]),
          ),
          'Keep questions and choices that already have answers. You can add another question.',
        );
    desk.fields = fields;
  } else if (a.type === 'desk-entry') {
    requireThat(
      deskPlayers(s, f).some((p) => p.id === a.playerId),
      'This child is not selected or a named reserve for this fixture.',
    );
    const existing = desk.entries.find((e) => e.playerId === a.playerId);
    requireThat(
      (existing?.version || 0) === a.expectedVersion,
      'Another organiser updated this child. Review the latest registration and try again.',
      409,
    );
    const status = a.status ?? existing?.status ?? 'expected';
    requireThat(
      ['expected', 'arrived', 'absent'].includes(status),
      'Choose an arrival status.',
    );
    const answers = a.answers ?? existing?.answers ?? {};
    requireThat(
      answers && typeof answers === 'object' && !Array.isArray(answers),
      'Invalid registration answers.',
    );
    for (const [id, values] of Object.entries(answers)) {
      const field = desk.fields.find((v) => v.id === id);
      requireThat(
        field &&
          Array.isArray(values) &&
          values.every(
            (v) => typeof v === 'string' && field.options.includes(v),
          ) &&
          new Set(values).size === values.length &&
          (field.multiple || values.length <= 1),
        'Choose one of the configured answers.',
      );
    }
    if (status === 'absent' && existing?.status !== 'absent') {
      const affected = f.pairs.filter((p) => p.players.includes(a.playerId));
      requireThat(
        !affected.some((p) => pairHasScores(f, p.id)),
        'This child’s scorecard has scores. Contact the host to review the recorded round; it will not be rewritten by a withdrawal.',
      );
      for (const pair of affected)
        pair.players = pair.players.filter((id) => id !== a.playerId);
      s.availability = (s.availability || []).filter(
        (v) => v.fixtureId !== f.id || v.playerId !== a.playerId,
      );
      s.availability.push({
        fixtureId: f.id,
        playerId: a.playerId,
        status: 'no',
        updatedAt: now,
        updatedBy: m.id,
      });
      const child = s.players.find((p) => p.id === a.playerId)!;
      notify(
        s,
        [
          child.parentId,
          ...affected.flatMap((p) => teamManagers(s, p.teamId)),
          ...(s.reserves || [])
            .filter((r) => r.fixtureId === f.id && r.playerId === a.playerId)
            .flatMap((r) => teamManagers(s, r.teamId)),
        ],
        `${child.name} has been marked as not attending ${f.name}. Please review the team and starting group.`,
        f.id,
      );
    }
    if (existing?.status === 'absent' && status !== 'absent') {
      s.availability = (s.availability || []).filter(
        (v) => v.fixtureId !== f.id || v.playerId !== a.playerId,
      );
      s.availability.push({
        fixtureId: f.id,
        playerId: a.playerId,
        status: 'yes',
        updatedAt: now,
        updatedBy: m.id,
      });
      const oldTeam =
        s.reserves?.find(
          (r) => r.fixtureId === f.id && r.playerId === a.playerId,
        )?.teamId ||
        s.enrollments?.find(
          (e) =>
            e.playerId === a.playerId &&
            e.status === 'approved' &&
            f.teamIds.includes(e.teamId),
        )?.teamId;
      if (
        oldTeam &&
        !s.reserves?.some(
          (r) => r.fixtureId === f.id && r.playerId === a.playerId,
        )
      ) {
        s.reserves ??= [];
        s.reserves.push({
          fixtureId: f.id,
          playerId: a.playerId,
          teamId: oldTeam,
        });
      }
    }
    desk.entries = desk.entries.filter((e) => e.playerId !== a.playerId);
    desk.entries.push({
      playerId: a.playerId,
      status,
      answers,
      note: text(
        a.note ?? existing?.note ?? '',
        'Registration note',
        1000,
        false,
      ),
      version: (existing?.version || 0) + 1,
      updatedAt: now,
      updatedBy: m.id,
    });
  } else if (a.type === 'desk-repair') {
    requireThat(
      a.expectedKey === deskKey(s, f),
      'The line-up or registration changed. Review the updated suggestions.',
      409,
    );
    requireThat(
      a.agreed === true,
      'Confirm the change has been agreed with the players and their organiser.',
    );
    const proposal = deskSuggestions(s, f).find(
      (p) =>
        p.kind === a.kind &&
        p.pairId === a.pairId &&
        p.targetId === a.targetId &&
        p.playerId === a.playerId,
    );
    requireThat(proposal, 'This suggestion is no longer available.');
    const pair = f.pairs.find((p) => p.id === proposal.pairId)!;
    const affected = new Set(pair.players);
    if (proposal.kind === 'group') {
      f.pairs
        .filter((p) => p.slotId === proposal.targetId)
        .flatMap((p) => p.players)
        .forEach((id) => affected.add(id));
      pair.slotId = proposal.targetId;
    } else {
      const target = f.pairs.find((p) => p.id === proposal.targetId)!;
      requireThat(
        rosterEligible(s, proposal.playerId!, target.teamId),
        'The replacement must be approved for this team.',
      );
      if (proposal.kind === 'split')
        pair.players = pair.players.filter((id) => id !== proposal.playerId);
      target.players.push(proposal.playerId!);
      target.players.forEach((id) => affected.add(id));
      s.reserves = s.reserves?.filter(
        (r) => r.fixtureId !== f.id || r.playerId !== proposal.playerId,
      );
    }
    for (const id of affected) {
      const entry = desk.entries.find((e) => e.playerId === id);
      const note =
        'Starting details or playing partner changed. Explain the updated allocation and replace their printed ticket.';
      if (entry) {
        entry.note = (entry.note + '\n' + note).trim().slice(-1000);
        entry.version++;
        entry.updatedAt = now;
        entry.updatedBy = m.id;
      } else
        desk.entries.push({
          playerId: id,
          status: 'expected',
          answers: {},
          note,
          version: 1,
          updatedAt: now,
          updatedBy: m.id,
        });
    }
    s.fixtureConfirmations = s.fixtureConfirmations?.filter(
      (c) => c.fixtureId !== f.id || !affected.has(c.playerId),
    );
    notify(
      s,
      [...affected]
        .map((id) => s.players.find((p) => p.id === id)!.parentId)
        .concat(
          f.pairs
            .filter((p) => p.players.some((id) => affected.has(id)))
            .flatMap((p) => teamManagers(s, p.teamId)),
        ),
      `${f.name}: playing partners or starting details have changed. Check your updated fixture details with the host.`,
      f.id,
    );
  } else requireThat(false, 'Unknown registration action.');
  s.activity.unshift({
    id: crypto.randomUUID(),
    by: m.id,
    at: now,
    text: 'Updated fixture registration',
  });
  return s;
}

export function registrationTickets(s: State, f: Fixture, onlyPlayer?: string) {
  const escape = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  const cards = f.pairs.flatMap((pair) =>
    pair.players
      .filter((id) => !onlyPlayer || id === onlyPlayer)
      .map((id) => {
        const player = s.players.find((p) => p.id === id)!,
          team = s.teams.find((t) => t.id === pair.teamId)!,
          slot = f.slots.find((v) => v.id === pair.slotId);
        const partners = pair.players
          .filter((v) => v !== id)
          .map((v) => s.players.find((p) => p.id === v)?.name || 'Player');
        const group = f.pairs
          .filter(
            (p) => p.slotId && p.slotId === pair.slotId && p.id !== pair.id,
          )
          .flatMap((p) =>
            p.players.map(
              (id) => s.players.find((v) => v.id === id)?.name || 'Player',
            ),
          );
        return `<article><small>${escape(f.name)} · ${escape(f.date)}</small><h2>${escape(player.name)}</h2><p>${escape(team.name)} · ${escape(team.cap)} caps</p><strong>Hole ${escape(String(slot?.startHole ?? 'to be confirmed'))} · ${escape(slot?.startTime || f.start)}</strong><p>Partner: ${escape(partners.join(' & ') || 'Playing individually')}</p><p>Also in your group: ${escape(group.join(', ') || 'To be confirmed')}</p><small>Arrive ${escape(f.arrival)} · Check with registration for any changes.</small></article>`;
      }),
  );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Player tickets</title><style>@page{size:A4;margin:10mm}body{font:12px/1.35 Arial,sans-serif;color:#153f35;margin:0}.tools{padding:15px}.tickets{display:grid;grid-template-columns:1fr 1fr}article{box-sizing:border-box;border:1px dashed #aaa;padding:6mm;min-height:65mm;break-inside:avoid}h2{font-size:20px;margin:8px 0}p{margin:6px 0}strong{font-size:19px}small{font-size:11px}@media print{.tools{display:none}}</style><div class="tools"><button onclick="window.print()">Print / save as PDF</button><p>A4 · up to 8 tickets per sheet · cut along the dotted lines. Print again if allocations change.</p></div><main class="tickets">${cards.join('')}</main></html>`;
}
