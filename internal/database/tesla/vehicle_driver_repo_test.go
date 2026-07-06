package tesla

import (
	"context"
	"errors"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

func driverRow(d *teslamodel.TeslaVehicleDriver) []any {
	return []any{d.ID, d.VehicleID, d.VIN, d.ShareUserID, d.DriverEmail, d.DriverName, d.Role, d.FetchedAt}
}

func sampleDriver() *teslamodel.TeslaVehicleDriver {
	return &teslamodel.TeslaVehicleDriver{
		ID:          1,
		VehicleID:   42,
		VIN:         "5YJ3E1EA7KF000004",
		ShareUserID: i64p(900),
		DriverEmail: strp("driver@example.com"),
		DriverName:  strp("Grace Driver"),
		Role:        strp("driver"),
		FetchedAt:   fixedTime,
	}
}

func invitationRow(inv *teslamodel.TeslaVehicleInvitation) []any {
	return []any{
		inv.ID, inv.VehicleID, inv.VIN, inv.InvitationID,
		inv.InviteURL, inv.Status, inv.ExpiresAt, inv.CreatedBy,
		inv.FetchedAt, inv.CreatedAt,
	}
}

func sampleInvitation() *teslamodel.TeslaVehicleInvitation {
	return &teslamodel.TeslaVehicleInvitation{
		ID:           1,
		VehicleID:    42,
		VIN:          "5YJ3E1EA7KF000004",
		InvitationID: "inv-abc",
		InviteURL:    strp("https://tesla.com/i/abc"),
		Status:       "PENDING",
		ExpiresAt:    timePtr(fixedTime.Add(24 * 3600 * 1e9)),
		CreatedBy:    strp("owner@example.com"),
		FetchedAt:    fixedTime,
		CreatedAt:    fixedTime,
	}
}

func TestVehicleDriverRepo_GetDriversByVehicleID(t *testing.T) {
	t.Parallel()
	d1 := sampleDriver()
	d2 := sampleDriver()
	d2.ID = 2
	d2.ShareUserID = nil // NULL nullable column

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{driverRow(d1), driverRow(d2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error wrapped", script: queryResult{err: errBoom}, errFrag: "query vehicle drivers"},
		{name: "scan error wrapped", script: queryResult{rows: &fakeRows{data: [][]any{driverRow(d1)}, cursor: -1, scanErrAt: 0}}, errFrag: "scan vehicle driver"},
		{name: "iter error surfaced", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errBoom}}, errFrag: "boom"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &TeslaVehicleDriverRepo{pool: pool}
			got, err := repo.GetDriversByVehicleID(context.Background(), 42)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			assertArgsEqual(t, pool.queryCalls[0].args, []any{int64(42)})
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			if tt.wantLen == 2 {
				if got[0].ShareUserID == nil || *got[0].ShareUserID != 900 || got[1].ShareUserID != nil {
					t.Errorf("nullable ShareUserID mis-scanned: %+v %+v", got[0].ShareUserID, got[1].ShareUserID)
				}
			}
		})
	}
}

func TestVehicleDriverRepo_ReplaceDriversForVehicle(t *testing.T) {
	t.Parallel()

	t.Run("begin error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceDriversForVehicle(context.Background(), 42, nil), "begin tx")
	})

	t.Run("delete error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceDriversForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleDriver{sampleDriver()}), "delete old drivers")
	})

	t.Run("insert error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{}, {err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceDriversForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleDriver{sampleDriver()}), "insert driver")
	})

	t.Run("nil driver rejected", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceDriversForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleDriver{nil}), "nil driver at index 0")
	})

	t.Run("commit error surfaced raw", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{commitErr: errBoom}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		if err := repo.ReplaceDriversForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleDriver{sampleDriver()}); !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want errBoom", err)
		}
	})

	t.Run("success deletes for vehicle then inserts", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		if err := repo.ReplaceDriversForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleDriver{sampleDriver()}); err != nil {
			t.Fatalf("ReplaceDriversForVehicle: %v", err)
		}
		if len(tx.execCalls) != 2 {
			t.Fatalf("execCalls=%d, want 2 (DELETE+INSERT)", len(tx.execCalls))
		}
		assertArgsEqual(t, tx.execCalls[0].args, []any{int64(42)})
		insArgs := tx.execCalls[1].args
		if len(insArgs) != 7 || insArgs[0] != int64(42) {
			t.Fatalf("insert args wrong: %#v", insArgs)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit=%d, want 1", tx.commitCalls)
		}
	})
}

