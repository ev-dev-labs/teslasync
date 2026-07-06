package teslachargehist

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

// TestMain silences the package logger so -race output stays readable; the
// handlers log at Info/Warn/Error on every branch under test.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	os.Exit(m.Run())
}

// --- small pointer helpers ---------------------------------------------------

func f64p(v float64) *float64 { return &v }
func strp(v string) *string   { return &v }

func wantStrPtr(t *testing.T, label string, got *string, want string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want %q", label, want)
	}
	if *got != want {
		t.Fatalf("%s = %q, want %q", label, *got, want)
	}
}

func wantF64Ptr(t *testing.T, label string, got *float64, want float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want %v", label, want)
	}
	if *got != want {
		t.Fatalf("%s = %v, want %v", label, *got, want)
	}
}

// --- fakes (consumer-side ports) --------------------------------------------

type historyCall struct {
	vin, startTime, endTime string
	pageNo, pageSize        int
}

// fakeChargeHistoryAPI implements teslaChargeHistoryAPI. Each method records
// its calls so tests can assert wire-up (pagination, date defaulting, etc.).
type fakeChargeHistoryAPI struct {
	historyFn func(ctx context.Context, vin, startTime, endTime string, pageNo, pageSize int) ([]byte, int, error)
	invoiceFn func(ctx context.Context, contentID string) ([]byte, int, error)
	hasToken  bool

	historyCalls []historyCall
	invoiceCalls []string
	tokenChecks  int
}

func (f *fakeChargeHistoryAPI) GetChargingHistory(ctx context.Context, vin, startTime, endTime string, pageNo, pageSize int) ([]byte, int, error) {
	f.historyCalls = append(f.historyCalls, historyCall{vin, startTime, endTime, pageNo, pageSize})
	if f.historyFn == nil {
		return historyPageBytes(false), http.StatusOK, nil
	}
	return f.historyFn(ctx, vin, startTime, endTime, pageNo, pageSize)
}

func (f *fakeChargeHistoryAPI) GetChargingInvoice(ctx context.Context, contentID string) ([]byte, int, error) {
	f.invoiceCalls = append(f.invoiceCalls, contentID)
	if f.invoiceFn == nil {
		return nil, http.StatusOK, nil
	}
	return f.invoiceFn(ctx, contentID)
}

func (f *fakeChargeHistoryAPI) HasValidToken() bool {
	f.tokenChecks++
	return f.hasToken
}

// fakeChargeHistoryStore implements teslaChargeHistoryStore.
type fakeChargeHistoryStore struct {
	getAllFn  func(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingHistoryEntry, error)
	summaryFn func(ctx context.Context, vin string) (*teslamodel.TeslaChargingHistorySummary, error)
	upsertFn  func(ctx context.Context, entries []*teslamodel.TeslaChargingHistoryEntry) (int, error)

	getAllCalls   []historyCall // only vin/limit/offset used
	summaryCalls  []string
	upsertBatches [][]*teslamodel.TeslaChargingHistoryEntry
}

func (f *fakeChargeHistoryStore) GetAll(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
	f.getAllCalls = append(f.getAllCalls, historyCall{vin: vin, pageNo: limit, pageSize: offset})
	if f.getAllFn == nil {
		return nil, nil
	}
	return f.getAllFn(ctx, vin, limit, offset)
}

func (f *fakeChargeHistoryStore) GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingHistorySummary, error) {
	f.summaryCalls = append(f.summaryCalls, vin)
	if f.summaryFn == nil {
		return &teslamodel.TeslaChargingHistorySummary{}, nil
	}
	return f.summaryFn(ctx, vin)
}

func (f *fakeChargeHistoryStore) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaChargingHistoryEntry) (int, error) {
	f.upsertBatches = append(f.upsertBatches, entries)
	if f.upsertFn == nil {
		return len(entries), nil
	}
	return f.upsertFn(ctx, entries)
}

// Static proof the fakes satisfy the ports.
var (
	_ teslaChargeHistoryAPI   = (*fakeChargeHistoryAPI)(nil)
	_ teslaChargeHistoryStore = (*fakeChargeHistoryStore)(nil)
)

// --- wire-shape builders -----------------------------------------------------

