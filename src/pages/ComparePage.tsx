import type { BuildOptions, CreatureRuntime } from "../engine";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import { StatCard } from "../components/compare/StatCard";
import { SummaryCard } from "../components/compare/SummaryCard";
import { CompareBattleDetails } from "../components/compare/CompareBattleDetails";
import { BattleSettingsPanel } from "../components/compare/BattleSettingsPanel";
import { badOmenOutcomes } from "./compareConfig";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { useComparePageController } from "./useComparePageController";

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
  importedMatchMode: boolean;
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (value: BuildOptions) => void;
  onBuildBChange: (value: BuildOptions) => void;
};

export default function ComparePage(props: ComparePageProps) {
  const {
    nameA, nameB, buildA, buildB, creatureA, creatureB, creatureNames,
    developerMode, getCreatureIcon,
    onNameAChange, onNameBChange, onBuildAChange, onBuildBChange,
  } = props;
  const c = useComparePageController(props);

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
            specialAbilities={c.specialAbilitiesA}
            onSpecialAbilitiesChange={c.setSpecialAbilitiesA}
            compareBiteVariantMode={c.compareBiteVariantModeA}
            onCompareBiteVariantModeChange={c.setCompareBiteVariantModeA}
            userAbilityLevels={c.compareUserAbilityLevelsA}
            onUserAbilityLevelsChange={c.setCompareUserAbilityLevelsA}
            posturePolicy={c.comparePosturePolicyA}
            onPosturePolicyChange={c.setComparePosturePolicyA}
            breathPolicy={c.compareBreathPolicyA}
            onBreathPolicyChange={c.setCompareBreathPolicyA}
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
            specialAbilities={c.specialAbilitiesB}
            onSpecialAbilitiesChange={c.setSpecialAbilitiesB}
            compareBiteVariantMode={c.compareBiteVariantModeB}
            onCompareBiteVariantModeChange={c.setCompareBiteVariantModeB}
            userAbilityLevels={c.compareUserAbilityLevelsB}
            onUserAbilityLevelsChange={c.setCompareUserAbilityLevelsB}
            posturePolicy={c.comparePosturePolicyB}
            onPosturePolicyChange={c.setComparePosturePolicyB}
            breathPolicy={c.compareBreathPolicyB}
            onBreathPolicyChange={c.setCompareBreathPolicyB}
          />
          <BattleSettingsPanel
            creatureA={creatureA}
            creatureB={creatureB}
            activesOn={c.activesOn}
            breathOn={c.breathOn}
            debugMode={c.debugMode}
            developerMode={developerMode}
            compareAbilityPolicy={c.compareAbilityPolicy}
            compareAbilityPolicyOverridesA={c.compareAbilityPolicyOverridesA}
            compareAbilityPolicyOverridesB={c.compareAbilityPolicyOverridesB}
            compareUserAbilityOverridesA={c.compareUserAbilityOverridesA}
            compareUserAbilityOverridesB={c.compareUserAbilityOverridesB}
            badOmenChoice={c.badOmenChoice}
            badOmenOutcomes={badOmenOutcomes}
            finalA={c.finalA}
            finalB={c.finalB}
            disabledAbilitiesA={c.disabledAbilitiesA}
            disabledAbilitiesB={c.disabledAbilitiesB}
            compareBuffsA={c.compareBuffsA}
            compareBuffsB={c.compareBuffsB}
            compareDayNight={c.compareDayNight}
            compareMoon={c.compareMoon} compareSeason={c.compareSeason} onCompareSeasonChange={c.setCompareSeason}
            compareWeather={c.compareWeather}
            compareOxygenMoistureMode={c.compareOxygenMoistureMode}
            compareDpsSettings={c.compareDpsSettings}
            compareAirRuleEnabled={c.compareAirRuleEnabled}
            compareAirRuleCooldownSec={c.compareAirRuleCooldownSec}
            compareAirRuleCooldownSecB={c.compareAirRuleCooldownSecB}
            compareAirRuleCooldownLinked={c.compareAirRuleCooldownLinked}
            compareAerialDodgeEnabled={c.compareAerialDodgeEnabled}
            compareAerialDodgeHitChancePctA={c.compareAerialDodgeHitChancePctA}
            compareAerialDodgeHitChancePctB={c.compareAerialDodgeHitChancePctB}
            compareAerialDodgeRollStyle={c.compareAerialDodgeRollStyle}
            compareNoMoveFacetank={c.compareNoMoveFacetank}
            compareFirstTickMode={c.compareFirstTickMode}
            compareFirstTickDelaySec={c.compareFirstTickDelaySec}
            needsCalc={c.needsCalc}
            onActivesOnChange={c.setActivesOn}
            onBreathOnChange={c.setBreathOn}
            onDebugModeChange={c.setDebugMode}
            onCompareAbilityPolicyChange={c.setCompareAbilityPolicy}
            onCompareAbilityPolicyOverridesAChange={c.setCompareAbilityPolicyOverridesA}
            onCompareAbilityPolicyOverridesBChange={c.setCompareAbilityPolicyOverridesB}
            onCompareUserAbilityOverridesAChange={c.setCompareUserAbilityOverridesA}
            onCompareUserAbilityOverridesBChange={c.setCompareUserAbilityOverridesB}
            onBadOmenChoiceChange={c.setBadOmenChoice}
            onDisabledAbilitiesAChange={c.setDisabledAbilitiesA}
            onDisabledAbilitiesBChange={c.setDisabledAbilitiesB}
            onCompareBuffsAChange={c.setCompareBuffsA}
            onCompareBuffsBChange={c.setCompareBuffsB}
            onCompareDayNightChange={c.setCompareDayNight}
            onCompareMoonChange={c.setCompareMoon}
            onCompareWeatherChange={c.setCompareWeather}
            onCompareOxygenMoistureModeChange={c.setCompareOxygenMoistureMode}
            onCompareDpsSettingsChange={c.setCompareDpsSettings}
            onCompareAirRuleEnabledChange={c.setCompareAirRuleEnabled}
            onCompareAirRuleCooldownSecChange={c.setCompareAirRuleCooldownSec}
            onCompareAirRuleCooldownSecBChange={c.setCompareAirRuleCooldownSecB}
            onCompareAirRuleCooldownLinkedChange={c.setCompareAirRuleCooldownLinked}
            onCompareAerialDodgeEnabledChange={c.setCompareAerialDodgeEnabled}
            onCompareAerialDodgeHitChancePctAChange={c.setCompareAerialDodgeHitChancePctA}
            onCompareAerialDodgeHitChancePctBChange={c.setCompareAerialDodgeHitChancePctB}
            onCompareAerialDodgeRollStyleChange={c.setCompareAerialDodgeRollStyle}
            onCompareNoMoveFacetankChange={c.setCompareNoMoveFacetank}
            onCompareFirstTickModeChange={c.setCompareFirstTickMode}
            onCompareFirstTickDelaySecChange={c.setCompareFirstTickDelaySec}
            onCalculate={() => void c.calculate()}
            isCalculating={c.isCalculating}
            calcElapsedMs={c.calcElapsedMs}
          />
        </div>
      </div>

      <div className="results-grid">
        <StatCard
          title="Final Stats A"
          stats={c.finalA}
          getIcon={getCreatureIcon}
          compareAirRuleEnabled={c.compareAirRuleEnabled}
          compareAirRuleCooldownSec={c.compareAirRuleEnabled ? c.compareAirRuleCooldownSec : null}
          activeTempBuffIds={[
            c.compareBuffsA.muddy ? "Muddy_Status" : null,
            c.compareBuffsA.cleanWater ? "Clean_Water_Status" : null,
            c.compareBuffsA.refreshed ? "Refreshed_Status" : null,
          ].filter((id): id is string => id != null)}
        />
        <StatCard
          title="Final Stats B"
          stats={c.finalB}
          getIcon={getCreatureIcon}
          compareAirRuleEnabled={c.compareAirRuleEnabled}
          compareAirRuleCooldownSec={c.compareAirRuleEnabled ? c.compareAirRuleCooldownSec : null}
          activeTempBuffIds={[
            c.compareBuffsB.muddy ? "Muddy_Status" : null,
            c.compareBuffsB.cleanWater ? "Clean_Water_Status" : null,
            c.compareBuffsB.refreshed ? "Refreshed_Status" : null,
          ].filter((id): id is string => id != null)}
        />
        <SummaryCard
          summary={c.summary}
          nameA={nameA}
          nameB={nameB}
          buildA={buildA}
          buildB={buildB}
          abilityCoverage={c.abilityCoverage}
          debugMode={c.debugMode}
          needsCalc={c.needsCalc}
          resultViewMode={c.resultViewMode}
          onResultViewModeChange={c.setResultViewMode}
          dpsSettings={c.compareDpsSettings}
        />
      </div>
      <CompareBattleDetails
        summary={c.summary}
        nameA={nameA}
        nameB={nameB}
        needsCalc={c.needsCalc}
        resultViewMode={c.resultViewMode}
      />
    </section>
  );
}
