package notification

// EventTransition identifies which edge of a component's health state
// machine a catalog entry corresponds to. Every component-health event
// type comes in exactly one of these two flavors — see EventCatalog.
type EventTransition string

const (
	TransitionOutage   EventTransition = "outage"
	TransitionRecovery EventTransition = "recovery"
)

// Component health notification event types. These are the stable
// identifiers a channel's per-event-type preference row keys off
// (notification_preferences.event_type — see
// dbnotif.NotificationPreferenceRepo and GET/PUT
// /api/v1/notifications/{channelID}/preferences).
//
// This is the SINGLE source of truth for these strings: the runtime
// component-health watchdog (internal/app/health_notify.go) fires
// these exact values, and GET /api/v1/notifications/event-types (see
// internal/api/notification/event_catalog.go) serves EventCatalog
// below so the frontend never has to hardcode or guess them.
//
// Each component has exactly two event types: "outage" fires on a
// Healthy -> Degraded/Unhealthy transition, "recovery" fires on the
// reverse. There is no separate "degraded" vs "unhealthy" event type —
// the notification body/severity communicates that distinction instead,
// keeping this set small and stable.
const (
	EventTelemetryOutage   = "system.telemetry.outage"
	EventTelemetryRecovery = "system.telemetry.recovery"
	EventMQTTOutage        = "system.mqtt.outage"
	EventMQTTRecovery      = "system.mqtt.recovery"
	EventDatabaseOutage    = "system.database.outage"
	EventDatabaseRecovery  = "system.database.recovery"
	EventRedisOutage       = "system.redis.outage"
	EventRedisRecovery     = "system.redis.recovery"
	EventTeslaAuthOutage   = "system.tesla_api.outage"
	EventTeslaAuthRecovery = "system.tesla_api.recovery"
	EventWorkerOutage      = "system.worker.outage"
	EventWorkerRecovery    = "system.worker.recovery"
)

// EventCatalogEntry describes one stable, frontend-facing notification
// event type: which component it belongs to, which transition it
// fires on, whether a channel with no explicit preference row treats
// it as enabled (mirrors dbnotif.NotificationPreferenceRepo.IsEnabled's
// default-enabled-when-absent contract), and a display-safe
// description a Channels UI can render directly next to the toggle.
type EventCatalogEntry struct {
	EventType      string          `json:"event_type"`
	Component      string          `json:"component"`
	Transition     EventTransition `json:"transition"`
	DefaultEnabled bool            `json:"default_enabled"`
	Description    string          `json:"description"`
}

// EventCatalog is the complete, stable, ordered list of every
// component-health notification event type the backend can emit. It is
// grouped by component (outage immediately followed by its recovery)
// so a UI can render one row per component with two sub-toggles, or
// flatten it into a single list — both orderings are stable across
// deploys since this is a Go literal, not derived from a map.
//
// DefaultEnabled is true for every entry today (matching
// NotificationPreferenceRepo.IsEnabled's default-enabled-when-absent
// behavior for ALL event types, not just these). The field exists so a
// future event type can ship pre-disabled without a schema change or a
// frontend release — the UI should always render the toggle from this
// field rather than assuming "on".
var EventCatalog = []EventCatalogEntry{
	{
		EventType:      EventTelemetryOutage,
		Component:      "telemetry",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "Fleet Telemetry ingest has gone quiet across the entire fleet — not the same as a single vehicle sleeping.",
	},
	{
		EventType:      EventTelemetryRecovery,
		Component:      "telemetry",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "Fleet Telemetry ingest is receiving signals again.",
	},
	{
		EventType:      EventMQTTOutage,
		Component:      "mqtt",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "The MQTT broker is disconnected or the Fleet Telemetry subscription is no longer active.",
	},
	{
		EventType:      EventMQTTRecovery,
		Component:      "mqtt",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "The MQTT broker connection is back up.",
	},
	{
		EventType:      EventDatabaseOutage,
		Component:      "database",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "The PostgreSQL database is failing health checks.",
	},
	{
		EventType:      EventDatabaseRecovery,
		Component:      "database",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "The PostgreSQL database is healthy again.",
	},
	{
		EventType:      EventRedisOutage,
		Component:      "redis",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "Redis is enabled but unreachable (only fires when Redis is actually configured).",
	},
	{
		EventType:      EventRedisRecovery,
		Component:      "redis",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "Redis is reachable again.",
	},
	{
		EventType:      EventTeslaAuthOutage,
		Component:      "tesla_api",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "The Tesla Fleet API token is missing or expired.",
	},
	{
		EventType:      EventTeslaAuthRecovery,
		Component:      "tesla_api",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "The Tesla Fleet API token is valid again.",
	},
	{
		EventType:      EventWorkerOutage,
		Component:      "worker",
		Transition:     TransitionOutage,
		DefaultEnabled: true,
		Description:    "Every actively-polled vehicle is failing to sync with the Tesla API.",
	},
	{
		EventType:      EventWorkerRecovery,
		Component:      "worker",
		Transition:     TransitionRecovery,
		DefaultEnabled: true,
		Description:    "Vehicle polling has recovered.",
	},
}

// EventTypeDefault returns the catalog default for eventType. Unknown event
// types return ok=false so dispatchers can fail closed rather than enabling a
// notification class that is not part of the stable catalog.
func EventTypeDefault(eventType string) (enabled bool, ok bool) {
	for _, entry := range EventCatalog {
		if entry.EventType == eventType {
			return entry.DefaultEnabled, true
		}
	}
	return false, false
}
