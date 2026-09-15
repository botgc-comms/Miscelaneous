import test from 'node:test';
import assert from 'node:assert/strict';
import { demoState } from '../work/tests/demo.mjs';
import {
  applyAction,
  projectState,
  organiserClubs,
  upgradeState,
} from '../work/tests/model.mjs';
import {
  acceptInvitation,
  canManageInvite,
  invitationStatus,
} from '../work/tests/invitations.mjs';
import {
  logoCandidates,
  logoPageProblem,
  safeLogoSvg,
} from '../work/tests/club-logos.mjs';
import { isPublicAddress } from '../work/tests/club-images.mjs';

test('WordPress public image CDN addresses are accepted while special-purpose ranges remain blocked', () => {
  for (const address of ['192.0.77.2', '192.0.78.24', '198.51.99.1'])
    assert.equal(isPublicAddress(address), true);
  for (const address of [
    '192.0.0.1',
    '192.0.2.3',
    '192.168.1.1',
    '192.88.99.2',
    '198.51.100.2',
    '198.18.0.1',
    '127.0.0.1',
    '169.254.169.254',
  ])
    assert.equal(isPublicAddress(address), false);
});

test('SiteGround CAPTCHA redirects are reported as blocked access rather than a missing logo', () => {
  const html =
    '<html><head><link rel="icon" href="data:;"><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F&y=ipc:test"></meta></head></html>';
  assert.match(logoPageProblem(html), /CAPTCHA/);
  assert.equal(
    logoPageProblem('<html><body><img src="/logo.png"></body></html>'),
    null,
  );
});
function setup() {
  const s = structuredClone(demoState());
  const admin = s.members.find((m) => m.role === 'admin'),
    org = s.orgs[0],
    other = s.orgs[1];
  const invite = {
    id: 'new-invite',
    hash: 'secret',
    role: 'organiser',
    orgIds: [org.id],
    leagueIds: [],
    email: admin.email,
    revoked: false,
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
  s.invites.push(invite);
  return { s, admin, org, other, invite };
}
test('admin accepting organiser invitation retains admin and gains club association', () => {
  const { s, admin, org, invite } = setup();
  acceptInvitation(s, invite, {
    userId: admin.id,
    email: admin.email,
    displayName: admin.name,
  });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.organiserOrgId, org.id);
  assert.equal(invitationStatus(invite), 'Accepted');
  assert.equal(invite.revoked, false);
});
test('accepted invitation can be revisited by its recipient without duplicating a membership', () => {
  const { s, admin, invite } = setup();
  const u = { userId: admin.id, email: admin.email, displayName: admin.name };
  acceptInvitation(s, invite, u);
  const time = invite.acceptedAt,
    n = s.members.length;
  acceptInvitation(s, invite, u);
  assert.equal(s.members.length, n);
  assert.equal(invite.acceptedAt, time);
});

test('one admin can accept two club invitations, see both as organiser, and remove only one', () => {
  let { s, admin, org, other, invite } = setup();
  const second = { ...invite, id: 'second', orgIds: [other.id] };
  s.invites.push(second);
  const u = { userId: admin.id, email: admin.email, displayName: admin.name };
  acceptInvitation(s, invite, u);
  acceptInvitation(s, second, u);
  assert.equal(admin.role, 'admin');
  assert.deepEqual(organiserClubs(admin), [org.id, other.id]);
  assert.equal(invitationStatus(second), 'Accepted');
  const scoped = {
    ...admin,
    role: 'organiser',
    orgIds: organiserClubs(admin),
    leagueIds: [],
  };
  s.fixtures = [];
  assert.deepEqual(
    projectState(s, scoped)
      .orgs.map((o) => o.id)
      .sort(),
    [org.id, other.id].sort(),
  );
  s = applyAction(s, admin, {
    type: 'organiser-remove',
    memberId: admin.id,
    orgId: org.id,
  });
  assert.deepEqual(organiserClubs(s.members.find((m) => m.id === admin.id)), [
    other.id,
  ]);
  upgradeState(s);
  assert.deepEqual(organiserClubs(s.members.find((m) => m.id === admin.id)), [
    other.id,
  ]);
});

