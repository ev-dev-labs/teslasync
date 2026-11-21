package smartreadinesssvc

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const serviceCaseLookback = 14 * 24 * time.Hour

type ServiceCases struct {
	repo port.ServiceCaseRepository
	now  func() time.Time
}

func NewServiceCases(repo port.ServiceCaseRepository, now func() time.Time) *ServiceCases {
	if now == nil {
		now = time.Now
	}
	return &ServiceCases{repo: repo, now: now}
}

func (s *ServiceCases) Read(ctx context.Context, scope port.ServiceCaseScope) (domain.ServiceCase, error) {
	if !serviceCaseScopeValid(scope) {
		return domain.ServiceCase{}, port.ErrNotFound
	}
	return s.repo.ReadServiceCase(ctx, scope)
}

func (s *ServiceCases) SaveTitle(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, title string) error {
	if !serviceCaseScopeValid(scope) {
		return port.ErrNotFound
	}
	title, valid := validateServiceCaseTitle(title)
	if !valid || (!validServiceCaseKey(key) && (key.ID != 0 || key.Version != 0)) {
		return ErrInvalidInput
	}
	return s.repo.SaveServiceCaseTitle(ctx, scope, key, title, s.now().UTC())
}

func (s *ServiceCases) Delete(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey) error {
	if !serviceCaseScopeValid(scope) {
		return port.ErrNotFound
	}
	if !validServiceCaseKey(key) {
		return ErrInvalidInput
	}
	return s.repo.DeleteServiceCase(ctx, scope, key)
}

func (s *ServiceCases) AddEvidence(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, entry domain.ServiceCaseEvidence) error {
	current, err := s.current(ctx, scope, key)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	entry, valid := validateServiceCaseEvidence(entry, current.OpenedAt, now)
	if !valid {
		return ErrInvalidInput
	}
	return s.repo.AppendServiceCaseEvidence(ctx, scope, key, entry, now)
}

func (s *ServiceCases) RemoveEvidence(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, evidenceID int64) error {
	if !serviceCaseScopeValid(scope) {
		return port.ErrNotFound
	}
	if !validServiceCaseKey(key) || evidenceID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteServiceCaseEvidence(ctx, scope, key, evidenceID, s.now().UTC())
}

func (s *ServiceCases) Preview(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, picks []domain.ServiceCaseSelection) (domain.ServiceCasePreview, error) {
	current, err := s.current(ctx, scope, key)
	if err != nil {
		return domain.ServiceCasePreview{}, err
	}
	return buildServiceCasePreview(current, picks)
}

func (s *ServiceCases) List(ctx context.Context, subject string, vehicleID *int64, since time.Time, limit int) ([]port.ServiceCaseCandidate, error) {
	if !validServiceCaseRecipient(subject) || limit <= 0 {
		return nil, nil
	}
	return s.repo.ListServiceCaseCandidates(ctx, subject, vehicleID, since, min(limit, 50))
}

func (s *ServiceCases) current(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey) (domain.ServiceCase, error) {
	if !validServiceCaseKey(key) {
		return domain.ServiceCase{}, ErrInvalidInput
	}
	current, err := s.Read(ctx, scope)
	if err != nil {
		return domain.ServiceCase{}, err
	}
	if current.ID != key.ID || current.Version != key.Version {
		return domain.ServiceCase{}, port.ErrServiceCaseChanged
	}
	return current, nil
}

func serviceCaseScopeValid(scope port.ServiceCaseScope) bool {
	return scope.VehicleID > 0 && validServiceCaseRecipient(scope.Subject)
}

func validServiceCaseRecipient(subject string) bool {
	return subject != "open-mode" && privatePlanningSubject(subject)
}

func validServiceCaseKey(key port.ServiceCaseKey) bool {
	return key.ID > 0 && key.Version > 0
}

func validateServiceCaseTitle(title string) (string, bool) {
	value := strings.TrimSpace(title)
	return value, validServiceCaseText(value, 120, false)
}

func validateServiceCaseEvidence(entry domain.ServiceCaseEvidence, openedAt, now time.Time) (domain.ServiceCaseEvidence, bool) {
	entry.ID = 0
	entry.Detail = strings.TrimSpace(strings.ReplaceAll(entry.Detail, "\r\n", "\n"))
	entry.ObservedAt = entry.ObservedAt.UTC()
	if entry.ObservedAt.IsZero() || entry.ObservedAt.Before(openedAt.Add(-serviceCaseLookback)) ||
		entry.ObservedAt.After(now) || !validServiceCaseText(entry.Detail, 600, true) {
		return entry, false
	}
	switch entry.Kind {
	case domain.ServiceCaseWarning, domain.ServiceCaseCondition, domain.ServiceCaseFirmware, domain.ServiceCaseWork:
		return entry, true
	default:
		return entry, false
	}
}

func validServiceCaseText(value string, maxLength int, allowNewlines bool) bool {
	return value != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= maxLength &&
		!strings.ContainsFunc(value, func(r rune) bool { return unicode.IsControl(r) && !(allowNewlines && r == '\n') })
}

func buildServiceCasePreview(current domain.ServiceCase, selection []domain.ServiceCaseSelection) (domain.ServiceCasePreview, error) {
	var empty domain.ServiceCasePreview
	if current.ID <= 0 || len(selection) == 0 || len(selection) > domain.MaxServiceCaseEvidence {
		return empty, ErrInvalidInput
	}
	picks := make(map[int64]domain.ServiceCaseSelection, len(selection))
	for _, row := range selection {
		if row.ID <= 0 || (!row.IncludeDetail && !row.IncludeTime) {
			return empty, ErrInvalidInput
		}
		if _, repeated := picks[row.ID]; repeated {
			return empty, ErrInvalidInput
		}
		picks[row.ID] = row
	}
	entries := slices.Clone(current.Evidence)
	slices.SortStableFunc(entries, func(a, b domain.ServiceCaseEvidence) int {
		return a.ObservedAt.Compare(b.ObservedAt)
	})
	selected := make([]domain.ServiceCasePreviewItem, 0, len(selection))
	for _, row := range entries {
		pick, chosen := picks[row.ID]
		if !chosen {
			continue
		}
		item := domain.ServiceCasePreviewItem{Kind: row.Kind}
		if pick.IncludeDetail {
			item.Detail = &row.Detail
		}
		if pick.IncludeTime {
			item.ObservedAt = &row.ObservedAt
		}
		selected = append(selected, item)
	}
	if len(selected) != len(selection) {
		return empty, ErrInvalidInput
	}
	return domain.ServiceCasePreview{Format: "service_case_evidence_v1", Provenance: "user_recorded", Evidence: selected}, nil
}
