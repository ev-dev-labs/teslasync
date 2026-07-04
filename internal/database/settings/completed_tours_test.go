package settings

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// TestNormalizeCompletedTours exercises the defensive cleaning rules the
// settings write path applies to the completed_tours marker list.
func TestNormalizeCompletedTours(t *testing.T) {
	t.Run("nil input returns non-nil empty slice", func(t *testing.T) {
		got := NormalizeCompletedTours(nil)
		if got == nil {
			t.Fatal("expected non-nil slice so JSON marshals to [] not null")
		}
		if len(got) != 0 {
			t.Fatalf("expected empty slice, got %v", got)
		}
	})

	t.Run("trims, drops blanks, de-dupes, preserves order", func(t *testing.T) {
		got := NormalizeCompletedTours([]string{" main:1 ", "", "   ", "main:1", "vehicles:2"})
		want := []string{"main:1", "vehicles:2"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("does not reject unknown tour ids", func(t *testing.T) {
		got := NormalizeCompletedTours([]string{"totally-new-tour:9"})
		want := []string{"totally-new-tour:9"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("drops oversized entries", func(t *testing.T) {
		huge := strings.Repeat("x", maxCompletedTourEntryLen+1)
		got := NormalizeCompletedTours([]string{huge, "ok:1"})
		want := []string{"ok:1"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("caps at MaxCompletedTours", func(t *testing.T) {
		in := make([]string, MaxCompletedTours+50)
		for i := range in {
			in[i] = "tour:" + strings.Repeat("a", 1) + itoa(i)
		}
		got := NormalizeCompletedTours(in)
		if len(got) != MaxCompletedTours {
			t.Fatalf("expected cap at %d, got %d", MaxCompletedTours, len(got))
		}
	})
}

// TestMarshalStringArray proves an empty slice serialises to the JSON array
// "[]" (never the literal null) so the JSONB column always holds a parseable
// array document.
func TestMarshalStringArray(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want string
	}{
		{"nil", nil, "[]"},
		{"empty", []string{}, "[]"},
		{"populated", []string{"main:1", "vehicles:2"}, `["main:1","vehicles:2"]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := marshalStringArray(tc.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestSettingsDefaultsCompletedToursIsEmptyArray proves the GET path baseline
// serialises completed_tours as "[]" (the contract the frontend depends on),
// not null.
func TestSettingsDefaultsCompletedToursIsEmptyArray(t *testing.T) {
	def := settingsDefaults()
	if def.CompletedTours == nil {
		t.Fatal("settingsDefaults().CompletedTours must be non-nil")
	}
	b, err := json.Marshal(def)
	if err != nil {
		t.Fatalf("marshal settings: %v", err)
	}
	if !strings.Contains(string(b), `"completed_tours":[]`) {
		t.Fatalf(`expected "completed_tours":[] in JSON, got: %s`, string(b))
	}
}

// TestApplySettingsRowCompletedTours proves the read path decodes a stored
// JSONB array of markers back onto the typed struct and normalises it.
func TestApplySettingsRowCompletedTours(t *testing.T) {
	s := settingsDefaults()
	// Include a duplicate + blank to confirm the read path normalises too.
	applySettingsRow(s, "completed_tours", "jsonb", nil, nil, nil, []byte(`["main:1"," ","main:1","vehicles:2"]`))
	want := []string{"main:1", "vehicles:2"}
	if !reflect.DeepEqual(s.CompletedTours, want) {
		t.Fatalf("got %v, want %v", s.CompletedTours, want)
	}
}

// TestSettingsCompletedToursJSONRoundTrip proves the wire contract: a PUT body
// carrying completed_tours decodes into the typed struct, and re-encoding
// yields the same JSON array key the frontend reads back.
func TestSettingsCompletedToursJSONRoundTrip(t *testing.T) {
	const body = `{"theme":"neon-cyan","completed_tours":["main:1","vehicles:2"]}`
	var s systemmodel.Settings
	if err := json.Unmarshal([]byte(body), &s); err != nil {
		t.Fatalf("decode PUT body: %v", err)
	}
	if !reflect.DeepEqual(s.CompletedTours, []string{"main:1", "vehicles:2"}) {
		t.Fatalf("decoded CompletedTours = %v", s.CompletedTours)
	}
	out, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("re-encode settings: %v", err)
	}
	if !strings.Contains(string(out), `"completed_tours":["main:1","vehicles:2"]`) {
		t.Fatalf("round-trip lost completed_tours: %s", string(out))
	}
}

// itoa is a tiny allocation-free int-to-string helper for the cap test so the
// test file needs no strconv import churn alongside the existing package deps.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
