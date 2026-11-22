package smartreadinesssvc

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

func batteryEvidenceFingerprint[T any](observations []T) ([]byte, error) {
	data, err := json.Marshal(observations)
	if err != nil {
		return nil, fmt.Errorf("encode measured battery evidence: %w", err)
	}
	digest := sha256.Sum256(data)
	return digest[:], nil
}
