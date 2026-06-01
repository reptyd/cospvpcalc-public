import { useMemo, useState } from "react";
import type { BuildOptions, CreatureRuntime, SimulationSummary } from "../engine";
import { veneration } from "../engine/buildData";
import { creatureNameMatchesQuery } from "../engine/creatureData";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../components/BuildSelectors";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { formatRoundedNumber, formatRoundedSeconds } from "../shared/displayFormat";
import { getCreatureFacetTags } from "./friendlyData";
import { FriendlyTopBar, HealthBar, MetricCard } from "./FriendlyUiPrimitives";

type BattleControllerShape = {
  summary: SimulationSummary | null;
  isRunning: boolean;
  displayHpA: number;
  displayHpB: number;
  animationKey: number;
  counters: {
    bitesA: number;
    bitesB: number;
    abilitiesA: number;
    abilitiesB: number;
    breathA: number;
    breathB: number;
  };
  runBattle: () => Promise<void>;
};

export function FriendlyBattleFlow({
  nameA,
  nameB,
  buildA,
  buildB,
  creatures,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
  onBack,
  onOpenAdvanced,
  onSwapSides,
  battle,
}: {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatures: CreatureRuntime[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (build: BuildOptions) => void;
  onBuildBChange: (build: BuildOptions) => void;
  onBack: () => void;
  onOpenAdvanced: () => void;
  onSwapSides: () => void;
  battle: BattleControllerShape;
}) {
  return (
    <section className="friendly-panel">
      <FriendlyTopBar
        title="Who Wins?"
        description="Set up both sides, start the fight, and compare the result with health bars and battle stats."
        onBack={onBack}
      />
      <div className="battle-grid">
        <BattleConfigurator
          title="Side A"
          accent="left"
          name={nameA}
          creatures={creatures}
          build={buildA}
          getCreatureIcon={getCreatureIcon}
          onNameChange={onNameAChange}
          onBuildChange={onBuildAChange}
        />
        <BattleConfigurator
          title="Side B"
          accent="right"
          name={nameB}
          creatures={creatures}
          build={buildB}
          getCreatureIcon={getCreatureIcon}
          onNameChange={onNameBChange}
          onBuildChange={onBuildBChange}
        />
      </div>

      <div className={`battle-results-shell${battle.summary ? " active" : ""}`}>
        <div key={`left-stage-${battle.animationKey}-${battle.summary?.winner ?? "pending"}`} className={`battle-stage stage-left${battle.summary ? " impact" : ""}`}>
          <div className="battle-portrait">
            <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={164} />
          </div>
          <div className="battle-stage-copy">
            <span className="friendly-kicker battle-creature-name">{nameA}</span>
            <h2>{nameA}</h2>
            <HealthBar key={`hp-a-${battle.animationKey}`} label="HP" value={battle.displayHpA} />
          </div>
        </div>
        <div key={`announce-${battle.animationKey}-${battle.summary?.winner ?? "pending"}`} className="battle-announce">
          <span className="friendly-kicker">Result</span>
          <h2>{battle.summary ? renderWinnerText(battle.summary, nameA, nameB) : "Run the battle to reveal a winner"}</h2>
          <p>{battle.summary ? renderWinningTtk(battle.summary) : "The page animates health loss and surfaces key counters from the battle log."}</p>
        </div>
        <div key={`right-stage-${battle.animationKey}-${battle.summary?.winner ?? "pending"}`} className={`battle-stage stage-right${battle.summary ? " impact" : ""}`}>
          <div className="battle-portrait">
            <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={164} />
          </div>
          <div className="battle-stage-copy">
            <span className="friendly-kicker battle-creature-name">{nameB}</span>
            <h2>{nameB}</h2>
            <HealthBar key={`hp-b-${battle.animationKey}`} label="HP" value={battle.displayHpB} />
          </div>
        </div>
      </div>

      <div className="battle-toolbar battle-toolbar-lower">
        <button className="friendly-secondary" type="button" onClick={onSwapSides}>
          Swap Sides
        </button>
        <button className="friendly-secondary" type="button" onClick={onOpenAdvanced}>
          Open Advanced Compare
        </button>
        <button className="friendly-primary battle-run-button battle-toolbar-run" type="button" onClick={() => void battle.runBattle()} disabled={battle.isRunning}>
          {battle.isRunning ? "Calculating..." : "Start Battle"}
        </button>
      </div>

      <div className="battle-stats-shell">
        <div className="battle-stats-column battle-stats-column-left">
          <div className="battle-stats-title-row">
            <span className="friendly-kicker">Side A</span>
            <strong>{nameA}</strong>
          </div>
          <div className="battle-summary-grid">
            <MetricCard label="Final HP" value={battle.summary ? `${formatRoundedNumber(battle.summary.finalHpA)} / ${formatRoundedNumber(battle.summary.maxHpA)}` : "-"} />
            <MetricCard label="TTK" value={battle.summary ? formatRoundedSeconds(battle.summary.ttkAtoB) : "-"} />
            <MetricCard label="DPS" value={battle.summary ? formatRoundedNumber(battle.summary.dpsAtoB) : "-"} />
            <MetricCard label="Bites" value={String(battle.counters.bitesA)} />
            <MetricCard label="Breath Time" value={formatRoundedSeconds(battle.counters.breathA)} />
          </div>
          <AbilityUsageCard
            title="Abilities Used"
            applied={getDisplayedAbilities(battle.summary?.debug?.A?.abilitiesApplied ?? [])}
          />
        </div>

        <div className="battle-stats-column battle-stats-column-right">
          <div className="battle-stats-title-row">
            <span className="friendly-kicker">Side B</span>
            <strong>{nameB}</strong>
          </div>
          <div className="battle-summary-grid">
            <MetricCard label="Final HP" value={battle.summary ? `${formatRoundedNumber(battle.summary.finalHpB)} / ${formatRoundedNumber(battle.summary.maxHpB)}` : "-"} />
            <MetricCard label="TTK" value={battle.summary ? formatRoundedSeconds(battle.summary.ttkBtoA) : "-"} />
            <MetricCard label="DPS" value={battle.summary ? formatRoundedNumber(battle.summary.dpsBtoA) : "-"} />
            <MetricCard label="Bites" value={String(battle.counters.bitesB)} />
            <MetricCard label="Breath Time" value={formatRoundedSeconds(battle.counters.breathB)} />
          </div>
          <AbilityUsageCard
            title="Abilities Used"
            applied={getDisplayedAbilities(battle.summary?.debug?.B?.abilitiesApplied ?? [])}
          />
        </div>
      </div>

      <div className="friendly-card timeline-card">
        <div className="timeline-header">
          <div>
            <span className="friendly-kicker">Battle History</span>
            <h2>Timeline</h2>
          </div>
        </div>
        <div className="timeline-list">
          {(battle.summary?.combatLog ?? []).map((entry, index) => (
            <div className="timeline-entry" key={`${entry.time}-${entry.type}-${index}`}>
              <span>{formatRoundedSeconds(entry.time)}</span>
              <strong>{entry.attacker === "A" ? nameA : nameB}</strong>
              <div className="timeline-event-copy">
                <span>{entry.description ?? formatCombatEventLabel(entry.type)}</span>
                {entry.detail ? <span className="timeline-event-detail">{entry.detail}</span> : null}
              </div>
              <div className="timeline-damage-block">
                <span>{formatRoundedNumber(entry.damage)} dmg</span>
                <span className="timeline-hp-after">HP left {formatRoundedNumber(entry.hpAfter)}</span>
              </div>
            </div>
          ))}
          {!battle.summary?.combatLog?.length ? <p className="friendly-muted">No battle history yet.</p> : null}
        </div>
      </div>
    </section>
  );
}

function BattleConfigurator({
  title,
  accent,
  name,
  creatures,
  build,
  getCreatureIcon,
  onNameChange,
  onBuildChange,
}: {
  title: string;
  accent: "left" | "right";
  name: string;
  creatures: CreatureRuntime[];
  build: BuildOptions;
  getCreatureIcon: (name: string) => string | null;
  onNameChange: (value: string) => void;
  onBuildChange: (value: BuildOptions) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTiers, setSelectedTiers] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const tierOptions = useMemo(
    () => Array.from(new Set(creatures.map((creature) => creature.stats.tier))).sort((a, b) => a - b),
    [creatures],
  );
  const tagOptions = useMemo(
    () => Array.from(new Set(creatures.flatMap((creature) => getCreatureFacetTags(creature)))).sort((a, b) => a.localeCompare(b)),
    [creatures],
  );
  const filteredCreatures = useMemo(() => {
    return creatures.filter((creature) => {
      if (!creatureNameMatchesQuery(creature.name, query)) return false;
      if (selectedTiers.length > 0 && !selectedTiers.includes(creature.stats.tier)) return false;
      if (selectedTags.length > 0) {
        const tags = getCreatureFacetTags(creature);
        if (!selectedTags.every((tag) => tags.includes(tag))) return false;
      }
      return true;
    });
  }, [creatures, query, selectedTags, selectedTiers]);
  return (
    <div className={`battle-config-card ${accent}`}>
      <div className="battle-config-header">
        <div>
          <span className="friendly-kicker">{title}</span>
          <h2>{name}</h2>
        </div>
        <IconImg src={getCreatureIcon(name)} alt={name} size={94} />
      </div>
      <label className="friendly-field">
        <span>Creature</span>
        <CreatureNameInput value={name} onChange={onNameChange} creatureNames={creatures.map((creature) => creature.name)} />
      </label>
      <div className="battle-creature-finder">
        <label className="friendly-field">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search creature" />
        </label>
        <div className="battle-filter-group">
          <span className="friendly-kicker">Tier Filter</span>
          <div className="battle-filter-grid">
            {tierOptions.map((tier) => (
              <button
                key={tier}
                className={`battle-filter-pill${selectedTiers.includes(tier) ? " active" : ""}`}
                type="button"
                onClick={() =>
                  setSelectedTiers((current) =>
                    current.includes(tier) ? current.filter((item) => item !== tier) : [...current, tier].sort((a, b) => a - b),
                  )
                }
              >
                Tier {tier}
              </button>
            ))}
          </div>
        </div>
        <div className="battle-filter-group">
          <span className="friendly-kicker">Type Filter</span>
          <div className="battle-filter-grid">
            {tagOptions.slice(0, 10).map((tag) => (
              <button
                key={tag}
                className={`battle-filter-pill${selectedTags.includes(tag) ? " active" : ""}`}
                type="button"
                onClick={() =>
                  setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="battle-creature-results">
          {filteredCreatures.slice(0, 8).map((creature) => (
            <button
              key={creature.name}
              className={`battle-creature-tile${creature.name === name ? " selected" : ""}`}
              type="button"
              onClick={() => onNameChange(creature.name)}
            >
              <IconImg src={getCreatureIcon(creature.name)} alt={creature.name} size={42} />
              <div>
                <strong>{creature.name}</strong>
                <span>
                  Tier {creature.stats.tier} | {creature.stats.type ?? "Unknown"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <label className="friendly-field compact">
        <span>Veneration</span>
        <select
          value={build.venerationStage}
          onChange={(event) => onBuildChange({ ...build, venerationStage: Number(event.target.value) })}
        >
          {Array.from({ length: veneration.stages + 1 }, (_, index) => (
            <option key={index} value={index}>
              {index}
            </option>
          ))}
        </select>
      </label>
      <div className="battle-selector-stack">
        <div>
          <span className="friendly-kicker">Traits</span>
          <TraitSelectors build={build} onBuildChange={onBuildChange} />
        </div>
        <div>
          <span className="friendly-kicker">Ascension</span>
          <AscensionSelectors build={build} onBuildChange={onBuildChange} />
        </div>
        <div>
          <span className="friendly-kicker">Plushies</span>
          <PlushieSelectors build={build} onBuildChange={onBuildChange} />
        </div>
        <div>
          <span className="friendly-kicker">Elder</span>
          <ElderSelector build={build} onBuildChange={onBuildChange} />
        </div>
      </div>
    </div>
  );
}

function renderWinnerText(summary: SimulationSummary, nameA: string, nameB: string): string {
  if (summary.winner === "A") return `${nameA} wins`;
  if (summary.winner === "B") return `${nameB} wins`;
  return "Draw";
}

function renderWinningTtk(summary: SimulationSummary): string {
  if (summary.winner === "A") return `Winning TTK ${formatRoundedSeconds(summary.ttkAtoB)}`;
  if (summary.winner === "B") return `Winning TTK ${formatRoundedSeconds(summary.ttkBtoA)}`;
  return "Draw after the full battle duration";
}

function formatCombatEventLabel(type: "bite" | "dot" | "breath" | "ability"): string {
  if (type === "bite") return "Bite hit";
  if (type === "dot") return "Damage over time";
  if (type === "breath") return "Breath tick";
  return "Active ability";
}

function AbilityUsageCard({
  title,
  applied,
}: {
  title: string;
  applied: Array<{ name: string; count: number }>;
}) {
  return (
    <div className="ability-usage-card">
      <span className="friendly-kicker">{title}</span>
      {applied.length === 0 ? (
        <p className="friendly-muted">No active abilities on this creature.</p>
      ) : (
        <div className="ability-usage-list">
          {applied.map((entry) => (
            <div className="ability-usage-row" key={entry.name}>
              <span>{entry.name}</span>
              <strong>{entry.count}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getDisplayedAbilities(applied: Array<{ name: string; count: number }>): Array<{ name: string; count: number }> {
  return applied.filter((entry) => entry.name !== "Breath");
}
