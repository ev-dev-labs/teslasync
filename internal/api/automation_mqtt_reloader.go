package api

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
)

// automationMQTTReloader publishes automation config change notifications to
// the MQTT topic `{prefix}/automations/reload` so the automation-worker
// reloads its trigger configurations.
type automationMQTTReloader struct {
	client *mqtt.Client
}

// PublishReload publishes a reload signal. Fire-and-forget — errors are logged
// but never block the caller.
func (r *automationMQTTReloader) PublishReload(action string, automationID int64) {
	payload := fmt.Sprintf(`{"action":"%s","id":%d}`, action, automationID)
	r.client.Publish("automations/reload", payload)
	log.Debug().
		Str("action", action).
		Int64("automation_id", automationID).
		Msg("published automation reload signal")
}
