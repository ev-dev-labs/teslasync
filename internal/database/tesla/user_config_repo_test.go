package tesla

import (
	"context"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

func userConfigRow(c *teslamodel.TeslaUserConfig) []any {
	return []any{c.ID, c.ConfigType, c.Data, c.FetchedAt, c.CreatedAt, c.UpdatedAt}
}

func sampleConfig() *teslamodel.TeslaUserConfig {
	return &teslamodel.TeslaUserConfig{
		ID:         3,
		ConfigType: "feature_config",
		Data:       `{"dark_mode":true}`,
		FetchedAt:  fixedTime,
		CreatedAt:  fixedTime,
		UpdatedAt:  fixedTime,
	}
}

func TestUserConfigRepo_GetByType(t *testing.T) {
	t.Parallel()
	c := sampleConfig()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: userConfigRow(c)}},
		{name: "not found maps to nil,nil", row: noRow(), wantNil: true},
		{name: "scan error wraps config type", row: fakeRow{scanErr: errBoom}, errFrag: "get user config feature_config"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaUserConfigRepo{pool: pool}
			got, err := repo.GetByType(context.Background(), "feature_config")
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			assertArgsEqual(t, pool.queryRowCalls[0].args, []any{"feature_config"})
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.ConfigType != "feature_config" || got.Data != c.Data {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestUserConfigRepo_Upsert(t *testing.T) {
	t.Parallel()

	t.Run("success binds type+data+now and upserts", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execQueue: []execResult{{}}}
		repo := &TeslaUserConfigRepo{pool: pool}
		if err := repo.Upsert(context.Background(), "region", "us"); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
		if len(pool.execCalls) != 1 {
			t.Fatalf("want 1 Exec, got %d", len(pool.execCalls))
		}
		call := pool.execCalls[0]
		if !strings.Contains(call.sql, "ON CONFLICT (config_type) DO UPDATE") {
			t.Errorf("expected conflict clause: %s", call.sql)
		}
		if len(call.args) != 3 || call.args[0] != "region" || call.args[1] != "us" {
			t.Fatalf("args wrong: %#v", call.args)
		}
		if _, ok := call.args[2].(interface{ IsZero() bool }); !ok {
			t.Errorf("third arg should be time.Time, got %T", call.args[2])
		}
	})

	t.Run("exec error wraps config type", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		repo := &TeslaUserConfigRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), "region", "us"), "upsert user config region")
	})
}
