// Build an AbilityRef the way the runtime data stores one, and guess its
// semantics from the name. Shared by the override converter and the subspecies
// materialiser so both file abilities identically.

import type { AbilityCategory, AbilityRef } from "./manualOverrides";

export function guessSemantic(name: string): string {
  const lc = name.toLowerCase();
  if (lc.startsWith("block")) return "block";
  if (lc.includes("attack") || lc.includes("shredder") || lc.includes("curse") || lc.includes("venom") || lc.includes("radiation")) {
    return "offensive";
  }
  if (lc.includes("resist") || lc.includes("shield") || lc.includes("fortify") || lc.includes("guard")) {
    return "defensive";
  }
  return "neutral";
}

export function mkAbilityRef(
  name: string,
  value: number | string | null,
  category: AbilityCategory,
): AbilityRef {
  return {
    abilityId: name.replace(/\s+/g, "_"),
    name,
    value,
    semantics: guessSemantic(name),
    subtype: category === "breath" ? name : null,
  };
}
