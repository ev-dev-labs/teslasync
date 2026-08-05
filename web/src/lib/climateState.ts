export function resolveHvacActive(
  hvacPower: unknown,
  isAcOn: unknown,
): boolean | null {
  if (hvacPower === true || isAcOn === true) return true;
  if (hvacPower === false || isAcOn === false) return false;
  return null;
}
