export function resolveCompareDisplayNames(
  nameA: string,
  nameB: string,
): { displayA: string; displayB: string } {
  if (nameA && nameB && nameA === nameB) {
    return { displayA: `${nameA} A`, displayB: `${nameB} B` };
  }
  return { displayA: nameA, displayB: nameB };
}
