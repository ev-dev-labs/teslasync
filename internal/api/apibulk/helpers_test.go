package apibulk_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
)

func mustReq(t *testing.T, body string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "/test/bulk", strings.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	return req
}

func TestDecodeIDsRequest_HappyPath(t *testing.T) {
	got, err := apibulk.DecodeIDsRequest(mustReq(t, `{"ids":[1,2,3]}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := []int64{1, 2, 3}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d", len(got), len(want))
	}
	for i, v := range want {
		if got[i] != v {
			t.Errorf("got[%d] = %d, want %d", i, got[i], v)
		}
	}
}

func TestDecodeIDsRequest_Dedupes(t *testing.T) {
	got, err := apibulk.DecodeIDsRequest(mustReq(t, `{"ids":[1,2,1,3,2]}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := []int64{1, 2, 3}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got %v)", len(got), len(want), got)
	}
}

func TestDecodeIDsRequest_RejectsUnknownFields(t *testing.T) {
	_, err := apibulk.DecodeIDsRequest(mustReq(t, `{"ids":[1],"oops":true}`))
	if !errors.Is(err, apibulk.ErrBodyInvalid) {
		t.Fatalf("err = %v, want ErrBodyInvalid", err)
	}
}

func TestDecodeIDsRequest_RejectsEmpty(t *testing.T) {
	_, err := apibulk.DecodeIDsRequest(mustReq(t, `{"ids":[]}`))
	if !errors.Is(err, apibulk.ErrIDsEmpty) {
		t.Fatalf("err = %v, want ErrIDsEmpty", err)
	}
}

func TestDecodeIDsRequest_RejectsOverCap(t *testing.T) {
	ids := make([]int64, apibulk.MaxIDs+1)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	body, _ := json.Marshal(map[string]any{"ids": ids})
	_, err := apibulk.DecodeIDsRequest(mustReq(t, string(body)))
	if !errors.Is(err, apibulk.ErrIDsTooMany) {
		t.Fatalf("err = %v, want ErrIDsTooMany", err)
	}
}

func TestDecodeIDsRequest_RejectsMalformedJSON(t *testing.T) {
	_, err := apibulk.DecodeIDsRequest(mustReq(t, `not json`))
	if !errors.Is(err, apibulk.ErrBodyInvalid) {
		t.Fatalf("err = %v, want ErrBodyInvalid", err)
	}
}

