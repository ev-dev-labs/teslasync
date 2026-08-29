package agreement

import (
	"math"
	"testing"
	"time"
)

// base is the shared anchor instant for the pairing tests. Values are chosen
// so every assertion below can be read as "seconds from base".
var pairingBase = time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)

func at(offset time.Duration) time.Time { return pairingBase.Add(offset) }

func floatSample(origin string, offset time.Duration, kind int16, value float64) Sample {
	v := value
	return Sample{
		Field:           "VehicleSpeed",
		Origin:          origin,
		SourceEmittedAt: at(offset),
		Value:           Value{Kind: kind, Float: &v},
	}
}

func intSample(origin string, offset time.Duration, kind int16, value int64) Sample {
	v := value
	return Sample{
		Field:           "ChargeAmps",
		Origin:          origin,
		SourceEmittedAt: at(offset),
		Value:           Value{Kind: kind, Int: &v},
	}
}

// TestAnalyze_ExactSourceTimeMatchWinsOverEarlierNeighbour is the regression
// for the greedy-matching defect: the earliest MQTT sample was inside the
// tolerance window, so the old matcher consumed it and never compared the
// HTTP sample against the MQTT sample carrying the identical producer
// timestamp. The identical-timestamp evidence must win.
func TestAnalyze_ExactSourceTimeMatchWinsOverEarlierNeighbour(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginMQTT, -1500*time.Millisecond, KindFloat, 99),
		floatSample(OriginMQTT, 0, KindFloat, 20),
		floatSample(OriginHTTP, 0, KindDouble, 20),
	}, 2*time.Second)

	if report.Status != StatusMeasured {
		t.Fatalf("status = %q, want %q", report.Status, StatusMeasured)
	}
	if report.ComparablePairs != 1 {
		t.Fatalf("comparable pairs = %d, want 1", report.ComparablePairs)
	}
	if report.AgreeingPairs != 1 || report.DisagreeingPairs != 0 {
		t.Fatalf("agreeing/disagreeing = %d/%d, want 1/0 (exact source time must be paired)",
			report.AgreeingPairs, report.DisagreeingPairs)
	}
}

// TestAnalyze_ExactMatchPreferredAcrossLongCandidateRun proves exact pairing is
// found by an unbounded merge scan, so an exact counterpart is never lost
// because the bounded nearest lookahead would have stopped short of it.
func TestAnalyze_ExactMatchPreferredAcrossLongCandidateRun(t *testing.T) {
	t.Parallel()

	samples := []Sample{floatSample(OriginHTTP, 0, KindDouble, 20)}
	for i := 1; i <= nearestLookaheadLimit*4; i++ {
		samples = append(samples, floatSample(OriginMQTT, -time.Duration(i)*time.Millisecond, KindFloat, 99))
	}
	samples = append(samples, floatSample(OriginMQTT, 0, KindFloat, 20))

	report := Analyze(samples, 2*time.Second)
	if report.ComparablePairs != 1 {
		t.Fatalf("comparable pairs = %d, want 1", report.ComparablePairs)
	}
	if report.AgreeingPairs != 1 {
		t.Fatalf("agreeing pairs = %d, want 1 (the exact-timestamp counterpart must be selected)", report.AgreeingPairs)
	}
}

// TestAnalyze_NearestMatchWithoutExactCounterpart pins the second pass: with no
// identical timestamps, the closest in-tolerance counterpart is used rather
// than the earliest one.
func TestAnalyze_NearestMatchWithoutExactCounterpart(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginMQTT, -1900*time.Millisecond, KindFloat, 99),
		floatSample(OriginMQTT, 100*time.Millisecond, KindFloat, 20),
		floatSample(OriginHTTP, 0, KindDouble, 20),
	}, 2*time.Second)

	if report.ComparablePairs != 1 {
		t.Fatalf("comparable pairs = %d, want 1", report.ComparablePairs)
	}
	if report.AgreeingPairs != 1 {
		t.Fatalf("agreeing pairs = %d, want 1 (nearest source time must be paired)", report.AgreeingPairs)
	}
}

