package tco

import (
	"fmt"
	"math"
	"regexp"
	"time"

	"golang.org/x/text/currency"
)

// Ledger categories. Stored as free text but validated against this set so
// the UI can render stable labels and the rollup stays meaningful.
const (
	LedgerPayment      = "payment"
	LedgerInsurance    = "insurance"
	LedgerMaintenance  = "maintenance"
	LedgerService      = "service"
	LedgerTires        = "tires"
	LedgerAccessories  = "accessories"
	LedgerDepreciation = "depreciation"
	LedgerOther        = "other"
)

// ValidLedgerCategories is the allowlist for entry categories.
func ValidLedgerCategories() []string {
	return []string{
		LedgerPayment, LedgerInsurance, LedgerMaintenance, LedgerService,
		LedgerTires, LedgerAccessories, LedgerDepreciation, LedgerOther,
	}
}

// LedgerEntry is one fixed-cost row: loan/lease payments, insurance, service,
// tires, or a depreciation estimate the owner records.
type LedgerEntry struct {
	ID        int64   `json:"id"`
	VehicleID int64   `json:"vehicle_id"`
	Category  string  `json:"category"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Incurred  string  `json:"incurred_on"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

// ValidateLedgerEntry rejects malformed rows before persistence. now pins
// the future-date guard so tests are deterministic.
func ValidateLedgerEntry(e LedgerEntry, now time.Time) error {
	if e.VehicleID <= 0 {
		return fmt.Errorf("vehicle_id is required")
	}
	valid := false
	for _, c := range ValidLedgerCategories() {
		if e.Category == c {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("unknown category: %s", e.Category)
	}
	if !(e.Amount > 0) || e.Amount >= 10_000_000 {
		return fmt.Errorf("amount must be positive and below 10,000,000")
	}
	if !validLedgerCurrency(e.Currency) {
		return fmt.Errorf("currency must be a 3-letter ISO code")
	}
	day, err := time.Parse("2006-01-02", e.Incurred)
	if err != nil {
		return fmt.Errorf("incurred_on must be YYYY-MM-DD")
	}
	if day.After(now.AddDate(1, 0, 0)) {
		return fmt.Errorf("incurred_on is too far in the future")
	}
	if len(e.Note) > 280 {
		return fmt.Errorf("note must be at most 280 characters")
	}
	return nil
}

// LedgerTotals is the pure rollup over a vehicle's entries.
type LedgerTotals struct {
	ByCategory map[string]float64              `json:"by_category"`
	GrandTotal *float64                        `json:"grand_total"`
	Entries    int                             `json:"entries"`
	Currency   string                          `json:"currency"`
	ByCurrency map[string]LedgerCurrencyTotals `json:"by_currency"`
}

type LedgerCurrencyTotals struct {
	ByCategory map[string]float64 `json:"by_category"`
	GrandTotal float64            `json:"grand_total"`
}

func validLedgerCurrency(code string) bool {
	if !currencyRe.MatchString(code) || code == "XXX" {
		return false
	}
	_, err := currency.ParseISO(code)
	return err == nil
}

// SummarizeLedger preserves source denominations. A scalar total is only
// available for an empty ledger or one known currency; no FX is inferred.
func SummarizeLedger(entries []LedgerEntry) LedgerTotals {
	zero := 0.0
	t := LedgerTotals{ByCategory: map[string]float64{}, Entries: len(entries),
		GrandTotal: &zero, ByCurrency: map[string]LedgerCurrencyTotals{}}
	unknown := false
	for _, e := range entries {
		if !validLedgerCurrency(e.Currency) {
			unknown = true
			continue
		}
		group := t.ByCurrency[e.Currency]
		if group.ByCategory == nil {
			group.ByCategory = map[string]float64{}
		}
		group.ByCategory[e.Category] = roundCents(group.ByCategory[e.Category] + e.Amount)
		group.GrandTotal = roundCents(group.GrandTotal + e.Amount)
		t.ByCurrency[e.Currency] = group
	}
	if unknown || len(t.ByCurrency) > 1 {
		t.GrandTotal = nil
	} else {
		for code, group := range t.ByCurrency {
			t.Currency = code
			t.ByCategory = group.ByCategory
			total := group.GrandTotal
			t.GrandTotal = &total
		}
	}
	return t
}

func roundCents(f float64) float64 { return math.Round(f*100) / 100 }
