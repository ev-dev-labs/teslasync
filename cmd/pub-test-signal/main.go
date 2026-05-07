// Command pub-test-signal publishes Tesla Fleet Telemetry proto-encoded
// Payloads to the local MQTT broker, exercising the post-phase-42
// PipelineSubscriber end-to-end.
//
// Two modes:
//
//  1. Synthetic mode (default): emits a small hand-built Payload exercising
//     six destinations (signal_log / drive_telemetry / charging_telemetry
//     / positions). Use for smoke-testing the pipeline.
//
//        go run ./cmd/pub-test-signal --vin TEST00000000000VIN --count 3
//
//  2. CSV-replay mode (--csv): streams a prod-shape signal CSV
//     (vehicle_id,signal,value_num,value_str,value_bool,created_at) and
//     publishes one Payload per unique created_at, batching all signals
//     observed at that timestamp into a single proto message. Use for
//     full pipeline validation against EXPECTED_RESULTS.md fixtures.
//
//        go run ./cmd/pub-test-signal --vin TEST00000000000VIN \
//            --csv D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv \
//            --start "2026-04-18 00:22:00" \
//            --end   "2026-04-18 00:46:30"
//
// After publishing, query the DB to see signals land:
//
//	docker exec teslasync-postgres psql -U teslasync -d teslasync \
//	    -c "SELECT field, value_kind, float_value, ts FROM signal_log
//	        WHERE vehicle_id = 1 ORDER BY ts DESC LIMIT 10;"
package main

import (
	"encoding/csv"
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
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func main() {
	broker := flag.String("broker", "tcp://localhost:1883", "MQTT broker URL")
	topicBase := flag.String("topic-base", "telemetry", "topic base (must match TESLASYNC_FLEET_TELEMETRY_TOPIC_BASE)")
	vin := flag.String("vin", "TEST00000000000VIN", "VIN of the test vehicle (must exist in vehicles table)")
	count := flag.Int("count", 1, "synthetic mode only: number of payloads to publish")
	intervalMS := flag.Int("interval-ms", 1000, "synthetic mode only: delay between payloads in milliseconds")
	clientID := flag.String("client-id", "teslasync-pub-test-signal", "MQTT client id")

	csvPath := flag.String("csv", "", "CSV mode: path to prod-shape signal CSV (vehicle_id,signal,value_num,value_str,value_bool,created_at)")
	startFilter := flag.String("start", "", "CSV mode: only include rows with created_at >= this (e.g. '2026-04-18 00:22:00')")
	endFilter := flag.String("end", "", "CSV mode: only include rows with created_at <= this (e.g. '2026-04-18 00:46:30')")
	maxPayloadSignals := flag.Int("max-payload-signals", 50, "CSV mode: cap signals per Payload to avoid oversized MQTT messages")
	throttleMS := flag.Int("csv-throttle-ms", 5, "CSV mode: sleep this many ms between Payloads to avoid overwhelming the pipeline")
	publishLimit := flag.Int("limit", 0, "CSV mode: stop after this many Payloads (0 = no limit)")
	flag.Parse()

	opts := pahomqtt.NewClientOptions().
		AddBroker(*broker).
		SetClientID(*clientID).
		SetConnectTimeout(5 * time.Second).
		SetCleanSession(true)

	client := pahomqtt.NewClient(opts)
	if tok := client.Connect(); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
		log.Fatalf("connect: %v", tok.Error())
	}
	defer client.Disconnect(250)

	topic := fmt.Sprintf("%s/payload/%s", *topicBase, *vin)

	if *csvPath != "" {
		runCSVReplay(client, topic, *vin, *csvPath, *startFilter, *endFilter, *maxPayloadSignals, *throttleMS, *publishLimit)
		return
	}

	runSynthetic(client, topic, *vin, *count, *intervalMS)
}

// ---------------------------------------------------------------------------
// Synthetic mode
// ---------------------------------------------------------------------------

func runSynthetic(client pahomqtt.Client, topic, vin string, count, intervalMS int) {
	log.Printf("publishing %d synthetic payload(s) to %s", count, topic)

	for i := 0; i < count; i++ {
		payload := buildSyntheticPayload(vin, i)
		bytes, err := proto.Marshal(payload)
		if err != nil {
			log.Fatalf("proto.Marshal: %v", err)
		}

		tok := client.Publish(topic, 1, false, bytes)
		if !tok.WaitTimeout(5*time.Second) || tok.Error() != nil {
			log.Fatalf("publish[%d]: %v", i, tok.Error())
		}

		log.Printf("  [%d/%d] published %d bytes (BatteryLevel=%.2f Soc=%.2f Speed=%.2f)",
			i+1, count, len(bytes), 78.5-float32(i)*0.1, 80.0-float32(i)*0.1, 27.78+float32(i))

		if i < count-1 {
			time.Sleep(time.Duration(intervalMS) * time.Millisecond)
		}
	}

	log.Printf("done — query signal_log/positions/drive_telemetry/charging_telemetry in postgres to confirm")
}

