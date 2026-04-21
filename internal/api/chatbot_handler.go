package api

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

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/embedding"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ChatbotHandler handles AI chatbot queries against fleet data.
type ChatbotHandler struct {
	chat      *database.ChatRepo
	db        *database.DB
	embedding *embedding.Service
}

func NewChatbotHandler(db *database.DB) *ChatbotHandler {
	return &ChatbotHandler{
		chat: database.NewChatRepo(db),
		db:   db,
	}
}

// SetEmbeddingService attaches a pgvector-backed search service. When present
// and enabled, the chatbot falls back to semantic search for queries that do
// not match any of the built-in patterns, returning the most relevant drive /
// charge / alert summaries.
func (h *ChatbotHandler) SetEmbeddingService(svc *embedding.Service) {
	h.embedding = svc
}

// Chat processes a user message and returns an AI-generated response.
func (h *ChatbotHandler) Chat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message   string `json:"message"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(body.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}
	if body.SessionID == "" {
		body.SessionID = fmt.Sprintf("s_%d", time.Now().UnixNano())
	}

	// Save user message
	userMsg := &models.ChatMessage{SessionID: body.SessionID, Role: "user", Content: body.Message}
	_ = h.chat.SaveMessage(r.Context(), userMsg)

	// Generate response by interpreting the query
	response := h.processQuery(r.Context(), body.Message)

	// Save assistant message
	assistantMsg := &models.ChatMessage{SessionID: body.SessionID, Role: "assistant", Content: response}
	_ = h.chat.SaveMessage(r.Context(), assistantMsg)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"response":   response,
		"session_id": body.SessionID,
	})
}

// History returns chat messages for a session.
func (h *ChatbotHandler) History(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}
	msgs, err := h.chat.GetHistory(r.Context(), sessionID, 100)
	if err != nil {
		log.Error().Err(err).Msg("failed to get chat history")
		writeError(w, http.StatusInternalServerError, "failed to get history")
		return
	}
	if msgs == nil {
		msgs = []*models.ChatMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

// Sessions lists recent chat sessions.
func (h *ChatbotHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := h.chat.GetSessions(r.Context(), 50)
	if err != nil {
		log.Error().Err(err).Msg("failed to get chat sessions")
		writeError(w, http.StatusInternalServerError, "failed to get sessions")
		return
	}
	if sessions == nil {
		sessions = []string{}
	}
	writeJSON(w, http.StatusOK, sessions)
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
		// When no pattern matches, fall back to semantic search against
		// embeddings if the feature is enabled. This lets users ask open-ended
		// questions like "drives where battery dropped fast" or "slowest charge".
		if resp := h.semanticFallback(ctx, msg); resp != "" {
			return resp
		}
		return h.helpMessage()
	}
}

// semanticFallback performs a pgvector nearest-neighbor search over drives,
// charges and alerts and renders the top matches as a Markdown snippet.
// Returns "" when embeddings are disabled or no matches are found.
func (h *ChatbotHandler) semanticFallback(ctx context.Context, query string) string {
	if h.embedding == nil || !h.embedding.Enabled() {
		return ""
	}
	results, err := h.embedding.Search(ctx, query, 0, 5)
	if err != nil {
		log.Warn().Err(err).Str("query", query).Msg("chatbot semantic search failed")
		return ""
	}
	if len(results) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Here are the most relevant entries I found:\n\n")
	for _, r := range results {
		fmt.Fprintf(&b, "- *(%s #%d, similarity %.2f)* %s\n",
			r.EntityType, r.EntityID, r.Similarity, r.Content)
	}
	return b.String()
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
	var totalDist float64
	since := time.Now().AddDate(0, 0, -days)
	err := h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance), 0) FROM drives WHERE start_date >= $1`, since,
	).Scan(&count, &totalDist)
	if err != nil {
		return "I couldn't retrieve drive data right now."
	}
	return fmt.Sprintf("In the last **%d days**, you've completed **%d drive%s** covering **%.1f km**.",
		days, count, plural(count), totalDist)
}