func TestDecodeOpBody_HappyPath(t *testing.T) {
	got, err := apibulk.DecodeOpBody(mustReq(t, `{"ids":[7,8],"op":"enable"}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Op != "enable" {
		t.Errorf("op = %q, want enable", got.Op)
	}
	if len(got.IDs) != 2 || got.IDs[0] != 7 || got.IDs[1] != 8 {
		t.Errorf("ids = %v, want [7 8]", got.IDs)
	}
}

func TestDecodeOpBody_DedupesIDs(t *testing.T) {
	got, err := apibulk.DecodeOpBody(mustReq(t, `{"ids":[1,1,2],"op":"delete"}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got.IDs) != 2 {
		t.Errorf("len = %d, want 2 (got %v)", len(got.IDs), got.IDs)
	}
}

func TestDecodeOpBody_DoesNotAllowlistOp(t *testing.T) {
	// apibulk is intentionally op-agnostic; resource handlers allowlist.
	got, err := apibulk.DecodeOpBody(mustReq(t, `{"ids":[1],"op":"any-string-goes-here"}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Op != "any-string-goes-here" {
		t.Errorf("op preserved verbatim; got %q", got.Op)
	}
}

func TestDecodeOpBody_RejectsEmpty(t *testing.T) {
	_, err := apibulk.DecodeOpBody(mustReq(t, `{"ids":[],"op":"enable"}`))
	if !errors.Is(err, apibulk.ErrIDsEmpty) {
		t.Fatalf("err = %v, want ErrIDsEmpty", err)
	}
}

func TestDedupeInt64s_PreservesOrder(t *testing.T) {
	got := apibulk.DedupeInt64s([]int64{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5})
	want := []int64{3, 1, 4, 5, 9, 2, 6}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got %v)", len(got), len(want), got)
	}
	for i, v := range want {
		if got[i] != v {
			t.Errorf("got[%d] = %d, want %d", i, got[i], v)
		}
	}
}

func TestDedupeInt64s_EmptyAndSingleton(t *testing.T) {
	if got := apibulk.DedupeInt64s(nil); got != nil {
		t.Errorf("nil in → got %v, want nil", got)
	}
	if got := apibulk.DedupeInt64s([]int64{}); len(got) != 0 {
		t.Errorf("empty in → got %v, want empty", got)
	}
	if got := apibulk.DedupeInt64s([]int64{42}); len(got) != 1 || got[0] != 42 {
		t.Errorf("singleton in → got %v, want [42]", got)
	}
}

func TestComputeMissingIDs_AllPresent(t *testing.T) {
	got := apibulk.ComputeMissingIDs([]int64{1, 2, 3}, []int64{3, 2, 1})
	if len(got) != 0 {
		t.Fatalf("want empty (non-nil); got %v", got)
	}
	// Critical: result must be non-nil so JSON encodes `[]` not `null`.
	if got == nil {
		t.Fatal("result must be non-nil slice for stable JSON encoding")
	}
}

func TestComputeMissingIDs_SomeMissing(t *testing.T) {
	got := apibulk.ComputeMissingIDs([]int64{1, 2, 3, 4}, []int64{2, 4})
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (got %v)", len(got), got)
	}
	// Order must match input order (1, 3), not existing order.
	if got[0].ID != 1 || got[1].ID != 3 {
		t.Errorf("ids = %d,%d; want 1,3", got[0].ID, got[1].ID)
	}
	if got[0].Reason != "not_found" || got[1].Reason != "not_found" {
		t.Errorf("reasons = %q,%q; want not_found,not_found", got[0].Reason, got[1].Reason)
	}
}

func TestComputeMissingIDs_EmptyRequested(t *testing.T) {
	got := apibulk.ComputeMissingIDs(nil, []int64{1, 2, 3})
	if got == nil {
		t.Fatal("must return non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

func TestComputeDeleteFailures(t *testing.T) {
	tests := []struct {
		name      string
		requested []int64
		existing  []int64
		deleted   []int64
		want      []apibulk.FailedID
	}{
		{
			name:      "all deleted",
			requested: []int64{1, 2},
			existing:  []int64{1, 2},
			deleted:   []int64{1, 2},
			want:      []apibulk.FailedID{},
		},
		{
			name:      "missing IDs retain request order",
			requested: []int64{3, 1, 2},
			existing:  []int64{1},
			deleted:   []int64{1},
			want: []apibulk.FailedID{
				{ID: 3, Reason: "not_found"},
				{ID: 2, Reason: "not_found"},
			},
		},
		{
			name:      "concurrent deletion is a conflict",
			requested: []int64{1, 2, 3},
			existing:  []int64{1, 2},
			deleted:   []int64{1},
			want: []apibulk.FailedID{
				{ID: 2, Reason: "conflict"},
				{ID: 3, Reason: "not_found"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := apibulk.ComputeDeleteFailures(tt.requested, tt.existing, tt.deleted); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("ComputeDeleteFailures() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestWriteBadRequest_400FlatShape(t *testing.T) {
	rec := httptest.NewRecorder()
	apibulk.WriteBadRequest(rec, apibulk.ErrIDsEmpty)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content-type = %q, want application/json prefix", ct)
	}
	// Wire-shape: parent's writeError emits {"error":"..."} flat envelope.
	// Frontend's web/src/lib/resilience.ts byte-matches on the "error" key.
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("response body not JSON: %v (%q)", err, rec.Body.String())
	}
	if _, ok := env["error"]; !ok {
		t.Errorf("response missing 'error' field; got keys %v", keysOf(env))
	}
	if msg, _ := env["error"].(string); !strings.Contains(msg, "non-empty array") {
		t.Errorf("error msg %q does not include sentinel text", msg)
	}
}

func TestWriteBadRequest_PreservesNonSentinelMessage(t *testing.T) {
	rec := httptest.NewRecorder()
	custom := errors.New("decoder hit io.EOF mid-stream")
	apibulk.WriteBadRequest(rec, custom)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("decoder hit io.EOF")) {
		t.Errorf("custom error message not propagated: %q", rec.Body.String())
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestSentinelMessages_AreStableAndDistinct(t *testing.T) {
	// Pin the human-readable messages because the frontend may dispatch on
	// substring matches for telemetry classification.
	cases := []struct {
		err  error
		want string
	}{
		{apibulk.ErrBodyInvalid, `invalid request body: expected {"ids":[...]}`},
		{apibulk.ErrIDsEmpty, `ids must be a non-empty array`},
	}
	for _, c := range cases {
		if c.err.Error() != c.want {
			t.Errorf("sentinel msg drift: got %q, want %q", c.err.Error(), c.want)
		}
	}
	// ErrIDsTooMany interpolates MaxIDs — pin via substring.
	if !strings.Contains(apibulk.ErrIDsTooMany.Error(), "exceeds") {
		t.Errorf("ErrIDsTooMany lost 'exceeds' anchor: %q", apibulk.ErrIDsTooMany.Error())
	}
}
