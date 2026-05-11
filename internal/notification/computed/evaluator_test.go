package computed

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeMetric returns a fixed value irrespective of window — keeps tests
// free of real database calls. The lastWindow field lets tests assert
// that the evaluator passed the right [start, end) bounds.
type fakeMetric struct {
	id      string
	value   float64
	prev    float64 // value to return when called with previous-window bounds
	windows []string
	calls   int
	lastCur [2]time.Time
	lastPrv [2]time.Time
}

func (f *fakeMetric) def(now func() time.Time) MetricDef {
	current := now() // captured up-front so previous-window detection is stable
	return MetricDef{
		ID:      f.id,
		Label:   "Fake " + f.id,
		Unit:    "x",
		Windows: f.windows,
		Compute: func(_ context.Context, _ *database.DB, _ int64, start, end time.Time) (float64, error) {
			f.calls++
			if !current.IsZero() && end.Before(current.UTC().Add(-1*time.Second)) || end.Equal(f.lastCur[0]) {
				f.lastPrv = [2]time.Time{start, end}
				return f.prev, nil
			}
			f.lastCur = [2]time.Time{start, end}
			return f.value, nil
		},
	}
}

func ptrStr(s string) *string { return &s }
func ptrF(v float64) *float64 { return &v }

func newComputedRule(id int64, metric, window, op string, threshold float64) *models.AlertRule {
	return &models.AlertRule{
		ID:              id,
		Name:            "test-" + metric,
		Enabled:         true,
		Severity:        "warn",
		CooldownMin:     15,
		TriggerMode:     "repeat",
		Kind:            models.AlertRuleKindComputedMetric,
		MetricID:        ptrStr(metric),
		MetricWindow:    ptrStr(window),
		MetricThreshold: ptrF(threshold),
		MetricOp:        ptrStr(op),
	}
}

func TestComputedMetric_WindowBounds(t *testing.T) {
	now := time.Date(2026, 5, 15, 14, 30, 0, 0, time.UTC) // Friday
	cases := []struct {
		window    string
		wantStart time.Time
	}{
		{"day", time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)},
		{"week", time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)}, // Monday before
		{"month", time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)},
		{"rolling_7d", now.Add(-7 * 24 * time.Hour)},
		{"rolling_30d", now.Add(-30 * 24 * time.Hour)},
	}
	for _, c := range cases {
		t.Run(c.window, func(t *testing.T) {
			start, end, err := WindowBounds(c.window, now)
			if err != nil {
				t.Fatalf("WindowBounds(%q): %v", c.window, err)
			}
			if !start.Equal(c.wantStart) {
				t.Errorf("start = %v, want %v", start, c.wantStart)
			}
			if !end.Equal(now) {
				t.Errorf("end = %v, want now=%v", end, now)
			}
		})
	}
}

func TestComputedMetric_WindowBounds_WeekSundayWraps(t *testing.T) {
	now := time.Date(2026, 5, 17, 12, 0, 0, 0, time.UTC) // Sunday
	start, _, err := WindowBounds("week", now)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC) // Monday
	if !start.Equal(want) {
		t.Errorf("week start = %v, want %v", start, want)
	}
}

func TestComputedMetric_WindowBounds_Unknown(t *testing.T) {
	if _, _, err := WindowBounds("garbage", time.Now()); err == nil {
		t.Fatal("expected error for unknown window")
	}
}

func TestComputedMetric_PreviousWindowBounds(t *testing.T) {
	now := time.Date(2026, 5, 15, 14, 30, 0, 0, time.UTC) // Friday
	t.Run("day", func(t *testing.T) {
		start, end, err := PreviousWindowBounds("day", now)
		if err != nil {
			t.Fatal(err)
		}
		if !end.Equal(time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("end = %v", end)
		}
		if !start.Equal(time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("start = %v", start)
		}
	})
	t.Run("month", func(t *testing.T) {
		start, end, err := PreviousWindowBounds("month", now)
		if err != nil {
			t.Fatal(err)
		}
		if !start.Equal(time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("start = %v", start)
		}
		if !end.Equal(time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("end = %v", end)
		}
	})
	t.Run("rolling_7d", func(t *testing.T) {
		start, end, err := PreviousWindowBounds("rolling_7d", now)
		if err != nil {
			t.Fatal(err)
		}
		if !end.Equal(now.Add(-7 * 24 * time.Hour)) {
			t.Errorf("end = %v, want %v", end, now.Add(-7*24*time.Hour))
		}
		if !start.Equal(now.Add(-14 * 24 * time.Hour)) {
			t.Errorf("start = %v, want %v", start, now.Add(-14*24*time.Hour))
		}
	})
}