// TestAnalyze_EqualDeltaTieResolvesToEarlierCounterpart pins determinism: two
// candidates equidistant from the HTTP sample must always resolve the same way.
func TestAnalyze_EqualDeltaTieResolvesToEarlierCounterpart(t *testing.T) {
	t.Parallel()

	samples := []Sample{
		floatSample(OriginMQTT, -time.Second, KindFloat, 20),
		floatSample(OriginMQTT, time.Second, KindFloat, 99),
		floatSample(OriginHTTP, 0, KindDouble, 20),
	}
	for i := 0; i < 16; i++ {
		report := Analyze(samples, 2*time.Second)
		if report.ComparablePairs != 1 || report.AgreeingPairs != 1 {
			t.Fatalf("iteration %d: pairs=%d agreeing=%d, want 1/1 (earlier counterpart wins an exact tie)",
				i, report.ComparablePairs, report.AgreeingPairs)
		}
	}
}

// TestAnalyze_MatchingIsOneToOneAndMonotonic proves no sample is reused and
// pairs never cross in time.
func TestAnalyze_MatchingIsOneToOneAndMonotonic(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindDouble, 20),
		floatSample(OriginHTTP, 500*time.Millisecond, KindDouble, 21),
		floatSample(OriginHTTP, time.Second, KindDouble, 22),
		floatSample(OriginMQTT, 0, KindFloat, 20),
		floatSample(OriginMQTT, 500*time.Millisecond, KindFloat, 21),
	}, 2*time.Second)

	if report.ComparablePairs != 2 {
		t.Fatalf("comparable pairs = %d, want 2 (two MQTT samples cannot serve three HTTP samples)", report.ComparablePairs)
	}
	if report.AgreeingPairs != 2 {
		t.Fatalf("agreeing pairs = %d, want 2", report.AgreeingPairs)
	}
	if len(report.Fields) != 1 {
		t.Fatalf("fields = %d, want 1", len(report.Fields))
	}
	if report.Fields[0].HTTPRows != 3 || report.Fields[0].MQTTRows != 2 {
		t.Fatalf("evidence rows = %d/%d, want 3/2 (unpaired evidence stays counted)",
			report.Fields[0].HTTPRows, report.Fields[0].MQTTRows)
	}
}

// TestAnalyze_PairingIsIndependentOfInputOrder pins that the report depends on
// the evidence, not on the order the repository happened to return it in.
func TestAnalyze_PairingIsIndependentOfInputOrder(t *testing.T) {
	t.Parallel()

	ordered := []Sample{
		floatSample(OriginMQTT, -1200*time.Millisecond, KindFloat, 10),
		floatSample(OriginHTTP, -1000*time.Millisecond, KindDouble, 10),
		floatSample(OriginMQTT, 0, KindFloat, 20),
		floatSample(OriginHTTP, 0, KindDouble, 20),
		floatSample(OriginHTTP, 900*time.Millisecond, KindDouble, 31),
		floatSample(OriginMQTT, time.Second, KindFloat, 30),
	}
	reversed := make([]Sample, 0, len(ordered))
	for i := len(ordered) - 1; i >= 0; i-- {
		reversed = append(reversed, ordered[i])
	}

	first := Analyze(ordered, 2*time.Second)
	second := Analyze(reversed, 2*time.Second)

	if first.ComparablePairs != second.ComparablePairs ||
		first.AgreeingPairs != second.AgreeingPairs ||
		first.DisagreeingPairs != second.DisagreeingPairs {
		t.Fatalf("order changed the verdict: %+v vs %+v", first, second)
	}
	if first.ComparablePairs != 3 {
		t.Fatalf("comparable pairs = %d, want 3", first.ComparablePairs)
	}
	if first.AgreeingPairs != 2 || first.DisagreeingPairs != 1 {
		t.Fatalf("agreeing/disagreeing = %d/%d, want 2/1", first.AgreeingPairs, first.DisagreeingPairs)
	}
}

