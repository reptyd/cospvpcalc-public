import { useEffect, useRef, useState } from "react";
import type {
  AbilityTimingMode,
  CreatureRuntime,
  FinalStats,
  UserAbilityTimingOverrides,
} from "../../engine";
import type { CompareBuffSelection, CompareDayNightMode, CompareMoonMode } from "../../engine/compareBuffRuntime";
import type {
  CompareDpsCategory,
  CompareDpsDenominator,
  CompareDpsSettings,
} from "./compareResultView";
import { ToggleSwitch } from "../ToggleSwitch";
import { CombatTogglePanel } from "./CombatTogglePanel";
import { compareBuffOptions, compareDayNightOptions, compareMoonOptions, compareSeasonOptions } from "./compareBuffConfig";
import { getSeasonDrainChangePct, type CompareSeason } from "../../engine/compareSeason";
import { WEATHER_OPTIONS, type WeatherCondition } from "../../engine/weather";
import {
  OXYGEN_MOISTURE_OPTIONS,
  type OxygenMoistureMode,
} from "../../engine/oxygenMoistureMode";
import { AbilityTimingOverridesPanel } from "./AbilityTimingOverridesPanel";
import { UserAbilityTimingOverridesPanel } from "./UserAbilityTimingOverridesPanel";
import type { CompareAbilityTimingOverrideDraft } from "./compareAbilityTimingPolicy";

