package tesla

import (
	"context"
	"errors"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

func userOrderRow(o *teslamodel.TeslaUserOrder) []any {
	return []any{
		o.ID, o.OrderID, o.Model, o.Status, o.DeliveryDate,
		o.VIN, o.ReferralCode, o.IsUpgradable,
		o.FetchedAt, o.CreatedAt, o.UpdatedAt,
	}
}

func sampleOrder() *teslamodel.TeslaUserOrder {
	return &teslamodel.TeslaUserOrder{
		ID:           11,
		OrderID:      "RN123456",
		Model:        "my",
		Status:       "BOOKED",
		DeliveryDate: timePtr(fixedTime.Add(72 * 3600 * 1e9)),
		VIN:          strp("5YJ3E1EA7KF000003"),
		ReferralCode: strp("ref-9"),
		IsUpgradable: true,
		FetchedAt:    fixedTime,
		CreatedAt:    fixedTime,
		UpdatedAt:    fixedTime,
	}
}

func TestUserOrderRepo_GetAll(t *testing.T) {
	t.Parallel()
	o1 := sampleOrder()
	o2 := sampleOrder()
	o2.ID = 12
	o2.OrderID = "RN222222"
	o2.VIN = nil // exercise NULL nullable column

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{userOrderRow(o1), userOrderRow(o2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error wrapped", script: queryResult{err: errBoom}, errFrag: "query tesla_user_orders"},
		{name: "scan error wrapped", script: queryResult{rows: &fakeRows{data: [][]any{userOrderRow(o1)}, cursor: -1, scanErrAt: 0}}, errFrag: "scan tesla_user_order"},
		{name: "iter error surfaced", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errBoom}}, errFrag: "boom"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &TeslaUserOrderRepo{pool: pool}
			got, err := repo.GetAll(context.Background())
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			if !strings.Contains(pool.queryCalls[0].sql, "ORDER BY updated_at DESC") {
				t.Errorf("SQL missing ORDER BY: %s", pool.queryCalls[0].sql)
			}
			if tt.wantLen == 2 {
				if got[0].OrderID != "RN123456" || got[1].VIN != nil {
					t.Errorf("scanned rows wrong: %+v %+v", got[0], got[1])
				}
				if got[0].VIN == nil || *got[0].VIN != "5YJ3E1EA7KF000003" {
					t.Errorf("nullable VIN not scanned: %+v", got[0].VIN)
				}
			}
		})
	}
}

func TestUserOrderRepo_ReplaceAll(t *testing.T) {
	t.Parallel()

	t.Run("begin error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		requireErr(t, repo.ReplaceAll(context.Background(), nil), "begin tx")
	})

	t.Run("delete error wrapped, rolled back", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		requireErr(t, repo.ReplaceAll(context.Background(), []*teslamodel.TeslaUserOrder{sampleOrder()}), "delete tesla_user_orders")
		if tx.rollbackCalls != 1 || tx.commitCalls != 0 {
			t.Errorf("rollback=%d commit=%d, want 1/0", tx.rollbackCalls, tx.commitCalls)
		}
	})

	t.Run("insert error wraps order id", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{}, {err: errBoom}}} // DELETE ok, INSERT fails
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		requireErr(t, repo.ReplaceAll(context.Background(), []*teslamodel.TeslaUserOrder{sampleOrder()}), "insert tesla_user_order RN123456")
	})

	t.Run("nil order rejected", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		requireErr(t, repo.ReplaceAll(context.Background(), []*teslamodel.TeslaUserOrder{nil}), "nil order at index 0")
	})

	t.Run("commit error surfaced raw", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{commitErr: errBoom}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		err := repo.ReplaceAll(context.Background(), []*teslamodel.TeslaUserOrder{sampleOrder()})
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want errBoom", err)
		}
	})

	t.Run("success deletes then inserts and commits", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &TeslaUserOrderRepo{pool: pool}
		o1 := sampleOrder()
		o2 := sampleOrder()
		o2.OrderID = "RN222222"
		if err := repo.ReplaceAll(context.Background(), []*teslamodel.TeslaUserOrder{o1, o2}); err != nil {
			t.Fatalf("ReplaceAll: %v", err)
		}
		// 1 DELETE + 2 INSERTs.
		if len(tx.execCalls) != 3 {
			t.Fatalf("execCalls=%d, want 3", len(tx.execCalls))
		}
		if !strings.Contains(tx.execCalls[0].sql, "DELETE FROM tesla_user_orders") {
			t.Errorf("first exec not DELETE: %s", tx.execCalls[0].sql)
		}
		insArgs := tx.execCalls[1].args
		if len(insArgs) != 8 || insArgs[0] != "RN123456" {
			t.Fatalf("insert args wrong: %#v", insArgs)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit=%d, want 1", tx.commitCalls)
		}
	})
}
