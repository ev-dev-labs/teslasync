package teslauserorder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog"
)

// TestMain silences the package logger so -race output stays readable; the
// handlers log at Info/Warn/Error on nearly every branch under test.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	os.Exit(m.Run())
}

// --- small helpers -----------------------------------------------------------

func strp(v string) *string { return &v }

// assertErrorBody checks the shared {error,code} JSON error envelope produced
// by httpx.WriteError.
func assertErrorBody(t *testing.T, body []byte, wantCode string) {
	t.Helper()
	var payload struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("error body not JSON: %v; body=%s", err, body)
	}
	if payload.Error == "" {
		t.Fatalf("error message empty; body=%s", body)
	}
	if payload.Code != wantCode {
		t.Fatalf("code = %q, want %q; body=%s", payload.Code, wantCode, body)
	}
}

// --- fakes (consumer-side ports) --------------------------------------------

// fakeOrderAPI implements teslaUserOrderAPI. Method calls are counted so tests
// can assert short-circuit behaviour (e.g. no Tesla call without a token).
type fakeOrderAPI struct {
	ordersFn func(ctx context.Context) ([]byte, int, error)
	hasToken bool

	orderCalls  int
	tokenChecks int
}

func (f *fakeOrderAPI) GetUserOrders(ctx context.Context) ([]byte, int, error) {
	f.orderCalls++
	if f.ordersFn == nil {
		return []byte(`{"response":[]}`), http.StatusOK, nil
	}
	return f.ordersFn(ctx)
}

func (f *fakeOrderAPI) HasValidToken() bool {
	f.tokenChecks++
	return f.hasToken
}

// fakeOrderStore implements teslaUserOrderStore and records every write so
// tests can assert the parsed batch and read-after-write ordering.
type fakeOrderStore struct {
	getAllFn  func(ctx context.Context) ([]*teslamodel.TeslaUserOrder, error)
	replaceFn func(ctx context.Context, orders []*teslamodel.TeslaUserOrder) error

	getAllCalls    int
	replaceBatches [][]*teslamodel.TeslaUserOrder
}

func (f *fakeOrderStore) GetAll(ctx context.Context) ([]*teslamodel.TeslaUserOrder, error) {
	f.getAllCalls++
	if f.getAllFn == nil {
		return nil, nil
	}
	return f.getAllFn(ctx)
}

func (f *fakeOrderStore) ReplaceAll(ctx context.Context, orders []*teslamodel.TeslaUserOrder) error {
	f.replaceBatches = append(f.replaceBatches, orders)
	if f.replaceFn == nil {
		return nil
	}
	return f.replaceFn(ctx, orders)
}

// Static proof the fakes satisfy the ports the production code depends on.
var (
	_ teslaUserOrderAPI   = (*fakeOrderAPI)(nil)
	_ teslaUserOrderStore = (*fakeOrderStore)(nil)
)

// --- wire-shape builders -----------------------------------------------------

// wireOrder mirrors a single element of the Tesla `response` array using the
// exact JSON tags the handler unmarshals, so tests drive the real decode path.
type wireOrder struct {
	OrderID      string  `json:"order_id"`
	Model        string  `json:"model,omitempty"`
	Status       string  `json:"status,omitempty"`
	DeliveryDate *string `json:"delivery_date,omitempty"`
	VIN          *string `json:"vin,omitempty"`
	ReferralCode *string `json:"referral_code,omitempty"`
	IsUpgradable bool    `json:"is_upgradable"`
}

// ordersBody marshals a full Tesla orders envelope: {"response":[...]}.
func ordersBody(t *testing.T, orders ...wireOrder) []byte {
	t.Helper()
	env := struct {
		Response []wireOrder `json:"response"`
	}{Response: orders}
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal orders body: %v", err)
	}
	return b
}

// rawOrder marshals one order into a json.RawMessage for parseUserOrders tests.
func rawOrder(t *testing.T, o wireOrder) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(o)
	if err != nil {
		t.Fatalf("marshal wire order: %v", err)
	}
	return b
}

// ordersResp mirrors the ordersEnvelope JSON returned by Orders/RefreshOrders.
type ordersResp struct {
	Orders    []*teslamodel.TeslaUserOrder `json:"orders"`
	FetchedAt *string                      `json:"fetched_at"`
}

