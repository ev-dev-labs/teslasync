package admin

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// requireErr fails the test unless err is non-nil and its message contains
// frag. An empty frag only asserts that some error occurred.
func requireErr(t *testing.T, err error, frag string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error containing %q, got nil", frag)
	}
	if frag != "" && !strings.Contains(err.Error(), frag) {
		t.Fatalf("error %q does not contain %q", err.Error(), frag)
	}
}

// assertArgsEqual compares bound SQL args element-wise. time.Time values are
// compared with Equal (ignoring monotonic-clock / location representation);
// everything else — including pointers and slices — via reflect.DeepEqual,
// which dereferences pointers so i64(42) matches any *int64 pointing at 42.
func assertArgsEqual(t *testing.T, got, want []any) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("args len=%d, want %d (%#v vs %#v)", len(got), len(want), got, want)
	}
	for i := range want {
		if gt, ok := got[i].(time.Time); ok {
			if wt, ok2 := want[i].(time.Time); ok2 {
				if !gt.Equal(wt) {
					t.Errorf("arg[%d] time=%v, want %v", i, gt, wt)
				}
				continue
			}
		}
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Errorf("arg[%d]=%#v, want %#v", i, got[i], want[i])
		}
	}
}