func (h *ChatbotHandler) queryTotalDistance(ctx context.Context, days int) string {
	var dist float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(distance), 0) FROM drives WHERE start_date >= $1`, since).Scan(&dist); err != nil {
		return "I couldn't retrieve distance data right now."
	}
	return fmt.Sprintf("Total distance driven in the last **%d days**: **%.1f km** (%.1f miles).",
		days, dist, dist*0.621371)
}

func (h *ChatbotHandler) queryEfficiency(ctx context.Context, days int) string {
	var totalEnergy, totalDist float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(charge_energy_added), 0) FROM charging_sessions WHERE start_date >= $1`, since,
	).Scan(&totalEnergy); err != nil {
		return "I couldn't retrieve efficiency data right now."
	}
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(distance), 0) FROM drives WHERE start_date >= $1`, since,
	).Scan(&totalDist); err != nil {
		return "I couldn't retrieve efficiency data right now."
	}
	if totalDist == 0 {
		return fmt.Sprintf("No driving data in the last %d days to calculate efficiency.", days)
	}
	eff := (totalEnergy * 1000) / totalDist
	return fmt.Sprintf("Your fleet efficiency over the last **%d days**: **%.0f Wh/km** (%.1f kWh used over %.1f km).",
		days, eff, totalEnergy, totalDist)
}

func (h *ChatbotHandler) queryBatteryStatus(ctx context.Context) string {
	rows, err := h.db.Pool.Query(ctx,
		`SELECT v.display_name, p.battery_level, p.rated_range
		 FROM vehicles v
		 LEFT JOIN LATERAL (
		   SELECT battery_level, rated_range FROM positions WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1
		 ) p ON true
		 ORDER BY v.display_name`)
	if err != nil {
		return "I couldn't retrieve battery info right now."
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var name string
		var battery *int
		var rng *float64
		if err := rows.Scan(&name, &battery, &rng); err != nil {
			continue
		}
		if name == "" {
			name = "Unknown"
		}
		if battery != nil {
			rangeStr := ""
			if rng != nil {
				rangeStr = fmt.Sprintf(" (%.0f km)", *rng)
			}
			lines = append(lines, fmt.Sprintf("- **%s**: %d%%%s", name, *battery, rangeStr))
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
	var energy float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(charge_energy_added), 0) FROM charging_sessions WHERE start_date >= $1`, since,
	).Scan(&count, &energy); err != nil {
		return "I couldn't retrieve charging data right now."
	}
	return fmt.Sprintf("In the last **%d days**: **%d charging session%s** adding **%.1f kWh** total.",
		days, count, plural(count), energy)
}

func (h *ChatbotHandler) queryChargingCost(ctx context.Context, days int) string {
	var cost float64
	since := time.Now().AddDate(0, 0, -days)
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(cost), 0) FROM charging_sessions WHERE start_date >= $1`, since,
	).Scan(&cost); err != nil {
		return "I couldn't retrieve charging cost data right now."
	}
	return fmt.Sprintf("Total charging cost in the last **%d days**: **$%.2f**.", days, cost)
}

func (h *ChatbotHandler) queryLongestDrive(ctx context.Context) string {
	var dist float64
	var dur int
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT distance, duration_min, start_date FROM drives ORDER BY distance DESC LIMIT 1`,
	).Scan(&dist, &dur, &startDate)
	if err != nil {
		return "No drives recorded yet."
	}
	return fmt.Sprintf("Your longest drive was **%.1f km** (%d min) on **%s**.",
		dist, dur, startDate.Format("Jan 2, 2006"))
}

func (h *ChatbotHandler) queryMaxSpeed(ctx context.Context) string {
	var speed float64
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(speed_max, 0), start_date FROM drives WHERE speed_max IS NOT NULL ORDER BY speed_max DESC LIMIT 1`,
	).Scan(&speed, &startDate)
	if err != nil {
		return "No speed data recorded yet."
	}
	return fmt.Sprintf("Your top speed on record: **%.0f km/h** (%.0f mph) on **%s**.",
		speed, speed*0.621371, startDate.Format("Jan 2, 2006"))
}

func (h *ChatbotHandler) queryLastDrive(ctx context.Context) string {
	var dist float64
	var dur int
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT distance, duration_min, start_date FROM drives ORDER BY start_date DESC LIMIT 1`,
	).Scan(&dist, &dur, &startDate)
	if err != nil {
		return "No drives recorded yet."
	}
	ago := time.Since(startDate)
	return fmt.Sprintf("Your last drive was **%.1f km** (%d min), **%s ago** on %s.",
		dist, dur, humanDuration(ago), startDate.Format("Jan 2, 2006 3:04 PM"))
}

func (h *ChatbotHandler) queryLastCharge(ctx context.Context) string {
	var energy float64
	var startBat, endBat int
	var startDate time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT charge_energy_added, start_battery_level, COALESCE(end_battery_level, start_battery_level),
		        start_date FROM charging_sessions ORDER BY start_date DESC LIMIT 1`,
	).Scan(&energy, &startBat, &endBat, &startDate)
	if err != nil {
		return "No charging sessions recorded yet."
	}
	ago := time.Since(startDate)
	return fmt.Sprintf("Your last charge added **%.1f kWh** (%d%% → %d%%), **%s ago** on %s.",
		energy, startBat, endBat, humanDuration(ago), startDate.Format("Jan 2, 2006 3:04 PM"))
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
