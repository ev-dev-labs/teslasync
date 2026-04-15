package v1

import (
	"fmt"
	"time"
)

// generateID creates a simple unique ID. In production, use UUIDs.
func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
