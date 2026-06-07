import { useEffect, useMemo, useRef, useState } from "react";
import type { PosturePolicyMode } from "../optimizer/rustCompareMatchupRuntime";
import { rules } from "../engine/buildData";
import type {
  AbilityTimingMode,
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import { COMPARE_BITE_VARIANT_MODE_DEFAULT } from "../engine";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import { StatCard } from "../components/compare/StatCard";
import { SummaryCard } from "../components/compare/SummaryCard";
import { CompareBattleDetails } from "../components/compare/CompareBattleDetails";
import { BattleSettingsPanel } from "../components/compare/BattleSettingsPanel";
import { useAbilityCoverage } from "../hooks/useAbilityCoverage";
import { useCompareSimulation } from "../hooks/useCompareSimulation";
import { badOmenOutcomes, resolveBadOmenChoice } from "./compareConfig";
import { defaultCompareBuffSelection } from "../components/compare/compareBuffConfig";
import type { CompareBuffSelection, CompareDayNightMode, CompareMoonMode } from "../engine/compareBuffRuntime";
import type { WeatherCondition } from "../engine/weather";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES, type CompareSpecialAbilityState } from "../components/compare/compareSpecialAbilities";
import { DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC } from "../engine/compareAirRule";
import {
  DEFAULT_COMPARE_DPS_SETTINGS,
  type CompareDpsSettings,
  type CompareResultViewMode,
} from "../components/compare/compareResultView";
import type { CombatEventPhase } from "../engine/eventOrdering";
import {
  buildCompareEffectiveAbilityTimingOverrides,
  sanitizeCompareAbilityTimingOverrideDraft,
  type CompareAbilityTimingOverrideDraft,
} from "../components/compare/compareAbilityTimingPolicy";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";

export type ComparePageProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatureNames: string[];
  developerMode: boolean;
  trueDeveloperMode: boolean;
  trueRoundingMode: boolean;
  combatEventOrder: CombatEventPhase[];
  getCreatureIcon: (name: string) => string | null;
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
  compareWeather: WeatherCondition;
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  comparePosturePolicyA: PosturePolicyMode;
  comparePosturePolicyB: PosturePolicyMode;
  resultViewMode: CompareResultViewMode;
  compareDpsSettings: CompareDpsSettings;
  debugMode: boolean;
};

