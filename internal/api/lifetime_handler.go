package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// LifetimeHandler serves all-time aggregated statistics with achievements.
type LifetimeHandler struct {
	db *database.DB
}

// NewLifetimeHandler creates a new LifetimeHandler.
func NewLifetimeHandler(db *database.DB) *LifetimeHandler {
	return &LifetimeHandler{db: db}
}

// Achievement represents a gamified milestone badge.
type Achievement struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Icon        string  `json:"icon"`
	Unlocked    bool    `json:"unlocked"`
	UnlockedAt  *string `json:"unlocked_at"`
	Progress    float64 `json:"progress"`
	Target      float64 `json:"target"`
	Current     float64 `json:"current"`
}

type achievementDef struct {
	ID     string
	Name   string
	Desc   string
	Icon   string
	Target float64
	Field  string // which stat field to compare against
}

var achievementDefs = []achievementDef{
	// Distance milestones
	{ID: "first-drive", Name: "First Drive", Desc: "Complete your first drive", Icon: "🚗", Target: 1, Field: "drives"},
	{ID: "century", Name: "Century Club", Desc: "Drive 100 km total", Icon: "💯", Target: 100, Field: "distance_km"},
	{ID: "thousand", Name: "Road Warrior", Desc: "Drive 1,000 km total", Icon: "⚔️", Target: 1000, Field: "distance_km"},
	{ID: "ten-thousand", Name: "Explorer", Desc: "Drive 10,000 km total", Icon: "🗺️", Target: 10000, Field: "distance_km"},
	{ID: "fifty-thousand", Name: "Nomad", Desc: "Drive 50,000 km total", Icon: "🌍", Target: 50000, Field: "distance_km"},
	{ID: "hundred-thousand", Name: "Legend", Desc: "Drive 100,000 km total", Icon: "👑", Target: 100000, Field: "distance_km"},

	// Charging milestones
	{ID: "first-charge", Name: "Plugged In", Desc: "Complete first charging session", Icon: "🔌", Target: 1, Field: "charge_sessions"},
	{ID: "megawatt", Name: "Megawatt Club", Desc: "Charge 1,000 kWh total", Icon: "⚡", Target: 1000, Field: "energy_kwh"},
	{ID: "gigawatt", Name: "Gigawatt Club", Desc: "Charge 10,000 kWh total", Icon: "🔋", Target: 10000, Field: "energy_kwh"},

	// Savings milestones
	{ID: "hundred-saved", Name: "Penny Wise", Desc: "Save $100 vs gas", Icon: "💰", Target: 100, Field: "savings"},
	{ID: "thousand-saved", Name: "Money Maker", Desc: "Save $1,000 vs gas", Icon: "💎", Target: 1000, Field: "savings"},
	{ID: "five-thousand-saved", Name: "Investment Paid Off", Desc: "Save $5,000 vs gas", Icon: "🏆", Target: 5000, Field: "savings"},

	// Environmental
	{ID: "ton-co2", Name: "Eco Warrior", Desc: "Offset 1 ton of CO₂", Icon: "🌱", Target: 1000, Field: "co2_kg"},
	{ID: "tree-planter", Name: "Tree Planter", Desc: "Equivalent of planting 10 trees", Icon: "🌳", Target: 10, Field: "trees"},

	// Fun
	{ID: "marathon", Name: "Marathon Runner", Desc: "Complete 100 drives", Icon: "🏃", Target: 100, Field: "drives"},
	{ID: "earth-orbit", Name: "Around the World", Desc: "Drive the Earth's circumference (40,075 km)", Icon: "🌎", Target: 40075, Field: "distance_km"},
	{ID: "supercharger", Name: "Supercharger Fan", Desc: "Complete 50 charging sessions", Icon: "⚡", Target: 50, Field: "charge_sessions"},
}

