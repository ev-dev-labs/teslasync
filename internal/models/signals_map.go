package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// SignalsMap is a jsonb-backed flexible map used by telemetry snapshot tables.
//
// It consolidates rarely-queried, high-churn telemetry fields into a single
// `signals` JSONB column so that new Tesla Fleet signals can be stored without
// requiring an ALTER TABLE + model/repo/type churn cycle for every addition.
//
// A nil or zero-value SignalsMap serializes to the empty JSON object `{}` so
// it round-trips cleanly against a `NOT NULL DEFAULT '{}'` column.
type SignalsMap map[string]interface{}

// Value implements driver.Valuer. pgx uses this to encode the map as jsonb.
func (s SignalsMap) Value() (driver.Value, error) {
	if s == nil {
		return []byte("{}"), nil
	}
	b, err := json.Marshal(map[string]interface{}(s))
	if err != nil {
		return nil, fmt.Errorf("marshal signals map: %w", err)
	}
	return b, nil
}

// Scan implements sql.Scanner so pgx can decode a jsonb column into the map.
func (s *SignalsMap) Scan(src interface{}) error {
	if src == nil {
		*s = SignalsMap{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return fmt.Errorf("unsupported scan type for SignalsMap: %T", src)
	}
	if len(b) == 0 {
		*s = SignalsMap{}
		return nil
	}
	m := map[string]interface{}{}
	if err := json.Unmarshal(b, &m); err != nil {
		return fmt.Errorf("unmarshal signals map: %w", err)
	}
	*s = SignalsMap(m)
	return nil
}
