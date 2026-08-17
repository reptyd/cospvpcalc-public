/**
 * Per-page default page-state values for share-link shrinking.
 *
 * `buildMatchSnapshotForActivePage` drops any top-level page-state field that
 * deep-equals its default here, because every page's `applySnapshot` restores
 * the default for a missing field (each setter is guarded by
 * `if (x !== undefined)`). Most share links never touch special abilities /
 * buffs / builds, so dropping those default-valued objects is the single
 * biggest size win.
 *
 * This is purely an optimisation, and it degrades gracefully: if a default
 * here drifts from the page's real default, the field simply stops being
 * pruned (the link is a few characters longer, never wrong). Defaults are
 * imported from their canonical modules where possible so there is one source
 * of truth; `DEFAULT_BUILD` mirrors App's `defaultBuild` (not exported).
 */

import type { AppPage } from "../AppPageRouter";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../components/compare/compareSpecialAbilities";
import { DEFAULT_COMPARE_BUFF_SELECTION } from "../engine/compareBuffRuntime";

const DEFAULT_BUILD = {
  venerationStage: 0,
  traits: [] as string[],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [] as string[],
  elder: "None",
};

// Resolved lazily (at share time) rather than at module load, so an import
// cycle can't observe a not-yet-initialised default constant.
export function defaultPageStateFor(page: AppPage): Record<string, unknown> {
  if (page === "compare") {
    return {
      specialAbilitiesA: DEFAULT_COMPARE_SPECIAL_ABILITIES,
      specialAbilitiesB: DEFAULT_COMPARE_SPECIAL_ABILITIES,
      compareBuffsA: DEFAULT_COMPARE_BUFF_SELECTION,
      compareBuffsB: DEFAULT_COMPARE_BUFF_SELECTION,
      buildA: DEFAULT_BUILD,
      buildB: DEFAULT_BUILD,
    };
  }
  return {};
}