test('legacy admin affiliations recover accepted invitations but never pending or revoked ones', () => {
  const { s, admin, org, other, invite } = setup();
  admin.organiserOrgId = other.id;
  Object.assign(invite, {
    acceptedAt: new Date().toISOString(),
    acceptedBy: admin.id,
  });
  s.invites.push({
    ...invite,
    id: 'revoked',
    orgIds: [s.orgs[2].id],
    revoked: true,
  });
  s.invites.push({
    ...invite,
    id: 'pending',
    orgIds: [s.orgs[3].id],
    acceptedAt: undefined,
    acceptedBy: undefined,
  });
  upgradeState(s);
  assert.deepEqual(organiserClubs(admin), [other.id, org.id]);
  upgradeState(s);
  assert.deepEqual(organiserClubs(admin), [other.id, org.id]);
});
test('wrong email, expired and revoked links cannot grant organiser access', () => {
  for (const kind of ['email', 'expired', 'revoked']) {
    const { s, admin, invite } = setup();
    if (kind === 'expired') invite.expires = '2000-01-01';
    if (kind === 'revoked') invite.revoked = true;
    assert.throws(() =>
      acceptInvitation(s, invite, {
        userId: 'new-person',
        email: kind === 'email' ? 'wrong@example.org' : admin.email,
        displayName: 'Person',
      }),
    );
    assert.ok(!s.members.some((m) => m.id === 'new-person'));
  }
});
test('different organisers can accept invitations for the same club', () => {
  const { s, org, invite } = setup();
  for (const id of ['one', 'two']) {
    const i = { ...invite, id, email: `${id}@example.org` };
    s.invites.push(i);
    acceptInvitation(s, i, { userId: id, email: i.email, displayName: id });
  }
  assert.deepEqual(
    s.members.filter((m) => ['one', 'two'].includes(m.id)).map((m) => m.orgIds),
    [[org.id], [org.id]],
  );
});
test('organiser can invite a colleague only to their own club', () => {
  const { s, org, other, invite } = setup();
  const m = {
    id: 'helper',
    name: 'Helper',
    email: 'helper@example.org',
    phone: '',
    role: 'organiser',
    orgIds: [org.id],
    leagueIds: [],
  };
  s.members.push(m);
  const action = {
    type: 'invite',
    role: 'organiser',
    orgIds: [org.id],
    leagueIds: [],
    email: 'colleague@example.org',
    hash: 'new-hash',
  };
  const next = applyAction(s, m, action);
  assert.equal(next.invites.at(-1).email, action.email);
  assert.throws(() => applyAction(s, m, { ...action, orgIds: [other.id] }));
  assert.throws(() => applyAction(s, m, { ...action, role: 'admin' }));
  assert.ok(canManageInvite(s, m, invite));
});
test('only admin can remove club organiser; removal preserves other club access and prevents old-link replay', () => {
  const { s, admin, org, other, invite } = setup();
  const person = {
    id: 'helper',
    name: 'Helper',
    email: invite.email,
    phone: '',
    role: 'organiser',
    orgIds: [org.id, other.id],
    leagueIds: [],
  };
  s.members.push(person);
  invite.acceptedAt = new Date().toISOString();
  invite.acceptedBy = person.id;
  assert.throws(() =>
    applyAction(s, person, {
      type: 'organiser-remove',
      memberId: person.id,
      orgId: org.id,
    }),
  );
  const next = applyAction(s, admin, {
    type: 'organiser-remove',
    memberId: person.id,
    orgId: org.id,
  });
  assert.deepEqual(next.members.find((m) => m.id === person.id).orgIds, [
    other.id,
  ]);
  assert.throws(() =>
    acceptInvitation(
      next,
      next.invites.find((i) => i.id === invite.id),
      { userId: person.id, email: person.email, displayName: person.name },
    ),
  );
});
test('pending duplicate email and club is rejected and invitation secrets remain redacted', () => {
  const { s, admin, org, invite } = setup();
  assert.throws(
    () =>
      applyAction(s, admin, {
        type: 'invite',
        role: 'organiser',
        orgIds: [org.id],
        leagueIds: [],
        email: invite.email,
        hash: 'x',
      }),
    /already a pending/,
  );
  assert.equal(
    projectState(s, admin).invites.find((i) => i.id === invite.id).hash,
    '',
  );
});
test('logo discovery favours club identity and excludes accreditation and course images', () => {
  const values = logoCandidates(
    `<img src="/golf-course.jpg" alt="Course"><img src="/logo.png" alt="Club logo"><img src="https://englandgolf.org/logo.png" alt="England Golf"><img src="/safegolf-logo.png"><script type="application/ld+json">{"logo":"/crest.svg"}</script>`,
    'https://club.co.uk',
  );
  assert.equal(values[0].url, 'https://club.co.uk/crest.svg');
  assert.ok(values.some((v) => v.url.endsWith('/logo.png')));
  assert.ok(!values.some((v) => /safegolf|englandgolf|course/.test(v.url)));
});
test('vector logo sanitisation preserves artwork and rejects scripts, entities and external content', () => {
  const bytes = (s) => new TextEncoder().encode(s);
  assert.equal(
    safeLogoSvg(bytes('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>')),
    '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
  );
  for (const svg of [
    '<svg><script>alert(1)</script></svg>',
    '<!DOCTYPE svg><svg/>',
    '<svg onload="alert(1)"></svg>',
    '<svg><image href="https://host.test/a"/></svg>',
    '<svg><foreignObject/></svg>',
  ])
    assert.equal(safeLogoSvg(bytes(svg)), null);
});