// TestAnalyze_NearestMatchNeverCrossesAnExactMatch protects the monotonic
// invariant across the two passes: an exact anchor partitions the remaining
// samples, so a leftover before the anchor cannot be paired with a leftover
// after it.
func TestAnalyze_NearestMatchNeverCrossesAnExactMatch(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginMQTT, -time.Second, KindFloat, 99),
		floatSample(OriginMQTT, 0, KindFloat, 20),
		floatSample(OriginHTTP, 0, KindDouble, 20),
		floatSample(OriginHTTP, time.Second, KindDouble, 21),
	}, 2*time.Second)

	if report.ComparablePairs != 1 {
		t.Fatalf("comparable pairs = %d, want 1 (crossing the exact anchor is forbidden)", report.ComparablePairs)
	}
	if report.DisagreeingPairs != 0 {
		t.Fatalf("disagreeing pairs = %d, want 0", report.DisagreeingPairs)
	}
}

// TestAnalyze_LegacyFloatKindsAgree is the regression for the persistence
// defect: rows written before value_kind canonicalisation can carry kind 5 for
// one transport and kind 6 for the other for the SAME measurement. Those must
// compare by value.
func TestAnalyze_LegacyFloatKindsAgree(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindDouble, float64(float32(20.118))),
		floatSample(OriginMQTT, 0, KindFloat, 20.118),
	}, 2*time.Second)

	if report.ComparablePairs != 1 {
		t.Fatalf("comparable pairs = %d, want 1", report.ComparablePairs)
	}
	if report.AgreeingPairs != 1 {
		t.Fatalf("agreeing pairs = %d, want 1 (float32 widening must not read as disagreement)", report.AgreeingPairs)
	}
	if report.AgreementPct == nil || *report.AgreementPct != 100 {
		t.Fatalf("agreement = %v, want 100", report.AgreementPct)
	}
}

// TestAnalyze_LegacyFloatKindsStillDetectRealDifferences proves the
// compatibility class did not turn into a blanket "numbers always agree".
func TestAnalyze_LegacyFloatKindsStillDetectRealDifferences(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindDouble, 20.5),
		floatSample(OriginMQTT, 0, KindFloat, 20.4),
	}, 2*time.Second)

	if report.DisagreeingPairs != 1 {
		t.Fatalf("disagreeing pairs = %d, want 1", report.DisagreeingPairs)
	}
	if report.AgreementPct == nil || *report.AgreementPct != 0 {
		t.Fatalf("agreement = %v, want 0", report.AgreementPct)
	}
}

// TestAnalyze_LargeMagnitudeFloat32WideningAgrees covers an odometer-scale SI
// value where float32 representation error is far larger than the absolute
// tolerance and only the relative term can absorb it.
func TestAnalyze_LargeMagnitudeFloat32WideningAgrees(t *testing.T) {
	t.Parallel()

	const meters = 4.2e8
	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindDouble, meters),
		floatSample(OriginMQTT, 0, KindFloat, float64(float32(meters))+40),
	}, 2*time.Second)

	if report.AgreeingPairs != 1 {
		t.Fatalf("agreeing pairs = %d, want 1 (relative tolerance must absorb float32 error at 4.2e8)", report.AgreeingPairs)
	}
}

// TestAnalyze_LegacyIntegerKindsAgree covers the int32/int64 compatibility
// class, which shares the BIGINT column and widens losslessly.
func TestAnalyze_LegacyIntegerKindsAgree(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		intSample(OriginHTTP, 0, KindInt64, 32),
		intSample(OriginMQTT, 0, KindInt32, 32),
	}, 2*time.Second)

	if report.AgreeingPairs != 1 || report.DisagreeingPairs != 0 {
		t.Fatalf("agreeing/disagreeing = %d/%d, want 1/0", report.AgreeingPairs, report.DisagreeingPairs)
	}
}

func TestAnalyze_LegacyIntegerKindsStillDetectRealDifferences(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		intSample(OriginHTTP, 0, KindInt64, 32),
		intSample(OriginMQTT, 0, KindInt32, 16),
	}, 2*time.Second)

	if report.DisagreeingPairs != 1 {
		t.Fatalf("disagreeing pairs = %d, want 1", report.DisagreeingPairs)
	}
}

