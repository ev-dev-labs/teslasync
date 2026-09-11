package chatbot

import (
	"context"
	"strings"
)

// ChatLink is a deep-link citation attached to an assistant reply: the page
// where the user can see the underlying chart or table.
type ChatLink struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

// intentLinks maps each heuristic intent to its evidence pages. Paths must
// match frontend routes in web/src/App.tsx.
func intentLinks(intent string) []ChatLink {
	link := func(label, path string) []ChatLink { return []ChatLink{{Label: label, Path: path}} }
	switch intent {
	case "vehicles":
		return link("Vehicles", "/vehicles")
	case "drives", "distance":
		return link("Drives", "/drives")
	case "efficiency":
		return []ChatLink{
			{Label: "Temperature impact", Path: "/temperature-impact"},
			{Label: "Drives", Path: "/drives"},
		}
	case "battery":
		return link("Battery", "/battery")
	case "charging":
		return link("Charging", "/charging")
	case "cost":
		return link("Cost analysis", "/cost-analysis")
	case "longest", "maxspeed", "lastdrive":
		return link("Drives", "/drives")
	case "lastcharge":
		return link("Charging", "/charging")
	case "alerts":
		return link("Alerts", "/notifications/alerts")
	case "geofences":
		return link("Geofences", "/geofences")
	case "status":
		return link("Vehicles", "/vehicles")
	default:
		return nil
	}
}

// classifyIntent mirrors the processQuery switch so citations stay aligned
// with the answering branch. It returns "" for help/fallback (no links).
func classifyIntent(lower string) string {
	switch {
	case matchAny(lower, "how many vehicle", "fleet size", "total vehicle", "how many car"):
		return "vehicles"
	case matchAny(lower, "how many drive", "total drive", "number of drive", "trips", "total trips"):
		return "drives"
	case matchAny(lower, "total distance", "how far", "how many km", "how many mile", "distance driven"):
		return "distance"
	case matchAny(lower, "efficiency", "wh/km", "energy per km", "consumption"):
		return "efficiency"
	case matchAny(lower, "battery", "charge level", "soc", "state of charge"):
		return "battery"
	case matchAny(lower, "charging cost", "total cost", "how much spent", "money spent", "electricity cost"):
		return "cost"
	case matchAny(lower, "charging", "how many charge", "charge session", "total energy charged", "energy added"):
		return "charging"
	case matchAny(lower, "longest drive", "farthest drive", "max distance"):
		return "longest"
	case matchAny(lower, "fastest", "top speed", "max speed", "speed record"):
		return "maxspeed"
	case matchAny(lower, "last drive", "recent drive", "latest drive"):
		return "lastdrive"
	case matchAny(lower, "last charge", "recent charge", "latest charge"):
		return "lastcharge"
	case matchAny(lower, "alert", "notification", "warning"):
		return "alerts"
	case matchAny(lower, "geofence", "zone", "saved location"):
		return "geofences"
	case matchAny(lower, "online", "awake", "status", "vehicle state"):
		return "status"
	default:
		return ""
	}
}

// processQueryWithLinks answers like processQuery and attaches deep-link
// citations for the answering intent.
func (h *ChatbotHandler) processQueryWithLinks(ctx context.Context, msg string) (string, []ChatLink) {
	text := h.processQuery(ctx, msg)
	return text, intentLinks(classifyIntent(strings.ToLower(msg)))
}