// historyPage marshals a Tesla charging-history API page using the real
// wire tags on teslaChargingHistoryItem, so tests exercise the exact
// unmarshalling path production uses.
func historyPage(t *testing.T, hasMore bool, items ...teslaChargingHistoryItem) []byte {
	t.Helper()
	var resp teslaChargingHistoryResponse
	resp.Response.Data = items
	resp.Response.HasMoreData = hasMore
	resp.Response.TotalResults = len(items)
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal history page: %v", err)
	}
	return b
}

func historyPageBytes(hasMore bool) []byte {
	var resp teslaChargingHistoryResponse
	resp.Response.HasMoreData = hasMore
	b, _ := json.Marshal(resp)
	return b
}

func validItem(sessionID int64) teslaChargingHistoryItem {
	return teslaChargingHistoryItem{
		SessionID:           sessionID,
		VIN:                 "5YJ3E1EA1KF000001",
		SiteLocationName:    "Mountain View Supercharger",
		ChargeStartDateTime: "2026-01-02T15:04:05Z",
		ChargeStopDateTime:  "2026-01-02T15:34:05Z",
		Country:             "US",
		State:               "CA",
		County:              "Santa Clara",
		PostalCode:          "94043",
		BillingType:         "IMMEDIATE",
		Fees: []teslaChargingFee{
			{FeeType: "CHARGING", CurrencyCode: "USD", PricingType: "PER_KWH", RateBase: f64p(0.28), UsageBase: f64p(42.5), TotalDue: f64p(11.9)},
		},
		Invoices: []teslaChargingInvoice{{FileName: "inv.pdf", ContentID: "content-abc", InvoiceType: "FINAL"}},
	}
}

// listResponse mirrors the List/Refresh JSON envelope.
type listResponse struct {
	Entries  []*teslamodel.TeslaChargingHistoryEntry `json:"entries"`
	Summary  *teslamodel.TeslaChargingHistorySummary `json:"summary"`
	Upserted *int                                    `json:"upserted"`
}

// ============================================================================
// constructor wiring
// ============================================================================

func TestNewTeslaChargingHistoryHandler_WiresPorts(t *testing.T) {
	// nil deps are fine for a construction smoke test: the repo stores the
	// (nil) pool without dereferencing it and the client pointer is only
	// dereferenced on use. This proves the constructor never leaves a port
	// unset (a nil repo would nil-panic on the first request).
	h := NewTeslaChargingHistoryHandler(&tesla.Client{}, &database.DB{})
	if h == nil {
		t.Fatal("constructor returned nil")
	}
	if h.repo == nil {
		t.Fatal("repo port not wired")
	}
	if h.teslaClient == nil {
		t.Fatal("tesla client port not wired")
	}
}

// ============================================================================
// parseTeslaChargingEntries
// ============================================================================

