import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildOptions } from "../engine/types";
import { plushies } from "../engine/buildData";
import { getCreatureByName } from "../engine/creatureData";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";
import { baseChannels, type SpeedReadout } from "../speed/speedChannels";
import { buildContext, evaluateSpeed, offeredEffects, type SpeedContribution } from "../speed/speedMath";
import { searchSpeedBuilds, type SpeedCandidate, type SpeedTarget } from "../speed/speedSearch";
import {
  DEFAULT_MANUAL_BUILD,
  DEFAULT_SPEED_CONSTRAINTS,
  loadSpeedBuildsState,
  offerableEffects,
  pickableTargets,
  readSpeedConstraints,
  saveSpeedBuildsState,
  type SpeedConstraints,
  type SpeedMode,
  type SpeedRankBy,
} from "./speedBuildsShared";

const RANKING_LIMIT = 10;

// Optimize offers every effect the sweep could reach, not only the ones the
// current loadout grants - Sugar Rush rides on the Momo plushie, and the search
// is free to equip Momo. Builds that lack the plushie simply do not pick the
// effect up, so holding it biases the ranking instead of forcing it. A plushie
// the reader has ruled out is not reachable, so its effects leave the list.
const EVERY_PLUSHIE = plushies.map((plushie) => plushie.name);

export type SpeedBuildsSnapshotState = {
  nameA: string;
  mode: SpeedMode;
  target: SpeedTarget;
  rankBy: SpeedRankBy;
  active: string[];
  fillPct: number;
  packmates: number;
  manualBuild: BuildOptions;
  constraints: SpeedConstraints;
};

/** One ranked build as the page reads it: what the sweep ordered on, plus the
 * figure it was not ordered on and the effects behind the peak. */
export type SpeedRankingRow = {
  candidate: SpeedCandidate;
  sustained: SpeedReadout;
  peak: SpeedReadout;
  contributions: SpeedContribution[];
};

