// Package validation contains domain-neutral text, identifier, and UI export
// contracts shared across backend packages.
package validation

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxNameRunes   = 200
	MaxPromptRunes = 4096
)

var (
	ErrEmpty                = errors.New("value is empty")
	ErrControlCharacters    = errors.New("value contains control characters")
	ErrCRLF                 = errors.New("value contains CR or LF characters")
	ErrLeadingTrailingSpace = errors.New("value has leading or trailing whitespace")
	ErrTextTooLong          = errors.New("value exceeds its rune limit")
	ErrInvalidVehicleID     = errors.New("vehicle ID must be positive")
	ErrInvalidPositiveID    = errors.New("ID must be positive")
)

// TrimSpace removes Unicode whitespace from both ends of value.
func TrimSpace(value string) string {
	return strings.TrimSpace(value)
}

// TrimmedRuneCount returns the number of Unicode code points after trimming.
func TrimmedRuneCount(value string) int {
	return utf8.RuneCountInString(TrimSpace(value))
}

// RuneCount returns the number of Unicode code points in value.
func RuneCount(value string) int {
	return utf8.RuneCountInString(value)
}

// HasControlCharacters reports whether value contains a Unicode control character.
func HasControlCharacters(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// HasCRLF reports whether value contains a carriage return or line feed.
func HasCRLF(value string) bool {
	return strings.ContainsRune(value, '\r') || strings.ContainsRune(value, '\n')
}

// HasLeadingOrTrailingWhitespace reports whitespace at either boundary.
func HasLeadingOrTrailingWhitespace(value string) bool {
	if value == "" {
		return false
	}
	runes := []rune(value)
	return unicode.IsSpace(runes[0]) || unicode.IsSpace(runes[len(runes)-1])
}

// ValidateText trims value, rejects empty/control text, and enforces maxRunes.
// Leading and trailing whitespace is normalized and accepted by this contract;
// use ValidateName when a caller requires whitespace to be rejected at the boundary.
func ValidateText(value string, maxRunes int) (string, error) {
	if maxRunes < 0 {
		return "", fmt.Errorf("invalid text limit %d", maxRunes)
	}
	if HasCRLF(value) {
		return "", ErrCRLF
	}

	trimmed := TrimSpace(value)
	if trimmed == "" {
		return "", ErrEmpty
	}
	if HasCRLF(trimmed) {
		return "", ErrCRLF
	}
	if HasControlCharacters(trimmed) {
		return "", ErrControlCharacters
	}
	if RuneCount(trimmed) > maxRunes {
		return "", fmt.Errorf("%w: maximum %d runes", ErrTextTooLong, maxRunes)
	}
	return trimmed, nil
}

// ValidateTrimmedText supports JSON/null-like pointer inputs. A nil or
// whitespace-only pointer is empty; successful values are trimmed.
func ValidateTrimmedText(value *string, maxRunes int) (string, error) {
	if value == nil {
		return "", ErrEmpty
	}
	return ValidateText(*value, maxRunes)
}

// ValidateName validates the shared 200-rune human-readable name contract.
func ValidateName(value string) (string, error) {
	return validateBoundaryName(value, MaxNameRunes)
}

// ValidateNameRunes validates a name with an explicit rune limit.
func ValidateNameRunes(value string, maxRunes int) (string, error) {
	return validateBoundaryName(value, maxRunes)
}

func validateBoundaryName(value string, maxRunes int) (string, error) {
	if maxRunes < 0 {
		return "", fmt.Errorf("invalid name limit %d", maxRunes)
	}
	if value == "" {
		return "", ErrEmpty
	}
	if TrimSpace(value) == "" {
		return "", ErrEmpty
	}
	if HasCRLF(value) {
		return "", ErrCRLF
	}
	if HasLeadingOrTrailingWhitespace(value) {
		return "", ErrLeadingTrailingSpace
	}
	if HasControlCharacters(value) {
		return "", ErrControlCharacters
	}
	if RuneCount(value) > maxRunes {
		return "", fmt.Errorf("%w: maximum %d runes", ErrTextTooLong, maxRunes)
	}
	return value, nil
}

// ValidatePrompt validates the shared 4096-rune prompt contract. Null and
// empty prompts are rejected, while leading/trailing whitespace is normalized.
func ValidatePrompt(value *string) (string, error) {
	return ValidateTrimmedText(value, MaxPromptRunes)
}

// ValidateVehicleID rejects null-equivalent values and all non-positive IDs.
func ValidateVehicleID(value int64) error {
	if value <= 0 {
		return ErrInvalidVehicleID
	}
	return nil
}

// ValidatePositiveID is a generic positive database/entity ID contract.
func ValidatePositiveID(value int64) error {
	if value <= 0 {
		return ErrInvalidPositiveID
	}
	return nil
}

// ValidateID is an alias for the generic positive ID contract.
func ValidateID(value int64) error {
	return ValidatePositiveID(value)
}