func TestParseTeslaChargingEntries_Table(t *testing.T) {
	wantStart, _ := time.Parse(time.RFC3339, "2026-01-02T15:04:05Z")
	wantStop, _ := time.Parse(time.RFC3339, "2026-01-02T15:34:05Z")

	tests := []struct {
		name   string
		items  []teslaChargingHistoryItem
		verify func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry)
	}{
		{
			name:  "empty input yields empty non-nil slice",
			items: nil,
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if got == nil {
					t.Fatalf("result = nil, want non-nil empty slice")
				}
				if len(got) != 0 {
					t.Fatalf("len = %d, want 0", len(got))
				}
			},
		},
		{
			name:  "fully populated item maps every field and converts kWh->Wh",
			items: []teslaChargingHistoryItem{validItem(123)},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1", len(got))
				}
				e := got[0]
				if e.SessionID != 123 {
					t.Fatalf("SessionID = %d, want 123", e.SessionID)
				}
				if e.VIN != "5YJ3E1EA1KF000001" {
					t.Fatalf("VIN = %q", e.VIN)
				}
				if e.SiteLocationName != "Mountain View Supercharger" {
					t.Fatalf("SiteLocationName = %q", e.SiteLocationName)
				}
				if !e.ChargeStartDatetime.Equal(wantStart) {
					t.Fatalf("ChargeStartDatetime = %v, want %v", e.ChargeStartDatetime, wantStart)
				}
				if e.ChargeStopDatetime == nil || !e.ChargeStopDatetime.Equal(wantStop) {
					t.Fatalf("ChargeStopDatetime = %v, want %v", e.ChargeStopDatetime, wantStop)
				}
				wantStrPtr(t, "Country", e.Country, "US")
				wantStrPtr(t, "State", e.State, "CA")
				wantStrPtr(t, "County", e.County, "Santa Clara")
				wantStrPtr(t, "PostalCode", e.PostalCode, "94043")
				wantStrPtr(t, "BillingType", e.BillingType, "IMMEDIATE")
				wantStrPtr(t, "FeeType", e.FeeType, "CHARGING")
				wantStrPtr(t, "CurrencyCode", e.CurrencyCode, "USD")
				wantStrPtr(t, "PricingType", e.PricingType, "PER_KWH")
				wantF64Ptr(t, "RateBase", e.RateBase, 0.28)
				// 42.5 kWh -> 42500 Wh (SI on disk).
				wantF64Ptr(t, "UsageWh", e.UsageWh, 42500)
				wantF64Ptr(t, "TotalDue", e.TotalDue, 11.9)
				if !e.HasInvoice {
					t.Fatalf("HasInvoice = false, want true")
				}
				wantStrPtr(t, "InvoiceContentID", e.InvoiceContentID, "content-abc")
			},
		},
		{
			name: "missing stop time leaves ChargeStopDatetime nil",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				ChargeStopDateTime:  "",
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1", len(got))
				}
				if got[0].ChargeStopDatetime != nil {
					t.Fatalf("ChargeStopDatetime = %v, want nil", got[0].ChargeStopDatetime)
				}
			},
		},
		{
			name: "unparseable start time drops the entry",
			items: []teslaChargingHistoryItem{
				{SessionID: 1, ChargeStartDateTime: "not-a-timestamp"},
				{SessionID: 2, ChargeStartDateTime: "2026-01-02T15:04:05Z"},
			},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1 (bad-timestamp row skipped)", len(got))
				}
				if got[0].SessionID != 2 {
					t.Fatalf("SessionID = %d, want 2", got[0].SessionID)
				}
			},
		},
		{
			name: "empty stop time that is unparseable is tolerated (nil stop)",
			items: []teslaChargingHistoryItem{{
				SessionID:           7,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				ChargeStopDateTime:  "garbage",
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if len(got) != 1 {
					t.Fatalf("len = %d, want 1", len(got))
				}
				if got[0].ChargeStopDatetime != nil {
					t.Fatalf("ChargeStopDatetime = %v, want nil on unparseable stop", got[0].ChargeStopDatetime)
				}
			},
		},
		{
			name: "CHARGING fee selected by discriminator not array position",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				Fees: []teslaChargingFee{
					{FeeType: "PARKING", CurrencyCode: "USD", RateBase: f64p(1), UsageBase: f64p(2), TotalDue: f64p(3)},
					{FeeType: "CHARGING", CurrencyCode: "EUR", PricingType: "PER_KWH", RateBase: f64p(0.30), UsageBase: f64p(50), TotalDue: f64p(15)},
				},
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				e := got[0]
				wantStrPtr(t, "FeeType", e.FeeType, "CHARGING")
				wantStrPtr(t, "CurrencyCode", e.CurrencyCode, "EUR")
				wantStrPtr(t, "PricingType", e.PricingType, "PER_KWH")
				wantF64Ptr(t, "RateBase", e.RateBase, 0.30)
				wantF64Ptr(t, "UsageWh", e.UsageWh, 50000)
				wantF64Ptr(t, "TotalDue", e.TotalDue, 15)
			},
		},
		{
			name: "no CHARGING fee falls back to first fee",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				Fees: []teslaChargingFee{
					{FeeType: "PARKING", CurrencyCode: "USD", RateBase: f64p(1), UsageBase: f64p(2), TotalDue: f64p(3)},
					{FeeType: "IDLE", CurrencyCode: "USD", RateBase: f64p(4), UsageBase: f64p(5), TotalDue: f64p(6)},
				},
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				e := got[0]
				wantStrPtr(t, "FeeType", e.FeeType, "PARKING")
				wantF64Ptr(t, "UsageWh", e.UsageWh, 2000)
				wantF64Ptr(t, "TotalDue", e.TotalDue, 3)
			},
		},
		{
			name: "no fees leaves fee fields nil",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				e := got[0]
				if e.FeeType != nil || e.CurrencyCode != nil || e.UsageWh != nil || e.TotalDue != nil {
					t.Fatalf("fee fields should be nil, got FeeType=%v UsageWh=%v", e.FeeType, e.UsageWh)
				}
			},
		},
		{
			name: "nil usage base yields nil UsageWh (no phantom zero)",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				Fees: []teslaChargingFee{
					{FeeType: "CHARGING", CurrencyCode: "USD", RateBase: f64p(0.2), UsageBase: nil, TotalDue: f64p(5)},
				},
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if got[0].UsageWh != nil {
					t.Fatalf("UsageWh = %v, want nil when UsageBase nil", got[0].UsageWh)
				}
				wantF64Ptr(t, "TotalDue", got[0].TotalDue, 5)
			},
		},
		{
			name: "no invoices leaves HasInvoice false and content id nil",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if got[0].HasInvoice {
					t.Fatalf("HasInvoice = true, want false")
				}
				if got[0].InvoiceContentID != nil {
					t.Fatalf("InvoiceContentID = %v, want nil", got[0].InvoiceContentID)
				}
			},
		},
		{
			name: "empty optional location strings stay nil",
			items: []teslaChargingHistoryItem{{
				SessionID:           1,
				ChargeStartDateTime: "2026-01-02T15:04:05Z",
				Country:             "",
				State:               "",
				County:              "",
				PostalCode:          "",
				BillingType:         "",
			}},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				e := got[0]
				if e.Country != nil || e.State != nil || e.County != nil || e.PostalCode != nil || e.BillingType != nil {
					t.Fatalf("empty optional strings must stay nil, got %+v", e)
				}
			},
		},
		{
			name: "multiple items keep distinct per-entry values (no loop aliasing)",
			items: []teslaChargingHistoryItem{
				{SessionID: 1, ChargeStartDateTime: "2026-01-02T15:04:05Z", Country: "US", SiteLocationName: "MV"},
				{SessionID: 2, ChargeStartDateTime: "2026-01-03T15:04:05Z", Country: "CA", SiteLocationName: "TO"},
			},
			verify: func(t *testing.T, got []*teslamodel.TeslaChargingHistoryEntry) {
				if len(got) != 2 {
					t.Fatalf("len = %d, want 2", len(got))
				}
				wantStrPtr(t, "got[0].Country", got[0].Country, "US")
				wantStrPtr(t, "got[1].Country", got[1].Country, "CA")
				if got[0].Country == got[1].Country {
					t.Fatalf("country pointers aliased: both %p", got[0].Country)
				}
				if got[0].SessionID != 1 || got[1].SessionID != 2 {
					t.Fatalf("session IDs = %d,%d want 1,2", got[0].SessionID, got[1].SessionID)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseTeslaChargingEntries(tc.items)
			tc.verify(t, got)
		})
	}
}