// TestValuesAgree_KindCompatibilityMatrix is the exhaustive contract for which
// kind pairs may ever be equated. Booleans, text, timestamps, and enum
// ordinals are in no compatibility class.
func TestValuesAgree_KindCompatibilityMatrix(t *testing.T) {
	t.Parallel()

	text := "1"
	truthy := true
	one := int64(1)
	oneFloat := 1.0
	instant := at(0)

	byKind := map[int16]Value{
		KindText:   {Kind: KindText, Text: &text},
		KindBool:   {Kind: KindBool, Bool: &truthy},
		KindInt32:  {Kind: KindInt32, Int: &one},
		KindInt64:  {Kind: KindInt64, Int: &one},
		KindFloat:  {Kind: KindFloat, Float: &oneFloat},
		KindDouble: {Kind: KindDouble, Float: &oneFloat},
		KindEnum:   {Kind: KindEnum, Int: &one},
		KindTime:   {Kind: KindTime, Time: &instant},
	}
	kinds := []int16{KindText, KindBool, KindInt32, KindInt64, KindFloat, KindDouble, KindEnum, KindTime}

	compatible := func(left, right int16) bool {
		if left == right {
			return true
		}
		if isFloatKind(left) && isFloatKind(right) {
			return true
		}
		return isIntegerKind(left) && isIntegerKind(right)
	}

	for _, left := range kinds {
		for _, right := range kinds {
			want := compatible(left, right)
			if got := valuesAgree(byKind[left], byKind[right]); got != want {
				t.Errorf("valuesAgree(kind %d, kind %d) = %v, want %v", left, right, got, want)
			}
		}
	}
}

// TestValuesAgree_EnumIsNotAnInteger states the exclusion explicitly: an enum
// ordinal and a plain integer are different vocabularies even though both live
// in int_value.
func TestValuesAgree_EnumIsNotAnInteger(t *testing.T) {
	t.Parallel()

	value := int64(4)
	enum := Value{Kind: KindEnum, Int: &value}
	integer := Value{Kind: KindInt32, Int: &value}

	if valuesAgree(enum, integer) {
		t.Fatal("an enum ordinal must not be equated with a plain integer")
	}
	if !valuesAgree(enum, enum) {
		t.Fatal("two identical enum ordinals must agree")
	}
}

// TestValuesAgree_InvalidValuesNeverAgree pins that a kind whose typed pointer
// is missing (or a non-finite float) can never be scored as agreement.
func TestValuesAgree_InvalidValuesNeverAgree(t *testing.T) {
	t.Parallel()

	finite := 1.0
	nan := math.NaN()
	inf := math.Inf(-1)

	cases := []struct {
		name  string
		left  Value
		right Value
	}{
		{name: "nil float pointer", left: Value{Kind: KindFloat}, right: Value{Kind: KindFloat, Float: &finite}},
		{name: "NaN float", left: Value{Kind: KindDouble, Float: &nan}, right: Value{Kind: KindFloat, Float: &finite}},
		{name: "infinite float", left: Value{Kind: KindDouble, Float: &inf}, right: Value{Kind: KindFloat, Float: &finite}},
		{name: "unknown kind", left: Value{Kind: 42, Float: &finite}, right: Value{Kind: 42, Float: &finite}},
		{name: "nil int pointer", left: Value{Kind: KindInt32}, right: Value{Kind: KindInt64}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if valuesAgree(tc.left, tc.right) || valuesAgree(tc.right, tc.left) {
				t.Fatal("invalid typed values must never agree")
			}
		})
	}
}

// TestAnalyze_ZeroToleranceRequiresExactSourceTime proves the tolerance floor
// still behaves: with no tolerance only identical producer timestamps pair.
func TestAnalyze_ZeroToleranceRequiresExactSourceTime(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindFloat, 20),
		floatSample(OriginMQTT, time.Millisecond, KindFloat, 20),
	}, 0)

	if report.Status != StatusInsufficientOverlap {
		t.Fatalf("status = %q, want %q", report.Status, StatusInsufficientOverlap)
	}
	if report.ComparablePairs != 0 {
		t.Fatalf("comparable pairs = %d, want 0", report.ComparablePairs)
	}
}

