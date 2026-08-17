import { describe, expect, it } from "vitest";
import { parseEarlyChanges } from "./earlyChangeParser";
import { buildEarlyChangesDiscord, buildNewCreaturesDiscord } from "./earlyChangesDiscord";
import type { CreatureRuntime } from "./creatureRoster";
import { chunkDiscordMessages } from "./toolkit";

describe("buildEarlyChangesDiscord", () => {
  const parsed = parseEarlyChanges(
    `Icebreaker Meorlark\nWeight from 5600 to 6000\nBlockFrostbite from 35 to 50\nAddition of Frosty\nRemoval of Old Thing\nStat Insight: bulkier than Meorlark.`,
  );

  it("renders a header and the deltas, stats only", () => {
    const [message] = buildEarlyChangesDiscord(parsed.creatures, "early", "upcoming");
    expect(message).toContain("**Early changes**");
    expect(message).toContain("may still change before release");
    expect(message).toContain("1 creature");
    expect(message).toContain("**Icebreaker Meorlark**");
    expect(message).toContain("• weight 5600 → 6000");
    expect(message).toContain("• Block Frostbite 35 → 50");
    expect(message).toContain("• + Frosty");
    expect(message).toContain("• − Old Thing");
  });

  it("omits the insight prose and any disclaimer footer", () => {
    const [message] = buildEarlyChangesDiscord(parsed.creatures, "early", "upcoming");
    expect(message).not.toContain("bulkier than Meorlark");
    expect(message).not.toContain("not finalized");
  });

  it("marks a released change as ahead of the wiki, not as tentative", () => {
    const [message] = buildEarlyChangesDiscord(parsed.creatures, "early", "released");
    expect(message).toContain("**Early changes**");
    expect(message).toContain("released stats, ahead of the wiki update");
    expect(message).not.toContain("may still change");
  });

  it("uses a distinct header for user-specific corrections", () => {
    const [message] = buildEarlyChangesDiscord(parsed.creatures, "user-specific", "upcoming");
    expect(message).toContain("**User-specific corrections**");
  });

  it("returns nothing when there is nothing to announce", () => {
    expect(buildEarlyChangesDiscord([], "early", "upcoming")).toEqual([]);
  });
});

describe("buildNewCreaturesDiscord", () => {
  const creature: CreatureRuntime = {
    name: "Mirageon",
    stats: { type: "Semi-Aquatic", tier: 3, health: 3950, weight: 3350, damage: 265, biteCooldown: 1.4, walkAndSwimSpeed: 34, sprintSpeed: 98 },
    passiveAbilities: [{ abilityId: "Block_Bleed", name: "Block Bleed", value: 60, semantics: "block", subtype: null }],
    activatedAbilities: [{ abilityId: "Spite", name: "Spite", value: 20, semantics: "neutral", subtype: null }],
    breathAbilities: [],
  };

  it("renders a header, key stats, and abilities", () => {
    const [msg] = buildNewCreaturesDiscord([creature], "upcoming");
    expect(msg).toContain("**New creatures**");
    expect(msg).toContain("may still change before release");
    expect(msg).toContain("**Mirageon** — Semi-Aquatic, Tier 3");
    expect(msg).toContain("Health 3950");
    expect(msg).toContain("Block Bleed 60");
    expect(msg).toContain("Spite 20");
  });

  it("marks a released creature as ahead of the wiki, not as tentative", () => {
    const [msg] = buildNewCreaturesDiscord([creature], "released");
    expect(msg).toContain("**New creatures** — released, ahead of the wiki update");
    expect(msg).not.toContain("may still change");
  });

  it("returns nothing for no creatures", () => {
    expect(buildNewCreaturesDiscord([], "upcoming")).toEqual([]);
  });
});

describe("chunkDiscordMessages", () => {
  it("keeps everything in one message when it fits", () => {
    const messages = chunkDiscordMessages("H", ["a", "b"], "F");
    expect(messages).toEqual(["H\n\na\n\nb\n\nF"]);
  });

  it("splits into multiple messages without breaking a block", () => {
    const big = "x".repeat(1200);
    const messages = chunkDiscordMessages("H", [big, big], "", 1800);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("H");
    expect(messages.every((m) => m.length <= 1800)).toBe(true);
  });
});
