package api

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/rs/zerolog/log"
)

// automationMQTTReloader publishes automation config change notifications to
// the MQTT topic `{prefix}/automations/reload` so the automation-worker
// reloads its trigger configurations.
type automationMQTTReloader struct {
	client *mqtt.Client
}

// PublishReload publishes a reload signal. Fire-and-forget — errors are logged
// but never block the caller. The ctx is used to inject W3C trace
// context into the published envelope so the reload-handler span in
// the automation-worker nests under the API request span that
// triggered the change.
func (r *automationMQTTReloader) PublishReload(ctx context.Context, action string, automationID int64) {
	payload := fmt.Sprintf(`{"action":"%s","id":%d}`, action, automationID)
	r.client.PublishCtx(ctx, "automations/reload", payload)
	log.Debug().
		Str("action", action).
		Int64("automation_id", automationID).
		Msg("published automation reload signal")
}
