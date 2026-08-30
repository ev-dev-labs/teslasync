package agreement

import (
	"math"
	"sort"
	"time"
)

const (
	OriginHTTP = "fleet_telemetry_http"
	OriginMQTT = "fleet_telemetry_mqtt"

	StatusMeasured            = "measured"
	StatusInsufficientOverlap = "insufficient_overlap"
	StatusNoEvidence          = "no_evidence"

	floatAbsoluteTolerance = 1e-5
	// floatRelativeTolerance is deliberately larger than float32 epsilon
	// (1.19e-7): a float32 observation widened to float64 for storage carries
	// a relative representation error of that magnitude, and the same physical
	// measurement attested by both transports must not be reported as a
	// disagreement because one transport used the narrower wire type.
	floatRelativeTolerance = 1e-6
)

// Value kind discriminators follow migration 000186, which mirrors
// protomodel.ValueKind. They are named here so the comparison rules below
// read as intent instead of as magic numbers.
const (
	KindText   int16 = 1
	KindBool   int16 = 2
	KindInt32  int16 = 3
	KindInt64  int16 = 4
	KindFloat  int16 = 5
	KindDouble int16 = 6
	KindEnum   int16 = 7
	KindTime   int16 = 9
)

// nearestLookaheadLimit bounds how many extra counterpart samples the
// nearest-match pass may inspect for one sample before it commits. Without a
// bound, a dense signal (many samples inside one tolerance window) degrades to
// an O(n*m) candidate matrix on an endpoint that must stay predictable. The
// limit is a constant, so pairing stays deterministic: identical evidence
// always produces identical pairs.
const nearestLookaheadLimit = 32

// Value is one typed signal_log value. Kind follows migration 000186:
// 1=string, 2=bool, 3=int32, 4=int64, 5=float, 6=double, 7=enum, 9=time.
type Value struct {
	Kind  int16
	Text  *string
	Bool  *bool
	Int   *int64
	Float *float64
	Time  *time.Time
}

// Sample is source-time evidence attested by one Fleet Telemetry transport.
type Sample struct {
	Field           string
	Origin          string
	SourceEmittedAt time.Time
	Value           Value
}

// FieldResult summarizes agreement for one signal without exposing raw values.
type FieldResult struct {
	Field            string   `json:"field"`
	Status           string   `json:"status"`
	AgreementPct     *float64 `json:"agreement_pct"`
	HTTPRows         int      `json:"http_evidence_rows"`
	MQTTRows         int      `json:"mqtt_evidence_rows"`
	ComparablePairs  int      `json:"comparable_pairs"`
	AgreeingPairs    int      `json:"agreeing_pairs"`
	DisagreeingPairs int      `json:"disagreeing_pairs"`
}

// Report is a bounded, source-time-only cross-transport agreement result.
type Report struct {
	Status           string        `json:"status"`
	AgreementPct     *float64      `json:"agreement_pct"`
	ScannedRows      int           `json:"scanned_rows"`
	InvalidValueRows int           `json:"invalid_value_rows"`
	HTTPRows         int           `json:"http_evidence_rows"`
	MQTTRows         int           `json:"mqtt_evidence_rows"`
	ComparablePairs  int           `json:"comparable_pairs"`
	AgreeingPairs    int           `json:"agreeing_pairs"`
	DisagreeingPairs int           `json:"disagreeing_pairs"`
	Fields           []FieldResult `json:"fields"`
}

// Analyze pairs each field's HTTP and MQTT evidence chronologically, one to
// one, within tolerance. Receipt-time fallbacks never enter this function.
//
// Pairing is two-pass per field (see analyzeField): identical producer
// timestamps are matched first, then the leftovers are matched by bounded
// nearest source time without crossing an already matched pair.
func Analyze(samples []Sample, tolerance time.Duration) Report {
	report := Report{
		Status: StatusNoEvidence,
		Fields: []FieldResult{},
	}
	if tolerance < 0 {
		tolerance = 0
	}

	grouped := make(map[string][]Sample)
	report.ScannedRows = len(samples)
	for _, sample := range samples {
		if sample.Field == "" ||
			(sample.Origin != OriginHTTP && sample.Origin != OriginMQTT) ||
			sample.SourceEmittedAt.IsZero() ||
			!sample.Value.valid() {
			report.InvalidValueRows++
			continue
		}
		grouped[sample.Field] = append(grouped[sample.Field], sample)
		if sample.Origin == OriginHTTP {
			report.HTTPRows++
		} else {
			report.MQTTRows++
		}
	}

	fields := make([]string, 0, len(grouped))
	for field := range grouped {
		fields = append(fields, field)
	}
	sort.Strings(fields)

	for _, field := range fields {
		fieldResult := analyzeField(field, grouped[field], tolerance)
		report.Fields = append(report.Fields, fieldResult)
		report.ComparablePairs += fieldResult.ComparablePairs
		report.AgreeingPairs += fieldResult.AgreeingPairs
		report.DisagreeingPairs += fieldResult.DisagreeingPairs
	}

	switch {
	case report.HTTPRows+report.MQTTRows == 0:
		report.Status = StatusNoEvidence
	case report.ComparablePairs == 0:
		report.Status = StatusInsufficientOverlap
	default:
		report.Status = StatusMeasured
		report.AgreementPct = percentage(report.AgreeingPairs, report.ComparablePairs)
	}
	return report
}

