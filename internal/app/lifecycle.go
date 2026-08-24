package app

// componentDisplayName maps internal health-monitor IDs to
// user-facing component names used in system notification titles.
// Mirrors the legacy cmd/teslasync/lifecycle.go helper.
//
// The generalized component-health notification fan-out itself lives
// in health_notify.go (componentHealthTracker.Observe builds the
// title/message, dispatchComponentNotification fans it out through
// every enabled, preference-matching channel with the MQTT-unavailable
// direct-dispatch fallback baked into notification.PublishCtx). The
// prior version of this file also held sendSystemNotification, which
// fanned out to EVERY enabled channel unconditionally (bypassing
// NotificationPreferenceRepo) and returned immediately without
// dispatching anything at all when the *mqtt.Client wrapper was nil
// (e.g. MQTT failed to connect at startup) — exactly backwards for an
// "MQTT is down" alert. dispatchComponentNotification fixes both.
func componentDisplayName(name string) string {
	switch name {
	case "database":
		return "PostgreSQL"
	case "mqtt":
		return "MQTT Broker"
	case "tesla_api":
		return "Tesla Fleet API"
	case "worker":
		return "Vehicle Poller"
	case "redis":
		return "Redis Cache"
	case "telemetry":
		return "Fleet Telemetry Pipeline"
	default:
		return name
	}
}
