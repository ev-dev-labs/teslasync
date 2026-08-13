package vehicleinfo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

const (
	maxOpaqueRequestBodyBytes int64 = 16 * 1024
	teslaInfoRequestTimeout         = 30 * time.Second
)

// teslaInfoClient is the slice of *tesla.Client the handler needs to fetch
// per-vehicle account metadata from Tesla's Fleet API. Depending on the
// interface (rather than the concrete client) lets the unit tests inject a
// fake without a live Fleet API connection or partner token.
type teslaInfoClient interface {
	HasValidToken() bool
	GetMobileEnabled(ctx context.Context, vin string) ([]byte, int, error)
	GetVehicleOptions(ctx context.Context, vin string) ([]byte, int, error)
	GetVehicleSpecs(ctx context.Context, vin string) ([]byte, int, error)
	GetSubscriptionEligibility(ctx context.Context, vin string) ([]byte, int, error)
	GetUpgradeEligibility(ctx context.Context, vin string) ([]byte, int, error)
	GetWarrantyDetails(ctx context.Context, vin string) ([]byte, int, error)
	GetVehiclePricing(ctx context.Context, payload tesla.JSONRequestObject) ([]byte, int, error)
	GetEnterpriseRoles(ctx context.Context, vin string) ([]byte, int, error)
	SetEnterprisePayer(ctx context.Context, vin string, payload tesla.JSONRequestObject) ([]byte, int, error)
}

// userConfigStore is the subset of *tesladb.TeslaUserConfigRepo used to read
// and persist the stored metadata blobs.
type userConfigStore interface {
	GetByType(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error)
	Upsert(ctx context.Context, configType, data string) error
}

// vehicleFinder is the subset of *vehicledb.VehicleRepo used to resolve a
// vehicle id to its VIN.
type vehicleFinder interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

// Handler serves per-vehicle info stored in tesla_user_config:
// mobile_enabled, option codes, and vehicle specs.
type Handler struct {
	teslaClient teslaInfoClient
	configRepo  userConfigStore
	vehicleRepo vehicleFinder
}

// NewHandler wires Tesla account metadata dependencies.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		configRepo:  tesladb.NewTeslaUserConfigRepo(db),
		vehicleRepo: vehicledb.NewVehicleRepo(db),
	}
}

// vehicleInfoEnvelope wraps stored config data with metadata for the frontend.
type vehicleInfoEnvelope struct {
	Data      json.RawMessage `json:"data"`
	FetchedAt *string         `json:"fetched_at"`
}

type operationResultEnvelope struct {
	Data json.RawMessage `json:"data"`
}

type vehiclePricingRequest struct {
	Payload tesla.JSONRequestObject `json:"payload"`
}

type enterprisePayerRequest struct {
	Payload   tesla.JSONRequestObject `json:"payload"`
	Confirmed bool                    `json:"confirmed"`
}

type paidRequest struct {
	Confirmed bool `json:"confirmed"`
}

type tokenRequirement uint8

const (
	userTokenRequired tokenRequirement = iota
	partnerTokenRequired
)

type requestValidationError struct {
	status  int
	message string
}

func startHandlerSpan(r *http.Request, name string) (*http.Request, trace.Span) {
	ctx, span := otel.Tracer("api").Start(r.Context(), name)
	return r.WithContext(ctx), span
}

func traceID(ctx context.Context) string {
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return ""
	}
	return spanContext.TraceID().String()
}

func localVehicleID(r *http.Request) int64 {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		return 0
	}
	return vehicleID
}

// resolveVIN maps the {vehicleID} URL param to the vehicle's VIN and the
// HTTP status a caller should surface on failure:
//
//	400 — the param is missing or non-numeric (client error)
//	404 — no vehicle with that id exists
//	500 — the lookup itself failed (database error)
//
// On success it returns the VIN, http.StatusOK, and a nil error.
func (h *Handler) resolveVIN(r *http.Request) (string, int, error) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		return "", http.StatusBadRequest, fmt.Errorf("invalid vehicle ID: %w", err)
	}
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil {
		return "", http.StatusInternalServerError, fmt.Errorf("fetch vehicle %d: %w", vehicleID, err)
	}
	if vehicle == nil {
		return "", http.StatusNotFound, fmt.Errorf("vehicle %d not found", vehicleID)
	}
	return vehicle.VIN, http.StatusOK, nil
}