export default function ComparePage({
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  creatureNames,
  developerMode,
  trueDeveloperMode,
  trueRoundingMode,
  combatEventOrder,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
}: ComparePageProps) {
  const [activesOn, setActivesOn] = useState(rules.model.activesDefault === "on");
  const [breathOn, setBreathOn] = useState(true);
  const [compareAbilityPolicy, setCompareAbilityPolicy] = useState<AbilityTimingMode>("ideal");
  const [compareAbilityPolicyOverridesA, setCompareAbilityPolicyOverridesA] = useState<CompareAbilityTimingOverrideDraft>({});
  const [compareAbilityPolicyOverridesB, setCompareAbilityPolicyOverridesB] = useState<CompareAbilityTimingOverrideDraft>({});
  const [compareUserAbilityOverridesA, setCompareUserAbilityOverridesA] = useState<UserAbilityTimingOverrides>({});
  const [compareUserAbilityOverridesB, setCompareUserAbilityOverridesB] = useState<UserAbilityTimingOverrides>({});
  // Per-fight level picks for user abilities with
  // levels > 1. Empty map ⇒ every ability uses its spec's default_level.
  const [compareUserAbilityLevelsA, setCompareUserAbilityLevelsA] = useState<UserAbilityLevelOverrides>({});
  const [compareUserAbilityLevelsB, setCompareUserAbilityLevelsB] = useState<UserAbilityLevelOverrides>({});
  const [disabledAbilitiesA, setDisabledAbilitiesA] = useState<string[]>([]);
  const [disabledAbilitiesB, setDisabledAbilitiesB] = useState<string[]>([]);
  const [debugMode, setDebugMode] = useState(false);
  const [badOmenChoice, setBadOmenChoice] = useState<string>("auto");
  const [compareBuffsA, setCompareBuffsA] = useState(defaultCompareBuffSelection);
  const [compareBuffsB, setCompareBuffsB] = useState(defaultCompareBuffSelection);
  const [specialAbilitiesA, setSpecialAbilitiesA] = useState<CompareSpecialAbilityState>(DEFAULT_COMPARE_SPECIAL_ABILITIES);
  const [specialAbilitiesB, setSpecialAbilitiesB] = useState<CompareSpecialAbilityState>(DEFAULT_COMPARE_SPECIAL_ABILITIES);
  const [compareDayNight, setCompareDayNight] = useState<CompareDayNightMode>("none");
  const [compareMoon, setCompareMoon] = useState<CompareMoonMode>("none");
  const [compareWeather, setCompareWeather] = useState<WeatherCondition>("none");
  const [compareBiteVariantModeA, setCompareBiteVariantModeA] = useState<CompareBiteVariantMode>(
    COMPARE_BITE_VARIANT_MODE_DEFAULT,
  );
  const [compareBiteVariantModeB, setCompareBiteVariantModeB] = useState<CompareBiteVariantMode>(
    COMPARE_BITE_VARIANT_MODE_DEFAULT,
  );
  const [compareAirRuleEnabled, setCompareAirRuleEnabled] = useState(false);
  const [compareAirRuleCooldownSec, setCompareAirRuleCooldownSec] = useState(DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC);
  const [compareNoMoveFacetank, setCompareNoMoveFacetank] = useState(true);
  const [compareFirstTickMode, setCompareFirstTickMode] = useState<"off" | "ailments" | "regen" | "both">("off");
  const [compareFirstTickDelaySec, setCompareFirstTickDelaySec] = useState(1);
  const [comparePosturePolicyA, setComparePosturePolicyA] = useState<PosturePolicyMode>("off");
  const [comparePosturePolicyB, setComparePosturePolicyB] = useState<PosturePolicyMode>("off");
  const [resultViewMode, setResultViewMode] = useState<CompareResultViewMode>("firstDeath");
  const [compareDpsSettings, setCompareDpsSettings] = useState<CompareDpsSettings>(DEFAULT_COMPARE_DPS_SETTINGS);

  // Share-Match snapshot provider. A ref mirrors all shareable state
  // each render so the provider (registered once) reads current values
  // without re-registering on every keystroke.
  const shareSnapshotRef = useRef<ComparePageSnapshotState | null>(null);
  // eslint-disable-next-line react-hooks/refs -- mirror state into ref each render; provider is registered once and reads .current
  shareSnapshotRef.current = {
    nameA,
    nameB,
    buildA,
    buildB,
    activesOn,
    breathOn,
    compareAbilityPolicy,
    compareAbilityPolicyOverridesA,
    compareAbilityPolicyOverridesB,
    compareUserAbilityOverridesA,
    compareUserAbilityOverridesB,
    compareUserAbilityLevelsA,
    compareUserAbilityLevelsB,
    disabledAbilitiesA,
    disabledAbilitiesB,
    badOmenChoice,
    compareBuffsA,
    compareBuffsB,
    specialAbilitiesA,
    specialAbilitiesB,
    compareDayNight,
    compareMoon,
    compareWeather,
    compareBiteVariantModeA,
    compareBiteVariantModeB,
    compareAirRuleEnabled,
    compareAirRuleCooldownSec,
    compareNoMoveFacetank,
    compareFirstTickMode,
    compareFirstTickDelaySec,
    comparePosturePolicyA,
    comparePosturePolicyB,
    resultViewMode,
    compareDpsSettings,
    debugMode,
  };
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
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (typeof s.nameB === "string") onNameBChange(s.nameB);
        if (s.buildA) onBuildAChange(s.buildA);
        if (s.buildB) onBuildBChange(s.buildB);
        if (s.activesOn !== undefined) setActivesOn(s.activesOn);
        if (s.breathOn !== undefined) setBreathOn(s.breathOn);
        if (s.compareAbilityPolicy !== undefined) setCompareAbilityPolicy(s.compareAbilityPolicy);
        if (s.compareAbilityPolicyOverridesA !== undefined) setCompareAbilityPolicyOverridesA(s.compareAbilityPolicyOverridesA);
        if (s.compareAbilityPolicyOverridesB !== undefined) setCompareAbilityPolicyOverridesB(s.compareAbilityPolicyOverridesB);
        if (s.compareUserAbilityOverridesA !== undefined) setCompareUserAbilityOverridesA(s.compareUserAbilityOverridesA);
        if (s.compareUserAbilityOverridesB !== undefined) setCompareUserAbilityOverridesB(s.compareUserAbilityOverridesB);
        if (s.compareUserAbilityLevelsA !== undefined) setCompareUserAbilityLevelsA(s.compareUserAbilityLevelsA);
        if (s.compareUserAbilityLevelsB !== undefined) setCompareUserAbilityLevelsB(s.compareUserAbilityLevelsB);
        if (s.disabledAbilitiesA !== undefined) setDisabledAbilitiesA(s.disabledAbilitiesA);
        if (s.disabledAbilitiesB !== undefined) setDisabledAbilitiesB(s.disabledAbilitiesB);
        if (s.badOmenChoice !== undefined) setBadOmenChoice(s.badOmenChoice);
        if (s.compareBuffsA !== undefined) setCompareBuffsA(s.compareBuffsA);
        if (s.compareBuffsB !== undefined) setCompareBuffsB(s.compareBuffsB);
        if (s.specialAbilitiesA !== undefined) setSpecialAbilitiesA(s.specialAbilitiesA);
        if (s.specialAbilitiesB !== undefined) setSpecialAbilitiesB(s.specialAbilitiesB);
        if (s.compareDayNight !== undefined) setCompareDayNight(s.compareDayNight);
        if (s.compareMoon !== undefined) setCompareMoon(s.compareMoon);
        if (s.compareWeather !== undefined) setCompareWeather(s.compareWeather);
        if (s.compareBiteVariantModeA !== undefined) setCompareBiteVariantModeA(s.compareBiteVariantModeA);
        if (s.compareBiteVariantModeB !== undefined) setCompareBiteVariantModeB(s.compareBiteVariantModeB);
        if (s.compareAirRuleEnabled !== undefined) setCompareAirRuleEnabled(s.compareAirRuleEnabled);
        if (s.compareAirRuleCooldownSec !== undefined) setCompareAirRuleCooldownSec(s.compareAirRuleCooldownSec);
        if (s.compareNoMoveFacetank !== undefined) setCompareNoMoveFacetank(s.compareNoMoveFacetank);
        if (s.compareFirstTickMode !== undefined) setCompareFirstTickMode(s.compareFirstTickMode);
        if (s.compareFirstTickDelaySec !== undefined) setCompareFirstTickDelaySec(s.compareFirstTickDelaySec);
        if (s.comparePosturePolicyA !== undefined) setComparePosturePolicyA(s.comparePosturePolicyA);
        if (s.comparePosturePolicyB !== undefined) setComparePosturePolicyB(s.comparePosturePolicyB);
        if (s.resultViewMode !== undefined) setResultViewMode(s.resultViewMode);
        if (s.compareDpsSettings !== undefined) setCompareDpsSettings(s.compareDpsSettings);
        if (s.debugMode !== undefined) setDebugMode(s.debugMode);
      },
    });
  }, [onNameAChange, onNameBChange, onBuildAChange, onBuildBChange]);

  useEffect(() => {
    if (!developerMode) setDebugMode(false);
  }, [developerMode]);
  // Reset the bite-variant chip when the selected creature lacks a
  // `damage2` value - without a secondary attack, `dynamic` and
  // `secondaryOnly` are degenerate (engine falls back to primary
  // either way). Snap back to the default so the UI doesn't show
  // a stale non-default selection.
  useEffect(() => {
    const damage2 = creatureA?.stats?.damage2;
    if (typeof damage2 !== "number" || damage2 <= 0) {
      setCompareBiteVariantModeA(COMPARE_BITE_VARIANT_MODE_DEFAULT);
    }
  }, [creatureA]);
  useEffect(() => {
    const damage2 = creatureB?.stats?.damage2;
    if (typeof damage2 !== "number" || damage2 <= 0) {
      setCompareBiteVariantModeB(COMPARE_BITE_VARIANT_MODE_DEFAULT);
    }
  }, [creatureB]);
  useEffect(() => {
    setSpecialAbilitiesA((prev) => ({
      ...prev,
      gourmandizerStartingHunger: 100,
      strengthInNumbersAllies: 0,
      wardenRageStartHpPct: 50,
    }));
  }, [creatureA?.name]);
  useEffect(() => {
    setSpecialAbilitiesB((prev) => ({
      ...prev,
      gourmandizerStartingHunger: 100,
      strengthInNumbersAllies: 0,
      wardenRageStartHpPct: 50,
    }));
  }, [creatureB?.name]);
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
    creatureA,
    creatureB,
    buildA,
    buildB,
    activesOn,
    breathOn,
    compareAbilityPolicy,
    compareAbilityPolicyOverridesA: effectiveAbilityTimingOverridesA,
    compareAbilityPolicyOverridesB: effectiveAbilityTimingOverridesB,
    compareUserAbilityOverridesA: compareUserAbilityOverridesA,
    compareUserAbilityOverridesB: compareUserAbilityOverridesB,
    compareUserAbilityLevelsA: compareUserAbilityLevelsA,
    compareUserAbilityLevelsB: compareUserAbilityLevelsB,
    disabledAbilitiesA,
    disabledAbilitiesB,
    badOmenOutcome,
    trueRoundingMode,
    compareBuffsA,
    compareBuffsB,
    specialAbilitiesA,
    specialAbilitiesB,
    compareDayNight,
    compareMoon,
    compareWeather,
    compareBiteVariantModeA,
    compareBiteVariantModeB,
    compareAirRuleEnabled,
    compareAirRuleCooldownSec,
    compareNoMoveFacetank,
    compareFirstTickMode,
    comparePosturePolicyA,
    comparePosturePolicyB,
    compareFirstTickDelaySec,
    combatEventOrder,
  });
  const abilityCoverage = useAbilityCoverage(debugMode);

  return (
    <section className="panel">
      <div className="layout-grid">
        <div className="panel-grid">
          <CreatureSelectorCard
            label="Creature A"
            name={nameA}
            creatureNames={creatureNames}
            creature={creatureA}
            getIcon={getCreatureIcon}
            onNameChange={onNameAChange}
            build={buildA}
            onBuildChange={onBuildAChange}
            specialAbilities={specialAbilitiesA}
            onSpecialAbilitiesChange={setSpecialAbilitiesA}
            compareBiteVariantMode={compareBiteVariantModeA}
            onCompareBiteVariantModeChange={setCompareBiteVariantModeA}
            userAbilityLevels={compareUserAbilityLevelsA}
            onUserAbilityLevelsChange={setCompareUserAbilityLevelsA}
            posturePolicy={comparePosturePolicyA}
            onPosturePolicyChange={setComparePosturePolicyA}
          />
          <CreatureSelectorCard
            label="Creature B"
            name={nameB}
            creatureNames={creatureNames}
            creature={creatureB}
            getIcon={getCreatureIcon}
            onNameChange={onNameBChange}
            build={buildB}
            onBuildChange={onBuildBChange}
            specialAbilities={specialAbilitiesB}
            onSpecialAbilitiesChange={setSpecialAbilitiesB}
            compareBiteVariantMode={compareBiteVariantModeB}
            onCompareBiteVariantModeChange={setCompareBiteVariantModeB}
            userAbilityLevels={compareUserAbilityLevelsB}
            onUserAbilityLevelsChange={setCompareUserAbilityLevelsB}
            posturePolicy={comparePosturePolicyB}
            onPosturePolicyChange={setComparePosturePolicyB}
          />
          <BattleSettingsPanel
            creatureA={creatureA}
            creatureB={creatureB}
            activesOn={activesOn}
            breathOn={breathOn}
            debugMode={debugMode}
            developerMode={developerMode}
            compareAbilityPolicy={compareAbilityPolicy}
            compareAbilityPolicyOverridesA={compareAbilityPolicyOverridesA}
            compareAbilityPolicyOverridesB={compareAbilityPolicyOverridesB}
            compareUserAbilityOverridesA={compareUserAbilityOverridesA}
            compareUserAbilityOverridesB={compareUserAbilityOverridesB}
            compareUserAbilityLevelsA={compareUserAbilityLevelsA}
            compareUserAbilityLevelsB={compareUserAbilityLevelsB}
            badOmenChoice={badOmenChoice}
            badOmenOutcomes={badOmenOutcomes}
            finalA={finalA}
            finalB={finalB}
            disabledAbilitiesA={disabledAbilitiesA}
            disabledAbilitiesB={disabledAbilitiesB}
            compareBuffsA={compareBuffsA}
            compareBuffsB={compareBuffsB}
            compareDayNight={compareDayNight}
            compareMoon={compareMoon}
            compareWeather={compareWeather}
            compareDpsSettings={compareDpsSettings}
            compareAirRuleEnabled={compareAirRuleEnabled}
            compareAirRuleCooldownSec={compareAirRuleCooldownSec}
            compareNoMoveFacetank={compareNoMoveFacetank}
            compareFirstTickMode={compareFirstTickMode}
            compareFirstTickDelaySec={compareFirstTickDelaySec}
            needsCalc={needsCalc}
            onActivesOnChange={setActivesOn}
            onBreathOnChange={setBreathOn}
            onDebugModeChange={setDebugMode}
            onCompareAbilityPolicyChange={setCompareAbilityPolicy}
            onCompareAbilityPolicyOverridesAChange={setCompareAbilityPolicyOverridesA}
            onCompareAbilityPolicyOverridesBChange={setCompareAbilityPolicyOverridesB}
            onCompareUserAbilityOverridesAChange={setCompareUserAbilityOverridesA}
            onCompareUserAbilityOverridesBChange={setCompareUserAbilityOverridesB}
            onCompareUserAbilityLevelsAChange={setCompareUserAbilityLevelsA}
            onCompareUserAbilityLevelsBChange={setCompareUserAbilityLevelsB}
            onBadOmenChoiceChange={setBadOmenChoice}
            onDisabledAbilitiesAChange={setDisabledAbilitiesA}
            onDisabledAbilitiesBChange={setDisabledAbilitiesB}
            onCompareBuffsAChange={setCompareBuffsA}
            onCompareBuffsBChange={setCompareBuffsB}
            onCompareDayNightChange={setCompareDayNight}
            onCompareMoonChange={setCompareMoon}
            onCompareWeatherChange={setCompareWeather}
            onCompareDpsSettingsChange={setCompareDpsSettings}
            onCompareAirRuleEnabledChange={setCompareAirRuleEnabled}
            onCompareAirRuleCooldownSecChange={setCompareAirRuleCooldownSec}
            onCompareNoMoveFacetankChange={setCompareNoMoveFacetank}
            onCompareFirstTickModeChange={setCompareFirstTickMode}
            onCompareFirstTickDelaySecChange={setCompareFirstTickDelaySec}
            onCalculate={() => void calculate()}
            isCalculating={isCalculating}
            calcElapsedMs={calcElapsedMs}
          />
        </div>
      </div>

      <div className="results-grid">
        <StatCard
          title="Final Stats A"
          stats={finalA}
          getIcon={getCreatureIcon}
          compareAirRuleEnabled={compareAirRuleEnabled}
          compareAirRuleCooldownSec={compareAirRuleEnabled ? compareAirRuleCooldownSec : null}
          activeTempBuffIds={[
            compareBuffsA.muddy ? "Muddy_Status" : null,
            compareBuffsA.cleanWater ? "Clean_Water_Status" : null,
            compareBuffsA.refreshed ? "Refreshed_Status" : null,
          ].filter((id): id is string => id != null)}
        />
        <StatCard
          title="Final Stats B"
          stats={finalB}
          getIcon={getCreatureIcon}
          compareAirRuleEnabled={compareAirRuleEnabled}
          compareAirRuleCooldownSec={compareAirRuleEnabled ? compareAirRuleCooldownSec : null}
          activeTempBuffIds={[
            compareBuffsB.muddy ? "Muddy_Status" : null,
            compareBuffsB.cleanWater ? "Clean_Water_Status" : null,
            compareBuffsB.refreshed ? "Refreshed_Status" : null,
          ].filter((id): id is string => id != null)}
        />
        <SummaryCard
          summary={summary}
          nameA={nameA}
          nameB={nameB}
          buildA={buildA}
          buildB={buildB}
          abilityCoverage={abilityCoverage}
          debugMode={debugMode}
          needsCalc={needsCalc}
          resultViewMode={resultViewMode}
          onResultViewModeChange={setResultViewMode}
          dpsSettings={compareDpsSettings}
        />
      </div>
      <CompareBattleDetails
        summary={summary}
        nameA={nameA}
        nameB={nameB}
        needsCalc={needsCalc}
        resultViewMode={resultViewMode}
        developerMode={developerMode}
        trueDeveloperMode={trueDeveloperMode}
      />
    </section>
  );
}
