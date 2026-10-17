/** Deliberately synthetic, deterministic reference fixtures.
 * No API data, production metric calculations, eligibility or exports. */
const shape = [18, 24, 22, 31, 27, 35, 29, 38, 33, 25, 21, 30] as const;
export const dailyFixture = Array.from({ length: 60 }, (_, index) => ({
  index,
  date: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
  sample: shape[index % shape.length],
}));

/** Rendering-only selection; the shared chart's accessible table receives
 * the complete fixture, not this subset. No production series are involved. */
export function plotFixture(width: number) {
  const budget = Math.max(2, Math.floor(Math.max(0, width - 56) / 8));
  if (budget >= dailyFixture.length) return dailyFixture;
  const count = Math.min(budget, dailyFixture.length);
  return Array.from({ length: count }, (_, index) =>
    dailyFixture[Math.round(index * (dailyFixture.length - 1) / (count - 1))]);
}
