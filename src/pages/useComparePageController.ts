import { useEffect, useMemo, useRef, useState } from "react";
import type { PosturePolicyMode } from "../optimizer/rustCompareMatchupRuntime";
import type { CompareSeason } from "../engine/compareSeason";
import { rules } from "../engine/buildData";
import type {
  AbilityTimingMode,
  BreathPolicySetting,
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import { COMPARE_BITE_VARIANT_MODE_DEFAULT } from "../engine";
import { useAbilityCoverage } from "../hooks/useAbilityCoverage";
import { useCompareSimulation } from "../hooks/useCompareSimulation";
import { resolveBadOmenChoice } from "./compareConfig";
import { defaultCompareBuffSelection } from "../components/compare/compareBuffConfig";
import type { CompareBuffSelection, CompareDayNightMode, CompareMoonMode } from "../engine/compareBuffRuntime";
import type { WeatherCondition } from "../engine/weather";
import {
  DEFAULT_OXYGEN_MOISTURE_MODE,
  type OxygenMoistureMode,
} from "../engine/oxygenMoistureMode";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES, type CompareSpecialAbilityState } from "../components/compare/compareSpecialAbilities";
import { DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC, DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT, type AerialDodgeRollStyle } from "../engine/compareAirRule";
import { DEFAULT_COMPARE_DPS_SETTINGS, type CompareDpsSettings, type CompareResultViewMode } from "../components/compare/compareResultView";
import type { CombatEventPhase } from "../engine/eventOrdering";
import {
  buildCompareEffectiveAbilityTimingOverrides,
  sanitizeCompareAbilityTimingOverrideDraft,
  type CompareAbilityTimingOverrideDraft,
} from "../components/compare/compareAbilityTimingPolicy";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";
import { safeReadLocalStorage, safeWriteLocalStorage } from "../shared/safeStorage";

// Shared inputs to the Compare page (default + beta views).
export type ComparePageControllerInput = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  developerMode: boolean;
  trueRoundingMode: boolean;
  combatEventOrder: CombatEventPhase[];
  importedMatchMode: boolean;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (value: BuildOptions) => void;
  onBuildBChange: (value: BuildOptions) => void;
};

type ComparePageSnapshotState = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  compareAbilityPolicy: AbilityTimingMode;
  compareAbilityPolicyOverridesA: CompareAbilityTimingOverrideDraft;
  compareAbilityPolicyOverridesB: CompareAbilityTimingOverrideDraft;
  compareUserAbilityOverridesA: UserAbilityTimingOverrides;
  compareUserAbilityOverridesB: UserAbilityTimingOverrides;
  compareUserAbilityLevelsA: UserAbilityLevelOverrides;
  compareUserAbilityLevelsB: UserAbilityLevelOverrides;
  disabledAbilitiesA: string[];
  disabledAbilitiesB: string[];
  badOmenChoice: string;
  compareBuffsA: CompareBuffSelection;
  compareBuffsB: CompareBuffSelection;
  specialAbilitiesA: CompareSpecialAbilityState;
  specialAbilitiesB: CompareSpecialAbilityState;
  compareDayNight: CompareDayNightMode;
  compareMoon: CompareMoonMode;
  compareSeason: CompareSeason;
  compareWeather: WeatherCondition;
  compareOxygenMoistureMode: OxygenMoistureMode;
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareAirRuleCooldownSecB: number;
  compareAirRuleCooldownLinked: boolean;
  compareAerialDodgeEnabled: boolean;
  compareAerialDodgeHitChancePctA: number;
  compareAerialDodgeHitChancePctB: number;
  compareAerialDodgeRollStyle: AerialDodgeRollStyle;
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  comparePosturePolicyA: PosturePolicyMode;
  comparePosturePolicyB: PosturePolicyMode;
  compareBreathPolicyA: BreathPolicySetting;
  compareBreathPolicyB: BreathPolicySetting;
  resultViewMode: CompareResultViewMode;
  compareDpsSettings: CompareDpsSettings;
  debugMode: boolean;
};

