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
  assert.match(studio, /data-email-editor-action="image"/);
  assert.match(studio, /id="memberEmailImagePicker"/);
  assert.match(studio, /id="useLatestMemberEmailArtwork"/);
  assert.match(studio, /id="memberEmailImageInput"[^>]*accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.doesNotMatch(studio, />HTML email body</);
  assert.match(studio, /id="memberEmailBody" hidden/);
});

test('email images can be inserted without regenerating or replacing edited copy', () => {
  const stage = functionSource(posterSource, 'stageMemberEmailImage');
  const insert = functionSource(posterSource, 'insertMemberEmailImage');
  const latest = functionSource(posterSource, 'insertLatestMemberEmailArtwork');
  const upload = functionSource(posterSource, 'insertUploadedMemberEmailImage');
  const regenerate = functionSource(posterSource, 'requestMemberEmailDraftRegeneration');
  assert.match(stage, /\/api\/poster\/member-email\/stage-artwork/);
  assert.match(insert, /document\.execCommand\('insertHTML'/);
  assert.match(insert, /captureMemberEmailDialog\(session\)/);
  assert.match(latest, /getSquareMemberEmailArtwork\(session\)/);
  assert.match(upload, /prepareUploadedMemberEmailImage\(file\)/);
  assert.match(regenerate, /This replaces the current subject and body/);
  assert.match(regenerate, /use the Image button/);
});

test('pasted and dropped email images use the hosted-image workflow instead of inline data', () => {
  assert.match(posterSource, /emailEditor\?\.addEventListener\('paste'/);
  assert.match(posterSource, /emailEditor\?\.addEventListener\('drop'/);
  assert.match(functionSource(posterSource, 'prepareUploadedMemberEmailImage'), /MEMBER_EMAIL_IMAGE_MAX_DIMENSION/);
  assert.match(functionSource(posterSource, 'insertUploadedMemberEmailImage'), /stageMemberEmailImage/);
  assert.match(styleSource, /\.member-email-image-picker/);
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
