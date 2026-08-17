import type { BuildOptions } from "../engine";

export function normalizeConstraintBuild(build: BuildOptions): BuildOptions {
  const traits = build.traits.filter(Boolean).slice(0, 2);
  const plushies = build.plushies.filter(Boolean).slice(0, 2);
  return {
    ...build,
    traits,
    plushies,
    ascensionAssignments: [...build.ascensionAssignments],
    elder: build.elder ?? "None",
  };
}

export function sanitizeBuildForExclusions(
  build: BuildOptions,
  excludedTraits: readonly string[],
  excludedPlushies: readonly string[],
): BuildOptions {
  const excludedTraitSet = new Set(excludedTraits);
  const excludedPlushieSet = new Set(excludedPlushies);
  const traits = build.traits.filter((trait) => trait && !excludedTraitSet.has(trait)).slice(0, 2);
  const plushies = build.plushies.filter((plushie) => plushie && !excludedPlushieSet.has(plushie)).slice(0, 2);
  return {
    ...build,
    traits,
    plushies,
    elder: build.elder ?? "None",
    ascensionAssignments: build.ascensionAssignments.map((assignment) =>
      assignment && excludedTraitSet.has(assignment) ? "" : assignment,
    ),
  };
}

export function applyConstraintLocks({
  targetConstraints,
  targetTraitLock,
  targetAscensionLock,
  targetPlushieLock,
  targetElderLock,
}: {
  targetConstraints: BuildOptions;
  targetTraitLock: boolean;
  targetAscensionLock: boolean;
  targetPlushieLock: boolean;
  targetElderLock?: boolean;
}): BuildOptions {
  const normalizedTargetConstraintsRaw = normalizeConstraintBuild(targetConstraints);
  return {
    ...normalizedTargetConstraintsRaw,
    traits: targetTraitLock ? normalizedTargetConstraintsRaw.traits : [],
    ascensionAssignments:
      targetTraitLock && targetAscensionLock
        ? normalizedTargetConstraintsRaw.ascensionAssignments
        : ["", "", "", "", ""],
    plushies: targetPlushieLock ? normalizedTargetConstraintsRaw.plushies : [],
    elder: targetElderLock ? normalizedTargetConstraintsRaw.elder ?? "None" : "None",
  };
}
