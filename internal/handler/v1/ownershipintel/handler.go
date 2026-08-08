// Package ownershipintel exposes the ownership intelligence v1 HTTP contract.
// MountRoutes is intended to be called from the shared /api/v1 composition
// root. Every surface is subject-scoped: a caller only ever sees the records
// its own forward-auth identity created.
package ownershipintel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	maxRequestBodyBytes = 256 << 10
	openModeSubject     = "open-mode"
	defaultWindowDays   = 90
)

type service interface {
	InsuranceRiskProfile(context.Context, string, int64, int) (*domain.InsuranceRiskProfile, error)
	UpsertInsurancePolicy(context.Context, string, domain.UpsertInsurancePolicyRequest) (*domain.InsurancePolicy, error)
	DeleteInsurancePolicy(context.Context, string, int64) error

	ListTariffs(context.Context, string, int, int) (*domain.Page[domain.Tariff], error)
	CreateTariff(context.Context, string, domain.CreateTariffRequest) (*domain.Tariff, error)
	DeleteTariff(context.Context, string, int64) error
	SimulateTariffs(context.Context, string, domain.TariffSimulationRequest) (*domain.TariffSimulationResponse, error)

	ListInvoices(context.Context, string, int64, int, int) (*domain.Page[domain.ChargingInvoice], error)
	CreateInvoice(context.Context, string, domain.CreateInvoiceRequest) (*domain.ChargingInvoice, error)
	DeleteInvoice(context.Context, string, int64) error
	ReconcileInvoice(context.Context, string, int64) (*domain.ReconciliationReport, error)
	CreateDispute(context.Context, string, int64, domain.CreateDisputeRequest) (*domain.InvoiceDispute, error)

	DriverAttribution(context.Context, string, int64, int, int, int) (*domain.DriverAttributionReport, error)
	ListDriverProfiles(context.Context, string, int64) ([]domain.DriverProfile, error)
	CreateDriverProfile(context.Context, string, domain.CreateDriverProfileRequest) (*domain.DriverProfile, error)
	DeleteDriverProfile(context.Context, string, int64) error
	AssignDrive(context.Context, string, domain.AssignDriveRequest) error

	WarrantyOverview(context.Context, string, int64) (*domain.WarrantyOverview, error)
	ListWarranties(context.Context, string, int64) ([]domain.Warranty, error)
	CreateWarranty(context.Context, string, domain.CreateWarrantyRequest) (*domain.Warranty, error)
	DeleteWarranty(context.Context, string, int64) error
	CreateWarrantyClaim(context.Context, string, domain.CreateClaimRequest) (*domain.WarrantyClaim, error)

	GovernanceOverview(context.Context, string) (*domain.GovernanceOverview, error)
	UpsertRetentionPolicy(context.Context, string, domain.UpsertRetentionPolicyRequest) (*domain.RetentionPolicy, error)
	DeleteRetentionPolicy(context.Context, string, int64) error
	SimulateGovernance(context.Context, string, domain.GovernanceSimulationRequest) (*domain.GovernanceSimulationResponse, error)
	ListRetentionRuns(context.Context, string, int, int) (*domain.Page[domain.RetentionRun], error)

	ModelTrust(context.Context, string, int64, int) (*domain.ModelTrustReport, error)
	RecordPrediction(context.Context, string, domain.RecordPredictionRequest) (*domain.Prediction, error)
	RecordOutcome(context.Context, string, domain.RecordOutcomeRequest) (*domain.Prediction, error)

	ComplianceApportionment(context.Context, string, int64, int) (*domain.ComplianceApportionment, error)
	ListJurisdictionRates(context.Context, string) ([]domain.JurisdictionRate, error)
	CreateJurisdictionRate(context.Context, string, domain.CreateJurisdictionRateRequest) (*domain.JurisdictionRate, error)
	DeleteJurisdictionRate(context.Context, string, int64) error
	ListFilings(context.Context, string, int64, int, int) (*domain.Page[domain.ComplianceFiling], error)
	CreateFiling(context.Context, string, domain.CreateFilingRequest) (*domain.ComplianceFiling, error)

	ConsumablesReport(context.Context, string, int64) (*domain.ConsumablesReport, error)
	ListConsumables(context.Context, string, int64) ([]domain.ConsumableItem, error)
	CreateConsumable(context.Context, string, domain.CreateConsumableItemRequest) (*domain.ConsumableItem, error)
	DeleteConsumable(context.Context, string, int64) error
	CreateConsumableEvent(context.Context, string, domain.CreateConsumableEventRequest) (*domain.ConsumableEvent, error)

	SubscriptionROI(context.Context, string, int64, int) (*domain.SubscriptionROIReport, error)
	ListSubscriptions(context.Context, string, int64) ([]domain.Subscription, error)
	CreateSubscription(context.Context, string, domain.CreateSubscriptionRequest) (*domain.Subscription, error)
	DeleteSubscription(context.Context, string, int64) error
}

