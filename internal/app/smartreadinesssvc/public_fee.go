package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"golang.org/x/text/currency"
)

var ErrPublicFeeUnavailable = errors.New("public charging fee review is unavailable")

func WithPublicFees(repository port.PublicFeeRepository) Option {
	return func(s *Service) { s.publicFees = repository }
}

func (s *Service) PublicFeeTerms(ctx context.Context, subject string, vehicleID int64) (*domain.PublicFeeTerms, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, err
	}
	if s.publicFees == nil {
		return nil, ErrPublicFeeUnavailable
	}
	return s.publicFees.FindPublicFeeTerms(ctx, subject, vehicleID, s.now().UTC())
}

func (s *Service) PublicFeeSettings(ctx context.Context, subject string, vehicleID int64) (domain.PublicFeeSettings, error) {
	terms, err := s.PublicFeeTerms(ctx, subject, vehicleID)
	settings := domain.PublicFeeSettings{Terms: terms}
	if err == nil && terms == nil {
		settings.NeedsReview, err = s.publicFees.HasPublicFeeTerms(ctx, subject, vehicleID)
	}
	return settings, err
}

func (s *Service) SetPublicFeeTerms(ctx context.Context, subject string, terms domain.PublicFeeTerms) error {
	now := s.now().UTC().Truncate(time.Microsecond)
	terms.Subject, terms.ConfirmedAt = subject, now
	terms.PlaceUpdatedAt = terms.PlaceUpdatedAt.UTC()
	terms.ValidUntil = terms.ValidUntil.UTC().Truncate(time.Microsecond)
	terms.SourceURL = strings.TrimSpace(terms.SourceURL)
	terms.PushTitle, terms.PushBody = strings.TrimSpace(terms.PushTitle), strings.TrimSpace(terms.PushBody)
	if !validPublicFeeTerms(terms, now) || !validPublicFeeDelivery(terms) {
		return ErrInvalidInput
	}
	if s.publicFees == nil {
		return ErrPublicFeeUnavailable
	}
	return s.publicFees.SavePublicFeeTerms(ctx, terms)
}

func (s *Service) RevokePublicFeeTerms(ctx context.Context, subject string, vehicleID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if s.publicFees == nil {
		return ErrPublicFeeUnavailable
	}
	return s.publicFees.DeletePublicFeeTerms(ctx, subject, vehicleID)
}

func (s *Service) FindPublicFeeDecision(ctx context.Context, subject string, vehicleID int64) (*domain.PublicFeeDecision, error) {
	terms, err := s.PublicFeeTerms(ctx, subject, vehicleID)
	if err != nil || terms == nil {
		return nil, err
	}
	now := s.now().UTC()
	completion, err := s.publicFees.FindPublicChargeCompletion(ctx, *terms, now)
	if err != nil || completion == nil {
		return nil, err
	}
	values, err := s.live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("read distributed public charge signals: %w", err)
	}
	var siteErr error
	decision := EvaluatePublicFee(*terms, *completion, values, s.now().UTC(), func(lat, lon float64) bool {
		var contains bool
		contains, siteErr = s.sites.Contains(ctx, terms.PlaceID, lat, lon)
		return contains
	})
	if siteErr != nil || decision == nil {
		return nil, siteErr
	}
	current, err := s.PublicFeeTerms(ctx, subject, vehicleID)
	if err != nil || current == nil || !current.ConfirmedAt.Equal(terms.ConfirmedAt) ||
		!current.PlaceUpdatedAt.Equal(terms.PlaceUpdatedAt) || !s.now().UTC().Before(decision.ExpiresAt) {
		return nil, err
	}
	decision.Terms = *current
	return decision, nil
}

func (s *Service) ProcessPublicFees(
	ctx context.Context, limit int, notify func(context.Context, domain.PublicFeeDecision) error,
) (int, error) {
	if s.publicFees == nil || limit <= 0 || notify == nil {
		return 0, nil
	}
	rows, err := s.publicFees.ListDuePublicFeeRecipients(ctx, s.now().UTC(), min(50, limit))
	if err != nil {
		return 0, err
	}
	result := s.publicFees.PrunePublicFeeDeliveries(ctx, s.now().UTC())
	eligible := 0
	for _, row := range rows {
		decision, err := s.FindPublicFeeDecision(ctx, row.Subject, row.VehicleID)
		if err == nil && decision != nil && decision.Terms.PushDeviceID != nil {
			eligible++
			err = notify(ctx, *decision)
		}
		result = errors.Join(result, err)
		if ctx.Err() != nil {
			return eligible, errors.Join(result, ctx.Err())
		}
	}
	return eligible, result
}

func validPublicFeeDelivery(terms domain.PublicFeeTerms) bool {
	if terms.PushDeviceID == nil {
		return terms.PushTitle == "" && terms.PushBody == ""
	}
	validText := func(text string) bool {
		return text != "" && utf8.RuneCountInString(text) <= 200 && !strings.ContainsFunc(text, unicode.IsControl)
	}
	return *terms.PushDeviceID > 0 && validText(terms.PushTitle) && validText(terms.PushBody)
}

