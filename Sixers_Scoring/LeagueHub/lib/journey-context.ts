export type JourneyContext = {
  demo: boolean;
  workspace: string;
  stage: string;
};
const key = 'golfsixes-journey-context';
export function readJourney(): JourneyContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value && typeof value.workspace === 'string'
      ? { demo: false, workspace: value.workspace, stage: 'ready' }
      : null;
  } catch {
    return null;
  }
}
export function rememberJourney(value: JourneyContext) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...value, demo: false, stage: 'ready' }),
    );
  } catch {
    /* Only the navigation preference is optional. */
  }
}
export function staffJourney(
  _demo: boolean,
  workspace: string,
): JourneyContext {
  return { demo: false, workspace, stage: 'ready' };
}
export function roleHref(role: string, context: JourneyContext | null) {
  const q = new URLSearchParams({
    role,
    view:
      role === 'parent' ? 'parent' : role === 'staff' ? 'organiser' : 'admin',
  });
  if (role !== 'parent' && context?.workspace)
    q.set('workspace', context.workspace);
  return '/?' + q;
}
export function parentJourney(
  _search: string,
  _remembered: JourneyContext | null,
) {
  return { demo: false, stage: 'ready' };
}
