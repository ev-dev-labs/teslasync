// Package chargeautopilot provides the always-on Smart Charging Autopilot
// layer on top of the one-shot charge planner.
//
// A per-vehicle profile (ready-by time, target SOC, rate plan, battery
// health guardrails) drives a deterministic preview of the next automatic
// charge window plus a savings ledger derived from applied charge plans.
//
// Layer: handler
package chargeautopilot
