package chatbot

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	chatbotmodel "github.com/ev-dev-labs/teslasync/internal/models/chatbot"
)

// Chat processes a user message and returns a heuristic response.
func (h *ChatbotHandler) Chat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message   string `json:"message"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(body.Message) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "message is required")
		return
	}
	if body.SessionID == "" {
		body.SessionID = fmt.Sprintf("s_%d", time.Now().UnixNano())
	}

	// Save user message
	userMsg := &chatbotmodel.ChatMessage{SessionID: body.SessionID, Role: "user", Content: body.Message}
	_ = h.chat.SaveMessage(r.Context(), userMsg)

	// Generate response by interpreting the query
	response := h.processQuery(r.Context(), body.Message)

	// Save assistant message
	assistantMsg := &chatbotmodel.ChatMessage{SessionID: body.SessionID, Role: "assistant", Content: response}
	_ = h.chat.SaveMessage(r.Context(), assistantMsg)

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"response":   response,
		"session_id": body.SessionID,
	})
}

// processQuery interprets natural language and queries the database.
func (h *ChatbotHandler) processQuery(ctx context.Context, msg string) string {
	lower := strings.ToLower(msg)

	// Pattern matching for common queries
	switch {
	case matchAny(lower, "how many vehicle", "fleet size", "total vehicle", "how many car"):
		return h.queryVehicleCount(ctx)

	case matchAny(lower, "how many drive", "total drive", "number of drive", "trips", "total trips"):
		days := extractDays(lower, 7)
		return h.queryDriveCount(ctx, days)

	case matchAny(lower, "total distance", "how far", "how many km", "how many mile", "distance driven"):
		days := extractDays(lower, 30)
		return h.queryTotalDistance(ctx, days)

	case matchAny(lower, "efficiency", "wh/km", "energy per km", "consumption"):
		days := extractDays(lower, 30)
		return h.queryEfficiency(ctx, days)

	case matchAny(lower, "battery", "charge level", "soc", "state of charge"):
		return h.queryBatteryStatus(ctx)

	case matchAny(lower, "charging", "how many charge", "charge session", "total energy charged", "energy added"):
		days := extractDays(lower, 30)
		return h.queryChargingSummary(ctx, days)

	case matchAny(lower, "charging cost", "total cost", "how much spent", "money spent", "electricity cost"):
		days := extractDays(lower, 30)
		return h.queryChargingCost(ctx, days)

	case matchAny(lower, "longest drive", "farthest drive", "max distance"):
		return h.queryLongestDrive(ctx)

	case matchAny(lower, "fastest", "top speed", "max speed", "speed record"):
		return h.queryMaxSpeed(ctx)

	case matchAny(lower, "last drive", "recent drive", "latest drive"):
		return h.queryLastDrive(ctx)

	case matchAny(lower, "last charge", "recent charge", "latest charge"):
		return h.queryLastCharge(ctx)

	case matchAny(lower, "alert", "notification", "warning"):
		return h.queryAlerts(ctx)

	case matchAny(lower, "geofence", "zone", "saved location"):
		return h.queryGeofences(ctx)

	case matchAny(lower, "online", "awake", "status", "vehicle state"):
		return h.queryVehicleStates(ctx)

	case matchAny(lower, "help", "what can you", "commands", "capabilities"):
		return h.helpMessage()

	default:
		return h.helpMessage()
	}
}

func (h *ChatbotHandler) queryVehicleCount(ctx context.Context) string {
	var count int
	err := h.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM vehicles`).Scan(&count)
	if err != nil {
		return "I couldn't retrieve vehicle data right now."
	}
	if count == 0 {
		return "You don't have any vehicles registered yet. Head to Fleet to sync your Tesla account."
	}
	return fmt.Sprintf("You have **%d vehicle%s** in your fleet.", count, plural(count))
}

func (h *ChatbotHandler) queryDriveCount(ctx context.Context, days int) string {
	var count int
	var totalDistM float64
	since := time.Now().AddDate(0, 0, -days)
	err := h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance_m), 0) FROM drives WHERE started_at >= $1`, since,
	).Scan(&count, &totalDistM)
	if err != nil {
		return "I couldn't retrieve drive data right now."
	}
	totalDistKm := totalDistM / 1000.0
	return fmt.Sprintf("In the last **%d days**, you've completed **%d drive%s** covering **%.1f km**.",
		days, count, plural(count), totalDistKm)
}

func (h *ChatbotHandler) queryTotalDistance(ctx context.Context, days int) string {
	var distM float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(distance_m), 0) FROM drives WHERE started_at >= $1`, since).Scan(&distM); err != nil {
		return "I couldn't retrieve distance data right now."
	}
	distKm := distM / 1000.0
	return fmt.Sprintf("Total distance driven in the last **%d days**: **%.1f km** (%.1f miles).",
		days, distKm, distKm*0.621371)
}

