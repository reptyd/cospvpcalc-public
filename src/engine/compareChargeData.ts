type CompareChargeAbilityLike = { name: string; abilityId?: string; value?: number | string | null };

type CompareChargeCarrierLike = {
  name: string;
  passiveAbilities?: CompareChargeAbilityLike[];
  activatedAbilities?: CompareChargeAbilityLike[];
  breathAbilities?: CompareChargeAbilityLike[];
};

function allAbilities(creature: CompareChargeCarrierLike): CompareChargeAbilityLike[] {
  return [
    ...(creature.passiveAbilities ?? []),
    ...(creature.activatedAbilities ?? []),
    ...(creature.breathAbilities ?? []),
  ];
}

function hasChargeVariant(creature: CompareChargeCarrierLike | undefined, variant: "Gore" | "Power"): boolean {
  if (!creature) return false;
  return allAbilities(creature).some((ability) => {
    if (ability.name === `${variant} Charge`) return true;
    if ((ability.abilityId === "Charge" || ability.name === "Charge") && ability.value === variant) return true;
    return false;
  });
}

export function hasCompareGoreCharge(creature: CompareChargeCarrierLike | undefined): boolean {
  return hasChargeVariant(creature, "Gore");
}

export function hasComparePowerCharge(creature: CompareChargeCarrierLike | undefined): boolean {
  return hasChargeVariant(creature, "Power");
}