// resolveVINOrWriteError resolves the VIN or writes the appropriate error
// response, returning ok=false when the caller should stop. Server-side
// failures are logged with the underlying error but surfaced to the client
// as a generic message so internal details never leak over the wire.
func (h *Handler) resolveVINOrWriteError(w http.ResponseWriter, r *http.Request) (string, bool) {
	vin, status, err := h.resolveVIN(r)
	if err != nil {
		switch status {
		case http.StatusNotFound:
			httpx.WriteError(w, status, "vehicle not found")
		case http.StatusInternalServerError:
			trace.SpanFromContext(r.Context()).RecordError(err)
			log.Error().
				Err(err).
				Str("trace_id", traceID(r.Context())).
				Msg("failed to resolve vehicle for vehicle-info endpoint")
			httpx.WriteError(w, status, "failed to resolve vehicle")
		default:
			httpx.WriteError(w, status, "invalid vehicle ID")
		}
		return "", false
	}
	return vin, true
}

// ---------- Mobile Enabled ----------

// MobileEnabled returns stored mobile_enabled status from DB.
// GET /api/v1/vehicles/{vehicleID}/mobile-enabled
func (h *Handler) MobileEnabled(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.mobile_enabled")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "mobile_enabled:"+vin, "mobile_enabled", localVehicleID(r))
}

// RefreshMobileEnabled fetches mobile_enabled from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/mobile-enabled/refresh
func (h *Handler) RefreshMobileEnabled(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_mobile_enabled")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "mobile_enabled:" + vin
	h.refreshVehicleConfig(w, r, configKey, "mobile_enabled", localVehicleID(r), func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetMobileEnabled(ctx, vin)
	}, userTokenRequired, false)
}

// ---------- Vehicle Options ----------

// VehicleOptions returns stored option codes from DB.
// GET /api/v1/vehicles/{vehicleID}/options
func (h *Handler) VehicleOptions(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.options")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "vehicle_options:"+vin, "vehicle_options", localVehicleID(r))
}

// RefreshVehicleOptions fetches options from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/options/refresh
func (h *Handler) RefreshVehicleOptions(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_options")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "vehicle_options:" + vin
	h.refreshVehicleConfig(w, r, configKey, "vehicle_options", localVehicleID(r), func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetVehicleOptions(ctx, vin)
	}, userTokenRequired, false)
}

// ---------- Vehicle Specs ----------

// VehicleSpecs returns stored specs from DB.
// GET /api/v1/vehicles/{vehicleID}/specs
func (h *Handler) VehicleSpecs(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.specs")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "vehicle_specs:"+vin, "vehicle_specs", localVehicleID(r))
}

// RefreshVehicleSpecs fetches specs from Tesla using a partner token and saves to DB.
// This endpoint costs $0.10 per successful call — a freshness guard prevents
// redundant calls if specs were already fetched within the last 24 hours.
// POST /api/v1/vehicles/{vehicleID}/specs/refresh
func (h *Handler) RefreshVehicleSpecs(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_specs")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}

	var request paidRequest
	if validationErr := decodeLimitedJSON(w, r, &request); validationErr != nil {
		httpx.WriteError(w, validationErr.status, validationErr.message)
		return
	}
	if !request.Confirmed {
		httpx.WriteError(w, http.StatusBadRequest, "explicit confirmation is required for this paid Tesla request")
		return
	}

	vehicleID := localVehicleID(r)
	configKey := "vehicle_specs:" + vin

	// Freshness guard: reject if already fetched within 24 hours
	existing, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		span.RecordError(errors.New("vehicle specs freshness lookup failed"))
		log.Error().
			Str("trace_id", traceID(r.Context())).
			Int64("vehicle_id", vehicleID).
			Str("operation", "vehicle_specs").
			Msg("failed to check specs freshness")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to check specs freshness")
		return
	}
	if existing != nil && time.Since(existing.FetchedAt) < 24*time.Hour {
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Time("fetched_at", existing.FetchedAt).
			Msg("vehicle specs refresh rejected — already fetched within 24 hours (costs $0.10/call)")
		httpx.WriteError(w, http.StatusTooManyRequests, "specs were already fetched within the last 24 hours — this endpoint costs $0.10 per call")
		return
	}

	log.Warn().Int64("vehicle_id", vehicleID).Msg("refreshing vehicle specs from Tesla — this call costs $0.10")

	h.refreshVehicleConfig(w, r, configKey, "vehicle_specs", vehicleID, func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetVehicleSpecs(ctx, vin)
	}, partnerTokenRequired, true)
}

// ---------- Subscription Eligibility ----------

