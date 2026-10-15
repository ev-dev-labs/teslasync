package tco

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestValidateLedgerEntryOK(t *testing.T) {
	e := LedgerEntry{VehicleID: 3, Category: "insurance", Amount: 142.5, Currency: "USD", Incurred: "2026-01-15"}
	if err := ValidateLedgerEntry(e, time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateLedgerEntryRejects(t *testing.T) {
	now := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	base := LedgerEntry{VehicleID: 3, Category: "insurance", Amount: 142.5, Currency: "USD", Incurred: "2026-01-15"}
	cases := map[string]func(*LedgerEntry){
		"bad category":         func(e *LedgerEntry) { e.Category = "yacht" },
		"zero amount":          func(e *LedgerEntry) { e.Amount = 0 },
		"bad currency":         func(e *LedgerEntry) { e.Currency = "usd" },
		"unknown currency":     func(e *LedgerEntry) { e.Currency = "XYZ" },
		"unspecified currency": func(e *LedgerEntry) { e.Currency = "XXX" },
		"bad date":             func(e *LedgerEntry) { e.Incurred = "15/01/2026" },
		"future date":          func(e *LedgerEntry) { e.Incurred = "2028-01-01" },
		"long note":            func(e *LedgerEntry) { e.Note = strings.Repeat("x", 281) },
		"missing veh":          func(e *LedgerEntry) { e.VehicleID = 0 },
	}
	for name, mutate := range cases {
		e := base
		mutate(&e)
		if err := ValidateLedgerEntry(e, now); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
}

func TestSummarizeLedger(t *testing.T) {
	s := SummarizeLedger([]LedgerEntry{
		{Category: "insurance", Amount: 100, Currency: "USD"},
		{Category: "insurance", Amount: 50.5, Currency: "USD"},
		{Category: "tires", Amount: 800, Currency: "USD"},
	})
	if s.GrandTotal == nil || *s.GrandTotal != 950.5 || s.Entries != 3 || s.Currency != "USD" {
		t.Fatalf("unexpected totals: %+v", s)
	}
	if s.ByCategory["insurance"] != 150.5 || s.ByCategory["tires"] != 800 {
		t.Fatalf("unexpected categories: %+v", s.ByCategory)
	}
	if empty := SummarizeLedger(nil); empty.ByCategory == nil || empty.GrandTotal == nil || *empty.GrandTotal != 0 {
		t.Fatalf("empty input must yield empty totals: %+v", empty)
	}
}

func TestLedgerListServesEntriesAndTotals(t *testing.T) {
	store := NewMemoryLedgerStore()
	_ = store.Create(context.Background(), &LedgerEntry{VehicleID: 3, Category: "payment", Amount: 500, Currency: "USD", Incurred: "2026-01-01"})
	h := NewLedgerHandler(store)
	req := httptest.NewRequest(http.MethodGet, "/ledger?vehicle_id=3", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var res struct {
		Entries []LedgerEntry `json:"entries"`
		Totals  LedgerTotals  `json:"totals"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if len(res.Entries) != 1 || res.Totals.GrandTotal == nil || *res.Totals.GrandTotal != 500 {
		t.Fatalf("unexpected list: %+v", res)
	}
}

func TestLedgerCreateRoundTrips(t *testing.T) {
	h := NewLedgerHandler(NewMemoryLedgerStore())
	body := `{"vehicle_id":3,"category":"tires","amount":800,"currency":"USD","incurred_on":"2026-01-10","note":"winter set"}`
	req := httptest.NewRequest(http.MethodPost, "/ledger", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	var e LedgerEntry
	if err := json.NewDecoder(rec.Body).Decode(&e); err != nil {
		t.Fatal(err)
	}
	if e.ID == 0 || e.Category != "tires" || e.Currency != "USD" {
		t.Fatalf("unexpected entry: %+v", e)
	}
}

func TestLedgerCreateRequiresCurrency(t *testing.T) {
	h := NewLedgerHandler(NewMemoryLedgerStore())
	body := `{"vehicle_id":3,"category":"service","amount":60,"incurred_on":"2026-01-10"}`
	req := httptest.NewRequest(http.MethodPost, "/ledger", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

func TestSummarizeLedgerPreservesCurrencies(t *testing.T) {
	for _, code := range []string{"EUR", "", "XYZ", "XXX"} {
		t.Run(code, func(t *testing.T) {
			s := SummarizeLedger([]LedgerEntry{
				{Category: "insurance", Amount: 100, Currency: "USD"},
				{Category: "insurance", Amount: 50, Currency: code},
			})
			if s.GrandTotal != nil || len(s.ByCategory) != 0 || s.Currency != "" || s.Entries != 2 {
				t.Fatalf("mixed or unknown currency must not have a scalar total: %+v", s)
			}
			if s.ByCurrency["USD"].GrandTotal != 100 {
				t.Fatalf("USD source total lost: %+v", s)
			}
			if code == "EUR" && s.ByCurrency["EUR"].GrandTotal != 50 {
				t.Fatalf("EUR source total lost: %+v", s)
			}
		})
	}
}

func TestLedgerCreatePreservesSourceCurrency(t *testing.T) {
	h := NewLedgerHandler(NewMemoryLedgerStore())
	body := `{"vehicle_id":3,"category":"service","amount":60,"currency":"EUR","incurred_on":"2026-01-10"}`
	rec := httptest.NewRecorder()
	h.Create(rec, httptest.NewRequest(http.MethodPost, "/ledger", strings.NewReader(body)))
	var entry LedgerEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusCreated || entry.Currency != "EUR" || entry.Amount != 60 {
		t.Fatalf("source currency not preserved: %d %+v", rec.Code, entry)
	}
}

func TestLedgerDeleteRemoves(t *testing.T) {
	store := NewMemoryLedgerStore()
	e := &LedgerEntry{VehicleID: 3, Category: "other", Amount: 10, Currency: "USD", Incurred: "2026-01-01"}
	_ = store.Create(context.Background(), e)
	h := NewLedgerHandler(store)

	r := chi.NewRouter()
	r.Delete("/ledger/{id}", h.Delete)
	req := httptest.NewRequest(http.MethodDelete, "/ledger/1?vehicle_id=3", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	req2 := httptest.NewRequest(http.MethodDelete, "/ledger/1?vehicle_id=3", nil)
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec2.Code)
	}
}
