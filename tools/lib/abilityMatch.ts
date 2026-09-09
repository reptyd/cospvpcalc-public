// Reconcile the human "early change" ability shorthand with how the runtime
// actually stores abilities, so a paste is matched and valued correctly:
//
//  - Subtype abilities: the drop writes "Charge Launch" / "Lance Frostbite",
//    the runtime stores them as name "Charge" value "Launch" or name
//    "Lance (Frostbite)". Matching strips parens and also tries name + value.
//  - Block resistances: the drop uses percents ("Block Frostbite 50"), the
//    runtime stores fractions (0.5). Values are converted between the two.

export function abilityMatchKey(name: string): string {
  return name.toLowerCase().replace(/[\s_()]+/g, "");
}

/** True if the drop's ability name refers to this runtime ability - by name, or
 *  by "name value" (subtype-as-value, e.g. Charge + Launch), or with parens in
 *  the name stripped (e.g. "Lance (Frostbite)" == "Lance Frostbite"). */
export function abilityMatches(
  dropName: string,
  ability: { name: string; value: number | string | null },
): boolean {
  const key = abilityMatchKey(dropName);
  if (abilityMatchKey(ability.name) === key) return true;
  if (ability.value != null && abilityMatchKey(`${ability.name} ${ability.value}`) === key) return true;
  return false;
}

export function isBlockAbility(name: string): boolean {
  return /^block\b/i.test(name.trim());
}

/** Drop text writes Block resistances as percents; the runtime stores fractions.
 *  Convert a drop value to the runtime unit (Block: /100; anything else as-is). */
export function dropValueToRuntime(name: string, value: number | string | null): number | string | null {
  if (isBlockAbility(name) && typeof value === "number" && Math.abs(value) > 1) return value / 100;
  return value;
}

/** Runtime value back to the drop/display unit (Block fraction -> percent). */
export function runtimeValueToDrop(name: string, value: number | string | null): number | string | null {
  if (isBlockAbility(name) && typeof value === "number" && Math.abs(value) <= 1 && value !== 0) {
    return Math.round(value * 100 * 100) / 100;
  }
  return value;
}