const (
	publicFeeMinActionTime = time.Minute
	publicFeeMaxReviewAge  = 30 * 24 * time.Hour
	publicFeeMaxChargeGap  = 3 * time.Minute
)

// EvaluatePublicFee accepts only site-specific terms confirmed to apply after
// completion while connected, not tariffs conditional on station occupancy.
func EvaluatePublicFee(
	terms domain.PublicFeeTerms, completion domain.PublicChargeCompletion, values map[string]*signal.Value,
	now time.Time, atReviewedSite func(float64, float64) bool,
) *domain.PublicFeeDecision {
	if !validPublicFeeTerms(terms, now) || completion.SessionID <= 0 ||
		completion.VehicleID != terms.VehicleID || completion.PlaceID != terms.PlaceID ||
		completion.ChargingAt.Before(terms.ConfirmedAt) || !completion.CompletedAt.After(completion.ChargingAt) ||
		completion.CompletedAt.Sub(completion.ChargingAt) > publicFeeMaxChargeGap || completion.CompletedAt.After(now) {
		return nil
	}
	grace := time.Duration(terms.GraceS) * time.Second
	earliestFeeStarts := completion.ChargingAt.Add(grace)
	if !now.Add(publicFeeMinActionTime).Before(earliestFeeStarts) || completion.CompletedAt.Add(grace).After(terms.ValidUntil) {
		return nil
	}
	latitude, longitude, locationAt, locationOK := freshLocation(values, now)
	state, latch, gear := values["DetailedChargeState"], values["ChargePortLatch"], values["Gear"]
	if !locationOK || locationAt.Before(completion.CompletedAt) || (latitude == 0 && longitude == 0) ||
		atReviewedSite == nil || !atReviewedSite(latitude, longitude) ||
		!freshObservation(state, now) || state.Timestamp.Before(completion.CompletedAt) ||
		!freshObservation(latch, now) || latch.Timestamp.Before(completion.CompletedAt) ||
		!freshObservation(gear, now) || gear.Raw != enums.GearPark {
		return nil
	}
	rawState, stateOK := state.Raw.(string)
	rawLatch, latchOK := latch.Raw.(string)
	chargeState, stateErr := protomodel.ParseDetailedChargeStateValue(rawState)
	latchState, latchErr := protomodel.ParseChargePortLatchValue(rawLatch)
	if !stateOK || !latchOK || stateErr != nil || latchErr != nil ||
		chargeState != protomodel.DetailedChargeStateValue_DetailedChargeStateComplete ||
		latchState != protomodel.ChargePortLatchValue_ChargePortLatchEngaged {
		return nil
	}
	observedAt := locationAt
	for _, sample := range []*signal.Value{state, latch, gear} {
		if sample.Timestamp.Before(observedAt) {
			observedAt = sample.Timestamp
		}
	}
	expiresAt := observedAt.Add(signal.LiveSignalFreshnessThreshold)
	if lastAction := earliestFeeStarts.Add(-publicFeeMinActionTime); lastAction.Before(expiresAt) {
		expiresAt = lastAction
	}
	if !now.Before(expiresAt) {
		return nil
	}
	return &domain.PublicFeeDecision{
		Terms: terms, SessionID: completion.SessionID, CompletionObservedAt: completion.CompletedAt.UTC(),
		EarliestFeeStartsAt: earliestFeeStarts.UTC(),
		ObservedAt:          observedAt.UTC(), ExpiresAt: expiresAt.UTC(),
	}
}

func validPublicFeeTerms(terms domain.PublicFeeTerms, now time.Time) bool {
	if !terms.ConfirmedUnconditional || validateScope(terms.Subject, terms.VehicleID) != nil ||
		terms.PlaceID <= 0 || terms.PlaceUpdatedAt.IsZero() ||
		terms.GraceS < 120 || terms.GraceS > 3600 || terms.FeePerMinuteMinor <= 0 || terms.FeePerMinuteMinor > 100_000 ||
		terms.ConfirmedAt.IsZero() || terms.ConfirmedAt.After(now) || !now.Before(terms.ValidUntil) ||
		terms.ValidUntil.Sub(terms.ConfirmedAt) > publicFeeMaxReviewAge ||
		len(terms.Currency) != 3 || terms.Currency != strings.ToUpper(terms.Currency) || terms.Currency == "XXX" ||
		len(terms.SourceURL) > 1024 || strings.ContainsAny(terms.SourceURL, "?#") {
		return false
	}
	_, currencyErr := currency.ParseISO(terms.Currency)
	source, sourceErr := url.ParseRequestURI(terms.SourceURL)
	return currencyErr == nil && sourceErr == nil && source.Scheme == "https" && source.Hostname() != "" &&
		source.User == nil && source.RawQuery == "" && source.Fragment == ""
}
