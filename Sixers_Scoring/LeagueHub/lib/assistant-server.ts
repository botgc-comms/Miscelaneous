import { context, db, type Row } from './server';
import { AppError, type State } from './model';
import {
  applyProposal,
  parseProposal,
  describeChanges,
  type Proposal,
} from './assistant-plan';
import {
  assistantConnected,
  responseRequest,
  startResponse,
} from './assistant-provider';

type FamilyCopy = {
  id: string;
  revision: number;
  before: string;
  after: string;
};
export type AssistantJob = {
  id: string;
  workspace: string;
  created: string;
  revision: number;
  prompt: string;
  status:
    | 'starting'
    | 'researching'
    | 'ready'
    | 'replied'
    | 'superseded'
    | 'applied'
    | 'undone'
    | 'cancelled'
    | 'failed';
  progress: string;
  responseId?: string;
  proposal?: Proposal;
  baseRevision: number;
  proposed?: State;
  before?: State;
  appliedRevision?: number;
  familyCopies?: FamilyCopy[];
  changes?: ReturnType<typeof describeChanges>;
  imageName?: string;
  attachmentNames?: string[];
  conversation?: { request: string; reply: string }[];
};
export async function adminContext(workspace: string, view?: string) {
  const c = await context(workspace, view);
  if (c.me.role !== 'admin' || c.row.demo)
    throw new AppError('Foundation administrator access is required.', 403);
  return c;
}
async function readJob(workspace: string, id: string) {
  const row = await db()
    .prepare(
      'SELECT data,revision FROM assistant_jobs WHERE id=? AND workspace=?',
    )
    .bind(id, workspace)
    .first<{ data: string; revision: number }>();
  if (!row) throw new AppError('This assistant task could not be found.', 404);
  return { ...JSON.parse(row.data), revision: row.revision } as AssistantJob;
}
async function saveJob(j: AssistantJob) {
  const r = await db()
    .prepare(
      'UPDATE assistant_jobs SET data=?,revision=revision+1 WHERE id=? AND workspace=? AND revision=?',
    )
    .bind(JSON.stringify(j), j.id, j.workspace, j.revision)
    .run();
  if (r.meta.changes) j.revision++;
  return !!r.meta.changes;
}
function publicJob(j: AssistantJob, currentRevision: number) {
  const { before, proposed, familyCopies, responseId, proposal, ...safe } = j;
  return {
    ...safe,
    proposal: proposal
      ? {
          message: proposal.message,
          sources: proposal.sources,
          warnings: proposal.warnings,
          reset: proposal.reset,
        }
      : undefined,
    canUndo: j.status === 'applied' && j.appliedRevision === currentRevision,
    stale: j.status === 'ready' && j.baseRevision !== currentRevision,
  };
}
async function resetFamilyCopies(c: Awaited<ReturnType<typeof context>>) {
  const ids = new Set(c.state.players.map((p) => p.id));
  const others = await db()
    .prepare('SELECT data FROM workspaces WHERE id<>?')
    .bind(c.row.id)
    .all<{ data: string }>();
  const shared = new Set(
    others.results.flatMap((r) =>
      (JSON.parse(r.data) as State).players.map((p) => p.id),
    ),
  );
  const rows = await db()
    .prepare(
      "SELECT id,data,revision FROM families WHERE id=? OR id=? OR EXISTS (SELECT 1 FROM json_each(families.data,'$.children') p WHERE json_extract(p.value,'$.id') IN (SELECT json_extract(p.value,'$.id') FROM workspaces w,json_each(w.data,'$.players') p WHERE w.id=?))",
    )
    .bind(c.u.userId, c.row.id + ':family', c.row.id)
    .all<{ id: string; data: string; revision: number }>();
  return rows.results.flatMap((row) => {
    const family = JSON.parse(row.data);
    const removed = family.children
      .filter(
        (p: any) =>
          !shared.has(p.id) &&
          (ids.has(p.id) ||
            row.id === c.u.userId ||
            row.id === c.row.id + ':family'),
      )
      .map((p: any) => p.id);
    if (!removed.length) return [];
    family.children = family.children.filter(
      (p: any) => !removed.includes(p.id),
    );
    for (const id of removed) delete family.pendingSync?.[id];
    return [
      {
        id: row.id,
        revision: row.revision,
        before: row.data,
        after: JSON.stringify(family),
      },
    ];
  });
}
export async function createAssistantJob(
  workspace: string,
  view: string,
  prompt: string,
  reset = false,
  attachments: import('./assistant-attachments').AssistantAttachment[] = [],
  replyTo?: string,
) {
  const c = await adminContext(workspace, view);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000)
    throw new AppError('Enter an instruction of up to 4,000 characters.');
  if (!reset && !assistantConnected())
    throw new AppError(
      'The AI connection is not set up yet. Research will become available once it is connected.',
      503,
    );
  const recent = await db()
    .prepare(
      'SELECT data FROM assistant_jobs WHERE workspace=? ORDER BY created DESC LIMIT 30',
    )
    .bind(workspace)
    .all<{ data: string }>();
  const parent = replyTo ? await readJob(workspace, replyTo) : undefined;
  if (
    parent &&
    (reset ||
      parent.proposal?.reset ||
      !parent.proposal ||
      ![
        'ready',
        'replied',
        'applied',
        'cancelled',
        'superseded',
        'undone',
      ].includes(parent.status))
  )
    throw new AppError(
      'Wait for the assistant to reply before responding.',
      409,
    );
  if (
    recent.results.filter(
      (r) => Date.now() - Date.parse(JSON.parse(r.data).created) < 3600000,
    ).length >= 30
  )
    throw new AppError(
      'Please allow a little time before starting another assistant task.',
      429,
    );
  const j: AssistantJob = {
    id: crypto.randomUUID(),
    workspace: c.row.id,
    created: new Date().toISOString(),
    revision: 0,
    prompt: prompt.trim(),
    status: reset ? 'ready' : 'starting',
    progress: reset
      ? 'Review the reset before applying it.'
      : 'Starting your request…',
    baseRevision: c.row.revision,
  };
  if (parent) {
    const history =
      parent.conversation ||
      recent.results
        .map((r) => JSON.parse(r.data) as AssistantJob)
        .filter(
          (p) => p.created < parent.created && !p.proposal?.reset && p.proposal,
        )
        .slice(0, 3)
        .reverse()
        .map((p) => ({ request: p.prompt, reply: p.proposal!.message }));
    j.conversation = [
      ...history,
      {
        request: parent.prompt,
        reply: parent.proposal!.message,
      },
    ].slice(-12);
  }
  if (attachments.length) j.attachmentNames = attachments.map((f) => f.name);
  if (reset) {
    j.proposal = {
      reset: true,
      message:
        'Clear this workspace’s leagues, clubs, teams, fixtures, players and test contacts. Your Foundation admin access stays in place. Family profiles used in other workspaces are kept. A recovery copy is retained for Undo.',
      changes: [],
      sources: [],
      warnings: [],
    };
    j.proposed = applyProposal(c.state, c.me, j.proposal);
    j.familyCopies = await resetFamilyCopies(c);
    j.changes = describeChanges(c.state, j.proposed);
  }
  const insert = db()
    .prepare(
      "INSERT INTO assistant_jobs(id,workspace,created,data,revision) SELECT ?,?,?,?,0 WHERE NOT EXISTS (SELECT 1 FROM assistant_jobs WHERE workspace=? AND json_extract(data,'$.status') IN ('starting','researching','ready') AND id<>?) AND (?='' OR EXISTS (SELECT 1 FROM assistant_jobs WHERE id=? AND workspace=? AND revision=?))",
    )
    .bind(
      j.id,
      j.workspace,
      j.created,
      JSON.stringify(j),
      j.workspace,
      parent?.status === 'ready' ? parent.id : '',
      parent?.id || '',
      parent?.id || '',
      j.workspace,
      parent?.revision ?? -1,
    );
  const statements = [insert];
  if (parent?.status === 'ready') {
    parent.status = 'superseded';
    parent.progress =
      'Continued in your next reply. These changes were not applied.';
    statements.push(
      db()
        .prepare(
          'UPDATE assistant_jobs SET data=?,revision=revision+1 WHERE id=? AND workspace=? AND revision=? AND EXISTS (SELECT 1 FROM assistant_jobs WHERE id=?)',
        )
        .bind(
          JSON.stringify(parent),
          parent.id,
          workspace,
          parent.revision,
          j.id,
        ),
    );
  }
  const [r] = await db().batch(statements);
  if (!r.meta.changes)
    throw new AppError(
      'Review or cancel the current assistant task before starting another.',
      409,
    );
  if (!reset) {
    try {
      const response = await startResponse(
        j.prompt,
        c.state,
        attachments,
        j.conversation || [],
      );
      j.responseId = response.id;
      j.status = 'researching';
      j.progress =
        'Researching and preparing a proposal. Your data has not changed.';
      if (!(await saveJob(j))) {
        await responseRequest(
          '/' + encodeURIComponent(response.id) + '/cancel',
          {},
        ).catch(() => {});
        return publicJob(await readJob(workspace, j.id), c.row.revision);
      }
    } catch (e) {
      j.status = 'failed';
      j.progress =
        e instanceof AppError
          ? e.message
          : 'The AI service could not start this task. No data has changed.';
      await saveJob(j);
    }
  }
  return publicJob(j, c.row.revision);
}
export async function assistantStatus(workspace: string, view?: string) {
  const c = await adminContext(workspace, view);
  const rows = await db()
    .prepare(
      'SELECT data,revision FROM assistant_jobs WHERE workspace=? ORDER BY created DESC LIMIT 20',
    )
    .bind(workspace)
    .all<{ data: string; revision: number }>();
  const jobs = rows.results.map(
    (r) => ({ ...JSON.parse(r.data), revision: r.revision }) as AssistantJob,
  );
  for (const j of jobs.filter(
    (j) =>
      j.status === 'ready' &&
      j.proposal &&
      !j.proposal.reset &&
      !j.proposal.changes.length,
  )) {
    j.status = 'replied';
    j.progress = 'Reply below to continue. No changes have been applied.';
    await saveJob(j);
  }
  for (const j of jobs.filter((j) =>
    ['starting', 'researching'].includes(j.status),
  )) {
    if (Date.now() - Date.parse(j.created) > 20 * 60 * 1000) {
      j.status = 'failed';
      j.progress =
        'This request timed out. Nothing was applied. Please retry with a smaller request.';
      await saveJob(j);
      continue;
    }
    if (!j.responseId) {
      if (Date.now() - Date.parse(j.created) > 60000) {
        j.status = 'failed';
        j.progress = 'The request did not start. Please try again.';
        await saveJob(j);
      }
      continue;
    }
    try {
      const result = await responseRequest(
        '/' + encodeURIComponent(j.responseId),
      );
      if (result.status === 'completed') {
        const output =
          result.output
            ?.filter((o: any) => o.type === 'message')
            .flatMap((o: any) => o.content || [])
            .filter((o: any) => o.type === 'output_text')
            .map((o: any) => o.text)
            .join('') || '';
        j.proposal = parseProposal(JSON.parse(output));
        // Freeze the exact proposed records/IDs for review and atomic Apply.
        if (j.baseRevision !== c.row.revision)
          throw new AppError(
            'The workspace changed during research. Please send the request again so the proposal uses the latest data.',
            409,
          );
        j.proposed = applyProposal(c.state, c.me, j.proposal);
        if (j.proposal.reset) j.familyCopies = await resetFamilyCopies(c);
        j.changes = describeChanges(c.state, j.proposed);
        j.status = j.proposal.changes.length ? 'ready' : 'replied';
        j.progress = j.proposal.changes.length
          ? 'Ready for your review. Nothing has been applied.'
          : 'Reply below to continue. No changes have been applied.';
      } else if (
        ['failed', 'cancelled', 'incomplete'].includes(result.status)
      ) {
        j.status = 'failed';
        j.progress =
          'The assistant could not complete this request. No data has changed. Try a smaller request.';
      } else
        j.progress = result.output?.some(
          (o: any) => o.type === 'web_search_call',
        )
          ? 'Checking sources and preparing your proposal. No data has changed.'
          : 'Researching and preparing a proposal. No data has changed.';
      await saveJob(j);
    } catch (e) {
      if (!(e instanceof AppError) || e.status < 500) {
        j.status = 'failed';
        j.progress =
          e instanceof AppError
            ? e.message
            : 'The proposal was incomplete. Nothing has been applied. Please try again.';
        await saveJob(j);
      }
      // Temporary network/provider failures stay pending, with a visible retry message.
      else
        j.progress =
          'Connection interrupted. Checking again shortly; nothing has been applied.';
    }
  }
  return {
    connected: assistantConnected(),
    jobs: jobs.map((j) => publicJob(j, c.row.revision)),
  };
}
export async function decideAssistantJob(
  workspace: string,
  view: string,
  id: string,
  decision: string,
) {
  const c = await adminContext(workspace, view),
    j = await readJob(workspace, id);
  if (decision === 'cancel') {
    if (!['starting', 'researching', 'ready'].includes(j.status))
      throw new AppError('This task has already finished.', 409);
    const responseId = j.responseId;
    j.status = 'cancelled';
    j.progress = 'Cancelled. No changes applied.';
    if (!(await saveJob(j)))
      throw new AppError('This task changed. Please try again.', 409);
    if (responseId)
      await responseRequest(
        '/' + encodeURIComponent(responseId) + '/cancel',
        {},
      ).catch(() => {});
    return publicJob(j, c.row.revision);
  }
  const undo = decision === 'undo';
  if (!undo && decision !== 'apply')
    throw new AppError('Choose Apply, Cancel or Undo.');
  if (j.status === (undo ? 'undone' : 'applied'))
    return publicJob(j, c.row.revision);
  if (j.status !== (undo ? 'applied' : 'ready'))
    throw new AppError('This task is no longer ready for this action.', 409);
  const expected = undo ? j.appliedRevision : j.baseRevision;
  if (c.row.revision !== expected)
    throw new AppError(
      undo
        ? 'Other changes have been made since this task. Undo is paused to protect those edits.'
        : 'The workspace changed while you were reviewing. Cancel this proposal and request a fresh one.',
      409,
    );
  const next = undo ? j.before : j.proposed;
  if (!next) throw new AppError('There are no changes to apply.');
  if (!undo && !j.proposal?.reset && !j.proposal?.changes.length)
    throw new AppError('There are no changes to apply.');
  const copies = j.familyCopies || [],
    stamp = new Date().toISOString() + ':' + crypto.randomUUID();
  if (!undo) {
    j.before = c.state;
    j.appliedRevision = c.row.revision + 1;
  }
  j.status = undo ? 'undone' : 'applied';
  j.progress = undo
    ? 'Changes undone.'
    : 'Changes applied. You can undo this task while no later edits have been made.';
  const guard = JSON.stringify(
    copies.map((f) => ({ id: f.id, revision: f.revision + (undo ? 1 : 0) })),
  );
  const first = db()
    .prepare(
      `UPDATE workspaces SET data=?,revision=revision+1,updated=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM assistant_jobs WHERE id=? AND revision=?) AND NOT EXISTS (SELECT 1 FROM json_each(?) e LEFT JOIN families f ON f.id=json_extract(e.value,'$.id') WHERE f.id IS NULL OR f.revision<>json_extract(e.value,'$.revision'))`,
    )
    .bind(
      JSON.stringify(next),
      stamp,
      workspace,
      expected!,
      j.id,
      j.revision,
      guard,
    );
  const gate = 'EXISTS (SELECT 1 FROM workspaces WHERE id=? AND updated=?)';
  const statements = [
    first,
    ...copies.map((f) =>
      db()
        .prepare(
          `UPDATE families SET data=?,revision=revision+1 WHERE id=? AND ${gate}`,
        )
        .bind(undo ? f.before : f.after, f.id, workspace, stamp),
    ),
    db()
      .prepare(
        `UPDATE assistant_jobs SET data=?,revision=revision+1 WHERE id=? AND ${gate}`,
      )
      .bind(JSON.stringify(j), j.id, workspace, stamp),
  ];
  const result = await db().batch(statements);
  if (!result[0].meta.changes)
    throw new AppError(
      'The workspace or family data changed. Refresh before trying again.',
      409,
    );
  j.revision++;
  return publicJob(j, c.row.revision + 1);
}