// SubscriptionEligibility returns stored subscription eligibility from DB.
// GET /api/v1/vehicles/{vehicleID}/subscriptions
func (h *Handler) SubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.subscriptions")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "subscriptions:"+vin, "subscriptions", localVehicleID(r))
}

// RefreshSubscriptionEligibility fetches subscription eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/subscriptions/refresh
func (h *Handler) RefreshSubscriptionEligibility(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_subscriptions")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "subscriptions:" + vin
	h.refreshVehicleConfig(w, r, configKey, "subscriptions", localVehicleID(r), func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetSubscriptionEligibility(ctx, vin)
	}, userTokenRequired, false)
}

// ---------- Upgrade Eligibility ----------

// UpgradeEligibility returns stored upgrade eligibility from DB.
// GET /api/v1/vehicles/{vehicleID}/upgrades
func (h *Handler) UpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.upgrades")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "upgrades:"+vin, "upgrades", localVehicleID(r))
}

// RefreshUpgradeEligibility fetches upgrade eligibility from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/upgrades/refresh
func (h *Handler) RefreshUpgradeEligibility(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_upgrades")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "upgrades:" + vin
	h.refreshVehicleConfig(w, r, configKey, "upgrades", localVehicleID(r), func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetUpgradeEligibility(ctx, vin)
	}, userTokenRequired, false)
}

// ---------- Warranty Details ----------

// WarrantyDetails returns stored warranty details for a vehicle from DB.
// GET /api/v1/vehicles/{vehicleID}/warranty
func (h *Handler) WarrantyDetails(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.warranty")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(w, r, "warranty:"+vin, "warranty", localVehicleID(r))
}

// RefreshWarrantyDetails fetches VIN-scoped warranty details from Tesla and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/warranty/refresh
func (h *Handler) RefreshWarrantyDetails(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_info.refresh_warranty")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	configKey := "warranty:" + vin
	h.refreshVehicleConfig(w, r, configKey, "warranty", localVehicleID(r), func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetWarrantyDetails(ctx, vin)
	}, userTokenRequired, false)
}

// ---------- Vehicle Pricing ----------

// VehiclePricing forwards a validated opaque JSON object to Tesla's
// read-only pricing query. The undocumented request object is never persisted.
// POST /api/v1/tesla/vehicle-pricing
func (h *Handler) VehiclePricing(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_management.pricing")
	defer span.End()

	var req vehiclePricingRequest
	if validationErr := decodeLimitedJSON(w, r, &req); validationErr != nil {
		httpx.WriteError(w, validationErr.status, validationErr.message)
		return
	}
	if len(req.Payload) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "payload must be a non-empty JSON object")
		return
	}

	h.executePartnerOperation(w, r, "vehicle_pricing", 0, func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.GetVehiclePricing(ctx, req.Payload)
	})
}

// ---------- Enterprise Roles ----------

// EnterpriseRoles returns cached enterprise roles for the selected vehicle.
// GET /api/v1/vehicles/{vehicleID}/enterprise-roles
func (h *Handler) EnterpriseRoles(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_management.enterprise_roles")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.getVehicleConfig(
		w,
		r,
		"enterprise_roles:"+vin,
		"enterprise_roles",
		localVehicleID(r),
	)
}

// RefreshEnterpriseRoles fetches enterprise roles from Tesla and stores only
// the response under the existing per-VIN tesla_user_config convention.
// POST /api/v1/vehicles/{vehicleID}/enterprise-roles/refresh
func (h *Handler) RefreshEnterpriseRoles(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_management.refresh_enterprise_roles")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	h.refreshVehicleConfig(
		w,
		r,
		"enterprise_roles:"+vin,
		"enterprise_roles",
		localVehicleID(r),
		func(ctx context.Context) ([]byte, int, error) {
			return h.teslaClient.GetEnterpriseRoles(ctx, vin)
		},
		partnerTokenRequired,
		false,
	)
}

// EnterprisePayer changes enterprise billing responsibility. The explicit
// wrapper confirmation is checked before any Fleet API call, and neither the
// request nor response is persisted.
// POST /api/v1/vehicles/{vehicleID}/enterprise-payer
func (h *Handler) EnterprisePayer(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "api.vehicle_management.enterprise_payer")
	defer span.End()

	vin, ok := h.resolveVINOrWriteError(w, r)
	if !ok {
		return
	}
	vehicleID := localVehicleID(r)

	var req enterprisePayerRequest
	if validationErr := decodeLimitedJSON(w, r, &req); validationErr != nil {
		httpx.WriteError(w, validationErr.status, validationErr.message)
		return
	}
	if !req.Confirmed {
		httpx.WriteError(w, http.StatusPreconditionFailed, "explicit payer change confirmation is required")
		return
	}
	if len(req.Payload) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "payload must be a non-empty JSON object")
		return
	}

	h.executePartnerOperation(w, r, "enterprise_payer", vehicleID, func(ctx context.Context) ([]byte, int, error) {
		return h.teslaClient.SetEnterprisePayer(ctx, vin, req.Payload)
	})
}