func (h *LifetimeHandler) GetLifetimeStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Optional vehicle filter
	var vehicleID int64
	if v := r.URL.Query().Get("vehicle_id"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		vehicleID = parsed
	}

	log.Info().Int64("vehicle_id", vehicleID).Msg("lifetime: computing stats")

	// ── Driving aggregates ──
	driveQuery := `
		SELECT COUNT(*),
		       COALESCE(SUM(distance), 0),
		       COALESCE(SUM(duration_min), 0),
		       COALESCE(MAX(distance), 0),
		       COALESCE(MAX(speed_max), 0),
		       MIN(start_date)
		FROM drives
		WHERE end_date IS NOT NULL AND distance > 0`
	driveArgs := []interface{}{}
	if vehicleID > 0 {
		driveQuery += " AND vehicle_id = $1"
		driveArgs = append(driveArgs, vehicleID)
	}

	var totalDrives int
	var totalDistKm, totalDrivingMin, longestDriveKm, highestSpeedKmh float64
	var firstDriveDate *time.Time
	err := h.db.Pool.QueryRow(ctx, driveQuery, driveArgs...).Scan(
		&totalDrives, &totalDistKm, &totalDrivingMin,
		&longestDriveKm, &highestSpeedKmh, &firstDriveDate,
	)
	if err != nil {
		log.Error().Err(err).Msg("lifetime: failed to get drive stats")
		writeError(w, http.StatusInternalServerError, "failed to get lifetime stats")
		return
	}

	// Average efficiency (Wh/km) — from drives with valid range data
	effQuery := `
		SELECT COALESCE(AVG(
			CASE WHEN distance > 1 AND start_range_km IS NOT NULL AND end_range_km IS NOT NULL
			     AND (start_range_km - end_range_km) > 0
			THEN ((start_range_km - end_range_km) / distance) * 1000
			ELSE NULL END
		), 0)
		FROM drives
		WHERE end_date IS NOT NULL AND distance > 0`
	effArgs := []interface{}{}
	if vehicleID > 0 {
		effQuery += " AND vehicle_id = $1"
		effArgs = append(effArgs, vehicleID)
	}
	var avgEffWhKm float64
	_ = h.db.Pool.QueryRow(ctx, effQuery, effArgs...).Scan(&avgEffWhKm)

	// ── Charging aggregates ──
	chargeQuery := `
		SELECT COUNT(*),
		       COALESCE(SUM(charge_energy_added), 0),
		       COALESCE(SUM(duration_min), 0),
		       COALESCE(SUM(CASE WHEN cost > 0 THEN cost ELSE 0 END), 0)
		FROM charging_sessions
		WHERE end_date IS NOT NULL`
	chargeArgs := []interface{}{}
	if vehicleID > 0 {
		chargeQuery += " AND vehicle_id = $1"
		chargeArgs = append(chargeArgs, vehicleID)
	}

	var totalChargeSessions int
	var totalEnergyKwh, totalChargingMin, totalChargingCost float64
	err = h.db.Pool.QueryRow(ctx, chargeQuery, chargeArgs...).Scan(
		&totalChargeSessions, &totalEnergyKwh, &totalChargingMin, &totalChargingCost,
	)
	if err != nil {
		log.Error().Err(err).Msg("lifetime: failed to get charging stats")
		writeError(w, http.StatusInternalServerError, "failed to get lifetime stats")
		return
	}

	// ── Savings computation (mirrors TCOHandler pattern) ──
	var gasPrice, gasEfficiencyMPG float64
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(gas_price_per_unit, 3.50), COALESCE(gas_efficiency_mpg, 25) FROM settings LIMIT 1`,
	).Scan(&gasPrice, &gasEfficiencyMPG)
	if err != nil && err != pgx.ErrNoRows {
		log.Error().Err(err).Msg("lifetime: failed to get settings")
	}
	if gasPrice <= 0 {
		gasPrice = 3.50
	}
	if gasEfficiencyMPG <= 0 {
		gasEfficiencyMPG = 25
	}

	var gasEquivalentCost, totalSavings float64
	if totalDistKm > 0 {
		totalMiles := totalDistKm / 1.60934
		gallonsUsed := totalMiles / gasEfficiencyMPG
		gasEquivalentCost = gallonsUsed * gasPrice
		totalSavings = gasEquivalentCost - totalChargingCost
		if totalSavings < 0 {
			totalSavings = 0
		}
	}

	// CO₂ offset: avg ICE emits ~192g CO₂/km
	co2OffsetKg := totalDistKm * 0.192
	treesEquivalent := int(co2OffsetKg / 21) // avg tree absorbs ~21kg CO₂/year

	// ── Fun facts ──
	earthCircumferences := totalDistKm / 40075.0
	moonTrips := totalDistKm / 384400.0
	daysOnRoad := (totalDrivingMin / 60.0) / 24.0
	homesEquivalentDays := totalEnergyKwh / 30.0 // avg home uses ~30 kWh/day

	// ── Ownership timeline ──
	var ownershipDays int
	var firstDriveDateStr *string
	if firstDriveDate != nil && !firstDriveDate.IsZero() {
		days := int(time.Since(*firstDriveDate).Hours() / 24)
		if days < 0 {
			days = 0
		}
		ownershipDays = days
		s := firstDriveDate.Format("2006-01-02")
		firstDriveDateStr = &s
	}

	// ── Activity patterns: most active DOW and hour ──
	mostActiveDOW := ""
	mostActiveHour := 0

	dowQuery := `
		SELECT EXTRACT(DOW FROM start_date)::int as dow, COUNT(*) as cnt
		FROM drives WHERE end_date IS NOT NULL AND distance > 0`
	dowArgs := []interface{}{}
	if vehicleID > 0 {
		dowQuery += " AND vehicle_id = $1"
		dowArgs = append(dowArgs, vehicleID)
	}
	dowQuery += " GROUP BY dow ORDER BY cnt DESC LIMIT 1"

	var dowIdx int
	var dowCnt int
	if err := h.db.Pool.QueryRow(ctx, dowQuery, dowArgs...).Scan(&dowIdx, &dowCnt); err == nil {
		dayNames := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
		if dowIdx >= 0 && dowIdx < 7 {
			mostActiveDOW = dayNames[dowIdx]
		}
	}

	hourQuery := `
		SELECT EXTRACT(HOUR FROM start_date)::int as hr, COUNT(*) as cnt
		FROM drives WHERE end_date IS NOT NULL AND distance > 0`
	hourArgs := []interface{}{}
	if vehicleID > 0 {
		hourQuery += " AND vehicle_id = $1"
		hourArgs = append(hourArgs, vehicleID)
	}
	hourQuery += " GROUP BY hr ORDER BY cnt DESC LIMIT 1"

	var hrIdx int
	var hrCnt int
	if err := h.db.Pool.QueryRow(ctx, hourQuery, hourArgs...).Scan(&hrIdx, &hrCnt); err == nil {
		mostActiveHour = hrIdx
	}

	// ── Personal records ──
	type personalRecord struct {
		Value float64 `json:"value"`
		Date  *string `json:"date"`
	}

	// Longest drive
	longestRec := personalRecord{Value: longestDriveKm}
	longestRecQuery := `
		SELECT start_date FROM drives
		WHERE end_date IS NOT NULL AND distance > 0`
	longestRecArgs := []interface{}{}
	if vehicleID > 0 {
		longestRecQuery += " AND vehicle_id = $1"
		longestRecArgs = append(longestRecArgs, vehicleID)
	}
	longestRecQuery += " ORDER BY distance DESC LIMIT 1"
	var longestDate time.Time
	if err := h.db.Pool.QueryRow(ctx, longestRecQuery, longestRecArgs...).Scan(&longestDate); err == nil {
		s := longestDate.Format("2006-01-02")
		longestRec.Date = &s
	}

	// Highest speed
	speedRec := personalRecord{Value: highestSpeedKmh}
	speedRecQuery := `
		SELECT start_date FROM drives
		WHERE end_date IS NOT NULL AND distance > 0 AND speed_max IS NOT NULL`
	speedRecArgs := []interface{}{}
	if vehicleID > 0 {
		speedRecQuery += " AND vehicle_id = $1"
		speedRecArgs = append(speedRecArgs, vehicleID)
	}
	speedRecQuery += " ORDER BY speed_max DESC LIMIT 1"
	var speedDate time.Time
	if err := h.db.Pool.QueryRow(ctx, speedRecQuery, speedRecArgs...).Scan(&speedDate); err == nil {
		s := speedDate.Format("2006-01-02")
		speedRec.Date = &s
	}

	// Most energy in a single charge
	var maxChargeKwh float64
	var maxChargeDate *string
	maxChargeQuery := `
		SELECT charge_energy_added, start_date FROM charging_sessions
		WHERE end_date IS NOT NULL AND charge_energy_added > 0`
	maxChargeArgs := []interface{}{}
	if vehicleID > 0 {
		maxChargeQuery += " AND vehicle_id = $1"
		maxChargeArgs = append(maxChargeArgs, vehicleID)
	}
	maxChargeQuery += " ORDER BY charge_energy_added DESC LIMIT 1"
	var mcDate time.Time
	if err := h.db.Pool.QueryRow(ctx, maxChargeQuery, maxChargeArgs...).Scan(&maxChargeKwh, &mcDate); err == nil {
		s := mcDate.Format("2006-01-02")
		maxChargeDate = &s
	}
	chargeRec := personalRecord{Value: maxChargeKwh, Date: maxChargeDate}

	// ── Achievements ──
	fieldValues := map[string]float64{
		"drives":          float64(totalDrives),
		"distance_km":     totalDistKm,
		"charge_sessions": float64(totalChargeSessions),
		"energy_kwh":      totalEnergyKwh,
		"savings":         totalSavings,
		"co2_kg":          co2OffsetKg,
		"trees":           float64(treesEquivalent),
	}

	achievements := make([]Achievement, 0, len(achievementDefs))
	for _, def := range achievementDefs {
		current := fieldValues[def.Field]
		progress := 0.0
		if def.Target > 0 {
			progress = current / def.Target
			if progress > 1.0 {
				progress = 1.0
			}
		}
		a := Achievement{
			ID:          def.ID,
			Name:        def.Name,
			Description: def.Desc,
			Icon:        def.Icon,
			Unlocked:    current >= def.Target,
			Progress:    safeFloatLifetime(math.Round(progress*1000) / 1000),
			Target:      def.Target,
			Current:     safeFloatLifetime(math.Round(current*100) / 100),
		}
		achievements = append(achievements, a)
	}

	totalDrivingHours := totalDrivingMin / 60.0
	totalChargingHours := totalChargingMin / 60.0

	result := map[string]interface{}{
		// Driving
		"total_drives":        totalDrives,
		"total_distance_km":   safeFloatLifetime(math.Round(totalDistKm*100) / 100),
		"total_driving_hours": safeFloatLifetime(math.Round(totalDrivingHours*100) / 100),
		"longest_drive_km":    safeFloatLifetime(math.Round(longestDriveKm*100) / 100),
		"highest_speed_kmh":   safeFloatLifetime(math.Round(highestSpeedKmh*10) / 10),
		"avg_efficiency_wh_km": safeFloatLifetime(math.Round(avgEffWhKm*10) / 10),

		// Charging
		"total_charge_sessions": totalChargeSessions,
		"total_energy_kwh":      safeFloatLifetime(math.Round(totalEnergyKwh*100) / 100),
		"total_charging_hours":  safeFloatLifetime(math.Round(totalChargingHours*100) / 100),
		"total_charging_cost":   safeFloatLifetime(math.Round(totalChargingCost*100) / 100),

		// Savings
		"gas_equivalent_cost": safeFloatLifetime(math.Round(gasEquivalentCost*100) / 100),
		"total_savings":       safeFloatLifetime(math.Round(totalSavings*100) / 100),
		"co2_offset_kg":       safeFloatLifetime(math.Round(co2OffsetKg*100) / 100),
		"trees_equivalent":    treesEquivalent,

		// Fun facts
		"earth_circumferences":  safeFloatLifetime(math.Round(earthCircumferences*1000) / 1000),
		"moon_trips":            safeFloatLifetime(math.Round(moonTrips*10000) / 10000),
		"days_on_road":          safeFloatLifetime(math.Round(daysOnRoad*100) / 100),
		"homes_equivalent_days": safeFloatLifetime(math.Round(homesEquivalentDays*100) / 100),

		// Timeline
		"first_drive_date":       firstDriveDateStr,
		"ownership_days":         ownershipDays,
		"most_active_day_of_week": mostActiveDOW,
		"most_active_hour":       mostActiveHour,

		// Personal records
		"longest_drive_record":  longestRec,
		"highest_speed_record":  speedRec,
		"max_charge_record":     chargeRec,

		// Achievements
		"achievements": achievements,
	}

	writeJSON(w, http.StatusOK, result)
}

// safeFloatLifetime guards against NaN/Inf which break json.Encode.
func safeFloatLifetime(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}
