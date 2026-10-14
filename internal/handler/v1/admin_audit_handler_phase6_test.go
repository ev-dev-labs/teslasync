package v1

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/auditviewersvc"
)

type phase6AuditViewer struct {
	queries []auditviewersvc.Query
	rows    []auditviewersvc.Row
	err     error
}

func (s *phase6AuditViewer) Query(_ context.Context, q auditviewersvc.Query) ([]auditviewersvc.Row, error) {
	s.queries = append(s.queries, q)
	return s.rows, s.err
}

func (*phase6AuditViewer) DistinctCategories(context.Context) ([]string, error) {
	return nil, auditviewersvc.ErrNotConfigured
}

func (*phase6AuditViewer) DistinctActions(context.Context) ([]string, error) {
	return nil, auditviewersvc.ErrNotConfigured
}

func (*phase6AuditViewer) VerifyChain(context.Context, time.Time, int) (int64, int, error) {
	return 0, 0, auditviewersvc.ErrNotConfigured
}

func phase6AuditRequest(svc adminAuditService, query string) *httptest.ResponseRecorder {
	router := chi.NewRouter()
	(&AdminAuditHandler{svc: svc}).Register(router)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/audit-log"+query, nil))
	return rec
}

func phase6AuditRows(t *testing.T, rec *httptest.ResponseRecorder) []map[string]json.RawMessage {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response envelope: %v", err)
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(envelope["data"], &data); err != nil {
		t.Fatalf("decode response data: %v", err)
	}
	if string(data["limit"]) != "100" {
		t.Errorf("limit = %s, want 100", data["limit"])
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(data["rows"], &rows); err != nil {
		t.Fatalf("decode response rows: %v", err)
	}
	return rows
}

func TestAdminAuditPhase6ZeroBasedOffsets(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name  string
		query string
		want  int
	}{
		{"missing", "", 0},
		{"zero", "?offset=0", 0},
		{"one", "?offset=1", 1},
		{"last row of first page", "?offset=99", 99},
		{"second page", "?offset=100", 100},
		{"third page", "?offset=200", 200},
		{"negative", "?offset=-1", 0},
		{"invalid", "?offset=invalid", 0},
		{"overflow", "?offset=999999999999999999999999999999", 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc := &phase6AuditViewer{rows: []auditviewersvc.Row{}}
			rows := phase6AuditRows(t, phase6AuditRequest(svc, tt.query))
			if len(svc.queries) != 1 {
				t.Fatalf("query calls = %d, want 1", len(svc.queries))
			}
			if got := svc.queries[0].Offset; got != tt.want {
				t.Errorf("offset forwarded = %d, want %d", got, tt.want)
			}
			if rows == nil || len(rows) != 0 {
				t.Errorf("empty result = %v, want []", rows)
			}
		})
	}
}

func TestAdminAuditPhase6FiltersPreserved(t *testing.T) {
	t.Parallel()
	svc := &phase6AuditViewer{rows: []auditviewersvc.Row{}}
	phase6AuditRows(t, phase6AuditRequest(svc,
		"?offset=100&since=2026-10-01T00:00:00Z&until=2026-10-02T00:00:00Z"+
			"&categories=admin,%20auth,,&actors=alice,bob&actions=login,update&entity_type=vehicle&entity_id=7"))
	if len(svc.queries) != 1 {
		t.Fatalf("query calls = %d, want 1", len(svc.queries))
	}
	q := svc.queries[0]
	if q.Offset != 100 || q.Limit != 100 {
		t.Errorf("pagination = %d/%d, want 100/100", q.Limit, q.Offset)
	}
	if !q.Since.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) ||
		!q.Until.Equal(time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("range = %v/%v", q.Since, q.Until)
	}
	if !reflect.DeepEqual(q.Categories, []string{"admin", "auth"}) ||
		!reflect.DeepEqual(q.Actors, []string{"alice", "bob"}) ||
		!reflect.DeepEqual(q.Actions, []string{"login", "update"}) {
		t.Errorf("filters = %v/%v/%v", q.Categories, q.Actors, q.Actions)
	}
	if q.EntityType != "vehicle" || q.EntityID == nil || *q.EntityID != 7 {
		t.Errorf("entity filter = %s/%v", q.EntityType, q.EntityID)
	}
}