// analyzeField pairs one field's evidence and scores each pair.
//
// Pass 1 (exact): every HTTP/MQTT sample pair carrying the identical producer
// timestamp is matched, in chronological order, one to one. Exact source-time
// equality is the strongest available evidence that both transports describe
// the same producer observation, so it is never surrendered to an earlier
// in-tolerance neighbour — the defect of the previous single-pass greedy
// matcher, which paired the earliest sample it saw and could bypass an exact
// counterpart entirely.
//
// Pass 2 (nearest): samples left between two consecutive exact matches are
// paired by smallest absolute source-time delta inside the tolerance, with a
// bounded lookahead, one to one, and without crossing an exact match. Equal
// deltas resolve to the earlier counterpart, so the result is deterministic.
//
// Both passes are monotonic: pair k never consumes a counterpart that precedes
// the counterpart of pair k-1, so the result stays a chronological one-to-one
// alignment rather than an unordered assignment.
func analyzeField(field string, samples []Sample, tolerance time.Duration) FieldResult {
	result := FieldResult{
		Field:  field,
		Status: StatusInsufficientOverlap,
	}
	httpSamples := make([]Sample, 0, len(samples))
	mqttSamples := make([]Sample, 0, len(samples))
	for _, sample := range samples {
		if sample.Origin == OriginHTTP {
			httpSamples = append(httpSamples, sample)
			result.HTTPRows++
		} else {
			mqttSamples = append(mqttSamples, sample)
			result.MQTTRows++
		}
	}
	sortSamples(httpSamples)
	sortSamples(mqttSamples)

	score := func(httpSample, mqttSample Sample) {
		result.ComparablePairs++
		if valuesAgree(httpSample.Value, mqttSample.Value) {
			result.AgreeingPairs++
		} else {
			result.DisagreeingPairs++
		}
	}

	anchors := exactMatches(httpSamples, mqttSamples)
	httpCursor, mqttCursor := 0, 0
	for _, matched := range anchors {
		matchNearest(
			httpSamples[httpCursor:matched.http],
			mqttSamples[mqttCursor:matched.mqtt],
			tolerance,
			score,
		)
		score(httpSamples[matched.http], mqttSamples[matched.mqtt])
		httpCursor, mqttCursor = matched.http+1, matched.mqtt+1
	}
	matchNearest(httpSamples[httpCursor:], mqttSamples[mqttCursor:], tolerance, score)

	if result.ComparablePairs > 0 {
		result.Status = StatusMeasured
		result.AgreementPct = percentage(result.AgreeingPairs, result.ComparablePairs)
	}
	return result
}

// anchor is one exact source-time match, expressed as the pair of indexes into
// the sorted per-origin sample slices.
type anchor struct {
	http int
	mqtt int
}

// exactMatches returns the chronological one-to-one matching of samples whose
// producer timestamps are identical. The merge scan is O(n+m) and intentionally
// unbounded: exact evidence must never be missed because a lookahead window was
// exhausted. Returned anchors are strictly increasing in both indexes, so they
// partition the remaining samples into non-crossing segments.
func exactMatches(httpSamples, mqttSamples []Sample) []anchor {
	anchors := make([]anchor, 0, min(len(httpSamples), len(mqttSamples)))
	for httpIndex, mqttIndex := 0, 0; httpIndex < len(httpSamples) && mqttIndex < len(mqttSamples); {
		httpAt := httpSamples[httpIndex].SourceEmittedAt
		mqttAt := mqttSamples[mqttIndex].SourceEmittedAt
		switch {
		case httpAt.Before(mqttAt):
			httpIndex++
		case mqttAt.Before(httpAt):
			mqttIndex++
		default:
			anchors = append(anchors, anchor{http: httpIndex, mqtt: mqttIndex})
			httpIndex++
			mqttIndex++
		}
	}
	return anchors
}

