import { upgradeState, type State, type Player } from './model';
import { demoState } from './demo';
export function hasCustomSetup(s: State) {
  const seed = demoState();
  return (['leagues', 'orgs', 'teams', 'clubs', 'fixtures'] as const).some(
    (key) =>
      s[key].some(
        (item) =>
          !seed[key].some(
            (original) =>
              original.id === item.id && original.name === item.name,
          ),
      ),
  );
}
export function isEnteredChild(p: Player) {
  const original = demoState().players.find((child) => child.id === p.id);
  return (
    !original ||
    !!p.familyManaged ||
    !!p.photoKey ||
    (
      [
        'name',
        'dob',
        'handicap',
        'diet',
        'care',
        'photoConsent',
        'emergencyName',
        'emergencyPhone',
      ] as const
    ).some((key) => p[key] !== original[key])
  );
}
export function adoptWorkspace(
  s: State,
  owner: { userId: string; displayName: string; email: string },
) {
  s = upgradeState(structuredClone(s));
  if (!s.members.some((m) => m.id === owner.userId))
    s.members.push({
      id: owner.userId,
      name: owner.displayName,
      email: owner.email,
      phone: '',
      role: 'admin',
      leagueIds: [],
      orgIds: [],
    });
  // Preserve entered children and their existing team links; seeded example children keep their original guardian.
  for (const p of s.players)
    if (p.parentId === 'demo-parent' && isEnteredChild(p))
      p.parentId = owner.userId;
  return s;
}