export function useSpeedBuildsPageController({
  nameA,
  onNameAChange,
}: {
  nameA: string;
  onNameAChange: (value: string) => void;
}) {
  const stored = useMemo(() => loadSpeedBuildsState(), []);
  const [mode, setMode] = useState<SpeedMode>(stored.mode ?? "optimize");
  const [target, setTarget] = useState<SpeedTarget>(stored.target ?? "sprint");
  const [rankBy, setRankBy] = useState<SpeedRankBy>(stored.rankBy ?? "peak");
  const [active, setActive] = useState<string[]>(stored.active ?? []);
  const [fillPct, setFillPct] = useState(stored.fillPct ?? 100);
  const [packmates, setPackmates] = useState(stored.packmates ?? 0);
  const [manualBuild, setManualBuild] = useState<BuildOptions>(stored.manualBuild ?? DEFAULT_MANUAL_BUILD);
  const [constraints, setConstraints] = useState<SpeedConstraints>(stored.constraints ?? DEFAULT_SPEED_CONSTRAINTS);

  const creature = getCreatureByName(nameA);
  const base = useMemo(() => (creature ? baseChannels(creature) : null), [creature]);
  const targets = useMemo(() => (base ? pickableTargets(base) : []), [base]);
  const effectiveTarget: SpeedTarget = targets.includes(target) ? target : (targets[0] ?? "sprint");

  const probeBuild = useMemo<BuildOptions>(
    () =>
      mode === "manual"
        ? manualBuild
        : {
            ...DEFAULT_MANUAL_BUILD,
            plushies: EVERY_PLUSHIE.filter((name) => !constraints.excludedPlushies.includes(name)),
          },
    [mode, manualBuild, constraints.excludedPlushies],
  );
  const offered = useMemo(
    () => (creature ? offerableEffects(offeredEffects(creature, probeBuild)) : []),
    [creature, probeBuild],
  );
  // Captions for the toggle list. Agile Swimmer and the event buffs scale off
  // the creature, so they have to be resolved rather than written out.
  const captionContext = useMemo(
    () => (creature ? buildContext(creature, probeBuild, fillPct, packmates) : null),
    [creature, probeBuild, fillPct, packmates],
  );
  // An effect the current loadout no longer grants stays in `active` but drops
  // out of the held set, so re-equipping the plushie brings it back on.
  const heldIds = useMemo(
    () => active.filter((id) => offered.some((effect) => effect.id === id)),
    [active, offered],
  );
  // Effects that hold for as long as their condition does never lapse mid-fight,
  // so they belong to what the creature is worth on its own rather than to what
  // it reaches while something is running. They ride both figures.
  const lastingIds = useMemo(
    () => heldIds.filter((id) => offered.some((effect) => effect.id === id && effect.lasting)),
    [heldIds, offered],
  );
  const appetiteMatters = heldIds.includes("gourmandizer");
  const packmatesMatter = heldIds.includes("sea_school");

  // The sweep orders on whatever it is handed, so ranking on sustained is this
  // same search with nothing held rather than a re-sort of a peak-ranked top
  // ten - the best sustained build need not be in it.
  const ranking = useMemo(() => {
    if (mode !== "optimize" || !creature) return null;
    return searchSpeedBuilds({
      creature,
      target: effectiveTarget,
      active: rankBy === "peak" ? heldIds : lastingIds,
      fillPct,
      packmates,
      excludedPlushies: constraints.excludedPlushies,
      requiredPlushies: constraints.requiredPlushies,
      lockedElder: constraints.elder ?? undefined,
      lockedTraits: constraints.traits ?? undefined,
      lockedAscension: constraints.ascensionAssignments,
      venerationStage: constraints.venerationStage,
      limit: RANKING_LIMIT,
    });
  }, [mode, creature, effectiveTarget, rankBy, heldIds, lastingIds, fillPct, packmates, constraints]);

  const manual = useMemo(() => {
    if (mode !== "manual" || !creature) return null;
    return evaluateSpeed({ creature, build: manualBuild, active: heldIds, fillPct, packmates });
  }, [mode, creature, manualBuild, heldIds, fillPct, packmates]);

  // Only an effect that can lapse splits the figure in two. Hold nothing but
  // lasting ones and the pair would print the same number twice on every row.
  const holding = heldIds.some((id) => !lastingIds.includes(id));

  // The figure the sweep was not ordered on, one evaluation per row. With
  // nothing held the two agree and the sweep has already produced both, so no
  // build is ever evaluated twice.
  const rankingRows = useMemo<SpeedRankingRow[]>(() => {
    if (!ranking || !creature) return [];
    return ranking.candidates.map((candidate) => {
      if (!holding) {
        return { candidate, sustained: candidate.readout, peak: candidate.readout, contributions: candidate.contributions };
      }
      if (rankBy === "peak") {
        const bare = evaluateSpeed({ creature, build: candidate.build, active: lastingIds, fillPct, packmates });
        return { candidate, sustained: bare.final, peak: candidate.readout, contributions: candidate.contributions };
      }
      const held = evaluateSpeed({ creature, build: candidate.build, active: heldIds, fillPct, packmates });
      return { candidate, sustained: candidate.readout, peak: held.final, contributions: held.contributions };
    });
  }, [ranking, creature, holding, rankBy, heldIds, lastingIds, fillPct, packmates]);

  const manualSustained = useMemo<SpeedReadout | null>(() => {
    if (mode !== "manual" || !creature) return null;
    if (!holding) return manual?.final ?? null;
    return evaluateSpeed({ creature, build: manualBuild, active: lastingIds, fillPct, packmates }).final;
  }, [mode, creature, manualBuild, holding, lastingIds, fillPct, packmates, manual]);

  const best: SpeedCandidate | undefined = ranking?.candidates[0];
  // The sweep picks one elder and one trait by measurement and then varies only
  // the plushies, so every row carries the same build but for its slots. The
  // page states that build once, above the ranking.
  const fixedChoice: BuildOptions | null = best ? best.build : null;
  // Whichever build the channel readout and the breakdown describe: the winner
  // in Optimize, what the player assembled in Manual.
  const subject = useMemo(() => {
    if (mode === "manual") {
      return manual && manualSustained
        ? { build: manualBuild, sustained: manualSustained, peak: manual.final, contributions: manual.contributions }
        : null;
    }
    const winner = rankingRows[0];
    if (!winner) return null;
    return {
      build: winner.candidate.build,
      sustained: winner.sustained,
      peak: winner.peak,
      contributions: winner.contributions,
    };
  }, [mode, manual, manualSustained, manualBuild, rankingRows]);

  useEffect(() => {
    saveSpeedBuildsState({ mode, target: effectiveTarget, rankBy, active, fillPct, packmates, manualBuild, constraints });
  }, [mode, effectiveTarget, rankBy, active, fillPct, packmates, manualBuild, constraints]);

  // Share-Match provider. Both variants go through this hook, so registering it
  // here is what keeps the two presentations shareable on identical terms. The
  // ref mirrors the setup after every render (no dep array) so the provider,
  // registered once, still reads current values when the button is pressed.
  const snapshotRef = useRef<SpeedBuildsSnapshotState>({
    nameA,
    mode,
    target: effectiveTarget,
    rankBy,
    active,
    fillPct,
    packmates,
    manualBuild,
    constraints,
  });
  useEffect(() => {
    snapshotRef.current = { nameA, mode, target: effectiveTarget, rankBy, active, fillPct, packmates, manualBuild, constraints };
  });
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "speedBuilds",
      getSnapshot: () => {
        const state = snapshotRef.current;
        return {
          pageState: { ...state } as unknown as Record<string, unknown>,
          participantCreatureNames: [state.nameA].filter((name): name is string => Boolean(name)),
        };
      },
      applySnapshot: (pageState) => {
        const state = pageState as Partial<SpeedBuildsSnapshotState>;
        if (typeof state.nameA === "string") onNameAChange(state.nameA);
        if (state.mode !== undefined) setMode(state.mode);
        if (state.target !== undefined) setTarget(state.target);
        if (state.rankBy !== undefined) setRankBy(state.rankBy);
        if (state.active !== undefined) setActive(state.active);
        if (state.fillPct !== undefined) setFillPct(state.fillPct);
        if (state.packmates !== undefined) setPackmates(state.packmates);
        if (state.manualBuild) setManualBuild(state.manualBuild);
        if (state.constraints) setConstraints(readSpeedConstraints(state.constraints));
      },
    });
  }, [onNameAChange]);

  const toggleEffect = (id: string) => {
    setActive((current) => (current.includes(id) ? current.filter((held) => held !== id) : [...current, id]));
  };

  const openInManual = (build: BuildOptions) => {
    setManualBuild(build);
    setMode("manual");
  };

  return {
    creature,
    base,
    targets,
    mode,
    setMode,
    target: effectiveTarget,
    setTarget,
    rankBy,
    setRankBy,
    active,
    setActive,
    toggleEffect,
    heldIds,
    holding,
    offered,
    captionContext,
    fillPct,
    setFillPct,
    appetiteMatters,
    packmates,
    setPackmates,
    packmatesMatter,
    manualBuild,
    setManualBuild,
    constraints,
    setConstraints,
    ranking,
    rankingRows,
    fixedChoice,
    subject,
    openInManual,
  };
}

export type SpeedBuildsController = ReturnType<typeof useSpeedBuildsPageController>;