func TestAdminAuditPhase6EvidenceWireContract(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		raw  []byte
	}{
		{"missing", nil},
		{"empty", []byte{}},
		{"object", []byte(`{"enabled":false,"count":0}`)},
		{"array", []byte(`[0,false,null,{"nested":"value"}]`)},
		{"explicit null", []byte(`null`)},
		{"false", []byte(`false`)},
		{"zero", []byte(`0`)},
		{"JSON empty string", []byte(`""`)},
		{"large number and whitespace", []byte(" \n{\"id\":9007199254740993,\"n\":1e+30}\t")},
		{"invalid JSON", []byte(`{"incomplete":`)},
		{"raw text", []byte("not JSON\nraw evidence")},
		{"whitespace only", []byte(" \n\t")},
		{"base64-looking raw text", []byte("eyJjb3VudCI6MH0=")},
		{"Unicode and escaping", []byte("{\"text\":\"車 <tag> & \\\"quoted\\\" \\\\path\"}")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			category, traceID, rowHash := "admin", "synthetic-trace", "synthetic-hash"
			entityID, success := int64(7), false
			row := auditviewersvc.Row{
				ID: 1, Ts: time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC),
				Actor: "synthetic-actor", Action: "update", Category: &category,
				EntityType: "vehicle", EntityID: &entityID, TraceID: &traceID,
				RowHash: &rowHash, Success: &success, Before: tt.raw, After: tt.raw,
			}
			svc := &phase6AuditViewer{rows: []auditviewersvc.Row{row}}
			rows := phase6AuditRows(t, phase6AuditRequest(svc, ""))
			if len(rows) != 1 {
				t.Fatalf("rows = %d, want 1", len(rows))
			}
			for _, key := range []string{"before", "after"} {
				raw, present := rows[0][key]
				if len(tt.raw) == 0 {
					if present {
						t.Errorf("%s = %s, want omitted missing evidence", key, raw)
					}
					continue
				}
				if !present {
					t.Fatalf("%s missing nonempty evidence", key)
				}
				var text string
				if err := json.Unmarshal(raw, &text); err != nil {
					t.Fatalf("%s must be a JSON string: %s (%v)", key, raw, err)
				}
				if text != string(tt.raw) {
					t.Errorf("%s = %q, want original raw text %q", key, text, tt.raw)
				}
			}
			for key, want := range map[string]string{
				"id": "1", "ts": `"2026-10-14T00:00:00Z"`, "actor": `"synthetic-actor"`,
				"action": `"update"`, "category": `"admin"`, "entity_type": `"vehicle"`,
				"entity_id": "7", "trace_id": `"synthetic-trace"`, "row_hash": `"synthetic-hash"`,
				"success": "false",
			} {
				if got := string(rows[0][key]); got != want {
					t.Errorf("%s = %s, want %s", key, got, want)
				}
			}
			for _, key := range []string{"detail", "ip", "user_agent", "prev_row_hash"} {
				if _, present := rows[0][key]; present {
					t.Errorf("%s must remain omitted when nil", key)
				}
			}
		})
	}
}

func TestAdminAuditPhase6EvidenceSidesIndependent(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name          string
		before, after []byte
	}{
		{"before only", []byte(`null`), nil},
		{"after only", nil, []byte(`{"created":true}`)},
		{"different values", []byte(`{"old":0}`), []byte(`{"new":false}`)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc := &phase6AuditViewer{rows: []auditviewersvc.Row{{Before: tt.before, After: tt.after}}}
			rows := phase6AuditRows(t, phase6AuditRequest(svc, ""))
			if len(rows) != 1 {
				t.Fatalf("rows = %d, want 1", len(rows))
			}
			for key, want := range map[string][]byte{"before": tt.before, "after": tt.after} {
				raw, present := rows[0][key]
				if len(want) == 0 {
					if present {
						t.Errorf("%s should be omitted, got %s", key, raw)
					}
					continue
				}
				var got string
				if err := json.Unmarshal(raw, &got); err != nil || got != string(want) {
					t.Errorf("%s = %s (%v), want text %q", key, raw, err, want)
				}
			}
		})
	}
}

func TestAdminAuditPhase6FailureResponsesPreserved(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		err  error
		code int
		want string
	}{
		{"not configured", auditviewersvc.ErrNotConfigured, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED"},
		{"query failure", errors.New("synthetic failure"), http.StatusInternalServerError, "AUDIT_QUERY_FAILED"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := phase6AuditRequest(&phase6AuditViewer{err: tt.err}, "")
			if rec.Code != tt.code || !strings.Contains(rec.Body.String(), tt.want) {
				t.Errorf("response = %d %s, want %d %s", rec.Code, rec.Body.String(), tt.code, tt.want)
			}
		})
	}
	rec := phase6AuditRequest(auditviewersvc.New(nil, nil), "")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "SUBSYSTEM_NOT_CONFIGURED") {
		t.Errorf("unconfigured real service = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	NewAdminAuditHandler(nil).List(rec, httptest.NewRequest(http.MethodGet, "/admin/audit-log", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "SUBSYSTEM_NOT_CONFIGURED") {
		t.Errorf("nil real service = %d %s", rec.Code, rec.Body.String())
	}
}
