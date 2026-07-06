// Command pub-test-signal publishes Tesla Fleet Telemetry per-field MQTT
// messages to the local broker, exercising the per-field PipelineSubscriber
// end-to-end.
//
// Per the per-field MQTT cutover, the upstream Tesla fleet-telemetry
// publisher emits ONE signal per topic in the form
// `{topicBase}/{VIN}/v/{field}` with the raw json.Marshal of the
// producer's per-Value-variant Go value as the body. This tool mirrors
// that wire format so the new subscriber + codec.DecodeJSONField path
// can be exercised against either:
//
//  1. Synthetic mode (default): emits a small hand-built fan-out of
//     atomic + compound signals exercising six destinations
//     (signal_log / drive_telemetry / charging_telemetry / positions).
//     Use for smoke-testing the subscriber.
//
//     go run ./cmd/pub-test-signal --vin TEST00000000000VIN --count 3
//
//  2. CSV-replay mode (--csv): streams a prod-shape signal CSV
//     (vehicle_id,signal,value_num,value_str,value_bool,created_at) and
//     publishes one per-field message per CSV row, wrapping the body in
//     the codec's `{"value":<bare>,"ts":"<RFC3339>"}` envelope so the
//     original event-time is preserved end-to-end. Use for full pipeline
//     validation against EXPECTED_RESULTS.md fixtures.
//
//     go run ./cmd/pub-test-signal --vin TEST00000000000VIN \
//     --csv D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv \
//     --start "2026-04-18 00:22:00" \
//     --end   "2026-04-18 00:46:30"
//
// After publishing, query the DB to see signals land:
//
//	docker exec teslasync-postgres psql -U teslasync -d teslasync \
//	    -c "SELECT field, value_kind, float_value, ts FROM signal_log
//	        WHERE vehicle_id = 1 ORDER BY ts DESC LIMIT 10;"
package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func main() {
	broker := flag.String("broker", "tcp://localhost:1883", "MQTT broker URL")
	topicBase := flag.String("topic-base", "telemetry", "topic base (must match TESLASYNC_FLEET_TELEMETRY_TOPIC_BASE)")
	vin := flag.String("vin", "TEST00000000000VIN", "VIN of the test vehicle (must exist in vehicles table)")
	count := flag.Int("count", 1, "synthetic mode only: number of payload bursts to publish")
	intervalMS := flag.Int("interval-ms", 1000, "synthetic mode only: delay between bursts in milliseconds")
	clientID := flag.String("client-id", "teslasync-pub-test-signal", "MQTT client id")

	csvPath := flag.String("csv", "", "CSV mode: path to prod-shape signal CSV (vehicle_id,signal,value_num,value_str,value_bool,created_at)")
	startFilter := flag.String("start", "", "CSV mode: only include rows with created_at >= this (e.g. '2026-04-18 00:22:00')")
	endFilter := flag.String("end", "", "CSV mode: only include rows with created_at <= this (e.g. '2026-04-18 00:46:30')")
	throttleMS := flag.Int("csv-throttle-ms", 1, "CSV mode: sleep this many ms between PER-FIELD publishes to avoid overwhelming the broker")
	publishLimit := flag.Int("limit", 0, "CSV mode: stop after this many per-field publishes (0 = no limit)")
	flag.Parse()

	opts := pahomqtt.NewClientOptions().
		AddBroker(*broker).
		SetClientID(*clientID).
		SetConnectTimeout(5 * time.Second).
		SetCleanSession(true)

	client := pahomqtt.NewClient(opts)
	tok := client.Connect()
	if !tok.WaitTimeout(connectTimeout) {
		log.Fatalf("connect: timed out after %s", connectTimeout)
	}
	if err := tok.Error(); err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer client.Disconnect(250)

	if *csvPath != "" {
		if err := runCSVReplay(client, *topicBase, *vin, *csvPath, *startFilter, *endFilter, *throttleMS, *publishLimit); err != nil {
			log.Fatalf("csv replay: %v", err)
		}
		return
	}

	if err := runSynthetic(client, *topicBase, *vin, *count, *intervalMS); err != nil {
		log.Fatalf("synthetic: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Per-field publish primitive
// ---------------------------------------------------------------------------

// publisher is the narrow slice of paho's mqtt.Client that this tool
// actually uses. Depending on the interface rather than the concrete
// client keeps publishField/runSynthetic/runCSVReplay unit-testable with
// an in-memory fake and honours interface-segregation: the real
// pahomqtt.Client already implements this exact method set.
type publisher interface {
	Publish(topic string, qos byte, retained bool, payload interface{}) pahomqtt.Token
}

// Broker interaction timeouts, named so the values live in one place and
// are reused by both the CLI connect path and the per-field publish path.
const (
	connectTimeout = 10 * time.Second
	publishTimeout = 5 * time.Second
)

// publishField emits a single per-field MQTT message in the wire shape
// codec.DecodeJSONField expects: topic = `{base}/{vin}/v/{field}`,
// body = JSON envelope `{"value":<bare>,"ts":"<RFC3339>"}`. The
// envelope is optional in the codec, but always emitted here so
// historical replays preserve event-time even on bursts that span
// minutes / hours / days of original wall-clock.
//
// jsonValue MUST be a Go value whose json.Marshal produces the bare
// JSON shape the codec's per-ValueKind decoder expects:
//
//   - ValueKindString:   string                       -> `"foo"`
//   - ValueKindBool:     bool                         -> `true` / `false`
//   - ValueKindInt32:    int32 (or int)               -> `42`
//   - ValueKindInt64:    int64                        -> `42`
//   - ValueKindFloat:    float32                      -> `3.14`
//   - ValueKindDouble:   float64                      -> `3.14`
//   - ValueKindEnum:     string (proto-prefixed form) -> `"ShiftStateD"`
//   - CompoundLocation:  map[string]float64           -> `{"latitude":x,"longitude":y}`
//   - CompoundDoors:     map[string]bool              -> `{"DriverFront":true,...}`
//   - CompoundTireLoc:   map[string]bool (snake_case) -> `{"front_left":true,...}`
//   - StringCompound:    string (DoorState et al.)    -> `"FrontDoorOpen|..."`
//
// The ts argument is the original event-time (CSV row timestamp for
// replay; wall-clock for synthetic). A marshal failure is returned as an
// error because it indicates a programming bug in the caller's value shape.
func publishField(client publisher, topicBase, vin, field string, jsonValue any, ts time.Time) (int, error) {
	topic := fmt.Sprintf("%s/%s/v/%s", topicBase, vin, field)
	envelope := struct {
		Value any    `json:"value"`
		TS    string `json:"ts"`
	}{
		Value: jsonValue,
		TS:    ts.UTC().Format(time.RFC3339Nano),
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return 0, fmt.Errorf("marshal envelope for %q: %w", field, err)
	}
	tok := client.Publish(topic, 1, false, body)
	if tok == nil {
		return 0, fmt.Errorf("publish %q: nil token from broker client", topic)
	}
	// Distinguish timeout from a delivery error: on timeout paho leaves
	// Error() nil, so wrapping it with %w would emit a confusing
	// "%!w(<nil>)" — report the timeout explicitly instead.
	if !tok.WaitTimeout(publishTimeout) {
		return 0, fmt.Errorf("publish %q: timed out after %s", topic, publishTimeout)
	}
	if err := tok.Error(); err != nil {
		return 0, fmt.Errorf("publish %q: %w", topic, err)
	}
	return len(body), nil
}

// ---------------------------------------------------------------------------
// Synthetic mode
// ---------------------------------------------------------------------------

// syntheticAtomic represents a single per-field message to emit in a
// synthetic burst. Each call to runSynthetic emits the same fan-out
// `count` times, with the float-valued atomics drifting by `seed` each
// burst so signal_log shows distinct values per iteration.
type syntheticAtomic struct {
	field string
	value any
}

func runSynthetic(client publisher, topicBase, vin string, count, intervalMS int) error {
	log.Printf("synthetic mode: publishing %d burst(s) of per-field signals to %s/%s/v/+", count, topicBase, vin)

	for i := 0; i < count; i++ {
		now := time.Now().UTC()
		f := float32(i)

		burst := []syntheticAtomic{
			{field: "BatteryLevel", value: float32(78.5 - f*0.1)},
			{field: "Soc", value: float32(80.0 - f*0.1)},
			{field: "VehicleSpeed", value: float32(27.78 + f)},
			{field: "ACChargingPower", value: float32(11.5)},
			{field: "Gear", value: "ShiftStateD"},
			// Compound: codec flattens to LocationLatitude + LocationLongitude.
			{field: "Location", value: map[string]float64{
				"latitude":  37.7749 + float64(i)*0.0001,
				"longitude": -122.4194 + float64(i)*0.0001,
			}},
		}

		var totalBytes int
		for _, a := range burst {
			n, err := publishField(client, topicBase, vin, a.field, a.value, now)
			if err != nil {
				return fmt.Errorf("synthetic burst %d field %q: %w", i, a.field, err)
			}
			totalBytes += n
		}

		log.Printf("  [%d/%d] published %d per-field msgs (%d bytes total) at ts=%s",
			i+1, count, len(burst), totalBytes, now.Format(time.RFC3339Nano))

		if i < count-1 {
			time.Sleep(time.Duration(intervalMS) * time.Millisecond)
		}
	}

	log.Printf("done — query signal_log/positions/drive_telemetry/charging_telemetry in postgres to confirm")
	return nil
}

// ---------------------------------------------------------------------------
// CSV replay mode
// ---------------------------------------------------------------------------

// csvRow mirrors the prod-signal CSV header.
type csvRow struct {
	signal    string
	valueNum  string
	valueStr  string
	valueBool string
	createdAt time.Time
}

// runCSVReplay reads the CSV, optionally filters by [start,end], sorts
// by created_at, and publishes ONE per-field MQTT message per row
// (wrapped in the codec's value+ts envelope). Older captures stored
// Latitude/Longitude as bare scalars; we pair them into a
// single Location compound publish per (vin, timestamp) so the codec
// flattens back to the canonical LocationLatitude/Longitude atomics.
func runCSVReplay(client publisher, topicBase, vin, csvPath, startFilter, endFilter string, throttleMS, publishLimit int) error {
	log.Printf("CSV replay mode: %s", csvPath)
	log.Printf("  publishing per-field to %s/%s/v/+ (envelope wraps event-time)", topicBase, vin)

	startCutoff, err := parseTimeFilter(startFilter, time.Time{})
	if err != nil {
		return fmt.Errorf("parse --start: %w", err)
	}
	endCutoff, err := parseTimeFilter(endFilter, time.Time{})
	if err != nil {
		return fmt.Errorf("parse --end: %w", err)
	}

	f, err := os.Open(csvPath)
	if err != nil {
		return fmt.Errorf("open csv %q: %w", csvPath, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return fmt.Errorf("read csv header: %w", err)
	}
	colIdx, err := indexHeaders(header, []string{"signal", "value_num", "value_str", "value_bool", "created_at"})
	if err != nil {
		return err
	}

	var rows []csvRow
	skippedTime := 0
	skippedParse := 0
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read csv row: %w", err)
		}
		ts, err := parseCSVTimestamp(fieldAt(rec, colIdx["created_at"]))
		if err != nil {
			skippedParse++
			continue
		}
		if !startCutoff.IsZero() && ts.Before(startCutoff) {
			skippedTime++
			continue
		}
		if !endCutoff.IsZero() && ts.After(endCutoff) {
			skippedTime++
			continue
		}
		rows = append(rows, csvRow{
			signal:    fieldAt(rec, colIdx["signal"]),
			valueNum:  fieldAt(rec, colIdx["value_num"]),
			valueStr:  fieldAt(rec, colIdx["value_str"]),
			valueBool: fieldAt(rec, colIdx["value_bool"]),
			createdAt: ts,
		})
	}

	log.Printf("  loaded %d rows (skipped %d outside time window, %d parse errors)", len(rows), skippedTime, skippedParse)
	if len(rows) == 0 {
		return fmt.Errorf("no rows in window — check --start/--end")
	}

	// Sort by timestamp so the codec sees event-time in monotonic
	// order (the per-field path is otherwise indifferent, but FSM
	// edge transitions assume forward progress).
	sort.Slice(rows, func(i, j int) bool { return rows[i].createdAt.Before(rows[j].createdAt) })

	stats := replayStats{
		skipReasons:    map[string]int{},
		unknownSignals: map[string]int{},
	}

	// Pre-pass: pair Latitude/Longitude rows that share a timestamp
	// into a synthetic Location row. Older ingests captured the compound
	// decomposed into bare scalars; the modern codec
	// has no Field_Latitude / Field_Longitude — only Field_Location.
	// Pairing here lets historical CSVs still drive the positions
	// writer end-to-end via Location -> codec flatten ->
	// LocationLatitude + LocationLongitude.
	rows = pairLatLonRows(rows, &stats)

	for i := range rows {
		row := rows[i]

		// Sentinel emitted by pairLatLonRows for a Latitude/Longitude
		// scalar it already folded into a synthetic Location compound.
		// Handle it before the SignalsByName lookup so the diagnostic
		// counters stay accurate instead of surfacing a phantom ""
		// entry under unknown signals.
		if row.signal == "" {
			stats.datumsSkipped++
			stats.skipReasons["bare lat/lon (consumed by Location pair)"]++
			continue
		}

		// Skip the bare scalars that have no Field on the modern
		// proto; pairLatLonRows already consumed valid pairs.
		if row.signal == "Latitude" || row.signal == "Longitude" {
			stats.datumsSkipped++
			stats.skipReasons["bare lat/lon (unpaired in same group)"]++
			continue
		}

		meta, ok := protomodel.SignalsByName[row.signal]
		if !ok {
			stats.datumsSkipped++
			stats.unknownSignals[row.signal]++
			continue
		}

		jsonValue, reason := encodeRowValue(meta, row)
		if jsonValue == nil {
			stats.datumsSkipped++
			stats.skipReasons[reason]++
			continue
		}

		n, err := publishField(client, topicBase, vin, row.signal, jsonValue, row.createdAt)
		if err != nil {
			return fmt.Errorf("publish row %d field %q: %w", i, row.signal, err)
		}
		stats.payloadsPublished++
		stats.bytesPublished += int64(n)
		stats.datumsEncoded++

		if throttleMS > 0 {
			time.Sleep(time.Duration(throttleMS) * time.Millisecond)
		}
		if publishLimit > 0 && stats.payloadsPublished >= publishLimit {
			break
		}

		if stats.payloadsPublished%500 == 0 {
			log.Printf("  ... %d publishes, %d encoded, %d skipped",
				stats.payloadsPublished, stats.datumsEncoded, stats.datumsSkipped)
		}
	}

	log.Printf("=== CSV REPLAY DONE ===")
	log.Printf("  per-field publishes : %d (%.1f KB)", stats.payloadsPublished, float64(stats.bytesPublished)/1024.0)
	log.Printf("  rows encoded        : %d", stats.datumsEncoded)
	log.Printf("  rows skipped        : %d", stats.datumsSkipped)
	if len(stats.skipReasons) > 0 {
		log.Printf("  skip reasons:")
		for _, r := range topReasons(stats.skipReasons, 10) {
			log.Printf("    %6d  %s", r.count, r.reason)
		}
	}
	if len(stats.unknownSignals) > 0 {
		log.Printf("  unknown signals (top 10):")
		for _, r := range topReasons(stats.unknownSignals, 10) {
			log.Printf("    %6d  %s", r.count, r.reason)
		}
	}
	return nil
}

// pairLatLonRows scans the timestamp-sorted CSV row stream and merges
// any matched (Latitude, Longitude) pair sharing the same timestamp
// into a single synthetic Location row whose valueStr carries the
// pre-marshalled compound JSON. The original Latitude / Longitude
// rows are left in-place but tagged so the main loop counts them as
// "consumed by location pair" rather than "bare lat/lon" — kept
// in-place so timestamp ordering is preserved and the FSM doesn't
// see a synthetic batch boundary.
//
// Implementation: we walk the sorted rows, group by timestamp, and
// rewrite paired Latitude/Longitude rows as `signal=""` no-op
// markers and prepend a synthetic `Location` row to that timestamp
// group. The encodeRowValue dispatch returns nil for `signal==""`
// without bumping the unknown-signals map, so the only counter
// impact is the silently-skipped no-op markers in
// "bare lat/lon (unpaired in same group)" — half-pairs (lat OR lon
// alone) survive as their original rows and surface in that bucket.
func pairLatLonRows(rows []csvRow, stats *replayStats) []csvRow {
	if len(rows) == 0 {
		return rows
	}
	out := make([]csvRow, 0, len(rows))
	groupStart := 0
	for i := 1; i <= len(rows); i++ {
		if i < len(rows) && rows[i].createdAt.Equal(rows[groupStart].createdAt) {
			continue
		}
		group := rows[groupStart:i]
		var latRow, lonRow *csvRow
		for j := range group {
			switch group[j].signal {
			case "Latitude":
				latRow = &group[j]
			case "Longitude":
				lonRow = &group[j]
			}
		}
		if latRow != nil && lonRow != nil {
			lat, latErr := strconv.ParseFloat(latRow.valueNum, 64)
			lon, lonErr := strconv.ParseFloat(lonRow.valueNum, 64)
			if latErr == nil && lonErr == nil {
				compound, _ := json.Marshal(map[string]float64{
					"latitude":  lat,
					"longitude": lon,
				})
				out = append(out, csvRow{
					signal:    "Location",
					valueStr:  string(compound),
					createdAt: latRow.createdAt,
				})
				stats.datumsEncoded++ // counted once for the pair
				// Mark the original lat/lon as consumed so the
				// main loop classifies them under the consumed
				// bucket without bumping unknown-signals.
				for j := range group {
					if group[j].signal == "Latitude" || group[j].signal == "Longitude" {
						group[j].signal = "" // sentinel
					}
				}
			}
		}
		out = append(out, group...)
		groupStart = i
	}
	return out
}

type replayStats struct {
	payloadsPublished int
	bytesPublished    int64
	datumsEncoded     int
	datumsSkipped     int
	skipReasons       map[string]int
	unknownSignals    map[string]int
}

type reasonCount struct {
	reason string
	count  int
}

func topReasons(m map[string]int, n int) []reasonCount {
	out := make([]reasonCount, 0, len(m))
	for k, v := range m {
		out = append(out, reasonCount{k, v})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].count > out[j].count })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// encodeRowValue dispatches to the right Go value shape for a CSV row
// based on the signal's declared ValueKind. Returns (nil, reason) when
// the row cannot be encoded — caller bumps the skipReasons counter.
//
// Compound signals use the JSON shape codec.decodeCompoundJSON
// expects:
//   - Location:     {"latitude":x,"longitude":y} (lowercase keys)
//   - DoorState:    bare JSON-quoted string ("DoorOpen|Closed|...")
//   - Sched*:       bare JSON-quoted string ("HH:MM:SS")
//   - TireLocation: {"front_left":true,...} (snake_case keys)
//
// The CSV almost never carries usable compound bodies (the prod-shape
// export decomposed everything to scalars), so the compound branches
// here exist mostly for completeness — the only compound the replay
// actually emits in practice is Location synthesised by
// pairLatLonRows above.
func encodeRowValue(meta *protomodel.SignalMeta, row csvRow) (any, string) {
	if row.signal == "" {
		// Sentinel from pairLatLonRows — the lat/lon was already
		// consumed into a synthetic Location row earlier in the
		// stream. Returning a clearer reason than "unknown signal"
		// keeps the diagnostic counter focused on real misses.
		return nil, "bare lat/lon (consumed by Location pair)"
	}
	switch meta.ValueKind {
	case protomodel.ValueKindFloat:
		f, err := strconv.ParseFloat(row.valueNum, 32)
		if err != nil {
			return nil, "float parse error"
		}
		return float32(f), ""

	case protomodel.ValueKindDouble:
		f, err := strconv.ParseFloat(row.valueNum, 64)
		if err != nil {
			return nil, "double parse error"
		}
		return f, ""

	case protomodel.ValueKindInt32:
		i, err := strconv.ParseInt(row.valueNum, 10, 32)
		if err != nil {
			f, err2 := strconv.ParseFloat(row.valueNum, 64)
			if err2 != nil {
				return nil, "int32 parse error"
			}
			i = int64(f)
		}
		return int32(i), ""

	case protomodel.ValueKindInt64:
		i, err := strconv.ParseInt(row.valueNum, 10, 64)
		if err != nil {
			f, err2 := strconv.ParseFloat(row.valueNum, 64)
			if err2 != nil {
				return nil, "int64 parse error"
			}
			i = int64(f)
		}
		return i, ""

	case protomodel.ValueKindBool:
		v := strings.ToLower(strings.TrimSpace(row.valueBool))
		if v == "" {
			return nil, "bool: empty value_bool"
		}
		switch v {
		case "t", "true", "1", "yes":
			return true, ""
		case "f", "false", "0", "no":
			return false, ""
		}
		return nil, "bool: unrecognised value"

	case protomodel.ValueKindString:
		s := strings.TrimSpace(row.valueStr)
		if s == "" {
			return nil, "string: empty value_str"
		}
		return s, ""

	case protomodel.ValueKindEnum:
		return encodeEnumValue(meta, row)

	case protomodel.ValueKindCompound:
		// The synthetic Location row from pairLatLonRows arrives
		// here with valueStr already set to a pre-marshalled
		// JSON object; emit it as a json.RawMessage so json.Marshal
		// passes it through verbatim.
		s := strings.TrimSpace(row.valueStr)
		if s == "" {
			return nil, "compound: empty body (CSV export decomposes compounds)"
		}
		return json.RawMessage(s), ""

	case protomodel.ValueKindTime:
		s := strings.TrimSpace(row.valueStr)
		if s == "" {
			return nil, "time: empty value_str"
		}
		// Codec expects the JSON-quoted form; json.Marshal of the
		// Go string handles quoting automatically.
		return s, ""

	default:
		return nil, "unsupported ValueKind: " + meta.ValueKind.String()
	}
}

// encodeEnumValue produces the JSON-string form Tesla's MQTT producer
// emits for typed enums: the proto-typed enum's String() output, which
// is the prefixed form (e.g. "ShiftStateD", "ChargeStateCharging"). The
// codec strips meta.EnumStringPrefix during decode to land the
// canonical short string in signal.Store.
//
// Legacy Tesla Fleet API JSON poll values (Idle / WaitForLineVoltage /
// Authorizing) are mapped to the closest modern proto value so
// downstream FSMs can still fire TriggerChargeStarted/Ended off CSVs
// captured in the legacy era.
func encodeEnumValue(meta *protomodel.SignalMeta, row csvRow) (any, string) {
	s := strings.TrimSpace(row.valueStr)
	if s == "" && row.valueNum != "" {
		s = strings.TrimSpace(row.valueNum)
	}
	if s == "" {
		return nil, "enum: empty value_str/value_num"
	}

	switch meta.EnumTypeName {
	case "ShiftState":
		// Accept P/R/N/D shorthand (the most common CSV form) and
		// the prefixed long form. Always emit the prefixed form so
		// the codec.TrimPrefix call has work to do uniformly.
		if v, ok := canonicaliseShiftState(s); ok {
			return v, ""
		}
		return nil, "enum ShiftState: unrecognised " + s

	case "ChargingState":
		if v, ok := canonicaliseChargingState(s); ok {
			return v, ""
		}
		return nil, "enum ChargingState: unknown value " + s

	case "DetailedChargeStateValue":
		if v, ok := canonicaliseDetailedChargeState(s); ok {
			return v, ""
		}
		return nil, "enum DetailedChargeStateValue: unknown value " + s

	default:
		// For any enum we don't have a hand-wired mapping for,
		// pass through with the codec's prefix prepended IF the
		// raw value doesn't already start with it. This is best-
		// effort: codec validation will surface unrecognised
		// values via jsonDecodeErrorsTotal.
		if !strings.HasPrefix(s, meta.EnumStringPrefix) {
			return meta.EnumStringPrefix + s, ""
		}
		return s, ""
	}
}

func canonicaliseShiftState(s string) (string, bool) {
	upper := strings.ToUpper(s)
	switch upper {
	case "P":
		return "ShiftStateP", true
	case "R":
		return "ShiftStateR", true
	case "N":
		return "ShiftStateN", true
	case "D":
		return "ShiftStateD", true
	case "INVALID":
		return "ShiftStateInvalid", true
	case "SNA":
		return "ShiftStateSNA", true
	}
	if strings.HasPrefix(s, "ShiftState") {
		return s, true
	}
	return "", false
}

func canonicaliseChargingState(s string) (string, bool) {
	if strings.HasPrefix(s, "ChargeState") {
		return s, true
	}
	switch s {
	case "Idle", "Authorizing":
		return "ChargeStateStopped", true
	case "WaitForLineVoltage":
		return "ChargeStateStarting", true
	case "Charging", "Stopped", "Disconnected", "Complete", "NoPower", "Starting", "Unknown":
		return "ChargeState" + s, true
	}
	return "", false
}

func canonicaliseDetailedChargeState(s string) (string, bool) {
	if strings.HasPrefix(s, "DetailedChargeState") {
		return s, true
	}
	switch s {
	case "Idle", "Authorizing":
		return "DetailedChargeStateStopped", true
	case "WaitForLineVoltage":
		return "DetailedChargeStateStarting", true
	case "Charging", "Stopped", "Disconnected", "Complete", "NoPower", "Starting", "Unknown":
		return "DetailedChargeState" + s, true
	}
	return "", false
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

// fieldAt returns the value at column idx, or "" when idx is out of range.
// csv.Reader with FieldsPerRecord = -1 tolerates short rows, so a bare
// rec[idx] would panic on a truncated line; every column read goes through
// this bounds-safe accessor instead.
func fieldAt(rec []string, idx int) string {
	if idx < 0 || idx >= len(rec) {
		return ""
	}
	return rec[idx]
}

func indexHeaders(header []string, want []string) (map[string]int, error) {
	out := map[string]int{}
	for i, h := range header {
		out[strings.TrimSpace(h)] = i
	}
	missing := []string{}
	for _, w := range want {
		if _, ok := out[w]; !ok {
			missing = append(missing, w)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("csv missing required columns %v (got %v)", missing, header)
	}
	return out, nil
}

// parseCSVTimestamp handles the prod-signal export format
// "2026-04-17 02:47:24.891511+00" — Go can't parse "+00" so normalise to
// "+0000" first.
func parseCSVTimestamp(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	if strings.HasSuffix(s, "+00") {
		s = strings.TrimSuffix(s, "+00") + "+0000"
	}
	layouts := []string{
		"2006-01-02 15:04:05.999999-0700",
		"2006-01-02 15:04:05-0700",
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unparseable timestamp %q", s)
}

func parseTimeFilter(s string, def time.Time) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return def, nil
	}
	t, err := parseCSVTimestamp(s)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid time filter %q: %w", s, err)
	}
	return t, nil
}