// TestAnalyze_NegativeToleranceIsClamped keeps a nonsensical caller input from
// inverting the comparison window.
func TestAnalyze_NegativeToleranceIsClamped(t *testing.T) {
	t.Parallel()

	report := Analyze([]Sample{
		floatSample(OriginHTTP, 0, KindFloat, 20),
		floatSample(OriginMQTT, 0, KindFloat, 20),
	}, -5*time.Second)

	if report.ComparablePairs != 1 || report.AgreeingPairs != 1 {
		t.Fatalf("pairs/agreeing = %d/%d, want 1/1", report.ComparablePairs, report.AgreeingPairs)
	}
}

// TestAnalyze_DenseWindowStaysBoundedAndDeterministic exercises the bounded
// lookahead on a window far larger than the limit and asserts a stable,
// repeatable verdict.
func TestAnalyze_DenseWindowStaysBoundedAndDeterministic(t *testing.T) {
	t.Parallel()

	const count = 500
	samples := make([]Sample, 0, count*2)
	for i := 0; i < count; i++ {
		offset := time.Duration(i) * time.Millisecond
		samples = append(samples,
			floatSample(OriginHTTP, offset, KindDouble, float64(i)),
			floatSample(OriginMQTT, offset, KindFloat, float64(i)),
		)
	}

	first := Analyze(samples, 2*time.Second)
	second := Analyze(samples, 2*time.Second)

	if first.ComparablePairs != count {
		t.Fatalf("comparable pairs = %d, want %d", first.ComparablePairs, count)
	}
	if first.AgreeingPairs != count {
		t.Fatalf("agreeing pairs = %d, want %d", first.AgreeingPairs, count)
	}
	if first.ComparablePairs != second.ComparablePairs || first.AgreeingPairs != second.AgreeingPairs {
		t.Fatal("repeat analysis produced a different verdict")
	}
}

// TestAnalyze_ReceiptOnlyEvidenceStaysExcluded reaffirms the provenance
// contract while the pairing rules change around it.
func TestAnalyze_ReceiptOnlyEvidenceStaysExcluded(t *testing.T) {
	t.Parallel()

	value := 20.0
	report := Analyze([]Sample{
		{Field: "VehicleSpeed", Origin: OriginHTTP, Value: Value{Kind: KindFloat, Float: &value}},
		floatSample(OriginMQTT, 0, KindFloat, 20),
		{Field: "VehicleSpeed", Origin: "receipt_fallback", SourceEmittedAt: at(0), Value: Value{Kind: KindFloat, Float: &value}},
	}, 2*time.Second)

	if report.InvalidValueRows != 2 {
		t.Fatalf("invalid rows = %d, want 2 (zero source time and unknown origin)", report.InvalidValueRows)
	}
	if report.Status != StatusInsufficientOverlap {
		t.Fatalf("status = %q, want %q", report.Status, StatusInsufficientOverlap)
	}
}

// TestAnalyze_PerFieldIsolation proves pairing never leaks across signals.
func TestAnalyze_PerFieldIsolation(t *testing.T) {
	t.Parallel()

	speed := floatSample(OriginHTTP, 0, KindDouble, 20)
	amps := intSample(OriginMQTT, 0, KindInt32, 20)

	report := Analyze([]Sample{speed, amps}, 2*time.Second)

	if report.ComparablePairs != 0 {
		t.Fatalf("comparable pairs = %d, want 0 (different signals must never pair)", report.ComparablePairs)
	}
	if len(report.Fields) != 2 {
		t.Fatalf("fields = %d, want 2", len(report.Fields))
	}
	for _, field := range report.Fields {
		if field.Status != StatusInsufficientOverlap || field.AgreementPct != nil {
			t.Fatalf("field %s: status=%q pct=%v, want insufficient_overlap/nil", field.Field, field.Status, field.AgreementPct)
		}
	}
}
