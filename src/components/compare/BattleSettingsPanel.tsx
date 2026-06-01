import { useEffect, useRef, useState } from "react";
import type {
  AbilityTimingMode,
  CreatureRuntime,
  FinalStats,
  UserAbilityLevelOverrides,
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
import { compareBuffOptions, compareDayNightOptions, compareMoonOptions } from "./compareBuffConfig";
import { WEATHER_OPTIONS, type WeatherCondition } from "../../engine/weather";
import { AbilityTimingOverridesPanel } from "./AbilityTimingOverridesPanel";
import { UserAbilityTimingOverridesPanel } from "./UserAbilityTimingOverridesPanel";
import { UserAbilityLevelsPanel } from "./UserAbilityLevelsPanel";
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
  compareUserAbilityLevelsA,
  compareUserAbilityLevelsB,
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
  compareWeather,
  compareDpsSettings,
  airRuleEligible,
  compareAirRuleEnabled,
  compareAirRuleCooldownSec,
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
  onCompareUserAbilityLevelsAChange,
  onCompareUserAbilityLevelsBChange,
  onBadOmenChoiceChange,
  onDisabledAbilitiesAChange,
  onDisabledAbilitiesBChange,
  onCompareBuffsAChange,
  onCompareBuffsBChange,
  onCompareDayNightChange,
  onCompareMoonChange,
  onCompareWeatherChange,
  onCompareDpsSettingsChange,
  onCompareAirRuleEnabledChange,
  onCompareAirRuleCooldownSecChange,
  onCompareNoMoveFacetankChange,
  onCompareFirstTickModeChange,
  onCompareFirstTickDelaySecChange,
  onCalculate,
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
  compareUserAbilityLevelsA: UserAbilityLevelOverrides;
  compareUserAbilityLevelsB: UserAbilityLevelOverrides;
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
  compareWeather: WeatherCondition;
  compareDpsSettings: CompareDpsSettings;
  airRuleEligible: boolean;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
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
  onCompareUserAbilityLevelsAChange: (value: UserAbilityLevelOverrides) => void;
  onCompareUserAbilityLevelsBChange: (value: UserAbilityLevelOverrides) => void;
  onBadOmenChoiceChange: (value: string) => void;
  onDisabledAbilitiesAChange: (value: string[]) => void;
  onDisabledAbilitiesBChange: (value: string[]) => void;
  onCompareBuffsAChange: (value: CompareBuffSelection) => void;
  onCompareBuffsBChange: (value: CompareBuffSelection) => void;
  onCompareDayNightChange: (value: CompareDayNightMode) => void;
  onCompareMoonChange: (value: CompareMoonMode) => void;
  onCompareWeatherChange: (value: WeatherCondition) => void;
  onCompareDpsSettingsChange: (value: CompareDpsSettings) => void;
  onCompareAirRuleEnabledChange: (value: boolean) => void;
  onCompareAirRuleCooldownSecChange: (value: number) => void;
  onCompareNoMoveFacetankChange: (value: boolean) => void;
  onCompareFirstTickModeChange: (value: "off" | "ailments" | "regen" | "both") => void;
  onCompareFirstTickDelaySecChange: (value: number) => void;
  onCalculate: () => void;
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
      <UserAbilityLevelsPanel
        creatureA={creatureA}
        creatureB={creatureB}
        levelsA={compareUserAbilityLevelsA}
        levelsB={compareUserAbilityLevelsB}
        onLevelsAChange={onCompareUserAbilityLevelsAChange}
        onLevelsBChange={onCompareUserAbilityLevelsBChange}
      />
      <div className="field">
        <label htmlFor="compare-day-night">Day / Night</label>
        <select
          id="compare-day-night"
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
        <label htmlFor="compare-moon">Moon</label>
        <select
          id="compare-moon"
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
          value={compareWeather}
          onChange={(e) => onCompareWeatherChange(e.target.value as WeatherCondition)}
        >
          {WEATHER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="note compare-air-rule-note">{describeWeather(compareWeather)}</div>
      </div>
      <DpsCompositionPanel
        settings={compareDpsSettings}
        onChange={onCompareDpsSettingsChange}
      />
      <div className="compare-air-rule-card">
        <div className="compare-buff-heading">
          <span>Compare-Only Rules</span>
          <small className="muted">Local compare overrides only</small>
        </div>
        {airRuleEligible ? (
          <>
            <ToggleSwitch
              checked={compareAirRuleEnabled}
              onChange={onCompareAirRuleEnabledChange}
              label="Special Air PvP Rule"
              description={
                compareAirRuleEnabled
                  ? `Both creatures now always use a bite cooldown of ${compareAirRuleCooldownSec.toFixed(2)}s.`
                  : "Use one shared custom bite cooldown for both creatures."
              }
            />
            {compareAirRuleEnabled ? (
              <div className="field compare-air-rule-field">
                <label htmlFor="compare-air-rule-cooldown">Shared Bite Cooldown (sec)</label>
                <AirRuleCooldownInput
                  id="compare-air-rule-cooldown"
                  value={compareAirRuleCooldownSec}
                  onChange={onCompareAirRuleCooldownSecChange}
                />
                <div className="note compare-air-rule-note">
                  Bite cooldown buffs, debuffs, and other modifiers are ignored while this rule is active.
                </div>
              </div>
            ) : null}
          </>
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
            Compare-only. Ailments affect only first dot-style ailment ticks, mostly negative statuses, and never route into Best Builds,
            optimizer, or Rust.
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
        <>
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
        </>
      ) : null}
      <div className="calculate-row">
        <button className="primary" onClick={onCalculate} disabled={!finalA || !finalB}>
          Calculate
        </button>
        {needsCalc ? <span className="muted">Press Calculate to update results.</span> : null}
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
          a fixed metric (bite damage / bite count) — there is no
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
  if (active.length === 0) return "No damage categories selected — DPS reads as 0.";
  const list = active.length === 4 ? "all damage" : active.join(" + ");
  return `${list[0].toUpperCase()}${list.slice(1)}, per second.`;
}

function describeDayNight(mode: CompareDayNightMode): string {
  switch (mode) {
    case "day":
      return "Photovore / Photocarnivore diets: +5% damage, +25% stamina regen, +15% health regen. Other diets: no effect.";
    case "night":
      return "Photovore / Photocarnivore diets: -5% damage, -25% stamina regen, -15% health regen. Other diets: no effect.";
    default:
      return "No day/night bonus applied. Photovore / Photocarnivore diets are affected when set.";
  }
}

function describeMoon(mode: CompareMoonMode): string {
  switch (mode) {
    case "blueMoon":
      return "-50% damage, +50% stamina regen, +50% health regen.";
    case "bloodMoon":
      return "+50% damage, +50% stamina regen, -50% bite cooldown.";
    default:
      return "No moon event active.";
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