// ============================================================================
// kwhPtrToWhPtr
// ============================================================================

func TestKwhPtrToWhPtr_Table(t *testing.T) {
	tests := []struct {
		name string
		in   *float64
		want *float64
	}{
		{"nil stays nil", nil, nil},
		{"zero converts to zero", f64p(0), f64p(0)},
		{"positive kWh scales by 1000", f64p(42.5), f64p(42500)},
		{"fractional kWh scales", f64p(0.001), f64p(1)},
		{"negative passes through scaled", f64p(-2), f64p(-2000)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := kwhPtrToWhPtr(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("got %v, want nil", *got)
			case tc.want != nil && got == nil:
				t.Fatalf("got nil, want %v", *tc.want)
			case tc.want != nil && got != nil && *got != *tc.want:
				t.Fatalf("got %v, want %v", *got, *tc.want)
			}
			// Must return a fresh pointer, not alias the input.
			if tc.in != nil && got != nil && got == tc.in {
				t.Fatalf("returned pointer aliases input")
			}
		})
	}
}

// ============================================================================
// List
// ============================================================================

func TestList(t *testing.T) {
	t.Run("success returns entries and summary and passes pagination+vin", func(t *testing.T) {
		entries := []*teslamodel.TeslaChargingHistoryEntry{{SessionID: 1, VIN: "5YJ"}, {SessionID: 2, VIN: "5YJ"}}
		summary := &teslamodel.TeslaChargingHistorySummary{TotalSessions: 2, TotalWh: f64p(1000), TotalSpend: f64p(20), AvgCostPerKWh: f64p(0.2)}
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return entries, nil
			},
			summaryFn: func(_ context.Context, _ string) (*teslamodel.TeslaChargingHistorySummary, error) {
				return summary, nil
			},
		}
		h := newHandler(&fakeChargeHistoryAPI{}, store)

		rec := httptest.NewRecorder()
		h.List(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history?vin=5YJ&limit=10&offset=5", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
			t.Fatalf("Content-Type = %q", ct)
		}
		var resp listResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
		}
		if len(resp.Entries) != 2 {
			t.Fatalf("entries len = %d, want 2", len(resp.Entries))
		}
		if resp.Summary == nil || resp.Summary.TotalSessions != 2 {
			t.Fatalf("summary = %+v", resp.Summary)
		}
		if len(store.getAllCalls) != 1 || store.getAllCalls[0].vin != "5YJ" || store.getAllCalls[0].pageNo != 10 || store.getAllCalls[0].pageSize != 5 {
			t.Fatalf("GetAll call = %+v, want vin=5YJ limit=10 offset=5", store.getAllCalls)
		}
		if len(store.summaryCalls) != 1 || store.summaryCalls[0] != "5YJ" {
			t.Fatalf("summary calls = %v", store.summaryCalls)
		}
	})

	t.Run("nil entries serialise as empty array not null", func(t *testing.T) {
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return nil, nil
			},
		}
		h := newHandler(&fakeChargeHistoryAPI{}, store)

		rec := httptest.NewRecorder()
		h.List(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"entries":[]`) {
			t.Fatalf("body should contain empty entries array, got %s", rec.Body.String())
		}
	})

	t.Run("GetAll error returns 500 and skips summary", func(t *testing.T) {
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return nil, errors.New("db down")
			},
		}
		h := newHandler(&fakeChargeHistoryAPI{}, store)

		rec := httptest.NewRecorder()
		h.List(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if len(store.summaryCalls) != 0 {
			t.Fatalf("summary should not be queried after GetAll error")
		}
		assertErrorBody(t, rec.Body.Bytes(), "INTERNAL_ERROR")
	})

	t.Run("GetSummary error returns 500", func(t *testing.T) {
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return nil, nil
			},
			summaryFn: func(_ context.Context, _ string) (*teslamodel.TeslaChargingHistorySummary, error) {
				return nil, errors.New("agg fail")
			},
		}
		h := newHandler(&fakeChargeHistoryAPI{}, store)

		rec := httptest.NewRecorder()
		h.List(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})
}

// ============================================================================
// Refresh
// ============================================================================

func TestRefresh(t *testing.T) {
	t.Run("single page upserts parsed entries and returns fresh data", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, false, validItem(1), validItem(2)), http.StatusOK, nil
			},
		}
		final := []*teslamodel.TeslaChargingHistoryEntry{{SessionID: 1}, {SessionID: 2}}
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return final, nil
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh?vin=5YJ", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if len(api.historyCalls) != 1 {
			t.Fatalf("history calls = %d, want 1", len(api.historyCalls))
		}
		if api.historyCalls[0].pageNo != 1 || api.historyCalls[0].pageSize != 50 {
			t.Fatalf("first page call = %+v, want pageNo=1 pageSize=50", api.historyCalls[0])
		}
		if len(store.upsertBatches) != 1 || len(store.upsertBatches[0]) != 2 {
			t.Fatalf("upsert batch = %+v, want one batch of 2", store.upsertBatches)
		}
		var resp listResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp.Upserted == nil || *resp.Upserted != 2 {
			t.Fatalf("upserted = %v, want 2", resp.Upserted)
		}
		if len(resp.Entries) != 2 {
			t.Fatalf("entries = %d, want 2", len(resp.Entries))
		}
	})

	t.Run("omitted dates default to a ~3 month window", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{}
		store := &fakeChargeHistoryStore{}
		h := newHandler(api, store)

		before := time.Now().UTC()
		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))
		after := time.Now().UTC()

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(api.historyCalls) == 0 {
			t.Fatalf("expected a history call")
		}
		start, err := time.Parse(time.RFC3339, api.historyCalls[0].startTime)
		if err != nil {
			t.Fatalf("start not RFC3339: %q (%v)", api.historyCalls[0].startTime, err)
		}
		end, err := time.Parse(time.RFC3339, api.historyCalls[0].endTime)
		if err != nil {
			t.Fatalf("end not RFC3339: %q (%v)", api.historyCalls[0].endTime, err)
		}
		if !start.Before(end) {
			t.Fatalf("start %v not before end %v", start, end)
		}
		// end ≈ now
		if end.Before(before.Add(-time.Minute)) || end.After(after.Add(time.Minute)) {
			t.Fatalf("end %v not within [%v,%v]", end, before, after)
		}
		// start ≈ now - 3 months
		wantStart := before.AddDate(0, -3, 0)
		if start.Before(wantStart.Add(-48*time.Hour)) || start.After(wantStart.Add(48*time.Hour)) {
			t.Fatalf("start %v not ~3 months before now (%v)", start, wantStart)
		}
	})

	t.Run("provided dates pass through verbatim", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		target := "/tesla/charging/history/refresh?start_time=2026-01-01T00:00:00Z&end_time=2026-02-01T00:00:00Z"
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, target, nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if api.historyCalls[0].startTime != "2026-01-01T00:00:00Z" || api.historyCalls[0].endTime != "2026-02-01T00:00:00Z" {
			t.Fatalf("dates = %q..%q, want verbatim passthrough", api.historyCalls[0].startTime, api.historyCalls[0].endTime)
		}
	})

	t.Run("multi-page pagination follows hasMoreData", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, pageNo, _ int) ([]byte, int, error) {
				switch pageNo {
				case 1:
					return historyPage(t, true, validItem(1)), http.StatusOK, nil
				case 2:
					return historyPage(t, false, validItem(2)), http.StatusOK, nil
				default:
					t.Fatalf("unexpected page %d", pageNo)
					return nil, 0, nil
				}
			},
		}
		store := &fakeChargeHistoryStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if len(api.historyCalls) != 2 {
			t.Fatalf("history calls = %d, want 2", len(api.historyCalls))
		}
		if api.historyCalls[1].pageNo != 2 {
			t.Fatalf("second call pageNo = %d, want 2", api.historyCalls[1].pageNo)
		}
		if len(store.upsertBatches[0]) != 2 {
			t.Fatalf("combined upsert = %d entries, want 2", len(store.upsertBatches[0]))
		}
	})

	t.Run("empty page stops pagination even when hasMoreData true", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, true), http.StatusOK, nil // hasMoreData=true but zero rows
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(api.historyCalls) != 1 {
			t.Fatalf("history calls = %d, want 1 (empty data breaks loop)", len(api.historyCalls))
		}
	})

	t.Run("safety limit caps runaway pagination at 100 pages", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, sessionPage, _ int) ([]byte, int, error) {
				// Always claim more data with a non-empty page -> would loop forever
				// without the safety cap.
				return historyPage(t, true, validItem(int64(sessionPage))), http.StatusOK, nil
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(api.historyCalls) != 100 {
			t.Fatalf("history calls = %d, want 100 (safety cap)", len(api.historyCalls))
		}
	})

	t.Run("tesla client error returns 502 and skips upsert", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return nil, 0, errors.New("dial tcp: connection refused")
			},
		}
		store := &fakeChargeHistoryStore{}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
		if len(store.upsertBatches) != 0 {
			t.Fatalf("upsert must be skipped on API error")
		}
	})

	t.Run("non-2xx tesla status returns 502", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return []byte(`{"error":"rate limited"}`), http.StatusTooManyRequests, nil
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
	})

	t.Run("malformed tesla json returns 500", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return []byte(`{not json`), http.StatusOK, nil
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("upsert failure returns 500", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, false, validItem(1)), http.StatusOK, nil
			},
		}
		store := &fakeChargeHistoryStore{
			upsertFn: func(_ context.Context, _ []*teslamodel.TeslaChargingHistoryEntry) (int, error) {
				return 0, errors.New("constraint violation")
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if len(store.getAllCalls) != 0 {
			t.Fatalf("GetAll must not run after upsert failure")
		}
	})

	t.Run("GetAll failure after upsert returns 500", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, false, validItem(1)), http.StatusOK, nil
			},
		}
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return nil, errors.New("read fail")
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("GetSummary failure after upsert returns 500", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, false, validItem(1)), http.StatusOK, nil
			},
		}
		store := &fakeChargeHistoryStore{
			summaryFn: func(_ context.Context, _ string) (*teslamodel.TeslaChargingHistorySummary, error) {
				return nil, errors.New("agg fail")
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("nil fresh entries serialise as empty array", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			historyFn: func(_ context.Context, _, _, _ string, _, _ int) ([]byte, int, error) {
				return historyPage(t, false), http.StatusOK, nil
			},
		}
		store := &fakeChargeHistoryStore{
			getAllFn: func(_ context.Context, _ string, _, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
				return nil, nil
			},
		}
		h := newHandler(api, store)

		rec := httptest.NewRecorder()
		h.Refresh(rec, httptest.NewRequest(http.MethodGet, "/tesla/charging/history/refresh", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"entries":[]`) {
			t.Fatalf("body should contain empty entries array, got %s", rec.Body.String())
		}
	})
}