func decodeOrdersResp(t *testing.T, body []byte) ordersResp {
	t.Helper()
	var resp ordersResp
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode orders response: %v; body=%s", err, body)
	}
	return resp
}

// ============================================================================
// constructor wiring
// ============================================================================

func TestNewHandler_WiresPorts(t *testing.T) {
	// nil deps are fine for a construction smoke test: the repo stores the
	// (nil) pool without dereferencing it, and the client pointer is only
	// dereferenced on use. This proves the constructor never leaves a port
	// unset (a nil port would nil-panic on the first request).
	h := NewHandler(&tesla.Client{}, &database.DB{})
	if h == nil {
		t.Fatal("constructor returned nil")
	}
	if h.orderRepo == nil {
		t.Fatal("order repo port not wired")
	}
	if h.teslaClient == nil {
		t.Fatal("tesla client port not wired")
	}
}

// ============================================================================
// parseUserOrders
// ============================================================================

func TestParseUserOrders_Table(t *testing.T) {
	wantDelivery, _ := time.Parse("2006-01-02", "2026-06-01")

	tests := []struct {
		name   string
		raws   []json.RawMessage
		verify func(t *testing.T, got []*teslamodel.TeslaUserOrder)
	}{
		{
			name: "nil input yields empty non-nil slice",
			raws: nil,
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if got == nil {
					t.Fatalf("result = nil, want non-nil empty slice")
				}
				if len(got) != 0 {
					t.Fatalf("len = %d, want 0", len(got))
				}
			},
		},
		{
			name: "empty input yields empty slice",
			raws: []json.RawMessage{},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 0 {
					t.Fatalf("len = %d, want 0", len(got))
				}
			},
		},
		{
			name: "fully populated order maps every field",
			raws: []json.RawMessage{rawOrder(t, wireOrder{
				OrderID:      "RN123",
				Model:        "Model Y",
				Status:       "BOOKED",
				DeliveryDate: strp("2026-06-01"),
				VIN:          strp("5YJ3E1EA1KF000001"),
				ReferralCode: strp("ref-abc"),
				IsUpgradable: true,
			})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1", len(got))
				}
				o := got[0]
				if o.OrderID != "RN123" {
					t.Fatalf("OrderID = %q, want RN123", o.OrderID)
				}
				if o.Model != "Model Y" {
					t.Fatalf("Model = %q, want Model Y", o.Model)
				}
				if o.Status != "BOOKED" {
					t.Fatalf("Status = %q, want BOOKED", o.Status)
				}
				if o.DeliveryDate == nil || !o.DeliveryDate.Equal(wantDelivery) {
					t.Fatalf("DeliveryDate = %v, want %v", o.DeliveryDate, wantDelivery)
				}
				if o.VIN == nil || *o.VIN != "5YJ3E1EA1KF000001" {
					t.Fatalf("VIN = %v, want 5YJ3E1EA1KF000001", o.VIN)
				}
				if o.ReferralCode == nil || *o.ReferralCode != "ref-abc" {
					t.Fatalf("ReferralCode = %v, want ref-abc", o.ReferralCode)
				}
				if !o.IsUpgradable {
					t.Fatalf("IsUpgradable = false, want true")
				}
			},
		},
		{
			name: "empty delivery date string leaves nil",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A", DeliveryDate: strp("")})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if got[0].DeliveryDate != nil {
					t.Fatalf("DeliveryDate = %v, want nil", got[0].DeliveryDate)
				}
			},
		},
		{
			name: "omitted delivery date leaves nil",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A"})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if got[0].DeliveryDate != nil {
					t.Fatalf("DeliveryDate = %v, want nil", got[0].DeliveryDate)
				}
			},
		},
		{
			name: "unparseable delivery date leaves nil but keeps order",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A", DeliveryDate: strp("not-a-date")})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1 (order kept despite bad date)", len(got))
				}
				if got[0].DeliveryDate != nil {
					t.Fatalf("DeliveryDate = %v, want nil", got[0].DeliveryDate)
				}
			},
		},
		{
			name: "rfc3339 delivery date rejected by date-only parser",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A", DeliveryDate: strp("2026-06-01T00:00:00Z")})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if got[0].DeliveryDate != nil {
					t.Fatalf("DeliveryDate = %v, want nil (only date-only format accepted)", got[0].DeliveryDate)
				}
			},
		},
		{
			name: "nil optional pointers preserved",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A", Model: "Model 3", Status: "PENDING"})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				o := got[0]
				if o.VIN != nil {
					t.Fatalf("VIN = %v, want nil", o.VIN)
				}
				if o.ReferralCode != nil {
					t.Fatalf("ReferralCode = %v, want nil", o.ReferralCode)
				}
				if o.DeliveryDate != nil {
					t.Fatalf("DeliveryDate = %v, want nil", o.DeliveryDate)
				}
			},
		},
		{
			name: "syntactically broken raw entry skipped",
			raws: []json.RawMessage{json.RawMessage("{"), rawOrder(t, wireOrder{OrderID: "keep"})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1 (broken entry skipped)", len(got))
				}
				if got[0].OrderID != "keep" {
					t.Fatalf("OrderID = %q, want keep", got[0].OrderID)
				}
			},
		},
		{
			name: "type-mismatch raw entry skipped, valid kept",
			raws: []json.RawMessage{json.RawMessage(`{"order_id":123}`), rawOrder(t, wireOrder{OrderID: "ok"})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1 (type-mismatch entry skipped)", len(got))
				}
				if got[0].OrderID != "ok" {
					t.Fatalf("OrderID = %q, want ok", got[0].OrderID)
				}
			},
		},
		{
			name: "is_upgradable false preserved",
			raws: []json.RawMessage{rawOrder(t, wireOrder{OrderID: "A", IsUpgradable: false})},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if got[0].IsUpgradable {
					t.Fatalf("IsUpgradable = true, want false")
				}
			},
		},
		{
			name: "multiple orders keep distinct values (no loop aliasing)",
			raws: []json.RawMessage{
				rawOrder(t, wireOrder{OrderID: "A", VIN: strp("VIN-A"), IsUpgradable: true}),
				rawOrder(t, wireOrder{OrderID: "B", VIN: strp("VIN-B"), IsUpgradable: false}),
			},
			verify: func(t *testing.T, got []*teslamodel.TeslaUserOrder) {
				if len(got) != 2 {
					t.Fatalf("len = %d, want 2", len(got))
				}
				if got[0].OrderID != "A" || got[1].OrderID != "B" {
					t.Fatalf("order ids = %q,%q want A,B", got[0].OrderID, got[1].OrderID)
				}
				if got[0].VIN == nil || got[1].VIN == nil || *got[0].VIN != "VIN-A" || *got[1].VIN != "VIN-B" {
					t.Fatalf("vins wrong: %v %v", got[0].VIN, got[1].VIN)
				}
				if got[0].VIN == got[1].VIN {
					t.Fatalf("vin pointers aliased across entries")
				}
				if !got[0].IsUpgradable || got[1].IsUpgradable {
					t.Fatalf("is_upgradable = %v,%v want true,false", got[0].IsUpgradable, got[1].IsUpgradable)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseUserOrders(tc.raws)
			tc.verify(t, got)
		})
	}
}

