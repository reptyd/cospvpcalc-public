import { describe, expect, it } from "vitest";
import type { SimulationSummary } from "../../engine";
import { getTimelineEventKind, getTimelineSourceMeta } from "./CompareBattleDetails";

type CombatLogEntry = NonNullable<SimulationSummary["combatLog"]>[number];

function abilityEntry(description: string, damage = 0): CombatLogEntry {
  return {
    time: 2,
    type: "ability",
    attacker: "A",
    damage,
    actorHpAfter: 100,
    hpSide: "B",
    hpAfter: 100,
    description,
  };
}

describe("CompareBattleDetails timeline classification", () => {
  it("keeps Shadow Barrage hits and payloads grouped as Shadow Barrage ability events", () => {
    const hit = abilityEntry("Shadow Barrage hit", 100);
    const payload = { ...abilityEntry("Shadow Barrage applied Burn (2)"), statusId: "Burn_Status" };

    expect(getTimelineEventKind(hit)).toBe("ability");
    expect(getTimelineSourceMeta(hit)).toMatchObject({
      id: "ability:Shadow Barrage",
      label: "Shadow Barrage",
      group: "Abilities",
    });
    expect(getTimelineEventKind(payload)).toBe("ability");
    expect(getTimelineSourceMeta(payload)).toMatchObject({
      id: "ability:Shadow Barrage",
      label: "Shadow Barrage",
      group: "Abilities",
    });
  });
});
