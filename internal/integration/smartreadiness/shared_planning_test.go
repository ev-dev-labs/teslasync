package smartreadiness_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"golang.org/x/sync/errgroup"
)

func TestSharedChargerPersistsOnePrivateSwap(t *testing.T) {
	repo, db := testRepository(t)
	applyWarrantyFixtureMigration(t, db, "000316_smart_shared_charger.up")
	ctx := t.Context()
	start := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	now := start
	if _, err := db.Pool.Exec(ctx, `INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic second vehicle')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofences SET updated_at=$1 WHERE id=9`, start); err != nil {
		t.Fatal(err)
	}
	operators := auth.NewOperatorAccess("X-Test-Subject", "synthetic-operator,synthetic-peer-operator")
	service := smartreadinesssvc.NewSharedChargerService(repo, func(ctx context.Context, subject string) (bool, error) {
		return operators.Allows(ctx, subject), nil
	}, func() time.Time { return now })
	authz := domain.SharedChargerAuthorization{
		PlaceID: 9, PlaceUpdatedAt: start, ExpiresAt: start.Add(3 * time.Hour), ReminderVehicleID: 8,
		Participants: [2]domain.SharedChargerParticipant{
			{VehicleID: 7, Subject: "synthetic-plugged"}, {VehicleID: 8, Subject: "synthetic-arriving"},
		},
	}
	if _, err := service.Authorize(ctx, "synthetic-plugged", domain.SharedChargerRef{}, authz); !errors.Is(err, smartreadinesssvc.ErrSharedChargerOperatorRequired) {
		t.Fatalf("participant authorized a plan: %v", err)
	}
	ref, err := service.Authorize(ctx, "synthetic-operator", domain.SharedChargerRef{}, authz)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authorize(ctx, "synthetic-peer-operator", ref, authz); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("operator edited another owner's grant: %v", err)
	}
	if _, err := service.Authorize(ctx, "synthetic-operator", domain.SharedChargerRef{}, authz); !errors.Is(err, port.ErrSharedChargerActivePlan) {
		t.Fatalf("duplicate current charger plan accepted: %v", err)
	}
	if err := service.Revoke(ctx, "synthetic-peer-operator", ref); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("operator revoked another owner's grant: %v", err)
	}
	vehicleInput := func(plugged, reminder bool) smartreadinesssvc.SharedChargerConfirmationInput {
		return smartreadinesssvc.SharedChargerConfirmationInput{
			AvailableAt: start, DepartureAt: start.Add(2 * time.Hour),
			EnergyNeededWh: 3000, ConservativePowerW: 6000, AlreadyPlugged: &plugged, AcceptReminder: reminder,
		}
	}
	if err := service.Confirm(ctx, "synthetic-arriving", ref, 7, vehicleInput(false, true)); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("participant confirmed another vehicle: %v", err)
	}
	if err := service.Confirm(ctx, "synthetic-plugged", ref, 7, vehicleInput(true, false)); err != nil {
		t.Fatal(err)
	}
	if card, err := service.Card(ctx, "synthetic-plugged", ref); err != nil || card != nil {
		t.Fatalf("unconfirmed second vehicle yielded a card: %+v, %v", card, err)
	}
	if err := service.Confirm(ctx, "synthetic-arriving", ref, 8, vehicleInput(false, true)); err != nil {
		t.Fatal(err)
	}
	card, err := service.Card(ctx, "synthetic-arriving", ref)
	if err != nil || card == nil || card.Schedule.First.VehicleID != 7 || card.Schedule.Second.VehicleID != 8 ||
		!card.Schedule.SwapAt.Equal(start.Add(30*time.Minute)) || !card.Schedule.Second.StartsAt.Equal(start.Add(40*time.Minute)) {
		t.Fatalf("unexpected feasible order: %+v, %v", card, err)
	}
	if card, err := service.Card(ctx, "synthetic-outsider", ref); err != nil || card != nil {
		t.Fatalf("foreign subject could read the plan: %+v, %v", card, err)
	}
	if n, err := service.PublishDueReminders(ctx, 10); err != nil || n != 0 {
		t.Fatalf("reminder published before the handoff: %d, %v", n, err)
	}
	now = start.Add(31 * time.Minute)
	counts := make(chan int, 2)
	group, groupCtx := errgroup.WithContext(ctx)
	for range 2 {
		group.Go(func() error {
			n, err := service.PublishDueReminders(groupCtx, 10)
			counts <- n
			return err
		})
	}
	if err := group.Wait(); err != nil {
		t.Fatal(err)
	}
	if n := <-counts + <-counts; n != 1 {
		t.Fatalf("concurrent workers published %d swap occurrences, want one", n)
	}
	for _, viewer := range []string{"synthetic-plugged", "synthetic-operator", "synthetic-outsider"} {
		if reminder, err := service.Reminder(ctx, viewer, ref); err != nil || reminder != nil {
			t.Fatalf("unchosen viewer received a reminder: %+v, %v", reminder, err)
		}
	}
	reminder, err := service.Reminder(ctx, "synthetic-arriving", ref)
	if err != nil || reminder == nil || reminder.VehicleID != 8 || !reminder.SwapAt.Equal(card.Schedule.SwapAt) {
		t.Fatalf("missing chosen participant's published swap: %+v, %v", reminder, err)
	}
	if _, err := service.Authorize(ctx, "synthetic-operator", ref, authz); !errors.Is(err, port.ErrSharedChargerSwapPublished) {
		t.Fatalf("published occurrence was replaced: %v", err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofences SET updated_at=$1 WHERE id=9`, now); err != nil {
		t.Fatal(err)
	}
	if reminder, err := service.Reminder(ctx, "synthetic-arriving", ref); err != nil || reminder != nil {
		t.Fatalf("old place review still permits delivery: %+v, %v", reminder, err)
	}
	if err := service.Withdraw(ctx, "synthetic-plugged", ref, 7); err != nil {
		t.Fatal(err)
	}
	if n, err := service.PublishDueReminders(ctx, 10); err != nil || n != 0 {
		t.Fatalf("withdrawn plan republished: %d, %v", n, err)
	}
	applyWarrantyFixtureMigration(t, db, "000316_smart_shared_charger.down")
}

func TestSharedTripComparesOnlyCurrentEligibleConsentedVehicles(t *testing.T) {
	repo, db := testRepository(t)
	applyWarrantyFixtureMigration(t, db, "000317_smart_shared_trip.up")
	ctx := t.Context()
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	if _, err := db.Pool.Exec(ctx, `INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic second'),(9,'Synthetic third')`); err != nil {
		t.Fatal(err)
	}
	store := signal.New()
	live, err := signal.NewHybridLiveSignalStore(store, nil, signal.LiveSignalStoreModeLocal)
	if err != nil {
		t.Fatal(err)
	}
	seed := func() {
		for i, soc := range []int32{70, 80, 95} {
			store.UpdateValues(int64(7+i), map[string]*signal.Value{"BatteryLevel": {Raw: soc, Timestamp: now}})
		}
	}
	seed()
	operators := auth.NewOperatorAccess("X-Test-Subject", "synthetic-operator")
	service := smartreadinesssvc.NewSharedTripService(repo, live, operators.Allows, func() time.Time { return now })
	actor := func(subject string) smartreadinesssvc.SharedTripActor {
		return smartreadinesssvc.SharedTripActor{Subject: subject, VerifiedBrowser: true}
	}
	operator, a, b, c := actor("synthetic-operator"), actor("synthetic-trip-a"), actor("synthetic-trip-b"), actor("synthetic-trip-c")
	draft := domain.SharedTripDraft{
		SharedTrip: domain.SharedTrip{DepartureAt: now.Add(time.Hour)},
		Nominations: []domain.SharedTripNomination{
			{VehicleID: 7, Subject: a.Subject}, {VehicleID: 8, Subject: b.Subject}, {VehicleID: 9, Subject: c.Subject},
		},
	}
	if _, err := service.SaveTrip(ctx, a, draft); !errors.Is(err, smartreadinesssvc.ErrSharedTripOperatorRequired) {
		t.Fatalf("nominee could grant others access: %v", err)
	}
	trip, err := service.SaveTrip(ctx, operator, draft)
	if err != nil {
		t.Fatal(err)
	}
	for _, viewer := range []smartreadinesssvc.SharedTripActor{operator, a, actor("synthetic-outsider")} {
		if _, err := service.Comparison(ctx, viewer, trip.ID); !errors.Is(err, port.ErrNotFound) {
			t.Fatalf("unconfirmed viewer received comparison access: %v", err)
		}
	}
	key := func(viewer smartreadinesssvc.SharedTripActor, vehicleID int64) domain.SharedTripEntryKey {
		t.Helper()
		invitations, err := service.ListInvitations(ctx, viewer, 10, 0)
		if err != nil || len(invitations) != 1 || invitations[0].VehicleID != vehicleID {
			t.Fatalf("unexpected exact-subject invitation: %+v, %v", invitations, err)
		}
		return invitations[0].SharedTripEntryKey
	}
	confirm := func(viewer smartreadinesssvc.SharedTripActor, k domain.SharedTripEntryKey, maint bool) {
		t.Helper()
		low, high, reserve, schedule := 12.0, 20.0, 15.0, true
		input := domain.SharedTripConfirmationInput{
			TripUseLowPct: &low, TripUseHighPct: &high, ReservePct: &reserve, ScheduleClear: &schedule, MaintenanceClear: &maint,
		}
		if err := service.ConfirmVehicle(ctx, viewer, k, input); err != nil {
			t.Fatal(err)
		}
	}
	confirm(a, key(a, 7), true)
	confirm(c, key(c, 9), false)
	if comparison, err := service.Comparison(ctx, a, trip.ID); err != nil || comparison != nil {
		t.Fatalf("uncleared third vehicle was compared: %+v, %v", comparison, err)
	}
	confirm(b, key(b, 8), true)
	comparison, err := service.Comparison(ctx, a, trip.ID)
	if err != nil || comparison == nil || len(comparison.Options) != 2 || comparison.Options[0].VehicleID != 8 ||
		comparison.Options[0].ReturnLowPct != 60 || comparison.Options[1].VehicleID != 7 {
		t.Fatalf("wrong eligible comparison: %+v, %v", comparison, err)
	}
	now = now.Add(3 * time.Minute)
	if comparison, err := service.Comparison(ctx, a, trip.ID); err != nil || comparison != nil {
		t.Fatalf("stale live evidence was compared: %+v, %v", comparison, err)
	}
	seed()
	old := key(b, 8)
	confirm(b, old, true)
	if err := service.WithdrawVehicle(ctx, b, old); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("old consent version overwrote new confirmation: %v", err)
	}
	if err := service.WithdrawVehicle(ctx, b, key(b, 8)); err != nil {
		t.Fatal(err)
	}
	if comparison, err := service.Comparison(ctx, a, trip.ID); err != nil || comparison != nil {
		t.Fatalf("withdrawn vehicle still appeared: %+v, %v", comparison, err)
	}
	draft.SharedTrip = *trip
	revised, err := service.SaveTrip(ctx, operator, draft)
	if err != nil || revised.Revision != trip.Revision+1 {
		t.Fatalf("failed to replace scoped roster: %+v, %v", revised, err)
	}
	if _, err := service.Comparison(ctx, a, trip.ID); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("previous revision retained consent: %v", err)
	}
	applyWarrantyFixtureMigration(t, db, "000317_smart_shared_trip.down")
}
