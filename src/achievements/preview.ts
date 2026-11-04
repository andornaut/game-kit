// A once-per-run preview of the badges a run would earn if it ended now, for notices during
// play. It awards nothing: the caller awards at the run's end. A preview is looked at again only
// when the caller's key for the subject changes, so the costly earned callback runs only when
// something that can earn a badge has changed, and each badge is previewed at most once a run.

// What the last look was taken at, and the ids previewed so far this run, in preview order.
export interface AchievementPreview<Id> {
  readonly key: string | undefined;
  readonly shown: readonly Id[];
}

// A run's preview before its first look. Start each run from it.
export const NOTHING_PREVIEWED: AchievementPreview<never> = { key: undefined, shown: [] };

// The ids this look newly previews, and the preview to pass to the next look.
export interface PreviewLook<Id> {
  readonly earned: readonly Id[];
  readonly preview: AchievementPreview<Id>;
}

// Looks at subject when keyOf(subject) differs from the last look's key: earned(subject) is
// called, and the ids it returns that are not yet shown are returned, each once, in its order,
// and added to shown. When the key is unchanged, earned is not called, nothing is returned and
// preview is returned unchanged. The caller leaves out ids that must not be previewed (for
// example badges judged only at the run's end) in earned.
export function previewAchievements<Subject, Id>(
  keyOf: (subject: Subject) => string,
  earned: (subject: Subject) => readonly Id[],
  preview: AchievementPreview<Id>,
  subject: Subject,
): PreviewLook<Id> {
  const key = keyOf(subject);
  if (key === preview.key) {
    return { earned: [], preview };
  }
  const shown = new Set<Id>(preview.shown);
  const fresh: Id[] = [];
  for (const id of earned(subject)) {
    if (!shown.has(id)) {
      shown.add(id);
      fresh.push(id);
    }
  }
  return { earned: fresh, preview: { key, shown: [...preview.shown, ...fresh] } };
}
