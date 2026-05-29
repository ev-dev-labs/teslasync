package api

import systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

func applyAIArchiveOnModeFlip(existing, incoming *systemmodel.Settings) {
	if incoming == nil || incoming.AIMode != "off" {
		return
	}
	incoming.AIFeatures = map[string]bool{}
	if existing == nil || existing.AIMode == "off" {
		return
	}
	archive := make(map[string]bool, len(existing.AIFeatures))
	for k, v := range existing.AIFeatures {
		if v {
			archive[k] = true
		}
	}
	if len(archive) > 0 {
		incoming.AIFeaturesArchived = archive
	}
}
