package teslaphysics

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type sessionByID interface {
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
}

type sessionLister interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*chargingmodel.ChargingSession, error)
}

type driveByID interface {
	GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error)
}

type driveLister interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*drivemodel.Drive, error)
}

type clock func() time.Time

// Handler serves GET /api/v1/physics/*.
type Handler struct {
	state         signal.StateReader
	live          signal.LiveStateReader
	charges       sessionByID
	chargeList    sessionLister
	drives        driveByID
	driveList     driveLister
	clock         clock
	mqttConnected func() *bool
	hmacKey       []byte
}

// NewHandler binds production repositories and signal readers.
func NewHandler(db *database.DB, state signal.StateReader, live signal.LiveStateReader) *Handler {
	chargeRepo := chargingdb.NewChargingRepo(db)
	driveRepo := drivedb.NewDriveRepo(db)
	return &Handler{
		state:      state,
		live:       live,
		charges:    chargeRepo,
		chargeList: chargeRepo,
		drives:     driveRepo,
		driveList:  driveRepo,
		hmacKey:    []byte(os.Getenv("TESLASYNC_SESSION_CERT_KEY")),
	}
}

// WithMQTTConnected injects broker connectivity for the outage view.
func (h *Handler) WithMQTTConnected(fn func() *bool) *Handler {
	h.mqttConnected = fn
	return h
}

func (h *Handler) now() time.Time {
	if h.clock != nil {
		return h.clock().UTC()
	}
	return time.Now().UTC()
}

func parseVehicleID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.URL.Query().Get("vehicle_id")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, false
	}
	return id, true
}

func (h *Handler) ChargePhysics(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.charge")
	defer span.End()
	id, err := apiparams.URLParamInt64(r, "sessionID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid session ID")
		return
	}
	session, err := h.charges.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("session_id", id).Msg("charge physics session lookup failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}
	end := h.now()
	if session.EndedAt != nil {
		end = session.EndedAt.UTC()
	}
	from := session.StartedAt.UTC()
	if end.Sub(from) > maxChargeLookback {
		from = end.Add(-maxChargeLookback)
	}
	rows, err := h.state.Timeline(ctx, session.VehicleID, chargePhysicsFields(), from, end.Add(time.Nanosecond), signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("session_id", id).Msg("charge physics timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load charge physics")
		return
	}
	chargerType := ""
	if session.ChargerType != nil {
		chargerType = *session.ChargerType
	}
	httpx.WriteJSON(w, http.StatusOK, BuildChargePhysics(
		session.ID,
		session.VehicleID,
		session.StartedAt,
		session.EndedAt,
		chargerType,
		chargeSamplesFromTimeline(rows),
		h.now(),
	))
}

func (h *Handler) Theater(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.theater")
	defer span.End()
	drive, from, to, ok := h.loadDriveWindow(w, r)
	if !ok {
		return
	}
	rows, err := h.state.Timeline(ctx, drive.VehicleID, theaterFields(), from, to, signal.TimelineOptions{
		CollapseBy: []string{"gear", "charge_port_door_open", "charge_port_latch"},
	})
	if err != nil {
		log.Error().Err(err).Int64("drive_id", drive.ID).Msg("gear theater timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load gear theater")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, BuildGearTheater(drive.ID, drive.VehicleID, theaterSamplesFromTimeline(rows)))
}

func (h *Handler) Silent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.silent")
	defer span.End()
	drive, from, to, ok := h.loadDriveWindow(w, r)
	if !ok {
		return
	}
	rows, err := h.state.Timeline(ctx, drive.VehicleID, silentFields(), from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("drive_id", drive.ID).Msg("silent-counter timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load counter-silent report")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, BuildSilentReport(drive.ID, drive.VehicleID, motionSamplesFromTimeline(rows)))
}

func (h *Handler) Cockpit(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.cockpit")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	state, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("physics cockpit live state failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load physics cockpit")
		return
	}
	now := h.now()
	from := now.Add(-10 * time.Minute)
	rows, err := h.state.Timeline(ctx, vehicleID, parkFields(), from, now.Add(time.Nanosecond), signal.TimelineOptions{
		CollapseBy: []string{"gear", "sentry_mode", "cabin_overheat_mode", "hvac_power"},
	})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("physics cockpit park timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load physics cockpit")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, BuildCockpit(vehicleID, state, parkSamplesFromTimeline(rows), now))
}

