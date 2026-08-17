// Beta "Speed Builds" view. Dev-gated by the site design toggle and routed in
// place of the classic page when the beta design is active. Shares
// useSpeedBuildsPageController, so the sweep and the maths are identical.
//
// The two modes get two compositions, because they are two kinds of page.
// Optimize is run-gated in nature - pick a creature and a channel, read a
// ranking - so it keeps the family's ranked cards with their side controls
// behind toolbar popovers. Manual is live: every toggle moves the number at
// once, so its loadout sits on the page and the answer is pinned beside it, the
// shape the Custom editor uses for its preview pane.
//
// Every figure on the page is a pair. Sustained is the build with nothing held,
// which is what the creature is worth whatever it happens to be doing; peak
// adds what the reader is holding. The creature's printed stat appears once, in
// the smallest type on the card, because nobody plays on it.

import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import { BetaSelect } from "../components/beta/BetaSelect";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { IconImg } from "../components/IconImg";
import { SpeedBuildsBuffControls } from "../components/speedBuilds/SpeedBuildsBuffControls";
import { SpeedBuildsConstraintControls } from "../components/speedBuilds/SpeedBuildsConstraintControls";
import { SpeedBuildsLoadoutControls } from "../components/speedBuilds/SpeedBuildsLoadoutControls";
import { getPlushieIcon, getTraitIcon, traits } from "../engine/buildData";
import type { SpeedReadout } from "../speed/speedChannels";
import { traitAscension } from "../speed/speedMath";
import type { SpeedTarget } from "../speed/speedSearch";
import {
  useSpeedBuildsPageController,
  type SpeedBuildsController,
  type SpeedRankingRow,
} from "./useSpeedBuildsPageController";
import {
  channelLabel,
  channelRows,
  contributionNotes,
  contributionRows,
  countSpeedConstraints,
  formatChannelValue,
  formatDelta,
  formatSpeedValue,
  isLowerBetter,
  RANK_BY_LABELS,
  type SpeedChannelRow,
  type SpeedRankBy,
} from "./speedBuildsShared";
import type { SpeedBuildsPageProps } from "./SpeedBuildsPage";
import "../components/beta/betaSelect.css";
import "../components/beta/buildLoadout.css";
import "./compareBeta.css";
import "./speedBuildsBeta.css";

// The sweep works in trait ids; the strip prints the name the picker two panels
// over uses.
const TRAIT_NAMES: Record<string, string> = Object.fromEntries(traits.map((trait) => [trait.id, trait.name]));