// One setter per snapshot field. Typed as a mapped type so adding a field to
// ComparePageSnapshotState forces a matching apply wiring below; `currentSnapshot`
// (typed as the full state) already forces the capture wiring. Together they make
// the share-link round-trip exhaustive by construction - a new battle setting
// cannot be captured-but-not-applied, or applied-but-not-captured, without a
// compile error, so nothing can silently fail to ride the link.
type ComparePageSnapshotSetters = {
  [K in keyof ComparePageSnapshotState]: (value: ComparePageSnapshotState[K]) => void;
};

const COMPARE_SETTINGS_STORAGE_KEY = "cos.comparePageSettings";

// Serialize the persistable battle settings: the snapshot minus the App-owned
// creature selection (names/builds survive navigation on their own and would
// fight the share-link / default-seeding flows if restored here).
function serializeComparePersist(snapshot: ComparePageSnapshotState): string {
  const settings: Partial<ComparePageSnapshotState> = { ...snapshot };
  delete settings.nameA;
  delete settings.nameB;
  delete settings.buildA;
  delete settings.buildB;
  return JSON.stringify(settings);
}

/**
 * All Compare-page state + the engine simulation wiring, shared by the
 * default ComparePage view and the beta "Fight Playback" view so both
 * drive the engine identically and there is a single source of truth.
 */