func (h *ChatbotHandler) queryEfficiency(ctx context.Context, days int) string {
	var totalEnergyWh, totalDistM float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(total_energy_added_wh), 0) FROM charging_sessions WHERE started_at >= $1`, since,
	).Scan(&totalEnergyWh); err != nil {
		return "I couldn't retrieve efficiency data right now."
	}
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(distance_m), 0) FROM drives WHERE started_at >= $1`, since,
	).Scan(&totalDistM); err != nil {
		return "I couldn't retrieve efficiency data right now."
	}
	totalEnergyKwh := totalEnergyWh / 1000.0
	totalDistKm := totalDistM / 1000.0
	if totalDistKm == 0 {
		return fmt.Sprintf("No driving data in the last %d days to calculate efficiency.", days)
	}
	eff := (totalEnergyKwh * 1000) / totalDistKm
	return fmt.Sprintf("Your fleet efficiency over the last **%d days**: **%.0f Wh/km** (%.1f kWh used over %.1f km).",
		days, eff, totalEnergyKwh, totalDistKm)
}

func (h *ChatbotHandler) queryBatteryStatus(ctx context.Context) string {
	if h.vehicleSvc == nil {
		return "I couldn't retrieve battery info right now."
	}
	vehicles, err := h.vehicleSvc.VehicleRepo().GetAll(ctx)
	if err != nil {
		return "I couldn't retrieve battery info right now."
	}

	var lines []string
	for _, v := range vehicles {
		if v == nil {
			continue
		}
		name := v.DisplayName
		if name == "" {
			name = "Unknown"
		}
		// Build current state through the layered live-state contract:
		// SignalStore L1 → Redis L2 → signal_log L3 fallback.
		// Never read battery_level directly from snapshot tables.
		state, stateErr := h.vehicleSvc.BuildStateFromSignalStoreContext(ctx, nil, v)
		if stateErr != nil {
			return "I couldn't retrieve battery info right now."
		}
		if state != nil && state.BatteryLevel > 0 {
			rangeStr := ""
			if state.RatedRange > 0 {
				rangeStr = fmt.Sprintf(" (%.0f km)", state.RatedRange)
			}
			lines = append(lines, fmt.Sprintf("- **%s**: %d%%%s", name, state.BatteryLevel, rangeStr))
		} else {
			lines = append(lines, fmt.Sprintf("- **%s**: No data yet", name))
		}
	}
	if len(lines) == 0 {
		return "No vehicles found. Sync your fleet first."
	}
	return "**Battery Status:**\n" + strings.Join(lines, "\n")
}

func (h *ChatbotHandler) queryChargingSummary(ctx context.Context, days int) string {
	var count int
	var energyWh float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(total_energy_added_wh), 0) FROM charging_sessions WHERE started_at >= $1`, since,
	).Scan(&count, &energyWh); err != nil {
		return "I couldn't retrieve charging data right now."
	}
	energyKwh := energyWh / 1000.0
	return fmt.Sprintf("In the last **%d days**: **%d charging session%s** adding **%.1f kWh** total.",
		days, count, plural(count), energyKwh)
}

func (h *ChatbotHandler) queryChargingCost(ctx context.Context, days int) string {
	var cost float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(cost_decimal::float8), 0) FROM charging_sessions WHERE started_at >= $1`, since,
	).Scan(&cost); err != nil {
		return "I couldn't retrieve charging cost data right now."
	}
	return fmt.Sprintf("Total charging cost in the last **%d days**: **$%.2f**.", days, cost)
}

func (h *ChatbotHandler) queryLongestDrive(ctx context.Context) string {
	var distM float64
	var durS int
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT distance_m, COALESCE(duration_s, 0)::int, started_at FROM drives ORDER BY distance_m DESC LIMIT 1`,
	).Scan(&distM, &durS, &startDate)
	if err != nil {
		return "No drives recorded yet."
	}
	distKm := distM / 1000.0
	durMinutes := durS / 60
	return fmt.Sprintf("Your longest drive was **%.1f km** (%d min) on **%s**.",
		distKm, durMinutes, startDate.Format("Jan 2, 2006"))
}

func (h *ChatbotHandler) queryMaxSpeed(ctx context.Context) string {
	var speedMps float64
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(max_speed_mps, 0), started_at FROM drives WHERE max_speed_mps IS NOT NULL ORDER BY max_speed_mps DESC LIMIT 1`,
	).Scan(&speedMps, &startDate)
	if err != nil {
		return "No speed data recorded yet."
	}
	// SI is m/s; convert to km/h (×3.6) and mph (×2.236936)
	speedKmh := speedMps * 3.6
	speedMph := speedMps * 2.236936
	return fmt.Sprintf("Your top speed on record: **%.0f km/h** (%.0f mph) on **%s**.",
		speedKmh, speedMph, startDate.Format("Jan 2, 2006"))
}