func buildSyntheticPayload(vin string, seed int) *ftproto.Payload {
	now := time.Now().UTC()
	f := float32(seed)

	return &ftproto.Payload{
		Vin:       vin,
		CreatedAt: timestamppb.New(now),
		Data: []*ftproto.Datum{
			{Key: ftproto.Field_BatteryLevel, Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 78.5 - f*0.1}}},
			{Key: ftproto.Field_Soc, Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 80.0 - f*0.1}}},
			{Key: ftproto.Field_VehicleSpeed, Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 27.78 + f}}},
			{Key: ftproto.Field_ACChargingPower, Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 11.5}}},
			{
				Key: ftproto.Field_Location,
				Value: &ftproto.Value{Value: &ftproto.Value_LocationValue{
					LocationValue: &ftproto.LocationValue{
						Latitude:  37.7749 + float64(seed)*0.0001,
						Longitude: -122.4194 + float64(seed)*0.0001,
					},
				}},
			},
			{Key: ftproto.Field_Gear, Value: &ftproto.Value{Value: &ftproto.Value_ShiftStateValue{ShiftStateValue: ftproto.ShiftState_ShiftStateD}}},
		},
	}
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

// runCSVReplay reads the CSV, optionally filters by [start,end], groups
// rows by created_at, and publishes one Payload per group.
func runCSVReplay(client pahomqtt.Client, topic, vin, csvPath, startFilter, endFilter string, maxSignals, throttleMS, publishLimit int) {
	log.Printf("CSV replay mode: %s", csvPath)
	log.Printf("  publishing to %s as VIN=%s", topic, vin)

	startCutoff := parseTimeFilter(startFilter, time.Time{})
	endCutoff := parseTimeFilter(endFilter, time.Time{})

	f, err := os.Open(csvPath)
	if err != nil {
		log.Fatalf("open csv: %v", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		log.Fatalf("read header: %v", err)
	}
	colIdx := indexHeaders(header, []string{"signal", "value_num", "value_str", "value_bool", "created_at"})

	var rows []csvRow
	skippedTime := 0
	skippedParse := 0
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Fatalf("read row: %v", err)
		}
		ts, err := parseCSVTimestamp(rec[colIdx["created_at"]])
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
			signal:    rec[colIdx["signal"]],
			valueNum:  rec[colIdx["value_num"]],
			valueStr:  rec[colIdx["value_str"]],
			valueBool: rec[colIdx["value_bool"]],
			createdAt: ts,
		})
	}

	log.Printf("  loaded %d rows (skipped %d outside time window, %d parse errors)", len(rows), skippedTime, skippedParse)
	if len(rows) == 0 {
		log.Fatalf("no rows in window — check --start/--end")
	}

	// Sort by timestamp, then group consecutive rows that share the same created_at.
	sort.Slice(rows, func(i, j int) bool { return rows[i].createdAt.Before(rows[j].createdAt) })

	stats := replayStats{}
	groupStart := 0
	publishedPayloads := 0

	flushGroup := func(end int) {
		if end-groupStart == 0 {
			return
		}
		group := rows[groupStart:end]
		// Cap at maxSignals per payload to keep MQTT messages reasonable.
		for chunkStart := 0; chunkStart < len(group); chunkStart += maxSignals {
			chunkEnd := chunkStart + maxSignals
			if chunkEnd > len(group) {
				chunkEnd = len(group)
			}
			payload, datumStats := buildCSVPayload(vin, group[chunkStart:chunkEnd])
			stats.merge(datumStats)
			if payload == nil || len(payload.Data) == 0 {
				continue
			}

			bytes, err := proto.Marshal(payload)
			if err != nil {
				log.Fatalf("proto.Marshal: %v", err)
			}
			tok := client.Publish(topic, 1, false, bytes)
			if !tok.WaitTimeout(5*time.Second) || tok.Error() != nil {
				log.Fatalf("publish: %v", tok.Error())
			}
			publishedPayloads++
			stats.payloadsPublished++
			stats.bytesPublished += int64(len(bytes))

			if throttleMS > 0 {
				time.Sleep(time.Duration(throttleMS) * time.Millisecond)
			}
			if publishLimit > 0 && publishedPayloads >= publishLimit {
				return
			}
		}

		if publishedPayloads%200 == 0 && publishedPayloads > 0 {
			log.Printf("  ... %d payloads published, %d datums encoded, %d skipped",
				publishedPayloads, stats.datumsEncoded, stats.datumsSkipped)
		}
	}

	for i := 1; i < len(rows); i++ {
		if !rows[i].createdAt.Equal(rows[groupStart].createdAt) {
			flushGroup(i)
			if publishLimit > 0 && publishedPayloads >= publishLimit {
				break
			}
			groupStart = i
		}
	}
	if publishLimit == 0 || publishedPayloads < publishLimit {
		flushGroup(len(rows))
	}

	log.Printf("=== CSV REPLAY DONE ===")
	log.Printf("  payloads published : %d (%.1f KB)", stats.payloadsPublished, float64(stats.bytesPublished)/1024.0)
	log.Printf("  datums encoded     : %d", stats.datumsEncoded)
	log.Printf("  datums skipped     : %d", stats.datumsSkipped)
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
}

