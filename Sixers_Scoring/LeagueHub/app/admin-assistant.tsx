'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  Paperclip,
  Send,
  LoaderCircle,
  Undo2,
  X,
  Check,
  CircleAlert,
  FileText,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { AppTools } from './widgets';
import { AssistantVoice } from './assistant-voice';
import {
  ATTACHMENT_ACCEPT,
  checkAttachments,
} from '@/lib/assistant-attachments';
type Job = {
  id: string;
  created: string;
  prompt: string;
  status: string;
  progress: string;
  imageName?: string;
  attachmentNames?: string[];
  canUndo: boolean;
  conversation?: { request: string; reply: string }[];
  stale: boolean;
  proposal?: {
    message: string;
    warnings: string[];
    sources: { title: string; url: string }[];
    reset?: boolean;
  };
  changes?: { kind: string; entity: string; name: string; details: string[] }[];
};
export function AdminAssistant({ tools }: { tools: AppTools }) {
  const [open, setOpen] = useState(false),
    [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState(''),
    [connected, setConnected] = useState<boolean | null>(null),
    [text, setText] = useState(''),
    [attachments, setAttachments] = useState<File[]>([]),
    [voiceBusy, setVoiceBusy] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    refresh = useRef(tools.refresh);
  refresh.current = tools.refresh;
  const active = jobs.find((j) =>
    ['starting', 'researching', 'ready'].includes(j.status),
  );
  const job =
    selected === 'new'
      ? undefined
      : jobs.find((j) => j.id === selected) || active || jobs[0];
  const canReply =
    !!job?.proposal &&
    !job.proposal.reset &&
    [
      'ready',
      'replied',
      'applied',
      'cancelled',
      'superseded',
      'undone',
    ].includes(job.status);
  const blocked =
    !!active &&
    !(canReply && active.id === job?.id && active.status === 'ready');
  const running = active && ['starting', 'researching'].includes(active.status);
  useEffect(() => {
    if (open && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [open, job?.id, job?.status]);
  const load = useCallback(async () => {
    const r = await fetch(
      '/api/assistant?' +
        new URLSearchParams({ workspace: tools.workspace, view: tools.view }),
    );
    const data: any = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not check the assistant.');
    setJobs(data.jobs);
    setConnected(data.connected);
  }, [tools.workspace, tools.view]);
  useEffect(() => {
    let ended = false;
    const check = async () => {
      try {
        await load();
      } catch (e) {
        if (!ended) setError((e as Error).message);
      }
    };
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 5000);
    return () => {
      ended = true;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function act(action: string, id?: string) {
    if (action === 'start' && (voiceBusy || blocked || busy || !connected))
      return;
    setBusy(action);
    setError('');
    try {
      let body: BodyInit, headers: HeadersInit | undefined;
      if (action === 'start') {
        const f = new FormData();
        f.set('workspace', tools.workspace);
        f.set('view', tools.view);
        f.set('action', action);
        if (canReply && job) f.set('replyTo', job.id);
        f.set(
          'prompt',
          text.trim() ||
            'Read these attachments and propose the relevant clubs, leagues or fixtures to add. Ask me if anything is unclear.',
        );
        attachments.forEach((file) => f.append('attachments', file));
        body = f;
      } else {
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          workspace: tools.workspace,
          view: tools.view,
          action,
          id,
        });
      }
      const r = await fetch('/api/assistant', {
          method: 'POST',
          headers,
          body,
        }),
        data: any = await r.json();
      if (!r.ok)
        throw new Error(data.error || 'The request could not be completed.');
      setSelected(data.id);
      if (action === 'start') {
        setText('');
        setAttachments([]);
      }
      await load();
      if (action === 'apply' || action === 'undo') await refresh.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  // Expose the same reviewed reset flow for the site owner working with Codex.
  useEffect(() => {
    const mc = (document as any).modelContext;
    if (!mc?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(
      mc.registerTool(
        {
          name: 'reset_golfsixes_workspace',
          title: 'Clear GolfSixes workspace',
          description:
            'Clear the CURRENT workspace and its unshared test family data, preserving Foundation admin access and an Undo recovery copy. Only use when the user explicitly asks to start fresh. This is destructive.',
          inputSchema: {
            type: 'object',
            properties: { confirm: { type: 'boolean' } },
            required: ['confirm'],
            additionalProperties: false,
          },
          annotations: { destructiveHint: true },
          execute: async (args: any) => {
            if (args?.confirm !== true)
              throw new Error('Explicit confirmation is required.');
            const call = async (action: string, id?: string) => {
              const r = await fetch('/api/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  workspace: tools.workspace,
                  view: tools.view,
                  action,
                  id,
                }),
              });
              const data: any = await r.json();
              if (!r.ok) throw new Error(data.error);
              return data;
            };
            const proposal = await call('reset');
            await call('apply', proposal.id);
            await refresh.current();
            await load();
            return {
              workspace: tools.workspace,
              cleared: true,
              undoTaskId: proposal.id,
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, [tools.workspace, tools.view, load]);
  const label =
    busy === 'apply'
      ? 'Applying changes…'
      : busy === 'undo'
        ? 'Undoing changes…'
        : busy === 'cancel'
          ? 'Cancelling task…'
          : busy === 'reset'
            ? 'Preparing reset…'
            : busy === 'start' || running
              ? 'Assistant working…'
              : active?.status === 'ready'
                ? 'Ready to review'
                : 'AI assistant';
  return (
    <>
      <button
        className={`assistant-launcher ${running || busy ? 'is-working' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
      >
        {running || busy ? (
          <LoaderCircle className="assistant-spin" size={22} />
        ) : (
          <Bot size={24} />
        )}
        <span aria-live="polite">{label}</span>
        {active?.status === 'ready' && <span className="assistant-dot" />}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="admin-assistant-panel">
          <SheetHeader>
            <SheetTitle>
              <Bot size={24} /> Your admin assistant
            </SheetTitle>
            <SheetDescription>
              Ask for changes. Review them. Then choose Apply.
            </SheetDescription>
          </SheetHeader>
          <div className="assistant-scroll" ref={scroll}>
            {connected === false && (
              <p className="assistant-alert">
                The AI connection is not available yet. Workspace reset and Undo
                are still available.
              </p>
            )}
            {!job && (
              <div className="assistant-welcome">
                <h3>What would you like to do?</h3>
                <p>
                  Find clubs, set up leagues, or update teams and fixtures. You
                  can attach a photographed list or screenshot.
                </p>
                <button
                  className="assistant-suggestion"
                  onClick={() =>
                    setText(
                      'Find golf clubs in Derbyshire and prepare them for my clubs list.',
                    )
                  }
                >
                  Find golf clubs in Derbyshire
                </button>
              </div>
            )}
            {job && (
              <article className="assistant-job">
                {!!job.conversation?.length && (
                  <details className="assistant-conversation" open>
                    <summary>Earlier in this conversation</summary>
                    {job.conversation.map((turn, i) => (
                      <div key={i}>
                        <div className="assistant-request">{turn.request}</div>
                        <p className="assistant-reply">{turn.reply}</p>
                      </div>
                    ))}
                  </details>
                )}
                <div className="assistant-request">
                  {job.prompt}
                  {(
                    job.attachmentNames ||
                    (job.imageName ? [job.imageName] : [])
                  ).map((name, index) => (
                    <small key={index}>
                      <Paperclip size={14} />
                      {name}
                    </small>
                  ))}
                </div>
                <div
                  className={`assistant-status ${job.status === 'failed' ? 'has-error' : ''}`}
                  role="status"
                >
                  {['starting', 'researching'].includes(job.status) ? (
                    <LoaderCircle size={20} className="assistant-spin" />
                  ) : job.status === 'applied' || job.status === 'undone' ? (
                    <Check size={20} />
                  ) : (
                    <Bot size={20} />
                  )}
                  <div>
                    <strong>
                      {
                        {
                          starting: 'Starting',
                          researching: 'Working on your request',
                          ready:
                            job.changes?.length || job.proposal?.reset
                              ? 'Ready to review'
                              : 'Assistant replied',
                          replied: 'Assistant replied',
                          superseded: 'Continued in your next reply',
                          applied: 'Applied',
                          undone: 'Undone',
                          cancelled: 'Cancelled',
                          failed: 'Could not finish',
                        }[job.status]
                      }
                    </strong>
                    <p>{job.progress}</p>
                    {['starting', 'researching'].includes(job.status) && (
                      <small>
                        {Math.max(
                          0,
                          Math.floor((now - Date.parse(job.created)) / 60000),
                        )}
                        m{' '}
                        {Math.max(
                          0,
                          Math.floor((now - Date.parse(job.created)) / 1000) %
                            60,
                        )}
                        s elapsed · You can close this panel.
                      </small>
                    )}
                  </div>
                </div>
                {job.proposal && (
                  <>
                    <p className="assistant-reply">{job.proposal.message}</p>
                    {job.proposal.warnings.map((w, i) => (
                      <p key={i} className="assistant-alert">
                        {w}
                      </p>
                    ))}
                  </>
                )}
                {!!job.changes?.length && (
                  <details
                    key={job.id + job.status}
                    open={job.status === 'ready'}
                    className="assistant-proposal"
                  >
                    <summary>
                      {job.changes.length}{' '}
                      {job.status === 'ready' ? 'proposed ' : ''}
                      {job.changes.length === 1 ? 'change' : 'changes'}
                    </summary>
                    <ul>
                      {job.changes.map((c, i) => (
                        <li key={i}>
                          <span
                            className={`assistant-change-kind ${c.kind.toLowerCase()}`}
                          >
                            {c.kind}
                          </span>
                          <div>
                            <strong>{c.name}</strong>
                            {c.details.map((d, n) => (
                              <p key={n}>{d}</p>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!job.proposal?.sources.length && (
                  <details className="assistant-sources">
                    <summary>Sources ({job.proposal.sources.length})</summary>
                    {job.proposal.sources.map((s, i) => (
                      <a key={i} href={s.url} target="_blank" rel="noreferrer">
                        {s.title} ↗
                      </a>
                    ))}
                  </details>
                )}
                {job.stale && (
                  <p className="assistant-alert">
                    The workspace has changed. Reply below to request an updated
                    proposal using the latest data.
                  </p>
                )}
                <div className="assistant-actions">
                  {job.status === 'ready' &&
                    (!!job.changes?.length || job.proposal?.reset) && (
                      <>
                        <button
                          className="btn primary"
                          disabled={
                            !!busy ||
                            job.stale ||
                            (!job.changes?.length && !job.proposal?.reset)
                          }
                          onClick={() => void act('apply', job.id)}
                        >
                          {busy === 'apply'
                            ? 'Applying…'
                            : job.proposal?.reset
                              ? 'Clear workspace'
                              : 'Apply changes'}
                        </button>
                        <button
                          className="btn"
                          disabled={!!busy}
                          onClick={() => void act('cancel', job.id)}
                        >
                          {job.changes?.length ? 'Discard' : 'Done'}
                        </button>
                      </>
                    )}
                  {['starting', 'researching'].includes(job.status) && (
                    <button
                      className="btn"
                      disabled={!!busy}
                      onClick={() => void act('cancel', job.id)}
                    >
                      Cancel task
                    </button>
                  )}
                  {job.status === 'applied' && (
                    <>
                      <button
                        className="btn"
                        disabled={!!busy || !job.canUndo}
                        onClick={() => void act('undo', job.id)}
                      >
                        <Undo2 size={17} />
                        {busy === 'undo' ? 'Undoing…' : 'Undo changes'}
                      </button>
                      {!job.canUndo && (
                        <p>
                          Later edits have been made. Undo is paused to protect
                          them.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </article>
            )}
            {jobs.length > 1 && (
              <details className="assistant-history">
                <summary>Recent tasks</summary>
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => setSelected(j.id)}
                    aria-pressed={job?.id === j.id}
                  >
                    <span>{j.prompt}</span>
                    <small>{j.status}</small>
                  </button>
                ))}
              </details>
            )}
            <details className="assistant-reset">
              <summary>Workspace tools</summary>
              <p>
                Start again with an empty workspace. Admin access is kept, and
                you can review the reset first.
              </p>
              <button
                className="btn"
                disabled={!!busy || !!active}
                onClick={() => void act('reset')}
              >
                Start fresh…
              </button>
            </details>
          </div>
          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void act('start');
            }}
          >
            <div className="assistant-compose-heading">
              <label htmlFor="assistant-instruction">
                {canReply
                  ? 'Reply to the assistant'
                  : 'What would you like to do?'}
              </label>
              {job && (
                <button
                  type="button"
                  className="btn small"
                  disabled={!!busy || !!active || voiceBusy}
                  onClick={() => {
                    setSelected('new');
                    setText('');
                    setAttachments([]);
                  }}
                >
                  New conversation
                </button>
              )}
            </div>
            {canReply && !blocked && (
              <p className="assistant-compose-context">
                {job?.status === 'ready' && !!job.changes?.length
                  ? 'Send a reply to revise this proposal. Changes still need your approval.'
                  : 'Your reply continues this conversation. Nothing is applied until you choose Apply.'}
              </p>
            )}
            {error && (
              <p className="assistant-alert" role="alert">
                <CircleAlert size={17} />
                {error}
              </p>
            )}
            {attachments.length > 0 && (
              <div
                className="assistant-attachments"
                aria-label="Attached files"
              >
                {attachments.map((file, index) => (
                  <AttachmentPreview
                    key={file.name + file.lastModified + index}
                    file={file}
                    disabled={!!busy}
                    remove={() =>
                      setAttachments((files) =>
                        files.filter((_, i) => i !== index),
                      )
                    }
                  />
                ))}
              </div>
            )}
            <textarea
              id="assistant-instruction"
              rows={3}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                canReply
                  ? 'Type your answer or ask for a change…'
                  : 'Describe what you would like to change…'
              }
              disabled={blocked || !!busy || voiceBusy}
            />
            <div className="assistant-compose-actions">
              <input
                ref={input}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const files = [
                    ...attachments,
                    ...Array.from(e.target.files || []),
                  ];
                  e.target.value = '';
                  try {
                    checkAttachments(files);
                    setAttachments(files);
                    setError('');
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
              <button
                type="button"
                className="btn assistant-attach"
                disabled={blocked || !!busy}
                onClick={() => input.current?.click()}
              >
                <Paperclip size={18} /> Attach
                {attachments.length ? ` (${attachments.length})` : ''}
              </button>
              <AssistantVoice
                key={tools.workspace + selected}
                workspace={tools.workspace}
                view={tools.view}
                open={open}
                disabled={blocked || !!busy || !connected}
                onBusy={setVoiceBusy}
                onText={(transcript) =>
                  setText((current) => {
                    const combined = [current.trim(), transcript]
                      .filter(Boolean)
                      .join('\n');
                    return combined;
                  })
                }
              />
              <button
                type="submit"
                className="btn primary assistant-send"
                disabled={
                  blocked ||
                  !!busy ||
                  voiceBusy ||
                  !connected ||
                  text.length > 4000 ||
                  (!text.trim() && !attachments.length)
                }
              >
                {busy === 'start' ? (
                  <LoaderCircle className="assistant-spin" size={18} />
                ) : (
                  <Send size={18} />
                )}
                {canReply ? 'Send reply' : 'Send'}
              </button>
            </div>
            {text.length > 4000 && (
              <p role="alert" className="assistant-alert">
                Shorten your instruction to 4,000 characters before sending.
                Your full transcript is above.
              </p>
            )}
            <small className="assistant-file-hint">
              Up to 5 files · JPG, PNG, WebP, PDF, CSV or TXT · 4 MB each, 12 MB
              total.
            </small>
            <small>
              {blocked
                ? running
                  ? 'The assistant is working. You can reply when it finishes.'
                  : 'Review the current task before starting a different conversation.'
                : 'Recordings are sent for transcription when you stop. Instructions and files are sent when you press Send.'}
            </small>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AttachmentPreview({
  file,
  remove,
  disabled,
}: {
  file: File;
  remove: () => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return (
    <div className="assistant-attachment">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <FileText size={24} aria-hidden="true" />
      )}
      <span title={file.name}>
        {file.name}
        <small>
          {file.size < 1024 * 1024
            ? `${Math.ceil(file.size / 1024)} KB`
            : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
        </small>
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        onClick={remove}
      >
        <X size={18} />
      </button>
    </div>
  );
}
