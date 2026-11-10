package widgetdesign

import (
	"crypto/sha256"
	"encoding/hex"
)

type Preference struct {
	PackID  string
	AppWide bool
}

// ValidPackID deliberately accepts only shipped designs, never arbitrary CSS.
func ValidPackID(id string) bool {
	switch id {
	case "classic", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
		"motorsport", "blueprint", "editorial", "ambient", "terminal", "atlas",
		"analog", "observatory", "bauhaus", "quiet", "warm", "swiss", "material",
		"glass", "deco", "kinetic", "brutal", "cyber", "memphis":
		return true
	}
	return false
}

// Scope hashes the exact provider subject. Open deployments share a separate
// server-owned scope. Callers must verify identity before calling this function.
func Scope(subject string, open bool) string {
	value := "forward_auth:" + subject
	if open {
		value = "open"
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