func (h *Handler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.heartbeat")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	state, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("fsd heartbeat live state failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load FSD heartbeat")
		return
	}
	now := h.now()
	var samples []MotionSample
	if h.state != nil {
		rows, timelineErr := h.state.Timeline(ctx, vehicleID, silentFields(), now.Add(-30*time.Minute), now.Add(time.Nanosecond), signal.TimelineOptions{})
		if timelineErr != nil {
			log.Error().Err(timelineErr).Int64("vehicle_id", vehicleID).Msg("fsd heartbeat timeline failed")
		} else {
			samples = motionSamplesFromTimeline(rows)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, BuildHeartbeat(vehicleID, state, samples, now))
}

func (h *Handler) ParkTruth(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.park")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	now := h.now()
	rows, err := h.state.Timeline(ctx, vehicleID, parkFields(), now.Add(-30*time.Minute), now.Add(time.Nanosecond), signal.TimelineOptions{
		CollapseBy: []string{"gear", "sentry_mode", "cabin_overheat_mode", "hvac_power"},
	})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("park-truth timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load park truth")
		return
	}
	samples := parkSamplesFromTimeline(rows)
	if h.live != nil {
		if state, liveErr := h.live.LiveState(ctx, vehicleID); liveErr == nil {
			samples = append(samples, liveParkSample(state, now))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, BuildParkTruth(samples, now))
}

func (h *Handler) Vampire(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.vampire")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	now := h.now()
	rows, err := h.state.Timeline(ctx, vehicleID, vampireFields(), now.Add(-maxVampireLookback), now.Add(time.Nanosecond), signal.TimelineOptions{
		CollapseBy: []string{"gear", "detailed_charge_state", "charge_state", "battery_level"},
	})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vampire split timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load vampire split")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, BuildVampireSplit(vehicleID, vampireSamplesFromTimeline(rows)))
}

func (h *Handler) Certificate(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.certificate")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	from, to := apiparams.ParseDateRange(r)
	now := h.now()
	if from.IsZero() {
		from = now.Add(-30 * 24 * time.Hour)
	}
	if to.IsZero() {
		to = now
	}
	drives, err := h.driveList.GetByVehicle(ctx, vehicleID, 1000, 0, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("session certificate drives failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load session certificate")
		return
	}
	charges, err := h.chargeList.GetByVehicle(ctx, vehicleID, 1000, 0, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("session certificate charges failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load session certificate")
		return
	}
	driveBounds := make([]SessionBoundary, 0, len(drives))
	for _, drive := range drives {
		if drive == nil {
			continue
		}
		driveBounds = append(driveBounds, SessionBoundary{
			Kind:      "drive",
			ID:        drive.ID,
			StartedAt: drive.StartTs.UTC(),
			EndedAt:   drive.EndTs,
			EndRule:   "confirmed Park (Gear=P)",
		})
	}
	chargeBounds := make([]SessionBoundary, 0, len(charges))
	for _, charge := range charges {
		if charge == nil {
			continue
		}
		chargeBounds = append(chargeBounds, SessionBoundary{
			Kind:      "charge",
			ID:        charge.ID,
			StartedAt: charge.StartedAt.UTC(),
			EndedAt:   charge.EndedAt,
			EndRule:   "Disconnected (unplug)",
		})
	}
	httpx.WriteJSON(w, http.StatusOK, BuildSessionCertificate(vehicleID, now, from, to, driveBounds, chargeBounds, h.hmacKey))
}