func (h *ChatbotHandler) queryLastDrive(ctx context.Context) string {
	var distM float64
	var durS int
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT distance_m, COALESCE(duration_s, 0)::int, started_at FROM drives ORDER BY started_at DESC LIMIT 1`,
	).Scan(&distM, &durS, &startDate)
	if err != nil {
		return "No drives recorded yet."
	}
	distKm := distM / 1000.0
	durMinutes := durS / 60
	ago := time.Since(startDate)
	return fmt.Sprintf("Your last drive was **%.1f km** (%d min), **%s ago** on %s.",
		distKm, durMinutes, humanDuration(ago), startDate.Format("Jan 2, 2006 3:04 PM"))
}

func (h *ChatbotHandler) queryLastCharge(ctx context.Context) string {
	var energyWh float64
	var startBat, endBat float64
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT total_energy_added_wh, start_soc_pct, COALESCE(end_soc_pct, start_soc_pct),
		        started_at FROM charging_sessions ORDER BY started_at DESC LIMIT 1`,
	).Scan(&energyWh, &startBat, &endBat, &startDate)
	if err != nil {
		return "No charging sessions recorded yet."
	}
	energyKwh := energyWh / 1000.0
	ago := time.Since(startDate)
	return fmt.Sprintf("Your last charge added **%.1f kWh** (%.0f%% → %.0f%%), **%s ago** on %s.",
		energyKwh, startBat, endBat, humanDuration(ago), startDate.Format("Jan 2, 2006 3:04 PM"))
}

func (h *ChatbotHandler) queryAlerts(ctx context.Context) string {
	var total, unread int
	if err := h.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM alerts`).Scan(&total); err != nil {
		return "I couldn't retrieve alert data right now."
	}
	if err := h.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM alerts WHERE is_read = false`).Scan(&unread); err != nil {
		return "I couldn't retrieve alert data right now."
	}
	return fmt.Sprintf("You have **%d alert%s** total, **%d unread**.", total, plural(total), unread)
}

func (h *ChatbotHandler) queryGeofences(ctx context.Context) string {
	rows, err := h.db.Pool.Query(ctx, `SELECT name, radius FROM geofences ORDER BY name`)
	if err != nil {
		return "I couldn't retrieve geofence data."
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var name string
		var radius float64
		if err := rows.Scan(&name, &radius); err != nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("- **%s** (%.0fm radius)", name, radius))
	}
	if len(lines) == 0 {
		return "No geofences configured yet. Head to Geofences to create one."
	}
	return "**Your Geofences:**\n" + strings.Join(lines, "\n")
}

func (h *ChatbotHandler) queryVehicleStates(ctx context.Context) string {
	rows, err := h.db.Pool.Query(ctx, `SELECT display_name, state FROM vehicles ORDER BY display_name`)
	if err != nil {
		return "I couldn't retrieve vehicle status."
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var name, state string
		if err := rows.Scan(&name, &state); err != nil {
			continue
		}
		if name == "" {
			name = "Unknown"
		}
		emoji := "🔴"
		if state == enums.StateOnline {
			emoji = "🟢"
		} else if state == enums.StateAsleep {
			emoji = "🟡"
		}
		lines = append(lines, fmt.Sprintf("- %s **%s**: %s", emoji, name, state))
	}
	if len(lines) == 0 {
		return "No vehicles found. Sync your fleet first."
	}
	return "**Vehicle Status:**\n" + strings.Join(lines, "\n")
}

func (h *ChatbotHandler) helpMessage() string {
	return `I'm your TeslaSync AI assistant! Here's what I can help with:

**Fleet Info**
- "How many vehicles do I have?"
- "What's the status of my vehicles?"
- "What are my battery levels?"

**Driving**
- "How many drives this week?"
- "Total distance in the last 30 days"
- "What was my longest drive?"
- "What's my top speed record?"
- "Tell me about my last drive"

**Charging**
- "How many charging sessions this month?"
- "Total energy charged in 30 days"
- "What's my charging cost this month?"
- "Tell me about my last charge"

**Efficiency**
- "What's my fleet efficiency?"
- "Energy consumption last 7 days"

**Other**
- "How many alerts do I have?"
- "Show my geofences"

*Tip: Include time ranges like "this week", "last 30 days", or "7 days".*`
}

// ---- Utility funcs ----

func matchAny(text string, patterns ...string) bool {
	for _, p := range patterns {
		if strings.Contains(text, p) {
			return true
		}
	}
	return false
}

func extractDays(text string, defaultDays int) int {
	reNum := regexp.MustCompile(`(\d+)\s*day`)
	if m := reNum.FindStringSubmatch(text); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
			return n
		}
	}
	if strings.Contains(text, "week") {
		return 7
	}
	if strings.Contains(text, "month") {
		return 30
	}
	if strings.Contains(text, "year") {
		return 365
	}
	if strings.Contains(text, "today") {
		return 1
	}
	return defaultDays
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func humanDuration(d time.Duration) string {
	if d < time.Minute {
		return "just now"
	}
	if d < time.Hour {
		m := int(math.Round(d.Minutes()))
		return fmt.Sprintf("%d minute%s", m, plural(m))
	}
	if d < 24*time.Hour {
		h := int(math.Round(d.Hours()))
		return fmt.Sprintf("%d hour%s", h, plural(h))
	}
	days := int(math.Round(d.Hours() / 24))
	return fmt.Sprintf("%d day%s", days, plural(days))
}