function SpeedModal({
  title,
  onClose,
  children,
  // A modal holding a single combobox has nothing to scroll, and the scroll box
  // would clip the suggestions it drops below the field.
  spillsOut = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  spillsOut?: boolean;
}) {
  return createPortal(
    <div className="beta-portal">
      <div className="cb-scrim" onClick={onClose} />
      <aside
        className={`cb-modal spb-modal${spillsOut ? " spb-modal--spill" : ""}`}
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <div className="cb-modal__head">
          <h3>{title}</h3>
          <div className="cb-modal__head-actions">
            <button className="cb-icon" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="cb-modal__body">
          <div className="panel-block">{children}</div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** Both plushie slots, always. The sweep drops any build a smaller one already
 * matches, so a single-plushie row means the other slot really is spare - and an
 * empty slot is still a slot, so it keeps the frame of a filled one rather than
 * trailing off the row as a note about it.
 * Same pills BuildLoadout gives a build on the Optimizer and Best Builds cards. */
function PlushieSlots({ plushies }: { plushies: readonly string[] }) {
  return (
    <div className="bl spb-slots">
      {[plushies[0] ?? "", plushies[1] ?? ""].map((name, index) => (
        <span className={`bl__item bl__item--plush${name ? "" : " bl__item--empty"}`} key={index}>
          {name ? (
            <IconImg src={getPlushieIcon(name)} alt="" size={18} />
          ) : (
            <span className="bl__slot" aria-hidden="true" />
          )}
          <span className="bl__name">{name || "None"}</span>
        </span>
      ))}
    </div>
  );
}

/** One of the channels that is not the one being ranked or focused. It carries
 * the peak figure, and only names the sustained one it came from when the two
 * differ - a column of "unchanged" teaches nothing. */
function ChannelTile({ row }: { row: SpeedChannelRow }) {
  return (
    <div className="spb-metric">
      <span>{row.label}</span>
      <b>{formatChannelValue(row.peak)}</b>
      {row.tone === "flat" ? null : (
        <span className="spb-metric__from">
          from {formatChannelValue(row.sustained)}{" "}
          <span className={`spb-delta spb-delta--${row.tone}`}>{formatDelta(row.deltaPct)}</span>
        </span>
      )}
    </div>
  );
}

function RankCard({
  rank,
  row,
  base,
  target,
  rankBy,
  holding,
  notes,
  onOpen,
}: {
  rank: number;
  row: SpeedRankingRow;
  base: SpeedReadout;
  target: SpeedTarget;
  rankBy: SpeedRankBy;
  holding: boolean;
  notes: string[];
  onOpen: () => void;
}) {
  const rows = channelRows(base, row.sustained, row.peak);
  const focused = rows.find((channel) => channel.channel === target);
  const hero = rank === 1;
  const other = focused
    ? rankBy === "peak"
      ? { value: focused.sustained, name: "sustained", joiner: "over" }
      : { value: focused.peak, name: "peak", joiner: "to" }
    : null;

  return (
    <article className={`spb-card${hero ? " spb-card--hero" : ""}`}>
      <div className="spb-card__head">
        <span className="spb-card__rank">#{rank}</span>
        <div className="spb-card__figures">
          <b className="spb-card__value">{formatSpeedValue(row.candidate.value)}</b>
          {holding && focused && other ? (
            <span className="spb-card__sustained">
              <span className={`spb-delta spb-delta--${focused.tone}`}>{formatDelta(focused.deltaPct)}</span>{" "}
              {other.joiner} {formatChannelValue(other.value)} {other.name}
            </span>
          ) : null}
        </div>
        <PlushieSlots plushies={row.candidate.build.plushies} />
        <button type="button" className="cb-ghostbtn spb-card__open" onClick={onOpen}>
          Open in Manual
        </button>
      </div>
      {hero && notes.length > 0 ? <p className="spb-card__why">{notes.join(", ")}</p> : null}
      {hero ? (
        <div className="spb-card__metrics">
          {rows
            .filter((row) => row !== focused)
            .map((row) => (
              <ChannelTile row={row} key={row.channel} />
            ))}
        </div>
      ) : null}
    </article>
  );
}

/** What the whole ranking holds fixed: the elder and the trait the sweep chose
 * by measurement, anything the reader is holding, and every constraint he set
 * before it ran. Stated here so ten rows can differ only by plushie, and so a
 * narrowed ranking never reads like the open one - a locked elder that happens
 * to be the elder the sweep would have picked still has to say it was locked.
 * Built out of the same strip the Optimizer and Best Builds cards use for a
 * build, down to the archetype-tinted elder pill. */
function RankingConstants({ controller }: { controller: SpeedBuildsController }) {
  const { fixedChoice, constraints, offered, heldIds } = controller;
  const held = offered.filter((effect) => heldIds.includes(effect.id));
  const elder = fixedChoice?.elder && fixedChoice.elder !== "None" ? fixedChoice.elder : null;

  if (!fixedChoice) return null;

  const cap = (label: string, constrained: boolean) => (
    <span className={`bl__cap${constrained ? " bl__cap--set" : ""}`}>{label}</span>
  );
  // Veneration reaches a movement channel only through one of these two traits,
  // so the stage is stated as the badge on the trait that received it rather
  // than as a group of its own. Locking a trait the channels ignore leaves no
  // badge, which is the honest reading: the stage changes nothing.
  const ascension = (trait: string) =>
    trait === "Speed" || trait === "Stamina_Regen" ? traitAscension(fixedChoice, trait) : null;

  return (
    <div className="bl spb-fixed">
      <span className="cb-bar__cap">Same in every build</span>
      <span className="bl__sep" aria-hidden="true" />

      <div className="bl__grp">
        {cap(constraints.elder !== null ? "Elder locked" : "Elder", constraints.elder !== null)}
        {elder ? (
          <span className="bl__elder" data-elder={elder}>
            {elder}
          </span>
        ) : (
          <span className="bl__none">None</span>
        )}
      </div>

      <span className="bl__sep" aria-hidden="true" />

      <div className="bl__grp">
        {cap(constraints.traits !== null ? "Traits locked" : "Traits", constraints.traits !== null)}
        {fixedChoice.traits.length > 0 ? (
          fixedChoice.traits.map((trait) => {
            const stages = ascension(trait);
            return (
              <span className="bl__item" key={trait}>
                <IconImg src={getTraitIcon(trait)} alt="" size={18} />
                <span className="bl__name">{TRAIT_NAMES[trait] ?? trait}</span>
                {stages === null ? null : (
                  <span className="bl__pts" title={`Veneration ${stages}`}>
                    {stages}
                  </span>
                )}
              </span>
            );
          })
        ) : (
          <span className="bl__none">None</span>
        )}
      </div>

      {constraints.requiredPlushies.length > 0 ? (
        <>
          <span className="bl__sep" aria-hidden="true" />
          <div className="bl__grp">
            {cap("Always carried", true)}
            {constraints.requiredPlushies.map((name, slot) => (
              <span key={`${name}-${slot}`} className="bl__item bl__item--plush">
                <IconImg src={getPlushieIcon(name)} alt="" size={18} />
                <span className="bl__name">{name}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {constraints.excludedPlushies.length > 0 ? (
        <>
          <span className="bl__sep" aria-hidden="true" />
          <div className="bl__grp">
            {cap("Not owned", true)}
            {constraints.excludedPlushies.map((name) => (
              <span className="bl__item spb-ruled-out" key={name}>
                <IconImg src={getPlushieIcon(name)} alt="" size={18} />
                <span className="bl__name">{name}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {held.length > 0 ? (
        <>
          <span className="bl__sep" aria-hidden="true" />
          <div className="bl__grp bl__grp--flags">
            <span className="bl__cap">Buffs</span>
            {held.map((effect) => (
              <span className="bl__flag is-on" key={effect.id}>
                {effect.label}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The focused channel as the pair it is, and every other channel beside it.
 * With nothing held the pair collapses to one figure, which is the honest
 * reading rather than the same number printed twice. */
function ChannelAnswer({
  rows,
  focused,
  holding,
}: {
  rows: SpeedChannelRow[];
  focused: SpeedChannelRow | null;
  holding: boolean;
}) {
  return (
    <>
      {focused ? (
        <div className="spb-hero">
          <span className="spb-hero__cap">
            {focused.label}
            <em>creature stat {formatChannelValue(focused.raw)}</em>
          </span>
          {holding ? (
            <div className="spb-hero__pair">
              <div className="spb-hero__leg">
                <span className="spb-hero__legcap">Sustained</span>
                <b className="spb-hero__value">{formatChannelValue(focused.sustained)}</b>
                <span className="spb-hero__note">always on</span>
              </div>
              <div className="spb-hero__leg spb-hero__leg--peak">
                <span className="spb-hero__legcap">Peak</span>
                <b className="spb-hero__value">{formatChannelValue(focused.peak)}</b>
                <span className={`spb-delta spb-delta--${focused.tone}`}>{formatDelta(focused.deltaPct)}</span>
              </div>
            </div>
          ) : (
            <>
              <b className="spb-hero__value">{formatChannelValue(focused.sustained)}</b>
              <span className="spb-hero__note">sustained - nothing held</span>
            </>
          )}
        </div>
      ) : null}
      <div className="spb-tiles">
        {rows
          .filter((row) => row !== focused)
          .map((row) => (
            <ChannelTile row={row} key={row.channel} />
          ))}
      </div>
    </>
  );
}

/** Every effect the loadout is carrying, split the way the two hero figures
 * are: what is always on, then what is only up while it is held. */
function Breakdown({ controller }: { controller: SpeedBuildsController }) {
  const { base, subject, heldIds } = controller;
  const moves = contributionRows(subject?.contributions ?? [], base, subject?.build ?? null, heldIds);
  if (moves.length === 0) return <div className="spb-none">No effects - these are the bare stats.</div>;

  const groups = [
    { key: "always", cap: "Always on", rows: moves.filter((row) => !row.held) },
    { key: "held", cap: "While held", rows: moves.filter((row) => row.held) },
  ].filter((group) => group.rows.length > 0);
  const split = groups.length > 1;

  return (
    <div className="spb-moves">
      {groups.map((group) => (
        <div className="spb-moves__group" key={group.key}>
          {split ? <span className="spb-moves__cap">{group.cap}</span> : null}
          {group.rows.map(({ contribution, source, change, note }) => (
            <div className="spb-move" key={contribution.effect.id}>
              <span className="spb-move__name">
                {contribution.effect.label}
                {contribution.stacks > 1 ? ` x${contribution.stacks}` : ""}
                {note ? <em>{note}</em> : null}
              </span>
              <span className="spb-move__src">{source}</span>
              <span className="spb-move__change">{change}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SpeedBuildsPageBeta({
  nameA,
  creatureNames,
  getCreatureIcon,
  onNameAChange,
}: SpeedBuildsPageProps) {
  const controller = useSpeedBuildsPageController({ nameA, onNameAChange });
  const [openPanel, setOpenPanel] = useState<"creature" | "buffs" | "constraints" | null>(null);
  const { creature, base, targets, mode, setMode, target, setTarget, rankBy, heldIds, holding, subject, ranking } =
    controller;
  const constraintCount = countSpeedConstraints(controller.constraints);

  const rows = base && subject ? channelRows(base, subject.sustained, subject.peak) : [];
  const focused = rows.find((row) => row.channel === target) ?? rows[0] ?? null;
  // Bear buys its slot by strengthening Cower rather than by paying anything of
  // its own. The ranking has no breakdown to carry that, so the winning card
  // names it or the build carries a plushie that appears to do nothing.
  const winnerNotes = contributionNotes(
    contributionRows(subject?.contributions ?? [], base, subject?.build ?? null, heldIds),
  );

  return (
    <section className={`spb spb--${mode}`}>
      <div className="spb-bar">
        <button
          type="button"
          className="spb-creature"
          onClick={() => setOpenPanel("creature")}
          title="Change creature"
        >
          <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={30} />
          <span>
            <b>{nameA || "No creature"}</b>
            <em>{mode === "optimize" ? "ranking builds" : "live loadout"}</em>
          </span>
        </button>

        <div className="spb-bar__lever">
          <span className="spb-bar__label">Mode</span>
          <div className="cb-seg" role="tablist" aria-label="Speed Builds mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "optimize"}
              className={`cb-seg__opt${mode === "optimize" ? " is-active" : ""}`}
              onClick={() => setMode("optimize")}
            >
              Optimize
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              className={`cb-seg__opt${mode === "manual" ? " is-active" : ""}`}
              onClick={() => setMode("manual")}
            >
              Manual
            </button>
          </div>
        </div>

        <div className="spb-bar__lever">
          <span className="spb-bar__label">{mode === "optimize" ? "Rank by" : "Focus"}</span>
          <BetaSelect
            value={target}
            onChange={(value) => setTarget(value as SpeedTarget)}
            options={targets.map((channel) => ({
              value: channel,
              label: `${channelLabel(channel)}${isLowerBetter(channel) ? " (lower is better)" : ""}`,
            }))}
            ariaLabel="Speed channel"
            placeholder="No channels"
            className="spb-bar__select"
          />
          {/* Only a held effect makes the two orders differ; with nothing held
              there is one ranking and a switch between two names for it. */}
          {mode === "optimize" && holding ? (
            <div className="cb-seg" role="group" aria-label="Rank on">
              {(["peak", "sustained"] as SpeedRankBy[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cb-seg__opt${rankBy === option ? " is-active" : ""}`}
                  onClick={() => controller.setRankBy(option)}
                >
                  {RANK_BY_LABELS[option]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {mode === "optimize" ? (
          <div className="spb-bar__actions">
            <button type="button" className="cb-ghostbtn" onClick={() => setOpenPanel("constraints")}>
              <Settings2 size={15} strokeWidth={2} aria-hidden="true" /> Configure
              {constraintCount > 0 ? <span className="spb-count spb-count--set">{constraintCount}</span> : null}
            </button>
            <button type="button" className="cb-ghostbtn" onClick={() => setOpenPanel("buffs")}>
              Buffs
              {heldIds.length > 0 ? <span className="spb-count">{heldIds.length}</span> : null}
            </button>
          </div>
        ) : null}
      </div>

      {!creature ? (
        <div className="cb-empty">Pick a creature to read its movement speed.</div>
      ) : !base || rows.length === 0 ? (
        <div className="cb-empty">This creature has no movement stats.</div>
      ) : mode === "optimize" ? (
        <>
          <RankingConstants controller={controller} />

          <div className="spb-section">
            <div className="spb-section__head">
              <span className="spb-section__title">Fastest builds</span>
              <span className="spb-section__hint">
                Ranked on {holding ? rankBy : "sustained"} {channelLabel(target).toLowerCase()} across{" "}
                {ranking?.evaluated ?? 0} {(ranking?.evaluated ?? 0) === 1 ? "build" : "builds"}.
              </span>
            </div>
            {!ranking || ranking.candidates.length === 0 ? (
              <div className="cb-empty">This creature has no {channelLabel(target).toLowerCase()} to optimize.</div>
            ) : (
              <div className="spb-cards">
                {controller.rankingRows.map((row, index) => (
                  <RankCard
                    key={`${row.candidate.build.plushies.join("+")}|${row.candidate.value}`}
                    rank={index + 1}
                    row={row}
                    base={base}
                    target={target}
                    rankBy={rankBy}
                    holding={holding}
                    notes={index === 0 ? winnerNotes : []}
                    onOpen={() => controller.openInManual(row.candidate.build)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="spb-live">
          <div className="spb-live__form">
            <div className="panel-block">
              <SpeedBuildsLoadoutControls
                build={controller.manualBuild}
                onBuildChange={controller.setManualBuild}
                variant="beta"
              />
            </div>
            <div className="panel-block">
              <h3>Buffs</h3>
              <SpeedBuildsBuffControls controller={controller} />
            </div>
          </div>

          <aside className="spb-live__answer">
            <div className="spb-answer">
              <ChannelAnswer rows={rows} focused={focused} holding={holding} />
              <div className="spb-answer__moves">
                <span className="spb-answer__cap">Breakdown</span>
                <Breakdown controller={controller} />
              </div>
            </div>
          </aside>
        </div>
      )}

      {openPanel === "creature" ? (
        <SpeedModal title="Creature" onClose={() => setOpenPanel(null)} spillsOut>
          <div className="field">
            <label>Creature</label>
            <div className="icon-input">
              <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
              <CreatureNameInput
                ariaLabel="Creature"
                value={nameA}
                onChange={onNameAChange}
                creatureNames={creatureNames}
                placeholder="Search creature..."
              />
            </div>
          </div>
        </SpeedModal>
      ) : null}

      {openPanel === "buffs" ? (
        <SpeedModal title="Buffs" onClose={() => setOpenPanel(null)}>
          <SpeedBuildsBuffControls controller={controller} />
        </SpeedModal>
      ) : null}

      {openPanel === "constraints" ? (
        <SpeedModal title="Configure" onClose={() => setOpenPanel(null)}>
          <SpeedBuildsConstraintControls controller={controller} variant="beta" />
        </SpeedModal>
      ) : null}
    </section>
  );
}