// ---------- Shared helpers ----------

// getVehicleConfig returns stored per-vehicle config data with fetched_at
// metadata. configKey may contain a VIN and must never be logged.
func (h *Handler) getVehicleConfig(
	w http.ResponseWriter,
	r *http.Request,
	configKey, operation string,
	vehicleID int64,
) {
	cfg, err := h.configRepo.GetByType(r.Context(), configKey)
	if err != nil {
		trace.SpanFromContext(r.Context()).RecordError(errors.New("vehicle management cache read failed"))
		event := log.Error().
			Str("trace_id", traceID(r.Context())).
			Str("operation", operation)
		if vehicleID > 0 {
			event = event.Int64("vehicle_id", vehicleID)
		}
		event.Msg("failed to fetch cached Tesla vehicle management data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch vehicle info")
		return
	}
	if cfg == nil {
		httpx.WriteJSON(w, http.StatusOK, vehicleInfoEnvelope{
			Data:      json.RawMessage("null"),
			FetchedAt: nil,
		})
		return
	}
	ts := cfg.FetchedAt.UTC().Format("2006-01-02T15:04:05Z")
	httpx.WriteJSON(w, http.StatusOK, vehicleInfoEnvelope{
		Data:      json.RawMessage(cfg.Data),
		FetchedAt: &ts,
	})
}

