// Package repairsnapshot provides integrity and validation primitives for
// opaque session snapshots used by data repair.
package repairsnapshot

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
)

var (
	// ErrNotFound distinguishes an absent source session from a database error.
	ErrNotFound = errors.New("repair snapshot: source row not found")
	// ErrMalformedPayload means an opaque snapshot does not match its declared schema.
	ErrMalformedPayload = errors.New("repair snapshot: malformed payload")
	// ErrAlreadyExists means a restore would overwrite a currently existing session.
	ErrAlreadyExists = errors.New("repair snapshot: session already exists")
	// ErrConflict means a restore would conflict with a relationship that changed independently.
	ErrConflict = errors.New("repair snapshot: relationship conflict")
	// ErrTransactionRequired prevents using a snapshot primitive outside its atomic transaction.
	ErrTransactionRequired = errors.New("repair snapshot: transaction is required")
	// ErrChecksumMismatch means the stored recovery payload no longer matches
	// the checksum captured before the source row was deleted.
	ErrChecksumMismatch = errors.New("repair snapshot: checksum mismatch")
)

// Float64 preserves PostgreSQL float8 special values in JSON snapshots.
// to_jsonb renders NaN and infinities as strings, which encoding/json cannot
// decode directly into float64.
type Float64 float64

// UnmarshalJSON accepts an ordinary JSON number or PostgreSQL's three quoted
// float8 sentinel spellings.
func (f *Float64) UnmarshalJSON(payload []byte) error {
	var special string
	if len(payload) > 0 && payload[0] == '"' {
		if err := json.Unmarshal(payload, &special); err != nil {
			return fmt.Errorf("%w: decode float string: %v", ErrMalformedPayload, err)
		}
		switch special {
		case "NaN":
			*f = Float64(math.NaN())
		case "Infinity":
			*f = Float64(math.Inf(1))
		case "-Infinity":
			*f = Float64(math.Inf(-1))
		default:
			return fmt.Errorf("%w: unsupported float string %q", ErrMalformedPayload, special)
		}
		return nil
	}

	var number json.Number
	if err := json.Unmarshal(payload, &number); err != nil {
		return fmt.Errorf("%w: decode float: %v", ErrMalformedPayload, err)
	}
	value, err := strconv.ParseFloat(number.String(), 64)
	if err != nil || math.IsInf(value, 0) {
		return fmt.Errorf("%w: invalid finite float %q", ErrMalformedPayload, number)
	}
	*f = Float64(value)
	return nil
}

// Float64Ptr converts a snapshot float to the built-in type pgx encodes.
func Float64Ptr(value *Float64) *float64 {
	if value == nil {
		return nil
	}
	converted := float64(*value)
	return &converted
}

// Canonicalize normalizes JSON's insignificant object-key ordering. Array order
// and JSON number spelling are retained because both are meaningful to a
// snapshot's semantic content.
func Canonicalize(payload []byte) (json.RawMessage, error) {
	if err := rejectDuplicateObjectKeys(payload); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()

	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("%w: decode JSON: %v", ErrMalformedPayload, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("%w: multiple JSON values", ErrMalformedPayload)
		}
		return nil, fmt.Errorf("%w: trailing JSON: %v", ErrMalformedPayload, err)
	}

	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal canonical JSON: %v", ErrMalformedPayload, err)
	}
	return json.RawMessage(canonical), nil
}

func rejectDuplicateObjectKeys(payload []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := consumeJSONValue(decoder); err != nil {
		return fmt.Errorf("%w: decode JSON: %v", ErrMalformedPayload, err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return fmt.Errorf("%w: multiple JSON values", ErrMalformedPayload)
		}
		return fmt.Errorf("%w: trailing JSON: %v", ErrMalformedPayload, err)
	}
	return nil
}

func consumeJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		keys := make(map[string]struct{})
		for decoder.More() {
			token, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := token.(string)
			if !ok {
				return errors.New("object key is not a string")
			}
			if _, exists := keys[key]; exists {
				return fmt.Errorf("duplicate object key %q", key)
			}
			keys[key] = struct{}{}
			if err := consumeJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token() // closing '}'
		return err
	case '[':
		for decoder.More() {
			if err := consumeJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token() // closing ']'
		return err
	default:
		return fmt.Errorf("unexpected JSON delimiter %q", delim)
	}
}

// Checksum returns the lower-case SHA-256 checksum of semantic JSON.
func Checksum(payload []byte) (string, error) {
	canonical, err := Canonicalize(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

// VerifyChecksum validates a checksum against semantic JSON.
func VerifyChecksum(payload []byte, expected string) (bool, error) {
	actual, err := Checksum(payload)
	if err != nil {
		return false, err
	}
	return actual == expected, nil
}

// RequireChecksum rejects a recovery payload unless its semantic JSON checksum
// matches the value captured at quarantine time.
func RequireChecksum(payload []byte, expected string) error {
	ok, err := VerifyChecksum(payload, expected)
	if err != nil {
		return err
	}
	if !ok {
		return ErrChecksumMismatch
	}
	return nil
}

// ExactObject decodes a JSON object and verifies that it has exactly the
// expected keys. It is used before typed decoding so omitted fields cannot
// silently become Go zero values during a restore.
func ExactObject(payload []byte, expectedKeys []string) (map[string]json.RawMessage, error) {
	canonical, err := Canonicalize(payload)
	if err != nil {
		return nil, err
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(canonical, &object); err != nil || object == nil {
		if err == nil {
			err = errors.New("JSON value is not an object")
		}
		return nil, fmt.Errorf("%w: object: %v", ErrMalformedPayload, err)
	}

	expected := append([]string(nil), expectedKeys...)
	sort.Strings(expected)
	actual := make([]string, 0, len(object))
	for key := range object {
		actual = append(actual, key)
	}
	sort.Strings(actual)
	if len(actual) != len(expected) {
		return nil, fmt.Errorf("%w: expected keys %v, got %v", ErrMalformedPayload, expected, actual)
	}
	for i := range expected {
		if actual[i] != expected[i] {
			return nil, fmt.Errorf("%w: expected keys %v, got %v", ErrMalformedPayload, expected, actual)
		}
	}
	return object, nil
}

// RequireNonNull rejects JSON null for required database columns.
func RequireNonNull(object map[string]json.RawMessage, keys ...string) error {
	for _, key := range keys {
		value, ok := object[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("%w: required field %q is null", ErrMalformedPayload, key)
		}
	}
	return nil
}
