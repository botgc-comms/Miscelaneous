import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const clubLogos = sqliteTable(
  'club_logos',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace').notNull(),
    clubId: text('club_id').notNull(),
    website: text('website').notNull(),
    revision: integer('revision').notNull().default(0),
    data: text('data').notNull(),
  },
  (t) => [index('club_logos_workspace').on(t.workspace)],
);
export const assistantJobs = sqliteTable(
  'assistant_jobs',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace').notNull(),
    created: text('created').notNull(),
    revision: integer('revision').notNull().default(0),
    data: text('data').notNull(),
  },
  (t) => [index('assistant_jobs_workspace_created').on(t.workspace, t.created)],
);
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  demo: integer('demo').notNull().default(0),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updated: text('updated').notNull(),
});
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
});
export const teamCodes = sqliteTable('team_codes', {
  code: text('code').primaryKey(),
  workspace: text('workspace').notNull(),
  teamId: text('team_id').notNull(),
  expires: text('expires').notNull(),
  revoked: integer('revoked').notNull().default(0),
});
export const authChallenges = sqliteTable('auth_challenges', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  hash: text('hash').notNull(),
  expires: text('expires').notNull(),
  attempts: integer('attempts').notNull().default(0),
});
export const sessions = sqliteTable('sessions', {
  method: text('method').notNull().default('legacy'),
  hash: text('hash').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  userId: text('user_id').notNull(),
  expires: text('expires').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expires: integer('expires').notNull(),
});
export const liveViewDates = sqliteTable('live_view_dates', {
  sessionHash: text('session_hash')
    .primaryKey()
    .references(() => sessions.hash, { onDelete: 'cascade' }),
  today: text('today').notNull(),
});

export const accounts = sqliteTable('accounts', {
  email: text('email').primaryKey(),
  userId: text('user_id').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub').unique(),
  verifiedAt: text('verified_at').notNull(),
});
export const accountChallenges = sqliteTable('account_challenges', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  hash: text('hash').notNull(),
  expires: text('expires').notNull(),
  attempts: integer('attempts').notNull().default(0),
});
export const demoSessions = sqliteTable('demo_sessions', {
  sessionHash: text('session_hash').primaryKey(),
  owner: text('owner').notNull(),
  workspace: text('workspace').notNull(),
  actor: text('actor').notNull(),
  today: text('today'),
});
export const emailOutbox = sqliteTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace'),
    recipient: text('recipient').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: text('available_at').notNull(),
    createdAt: text('created_at').notNull(),
    sentAt: text('sent_at'),
    providerId: text('provider_id'),
    error: text('error'),
  },
  (t) => [index('email_outbox_pending').on(t.status, t.availableAt)],
);
