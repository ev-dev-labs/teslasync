package fleetops

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

var ErrValidation = errors.New("fleet operations validation failed")

type DomainError struct {
	Kind    error
	Message string
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Kind }

func validation(message string) error {
	return &DomainError{Kind: ErrValidation, Message: message}
}

type Store interface {
	ListDrivers(context.Context, dbfleetops.DriverFilter) ([]models.FleetDriver, int, error)
	GetDriver(context.Context, int64) (*models.FleetDriver, error)
	CreateDriver(context.Context, *models.FleetDriver) error
	UpdateDriver(context.Context, *models.FleetDriver) error
	DeleteDriver(context.Context, int64, int) error

	ListCostCenters(context.Context, dbfleetops.CostCenterFilter) ([]models.FleetCostCenter, int, error)
	GetCostCenter(context.Context, int64) (*models.FleetCostCenter, error)
	CreateCostCenter(context.Context, *models.FleetCostCenter) error
	UpdateCostCenter(context.Context, *models.FleetCostCenter) error
	DeleteCostCenter(context.Context, int64, int) error

	ListAssignments(context.Context, dbfleetops.AssignmentFilter) ([]models.FleetVehicleDriverAssignment, int, error)
	GetAssignment(context.Context, int64) (*models.FleetVehicleDriverAssignment, error)
	CreateAssignment(context.Context, *models.FleetVehicleDriverAssignment) error
	UpdateAssignment(context.Context, *models.FleetVehicleDriverAssignment) error
	DeleteAssignment(context.Context, int64, int) error

	ListReservations(context.Context, dbfleetops.ReservationFilter) ([]models.FleetReservation, int, error)
	GetReservation(context.Context, int64) (*models.FleetReservation, error)
	CreateReservation(context.Context, *models.FleetReservation) error
	UpdateReservation(context.Context, *models.FleetReservation) error
	DeleteReservation(context.Context, int64, int) error

	ListChargingPolicies(context.Context, dbfleetops.ChargingPolicyFilter) ([]models.FleetChargingPolicy, int, error)
	GetChargingPolicy(context.Context, int64) (*models.FleetChargingPolicy, error)
	CreateChargingPolicy(context.Context, *models.FleetChargingPolicy) error
	UpdateChargingPolicy(context.Context, *models.FleetChargingPolicy) error
	DeleteChargingPolicy(context.Context, int64, int) error

	ListWorkOrders(context.Context, dbfleetops.WorkOrderFilter) ([]models.FleetMaintenanceWorkOrder, int, error)
	GetWorkOrder(context.Context, int64) (*models.FleetMaintenanceWorkOrder, error)
	CreateWorkOrder(context.Context, *models.FleetMaintenanceWorkOrder) error
	UpdateWorkOrder(context.Context, *models.FleetMaintenanceWorkOrder) error
	DeleteWorkOrder(context.Context, int64, int) error

	LoadForecastInputs(context.Context, dbfleetops.ForecastFilter) (*dbfleetops.ForecastInputs, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: func() time.Time { return time.Now().UTC() }}
}

func validText(value string, minLen, maxLen int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(value))
	return n >= minLen && n <= maxLen
}

func normalizeOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func requireVersion(version int) error {
	if version <= 0 {
		return validation("version must be greater than zero")
	}
	return nil
}