func (h *Handler) Exclusive(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.exclusive")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	now := h.now()
	from := now.Add(-maxExclusiveLookback)
	var frames []PhysicsFrame
	if h.state != nil {
		rows, err := h.state.Timeline(ctx, vehicleID, exclusiveFields(), from, now.Add(time.Nanosecond), signal.TimelineOptions{
			CollapseBy: []string{"gear", "detailed_charge_state", "charge_state", "charge_port_latch", "firmware", "valet_mode", "service_mode"},
		})
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("exclusive physics timeline failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load TeslaSync-only physics")
			return
		}
		frames = physicsFramesFromTimeline(rows)
	}
	if h.live != nil {
		if state, liveErr := h.live.LiveState(ctx, vehicleID); liveErr == nil {
			frames = append(frames, livePhysicsFrame(state, now))
		}
	}
	var connected *bool
	if h.mqttConnected != nil {
		connected = h.mqttConnected()
	}
	driveBounds := []SessionBoundary{}
	chargeBounds := []SessionBoundary{}
	if h.driveList != nil {
		drives, err := h.driveList.GetByVehicle(ctx, vehicleID, 200, 0, from, now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("exclusive physics drives failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load TeslaSync-only physics")
			return
		}
		for _, drive := range drives {
			if drive == nil {
				continue
			}
			driveBounds = append(driveBounds, SessionBoundary{
				Kind:      "drive",
				ID:        drive.ID,
				StartedAt: drive.StartTs.UTC(),
				EndedAt:   drive.EndTs,
				EndRule:   "confirmed Park (Gear=P)",
			})
		}
	}
	if h.chargeList != nil {
		charges, err := h.chargeList.GetByVehicle(ctx, vehicleID, 200, 0, from, now)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("exclusive physics charges failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load TeslaSync-only physics")
			return
		}
		for _, charge := range charges {
			if charge == nil {
				continue
			}
			chargeBounds = append(chargeBounds, SessionBoundary{
				Kind:      "charge",
				ID:        charge.ID,
				StartedAt: charge.StartedAt.UTC(),
				EndedAt:   charge.EndedAt,
				EndRule:   "Disconnected (unplug)",
			})
		}
	}
	httpx.WriteJSON(w, http.StatusOK, BuildExclusiveReport(vehicleID, frames, now, connected, driveBounds, chargeBounds, h.hmacKey))
}

func (h *Handler) Outage(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.physics.outage")
	defer span.End()
	vehicleID, ok := parseVehicleID(w, r)
	if !ok {
		return
	}
	now := h.now()
	rows, err := h.state.Timeline(ctx, vehicleID, outageFields(), now.Add(-maxOutageLookback), now.Add(time.Nanosecond), signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("outage timeline failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load outage autobiography")
		return
	}
	var last *time.Time
	if len(rows) > 0 {
		t := rows[len(rows)-1].Timestamp.UTC()
		last = &t
	}
	var connected *bool
	if h.mqttConnected != nil {
		connected = h.mqttConnected()
	}
	httpx.WriteJSON(w, http.StatusOK, BuildOutageAutobiography(vehicleID, last, connected, now, nil))
}

func (h *Handler) loadDriveWindow(w http.ResponseWriter, r *http.Request) (*drivemodel.Drive, time.Time, time.Time, bool) {
	id, err := apiparams.URLParamInt64(r, "driveID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return nil, time.Time{}, time.Time{}, false
	}
	drive, err := h.drives.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("drive_id", id).Msg("physics drive lookup failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load drive")
		return nil, time.Time{}, time.Time{}, false
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return nil, time.Time{}, time.Time{}, false
	}
	to := h.now()
	if drive.EndTs != nil {
		to = drive.EndTs.UTC().Add(time.Nanosecond)
	}
	from := drive.StartTs.UTC()
	if to.Sub(from) > maxDriveLookback {
		from = to.Add(-maxDriveLookback)
	}
	return drive, from, to, true
}

func chargePhysicsFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "DetailedChargeState", Field: "detailed_charge_state"},
		{Signal: "ChargeState", Field: "charge_state"},
		{Signal: "FastChargerPresent", Field: "fast_charger_present"},
		{Signal: "FastChargerType", Field: "fast_charger_type"},
		{Signal: "ScheduledChargingMode", Field: "scheduled_charging_mode"},
		{Signal: "ScheduledChargingStartTime", Field: "scheduled_charging_start"},
		{Signal: "BatteryLevel", Field: "battery_level"},
	}
}

func theaterFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "ChargePortDoorOpen", Field: "charge_port_door_open"},
		{Signal: "ChargePortLatch", Field: "charge_port_latch"},
	}
}

func silentFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "VehicleSpeed", Field: "speed"},
		{Signal: "SelfDrivingMilesSinceReset", Field: "fsd_distance_m"},
	}
}

func parkFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "SentryMode", Field: "sentry_mode"},
		{Signal: "CabinOverheatProtectionMode", Field: "cabin_overheat_mode"},
		{Signal: "HvacPower", Field: "hvac_power"},
	}
}

func vampireFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "DetailedChargeState", Field: "detailed_charge_state"},
		{Signal: "ChargeState", Field: "charge_state"},
		{Signal: "BatteryLevel", Field: "battery_level"},
	}
}

func outageFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "MilesSinceReset", Field: "driving_distance_m"},
		{Signal: "Gear", Field: "gear"},
	}
}