export function useComparePageController(input: ComparePageControllerInput) {
  const { nameA, nameB, buildA, buildB, creatureA, creatureB, developerMode, trueRoundingMode, combatEventOrder, importedMatchMode, onNameAChange, onNameBChange, onBuildAChange, onBuildBChange } = input;

  // Hydrate battle settings from the previous session so navigating away from
  // the Compare page and back does not reset them. Read once on mount; a
  // shared-link view (importedMatchMode) keeps its own state and must neither
  // read nor write this store.
  const persisted = useMemo<Partial<ComparePageSnapshotState>>(() => {
    if (importedMatchMode) return {};
    const raw = safeReadLocalStorage(COMPARE_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Partial<ComparePageSnapshotState>;
    } catch {
      return {};
    }
  }, [importedMatchMode]);

  const [activesOn, setActivesOn] = useState(persisted.activesOn ?? (rules.model.activesDefault === "on"));
  const [breathOn, setBreathOn] = useState(persisted.breathOn ?? true);
  const [compareAbilityPolicy, setCompareAbilityPolicy] = useState<AbilityTimingMode>(persisted.compareAbilityPolicy ?? "ideal");
  const [compareAbilityPolicyOverridesA, setCompareAbilityPolicyOverridesA] = useState<CompareAbilityTimingOverrideDraft>(persisted.compareAbilityPolicyOverridesA ?? {});
  const [compareAbilityPolicyOverridesB, setCompareAbilityPolicyOverridesB] = useState<CompareAbilityTimingOverrideDraft>(persisted.compareAbilityPolicyOverridesB ?? {});
  const [compareUserAbilityOverridesA, setCompareUserAbilityOverridesA] = useState<UserAbilityTimingOverrides>(persisted.compareUserAbilityOverridesA ?? {});
  const [compareUserAbilityOverridesB, setCompareUserAbilityOverridesB] = useState<UserAbilityTimingOverrides>(persisted.compareUserAbilityOverridesB ?? {});
  const [compareUserAbilityLevelsA, setCompareUserAbilityLevelsA] = useState<UserAbilityLevelOverrides>(persisted.compareUserAbilityLevelsA ?? {});
  const [compareUserAbilityLevelsB, setCompareUserAbilityLevelsB] = useState<UserAbilityLevelOverrides>(persisted.compareUserAbilityLevelsB ?? {});
  const [disabledAbilitiesA, setDisabledAbilitiesA] = useState<string[]>(persisted.disabledAbilitiesA ?? []);
  const [disabledAbilitiesB, setDisabledAbilitiesB] = useState<string[]>(persisted.disabledAbilitiesB ?? []);
  const [debugMode, setDebugMode] = useState(persisted.debugMode ?? false);
  const [badOmenChoice, setBadOmenChoice] = useState<string>(persisted.badOmenChoice ?? "auto");
  const [compareBuffsA, setCompareBuffsA] = useState(persisted.compareBuffsA ?? defaultCompareBuffSelection);
  const [compareBuffsB, setCompareBuffsB] = useState(persisted.compareBuffsB ?? defaultCompareBuffSelection);
  const [specialAbilitiesA, setSpecialAbilitiesA] = useState<CompareSpecialAbilityState>(persisted.specialAbilitiesA ?? DEFAULT_COMPARE_SPECIAL_ABILITIES);
  const [specialAbilitiesB, setSpecialAbilitiesB] = useState<CompareSpecialAbilityState>(persisted.specialAbilitiesB ?? DEFAULT_COMPARE_SPECIAL_ABILITIES);
  // The nearby-radiated count is logically one matchup figure, so the two sides'
  // radiation fields are kept in lock-step (editing one mirrors to the other);
  // everything else in specialAbilities stays per-side. The mirror uses the raw
  // setter (not the linked wrapper), so there is no feedback loop.
  const setSpecialAbilitiesALinked = (next: CompareSpecialAbilityState) => {
    setSpecialAbilitiesA(next);
    setSpecialAbilitiesB((prev) =>
      prev.radiationNearby === next.radiationNearby && prev.radiationNearbyCount === next.radiationNearbyCount
        ? prev
        : { ...prev, radiationNearby: next.radiationNearby, radiationNearbyCount: next.radiationNearbyCount },
    );
  };
  const setSpecialAbilitiesBLinked = (next: CompareSpecialAbilityState) => {
    setSpecialAbilitiesB(next);
    setSpecialAbilitiesA((prev) =>
      prev.radiationNearby === next.radiationNearby && prev.radiationNearbyCount === next.radiationNearbyCount
        ? prev
        : { ...prev, radiationNearby: next.radiationNearby, radiationNearbyCount: next.radiationNearbyCount },
    );
  };
  const [compareDayNight, setCompareDayNight] = useState<CompareDayNightMode>(persisted.compareDayNight ?? "none");
  const [compareMoon, setCompareMoon] = useState<CompareMoonMode>(persisted.compareMoon ?? "none");
  const [compareSeason, setCompareSeason] = useState<CompareSeason>(persisted.compareSeason ?? "none");
  const [compareWeather, setCompareWeather] = useState<WeatherCondition>(persisted.compareWeather ?? "none");
  const [compareOxygenMoistureMode, setCompareOxygenMoistureMode] = useState<OxygenMoistureMode>(persisted.compareOxygenMoistureMode ?? DEFAULT_OXYGEN_MOISTURE_MODE);
  const [compareBiteVariantModeA, setCompareBiteVariantModeA] = useState<CompareBiteVariantMode>(persisted.compareBiteVariantModeA ?? COMPARE_BITE_VARIANT_MODE_DEFAULT);
  const [compareBiteVariantModeB, setCompareBiteVariantModeB] = useState<CompareBiteVariantMode>(persisted.compareBiteVariantModeB ?? COMPARE_BITE_VARIANT_MODE_DEFAULT);
  const [compareAirRuleEnabled, setCompareAirRuleEnabled] = useState(persisted.compareAirRuleEnabled ?? false);
  const [compareAirRuleCooldownSec, setCompareAirRuleCooldownSec] = useState(persisted.compareAirRuleCooldownSec ?? DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC);
  const [compareAirRuleCooldownSecB, setCompareAirRuleCooldownSecB] = useState(persisted.compareAirRuleCooldownSecB ?? DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC);
  const [compareAirRuleCooldownLinked, setCompareAirRuleCooldownLinked] = useState(persisted.compareAirRuleCooldownLinked ?? true);
  const [compareAerialDodgeEnabled, setCompareAerialDodgeEnabled] = useState(persisted.compareAerialDodgeEnabled ?? false);
  const [compareAerialDodgeHitChancePctA, setCompareAerialDodgeHitChancePctA] = useState(persisted.compareAerialDodgeHitChancePctA ?? DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT);
  const [compareAerialDodgeHitChancePctB, setCompareAerialDodgeHitChancePctB] = useState(persisted.compareAerialDodgeHitChancePctB ?? DEFAULT_AERIAL_DODGE_HIT_CHANCE_PCT);
  const [compareAerialDodgeRollStyle, setCompareAerialDodgeRollStyle] = useState<AerialDodgeRollStyle>(persisted.compareAerialDodgeRollStyle ?? "even");
  const [compareNoMoveFacetank, setCompareNoMoveFacetank] = useState(persisted.compareNoMoveFacetank ?? true);
  const [compareFirstTickMode, setCompareFirstTickMode] = useState<"off" | "ailments" | "regen" | "both">(persisted.compareFirstTickMode ?? "off");
  const [compareFirstTickDelaySec, setCompareFirstTickDelaySec] = useState(persisted.compareFirstTickDelaySec ?? 1);
  const [comparePosturePolicyA, setComparePosturePolicyA] = useState<PosturePolicyMode>(persisted.comparePosturePolicyA ?? "off");
  const [comparePosturePolicyB, setComparePosturePolicyB] = useState<PosturePolicyMode>(persisted.comparePosturePolicyB ?? "off");
  const [compareBreathPolicyA, setCompareBreathPolicyA] = useState<BreathPolicySetting>(persisted.compareBreathPolicyA ?? "auto");
  const [compareBreathPolicyB, setCompareBreathPolicyB] = useState<BreathPolicySetting>(persisted.compareBreathPolicyB ?? "auto");
  const [resultViewMode, setResultViewMode] = useState<CompareResultViewMode>(persisted.resultViewMode ?? "firstDeath");
  const [compareDpsSettings, setCompareDpsSettings] = useState<CompareDpsSettings>(persisted.compareDpsSettings ?? DEFAULT_COMPARE_DPS_SETTINGS);

  const shareSnapshotRef = useRef<ComparePageSnapshotState | null>(null);
  const currentSnapshot: ComparePageSnapshotState = {
    nameA, nameB, buildA, buildB, activesOn, breathOn, compareAbilityPolicy,
    compareAbilityPolicyOverridesA, compareAbilityPolicyOverridesB,
    compareUserAbilityOverridesA, compareUserAbilityOverridesB,
    compareUserAbilityLevelsA, compareUserAbilityLevelsB,
    disabledAbilitiesA, disabledAbilitiesB, badOmenChoice,
    compareBuffsA, compareBuffsB, specialAbilitiesA, specialAbilitiesB,
    compareDayNight, compareMoon, compareSeason, compareWeather, compareOxygenMoistureMode,
    compareBiteVariantModeA, compareBiteVariantModeB,
    compareAirRuleEnabled, compareAirRuleCooldownSec, compareAirRuleCooldownSecB,
    compareAirRuleCooldownLinked, compareAerialDodgeEnabled,
    compareAerialDodgeHitChancePctA, compareAerialDodgeHitChancePctB,
    compareAerialDodgeRollStyle, compareNoMoveFacetank,
    compareFirstTickMode, compareFirstTickDelaySec,
    comparePosturePolicyA, comparePosturePolicyB,
    compareBreathPolicyA, compareBreathPolicyB,
    resultViewMode, compareDpsSettings, debugMode,
  };
  // eslint-disable-next-line react-hooks/refs -- mirror state into ref each render; provider is registered once and reads .current
  shareSnapshotRef.current = currentSnapshot;
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "compare",
      getSnapshot: () => {
        const s = shareSnapshotRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, s.nameB].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<ComparePageSnapshotState>;
        // One setter per snapshot field (see ComparePageSnapshotSetters): the
        // mapped type makes this list exhaustive at compile time, so a field
        // can never be transmitted on the link yet dropped on import. A missing
        // field keeps the page default (the apply loop skips it).
        const setters: ComparePageSnapshotSetters = {
          nameA: onNameAChange,
          nameB: onNameBChange,
          buildA: onBuildAChange,
          buildB: onBuildBChange,
          activesOn: setActivesOn,
          breathOn: setBreathOn,
          compareAbilityPolicy: setCompareAbilityPolicy,
          compareAbilityPolicyOverridesA: setCompareAbilityPolicyOverridesA,
          compareAbilityPolicyOverridesB: setCompareAbilityPolicyOverridesB,
          compareUserAbilityOverridesA: setCompareUserAbilityOverridesA,
          compareUserAbilityOverridesB: setCompareUserAbilityOverridesB,
          compareUserAbilityLevelsA: setCompareUserAbilityLevelsA,
          compareUserAbilityLevelsB: setCompareUserAbilityLevelsB,
          disabledAbilitiesA: setDisabledAbilitiesA,
          disabledAbilitiesB: setDisabledAbilitiesB,
          badOmenChoice: setBadOmenChoice,
          compareBuffsA: setCompareBuffsA,
          compareBuffsB: setCompareBuffsB,
          specialAbilitiesA: setSpecialAbilitiesA,
          specialAbilitiesB: setSpecialAbilitiesB,
          compareDayNight: setCompareDayNight,
          compareMoon: setCompareMoon,
          compareSeason: setCompareSeason,
          compareWeather: setCompareWeather,
          compareOxygenMoistureMode: setCompareOxygenMoistureMode,
          compareBiteVariantModeA: setCompareBiteVariantModeA,
          compareBiteVariantModeB: setCompareBiteVariantModeB,
          compareAirRuleEnabled: setCompareAirRuleEnabled,
          compareAirRuleCooldownSec: setCompareAirRuleCooldownSec,
          compareAirRuleCooldownSecB: setCompareAirRuleCooldownSecB,
          compareAirRuleCooldownLinked: setCompareAirRuleCooldownLinked,
          compareAerialDodgeEnabled: setCompareAerialDodgeEnabled,
          compareAerialDodgeHitChancePctA: setCompareAerialDodgeHitChancePctA,
          compareAerialDodgeHitChancePctB: setCompareAerialDodgeHitChancePctB,
          compareAerialDodgeRollStyle: setCompareAerialDodgeRollStyle,
          compareNoMoveFacetank: setCompareNoMoveFacetank,
          compareFirstTickMode: setCompareFirstTickMode,
          compareFirstTickDelaySec: setCompareFirstTickDelaySec,
          comparePosturePolicyA: setComparePosturePolicyA,
          comparePosturePolicyB: setComparePosturePolicyB,
          compareBreathPolicyA: setCompareBreathPolicyA,
          compareBreathPolicyB: setCompareBreathPolicyB,
          resultViewMode: setResultViewMode,
          compareDpsSettings: setCompareDpsSettings,
          debugMode: setDebugMode,
        };
        for (const key of Object.keys(setters) as (keyof ComparePageSnapshotState)[]) {
          const value = s[key];
          if (value !== undefined && value !== null) {
            (setters[key] as (next: unknown) => void)(value);
          }
        }
      },
    });
  }, [onNameAChange, onNameBChange, onBuildAChange, onBuildBChange]);

  // Persist battle settings on change so they survive leaving the Compare page.
  // Lazy-initialized state means the first write equals what was hydrated (a
  // no-op); a shared-link view never writes, so it can't clobber the user's own
  // saved session.
  const persistBlob = serializeComparePersist(currentSnapshot);
  useEffect(() => {
    if (importedMatchMode) return;
    safeWriteLocalStorage(COMPARE_SETTINGS_STORAGE_KEY, persistBlob);
  }, [importedMatchMode, persistBlob]);

  useEffect(() => {
    if (!developerMode) setDebugMode(false);
  }, [developerMode]);
  useEffect(() => {
    const damage2 = creatureA?.stats?.damage2;
    if (typeof damage2 !== "number" || damage2 <= 0) setCompareBiteVariantModeA(COMPARE_BITE_VARIANT_MODE_DEFAULT);
  }, [creatureA]);
  useEffect(() => {
    const damage2 = creatureB?.stats?.damage2;
    if (typeof damage2 !== "number" || damage2 <= 0) setCompareBiteVariantModeB(COMPARE_BITE_VARIANT_MODE_DEFAULT);
  }, [creatureB]);
  // Reset the per-creature special-ability tuning when the USER switches
  // creatures - but never in a shared-link view. There the creature AND its
  // tuning both arrive from the link (applySnapshot); the name change the
  // import triggers would otherwise fire this reset and stomp the imported
  // Head Start / Gourmandizer / Warden's Rage values straight back to defaults
  // (the reason an imported Head Start silently vanished). Gating every
  // per-creature reset on `!importedMatchMode` keeps the whole special-ability
  // channel round-tripping through the link with no per-field bookkeeping.
  useEffect(() => {
    if (importedMatchMode) return;
    setSpecialAbilitiesA((prev) => ({ ...prev, startingHungerPct: 100, startingThirstPct: 100, strengthInNumbersAllies: 0, wardenRageStartHpPct: 50, headStart: false, headStartSec: 0 }));
  }, [creatureA?.name, importedMatchMode]);
  useEffect(() => {
    if (importedMatchMode) return;
    setSpecialAbilitiesB((prev) => ({ ...prev, startingHungerPct: 100, startingThirstPct: 100, strengthInNumbersAllies: 0, wardenRageStartHpPct: 50, headStart: false, headStartSec: 0 }));
  }, [creatureB?.name, importedMatchMode]);
  useEffect(() => {
    setCompareAbilityPolicyOverridesA((prev) => sanitizeCompareAbilityTimingOverrideDraft(prev, creatureA));
  }, [creatureA]);
  useEffect(() => {
    setCompareAbilityPolicyOverridesB((prev) => sanitizeCompareAbilityTimingOverrideDraft(prev, creatureB));
  }, [creatureB]);

  const effectiveAbilityTimingOverridesA = useMemo(
    () => buildCompareEffectiveAbilityTimingOverrides(creatureA, compareAbilityPolicyOverridesA),
    [creatureA, compareAbilityPolicyOverridesA],
  );
  const effectiveAbilityTimingOverridesB = useMemo(
    () => buildCompareEffectiveAbilityTimingOverrides(creatureB, compareAbilityPolicyOverridesB),
    [creatureB, compareAbilityPolicyOverridesB],
  );

  const badOmenOutcome = resolveBadOmenChoice(badOmenChoice);
  const { finalA, finalB, summary, needsCalc, calculate, isCalculating, calcElapsedMs } = useCompareSimulation({
    creatureA, creatureB, buildA, buildB, activesOn, breathOn, compareAbilityPolicy,
    compareAbilityPolicyOverridesA: effectiveAbilityTimingOverridesA,
    compareAbilityPolicyOverridesB: effectiveAbilityTimingOverridesB,
    compareUserAbilityOverridesA, compareUserAbilityOverridesB,
    compareUserAbilityLevelsA, compareUserAbilityLevelsB,
    disabledAbilitiesA, disabledAbilitiesB, badOmenOutcome, trueRoundingMode,
    compareBuffsA, compareBuffsB, specialAbilitiesA, specialAbilitiesB,
    compareDayNight, compareMoon, compareSeason, compareWeather, compareOxygenMoistureMode,
    compareBiteVariantModeA, compareBiteVariantModeB,
    compareAirRuleEnabled, compareAirRuleCooldownSec, compareAirRuleCooldownSecB,
    compareAirRuleCooldownLinked, compareAerialDodgeEnabled,
    compareAerialDodgeHitChancePctA, compareAerialDodgeHitChancePctB,
    compareAerialDodgeRollStyle, compareNoMoveFacetank,
    compareFirstTickMode, comparePosturePolicyA, comparePosturePolicyB,
    compareBreathPolicyA, compareBreathPolicyB,
    compareFirstTickDelaySec, combatEventOrder,
  });
  const abilityCoverage = useAbilityCoverage(debugMode);

  return {
    // simulation outputs
    finalA, finalB, summary, needsCalc, calculate, isCalculating, calcElapsedMs, abilityCoverage,
    // per-side creature config state
    specialAbilitiesA, setSpecialAbilitiesA: setSpecialAbilitiesALinked, specialAbilitiesB, setSpecialAbilitiesB: setSpecialAbilitiesBLinked,
    compareBiteVariantModeA, setCompareBiteVariantModeA, compareBiteVariantModeB, setCompareBiteVariantModeB,
    compareUserAbilityLevelsA, setCompareUserAbilityLevelsA, compareUserAbilityLevelsB, setCompareUserAbilityLevelsB,
    comparePosturePolicyA, setComparePosturePolicyA, comparePosturePolicyB, setComparePosturePolicyB,
    compareBreathPolicyA, setCompareBreathPolicyA, compareBreathPolicyB, setCompareBreathPolicyB,
    // battle settings state
    activesOn, setActivesOn, breathOn, setBreathOn, debugMode, setDebugMode,
    compareAbilityPolicy, setCompareAbilityPolicy,
    compareAbilityPolicyOverridesA, setCompareAbilityPolicyOverridesA,
    compareAbilityPolicyOverridesB, setCompareAbilityPolicyOverridesB,
    compareUserAbilityOverridesA, setCompareUserAbilityOverridesA,
    compareUserAbilityOverridesB, setCompareUserAbilityOverridesB,
    disabledAbilitiesA, setDisabledAbilitiesA, disabledAbilitiesB, setDisabledAbilitiesB,
    badOmenChoice, setBadOmenChoice,
    compareBuffsA, setCompareBuffsA, compareBuffsB, setCompareBuffsB,
    compareDayNight, setCompareDayNight, compareMoon, setCompareMoon, compareSeason, setCompareSeason, compareWeather, setCompareWeather,
    compareOxygenMoistureMode, setCompareOxygenMoistureMode,
    compareDpsSettings, setCompareDpsSettings,
    compareAirRuleEnabled, setCompareAirRuleEnabled,
    compareAirRuleCooldownSec, setCompareAirRuleCooldownSec,
    compareAirRuleCooldownSecB, setCompareAirRuleCooldownSecB,
    compareAirRuleCooldownLinked, setCompareAirRuleCooldownLinked,
    compareAerialDodgeEnabled, setCompareAerialDodgeEnabled,
    compareAerialDodgeHitChancePctA, setCompareAerialDodgeHitChancePctA,
    compareAerialDodgeHitChancePctB, setCompareAerialDodgeHitChancePctB,
    compareAerialDodgeRollStyle, setCompareAerialDodgeRollStyle,
    compareNoMoveFacetank, setCompareNoMoveFacetank,
    compareFirstTickMode, setCompareFirstTickMode,
    compareFirstTickDelaySec, setCompareFirstTickDelaySec,
    resultViewMode, setResultViewMode,
  };
}

export type ComparePageController = ReturnType<typeof useComparePageController>;
