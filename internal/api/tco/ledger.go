package tco

import (
	"fmt"
	"math"
	"regexp"
	"time"
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
	if !currencyRe.MatchString(e.Currency) {
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
	ByCategory map[string]float64 `json:"by_category"`
	GrandTotal float64            `json:"grand_total"`
	Entries    int                `json:"entries"`
}

// SummarizeLedger folds entries into per-category totals. Amounts are
// rounded to cents; an empty input yields an empty (non-nil) map.
func SummarizeLedger(entries []LedgerEntry) LedgerTotals {
	t := LedgerTotals{ByCategory: map[string]float64{}, Entries: len(entries)}
	for _, e := range entries {
		t.ByCategory[e.Category] = roundCents(t.ByCategory[e.Category] + e.Amount)
		t.GrandTotal = roundCents(t.GrandTotal + e.Amount)
	}
	return t
}

func roundCents(f float64) float64 { return math.Round(f*100) / 100 }
