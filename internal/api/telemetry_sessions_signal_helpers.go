package api

import "time"

// eventTimeOrNow returns ts if non-zero (in UTC), else falls back to
// wall-clock time.Now().UTC(). Phase-42a/0030.bis (commit C2 of v3.4
// prod-replay accuracy fix): drive/charge session helpers thread a
// payloadTs from the AtomicsObserver pipeline so start/end timestamps
// reflect the originating signal event-time. Callers without
// event-time (legacy ProcessSignals wrapper, recovery / flush paths,
// reconciler ticks) pass time.Time{} and get the historical
// wall-clock behavior.
func eventTimeOrNow(ts time.Time) time.Time {
	if ts.IsZero() {
		return time.Now().UTC()
	}
	return ts.UTC()
}

// resolveFloat gets a float signal from batch → accumulated → SignalStore (last-known).
func (t *TelemetrySessionTracker) resolveFloat(vehicleID int64, signals, accum map[string]interface{}, keys ...string) (float64, bool) {
	if v, ok := signalFloat(signals, keys...); ok {
		return v, true
	}
	if v, ok := signalFloat(accum, keys...); ok {
		return v, true
	}
	if t.localSignals != nil {
		for _, k := range keys {
			if v, ok := t.localSignals.GetFloat(vehicleID, k); ok {
				return v, true
			}
		}
	}
	return 0, false
}

// resolveInt gets an int signal from batch → accumulated → SignalStore.
func (t *TelemetrySessionTracker) resolveInt(vehicleID int64, signals, accum map[string]interface{}, keys ...string) (int, bool) {
	if v, ok := signalInt(signals, keys...); ok {
		return v, true
	}
	if v, ok := signalInt(accum, keys...); ok {
		return v, true
	}
	if t.localSignals != nil {
		for _, k := range keys {
			if fv, ok := t.localSignals.GetFloat(vehicleID, k); ok {
				return int(fv), true
			}
		}
	}
	return 0, false
}

// resolveLatLon gets location from batch → accumulated → SignalStore.
func (t *TelemetrySessionTracker) resolveLatLon(vehicleID int64, signals, accum map[string]interface{}) (float64, float64, bool) {
	if lat, lon, ok := signalLatLon(signals); ok {
		return lat, lon, true
	}
	if lat, lon, ok := signalLatLon(accum); ok {
		return lat, lon, true
	}
	if t.localSignals != nil {
		lat, latOk := t.localSignals.GetFloat(vehicleID, "Latitude")
		lon, lonOk := t.localSignals.GetFloat(vehicleID, "Longitude")
		if latOk && lonOk && lat != 0 && lon != 0 {
			return lat, lon, true
		}
	}
	return 0, 0, false
}

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return toFloatOk(v)
		}
	}
	return 0, false
}

// signalLatLon extracts latitude and longitude from the signals map.
// Tesla Fleet Telemetry sends Location as a JSON object {"latitude": N, "longitude": N},
// while the REST API may send separate Latitude/Longitude signals.
func signalLatLon(signals map[string]interface{}) (lat, lon float64, ok bool) {
	// Fleet Telemetry: Location is a map with latitude/longitude keys
	if loc, isMap := signals["Location"].(map[string]interface{}); isMap {
		la, laOk := toFloatOk(loc["latitude"])
		lo, loOk := toFloatOk(loc["longitude"])
		if laOk && loOk {
			return la, lo, true
		}
	}
	// REST API fallback: separate Latitude/Longitude signals
	la, laOk := signalFloat(signals, "Latitude")
	lo, loOk := signalFloat(signals, "Longitude")
	if laOk && loOk {
		return la, lo, true
	}
	return 0, 0, false
}

// signalPowerKW extracts power in kW. Tesla Fleet Telemetry has no "PackPower"
// signal; power is computed from PackVoltage (V) × PackCurrent (A) → kW.
func signalPowerKW(signals map[string]interface{}) (float64, bool) {
	if v, ok := signalFloat(signals, "PackPower", "Power"); ok {
		return v, true
	}
	voltage, vOk := toFloatOk(signals["PackVoltage"])
	current, cOk := toFloatOk(signals["PackCurrent"])
	if vOk && cOk {
		return voltage * current / 1000.0, true
	}
	return 0, false
}

func signalInt(signals map[string]interface{}, keys ...string) (int, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if f, fok := toFloatOk(v); fok {
				return int(f), true
			}
		}
	}
	return 0, false
}

func signalStr(signals map[string]interface{}, keys ...string) (string, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if s, ok2 := v.(string); ok2 && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func floatPtr(v float64) *float64 { return &v }
func intPtr(v int) *int           { return &v }
func int16Ptr(v int) *int16       { i := int16(v); return &i }
func boolPtr(v bool) *bool        { return &v }
func strPtr(v string) *string     { return &v }
func derefInt16AsInt(p *int16) int {
	if p == nil {
		return 0
	}
	return int(*p)
}

// snapFloat extracts a float64 from a signal snapshot map (returned by SnapshotAt).
// Returns (0, false) if the key is missing or not a numeric type.
func snapFloat(snap map[string]interface{}, key string) (float64, bool) {
	if snap == nil {
		return 0, false
	}
	return toFloatOk(snap[key])
}

func ptrStrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