// matchNearest pairs one segment's leftovers by nearest producer time.
//
// For each HTTP sample in chronological order the matcher inspects at most
// nearestLookaheadLimit MQTT candidates that are still inside the tolerance
// window and commits to the smallest absolute delta; an equal delta keeps the
// earlier candidate so the outcome never depends on scan order. Committing to
// candidate k advances the MQTT cursor past k, which is what keeps the
// matching one-to-one and monotonic.
func matchNearest(
	httpSamples, mqttSamples []Sample,
	tolerance time.Duration,
	pair func(httpSample, mqttSample Sample),
) {
	for httpIndex, mqttIndex := 0, 0; httpIndex < len(httpSamples) && mqttIndex < len(mqttSamples); {
		delta := httpSamples[httpIndex].SourceEmittedAt.Sub(mqttSamples[mqttIndex].SourceEmittedAt)
		switch {
		case delta < -tolerance:
			// This HTTP sample precedes the whole remaining MQTT window.
			httpIndex++
		case delta > tolerance:
			// This MQTT sample precedes the whole remaining HTTP window.
			mqttIndex++
		default:
			best, bestDelta := mqttIndex, absDuration(delta)
			for candidate := mqttIndex + 1; candidate < len(mqttSamples) && candidate-mqttIndex <= nearestLookaheadLimit; candidate++ {
				candidateDelta := httpSamples[httpIndex].SourceEmittedAt.Sub(mqttSamples[candidate].SourceEmittedAt)
				if candidateDelta < -tolerance {
					// Ascending order: every later candidate is further away.
					break
				}
				if absolute := absDuration(candidateDelta); absolute < bestDelta {
					best, bestDelta = candidate, absolute
				}
			}
			pair(httpSamples[httpIndex], mqttSamples[best])
			httpIndex++
			mqttIndex = best + 1
		}
	}
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func sortSamples(samples []Sample) {
	sort.SliceStable(samples, func(i, j int) bool {
		return samples[i].SourceEmittedAt.Before(samples[j].SourceEmittedAt)
	})
}

func percentage(numerator, denominator int) *float64 {
	if denominator == 0 {
		return nil
	}
	value := float64(numerator) / float64(denominator) * 100
	return &value
}

func (v Value) valid() bool {
	switch v.Kind {
	case KindText:
		return v.Text != nil
	case KindBool:
		return v.Bool != nil
	case KindInt32, KindInt64, KindEnum:
		return v.Int != nil
	case KindFloat, KindDouble:
		return v.Float != nil && !math.IsNaN(*v.Float) && !math.IsInf(*v.Float, 0)
	case KindTime:
		return v.Time != nil
	default:
		return false
	}
}

// isFloatKind reports whether the kind is one of the two interchangeable float
// discriminators. Both persist into the same DOUBLE PRECISION column and differ
// only in the wire width the producing transport used, which is a transport
// detail rather than a property of the measurement.
func isFloatKind(kind int16) bool {
	return kind == KindFloat || kind == KindDouble
}

// isIntegerKind reports whether the kind is one of the two interchangeable
// integer discriminators. Both persist into the same BIGINT column and int32
// widens to int64 losslessly.
//
// The enum discriminator is deliberately excluded even though it shares that
// column: its integer is an enum ordinal, so equating it with a plain integer
// would compare two different vocabularies.
func isIntegerKind(kind int16) bool {
	return kind == KindInt32 || kind == KindInt64
}

// valuesAgree compares two typed observations of the same signal.
//
// Backward compatibility: rows written before value_kind was canonicalised at
// the persistence boundary can carry different-but-compatible numeric kinds for
// the same field (float vs double, int32 vs int64) purely because the two
// transports decoded different wire widths for the same measurement. Those are
// compared by value, not by label, so a genuine numeric match is never reported
// as a disagreement.
//
// Booleans, text, timestamps, and enum ordinals belong to no compatibility
// class: a kind mismatch involving them means the transports disagree about
// what the signal even is, which is a real disagreement and must stay visible.
func valuesAgree(left, right Value) bool {
	if !left.valid() || !right.valid() {
		return false
	}
	switch {
	case isFloatKind(left.Kind) && isFloatKind(right.Kind):
		difference := math.Abs(*left.Float - *right.Float)
		scale := math.Max(math.Abs(*left.Float), math.Abs(*right.Float))
		return difference <= floatAbsoluteTolerance+floatRelativeTolerance*scale
	case isIntegerKind(left.Kind) && isIntegerKind(right.Kind):
		return *left.Int == *right.Int
	case left.Kind != right.Kind:
		return false
	}

	switch left.Kind {
	case KindText:
		return *left.Text == *right.Text
	case KindBool:
		return *left.Bool == *right.Bool
	case KindEnum:
		return *left.Int == *right.Int
	case KindTime:
		return left.Time.Equal(*right.Time)
	default:
		return false
	}
}
