// Native parity port of
// web/src/features/charging/components/cost-analysis/constants.ts.
//
// This module is pure, non-visual constant code for the cost-analysis feature
// (gas/electricity pricing and CO2 baseline defaults). There is no DOM, JSX,
// Recharts, Leaflet, browser API, old web UI component, or import of any kind
// to adapt, so every constant is ported verbatim with byte-for-byte identical
// names and numeric values and behavior is identical on native.

// web L1: default assumed gasoline price (USD per gallon) for cost comparison.
export const DEFAULT_GAS_PRICE = 3.5;
// web L2: default assumed combustion-vehicle fuel economy (miles per gallon).
export const DEFAULT_MPG = 30;
// web L3: default assumed electricity rate (USD per kWh).
export const DEFAULT_ELECTRICITY_RATE = 0.13;
// web L4: CO2 emitted per gallon of gasoline burned (kilograms).
export const CO2_PER_GAL_KG = 8.887;
// web L5: CO2 absorbed by one tree per year (kilograms), for offset framing.
export const KG_CO2_PER_TREE_YEAR = 22;
// web L6: energy content of one gallon of gasoline (kWh).
export const KWH_PER_GALLON = 33.7;