type replayStats struct {
	payloadsPublished int
	bytesPublished    int64
	datumsEncoded     int
	datumsSkipped     int
	skipReasons       map[string]int
	unknownSignals    map[string]int
}

func (s *replayStats) merge(o replayStats) {
	s.datumsEncoded += o.datumsEncoded
	s.datumsSkipped += o.datumsSkipped
	if o.skipReasons != nil {
		if s.skipReasons == nil {
			s.skipReasons = map[string]int{}
		}
		for k, v := range o.skipReasons {
			s.skipReasons[k] += v
		}
	}
	if o.unknownSignals != nil {
		if s.unknownSignals == nil {
			s.unknownSignals = map[string]int{}
		}
		for k, v := range o.unknownSignals {
			s.unknownSignals[k] += v
		}
	}
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

// buildCSVPayload converts a group of csvRows that share a timestamp into
// an ftproto.Payload, dispatching each signal's value via SignalMeta.ValueKind.
func buildCSVPayload(vin string, group []csvRow) (*ftproto.Payload, replayStats) {
	stats := replayStats{
		skipReasons:    map[string]int{},
		unknownSignals: map[string]int{},
	}
	if len(group) == 0 {
		return nil, stats
	}

	data := make([]*ftproto.Datum, 0, len(group))
	for _, row := range group {
		meta, ok := protomodel.SignalsByName[row.signal]
		if !ok {
			stats.datumsSkipped++
			stats.unknownSignals[row.signal]++
			continue
		}
		fieldEnum, ok := ftproto.Field_value[row.signal]
		if !ok {
			stats.datumsSkipped++
			stats.skipReasons["no Field_value"]++
			continue
		}

		val, reason := encodeValue(meta, row)
		if val == nil {
			stats.datumsSkipped++
			stats.skipReasons[reason]++
			continue
		}

		data = append(data, &ftproto.Datum{
			Key:   ftproto.Field(fieldEnum),
			Value: val,
		})
		stats.datumsEncoded++
	}

	if len(data) == 0 {
		return nil, stats
	}

	return &ftproto.Payload{
		Vin:       vin,
		CreatedAt: timestamppb.New(group[0].createdAt),
		Data:      data,
	}, stats
}

// encodeValue dispatches to the right Value oneof variant based on the
// signal's declared ValueKind. Returns (nil, reason) when the row cannot
// be encoded (missing/empty value, unsupported kind, parse error).
func encodeValue(meta *protomodel.SignalMeta, row csvRow) (*ftproto.Value, string) {
	switch meta.ValueKind {
	case protomodel.ValueKindFloat:
		f, err := strconv.ParseFloat(row.valueNum, 32)
		if err != nil {
			return nil, "float parse error"
		}
		return &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: float32(f)}}, ""

	case protomodel.ValueKindDouble:
		f, err := strconv.ParseFloat(row.valueNum, 64)
		if err != nil {
			return nil, "double parse error"
		}
		return &ftproto.Value{Value: &ftproto.Value_DoubleValue{DoubleValue: f}}, ""

	case protomodel.ValueKindInt32:
		i, err := strconv.ParseInt(row.valueNum, 10, 32)
		if err != nil {
			// Some int32 signals get serialised as float in CSV — try that.
			f, err2 := strconv.ParseFloat(row.valueNum, 64)
			if err2 != nil {
				return nil, "int32 parse error"
			}
			i = int64(f)
		}
		return &ftproto.Value{Value: &ftproto.Value_IntValue{IntValue: int32(i)}}, ""

	case protomodel.ValueKindInt64:
		i, err := strconv.ParseInt(row.valueNum, 10, 64)
		if err != nil {
			f, err2 := strconv.ParseFloat(row.valueNum, 64)
			if err2 != nil {
				return nil, "int64 parse error"
			}
			i = int64(f)
		}
		return &ftproto.Value{Value: &ftproto.Value_LongValue{LongValue: i}}, ""

	case protomodel.ValueKindBool:
		v := strings.ToLower(strings.TrimSpace(row.valueBool))
		if v == "" {
			return nil, "bool: empty value_bool"
		}
		var b bool
		switch v {
		case "t", "true", "1", "yes":
			b = true
		case "f", "false", "0", "no":
			b = false
		default:
			return nil, "bool: unrecognised value"
		}
		return &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: b}}, ""

	case protomodel.ValueKindString:
		s := strings.TrimSpace(row.valueStr)
		if s == "" {
			return nil, "string: empty value_str"
		}
		return &ftproto.Value{Value: &ftproto.Value_StringValue{StringValue: s}}, ""

	case protomodel.ValueKindEnum:
		return encodeTypedEnum(meta, row)

	case protomodel.ValueKindCompound:
		// Compound signals (Location, DoorState, TireLocation, Time)
		// can't be reconstructed from the flat CSV — they would need
		// the original LocationValue/StringValue JSON.
		return nil, "compound: not representable in CSV"

	case protomodel.ValueKindTime:
		// TimeValue compound — same issue.
		return nil, "time: not representable in CSV"

	default:
		return nil, "unsupported ValueKind: " + meta.ValueKind.String()
	}
}