// ============================================================================
// Invoice
// ============================================================================

// newInvoiceRequest builds a request with the chi {contentID} URL param set.
func newInvoiceRequest(contentID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/tesla/charging/invoice/"+contentID, nil)
	rctx := chi.NewRouteContext()
	if contentID != "" {
		rctx.URLParams.Add("contentID", contentID)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestInvoice(t *testing.T) {
	t.Run("missing content id returns 400 before touching Tesla", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{hasToken: true}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Invoice(rec, newInvoiceRequest(""))

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if len(api.invoiceCalls) != 0 || api.tokenChecks != 0 {
			t.Fatalf("must short-circuit before token/API: invoiceCalls=%d tokenChecks=%d", len(api.invoiceCalls), api.tokenChecks)
		}
		assertErrorBody(t, rec.Body.Bytes(), "BAD_REQUEST")
	})

	t.Run("no valid token returns 401", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{hasToken: false}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Invoice(rec, newInvoiceRequest("content-abc"))

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
		if len(api.invoiceCalls) != 0 {
			t.Fatalf("must not call Tesla without a token")
		}
		assertErrorBody(t, rec.Body.Bytes(), "UNAUTHORIZED")
	})

	t.Run("tesla client error returns 502", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			hasToken:  true,
			invoiceFn: func(_ context.Context, _ string) ([]byte, int, error) { return nil, 0, errors.New("boom") },
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Invoice(rec, newInvoiceRequest("content-abc"))

		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
	})

	t.Run("non-200 tesla status is proxied through", func(t *testing.T) {
		api := &fakeChargeHistoryAPI{
			hasToken: true,
			invoiceFn: func(_ context.Context, _ string) ([]byte, int, error) {
				return []byte("not found"), http.StatusNotFound, nil
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Invoice(rec, newInvoiceRequest("missing"))

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404 (proxied)", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct == "application/pdf" {
			t.Fatalf("error response must not claim application/pdf")
		}
	})

	t.Run("success streams PDF bytes with download headers", func(t *testing.T) {
		pdf := []byte("%PDF-1.7\n...binary...")
		api := &fakeChargeHistoryAPI{
			hasToken: true,
			invoiceFn: func(_ context.Context, contentID string) ([]byte, int, error) {
				if contentID != "content-xyz" {
					t.Fatalf("contentID = %q, want content-xyz", contentID)
				}
				return pdf, http.StatusOK, nil
			},
		}
		h := newHandler(api, &fakeChargeHistoryStore{})

		rec := httptest.NewRecorder()
		h.Invoice(rec, newInvoiceRequest("content-xyz"))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
			t.Fatalf("Content-Type = %q, want application/pdf", ct)
		}
		wantCD := `attachment; filename="tesla-invoice-content-xyz.pdf"`
		if cd := rec.Header().Get("Content-Disposition"); cd != wantCD {
			t.Fatalf("Content-Disposition = %q, want %q", cd, wantCD)
		}
		if got := rec.Body.Bytes(); string(got) != string(pdf) {
			t.Fatalf("body = %q, want %q", got, pdf)
		}
	})
}

// assertErrorBody checks the shared {error,code} JSON error envelope.
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
