/**
 * Cost-analysis reference constants.
 *
 * Physical/economic factors used to compare EV charging against an equivalent
 * internal-combustion vehicle. These figures are expressed in their natural
 * analysis units (USD, kWh, kg, mpg) — SI values coming off the API are
 * converted at the read boundary before they meet these constants.
 *
 * NOTE: `CO2_PER_GAL_KG`, `KG_CO2_PER_TREE_YEAR`, `DEFAULT_GAS_PRICE` and
 * `DEFAULT_MPG` are also declared in `@/lib/constants` (`FUEL`). The two copies
 * MUST stay in sync — a drift guard in `constants.test.ts` enforces this.
 */

/** Default pump price in USD per US gallon (gas calculator seed value). */
export const DEFAULT_GAS_PRICE = 3.5;

/** Default comparison ICE fuel economy in miles per US gallon. */
export const DEFAULT_MPG = 30;

/** Default US residential electricity price in USD per kWh. */
export const DEFAULT_ELECTRICITY_RATE = 0.13;

/** EPA tailpipe CO2 emitted by burning one US gallon of gasoline, in kg. */
export const CO2_PER_GAL_KG = 8.887;

/** Approx. CO2 a mature tree sequesters per year, in kg (EPA ~21.8, rounded). */
export const KG_CO2_PER_TREE_YEAR = 22;

/** EPA MPGe energy equivalence: kWh of energy contained in one US gallon of gasoline. */
export const KWH_PER_GALLON = 33.7;
