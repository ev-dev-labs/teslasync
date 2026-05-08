// Package gasprices provides adapters for external energy/gas price APIs.
//
// Currently supported providers:
//   - EIA (US Energy Information Administration) — gasoline prices
//
// See ENGINEERING_GUIDELINES.md Section 7.4 for adapter patterns.
// Layer: adapter
// Layering: implements interfaces from internal/port/external; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package gasprices