func TestComputedMetric_CompareMetric(t *testing.T) {
	cases := []struct {
		op      string
		v, t    float64
		want    bool
		wantErr bool
	}{
		{">", 10, 5, true, false},
		{">", 5, 10, false, false},
		{">=", 5, 5, true, false},
		{"<", 1, 2, true, false},
		{"<=", 5, 5, true, false},
		{"=", 5, 5, true, false},
		{"!=", 5, 6, true, false},
		{"garbage", 5, 5, false, true},
	}
	for _, c := range cases {
		got, err := CompareMetric(c.op, c.v, c.t)
		if (err != nil) != c.wantErr {
			t.Errorf("CompareMetric(%q): err = %v, wantErr %v", c.op, err, c.wantErr)
			continue
		}
		if got != c.want {
			t.Errorf("CompareMetric(%q,%v,%v) = %v, want %v", c.op, c.v, c.t, got, c.want)
		}
	}
}

func TestComputedMetric_ComparePercentChange(t *testing.T) {
	matched, pct, err := ComparePercentChange("%_change_>", 150, 100, 20)
	if err != nil {
		t.Fatal(err)
	}
	if !matched {
		t.Errorf("expected match: 50%% > 20%%")
	}
	if pct < 49.99 || pct > 50.01 {
		t.Errorf("pct = %v, want ~50", pct)
	}

	matched, _, err = ComparePercentChange("%_change_<", 50, 100, -20)
	if err != nil {
		t.Fatal(err)
	}
	if !matched {
		t.Errorf("expected match: -50%% < -20%%")
	}

	matched, _, err = ComparePercentChange("%_change_>", 100, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if matched {
		t.Errorf("expected no match when previous = 0")
	}
}

func TestComputedMetric_ComparePercentChange_RejectsNonPctOp(t *testing.T) {
	_, _, err := ComparePercentChange(">", 1, 1, 1)
	if err == nil {
		t.Fatal("expected error for non-pct op")
	}
}

func TestComputedMetric_Evaluator_Triggers(t *testing.T) {
	now := time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
	fake := &fakeMetric{id: "test_metric", value: 250, windows: []string{"day", "month"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return now })}
	ev := NewWithRegistry(registry, func() time.Time { return now })

	rule := newComputedRule(1, "test_metric", "month", ">", 200)
	res, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	if !res.Triggered {
		t.Fatalf("expected triggered, got %+v", res)
	}
	if res.Value != 250 {
		t.Errorf("Value = %v, want 250", res.Value)
	}
	if res.Message == "" {
		t.Error("expected non-empty message")
	}
}

func TestComputedMetric_Evaluator_DoesNotTriggerWhenBelow(t *testing.T) {
	now := time.Now().UTC()
	fake := &fakeMetric{id: "metric_a", value: 100, windows: []string{"month"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return now })}
	ev := NewWithRegistry(registry, func() time.Time { return now })

	rule := newComputedRule(1, "metric_a", "month", ">", 200)
	res, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil {
		t.Fatal(err)
	}
	if res.Triggered {
		t.Errorf("expected not triggered, got %+v", res)
	}
	if res.Value != 100 {
		t.Errorf("Value = %v, want 100", res.Value)
	}
}

func TestComputedMetric_Evaluator_RespectsCooldown(t *testing.T) {
	now := time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
	currentNow := now
	fake := &fakeMetric{id: "metric_cd", value: 250, windows: []string{"month"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return currentNow })}
	ev := NewWithRegistry(registry, func() time.Time { return currentNow })

	rule := newComputedRule(2, "metric_cd", "month", ">", 200)
	rule.CooldownMin = 30

	first, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil || !first.Triggered {
		t.Fatalf("first eval should trigger: %+v err=%v", first, err)
	}

	currentNow = now.Add(5 * time.Minute)
	second, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil {
		t.Fatal(err)
	}
	if second.Triggered {
		t.Errorf("expected cooldown suppression, got triggered=%v", second.Triggered)
	}

	currentNow = now.Add(31 * time.Minute)
	third, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil {
		t.Fatal(err)
	}
	if !third.Triggered {
		t.Errorf("expected refire after cooldown, got triggered=%v", third.Triggered)
	}
}

