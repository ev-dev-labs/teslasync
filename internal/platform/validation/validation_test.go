package validation

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTrimSpace(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "ASCII spaces and tabs", input: " \t hello \t ", want: "hello"},
		{name: "Unicode whitespace", input: "\u00a0hello\u3000", want: "hello"},
		{name: "CR LF", input: "\r\nhello\r\n", want: "hello"},
		{name: "emoji edges", input: "🙂hello🙂", want: "🙂hello🙂"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TrimSpace(tt.input); got != tt.want {
				t.Fatalf("TrimSpace(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestRuneCountAndEmojiBoundaries(t *testing.T) {
	emoji200 := strings.Repeat("🙂", 200)
	emoji4096 := strings.Repeat("🚗", 4096)

	if got := utf8.RuneCountInString(emoji200); got != 200 {
		t.Fatalf("byte-independent rune setup count = %d, want 200", got)
	}
	if got := RuneCount(emoji200); got != 200 {
		t.Fatalf("RuneCount(emoji200) = %d, want 200", got)
	}
	if len(emoji200) <= 200 {
		t.Fatal("emoji200 must have a byte length greater than its rune length")
	}
	if got, err := ValidateText(emoji200, MaxNameRunes); err != nil || got != emoji200 {
		t.Fatalf("exact 200-rune emoji text = %q, %v; want accepted unchanged", got, err)
	}
	if got, err := ValidateText(emoji200+"a", MaxNameRunes); !errors.Is(err, ErrTextTooLong) || got != "" {
		t.Fatalf("201-rune emoji text = %q, %v; want ErrTextTooLong", got, err)
	}
	if got, err := ValidatePrompt(&emoji4096); err != nil || got != emoji4096 {
		t.Fatalf("exact 4096-rune emoji prompt = %q, %v; want accepted unchanged", got, err)
	}
	over := emoji4096 + "a"
	if got, err := ValidatePrompt(&over); !errors.Is(err, ErrTextTooLong) || got != "" {
		t.Fatal("4097-rune emoji prompt must return ErrTextTooLong")
	}
}

func TestTextControlCharactersAndLineBreaks(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr error
	}{
		{name: "NUL", value: "hello\x00world", wantErr: ErrControlCharacters},
		{name: "bell", value: "hello\x07world", wantErr: ErrControlCharacters},
		{name: "CRLF", value: "hello\r\nworld", wantErr: ErrCRLF},
		{name: "CR", value: "hello\rworld", wantErr: ErrCRLF},
		{name: "LF", value: "hello\nworld", wantErr: ErrCRLF},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateText(tt.value, 4096); !errors.Is(err, tt.wantErr) {
				t.Fatalf("ValidateText(%q) error = %v, want %v", tt.value, err, tt.wantErr)
			}
		})
	}
}

func TestNullAndEmptyText(t *testing.T) {
	var null *string
	if got, err := ValidateTrimmedText(null, MaxPromptRunes); !errors.Is(err, ErrEmpty) || got != "" {
		t.Fatalf("nil text = %q, %v; want ErrEmpty", got, err)
	}

	for _, value := range []string{"", " ", "\t", "\u00a0", "\u3000"} {
		if got, err := ValidateText(value, 4096); !errors.Is(err, ErrEmpty) || got != "" {
			t.Fatalf("empty text %q = %q, %v; want ErrEmpty", value, got, err)
		}
	}
}

func TestIDValidation(t *testing.T) {
	for _, id := range []int64{-1, 0} {
		if err := ValidateVehicleID(id); !errors.Is(err, ErrInvalidVehicleID) {
			t.Fatalf("ValidateVehicleID(%d) error = %v, want ErrInvalidVehicleID", id, err)
		}
		if err := ValidateID(id); !errors.Is(err, ErrInvalidPositiveID) {
			t.Fatalf("ValidateID(%d) error = %v, want ErrInvalidPositiveID", id, err)
		}
	}
	if err := ValidateVehicleID(1); err != nil {
		t.Fatalf("ValidateVehicleID(1) error = %v", err)
	}
	if err := ValidatePositiveID(9223372036854775807); err != nil {
		t.Fatalf("ValidatePositiveID(max int64) error = %v", err)
	}
}

func TestNameContractExact200AndWhitespace(t *testing.T) {
	exact := strings.Repeat("a", MaxNameRunes)
	if got, err := ValidateName(exact); err != nil || got != exact {
		t.Fatalf("exact 200-rune name = %q, %v; want accepted", got, err)
	}
	if _, err := ValidateName(exact + "a"); !errors.Is(err, ErrTextTooLong) {
		t.Fatalf("201-rune name error = %v, want ErrTextTooLong", err)
	}

	for _, value := range []string{" Home", "Home ", "\tHome", "Home\t", "\u00a0Home", "Home\u3000"} {
		if _, err := ValidateName(value); !errors.Is(err, ErrLeadingTrailingSpace) {
			t.Fatalf("ValidateName(%q) error = %v, want ErrLeadingTrailingSpace", value, err)
		}
	}
}

func TestPromptContractExact4096AndLeadingWhitespace(t *testing.T) {
	exact := strings.Repeat("x", MaxPromptRunes)
	prompt := exact
	if got, err := ValidatePrompt(&prompt); err != nil || got != exact {
		t.Fatalf("exact 4096-rune prompt = %q, %v; want accepted", got, err)
	}

	over := exact + "x"
	if got, err := ValidatePrompt(&over); !errors.Is(err, ErrTextTooLong) || got != "" {
		t.Fatalf("4097-rune prompt = %q, %v; want ErrTextTooLong", got, err)
	}

	trimmed := " \t prompt \t "
	if got, err := ValidatePrompt(&trimmed); err != nil || got != "prompt" {
		t.Fatalf("leading/trailing prompt whitespace = %q, %v; want %q", got, err, "prompt")
	}
}