func (s *Service) ListDrivers(ctx context.Context, f dbfleetops.DriverFilter) (*models.FleetPage[models.FleetDriver], error) {
	items, total, err := s.store.ListDrivers(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list drivers: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetDriver]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetDriver(ctx context.Context, id int64) (*models.FleetDriver, error) {
	if id <= 0 {
		return nil, validation("driver id must be greater than zero")
	}
	return s.store.GetDriver(ctx, id)
}

func validateDriver(item *models.FleetDriver) error {
	item.DisplayName = strings.TrimSpace(item.DisplayName)
	item.ReferenceCode = strings.TrimSpace(item.ReferenceCode)
	if !validText(item.DisplayName, 1, 120) {
		return validation("display_name must be between 1 and 120 characters")
	}
	if !validText(item.ReferenceCode, 1, 64) {
		return validation("reference_code must be between 1 and 64 characters")
	}
	if item.Status == "" {
		item.Status = "active"
	}
	if item.Status != "active" && item.Status != "inactive" {
		return validation("status must be active or inactive")
	}
	return nil
}

func (s *Service) CreateDriver(ctx context.Context, item *models.FleetDriver) error {
	if err := validateDriver(item); err != nil {
		return err
	}
	return s.store.CreateDriver(ctx, item)
}

func (s *Service) UpdateDriver(ctx context.Context, item *models.FleetDriver) error {
	if item.ID <= 0 {
		return validation("driver id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateDriver(item); err != nil {
		return err
	}
	return s.store.UpdateDriver(ctx, item)
}

func (s *Service) DeleteDriver(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteDriver)
}

func (s *Service) ListCostCenters(ctx context.Context, f dbfleetops.CostCenterFilter) (*models.FleetPage[models.FleetCostCenter], error) {
	items, total, err := s.store.ListCostCenters(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list cost centers: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetCostCenter]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetCostCenter(ctx context.Context, id int64) (*models.FleetCostCenter, error) {
	if id <= 0 {
		return nil, validation("cost center id must be greater than zero")
	}
	return s.store.GetCostCenter(ctx, id)
}

func validateCostCenter(item *models.FleetCostCenter) error {
	item.Code = strings.TrimSpace(item.Code)
	item.Name = strings.TrimSpace(item.Name)
	if !validText(item.Code, 1, 32) {
		return validation("code must be between 1 and 32 characters")
	}
	if !validText(item.Name, 1, 120) {
		return validation("name must be between 1 and 120 characters")
	}
	return nil
}

func (s *Service) CreateCostCenter(ctx context.Context, item *models.FleetCostCenter) error {
	if err := validateCostCenter(item); err != nil {
		return err
	}
	return s.store.CreateCostCenter(ctx, item)
}

func (s *Service) UpdateCostCenter(ctx context.Context, item *models.FleetCostCenter) error {
	if item.ID <= 0 {
		return validation("cost center id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateCostCenter(item); err != nil {
		return err
	}
	return s.store.UpdateCostCenter(ctx, item)
}

func (s *Service) DeleteCostCenter(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteCostCenter)
}

func (s *Service) ListAssignments(ctx context.Context, f dbfleetops.AssignmentFilter) (*models.FleetPage[models.FleetVehicleDriverAssignment], error) {
	items, total, err := s.store.ListAssignments(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list assignments: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetVehicleDriverAssignment]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetAssignment(ctx context.Context, id int64) (*models.FleetVehicleDriverAssignment, error) {
	if id <= 0 {
		return nil, validation("assignment id must be greater than zero")
	}
	return s.store.GetAssignment(ctx, id)
}

func validateAssignment(item *models.FleetVehicleDriverAssignment) error {
	if item.VehicleID <= 0 || item.DriverID <= 0 {
		return validation("vehicle_id and driver_id must be greater than zero")
	}
	if item.StartsAt.IsZero() {
		return validation("starts_at is required")
	}
	if item.EndsAt != nil && !item.EndsAt.After(item.StartsAt) {
		return validation("ends_at must be after starts_at")
	}
	item.StartsAt = item.StartsAt.UTC()
	if item.EndsAt != nil {
		end := item.EndsAt.UTC()
		item.EndsAt = &end
	}
	item.Notes = normalizeOptional(item.Notes)
	if item.Notes != nil && !validText(*item.Notes, 1, 500) {
		return validation("notes must be 500 characters or fewer")
	}
	return nil
}

func (s *Service) CreateAssignment(ctx context.Context, item *models.FleetVehicleDriverAssignment) error {
	if err := validateAssignment(item); err != nil {
		return err
	}
	return s.store.CreateAssignment(ctx, item)
}

func (s *Service) UpdateAssignment(ctx context.Context, item *models.FleetVehicleDriverAssignment) error {
	if item.ID <= 0 {
		return validation("assignment id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateAssignment(item); err != nil {
		return err
	}
	return s.store.UpdateAssignment(ctx, item)
}

func (s *Service) DeleteAssignment(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteAssignment)
}

func (s *Service) ListReservations(ctx context.Context, f dbfleetops.ReservationFilter) (*models.FleetPage[models.FleetReservation], error) {
	items, total, err := s.store.ListReservations(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list reservations: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetReservation]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetReservation(ctx context.Context, id int64) (*models.FleetReservation, error) {
	if id <= 0 {
		return nil, validation("reservation id must be greater than zero")
	}
	return s.store.GetReservation(ctx, id)
}

func validateReservation(item *models.FleetReservation) error {
	if item.VehicleID <= 0 {
		return validation("vehicle_id must be greater than zero")
	}
	if item.DriverID != nil && *item.DriverID <= 0 {
		return validation("driver_id must be greater than zero")
	}
	if item.CostCenterID != nil && *item.CostCenterID <= 0 {
		return validation("cost_center_id must be greater than zero")
	}
	item.Title = strings.TrimSpace(item.Title)
	if !validText(item.Title, 1, 160) {
		return validation("title must be between 1 and 160 characters")
	}
	item.Purpose = normalizeOptional(item.Purpose)
	if item.Purpose != nil && !validText(*item.Purpose, 1, 500) {
		return validation("purpose must be 500 characters or fewer")
	}
	if item.StartsAt.IsZero() || item.EndsAt.IsZero() || !item.EndsAt.After(item.StartsAt) {
		return validation("starts_at and ends_at must define a positive period")
	}
	item.StartsAt = item.StartsAt.UTC()
	item.EndsAt = item.EndsAt.UTC()
	if item.Status == "" {
		item.Status = "requested"
	}
	switch item.Status {
	case "requested", "confirmed", "cancelled", "completed":
	default:
		return validation("invalid reservation status")
	}
	return nil
}

func reservationTransitionAllowed(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "requested":
		return to == "confirmed" || to == "cancelled"
	case "confirmed":
		return to == "completed" || to == "cancelled"
	default:
		return false
	}
}

func (s *Service) CreateReservation(ctx context.Context, item *models.FleetReservation) error {
	if err := validateReservation(item); err != nil {
		return err
	}
	if item.Status == "completed" || item.Status == "cancelled" {
		return validation("new reservations must be requested or confirmed")
	}
	return s.store.CreateReservation(ctx, item)
}

func (s *Service) UpdateReservation(ctx context.Context, item *models.FleetReservation) error {
	if item.ID <= 0 {
		return validation("reservation id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateReservation(item); err != nil {
		return err
	}
	current, err := s.store.GetReservation(ctx, item.ID)
	if err != nil {
		return fmt.Errorf("load reservation lifecycle: %w", err)
	}
	if current == nil {
		return dbfleetops.ErrNotFound
	}
	if !reservationTransitionAllowed(current.Status, item.Status) {
		return validation("reservation status transition is not allowed")
	}
	return s.store.UpdateReservation(ctx, item)
}

func (s *Service) DeleteReservation(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteReservation)
}

func pageValues(limit, offset int) (int, int) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func (s *Service) delete(
	ctx context.Context,
	id int64,
	version int,
	fn func(context.Context, int64, int) error,
) error {
	if id <= 0 {
		return validation("id must be greater than zero")
	}
	if err := requireVersion(version); err != nil {
		return err
	}
	return fn(ctx, id, version)
}

func (s *Service) ListChargingPolicies(ctx context.Context, f dbfleetops.ChargingPolicyFilter) (*models.FleetPage[models.FleetChargingPolicy], error) {
	items, total, err := s.store.ListChargingPolicies(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list charging policies: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetChargingPolicy]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetChargingPolicy(ctx context.Context, id int64) (*models.FleetChargingPolicy, error) {
	if id <= 0 {
		return nil, validation("charging policy id must be greater than zero")
	}
	return s.store.GetChargingPolicy(ctx, id)
}

func validateChargingPolicy(item *models.FleetChargingPolicy) error {
	if item.VehicleID <= 0 {
		return validation("vehicle_id must be greater than zero")
	}
	item.Name = strings.TrimSpace(item.Name)
	if !validText(item.Name, 1, 120) {
		return validation("name must be between 1 and 120 characters")
	}
	if item.TargetSOCPct < 1 || item.TargetSOCPct > 100 {
		return validation("target_soc_pct must be between 1 and 100")
	}
	if item.MaxPowerW != nil && *item.MaxPowerW <= 0 {
		return validation("max_power_w must be greater than zero")
	}
	if item.Priority < 0 || item.Priority > 1000 {
		return validation("priority must be between 0 and 1000")
	}
	if item.EffectiveFrom.IsZero() {
		return validation("effective_from is required")
	}
	if item.EffectiveTo != nil && !item.EffectiveTo.After(item.EffectiveFrom) {
		return validation("effective_to must be after effective_from")
	}
	if len(item.Windows) == 0 {
		return validation("at least one allowed charging window is required")
	}
	item.EffectiveFrom = item.EffectiveFrom.UTC()
	if item.EffectiveTo != nil {
		end := item.EffectiveTo.UTC()
		item.EffectiveTo = &end
	}
	seen := make(map[string]struct{}, len(item.Windows))
	occupied := make(map[int16][][2]int)
	for i := range item.Windows {
		window := &item.Windows[i]
		if window.DayOfWeek < 0 || window.DayOfWeek > 6 {
			return validation("day_of_week must be between 0 and 6")
		}
		start, startErr := time.Parse("15:04", window.StartLocalTime)
		end, endErr := time.Parse("15:04", window.EndLocalTime)
		if startErr != nil || endErr != nil || end.Equal(start) {
			return validation("charging windows must use HH:MM and cannot span a full day")
		}
		key := fmt.Sprintf("%d/%s/%s", window.DayOfWeek, window.StartLocalTime, window.EndLocalTime)
		if _, ok := seen[key]; ok {
			return validation("charging windows must be unique")
		}
		seen[key] = struct{}{}
		startMinute := start.Hour()*60 + start.Minute()
		endMinute := end.Hour()*60 + end.Minute()
		segments := []struct {
			day          int16
			rangeMinutes [2]int
		}{{day: window.DayOfWeek, rangeMinutes: [2]int{startMinute, endMinute}}}
		if endMinute < startMinute {
			segments = []struct {
				day          int16
				rangeMinutes [2]int
			}{
				{day: window.DayOfWeek, rangeMinutes: [2]int{startMinute, 24 * 60}},
				{day: (window.DayOfWeek + 1) % 7, rangeMinutes: [2]int{0, endMinute}},
			}
		}
		for _, segment := range segments {
			for _, existing := range occupied[segment.day] {
				if segment.rangeMinutes[0] < existing[1] && segment.rangeMinutes[1] > existing[0] {
					return validation("charging windows must not overlap")
				}
			}
			occupied[segment.day] = append(occupied[segment.day], segment.rangeMinutes)
		}
	}
	return nil
}

func (s *Service) CreateChargingPolicy(ctx context.Context, item *models.FleetChargingPolicy) error {
	if err := validateChargingPolicy(item); err != nil {
		return err
	}
	return s.store.CreateChargingPolicy(ctx, item)
}

func (s *Service) UpdateChargingPolicy(ctx context.Context, item *models.FleetChargingPolicy) error {
	if item.ID <= 0 {
		return validation("charging policy id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateChargingPolicy(item); err != nil {
		return err
	}
	return s.store.UpdateChargingPolicy(ctx, item)
}

func (s *Service) DeleteChargingPolicy(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteChargingPolicy)
}

func (s *Service) ListWorkOrders(ctx context.Context, f dbfleetops.WorkOrderFilter) (*models.FleetPage[models.FleetMaintenanceWorkOrder], error) {
	items, total, err := s.store.ListWorkOrders(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list work orders: %w", err)
	}
	f.Limit, f.Offset = pageValues(f.Limit, f.Offset)
	return &models.FleetPage[models.FleetMaintenanceWorkOrder]{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

func (s *Service) GetWorkOrder(ctx context.Context, id int64) (*models.FleetMaintenanceWorkOrder, error) {
	if id <= 0 {
		return nil, validation("work order id must be greater than zero")
	}
	return s.store.GetWorkOrder(ctx, id)
}

func validateWorkOrder(item *models.FleetMaintenanceWorkOrder) error {
	if item.VehicleID <= 0 {
		return validation("vehicle_id must be greater than zero")
	}
	if item.CostCenterID != nil && *item.CostCenterID <= 0 {
		return validation("cost_center_id must be greater than zero")
	}
	item.Title = strings.TrimSpace(item.Title)
	if !validText(item.Title, 1, 160) {
		return validation("title must be between 1 and 160 characters")
	}
	item.Description = normalizeOptional(item.Description)
	if item.Description != nil && !validText(*item.Description, 1, 2000) {
		return validation("description must be 2000 characters or fewer")
	}
	if item.Status == "" {
		item.Status = "open"
	}
	switch item.Status {
	case "open", "scheduled", "in_progress", "completed", "cancelled":
	default:
		return validation("invalid work order status")
	}
	if item.Severity == "" {
		item.Severity = "medium"
	}
	switch item.Severity {
	case "low", "medium", "high", "critical":
	default:
		return validation("invalid work order severity")
	}
	if item.DueOdometerM != nil && *item.DueOdometerM < 0 {
		return validation("due_odometer_m cannot be negative")
	}
	if item.ScheduledEndAt != nil &&
		(item.ScheduledStartAt == nil || !item.ScheduledEndAt.After(*item.ScheduledStartAt)) {
		return validation("scheduled_end_at requires an earlier scheduled_start_at")
	}
	if (item.CostMinor == nil) != (item.Currency == nil) {
		return validation("cost_minor and currency must be supplied together")
	}
	if item.CostMinor != nil && *item.CostMinor < 0 {
		return validation("cost_minor cannot be negative")
	}
	if item.Currency != nil {
		currency := strings.ToUpper(strings.TrimSpace(*item.Currency))
		if len(currency) != 3 ||
			currency[0] < 'A' || currency[0] > 'Z' ||
			currency[1] < 'A' || currency[1] > 'Z' ||
			currency[2] < 'A' || currency[2] > 'Z' {
			return validation("currency must be a three-letter ISO code")
		}
		item.Currency = &currency
	}
	return nil
}

func workOrderTransitionAllowed(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "open":
		return to == "scheduled" || to == "in_progress" || to == "cancelled"
	case "scheduled":
		return to == "open" || to == "in_progress" || to == "cancelled"
	case "in_progress":
		return to == "completed" || to == "cancelled"
	default:
		return false
	}
}

func (s *Service) CreateWorkOrder(ctx context.Context, item *models.FleetMaintenanceWorkOrder) error {
	if err := validateWorkOrder(item); err != nil {
		return err
	}
	if item.Status == "completed" || item.Status == "cancelled" {
		return validation("new work orders must be open, scheduled, or in_progress")
	}
	return s.store.CreateWorkOrder(ctx, item)
}

func (s *Service) UpdateWorkOrder(ctx context.Context, item *models.FleetMaintenanceWorkOrder) error {
	if item.ID <= 0 {
		return validation("work order id must be greater than zero")
	}
	if err := requireVersion(item.Version); err != nil {
		return err
	}
	if err := validateWorkOrder(item); err != nil {
		return err
	}
	current, err := s.store.GetWorkOrder(ctx, item.ID)
	if err != nil {
		return fmt.Errorf("load work order lifecycle: %w", err)
	}
	if current == nil {
		return dbfleetops.ErrNotFound
	}
	if !workOrderTransitionAllowed(current.Status, item.Status) {
		return validation("work order status transition is not allowed")
	}
	return s.store.UpdateWorkOrder(ctx, item)
}

func (s *Service) DeleteWorkOrder(ctx context.Context, id int64, version int) error {
	return s.delete(ctx, id, version, s.store.DeleteWorkOrder)
}
