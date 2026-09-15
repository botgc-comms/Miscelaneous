import { db, files, saveCAS, type Row } from './server';
import { discoverClubImage } from './club-images';
import type { Club, State } from './model';
export async function processClubImages(workspace: string, jobs: Club[]) {
  const signal = AbortSignal.timeout(20000);
  const completed: { club: Club; key?: string; source?: string }[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const club = jobs[cursor++];
        let key: string | undefined;
        try {
          const image = await discoverClubImage(club.website!, signal);
          key = `club-images/${workspace}/${club.id}/${crypto.randomUUID()}`;
          await files().put(key, image.bytes, {
            httpMetadata: { contentType: image.type },
          });
          completed.push({ club, key, source: image.source });
        } catch {
          if (key)
            await files()
              .delete(key)
              .catch(() => {});
          completed.push({ club });
        }
      }
    }),
  );
  let saved = false;
  const kept = new Set<string>();
  try {
    for (let retry = 0; retry < 6; retry++) {
      const row = await db()
        .prepare('SELECT * FROM workspaces WHERE id=?')
        .bind(workspace)
        .first<Row>();
      if (!row) break;
      const state = JSON.parse(row.data) as State;
      kept.clear();
      const obsolete: string[] = [];
      for (const result of completed) {
        const club = state.clubs.find(
          (c) =>
            c.id === result.club.id &&
            c.imageJobId === result.club.imageJobId &&
            c.imageStatus === 'pending',
        );
        if (!club) continue;
        if (result.key) {
          if (club.imageKey) obsolete.push(club.imageKey);
          club.imageKey = result.key;
          club.imageSource = result.source;
          kept.add(result.key);
          club.imageStatus = 'ready';
        } else club.imageStatus = 'unavailable';
      }
      if (await saveCAS(row, state)) {
        saved = true;
        if (obsolete.length)
          await files()
            .delete(obsolete)
            .catch(() => {});
        break;
      }
    }
  } finally {
    const unused = completed
      .filter((r) => r.key && (!saved || !kept.has(r.key)))
      .map((r) => r.key!);
    if (unused.length)
      await files()
        .delete(unused)
        .catch(() => {});
  }
}
