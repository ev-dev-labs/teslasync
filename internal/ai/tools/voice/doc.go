// Package voice carves the voice-mode chat-streaming tool out of the
// parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in
// scope for Phase R, file-move-only). Single-tool cluster:
//
//	voice_mode.go — RegisterVoiceModeTools + VoiceMode* +
//	                ScopedVoiceModeSession/WithScopedVoiceModeSession +
//	                ChatContextSource + VehicleSnapshotSource ports
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.19 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `voiceaitools` to
// disambiguate. The composition root in internal/api/router.go
// imports it without alias because no collision exists there.
//
// Layer: domain
package voice
