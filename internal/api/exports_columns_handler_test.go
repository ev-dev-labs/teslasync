package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/export"
)

func TestExportColumnsHandler_ListColumns(t *testing.T) {
	h := NewExportColumnsHandler()

	t.Run("missing type returns 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/exports/columns", nil)
		rec := httptest.NewRecorder()
		h.ListColumns(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("known type returns catalog with supports_selection true", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/exports/columns?type=drives", nil)
		rec := httptest.NewRecorder()
		h.ListColumns(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var body struct {
			Type              string              `json:"type"`
			Columns           []export.ColumnInfo `json:"columns"`
			SupportsSelection bool                `json:"supports_selection"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if body.Type != "drives" {
			t.Errorf("type = %q, want drives", body.Type)
		}
		if !body.SupportsSelection {
			t.Error("supports_selection = false, want true for known type")
		}
		if len(body.Columns) == 0 {
			t.Error("columns = []; want non-empty drives catalog")
		}
		// Spot-check a known catalog member that the picker UI relies on.
		var foundIDColumn bool
		for _, c := range body.Columns {
			if c.Name == "id" && c.AlwaysIncluded {
				foundIDColumn = true
			}
		}
		if !foundIDColumn {
			t.Error("expected `id` column with always_included:true to be in catalog")
		}
	})

	t.Run("unknown type returns 200 with empty list and supports_selection false", func(t *testing.T) {
		// The endpoint deliberately returns 200/empty rather than 404 so the
		// frontend can ask about every type uniformly without branching on
		// status codes.
		req := httptest.NewRequest(http.MethodGet, "/api/v1/exports/columns?type=does-not-exist", nil)
		rec := httptest.NewRecorder()
		h.ListColumns(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var body struct {
			Type              string              `json:"type"`
			Columns           []export.ColumnInfo `json:"columns"`
			SupportsSelection bool                `json:"supports_selection"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if body.SupportsSelection {
			t.Error("supports_selection = true, want false for unknown type")
		}
		if len(body.Columns) != 0 {
			t.Errorf("columns len = %d, want 0", len(body.Columns))
		}
	})

	t.Run("account type recognised but unsupported", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/exports/columns?type=account", nil)
		rec := httptest.NewRecorder()
		h.ListColumns(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var body struct {
			SupportsSelection bool `json:"supports_selection"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.SupportsSelection {
			t.Error("account exports must report supports_selection:false")
		}
	})
}