// refreshVehicleConfig fetches from Tesla, processes the response, persists, and returns.
// For mobile_enabled, the Tesla response envelope contains a bare boolean, which is
// wrapped as {"enabled": <bool>} before persisting.
func (h *Handler) refreshVehicleConfig(
	w http.ResponseWriter, r *http.Request,
	configKey, configType string,
	vehicleID int64,
	fetch func(context.Context) ([]byte, int, error),
	requirement tokenRequirement,
	isPaidEndpoint bool,
) {
	if requirement == userTokenRequired && !h.teslaClient.HasValidToken() {
		httpx.WriteTeslaTokenExpired(w)
		return
	}

	logEvent := log.Info().Str("operation", configType)
	if vehicleID > 0 {
		logEvent = logEvent.Int64("vehicle_id", vehicleID)
	}
	logEvent.Msg("refreshing Tesla vehicle management data")

	ctx, cancel := context.WithTimeout(r.Context(), teslaInfoRequestTimeout)
	defer cancel()
	body, status, err := fetch(ctx)
	if err != nil || status < http.StatusOK || status >= http.StatusMultipleChoices {
		h.writeTeslaFailure(w, r, configType, vehicleID, status, err, requirement)
		return
	}

	response, err := unwrapTeslaResponse(body)
	if err != nil {
		trace.SpanFromContext(r.Context()).RecordError(errors.New("invalid Tesla response"))
		log.Error().
			Str("trace_id", traceID(r.Context())).
			Str("operation", configType).
			Int("status", status).
			Msg("failed to parse Tesla vehicle management response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	data := string(response)

	// mobile_enabled returns a bare boolean (true/false). Wrap only those
	// literals; direct JSON objects from other response variants stay intact.
	if configType == "mobile_enabled" && (data == "true" || data == "false") {
		data = fmt.Sprintf(`{"enabled":%s}`, data)
	}

	if data == "" || data == "null" {
		data = "{}"
	}

	if err := h.configRepo.Upsert(r.Context(), configKey, data); err != nil {
		trace.SpanFromContext(r.Context()).RecordError(errors.New("vehicle management cache write failed"))
		event := log.Error().
			Str("trace_id", traceID(r.Context())).
			Str("operation", configType)
		if vehicleID > 0 {
			event = event.Int64("vehicle_id", vehicleID)
		}
		event.Msg("failed to save Tesla vehicle management data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save vehicle info")
		return
	}

	if isPaidEndpoint {
		log.Info().
			Int64("vehicle_id", vehicleID).
			Str("operation", configType).
			Int("status", status).
			Msg("paid Tesla API call completed and persisted")
	}

	h.getVehicleConfig(w, r, configKey, configType, vehicleID)
}

func (h *Handler) executePartnerOperation(
	w http.ResponseWriter,
	r *http.Request,
	operation string,
	vehicleID int64,
	fetch func(context.Context) ([]byte, int, error),
) {
	ctx, cancel := context.WithTimeout(r.Context(), teslaInfoRequestTimeout)
	defer cancel()

	body, status, err := fetch(ctx)
	if err != nil || status < http.StatusOK || status >= http.StatusMultipleChoices {
		h.writeTeslaFailure(w, r, operation, vehicleID, status, err, partnerTokenRequired)
		return
	}

	response, err := unwrapTeslaResponse(body)
	if err != nil {
		trace.SpanFromContext(r.Context()).RecordError(errors.New("invalid private Tesla response"))
		event := log.Error().
			Str("trace_id", traceID(r.Context())).
			Str("operation", operation).
			Int("status", status)
		if vehicleID > 0 {
			event = event.Int64("vehicle_id", vehicleID)
		}
		event.Msg("failed to parse private Tesla vehicle management response")
		httpx.WriteError(w, http.StatusBadGateway, "Tesla returned an invalid response")
		return
	}

	event := log.Info().
		Str("operation", operation).
		Int("status", status)
	if vehicleID > 0 {
		event = event.Int64("vehicle_id", vehicleID)
	}
	event.Msg("Tesla vehicle management operation completed")
	httpx.WriteJSON(w, http.StatusOK, operationResultEnvelope{Data: response})
}

func (h *Handler) writeTeslaFailure(
	w http.ResponseWriter,
	r *http.Request,
	operation string,
	vehicleID int64,
	status int,
	err error,
	requirement tokenRequirement,
) {
	trace.SpanFromContext(r.Context()).RecordError(errors.New("Tesla vehicle management operation failed"))
	event := log.Error().
		Str("trace_id", traceID(r.Context())).
		Str("operation", operation).
		Int("status", status)
	if vehicleID > 0 {
		event = event.Int64("vehicle_id", vehicleID)
	}
	event.Msg("Tesla vehicle management operation failed")

	if errors.Is(err, tesla.ErrPartnerCredentialsMissing) {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla partner credentials are not configured")
		return
	}

	switch status {
	case http.StatusUnauthorized:
		if requirement == userTokenRequired {
			httpx.WriteTeslaTokenExpired(w)
			return
		}
		httpx.WriteError(w, status, "Tesla partner authentication failed")
	case http.StatusPaymentRequired:
		httpx.WriteError(w, status, "Tesla requires payment or billing setup for this capability")
	case http.StatusForbidden:
		httpx.WriteError(w, status, "Tesla account lacks the required Fleet API scope or enterprise access")
	case http.StatusPreconditionFailed:
		httpx.WriteError(w, status, "Tesla account or vehicle does not meet this capability's prerequisites")
	case http.StatusTooManyRequests:
		httpx.WriteError(w, status, "Tesla rate limit reached; try again later")
	default:
		if status >= http.StatusBadRequest && status < http.StatusInternalServerError {
			httpx.WriteError(w, status, "Tesla rejected the vehicle management request")
			return
		}
		httpx.WriteError(w, http.StatusBadGateway, "failed to complete Tesla vehicle management request")
	}
}

func unwrapTeslaResponse(body []byte) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(body)
	if !json.Valid(trimmed) {
		return nil, errors.New("decode Tesla response: invalid JSON")
	}

	if len(trimmed) > 0 && trimmed[0] == '{' {
		var object map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &object); err != nil {
			return nil, fmt.Errorf("decode Tesla response object: %w", err)
		}
		if response, ok := object["response"]; ok {
			return response, nil
		}
	}

	return json.RawMessage(append([]byte(nil), trimmed...)), nil
}

func decodeLimitedJSON(
	w http.ResponseWriter,
	r *http.Request,
	dst interface{},
) *requestValidationError {
	r.Body = http.MaxBytesReader(w, r.Body, maxOpaqueRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return &requestValidationError{
				status:  http.StatusRequestEntityTooLarge,
				message: "request body is too large",
			}
		}
		if errors.Is(err, io.EOF) {
			return &requestValidationError{status: http.StatusBadRequest, message: "request body is required"}
		}
		return &requestValidationError{status: http.StatusBadRequest, message: "invalid request body"}
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return &requestValidationError{
			status:  http.StatusBadRequest,
			message: "request body must contain a single JSON object",
		}
	}
	return nil
}