func TestVehicleDriverRepo_GetInvitationsByVehicleID(t *testing.T) {
	t.Parallel()
	i1 := sampleInvitation()
	i2 := sampleInvitation()
	i2.ID = 2
	i2.ExpiresAt = nil

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{invitationRow(i1), invitationRow(i2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error wrapped", script: queryResult{err: errBoom}, errFrag: "query vehicle invitations"},
		{name: "scan error wrapped", script: queryResult{rows: &fakeRows{data: [][]any{invitationRow(i1)}, cursor: -1, scanErrAt: 0}}, errFrag: "scan vehicle invitation"},
		{name: "iter error surfaced", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errBoom}}, errFrag: "boom"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &TeslaVehicleDriverRepo{pool: pool}
			got, err := repo.GetInvitationsByVehicleID(context.Background(), 42)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			assertArgsEqual(t, pool.queryCalls[0].args, []any{int64(42)})
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			if tt.wantLen == 2 && (got[0].InvitationID != "inv-abc" || got[1].ExpiresAt != nil) {
				t.Errorf("scanned rows wrong: %+v %+v", got[0], got[1])
			}
		})
	}
}

func TestVehicleDriverRepo_ReplaceInvitationsForVehicle(t *testing.T) {
	t.Parallel()

	t.Run("begin error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceInvitationsForVehicle(context.Background(), 42, nil), "begin tx")
	})

	t.Run("delete error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceInvitationsForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleInvitation{sampleInvitation()}), "delete old invitations")
	})

	t.Run("insert error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{}, {err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceInvitationsForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleInvitation{sampleInvitation()}), "insert invitation")
	})

	t.Run("nil invitation rejected", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.ReplaceInvitationsForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleInvitation{nil}), "nil invitation at index 0")
	})

	t.Run("success deletes then inserts and commits", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		if err := repo.ReplaceInvitationsForVehicle(context.Background(), 42, []*teslamodel.TeslaVehicleInvitation{sampleInvitation()}); err != nil {
			t.Fatalf("ReplaceInvitationsForVehicle: %v", err)
		}
		if len(tx.execCalls) != 2 {
			t.Fatalf("execCalls=%d, want 2", len(tx.execCalls))
		}
		insArgs := tx.execCalls[1].args
		if len(insArgs) != 9 || insArgs[2] != "inv-abc" {
			t.Fatalf("insert args wrong: %#v", insArgs)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit=%d, want 1", tx.commitCalls)
		}
	})
}

func TestVehicleDriverRepo_InsertInvitation(t *testing.T) {
	t.Parallel()

	t.Run("success assigns id and timestamps and binds args", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(321)}}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		inv := sampleInvitation()
		inv.ID = 0
		inv.FetchedAt = fixedTime
		if err := repo.InsertInvitation(context.Background(), inv); err != nil {
			t.Fatalf("InsertInvitation: %v", err)
		}
		if inv.ID != 321 {
			t.Errorf("id=%d, want 321 from RETURNING", inv.ID)
		}
		if inv.FetchedAt.Equal(fixedTime) || inv.FetchedAt.IsZero() || !inv.CreatedAt.Equal(inv.FetchedAt) {
			t.Errorf("timestamps not set to now: fetched=%v created=%v", inv.FetchedAt, inv.CreatedAt)
		}
		call := pool.queryRowCalls[0]
		if !strings.Contains(call.sql, "ON CONFLICT (vehicle_id, invitation_id) DO UPDATE") {
			t.Errorf("expected upsert conflict clause: %s", call.sql)
		}
		if len(call.args) != 9 || call.args[0] != int64(42) || call.args[2] != "inv-abc" {
			t.Fatalf("bound args wrong: %#v", call.args)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		repo := &TeslaVehicleDriverRepo{pool: pool}
		requireErr(t, repo.InsertInvitation(context.Background(), sampleInvitation()), "insert invitation")
	})
}
