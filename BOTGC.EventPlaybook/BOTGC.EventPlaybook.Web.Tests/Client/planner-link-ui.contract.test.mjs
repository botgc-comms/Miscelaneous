import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/playbook-app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const posterSourcePath = new URL('../../BOTGC.EventPlaybook.Web/wwwroot/poster-app.js', import.meta.url);
const posterSource = await readFile(posterSourcePath, 'utf8');

function functionSource(name, targetSource = source) {
    const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = declaration.exec(targetSource);
    assert.ok(match, `Expected playbook-app.js to declare ${name}().`);

    const followingDeclaration = /\n(?:  )?(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
    followingDeclaration.lastIndex = match.index + match[0].length;
    const next = followingDeclaration.exec(targetSource);
    return targetSource.slice(match.index, next?.index ?? targetSource.length);
}

test('the relink action is only rendered from Intelligent Golf linked-event state', () => {
    const actionMarker = '>Change linked planner event</button>';
    const actionIndex = source.indexOf(actionMarker);

    assert.notEqual(actionIndex, -1, 'Expected a Change linked planner event action.');
    const renderContext = source.slice(Math.max(0, actionIndex - 2500), actionIndex + actionMarker.length + 500);
    assert.match(renderContext, /intelligentGolfEnabled/);
    assert.match(renderContext, /\.linked\b/);
    assert.match(renderContext, /Change linked planner event/);
});

test('opening the relink dialog obtains fresh candidates with the read-only endpoint', () => {
    const openDialog = functionSource('openIntelligentGolfPlannerLinkDialog');

    assert.match(
        openDialog,
        /\/api\/integrations\/intelligent-golf\/events\/\$\{encodeURIComponent\([^)]*\)\}\/planner-candidates/
    );
    assert.match(openDialog, /cache:\s*['"]no-store['"]/);
    assert.doesNotMatch(openDialog, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('the relink dialog identifies the current entry and prevents conflicting choices', () => {
    const normaliseCandidates = functionSource('normaliseIntelligentGolfPlannerCandidates');
    const renderDialog = functionSource('renderIntelligentGolfPlannerLinkDialog');

    assert.match(normaliseCandidates, /linkedToAnotherPlaybookEvent/);
    assert.match(renderDialog, /id="ig-planner-link-dialog"/);
    assert.match(renderDialog, /name="ig-planner-link-candidate"/);
    assert.match(renderDialog, /Currently linked/i);
    assert.match(renderDialog, /candidate\.current/);
    assert.match(renderDialog, /linkedToAnotherPlaybookEvent/);
    assert.match(renderDialog, /disabled/);
    assert.match(renderDialog, /data-close-ig-planner-link/);
    assert.match(renderDialog, /data-confirm-ig-planner-link disabled/);
});

test('confirming a relink posts the chosen and expected current planner IDs', () => {
    const saveLink = functionSource('saveIntelligentGolfPlannerLink');

    assert.match(
        saveLink,
        /\/api\/integrations\/intelligent-golf\/events\/\$\{encodeURIComponent\([^)]*\)\}\/planner-link/
    );
    assert.match(saveLink, /method:\s*['"]POST['"]/i);
    assert.match(saveLink, /['"]Content-Type['"]:\s*['"]application\/json['"]/i);
    assert.match(saveLink, /expectedIntelligentGolfEventId/);
    assert.match(saveLink, /intelligentGolfEventId/);
});

test('the action, close control, candidate selection and confirmation are wired', () => {
    const bindEvents = functionSource('bindEvents');

    assert.match(bindEvents, /\[data-action="change-ig-planner-link"\]/);
    assert.match(bindEvents, /openIntelligentGolfPlannerLinkDialog/);
    assert.match(bindEvents, /\[data-close-ig-planner-link\]/);
    assert.match(bindEvents, /input\[name="ig-planner-link-candidate"\]/);
    assert.match(bindEvents, /\[data-confirm-ig-planner-link\]/);
    assert.match(bindEvents, /Number\(selected\.value\)\s*===\s*currentPlannerEntryId/);
    assert.match(bindEvents, /saveIntelligentGolfPlannerLink/);
});

test('linked but unavailable Intelligent Golf status remains refreshable', () => {
    const ensureStatus = functionSource('ensureIntelligentGolfEventStatus');
    const scheduleRefresh = functionSource('scheduleIntelligentGolfStatusRefresh');
    const invalidateCache = functionSource('invalidateIntelligentGolfEventStatusCache');
    const savePlugin = functionSource('savePluginConfiguration');

    assert.match(ensureStatus, /cached\.linked\s*&&\s*cached\.available/);
    assert.match(ensureStatus, /next\.linked\s*&&\s*!next\.available/);
    assert.match(scheduleRefresh, /currentStatus\?\.linked\s*&&\s*currentStatus\.available/);
    assert.match(scheduleRefresh, /status\?\.linked\s*&&\s*status\.available/);
    assert.match(invalidateCache, /intelligentGolfStatusCacheEpoch\s*\+=\s*1/);
    assert.match(savePlugin, /invalidateIntelligentGolfEventStatusCache\(\)/);
});

test('a failed candidate reload is not described as successfully refreshed', () => {
    const saveLink = functionSource('saveIntelligentGolfPlannerLink');

    assert.match(saveLink, /const candidatesRefreshed\s*=\s*await openIntelligentGolfPlannerLinkDialog\(\)/);
    assert.match(saveLink, /if \(candidatesRefreshed\)/);
    assert.match(saveLink, /else if \(!intelligentGolfPlannerLinkDialogState\.error\)/);
});

test('the relink modal restores focus to its initiating action', () => {
    const restoreFocus = functionSource('restoreIntelligentGolfPlannerLinkFocus');
    const closeDialog = functionSource('closeIntelligentGolfPlannerLinkDialog');
    const bindEvents = functionSource('bindEvents');

    assert.match(restoreFocus, /\[data-action="change-ig-planner-link"\]:not\(\[disabled\]\)/);
    assert.match(restoreFocus, /\.focus\(\)/);
    assert.match(closeDialog, /restoreIntelligentGolfPlannerLinkFocus\(\)/);
    assert.match(bindEvents, /openIntelligentGolfPlannerLinkDialog\(button\)/);
});

test('Communications Centre clears diary publication metadata when the authoritative link changes', () => {
    const reconcilePublication = functionSource('reconcileMemberDiaryPublication', posterSource);
    const initialisePoster = functionSource('initialise', posterSource);
    const refreshDiaryStatus = functionSource('refreshMemberDiaryIntegrationStatus', posterSource);

    assert.match(reconcilePublication, /status\?\.plannerEntryId/);
    assert.match(reconcilePublication, /status\?\.diaryEntryId/);
    assert.match(reconcilePublication, /session\.diaryPublication\s*=\s*null/);
    assert.match(reconcilePublication, /configureShareConnections\(session\)/);
    assert.match(reconcilePublication, /scheduleSessionPersistence\(session\)/);
    assert.match(initialisePoster, /refreshMemberDiaryIntegrationStatus\(session\)/);
    assert.match(refreshDiaryStatus, /reconcileMemberDiaryPublication\(session, status\)/);
});
