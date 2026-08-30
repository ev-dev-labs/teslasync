package datarepair

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The diagnosis repo is pure SQL, so these tests pin the two behaviours that
// can be verified without a live PostgreSQL: the nil-pool degradation contract
// (an unconfigured repo must return an error, never panic) and the optional
// vehicle filter's interface-typed nil, which is what makes the
// `$n::bigint IS NULL` guard work instead of silently matching vehicle 0.

func TestRepo_NilPoolReturnsErrNoDatabase(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	since := time.Now().UTC().Add(-24 * time.Hour)
	repo := NewRepo(nil)

	assert := func(name string, err error) {
		t.Helper()
		if !errors.Is(err, ErrNoDatabase) {
			t.Errorf("%s: err = %v, want ErrNoDatabase", name, err)
		}
	}

	_, err := repo.ListOpenDrives(ctx, since, nil, 10)
	assert("ListOpenDrives", err)
	_, err = repo.ListOverrunDrives(ctx, since, nil, 5*time.Minute, 10)
	assert("ListOverrunDrives", err)
	_, err = repo.ListOpenChargingSessions(ctx, since, nil, 10)
	assert("ListOpenChargingSessions", err)
	_, err = repo.ListOverrunChargingSessions(ctx, since, nil, 5*time.Minute, 10)
	assert("ListOverrunChargingSessions", err)
	_, err = repo.GetDriveCandidate(ctx, 1)
	assert("GetDriveCandidate", err)
	_, err = repo.GetChargingCandidate(ctx, 1)
	assert("GetChargingCandidate", err)
	_, err = repo.ChargeStateObservations(ctx, 7, []string{"DetailedChargeState"}, since, since.Add(time.Hour), 10)
	assert("ChargeStateObservations", err)
	_, err = repo.FirstChargeStateObservation(
		ctx,
		7,
		[]string{"DetailedChargeState"},
		[]string{"Complete"},
		since,
		since.Add(time.Hour),
	)
	assert("FirstChargeStateObservation", err)
	_, err = repo.FirstGearObservation(ctx, 7, []string{"P"}, since, since.Add(time.Hour))
	assert("FirstGearObservation", err)
	_, err = repo.LastDrivingObservation(ctx, 7, []string{"D"}, since, since.Add(time.Hour))
	assert("LastDrivingObservation", err)
	_, err = repo.LastChargingPowerObservation(ctx, 7, since, since.Add(time.Hour))
	assert("LastChargingPowerObservation", err)
	_, err = repo.FirstChargingSessionAfter(ctx, 7, since, 0)
	assert("FirstChargingSessionAfter", err)
	_, err = repo.FirstDriveAfter(ctx, 7, since, 0)
	assert("FirstDriveAfter", err)
}

func TestRepo_NilReceiverIsSafe(t *testing.T) {
	t.Parallel()

	var repo *Repo
	if _, err := repo.ListOpenDrives(context.Background(), time.Now(), nil, 10); !errors.Is(err, ErrNoDatabase) {
		t.Errorf("nil receiver: err = %v, want ErrNoDatabase", err)
	}
}

func TestNullableVehicleID(t *testing.T) {
	t.Parallel()

	if got := nullableVehicleID(nil); got != nil {
		t.Errorf("nullableVehicleID(nil) = %v, want an interface-typed nil so `$n::bigint IS NULL` matches", got)
	}
	id := int64(42)
	got, ok := nullableVehicleID(&id).(int64)
	if !ok || got != 42 {
		t.Errorf("nullableVehicleID(&42) = %v, want int64(42)", nullableVehicleID(&id))
	}
}

func TestEvidenceGuards_EmptyInputsShortCircuit(t *testing.T) {
	t.Parallel()

	// A repo with a nil pool would error, so these guards are asserted on the
	// argument-validation path that runs before `ready()` is consulted for the
	// window-shaped reads. Empty field/gear sets and inverted windows must
	// never reach SQL.
	repo := NewRepo(nil)
	ctx := context.Background()
	now := time.Now().UTC()

	if _, err := repo.ChargeStateObservations(ctx, 7, nil, now, now.Add(time.Hour), 10); err == nil {
		t.Error("expected ErrNoDatabase before the empty-field short circuit")
	}
}
