// Render an early-change set as Discord messages under the tool's own
// signature. Kept pure so it can be previewed and tested without a webhook.
// The post is stats only - a header identifying the batch, then one block per
// creature with its stat/ability changes. No insight prose, no footer.

import type { ParsedCreatureChange, ParsedDelta } from "./earlyChangeParser";
import type { CreatureRuntime } from "./creatureRoster";
import type { OverrideChannel } from "./manualOverrides";
import { runtimeValueToDrop } from "./abilityMatch";
import { chunkDiscordMessages } from "./toolkit";

/** How far along the dev change is: an upcoming drop previewed on the dev
 *  Discord (numbers may still shift before release), or stats already released
 *  officially that the wiki simply has not picked up yet. Only the post's
 *  disclaimer wording differs - the data handling is identical. */
export type ReleaseStage = "upcoming" | "released";

function fmt(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "?" : String(value);
}

function deltaLine(delta: ParsedDelta): string | null {
  switch (delta.kind) {
    case "stat":
      return `• ${delta.field} ${fmt(delta.from)} → ${fmt(delta.to)}`;
    case "ability-value":
      return `• ${delta.ability} ${fmt(delta.from)} → ${fmt(delta.to)}`;
    case "ability-add":
      return `• + ${delta.ability}${delta.value != null ? ` ${delta.value}` : ""}`;
    case "ability-remove":
      return `• − ${delta.ability}`;
    case "unknown":
      return null;
  }
}

function creatureBlock(entry: ParsedCreatureChange): string | null {
  const lines = [`**${entry.creature}**`];
  for (const delta of entry.deltas) {
    const line = deltaLine(delta);
    if (line) lines.push(line);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function creatureCount(n: number): string {
  return `${n} ${n === 1 ? "creature" : "creatures"}.`;
}

export function buildEarlyChangesDiscord(
  creatures: ParsedCreatureChange[],
  channel: OverrideChannel,
  stage: ReleaseStage,
): string[] {
  const blocks = creatures
    .map(creatureBlock)
    .filter((block): block is string => block !== null);
  if (blocks.length === 0) return [];
  // Wiki-sync-style summary header (title line + count), then one block per
  // creature. The title's disclaimer marks how firm the numbers are - an
  // upcoming drop may still shift before release, a released change is final
  // and just ahead of the wiki - so both read distinctly from an official wiki
  // sync even when they land in the same channel.
  const title = channel === "user-specific"
    ? "**User-specific corrections**"
    : stage === "released"
      ? "**Early changes** — released stats, ahead of the wiki update"
      : "**Early changes** — upcoming dev changes, may still change before release";
  return chunkDiscordMessages(`${title}\n${creatureCount(blocks.length)}`, blocks);
}

const KEY_STATS: Array<[string, string]> = [
  ["Health", "health"],
  ["Weight", "weight"],
  ["Damage", "damage"],
  ["Bite", "biteCooldown"],
  ["HealthRegen", "healthRegen"],
  ["Stamina", "stamina"],
  ["Speed", "walkAndSwimSpeed"],
  ["Sprint", "sprintSpeed"],
  ["FlySpeed", "flySpeed"],
];

/** Announce whole new creatures: a header line (type, tier), the key combat
 *  stats, and the ability list. Stats only, matching the delta posts. */
export function buildNewCreaturesDiscord(
  creatures: CreatureRuntime[],
  stage: ReleaseStage,
): string[] {
  if (creatures.length === 0) return [];
  const blocks = creatures.map((creature) => {
    const s = creature.stats;
    const head = `**${creature.name}**${s.type ? ` — ${s.type}` : ""}${s.tier != null ? `, Tier ${s.tier}` : ""}`;
    const stats = KEY_STATS.filter(([, f]) => s[f] != null).map(([label, f]) => `${label} ${s[f]}`).join(" · ");
    const abilities = [...creature.passiveAbilities, ...creature.activatedAbilities, ...creature.breathAbilities]
      .map((a) => (a.value == null ? a.name : `${a.name} ${runtimeValueToDrop(a.name, a.value)}`))
      .join(", ");
    return [head, stats, abilities].filter(Boolean).join("\n");
  });
  const title = stage === "released"
    ? "**New creatures** — released, ahead of the wiki update"
    : "**New creatures** — upcoming, may still change before release";
  return chunkDiscordMessages(`${title}\n${creatureCount(blocks.length)}`, blocks);
}
