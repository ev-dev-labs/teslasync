package tesla

import (
	"context"
	"errors"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

func userProfileRow(p *teslamodel.TeslaUserProfile) []any {
	return []any{p.ID, p.Email, p.FullName, p.ProfileImageURL, p.FetchedAt, p.CreatedAt, p.UpdatedAt}
}

func sampleProfile() *teslamodel.TeslaUserProfile {
	return &teslamodel.TeslaUserProfile{
		ID:              5,
		Email:           "owner@example.com",
		FullName:        "Ada Owner",
		ProfileImageURL: strp("https://example.com/a.png"),
		FetchedAt:       fixedTime,
		CreatedAt:       fixedTime,
		UpdatedAt:       fixedTime,
	}
}

func TestUserProfileRepo_Get(t *testing.T) {
	t.Parallel()
	p := sampleProfile()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: userProfileRow(p)}},
		{name: "not found maps to nil,nil", row: noRow(), wantNil: true},
		{name: "scan error wrapped", row: fakeRow{scanErr: errBoom}, errFrag: "get user profile"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaUserProfileRepo{pool: pool}
			got, err := repo.Get(context.Background())
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if !strings.Contains(pool.queryRowCalls[0].sql, "ORDER BY updated_at DESC LIMIT 1") {
				t.Errorf("SQL missing single-row selector: %s", pool.queryRowCalls[0].sql)
			}
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.Email != "owner@example.com" || got.FullName != "Ada Owner" {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestUserProfileRepo_Upsert(t *testing.T) {
	t.Parallel()

	t.Run("begin error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
		repo := &TeslaUserProfileRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), sampleProfile()), "begin tx")
	})

	t.Run("delete error wrapped, rolled back", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserProfileRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), sampleProfile()), "delete old profile")
		if tx.rollbackCalls != 1 || tx.commitCalls != 0 {
			t.Errorf("rollback=%d commit=%d, want 1/0", tx.rollbackCalls, tx.commitCalls)
		}
	})

	t.Run("insert error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserProfileRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), sampleProfile()), "insert profile")
	})

	t.Run("commit error surfaced raw", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(77)}}}, commitErr: errBoom}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserProfileRepo{pool: pool}
		if err := repo.Upsert(context.Background(), sampleProfile()); !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want errBoom", err)
		}
	})

	t.Run("success replaces row, assigns id and timestamps", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(99)}}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserProfileRepo{pool: pool}
		p := sampleProfile()
		p.ID = 0
		p.FetchedAt = fixedTime // will be overwritten by now
		if err := repo.Upsert(context.Background(), p); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
		if p.ID != 99 {
			t.Errorf("id=%d, want 99 from RETURNING", p.ID)
		}
		if p.FetchedAt.Equal(fixedTime) || p.FetchedAt.IsZero() {
			t.Errorf("FetchedAt should be set to now, got %v", p.FetchedAt)
		}
		if !p.CreatedAt.Equal(p.UpdatedAt) || !p.CreatedAt.Equal(p.FetchedAt) {
			t.Errorf("timestamps must all equal now: fetched=%v created=%v updated=%v", p.FetchedAt, p.CreatedAt, p.UpdatedAt)
		}
		if len(tx.execCalls) != 1 || !strings.Contains(tx.execCalls[0].sql, "DELETE FROM tesla_user_profiles") {
			t.Errorf("expected one DELETE exec, got %+v", tx.execCalls)
		}
		insArgs := tx.queryRowCalls[0].args
		if len(insArgs) != 5 || insArgs[0] != "owner@example.com" {
			t.Fatalf("insert args wrong: %#v", insArgs)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit=%d, want 1", tx.commitCalls)
		}
	})
}