test('finds the Alfreton header logo and follows nested logo containers with unlabelled images', () => {
  const url =
    'https://alfretongolfclub.co.uk/wp-content/uploads/2017/10/6840c60f21-logos-illustrations-logo-vector-white-background-012015.png';
  const html = `<div id="main-logo" class="navbar-header style-light"><a href="https://alfretongolfclub.co.uk/" class="navbar-brand" aria-label="Alfreton Golf Club"><div class="logo-image main-logo logo-skinnable" style="height: 45px;"><img decoding="async" src="${url}" alt="logo" width="152" height="152" class="img-responsive"></div></a></div>`;
  assert.equal(
    logoCandidates(html, 'https://alfretongolfclub.co.uk/')[0].url,
    url,
  );
  for (const attribute of [
    'id="main-logo"',
    'class="site-logo"',
    'style="--logo-height: 45px"',
  ]) {
    const candidates = logoCandidates(
      `<div ${attribute}><a><span><img src=/assets/123.png></span></a></div><div><img src=/course.jpg></div>`,
      'https://club.co.uk',
    );
    assert.deepEqual(
      candidates.map((c) => c.url),
      ['https://club.co.uk/assets/123.png'],
    );
  }
});

test('header logos outrank footer branding; lazy images, entities and escaped structured URLs work', () => {
  const candidates = logoCandidates(
    `<footer class="logo"><img src="/partner.png"></footer>
    <header><a class="brand-logo"><img src="data:image/gif;base64,AA" data-src="/identity.png?a=1&amp;b=2"><img data-srcset="/identity-small.png 100w, /identity-large.png 400w"></a></header>
    <!-- <img src="/comment-logo.png"> --><script>const example='<img src="/script-logo.png">'</script>`,
    'https://club.co.uk',
  );
  assert.equal(candidates[0].url, 'https://club.co.uk/identity.png?a=1&b=2');
  assert.ok(candidates.some((c) => c.url.endsWith('identity-large.png')));
  assert.ok(!candidates.some((c) => /comment|script|data:/.test(c.url)));
  const structured = logoCandidates(
    '<script type="application/ld+json">{"logo":"https:\\/\\/club.co.uk\\/crest.svg"}</script>',
    'https://club.co.uk',
  );
  assert.equal(structured[0].url, 'https://club.co.uk/crest.svg');
});