export function BattleSettingsPanel({
  creatureA,
  creatureB,
  activesOn,
  breathOn,
  debugMode,
  developerMode,
  compareAbilityPolicy,
  compareAbilityPolicyOverridesA,
  compareAbilityPolicyOverridesB,
  compareUserAbilityOverridesA,
  compareUserAbilityOverridesB,
  badOmenChoice,
  badOmenOutcomes,
  finalA,
  finalB,
  disabledAbilitiesA,
  disabledAbilitiesB,
  compareBuffsA,
  compareBuffsB,
  compareDayNight,
  compareMoon,
  compareSeason,
  onCompareSeasonChange,
  compareWeather,
  compareOxygenMoistureMode,
  compareDpsSettings,
  compareAirRuleEnabled,
  compareAirRuleCooldownSec,
  compareAirRuleCooldownSecB,
  compareAirRuleCooldownLinked,
  compareAerialDodgeEnabled,
  compareAerialDodgeHitChancePctA,
  compareAerialDodgeHitChancePctB,
  compareAerialDodgeRollStyle,
  compareNoMoveFacetank,
  compareFirstTickMode,
  compareFirstTickDelaySec,
  needsCalc,
  onActivesOnChange,
  onBreathOnChange,
  onDebugModeChange,
  onCompareAbilityPolicyChange,
  onCompareAbilityPolicyOverridesAChange,
  onCompareAbilityPolicyOverridesBChange,
  onCompareUserAbilityOverridesAChange,
  onCompareUserAbilityOverridesBChange,
  onBadOmenChoiceChange,
  onDisabledAbilitiesAChange,
  onDisabledAbilitiesBChange,
  onCompareBuffsAChange,
  onCompareBuffsBChange,
  onCompareDayNightChange,
  onCompareMoonChange,
  onCompareWeatherChange,
  onCompareOxygenMoistureModeChange,
  onCompareDpsSettingsChange,
  onCompareAirRuleEnabledChange,
  onCompareAirRuleCooldownSecChange,
  onCompareAirRuleCooldownSecBChange,
  onCompareAirRuleCooldownLinkedChange,
  onCompareAerialDodgeEnabledChange,
  onCompareAerialDodgeHitChancePctAChange,
  onCompareAerialDodgeHitChancePctBChange,
  onCompareAerialDodgeRollStyleChange,
  onCompareNoMoveFacetankChange,
  onCompareFirstTickModeChange,
  onCompareFirstTickDelaySecChange,
  onCalculate,
  isCalculating,
  calcElapsedMs,
}: {
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  activesOn: boolean;
  breathOn: boolean;
  debugMode: boolean;
  developerMode: boolean;
  compareAbilityPolicy: AbilityTimingMode;
  compareAbilityPolicyOverridesA: CompareAbilityTimingOverrideDraft;
  compareAbilityPolicyOverridesB: CompareAbilityTimingOverrideDraft;
  compareUserAbilityOverridesA: UserAbilityTimingOverrides;
  compareUserAbilityOverridesB: UserAbilityTimingOverrides;
  badOmenChoice: string;
  badOmenOutcomes: Array<{ statusId: string; stacks: number; label: string }>;
  finalA: FinalStats | null;
  finalB: FinalStats | null;
  disabledAbilitiesA: string[];
  disabledAbilitiesB: string[];
  compareBuffsA: CompareBuffSelection;
  compareBuffsB: CompareBuffSelection;
  compareDayNight: CompareDayNightMode;
  compareMoon: CompareMoonMode;
  compareSeason: CompareSeason;
  onCompareSeasonChange: (value: CompareSeason) => void;
  compareWeather: WeatherCondition;
  compareOxygenMoistureMode: OxygenMoistureMode;
  compareDpsSettings: CompareDpsSettings;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareAirRuleCooldownSecB: number;
  compareAirRuleCooldownLinked: boolean;
  compareAerialDodgeEnabled: boolean;
  compareAerialDodgeHitChancePctA: number;
  compareAerialDodgeHitChancePctB: number;
  compareAerialDodgeRollStyle: "even" | "random";
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  needsCalc: boolean;
  onActivesOnChange: (value: boolean) => void;
  onBreathOnChange: (value: boolean) => void;
  onDebugModeChange: (value: boolean) => void;
  onCompareAbilityPolicyChange: (value: AbilityTimingMode) => void;
  onCompareAbilityPolicyOverridesAChange: (value: CompareAbilityTimingOverrideDraft) => void;
  onCompareAbilityPolicyOverridesBChange: (value: CompareAbilityTimingOverrideDraft) => void;
  onCompareUserAbilityOverridesAChange: (value: UserAbilityTimingOverrides) => void;
  onCompareUserAbilityOverridesBChange: (value: UserAbilityTimingOverrides) => void;
  onBadOmenChoiceChange: (value: string) => void;
  onDisabledAbilitiesAChange: (value: string[]) => void;
  onDisabledAbilitiesBChange: (value: string[]) => void;
  onCompareBuffsAChange: (value: CompareBuffSelection) => void;
  onCompareBuffsBChange: (value: CompareBuffSelection) => void;
  onCompareDayNightChange: (value: CompareDayNightMode) => void;
  onCompareMoonChange: (value: CompareMoonMode) => void;
  onCompareWeatherChange: (value: WeatherCondition) => void;
  onCompareOxygenMoistureModeChange: (value: OxygenMoistureMode) => void;
  onCompareDpsSettingsChange: (value: CompareDpsSettings) => void;
  onCompareAirRuleEnabledChange: (value: boolean) => void;
  onCompareAirRuleCooldownSecChange: (value: number) => void;
  onCompareAirRuleCooldownSecBChange: (value: number) => void;
  onCompareAirRuleCooldownLinkedChange: (value: boolean) => void;
  onCompareAerialDodgeEnabledChange: (value: boolean) => void;
  onCompareAerialDodgeHitChancePctAChange: (value: number) => void;
  onCompareAerialDodgeHitChancePctBChange: (value: number) => void;
  onCompareAerialDodgeRollStyleChange: (value: "even" | "random") => void;
  onCompareNoMoveFacetankChange: (value: boolean) => void;
  onCompareFirstTickModeChange: (value: "off" | "ailments" | "regen" | "both") => void;
  onCompareFirstTickDelaySecChange: (value: number) => void;
  onCalculate: () => void;
  isCalculating: boolean;
  calcElapsedMs: number;
}) {
  const renderBuffChecklist = (
    label: string,
    value: CompareBuffSelection,
    onChange: (next: CompareBuffSelection) => void,
  ) => (
    <div className="compare-buff-section">
      <div className="compare-buff-heading">
        <span>{label}</span>
        <small className="muted">{Object.values(value).filter(Boolean).length} selected</small>
      </div>
      <div className="compare-buff-grid">
        {compareBuffOptions.map((buff) => (
          <label
            key={`${label}-${buff.id}`}
            className={`compare-buff-chip${value[buff.id] ? " selected" : ""}`}
            title={buff.description}
          >
            <input
              type="checkbox"
              checked={value[buff.id]}
              onChange={(e) => onChange({ ...value, [buff.id]: e.target.checked })}
            />
            <span>{buff.label}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="panel-block">
      <h3>Battle Settings</h3>
      {/* Grouping wrappers (compare-policy-group / compare-env-grid) are
          style hooks for the beta Setup overlay; plain block divs here, so
          the default page layout is unchanged. */}
      <div className="compare-policy-group">
      <div className="field">
        <label htmlFor="compare-ability-timing-mode">Ability timing mode</label>
        <select
          id="compare-ability-timing-mode"
          value={compareAbilityPolicy}
          onChange={(e) => onCompareAbilityPolicyChange(e.target.value as AbilityTimingMode)}
        >
          <option value="reallyFast">Really fast</option>
          <option value="fast">Fast</option>
          <option value="semiIdeal">Semi-ideal</option>
          <option value="ideal">Ideal (default for compare)</option>
          <option value="extreme">Extreme</option>
        </select>
      </div>
      <AbilityTimingOverridesPanel
        compareAbilityPolicy={compareAbilityPolicy}
        creatureA={creatureA}
        creatureB={creatureB}
        overridesA={compareAbilityPolicyOverridesA}
        overridesB={compareAbilityPolicyOverridesB}
        onOverridesAChange={onCompareAbilityPolicyOverridesAChange}
        onOverridesBChange={onCompareAbilityPolicyOverridesBChange}
      />
      <UserAbilityTimingOverridesPanel
        creatureA={creatureA}
        creatureB={creatureB}
        overridesA={compareUserAbilityOverridesA}
        overridesB={compareUserAbilityOverridesB}
        onOverridesAChange={onCompareUserAbilityOverridesAChange}
        onOverridesBChange={onCompareUserAbilityOverridesBChange}
      />
      </div>
      <div className="compare-env-grid">
      <div className="field">
        <label htmlFor="compare-day-night">Day / Night</label>
        <select
          id="compare-day-night"
          data-env-value={compareDayNight}
          value={compareDayNight}
          onChange={(e) => onCompareDayNightChange(e.target.value as CompareDayNightMode)}
        >
          {compareDayNightOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeDayNight(compareDayNight)}</div>
      </div>
      <div className="field">
        <label htmlFor="compare-season">Season</label>
        <select
          id="compare-season"
          data-env-value={compareSeason}
          value={compareSeason}
          onChange={(e) => onCompareSeasonChange(e.target.value as CompareSeason)}
        >
          {compareSeasonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeSeason(compareSeason)}</div>
      </div>
      <div className="field">
        <label htmlFor="compare-moon">Moon</label>
        <select
          id="compare-moon"
          data-env-value={compareMoon}
          value={compareMoon}
          onChange={(e) => onCompareMoonChange(e.target.value as CompareMoonMode)}
        >
          {compareMoonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeMoon(compareMoon)}</div>
      </div>
      <div className="field">
        <label htmlFor="compare-weather">Weather</label>
        <select
          id="compare-weather"
          data-env-value={compareWeather}
          value={compareWeather}
          onChange={(e) => {
            const next = e.target.value as WeatherCondition;
            onCompareWeatherChange(next);
            // A cataclysm belongs to a season, so picking one brings its season
            // with it rather than leaving a fight that could not happen.
            if (next === "blizzard" && compareSeason !== "winter") onCompareSeasonChange("winter");
            if (next === "heatWave" && compareSeason !== "summer") onCompareSeasonChange("summer");
          }}
        >
          {WEATHER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeWeather(compareWeather)}</div>
      </div>
      <div className="field">
        <label htmlFor="compare-oxygen-moisture">Oxygen / Moisture</label>
        <select
          id="compare-oxygen-moisture"
          data-env-value={compareOxygenMoistureMode}
          value={compareOxygenMoistureMode}
          onChange={(e) => onCompareOxygenMoistureModeChange(e.target.value as OxygenMoistureMode)}
        >
          <option value="off">Off</option>
          {OXYGEN_MOISTURE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeOxygenMoisture(compareOxygenMoistureMode)}</div>
      </div>
      </div>
      <DpsCompositionPanel
        settings={compareDpsSettings}
        onChange={onCompareDpsSettingsChange}
      />
      <div className="compare-air-rule-card">
        <div className="compare-buff-heading">
          <span>Fight Rules</span>
          <small className="muted">Best Builds and Optimizer carry the same two</small>
        </div>
        <ToggleSwitch
          checked={compareAirRuleEnabled}
          onChange={onCompareAirRuleEnabledChange}
          label="Special Air PvP Rule"
          description={
            compareAirRuleEnabled
              ? "Both fliers clash on a fixed bite cooldown; bite-cooldown buffs and berserk are ignored."
              : "Force a fixed bite cooldown instead of each creature's own."
          }
        />
        {compareAirRuleEnabled ? (
          <div className="compare-air-body">
            <div className="compare-air-seg" role="group" aria-label="Cooldown scope">
              <button
                type="button"
                className={compareAirRuleCooldownLinked ? "is-active" : ""}
                aria-pressed={compareAirRuleCooldownLinked}
                onClick={() => onCompareAirRuleCooldownLinkedChange(true)}
              >
                Same for both
              </button>
              <button
                type="button"
                className={!compareAirRuleCooldownLinked ? "is-active" : ""}
                aria-pressed={!compareAirRuleCooldownLinked}
                onClick={() => onCompareAirRuleCooldownLinkedChange(false)}
              >
                Per side
              </button>
            </div>
            <div className={`compare-air-sides${compareAirRuleCooldownLinked ? " is-single" : ""}`}>
              <div className="field">
                <label htmlFor="compare-air-cd-a">
                  {compareAirRuleCooldownLinked
                    ? "Bite cooldown (sec)"
                    : `${creatureA?.name ?? "Creature A"} — cooldown (sec)`}
                </label>
                <AirRuleCooldownInput id="compare-air-cd-a" value={compareAirRuleCooldownSec} onChange={onCompareAirRuleCooldownSecChange} />
              </div>
              {!compareAirRuleCooldownLinked ? (
                <div className="field">
                  <label htmlFor="compare-air-cd-b">{`${creatureB?.name ?? "Creature B"} — cooldown (sec)`}</label>
                  <AirRuleCooldownInput id="compare-air-cd-b" value={compareAirRuleCooldownSecB} onChange={onCompareAirRuleCooldownSecBChange} />
                </div>
              ) : null}
            </div>
            <div className="note compare-air-rule-note">
              Bite-cooldown buffs, debuffs, and other modifiers are ignored while this rule is active.
            </div>
          </div>
        ) : null}
        <ToggleSwitch
          checked={compareAerialDodgeEnabled}
          onChange={onCompareAerialDodgeEnabledChange}
          label="Aerial Dodge"
          description={
            compareAerialDodgeEnabled
              ? "Each incoming bite and breath has a set chance to land on an airborne creature; the rest are dodged."
              : "Give fliers and gliders a chance to dodge incoming bites and breath. Wing Shredder removes it."
          }
        />
        {compareAerialDodgeEnabled ? (
          <div className="compare-air-body">
            <div className="compare-air-sides">
              <div className="field">
                <label htmlFor="compare-dodge-a">{`${creatureA?.name ?? "Creature A"} — chance to be hit`}</label>
                <AerialDodgePctInput id="compare-dodge-a" value={compareAerialDodgeHitChancePctA} onChange={onCompareAerialDodgeHitChancePctAChange} />
              </div>
              <div className="field">
                <label htmlFor="compare-dodge-b">{`${creatureB?.name ?? "Creature B"} — chance to be hit`}</label>
                <AerialDodgePctInput id="compare-dodge-b" value={compareAerialDodgeHitChancePctB} onChange={onCompareAerialDodgeHitChancePctBChange} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="compare-dodge-roll">Roll style</label>
              <select
                id="compare-dodge-roll"
                value={compareAerialDodgeRollStyle}
                onChange={(e) => onCompareAerialDodgeRollStyleChange(e.target.value === "random" ? "random" : "even")}
              >
                <option value="even">Even pattern (deterministic, default)</option>
                <option value="random">Real random (varies per run)</option>
              </select>
            </div>
            <div className="note compare-air-rule-note">
              Grounded creatures are always hit. Wing Shredder (Shredded Wings) grounds an airborne creature, so attacks on it always land.
              {compareAerialDodgeRollStyle === "random" ? " Real random uses independent rolls that vary per run and can streak." : ""}
            </div>
          </div>
        ) : null}
        <ToggleSwitch
          checked={compareNoMoveFacetank}
          onChange={onCompareNoMoveFacetankChange}
          label="No Move Facetank"
          description={
            compareNoMoveFacetank
              ? "Persistent stand-and-fight statuses now decay naturally."
              : "Keep persistent stand-and-fight statuses from decaying naturally."
          }
        />
        <div className="field">
          <label htmlFor="compare-first-tick-rule">First Tick Rule</label>
          <select
            id="compare-first-tick-rule"
            value={compareFirstTickMode}
            onChange={(e) => onCompareFirstTickModeChange(e.target.value as "off" | "ailments" | "regen" | "both")}
          >
            <option value="off">Off</option>
            <option value="ailments">Ailments only</option>
            <option value="regen">Regen only</option>
            <option value="both">Ailments + Regen</option>
          </select>
          <div className="note compare-air-rule-note">
            Ailments affect only first dot-style ailment ticks, mostly negative statuses.
          </div>
        </div>
        {compareFirstTickMode !== "off" ? (
          <div className="field compare-air-rule-field">
            <label htmlFor="compare-first-tick-delay">First Tick Delay (sec)</label>
            <input
              id="compare-first-tick-delay"
              type="number"
              min="0.1"
              step="0.1"
              value={compareFirstTickDelaySec}
              onChange={(e) => onCompareFirstTickDelaySecChange(Math.max(0.1, Number(e.target.value) || 1))}
            />
            <div className="note compare-air-rule-note">
              Regen uses this delay for the first passive tick. Ailments use it only for the first eligible dot tick, then revert to normal cadence.
            </div>
          </div>
        ) : null}
      </div>
      {renderBuffChecklist("Creature A Buffs", compareBuffsA, onCompareBuffsAChange)}
      {renderBuffChecklist("Creature B Buffs", compareBuffsB, onCompareBuffsBChange)}
      {developerMode ? (
        // Grouping wrapper is a plain block in the default layout; the beta
        // Setup overlay (.cb-modal) styles it into a labeled "Developer"
        // section card, matching compare-policy-group / compare-env-grid.
        <div className="compare-dev-group">
          <ToggleSwitch
            checked={activesOn}
            onChange={onActivesOnChange}
            label="Actives"
            description={activesOn ? "Actives assumed near-optimal." : "Actives disabled."}
          />
          <ToggleSwitch
            checked={breathOn}
            onChange={onBreathOnChange}
            label="Breath"
            description="Breath applied only if creature has breath data."
          />
          <ToggleSwitch
            checked={debugMode}
            onChange={onDebugModeChange}
            label="Debug Mode"
            description="Show modeling limitations and detailed counters."
          />
          {debugMode ? (
            <div className="debug-controls">
              <label htmlFor="compare-bad-omen-roulette">Bad Omen Roulette</label>
              <select
                id="compare-bad-omen-roulette"
                value={badOmenChoice}
                onChange={(e) => onBadOmenChoiceChange(e.target.value)}
              >
                <option value="auto">Auto (roll per run)</option>
                {badOmenOutcomes.map((outcome) => (
                  <option key={`${outcome.statusId}|${outcome.stacks}`} value={`${outcome.statusId}|${outcome.stacks}`}>
                    {outcome.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <CombatTogglePanel
            label="Creature A"
            finalStats={finalA}
            creature={creatureA}
            disabled={disabledAbilitiesA}
            onChange={onDisabledAbilitiesAChange}
          />
          <CombatTogglePanel
            label="Creature B"
            finalStats={finalB}
            creature={creatureB}
            disabled={disabledAbilitiesB}
            onChange={onDisabledAbilitiesBChange}
          />
        </div>
      ) : null}
      <div className="calculate-row">
        <button
          className="primary calculate-btn"
          onClick={onCalculate}
          disabled={!finalA || !finalB || isCalculating}
          aria-busy={isCalculating}
        >
          {isCalculating ? (
            <span className="calculate-btn__busy">
              <span className="calculate-spinner" aria-hidden="true" />
              Calculating… {(calcElapsedMs / 1000).toFixed(1)}s
            </span>
          ) : (
            "Calculate"
          )}
        </button>
        {needsCalc && !isCalculating ? (
          <span className="muted">Press Calculate to update results.</span>
        ) : null}
      </div>
    </div>
  );
}

const DPS_CATEGORY_LABELS: Record<CompareDpsCategory, string> = {
  bite: "Bites",
  breath: "Breath",
  dot: "Ailments",
  ability: "Abilities",
};

function DpsCompositionPanel({
  settings,
  onChange,
}: {
  settings: CompareDpsSettings;
  onChange: (next: CompareDpsSettings) => void;
}) {
  const toggleCategory = (cat: CompareDpsCategory) => {
    onChange({
      ...settings,
      categories: { ...settings.categories, [cat]: !settings.categories[cat] },
    });
  };
  const setDenominator = (next: CompareDpsDenominator) => {
    onChange({ ...settings, denominator: next });
  };
  const isPerBite = settings.denominator === "perBite";
  return (
    <div className="compare-buff-section">
      <div className="compare-buff-heading">
        <span>DPS composition</span>
        <small className="muted">Outcome panel only</small>
      </div>
      <div className="field">
        <label htmlFor="compare-dps-denominator">Denominator</label>
        <select
          id="compare-dps-denominator"
          value={settings.denominator}
          onChange={(e) => setDenominator(e.target.value as CompareDpsDenominator)}
        >
          <option value="perSecond">Per second (damage / time)</option>
          <option value="perBite">Per bite (damage / bite count)</option>
        </select>
      </div>
      {/* Categories only make sense for per-second DPS. Per-bite is
          a fixed metric (bite damage / bite count) - there is no
          "ability damage per bite" or "ailment damage per bite" that
          translates cleanly, and ability-driven bite buffs are already
          baked into the bite event itself. So in per-bite mode we hide
          the chips entirely and the note explains the fixed behavior. */}
      {!isPerBite ? (
        <>
          <div className="compare-buff-grid">
            {(Object.keys(DPS_CATEGORY_LABELS) as CompareDpsCategory[]).map((cat) => (
              <label
                key={cat}
                className={`compare-buff-chip${settings.categories[cat] ? " selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={settings.categories[cat]}
                  onChange={() => toggleCategory(cat)}
                />
                <span>{DPS_CATEGORY_LABELS[cat]}</span>
              </label>
            ))}
          </div>
        </>
      ) : null}
      <div className="note compare-air-rule-note">{describeDpsSettings(settings)}</div>
    </div>
  );
}

export function describeDpsSettings(settings: CompareDpsSettings): string {
  if (settings.denominator === "perBite") {
    return "Bite damage per bite swing. Ability buffs to bites are included.";
  }
  const active = (Object.entries(settings.categories) as [CompareDpsCategory, boolean][])
    .filter(([, on]) => on)
    .map(([cat]) => DPS_CATEGORY_LABELS[cat].toLowerCase());
  if (active.length === 0) return "No damage categories selected - DPS reads as 0.";
  const list = active.length === 4 ? "all damage" : active.join(" + ");
  return `${list[0].toUpperCase()}${list.slice(1)}, per second.`;
}

function describeSeason(season: CompareSeason): string {
  if (season === "none") return "No season set.";
  const hunger = getSeasonDrainChangePct(season, "hunger");
  const thirst = getSeasonDrainChangePct(season, "thirst");
  const parts: string[] = [];
  const phrase = (pct: number, meter: string) =>
    `${meter} drains ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "faster" : "slower"}`;
  if (Math.abs(hunger) > 0.5) parts.push(phrase(hunger, "Hunger"));
  if (Math.abs(thirst) > 0.5) parts.push(phrase(thirst, "thirst"));
  return parts.length === 0 ? "No effect a fight can see." : `${parts.join(", ")}.`;
}

function describeDayNight(mode: CompareDayNightMode): string {
  switch (mode) {
    case "day":
      return "Photovore / Photocarnivore diets: +5% damage, +15% health regen. Other diets: no effect.";
    case "night":
      return "Photovore / Photocarnivore diets: -5% damage, -15% health regen. Other diets: no effect.";
    default:
      return "No day/night bonus applied. Photovore / Photocarnivore diets are affected when set.";
  }
}

function describeMoon(mode: CompareMoonMode): string {
  switch (mode) {
    case "blueMoon":
      return "-50% damage, +50% health regen.";
    case "bloodMoon":
      return "+50% damage, -50% bite cooldown.";
    default:
      return "No moon event active.";
  }
}

function describeOxygenMoisture(mode: OxygenMoistureMode): string {
  switch (mode) {
    case "ground":
      return "Ground: each creature's moisture pool drains 1/s, then -5% max HP/s floored at 50% HP (drying never kills). A creature with no moisture is immune.";
    case "underwater":
      return "Underwater: each creature's oxygen pool drains 1/s, then -5% max HP/s with no floor (drowning is lethal). A creature with no oxygen is immune.";
    default:
      return "No environment drain active.";
  }
}

function describeWeather(mode: WeatherCondition): string {
  switch (mode) {
    case "heatWave":
      return "Both sides: 1% max HP + 2 Burn every 3s. Volcanic creatures are immune.";
    case "blizzard":
      return "Both sides: 0.75% max HP every 3s (Hypothermia). Frosty creatures are immune; laying down stops the damage.";
    case "acidRain":
      return "Both sides: 3% max HP + 2 Poison every 3s. No creature is immune.";
    default:
      return "No weather cataclysm active.";
  }
}

// Draft input for the Aerial Dodge per-side hit chance (0..100), same
// no-clamp-per-keystroke behaviour as AirRuleCooldownInput.
function AerialDodgePctInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>(() => String(value));
  const committedRef = useRef<number>(value);
  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(String(value));
    }
  }, [value]);
  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(String(committedRef.current));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(committedRef.current));
      return;
    }
    const clamped = Math.max(0, Math.min(100, parsed));
    committedRef.current = clamped;
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }
  return (
    <input
      id={id}
      type="number"
      min={0}
      max={100}
      step={1}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

// Local-draft input so the user can freely edit / clear the field without the
// on-change handler clamping every keystroke back to the default.
function AirRuleCooldownInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>(() => String(value));
  const committedRef = useRef<number>(value);

  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(String(value));
    }
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(String(committedRef.current));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(committedRef.current));
      return;
    }
    const clamped = Math.max(0.1, parsed);
    committedRef.current = clamped;
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <input
      id={id}
      type="number"
      min="0.1"
      step="0.05"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
