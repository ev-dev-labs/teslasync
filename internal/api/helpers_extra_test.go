package api

import (
	"net/http/httptest"
	"testing"
)

// Tests that complement the existing api_test.go coverage.
//
// TestWriteJSONContentType, TestWriteErrorAllStatusCodes, and
// TestHttpStatusCodeMapping were
// relocated to internal/api/httpx/json_test.go alongside the
// canonical exported helpers they exercise.
//
// TestPaginationBoundary, TestParseDateRangePartial/Invalid/RFC3339/
// RFC3339IncludesPSTEvening/LegacyEndOfDay were relocated to internal/api/apiparams/params_test.go
// alongside the canonical exported helpers (Pagination, ParseDateRange).
//
// The single remaining test in this file is a sanity check that the
// parent pagination() wrapper is wired correctly. Coverage of the
// helpers' actual logic now lives in internal/api/apiparams.

func TestPagination_WrapperWired(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?limit=7&offset=3", nil)
	limit, offset := pagination(r)
	if limit != 7 || offset != 3 {
		t.Errorf("wrapper pagination(r) = (%d, %d), want (7, 3)", limit, offset)
	}
}
