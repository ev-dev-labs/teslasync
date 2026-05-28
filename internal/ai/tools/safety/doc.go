// Package safety hosts the AI tool implementations that answer the
// natural-language question "is my Tesla currently configured to do
// the thing the user asked about?" — the Safety Setting Explainer
// strategy + its single backing tool (querySafetySettings).
//
// Carved out of internal/ai/tools (R6.5; ADR-011 §2 — bounded-context
// subpackages for flat-folder hot-spots ≥ 30 files). The exported
// symbols (SafetySettingsSource, SafetySettingsEnvelope,
// SafetySettingDescriptor, RegisterSafetySettingExplainerTools,
// SafetySettingExplainerSources, etc.) keep their verbatim names
// for git bisectability — only the import path moved.
//
// Layer: adapter (Layer: adapter per ADR-007 — the ai-tools layer is
// the adapter implementation of internal/port/ai for the strategy
// dispatcher; it is consumed by the AI guard chain in internal/api).
//
// ADR-011 §3 alias convention: callers importing this package
// alongside the parent ai/tools should use the alias `safetyaitools`.
// At single-import callsites (e.g. internal/api/ai_safety_setting_
// explainer_handler.go which already imports the parent tools pkg),
// no alias is required.
//
// ADR-015 §I12 contract preservation: this is a FILE-MOVE-ONLY
// refactor. No AI strategy or tool logic changed. The /api/v1/ai/
// safety-setting-explainer endpoint still re-checks ai_mode + the
// per-feature toggle on every tick and still returns {Skipped: 1}
// with zero side effects when AI is off. Verified by `make ai-vet`
// (PASS) at the cluster commit.
package safety