// ============================================================================
// Orders (read path)
// ============================================================================

func TestOrders(t *testing.T) {
	fetched := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	t.Run("success returns orders and fetched_at from newest row", func(t *testing.T) {
		orders := []*teslamodel.TeslaUserOrder{
			{ID: 1, OrderID: "A", Model: "Model Y", Status: "BOOKED", FetchedAt: fetched},
			{ID: 2, OrderID: "B", Model: "Model 3", Status: "DELIVERED", FetchedAt: fetched.Add(-time.Hour)},
		}
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) { return orders, nil },
		}
		h := newHandler(&fakeOrderAPI{}, store)

		rec := httptest.NewRecorder()
		h.Orders(rec, httptest.NewRequest(http.MethodGet, "/tesla/user/orders", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
			t.Fatalf("Content-Type = %q", ct)
		}
		resp := decodeOrdersResp(t, rec.Body.Bytes())
		if len(resp.Orders) != 2 {
			t.Fatalf("orders len = %d, want 2", len(resp.Orders))
		}
		if resp.Orders[0].OrderID != "A" || resp.Orders[1].OrderID != "B" {
			t.Fatalf("orders = %q,%q want A,B", resp.Orders[0].OrderID, resp.Orders[1].OrderID)
		}
		if resp.FetchedAt == nil {
			t.Fatalf("fetched_at = nil, want set")
		}
		if want := fetched.Format(time.RFC3339); *resp.FetchedAt != want {
			t.Fatalf("fetched_at = %q, want %q", *resp.FetchedAt, want)
		}
		if store.getAllCalls != 1 {
			t.Fatalf("GetAll calls = %d, want 1", store.getAllCalls)
		}
	})

	t.Run("nil orders serialise as empty array with null fetched_at", func(t *testing.T) {
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) { return nil, nil },
		}
		h := newHandler(&fakeOrderAPI{}, store)

		rec := httptest.NewRecorder()
		h.Orders(rec, httptest.NewRequest(http.MethodGet, "/tesla/user/orders", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"orders":[]`) {
			t.Fatalf("body should contain empty orders array, got %s", body)
		}
		if !strings.Contains(body, `"fetched_at":null`) {
			t.Fatalf("body should contain null fetched_at, got %s", body)
		}
	})

	t.Run("empty slice yields empty array and nil fetched_at", func(t *testing.T) {
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) {
				return []*teslamodel.TeslaUserOrder{}, nil
			},
		}
		h := newHandler(&fakeOrderAPI{}, store)

		rec := httptest.NewRecorder()
		h.Orders(rec, httptest.NewRequest(http.MethodGet, "/tesla/user/orders", nil))

		resp := decodeOrdersResp(t, rec.Body.Bytes())
		if resp.Orders == nil || len(resp.Orders) != 0 {
			t.Fatalf("orders = %v, want empty non-nil", resp.Orders)
		}
		if resp.FetchedAt != nil {
			t.Fatalf("fetched_at = %v, want nil", *resp.FetchedAt)
		}
	})

	t.Run("nil first element does not panic and skips fetched_at", func(t *testing.T) {
		// Hardening: a nil pointer at orders[0] must not turn the sync-metadata
		// read into a nil-deref panic.
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) {
				return []*teslamodel.TeslaUserOrder{nil}, nil
			},
		}
		h := newHandler(&fakeOrderAPI{}, store)

		rec := httptest.NewRecorder()
		h.Orders(rec, httptest.NewRequest(http.MethodGet, "/tesla/user/orders", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (nil element must not panic)", rec.Code)
		}
		resp := decodeOrdersResp(t, rec.Body.Bytes())
		if resp.FetchedAt != nil {
			t.Fatalf("fetched_at = %v, want nil when newest row is nil", *resp.FetchedAt)
		}
	})

	t.Run("GetAll error returns 500 with error envelope", func(t *testing.T) {
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) {
				return nil, errors.New("db down")
			},
		}
		h := newHandler(&fakeOrderAPI{}, store)

		rec := httptest.NewRecorder()
		h.Orders(rec, httptest.NewRequest(http.MethodGet, "/tesla/user/orders", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		assertErrorBody(t, rec.Body.Bytes(), "INTERNAL_ERROR")
	})
}

// ============================================================================
// RefreshOrders (write path)
// ============================================================================

func TestRefreshOrders(t *testing.T) {
	t.Run("no valid token returns 401 and touches nothing else", func(t *testing.T) {
		api := &fakeOrderAPI{hasToken: false}
		store := &fakeOrderStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
		if api.tokenChecks != 1 {
			t.Fatalf("token checks = %d, want 1", api.tokenChecks)
		}
		if api.orderCalls != 0 {
			t.Fatalf("must not call Tesla without a token")
		}
		if len(store.replaceBatches) != 0 || store.getAllCalls != 0 {
			t.Fatalf("must not touch store without a token")
		}
		assertErrorBody(t, rec.Body.Bytes(), "UNAUTHORIZED")
	})

	t.Run("tesla api error returns 502 and skips persistence", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return nil, 0, errors.New("dial tcp: connection refused")
			},
		}
		store := &fakeOrderStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
		if len(store.replaceBatches) != 0 {
			t.Fatalf("ReplaceAll must be skipped on API error")
		}
		assertErrorBody(t, rec.Body.Bytes(), "ERROR") // 502 -> "ERROR" per HTTPStatusCode
	})

	t.Run("malformed tesla json returns 500", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return []byte(`{not json`), http.StatusOK, nil
			},
		}
		store := &fakeOrderStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if len(store.replaceBatches) != 0 {
			t.Fatalf("ReplaceAll must be skipped on parse error")
		}
		assertErrorBody(t, rec.Body.Bytes(), "INTERNAL_ERROR")
	})

	t.Run("2xx with empty body is a parse failure (500)", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return []byte(``), http.StatusOK, nil
			},
		}
		h := newHandler(api, &fakeOrderStore{})

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 for empty body", rec.Code)
		}
	})

	t.Run("success parses, replaces, and returns fresh data", func(t *testing.T) {
		fetched := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
		body := ordersBody(t,
			wireOrder{OrderID: "A", Model: "Model Y", Status: "BOOKED", DeliveryDate: strp("2026-07-01"), VIN: strp("VIN-A"), IsUpgradable: true},
			wireOrder{OrderID: "B", Model: "Model 3", Status: "PENDING"},
		)
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) { return body, http.StatusOK, nil },
		}
		// After replace, the store returns the "persisted" rows with fetched_at set.
		fresh := []*teslamodel.TeslaUserOrder{
			{ID: 1, OrderID: "A", Model: "Model Y", Status: "BOOKED", FetchedAt: fetched},
			{ID: 2, OrderID: "B", Model: "Model 3", Status: "PENDING", FetchedAt: fetched},
		}
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) { return fresh, nil },
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		// Persistence received the parsed batch, in order, with fields mapped.
		if len(store.replaceBatches) != 1 {
			t.Fatalf("ReplaceAll batches = %d, want 1", len(store.replaceBatches))
		}
		saved := store.replaceBatches[0]
		if len(saved) != 2 {
			t.Fatalf("saved orders = %d, want 2", len(saved))
		}
		if saved[0].OrderID != "A" || saved[1].OrderID != "B" {
			t.Fatalf("saved order ids = %q,%q want A,B", saved[0].OrderID, saved[1].OrderID)
		}
		if saved[0].DeliveryDate == nil {
			t.Fatalf("saved[0].DeliveryDate = nil, want parsed date")
		}
		if saved[0].VIN == nil || *saved[0].VIN != "VIN-A" {
			t.Fatalf("saved[0].VIN = %v, want VIN-A", saved[0].VIN)
		}
		if !saved[0].IsUpgradable {
			t.Fatalf("saved[0].IsUpgradable = false, want true")
		}
		// Read-path ran exactly once, after persistence.
		if store.getAllCalls != 1 {
			t.Fatalf("GetAll calls = %d, want 1 (read-path after replace)", store.getAllCalls)
		}
		// Response reflects the fresh store data + sync metadata.
		resp := decodeOrdersResp(t, rec.Body.Bytes())
		if len(resp.Orders) != 2 {
			t.Fatalf("response orders = %d, want 2", len(resp.Orders))
		}
		if resp.FetchedAt == nil || *resp.FetchedAt != fetched.Format(time.RFC3339) {
			t.Fatalf("fetched_at = %v, want %q", resp.FetchedAt, fetched.Format(time.RFC3339))
		}
	})

	t.Run("empty tesla response replaces with empty batch then returns fresh data", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
		}
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) { return nil, nil },
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(store.replaceBatches) != 1 {
			t.Fatalf("ReplaceAll batches = %d, want 1", len(store.replaceBatches))
		}
		if len(store.replaceBatches[0]) != 0 {
			t.Fatalf("replace batch = %d entries, want 0", len(store.replaceBatches[0]))
		}
		if !strings.Contains(rec.Body.String(), `"orders":[]`) {
			t.Fatalf("body should contain empty orders array, got %s", rec.Body.String())
		}
	})

	t.Run("malformed entries skipped, valid ones persisted end-to-end", func(t *testing.T) {
		// The middle entry has order_id as a number: the outer array still
		// parses (json.RawMessage), but the inner decode fails and the row is
		// skipped without failing the whole sync.
		raw := []byte(`{"response":[` +
			`{"order_id":"good1","is_upgradable":true},` +
			`{"order_id":12345},` +
			`{"order_id":"good2"}` +
			`]}`)
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) { return raw, http.StatusOK, nil },
		}
		store := &fakeOrderStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if len(store.replaceBatches) != 1 {
			t.Fatalf("ReplaceAll batches = %d, want 1", len(store.replaceBatches))
		}
		saved := store.replaceBatches[0]
		if len(saved) != 2 {
			t.Fatalf("saved = %d, want 2 (malformed entry skipped)", len(saved))
		}
		if saved[0].OrderID != "good1" || saved[1].OrderID != "good2" {
			t.Fatalf("saved ids = %q,%q want good1,good2", saved[0].OrderID, saved[1].OrderID)
		}
	})

	t.Run("ReplaceAll error returns 500 and skips read-path", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return ordersBody(t, wireOrder{OrderID: "A"}), http.StatusOK, nil
			},
		}
		store := &fakeOrderStore{
			replaceFn: func(_ context.Context, _ []*teslamodel.TeslaUserOrder) error {
				return errors.New("constraint violation")
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if store.getAllCalls != 0 {
			t.Fatalf("read-path must not run after ReplaceAll error")
		}
		assertErrorBody(t, rec.Body.Bytes(), "INTERNAL_ERROR")
	})

	t.Run("GetAll error after successful replace returns 500", func(t *testing.T) {
		api := &fakeOrderAPI{
			hasToken: true,
			ordersFn: func(_ context.Context) ([]byte, int, error) {
				return ordersBody(t, wireOrder{OrderID: "A"}), http.StatusOK, nil
			},
		}
		store := &fakeOrderStore{
			getAllFn: func(_ context.Context) ([]*teslamodel.TeslaUserOrder, error) {
				return nil, errors.New("read fail")
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if len(store.replaceBatches) != 1 {
			t.Fatalf("ReplaceAll should have run before the read failed")
		}
	})
}

// TestRefreshOrders_TeslaStatusHandling drives the 2xx/non-2xx boundary of the
// Tesla API response status classification.
func TestRefreshOrders_TeslaStatusHandling(t *testing.T) {
	t.Run("non-2xx maps to 502 and skips persistence", func(t *testing.T) {
		for _, status := range []int{100, 199, 300, 301, 400, 401, 404, 429, 500, 503} {
			status := status
			t.Run(fmt.Sprintf("status_%d", status), func(t *testing.T) {
				api := &fakeOrderAPI{
					hasToken: true,
					ordersFn: func(_ context.Context) ([]byte, int, error) {
						return []byte(`{"error":"x"}`), status, nil
					},
				}
				store := &fakeOrderStore{}
				h := newHandler(api, store)

				rec := httptest.NewRecorder()
				h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

				if rec.Code != http.StatusBadGateway {
					t.Fatalf("tesla status %d -> %d, want 502", status, rec.Code)
				}
				if len(store.replaceBatches) != 0 {
					t.Fatalf("tesla status %d: must not persist on non-2xx", status)
				}
			})
		}
	})

	t.Run("2xx proceeds to persistence and read-path", func(t *testing.T) {
		for _, status := range []int{200, 201, 202, 299} {
			status := status
			t.Run(fmt.Sprintf("status_%d", status), func(t *testing.T) {
				api := &fakeOrderAPI{
					hasToken: true,
					ordersFn: func(_ context.Context) ([]byte, int, error) {
						return ordersBody(t, wireOrder{OrderID: "A"}), status, nil
					},
				}
				store := &fakeOrderStore{}
				h := newHandler(api, store)

				rec := httptest.NewRecorder()
				h.RefreshOrders(rec, httptest.NewRequest(http.MethodPost, "/tesla/user/orders/refresh", nil))

				if rec.Code != http.StatusOK {
					t.Fatalf("tesla status %d -> %d, want 200", status, rec.Code)
				}
				if len(store.replaceBatches) != 1 {
					t.Fatalf("tesla status %d: expected persistence", status)
				}
			})
		}
	})
}