func TestComputedMetric_Evaluator_RespectsSnooze(t *testing.T) {
	now := time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
	fake := &fakeMetric{id: "metric_snz", value: 250, windows: []string{"month"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return now })}
	ev := NewWithRegistry(registry, func() time.Time { return now })

	rule := newComputedRule(3, "metric_snz", "month", ">", 200)
	until := now.Add(time.Hour)
	rule.SnoozedUntil = &until

	res, err := ev.Evaluate(context.Background(), rule, 7)
	if err != nil {
		t.Fatal(err)
	}
	if res.Triggered {
		t.Errorf("snoozed rule should not trigger")
	}
	if res.Value != 250 {
		t.Errorf("Value = %v, want 250 (computed even when snoozed)", res.Value)
	}
}

func TestComputedMetric_Evaluator_UnknownMetric(t *testing.T) {
	ev := NewWithRegistry(map[string]MetricDef{}, nil)
	rule := newComputedRule(1, "nonexistent", "month", ">", 1)
	_, err := ev.Evaluate(context.Background(), rule, 7)
	if err == nil {
		t.Fatal("expected error for unknown metric")
	}
	if !errors.Is(err, ErrUnknownMetric) {
		t.Errorf("expected ErrUnknownMetric, got %v", err)
	}
}

func TestComputedMetric_Evaluator_RejectsBadKind(t *testing.T) {
	ev := NewWithRegistry(map[string]MetricDef{}, nil)
	rule := newComputedRule(1, "x", "month", ">", 1)
	rule.Kind = "signal"
	if _, err := ev.Evaluate(context.Background(), rule, 7); err == nil {
		t.Fatal("expected error when evaluating non-computed_metric rule")
	}
}

func TestComputedMetric_Evaluator_InvalidWindow(t *testing.T) {
	now := time.Now().UTC()
	fake := &fakeMetric{id: "narrow", value: 1, windows: []string{"day"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return now })}
	ev := NewWithRegistry(registry, func() time.Time { return now })

	rule := newComputedRule(1, "narrow", "month", ">", 0)
	if _, err := ev.Evaluate(context.Background(), rule, 7); err == nil {
		t.Fatal("expected error for disallowed window")
	}
}

func TestComputedMetric_Preview_BypassesCooldownAndSnooze(t *testing.T) {
	now := time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
	fake := &fakeMetric{id: "preview_metric", value: 500, windows: []string{"month"}}
	registry := map[string]MetricDef{fake.id: fake.def(func() time.Time { return now })}
	ev := NewWithRegistry(registry, func() time.Time { return now })

	rule := newComputedRule(1, "preview_metric", "month", ">", 200)
	until := now.Add(time.Hour)
	rule.SnoozedUntil = &until

	res, matched, err := ev.Preview(context.Background(), rule, 7)
	if err != nil {
		t.Fatal(err)
	}
	if !matched {
		t.Errorf("preview should report matched=true regardless of snooze")
	}
	if res.Value != 500 {
		t.Errorf("Value = %v, want 500", res.Value)
	}
}

func TestComputedMetric_ListMetricSummaries_Stable(t *testing.T) {
	got := ListMetricSummaries()
	if len(got) == 0 {
		t.Fatal("expected at least one metric")
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].ID >= got[i].ID {
			t.Errorf("ListMetricSummaries not sorted: %s before %s", got[i-1].ID, got[i].ID)
		}
	}
	found := false
	for _, m := range got {
		if m.ID == "charging_cost" {
			found = true
			if len(m.Ops) == 0 {
				t.Errorf("expected ops list to be populated for %s", m.ID)
			}
			if len(m.Windows) == 0 {
				t.Errorf("expected windows list to be populated for %s", m.ID)
			}
		}
	}
	if !found {
		t.Errorf("expected charging_cost in metric registry")
	}
}

func TestComputedMetric_IsValidComputedMetricOp(t *testing.T) {
	for _, op := range ComputedMetricOps {
		if !IsValidComputedMetricOp(op) {
			t.Errorf("expected %q to be valid", op)
		}
	}
	if IsValidComputedMetricOp("garbage") {
		t.Error("expected garbage to be invalid")
	}
}
