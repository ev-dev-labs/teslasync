package smartcommutesvc

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

type navigation struct {
	repository port.NavigationRepository
	executor   port.NavigationExecutor
	permitted  func(context.Context) bool
}

var ErrNavigationUnavailable = errors.New("commute navigation command connection is unavailable")

func WithNavigation(repository port.NavigationRepository, executor port.NavigationExecutor, permitted func(context.Context) bool) Option {
	return func(s *Service) {
		if repository != nil && executor != nil && permitted != nil {
			s.navigation = &navigation{repository: repository, executor: executor, permitted: permitted}
		}
	}
}

func (s *Service) navigationAvailable(ctx context.Context, subject string) bool {
	return subject != personal.OpenSubject && s.trafficConfigured && s.traffic.live != nil &&
		s.navigation != nil && s.navigation.permitted(ctx)
}

func (s *Service) SendNavigation(
	ctx context.Context, subject string, routineID int64, request domain.NavigationRequest,
) (domain.NavigationResult, error) {
	if err := validateScope(subject, request.VehicleID); err != nil {
		return domain.NavigationResult{}, err
	}
	request.Address = strings.TrimSpace(request.Address)
	if routineID <= 0 || !validNavigationRequest(request) {
		return domain.NavigationResult{}, ErrInvalidInput
	}
	if !s.navigationAvailable(ctx, subject) {
		return domain.NavigationResult{}, ErrNavigationUnavailable
	}
	outcome, err := s.sendNavigation(ctx, port.NavigationScope{
		Subject: subject, VehicleID: request.VehicleID, RoutineID: routineID, OccurrenceID: request.OccurrenceID,
	}, request)
	return domain.NavigationResult{Outcome: outcome}, err
}

func validNavigationRequest(request domain.NavigationRequest) bool {
	if !request.Confirmed || request.Address == "" || len(request.Address) > 400 ||
		strings.ContainsFunc(request.Address, unicode.IsControl) || len(request.OccurrenceID) != 32 {
		return false
	}
	_, err := hex.DecodeString(request.OccurrenceID)
	return err == nil
}

func (s *Service) sendNavigation(
	ctx context.Context, scope port.NavigationScope, request domain.NavigationRequest,
) (domain.NavigationOutcome, error) {
	repo, executor := s.navigation.repository, s.navigation.executor
	occurrence, err := s.currentNavigation(ctx, scope)
	if err != nil {
		return navigationScopeOutcome(err)
	}
	if occurrence.Outcome != "" {
		return occurrence.Outcome, nil
	}
	remaining := occurrence.ExpiresAt.Sub(s.now())
	if remaining <= 0 {
		return domain.NavigationExpired, nil
	}
	ctx, cancel := context.WithTimeout(ctx, min(remaining, 50*time.Second))
	defer cancel()
	state := executor.Connectivity(ctx, occurrence.VIN)
	if err := s.verifyNavigationVehicle(ctx, scope, occurrence.VIN); err != nil {
		return navigationScopeOutcome(err)
	}
	switch state {
	case "asleep":
		if !request.WakeConfirmed {
			return domain.NavigationWakeRequired, nil
		}
	case "online":
		// The Fleet REST command has no documented guarantee against implicit wake.
		if !request.WakeConfirmed {
			return domain.NavigationWakePermission, nil
		}
	default:
		return domain.NavigationNotSent, nil
	}
	claimed, err := repo.ClaimNavigationAttempt(ctx, scope, s.now())
	if err != nil {
		return navigationScopeOutcome(err)
	}
	if !claimed {
		latest, err := repo.FindNavigationOccurrence(ctx, scope, s.now())
		if err != nil {
			return navigationScopeOutcome(err)
		}
		if latest.Outcome == "" {
			return domain.NavigationUnknown, nil
		}
		return latest.Outcome, nil
	}
	outcome, dispatchErr := s.dispatchNavigation(ctx, scope, occurrence.VIN, request.Address, state == "asleep")
	if s.navigationObserver != nil {
		s.navigationObserver(outcome)
	}
	writeCtx, stopWrite := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer stopWrite()
	if err := repo.FinishNavigationAttempt(writeCtx, scope, occurrence.DepartureAt, outcome); err != nil {
		return domain.NavigationUnknown, err
	}
	return outcome, dispatchErr
}

func WithNavigationObserver(observe func(domain.NavigationOutcome)) Option {
	return func(s *Service) { s.navigationObserver = observe }
}

func navigationScopeOutcome(err error) (domain.NavigationOutcome, error) {
	if errors.Is(err, port.ErrNotFound) {
		return domain.NavigationExpired, nil
	}
	return domain.NavigationNotSent, err
}

func (s *Service) currentNavigation(ctx context.Context, scope port.NavigationScope) (*port.NavigationOccurrence, error) {
	if !s.navigationAvailable(ctx, scope.Subject) {
		return nil, port.ErrNotFound
	}
	occurrence, err := s.navigation.repository.FindNavigationOccurrence(ctx, scope, s.now())
	if err != nil {
		return nil, err
	}
	parked, err := s.parkedAtOrigin(ctx, scope.VehicleID, occurrence.Origin, s.now())
	if err != nil {
		return nil, err
	}
	if !parked || !s.navigationAvailable(ctx, scope.Subject) {
		return nil, port.ErrNotFound
	}
	// Authorization or the occurrence may have changed during the live read.
	current, err := s.navigation.repository.FindNavigationOccurrence(ctx, scope, s.now())
	if err != nil {
		return nil, err
	}
	if current.VIN != occurrence.VIN || current.Origin != occurrence.Origin {
		return nil, port.ErrNotFound
	}
	return current, nil
}

func (s *Service) dispatchNavigation(
	ctx context.Context, scope port.NavigationScope, vin, address string, wake bool,
) (domain.NavigationOutcome, error) {
	var admissionErr error
	authorize := func(ctx context.Context) error {
		admissionErr = s.verifyNavigationVehicle(ctx, scope, vin)
		return admissionErr
	}
	if wake {
		state, outcome := s.navigation.executor.Wake(ctx, vin, authorize)
		switch {
		case admissionErr != nil:
			return navigationScopeOutcome(admissionErr)
		case outcome != domain.NavigationAccepted:
			return domain.NavigationNotSent, nil
		}
		online, err := s.waitNavigationOnline(ctx, scope, vin, state)
		if err != nil {
			return navigationScopeOutcome(err)
		}
		if !online {
			return domain.NavigationNotSent, nil
		}
	}
	outcome := s.navigation.executor.Send(ctx, vin, address, authorize)
	if admissionErr != nil {
		return navigationScopeOutcome(admissionErr)
	}
	return outcome, nil
}

func (s *Service) verifyNavigationVehicle(ctx context.Context, scope port.NavigationScope, vin string) error {
	current, err := s.currentNavigation(ctx, scope)
	if err != nil {
		return err
	}
	if current.VIN != vin {
		return port.ErrNotFound
	}
	return nil
}

func (s *Service) waitNavigationOnline(
	ctx context.Context, scope port.NavigationScope, vin, state string,
) (bool, error) {
	for _, delay := range []time.Duration{2, 5, 10, 15} {
		if state != "asleep" {
			break
		}
		timer := time.NewTimer(delay * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, nil
		case <-timer.C:
		}
		if err := s.verifyNavigationVehicle(ctx, scope, vin); err != nil {
			return false, fmt.Errorf("recheck navigation after wake: %w", err)
		}
		state = s.navigation.executor.Connectivity(ctx, vin)
	}
	return state == "online", nil
}
