// Package voice contains the voice-mode chat-streaming tool cluster.
// It follows ADR-011 §3 bounded-context subpackages.
//
//	voice_mode.go — RegisterVoiceModeTools + VoiceMode* +
//	                ScopedVoiceModeSession/WithScopedVoiceModeSession +
//	                ChatContextSource + VehicleSnapshotSource ports
//
// Cross-cluster contract per ADR-015 §I12 (AI-Off Contract): exported
// type, interface, and function names; JSON tags; schema field names;
// and Execute payload shape must stay stable. ai-vet and the aigen
// mirror at web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `voiceaitools` to
// disambiguate. The composition root in internal/api/router.go
// imports it without alias because no collision exists there.
//
// Layer: domain
package voice
