package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	backupWatchDuration   = 60 * time.Minute
	backupPollInterval    = time.Minute
	backupMinimumDuration = 30 * time.Second
)

type BackupEnergyReader interface {
	ReadBackupSite(ctx context.Context, subject string, siteID int64) (domain.BackupSiteReading, error)
}

type BackupCharging struct {
	repo       port.BackupChargingRepository
	live       LiveSignals
	sites      ChargingSites
	configured bool
	energy     BackupEnergyReader
	now        func() time.Time
}

func NewBackupCharging(repo port.BackupChargingRepository, live LiveSignals, sites ChargingSites, configured bool,
	energy BackupEnergyReader, now func() time.Time,
) *BackupCharging {
	return &BackupCharging{repo: repo, live: live, sites: sites, configured: configured, energy: energy, now: now}
}

func (s *BackupCharging) StartBackupWatch(ctx context.Context, subject string, w domain.BackupChargingWatch,
	circuitConfirmed, utilityOutageConfirmed bool,
) error {
	if !backupSubject(subject, w.VehicleID) || w.PlaceID <= 0 || w.PlaceUpdatedAt.IsZero() ||
		w.DeviceID <= 0 || w.DeviceUpdatedAt.IsZero() || w.ConnectionID <= 0 || !circuitConfirmed || !utilityOutageConfirmed {
		return ErrInvalidInput
	}
	if !s.configured {
		return ErrSolarChargingUnavailable
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	w.Subject, w.ConsentedAt, w.WatchUntil = subject, now, now.Add(backupWatchDuration)
	return s.repo.CreateBackupChargingWatch(ctx, w)
}

func (s *BackupCharging) StopBackupWatch(ctx context.Context, subject string, vehicleID, watchID int64) error {
	if !backupSubject(subject, vehicleID) || watchID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteBackupChargingWatch(ctx, subject, vehicleID, watchID)
}

func (s *BackupCharging) BackupSettings(ctx context.Context, subject string, vehicleID int64) (domain.BackupChargingSettings, error) {
	var settings domain.BackupChargingSettings
	if !backupSubject(subject, vehicleID) {
		return settings, ErrInvalidInput
	}
	watch, err := s.repo.FindBackupChargingWatch(ctx, subject, vehicleID)
	settings.Watch = watch
	if err != nil || !s.configured {
		return settings, err
	}
	connection, err := s.repo.FindBackupConnectionID(ctx, subject)
	settings.ConnectionRevision, settings.Connected = connection, connection > 0
	if err != nil || connection == 0 || watch == nil {
		return settings, err
	}
	active, err := s.repo.FindActiveBackupChargingWatch(ctx, subject, vehicleID, s.now().UTC())
	if err != nil || active == nil || active.ID != watch.ID {
		return settings, err
	}
	settings.Active = true
	settings.Decision, err = s.BackupDecision(ctx, subject, vehicleID)
	return settings, err
}

func (s *BackupCharging) ListBackupDecisions(ctx context.Context, subject string, vehicleID *int64, limit int) ([]domain.BackupChargingDecision, error) {
	if !backupSubject(subject, 1) || !s.configured || limit <= 0 {
		return nil, nil
	}
	ids, err := s.repo.ListQualifiedBackupWatchVehicles(ctx, subject, vehicleID, s.now().UTC(), min(limit, 16))
	if err != nil {
		return nil, err
	}
	out := make([]domain.BackupChargingDecision, 0, len(ids))
	for _, id := range ids {
		decision, err := s.BackupDecision(ctx, subject, id)
		if err != nil {
			return nil, err
		}
		if decision != nil {
			out = append(out, *decision)
		}
	}
	return out, nil
}

func (s *BackupCharging) BackupDecision(ctx context.Context, subject string, vehicleID int64) (*domain.BackupChargingDecision, error) {
	if !backupSubject(subject, vehicleID) || !s.configured {
		return nil, nil
	}
	now := s.now().UTC()
	watch, err := s.repo.FindActiveBackupChargingWatch(ctx, subject, vehicleID, now)
	if err != nil || watch == nil || watch.Sample == nil || watch.QualifiedFrom == nil ||
		watch.Sample.ObservedAt.Sub(*watch.QualifiedFrom) < backupMinimumDuration || !now.Before(watch.Sample.ExpiresAt) {
		return nil, err
	}
	values, err := s.live.GetAll(ctx, watch.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("read distributed backup charging signals: %w", err)
	}
	matches, placeErr := s.backupPlace(ctx, watch.PlaceID)
	watts, powerAt, liveUntil, charging := backupChargingVehicle(values, now, matches)
	if !charging || math.Abs(watts-watch.Sample.VehiclePowerW) > backupMeterTolerance ||
		powerAt.Before(watch.Sample.VehiclePowerAt) {
		return nil, *placeErr
	}
	current, err := s.repo.FindActiveBackupChargingWatch(ctx, subject, vehicleID, s.now().UTC())
	if err != nil || current == nil || current.ID != watch.ID || !current.ConsentedAt.Equal(watch.ConsentedAt) ||
		current.Sample == nil || *current.Sample != *watch.Sample {
		return nil, err
	}
	sample := *watch.Sample
	sample.ExpiresAt = minTime(sample.ExpiresAt, minTime(watch.WatchUntil, liveUntil))
	if !s.now().UTC().Before(sample.ExpiresAt) {
		return nil, nil
	}
	return &domain.BackupChargingDecision{Watch: *watch, Sample: sample}, nil
}

func (s *BackupCharging) ProcessBackupCharging(ctx context.Context, limit int,
	notify func(context.Context, domain.BackupChargingDecision) error,
) (int, error) {
	if s.energy == nil || !s.configured || limit <= 0 {
		return 0, nil
	}
	now := s.now().UTC()
	watches, err := s.repo.ClaimBackupChargingWatches(ctx, now, now.Add(backupPollInterval), min(limit, 3))
	if err != nil {
		return 0, err
	}
	var result error
	for _, watch := range watches {
		result = errors.Join(result, s.checkBackup(ctx, watch, notify))
		if ctx.Err() != nil {
			break
		}
	}
	return len(watches), result
}

func (s *BackupCharging) checkBackup(ctx context.Context, watch domain.BackupChargingWatch,
	notify func(context.Context, domain.BackupChargingDecision) error,
) error {
	clear := func() error {
		_, err := s.repo.RecordBackupChargingCheck(ctx, watch, domain.BackupSiteReading{}, nil, s.now().UTC())
		return err
	}
	values, err := s.live.GetAll(ctx, watch.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return errors.Join(err, clear())
	}
	match, placeErr := s.backupPlace(ctx, watch.PlaceID)
	if _, _, _, eligible := backupChargingVehicle(values, s.now().UTC(), match); !eligible {
		return errors.Join(*placeErr, clear())
	}
	active, err := s.repo.FindActiveBackupChargingWatch(ctx, watch.Subject, watch.VehicleID, s.now().UTC())
	if err != nil || active == nil || active.ID != watch.ID || !active.ConsentedAt.Equal(watch.ConsentedAt) ||
		!active.NextCheckAt.Equal(watch.NextCheckAt) {
		return err
	}
	pollCtx, cancel := context.WithTimeout(ctx, solarProviderLimit)
	reading, readErr := s.energy.ReadBackupSite(pollCtx, watch.Subject, watch.EnergySiteID)
	cancel()
	now := s.now().UTC()
	if readErr != nil || reading.SiteID != watch.EnergySiteID || reading.ObservedAt.Before(watch.OutageStart) ||
		reading.ObservedAt.After(now) || !now.Before(reading.ObservedAt.Add(backupReadingMaxAge)) {
		return errors.Join(readErr, clear())
	}
	sample := evaluateBackupChargingSample(reading, values, now, match)
	if *placeErr != nil {
		return errors.Join(*placeErr, clear())
	}
	updated, err := s.repo.RecordBackupChargingCheck(ctx, watch, reading, sample, now)
	if err != nil || !updated || sample == nil || notify == nil {
		return err
	}
	decision, err := s.BackupDecision(ctx, watch.Subject, watch.VehicleID)
	if err != nil || decision == nil {
		return err
	}
	return notify(ctx, *decision)
}

func (s *BackupCharging) backupPlace(ctx context.Context, placeID int64) (func(float64, float64) bool, *error) {
	var err error
	return func(lat, lon float64) bool {
		var ok bool
		ok, err = s.sites.Contains(ctx, placeID, lat, lon)
		return ok && err == nil
	}, &err
}

func backupSubject(subject string, vehicleID int64) bool {
	return subject != personal.OpenSubject && validateScope(subject, vehicleID) == nil
}