// Handler serves the ownership intelligence contract.
type Handler struct {
	service    service
	headerName string
}

// NewHandler builds the transport adapter.
func NewHandler(svc service, forwardAuthHeader string) *Handler {
	if svc == nil {
		panic("ownershipintel.NewHandler: service must not be nil")
	}
	return &Handler{service: svc, headerName: strings.TrimSpace(forwardAuthHeader)}
}

// MountRoutes mounts the ten ownership intelligence route groups. The caller
// should invoke this on the /api/v1 chi group.
func (h *Handler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(20, time.Minute)

	r.Route("/insurance-telematics", func(r chi.Router) {
		r.Get("/", h.InsuranceRiskProfile)
		r.With(writeLimit).Put("/policy", h.UpsertInsurancePolicy)
		r.With(writeLimit).Delete("/policy/{id}", h.DeleteInsurancePolicy)
	})

	r.Route("/tariff-lab", func(r chi.Router) {
		r.Get("/tariffs", h.ListTariffs)
		r.With(writeLimit).Post("/tariffs", h.CreateTariff)
		r.With(writeLimit).Delete("/tariffs/{id}", h.DeleteTariff)
		r.With(writeLimit).Post("/simulate", h.SimulateTariffs)
	})

	r.Route("/charging-reconciliation", func(r chi.Router) {
		r.Get("/invoices", h.ListInvoices)
		r.With(writeLimit).Post("/invoices", h.CreateInvoice)
		r.With(writeLimit).Delete("/invoices/{id}", h.DeleteInvoice)
		r.Get("/invoices/{id}/report", h.ReconcileInvoice)
		r.With(writeLimit).Post("/invoices/{id}/disputes", h.CreateDispute)
	})

	r.Route("/driver-attribution", func(r chi.Router) {
		r.Get("/", h.DriverAttribution)
		r.Get("/profiles", h.ListDriverProfiles)
		r.With(writeLimit).Post("/profiles", h.CreateDriverProfile)
		r.With(writeLimit).Delete("/profiles/{id}", h.DeleteDriverProfile)
		r.With(writeLimit).Post("/assignments", h.AssignDrive)
	})

	r.Route("/warranty-command", func(r chi.Router) {
		r.Get("/", h.WarrantyOverview)
		r.Get("/warranties", h.ListWarranties)
		r.With(writeLimit).Post("/warranties", h.CreateWarranty)
		r.With(writeLimit).Delete("/warranties/{id}", h.DeleteWarranty)
		r.With(writeLimit).Post("/claims", h.CreateWarrantyClaim)
	})

	r.Route("/data-governance", func(r chi.Router) {
		r.Get("/", h.GovernanceOverview)
		r.With(writeLimit).Put("/policies", h.UpsertRetentionPolicy)
		r.With(writeLimit).Delete("/policies/{id}", h.DeleteRetentionPolicy)
		r.With(writeLimit).Post("/simulate", h.SimulateGovernance)
		r.Get("/runs", h.ListRetentionRuns)
	})

	r.Route("/model-trust", func(r chi.Router) {
		r.Get("/", h.ModelTrust)
		r.With(writeLimit).Post("/predictions", h.RecordPrediction)
		r.With(writeLimit).Post("/outcomes", h.RecordOutcome)
	})

	r.Route("/jurisdiction-compliance", func(r chi.Router) {
		r.Get("/", h.ComplianceApportionment)
		r.Get("/rates", h.ListJurisdictionRates)
		r.With(writeLimit).Post("/rates", h.CreateJurisdictionRate)
		r.With(writeLimit).Delete("/rates/{id}", h.DeleteJurisdictionRate)
		r.Get("/filings", h.ListFilings)
		r.With(writeLimit).Post("/filings", h.CreateFiling)
	})

	r.Route("/consumables-lifecycle", func(r chi.Router) {
		r.Get("/", h.ConsumablesReport)
		r.Get("/items", h.ListConsumables)
		r.With(writeLimit).Post("/items", h.CreateConsumable)
		r.With(writeLimit).Delete("/items/{id}", h.DeleteConsumable)
		r.With(writeLimit).Post("/events", h.CreateConsumableEvent)
	})

	r.Route("/subscription-roi", func(r chi.Router) {
		r.Get("/", h.SubscriptionROI)
		r.Get("/subscriptions", h.ListSubscriptions)
		r.With(writeLimit).Post("/subscriptions", h.CreateSubscription)
		r.With(writeLimit).Delete("/subscriptions/{id}", h.DeleteSubscription)
	})
}

