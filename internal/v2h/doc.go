// Package v2h is a vehicle-to-home / vehicle-to-grid decision engine.
//
// Layer: platform
//
// Phase-50 / p50-v2h. Scope: a pure decider (no actuator). Takes the
// operator's hour-by-hour inputs — ToU electricity rate, solar
// production forecast, house load forecast, vehicle SoC + capacity +
// reserve — and returns a 24-hour charge / hold / discharge plan that
// minimizes cost while keeping the SoC inside the operator-defined
// guardrails.
//
// Why a decider and not an actuator: as of the foundation PR, Tesla
// has not exposed a V2H/V2G API to third-party applications.
// Operators integrate the produced Plan with their own inverter
// (Enphase IQ8, SolarEdge Energy Hub, SunPower Reserve) or with a
// home-energy-management hub (Home Assistant, OpenHAB) until Tesla
// flips the switch.
//
// Design properties:
//
//  1. Pure function — Decide(Inputs) Plan, no I/O, deterministic.
//  2. SI-only — Power in W, energy in Wh, SoC as a 0.0..1.0 fraction
//     (NOT 0..100 percent). Rates in $/Wh (NOT $/kWh) to avoid the
//     1000x footgun. The caller converts at the display boundary.
//  3. No future-vision — works strictly off the inputs handed in.
package v2h
