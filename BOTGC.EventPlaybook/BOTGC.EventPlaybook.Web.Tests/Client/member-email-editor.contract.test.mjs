import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbookSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url),
  'utf8');
const posterSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url),
  'utf8');
const styleSource = await readFile(
  new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook.css', import.meta.url),
  'utf8');

function functionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected ${name}() to be declared.`);
  const nextDeclaration = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextDeclaration.lastIndex = match.index + match[0].length;
  const next = nextDeclaration.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

test('member emails use a rich-text editor instead of exposing HTML', () => {
  const studio = functionSource(playbookSource, 'renderArtworkStudio');
  assert.match(studio, /id="memberEmailEditor"[^>]*contenteditable="true"/);
  assert.match(studio, /id="memberEmailToolbar"/);
  assert.match(studio, /data-email-editor-command="bold"/);
  assert.match(studio, /data-email-editor-command="insertUnorderedList"/);
  assert.match(studio, /data-email-editor-action="link"/);
  assert.doesNotMatch(studio, />HTML email body</);
  assert.match(studio, /id="memberEmailBody" hidden/);
});

test('member diary entries reuse the visual rich-text editor instead of exposing HTML', () => {
  const studio = functionSource(playbookSource, 'renderArtworkStudio');
  assert.match(studio, /id="memberDiaryEditor"[^>]*contenteditable="true"/);
  assert.match(studio, /id="memberDiaryToolbar"/);
  assert.match(studio, /data-rich-text-command="bold"/);
  assert.match(studio, /data-rich-text-command="insertUnorderedList"/);
  assert.match(studio, /data-rich-text-action="link"/);
  assert.doesNotMatch(studio, />HTML diary body</);
  assert.match(studio, /id="memberDiaryDescription" hidden/);
});

test('rich-text changes remain the canonical HTML used for preview and delivery', () => {
  assert.match(functionSource(posterSource, 'captureMemberEmailDialog'), /emailEditor\?\.innerHTML/);
  assert.match(functionSource(posterSource, 'generateMemberEmailDraft'), /setMemberEmailEditorHtml\(session\.form\.emailBodyHtml\)/);
  assert.match(functionSource(posterSource, 'renderMemberEmailPreview'), /sanitiseMemberEmailHtml/);
  assert.match(functionSource(posterSource, 'sendMemberEmailTest'), /bodyHtml: session\.form\.emailBodyHtml/);
  assert.match(functionSource(posterSource, 'sendMemberCampaignEmail'), /bodyHtml: session\.form\.emailBodyHtml/);
});

test('member diary edits are sanitised and used for preview and publication', () => {
  assert.match(functionSource(posterSource, 'captureMemberDiaryDialog'), /diaryEditor\?\.innerHTML/);
  assert.match(functionSource(posterSource, 'generateMemberDiaryDraft'), /setMemberDiaryEditorHtml\(session\.form\.diaryDescription\)/);
  assert.match(functionSource(posterSource, 'renderMemberDiaryPreview'), /sanitiseMemberEmailHtml/);
  assert.match(functionSource(posterSource, 'addToMemberDiary'), /description: session\.form\.diaryDescription/);
  assert.match(functionSource(posterSource, 'bindRichTextEditor'), /applyRichTextEditorAction/);
});

test('the editor sanitises pasted markup and is styled like a document editor', () => {
  const sanitiser = functionSource(posterSource, 'sanitiseMemberEmailHtml');
  assert.match(sanitiser, /MEMBER_EMAIL_ALLOWED_ELEMENTS/);
  assert.match(sanitiser, /name\.startsWith\('on'\)/);
  assert.match(sanitiser, /isSafeMemberEmailUrl/);
  assert.match(styleSource, /\.member-email-editor-toolbar/);
  assert.match(styleSource, /\.member-email-rich-editor/);
  assert.match(styleSource, /\.member-email-rich-editor:empty::before/);
});