var tracer = otel.Tracer("teslasync/handler/v1/ownershipintel")

// ---------------------------------------------------------------------------
// 1. Insurance telematics
// ---------------------------------------------------------------------------

func (h *Handler) InsuranceRiskProfile(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.InsuranceRiskProfile")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	windowDays, err := parseWindowDays(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID), attribute.Int("window_days", windowDays))
	response, err := h.service.InsuranceRiskProfile(ctx, subject, vehicleID, windowDays)
	if err != nil {
		h.handleError(w, span, "build insurance risk profile", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) UpsertInsurancePolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.UpsertInsurancePolicy")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.UpsertInsurancePolicyRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.UpsertInsurancePolicy(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "upsert insurance policy", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) DeleteInsurancePolicy(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteInsurancePolicy", "delete insurance policy", h.service.DeleteInsurancePolicy)
}

// ---------------------------------------------------------------------------
// 2. Tariff arbitrage lab
// ---------------------------------------------------------------------------

func (h *Handler) ListTariffs(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListTariffs")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	limit, offset, err := parsePaging(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.ListTariffs(ctx, subject, limit, offset)
	if err != nil {
		h.handleError(w, span, "list tariffs", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateTariff(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateTariff")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateTariffRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateTariff(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create tariff", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteTariff(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteTariff", "delete tariff", h.service.DeleteTariff)
}

func (h *Handler) SimulateTariffs(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.SimulateTariffs")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.TariffSimulationRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.SimulateTariffs(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "simulate tariffs", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

// ---------------------------------------------------------------------------
// 3. Charging invoice reconciliation
// ---------------------------------------------------------------------------

func (h *Handler) ListInvoices(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListInvoices")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.ListInvoices(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list charging invoices", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateInvoice(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateInvoice")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateInvoiceRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.CreateInvoice(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create charging invoice", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteInvoice(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteInvoice", "delete charging invoice", h.service.DeleteInvoice)
}

func (h *Handler) ReconcileInvoice(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ReconcileInvoice")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	id, err := parsePathID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("invoice_id", id))
	response, err := h.service.ReconcileInvoice(ctx, subject, id)
	if err != nil {
		h.handleError(w, span, "reconcile charging invoice", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateDispute(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateDispute")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	id, err := parsePathID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	var request domain.CreateDisputeRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("invoice_id", id))
	response, err := h.service.CreateDispute(ctx, subject, id, request)
	if err != nil {
		h.handleError(w, span, "create invoice dispute", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// ---------------------------------------------------------------------------
// 4. Driver attribution
// ---------------------------------------------------------------------------

func (h *Handler) DriverAttribution(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.DriverAttribution")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	windowDays, err := parseWindowDays(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID), attribute.Int("window_days", windowDays))
	response, err := h.service.DriverAttribution(ctx, subject, vehicleID, windowDays, limit, offset)
	if err != nil {
		h.handleError(w, span, "build driver attribution", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListDriverProfiles(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListDriverProfiles")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	items, err := h.service.ListDriverProfiles(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "list driver profiles", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateDriverProfile(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateDriverProfile")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateDriverProfileRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateDriverProfile(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create driver profile", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteDriverProfile(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteDriverProfile", "delete driver profile", h.service.DeleteDriverProfile)
}

func (h *Handler) AssignDrive(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.AssignDrive")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.AssignDriveRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("drive_id", request.DriveID))
	if err := h.service.AssignDrive(ctx, subject, request); err != nil {
		h.handleError(w, span, "assign drive to driver", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// 5. Warranty command
// ---------------------------------------------------------------------------

func (h *Handler) WarrantyOverview(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.WarrantyOverview")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.WarrantyOverview(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "build warranty overview", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListWarranties(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListWarranties")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	items, err := h.service.ListWarranties(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "list warranties", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateWarranty(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateWarranty")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateWarrantyRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateWarranty(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create warranty", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteWarranty(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteWarranty", "delete warranty", h.service.DeleteWarranty)
}

func (h *Handler) CreateWarrantyClaim(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateWarrantyClaim")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateClaimRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateWarrantyClaim(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create warranty claim", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// ---------------------------------------------------------------------------
// 6. Data governance
// ---------------------------------------------------------------------------

func (h *Handler) GovernanceOverview(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.GovernanceOverview")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	response, err := h.service.GovernanceOverview(ctx, subject)
	if err != nil {
		h.handleError(w, span, "build governance overview", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) UpsertRetentionPolicy(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.UpsertRetentionPolicy")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.UpsertRetentionPolicyRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.UpsertRetentionPolicy(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "upsert retention policy", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) DeleteRetentionPolicy(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteRetentionPolicy", "delete retention policy", h.service.DeleteRetentionPolicy)
}

func (h *Handler) SimulateGovernance(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.SimulateGovernance")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.GovernanceSimulationRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.SimulateGovernance(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "simulate retention governance", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListRetentionRuns(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListRetentionRuns")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	limit, offset, err := parsePaging(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.ListRetentionRuns(ctx, subject, limit, offset)
	if err != nil {
		h.handleError(w, span, "list retention runs", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

// ---------------------------------------------------------------------------
// 7. Model trust
// ---------------------------------------------------------------------------

func (h *Handler) ModelTrust(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ModelTrust")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	windowDays, err := parseWindowDays(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID), attribute.Int("window_days", windowDays))
	response, err := h.service.ModelTrust(ctx, subject, vehicleID, windowDays)
	if err != nil {
		h.handleError(w, span, "build model trust report", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) RecordPrediction(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.RecordPrediction")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.RecordPredictionRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.RecordPrediction(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "record prediction", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) RecordOutcome(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.RecordOutcome")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.RecordOutcomeRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.RecordOutcome(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "record prediction outcome", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

// ---------------------------------------------------------------------------
// 8. Jurisdictional compliance
// ---------------------------------------------------------------------------

func (h *Handler) ComplianceApportionment(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ComplianceApportionment")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	windowDays, err := parseWindowDays(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID), attribute.Int("window_days", windowDays))
	response, err := h.service.ComplianceApportionment(ctx, subject, vehicleID, windowDays)
	if err != nil {
		h.handleError(w, span, "build compliance apportionment", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListJurisdictionRates(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListJurisdictionRates")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	items, err := h.service.ListJurisdictionRates(ctx, subject)
	if err != nil {
		h.handleError(w, span, "list jurisdiction rates", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateJurisdictionRate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateJurisdictionRate")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateJurisdictionRateRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateJurisdictionRate(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create jurisdiction rate", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteJurisdictionRate(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteJurisdictionRate", "delete jurisdiction rate", h.service.DeleteJurisdictionRate)
}

func (h *Handler) ListFilings(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListFilings")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.ListFilings(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list compliance filings", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateFiling(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateFiling")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateFilingRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.CreateFiling(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create compliance filing", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// ---------------------------------------------------------------------------
// 9. Consumables lifecycle
// ---------------------------------------------------------------------------

func (h *Handler) ConsumablesReport(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ConsumablesReport")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.ConsumablesReport(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "build consumables report", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListConsumables(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListConsumables")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	items, err := h.service.ListConsumables(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "list consumable items", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateConsumable(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateConsumable")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateConsumableItemRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateConsumable(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create consumable item", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteConsumable(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteConsumable", "delete consumable item", h.service.DeleteConsumable)
}

func (h *Handler) CreateConsumableEvent(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateConsumableEvent")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateConsumableEventRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateConsumableEvent(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create consumable event", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// ---------------------------------------------------------------------------
// 10. Subscription ROI
// ---------------------------------------------------------------------------

func (h *Handler) SubscriptionROI(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.SubscriptionROI")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	windowDays, err := parseWindowDays(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID), attribute.Int("window_days", windowDays))
	response, err := h.service.SubscriptionROI(ctx, subject, vehicleID, windowDays)
	if err != nil {
		h.handleError(w, span, "build subscription roi report", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.ListSubscriptions")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	items, err := h.service.ListSubscriptions(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, "list subscriptions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateSubscription(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.CreateSubscription")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateSubscriptionRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	response, err := h.service.CreateSubscription(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create subscription", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) DeleteSubscription(w http.ResponseWriter, r *http.Request) {
	h.delete(w, r, "ownershipintel.DeleteSubscription", "delete subscription", h.service.DeleteSubscription)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// delete factors the identical shape shared by all eight delete endpoints.
func (h *Handler) delete(
	w http.ResponseWriter,
	r *http.Request,
	spanName, message string,
	remove func(context.Context, string, int64) error,
) {
	ctx, span := tracer.Start(r.Context(), spanName)
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	id, err := parsePathID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("record_id", id))
	if err := remove(ctx, subject, id); err != nil {
		h.handleError(w, span, message, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) subject(w http.ResponseWriter, r *http.Request, span trace.Span) (string, bool) {
	if subject, ok := tsauth.SubjectFromRequest(r, h.headerName); ok {
		return subject, true
	}
	if tsauth.IsOpenMode(h.headerName) {
		return openModeSubject, true
	}
	err := errors.New("configured identity header is missing")
	span.RecordError(err)
	span.SetStatus(codes.Error, "missing identity")
	writeError(w, http.StatusUnauthorized, tsauth.MissingIdentityCode, "missing identity header")
	return "", false
}

func (h *Handler) handleError(w http.ResponseWriter, span trace.Span, message string, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, message)
	switch {
	case errors.Is(err, ownershipintelsvc.ErrInvalidInput),
		errors.Is(err, ownershipintelsvc.ErrNotConfirmed):
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "record not found")
	case errors.Is(err, port.ErrConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "a record with the same identity already exists")
	default:
		traceID := span.SpanContext().TraceID().String()
		log.Error().Err(err).Str("trace_id", traceID).Msg(message)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "ownership intelligence request failed")
	}
}

func parseVehicleID(r *http.Request) (int64, error) {
	value := r.URL.Query().Get("vehicle_id")
	vehicleID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || vehicleID <= 0 {
		return 0, errors.New("vehicle_id must be a positive integer")
	}
	return vehicleID, nil
}

func parsePathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("id must be a positive integer")
	}
	return id, nil
}

func parseWindowDays(r *http.Request) (int, error) {
	return parseBoundedInt(r.URL.Query().Get("window_days"), defaultWindowDays, 1, 1825, "window_days")
}

func parsePaging(r *http.Request) (int, int, error) {
	limit, err := parseBoundedInt(r.URL.Query().Get("limit"), 25, 1, 200, "limit")
	if err != nil {
		return 0, 0, err
	}
	offset, err := parseBoundedInt(r.URL.Query().Get("offset"), 0, 0, 100000, "offset")
	if err != nil {
		return 0, 0, err
	}
	return limit, offset, nil
}

func parseListRequest(r *http.Request) (int64, int, int, error) {
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		return 0, 0, 0, err
	}
	limit, offset, err := parsePaging(r)
	if err != nil {
		return 0, 0, 0, err
	}
	return vehicleID, limit, offset, nil
}

func parseBoundedInt(value string, fallback, low, high int, name string) (int, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < low || parsed > high {
		return 0, errors.New(name + " is outside the allowed range")
	}
	return parsed, nil
}

func decodeBody(w http.ResponseWriter, r *http.Request, target interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON request body")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func validationError(w http.ResponseWriter, span trace.Span, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, "request validation failed")
	writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": message, "code": code})
}
