package database

import (
	"encoding/json"
	"fmt"
)

// marshalSignals produces the jsonb body for a telemetry row by serialising
// the given model to JSON and stripping out the metadata columns (id,
// vehicle_id, created_at), any "signals" key (to avoid recursion when the
// model itself exposes a Signals field), and any caller-supplied "core"
// column names that are stored as dedicated SQL columns.
//
// All nil values are removed so that backfilled rows stay compact and match
// jsonb_strip_nulls semantics used in the backfill migration (000143).
//
// This helper lets individual repos keep their existing typed struct fields
// (for backward compatibility with every handler that reads them) while the
// database layout migrates towards a jsonb-backed flexible schema.
func marshalSignals(v interface{}, coreCols ...string) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal signals struct: %w", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("unmarshal signals map: %w", err)
	}

	// If the struct has its own "signals" field, merge its entries into the
	// top-level map so they land as first-class signal keys. Typed struct
	// fields take precedence over Signals entries with the same key.
	if sig, ok := m["signals"].(map[string]interface{}); ok {
		for k, val := range sig {
			if _, exists := m[k]; !exists {
				m[k] = val
			}
		}
	}
	delete(m, "signals")

	delete(m, "id")
	delete(m, "vehicle_id")
	delete(m, "created_at")
	for _, c := range coreCols {
		delete(m, c)
	}
	for k, val := range m {
		if val == nil {
			delete(m, k)
		}
	}

	return json.Marshal(m)
}

// hydrateFromSignals unmarshals the given jsonb payload into the target
// struct. Because encoding/json only overwrites struct fields that are
// actually present in the JSON source, typed core columns already populated
// by Scan() are preserved.
func hydrateFromSignals(signalsRaw []byte, target interface{}) error {
	if len(signalsRaw) == 0 || string(signalsRaw) == "{}" {
		return nil
	}
	if err := json.Unmarshal(signalsRaw, target); err != nil {
		return fmt.Errorf("hydrate signals: %w", err)
	}
	return nil
}
