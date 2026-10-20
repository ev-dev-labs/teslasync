package advancedintelligence

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type chargingCostRows struct {
	pgx.Rows
	row    fakeRow
	read   bool
	closed bool
}

func (r *chargingCostRows) Next() bool {
	if r.read {
		return false
	}
	r.read = true
	return true
}

func (r *chargingCostRows) Scan(destinations ...interface{}) error {
	return r.row.Scan(destinations...)
}

func (r *chargingCostRows) Close()     { r.closed = true }
func (r *chargingCostRows) Err() error { return nil }

type chargingCostDB struct {
	fakeDBTX
	rows *chargingCostRows
}

func (db *chargingCostDB) Query(
	_ context.Context, query string, args ...interface{},
) (pgx.Rows, error) {
	db.lastQuery = query
	db.lastArgs = args
	return db.rows, nil
}

func TestListChargingEvidencePreservesRecordedDenomination(t *testing.T) {
	amount, code := "1.2345", "KWD"
	rows := &chargingCostRows{row: fakeRow{values: []interface{}{
		int64(42), time.Now().UTC(), nil, nil, nil, &amount, &code, 1,
	}}}
	db := &chargingCostDB{rows: rows}
	items, total, err := (&SourceRepository{q: db}).ListChargingEvidence(
		context.Background(), 7, 10, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || total != 1 {
		t.Fatalf("items = %v, total = %d", items, total)
	}
	if items[0].RecordedCostMinor == nil || *items[0].RecordedCostMinor != 1235 {
		t.Fatalf("recorded cost = %v, want 1235", items[0].RecordedCostMinor)
	}
	if items[0].Currency == nil || *items[0].Currency != code {
		t.Fatalf("recorded currency = %v, want %s", items[0].Currency, code)
	}
	if !strings.Contains(db.lastQuery, "cost_decimal::text") ||
		strings.Contains(db.lastQuery, "cost_decimal * 100") {
		t.Fatal("query must preserve the decimal cost for currency-aware denomination")
	}
	if !rows.closed {
		t.Fatal("rows were not closed")
	}
}

func TestChargingCostMinor(t *testing.T) {
	text := func(value string) *string { return &value }
	tests := []struct {
		name   string
		amount *string
		code   *string
		want   int64
		known  bool
	}{
		{"missing amount", nil, text("USD"), 0, false},
		{"missing currency", text("0"), nil, 0, false},
		{"blank currency", text("0"), text(" "), 0, false},
		{"invalid currency", text("0"), text("INVALID"), 0, false},
		{"unknown currency", text("0"), text("XXX"), 0, false},
		{"invalid amount", text("invalid"), text("USD"), 0, false},
		{"empty amount", text(""), text("USD"), 0, false},
		{"NaN", text("NaN"), text("USD"), 0, false},
		{"infinity", text("Infinity"), text("USD"), 0, false},
		{"overflow", text("9223372036854775808"), text("JPY"), 0, false},
		{"measured zero", text("0.0000"), text("USD"), 0, true},
		{"positive", text("12"), text("USD"), 1200, true},
		{"negative", text("-12"), text("EUR"), -1200, true},
		{"fraction", text("1.2349"), text("USD"), 123, true},
		{"positive tie", text("1.005"), text("USD"), 101, true},
		{"negative tie", text("-1.005"), text("USD"), -101, true},
		{"sub minor zero", text("0.004"), text("USD"), 0, true},
		{"zero decimal currency", text("12.5"), text("JPY"), 13, true},
		{"zero decimal negative", text("-12.5"), text("JPY"), -13, true},
		{"three decimal currency", text("1.2345"), text("KWD"), 1235, true},
		{"four decimal currency", text("1.2345"), text("CLF"), 12345, true},
		{"trim recorded code", text("1.23"), text(" EUR "), 123, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := chargingCostMinor(tt.amount, tt.code)
			if (got != nil) != tt.known {
				t.Fatalf("cost = %v, known = %v", got, tt.known)
			}
			if got != nil && *got != tt.want {
				t.Fatalf("cost = %d, want %d", *got, tt.want)
			}
		})
	}
}