// encodeTypedEnum handles signals whose ValueKind is ValueKindEnum. The
// most critical one for the EXPECTED_RESULTS.md fixture is ShiftState
// (Field=Gear) since R/D/P transitions drive the FSM. Other typed enums
// are dispatched best-effort via the protomodel Parse* helpers; if a
// helper isn't wired here yet, the row is skipped.
func encodeTypedEnum(meta *protomodel.SignalMeta, row csvRow) (*ftproto.Value, string) {
	s := strings.TrimSpace(row.valueStr)
	if s == "" {
		// Some enum-valued signals also arrive numerically.
		if row.valueNum != "" {
			s = row.valueNum
		} else {
			return nil, "enum: empty value_str"
		}
	}

	switch meta.EnumTypeName {
	case "ShiftState":
		v, err := parseShiftState(s)
		if err != nil {
			return nil, "enum ShiftState: " + err.Error()
		}
		return &ftproto.Value{Value: &ftproto.Value_ShiftStateValue{ShiftStateValue: v}}, ""

	case "ChargingState":
		// Try the numeric ftproto enum reverse map first.
		if num, ok := ftproto.ChargingState_value[s]; ok {
			return &ftproto.Value{Value: &ftproto.Value_ChargingValue{ChargingValue: ftproto.ChargingState(num)}}, ""
		}
		// Fall back to the prefixed form (ChargeStateCharging etc.).
		if num, ok := ftproto.ChargingState_value["ChargeState"+s]; ok {
			return &ftproto.Value{Value: &ftproto.Value_ChargingValue{ChargingValue: ftproto.ChargingState(num)}}, ""
		}
		return nil, "enum ChargingState: unknown value " + s

	default:
		// Fall back to StringValue for typed enums we haven't wired
		// yet. The codec will reject these, so they show up in DLQ;
		// counts surface in the skipReasons.
		return nil, "enum " + meta.EnumTypeName + ": no typed encoder wired"
	}
}

// parseShiftState mirrors the Tesla proto ShiftState enum literals.
// The CSV stores P/R/N/D and occasionally the full "ShiftStateD" form;
// accept both.
func parseShiftState(s string) (ftproto.ShiftState, error) {
	candidates := []string{s, "ShiftState" + s}
	for _, c := range candidates {
		if v, ok := ftproto.ShiftState_value[c]; ok {
			return ftproto.ShiftState(v), nil
		}
	}
	// Single-char short form
	switch strings.ToUpper(s) {
	case "P":
		return ftproto.ShiftState_ShiftStateP, nil
	case "R":
		return ftproto.ShiftState_ShiftStateR, nil
	case "N":
		return ftproto.ShiftState_ShiftStateN, nil
	case "D":
		return ftproto.ShiftState_ShiftStateD, nil
	}
	return 0, fmt.Errorf("unrecognised %q", s)
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

func indexHeaders(header []string, want []string) map[string]int {
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
		log.Fatalf("csv missing required columns: %v (got %v)", missing, header)
	}
	return out
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

func parseTimeFilter(s string, def time.Time) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	t, err := parseCSVTimestamp(s)
	if err != nil {
		log.Fatalf("invalid time filter %q: %v", s, err)
	}
	return t
}

