import { describe, expect, it } from "vitest";
import { compareBuffOptions } from "../components/compare/compareBuffConfig";
import { WEATHER_OPTIONS } from "../engine/weather";
import { buildSectionEntries } from "./referencePageShared";

// Every switch the Battle Settings panel offers has a card a reader can open
// from the Battle settings section. The panel and the Reference are written
// separately, and eight objects had drifted apart before this ran: three meter
// buffs and four weather conditions carried a card in Statuses that the Battle
// settings section never showed, and a reader looking through the switches found
// nothing for them.
//
// A card is allowed to be named for the effect rather than the switch - Blizzard
// applies Hypothermia and the switch is the only place the word Blizzard appears
// - so the map below records which card answers which switch. A new switch with
// no line here fails, which is the point: the line is written when the card is.
const CARD_BY_SWITCH: ReadonlyMap<string, string> = new Map([
  ["Damage Boost", "Damage Boost"],
  ["Regen Boost", "Regen Boost"],
  ["Pack Healer nearby", "Pack Healer"],
  ["Clean water", "Clean water"],
  ["Refreshed", "Refreshed"],
  ["Newborn", "Newborn"],
  ["Spring water", "Spring Water"],
  ["Satiated", "Satiated"],
  ["Territory", "Territory"],
  ["Muddy Status", "Mud Pile"],
  ["Aggressive", "Aggressive"],
  ["Scared Status", "Scared"],
  ["Storming", "Storming"],
  ["Guardian's Seal", "Guardian's Seal"],
  ["Heat Wave", "Heat Wave"],
  ["Blizzard", "Hypothermia"],
  ["Acid Rain", "Acid Rain"],
  ["Ash Fall", "Ash Fall"],
]);

const panelSwitches = (): string[] => [
  ...compareBuffOptions.map((option) => option.label),
  ...WEATHER_OPTIONS.filter((option) => option.value !== "none").map((option) => option.label),
];

describe("battle settings coverage", () => {
  it("every switch the panel offers names a card", () => {
    const unmapped = panelSwitches().filter((label) => !CARD_BY_SWITCH.has(label));
    expect(
      unmapped,
      `these Battle Settings switches have no card named in CARD_BY_SWITCH: ${unmapped.join(", ")}. ` +
        "Write the entry, then add the line - a switch a reader can set is a switch a reader can read about.",
    ).toEqual([]);
  });

  it("every named card is in the Battle settings section", () => {
    const shown = new Set(buildSectionEntries()["battle-settings"].map((entry) => entry.name));
    const missing = panelSwitches()
      .map((label) => CARD_BY_SWITCH.get(label))
      .filter((name): name is string => Boolean(name) && !shown.has(name!));
    expect(
      missing,
      `these cards answer a Battle Settings switch but the section does not show them: ${missing.join(", ")}. ` +
        "A card that lives in another array is shown here by setting `isBattleSetting: true` on it.",
    ).toEqual([]);
  });

  it("the map names no card that does not exist", () => {
    const everywhere = new Set(
      Object.values(buildSectionEntries())
        .flat()
        .map((entry) => entry.name),
    );
    const dangling = [...CARD_BY_SWITCH.values()].filter((name) => !everywhere.has(name));
    expect(dangling, `CARD_BY_SWITCH names cards that no section holds: ${dangling.join(", ")}`).toEqual([]);
  });
});
