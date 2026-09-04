package teslaphysics

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

const certificateRules = "Drive end = confirmed Park (Gear=P, 30s). Charge end = Disconnected (unplug). Neutral is not park. Stopped/Complete are still plugged."

type certificateBody struct {
	VehicleID int64             `json:"vehicle_id"`
	IssuedAt  time.Time         `json:"issued_at"`
	From      time.Time         `json:"from"`
	To        time.Time         `json:"to"`
	Rules     string            `json:"rules"`
	Drives    []SessionBoundary `json:"drives"`
	Charges   []SessionBoundary `json:"charges"`
}

// BuildSessionCertificate hashes canonical Park/unplug boundaries.
func BuildSessionCertificate(
	vehicleID int64,
	issuedAt, from, to time.Time,
	drives, charges []SessionBoundary,
	hmacKey []byte,
) SessionCertificate {
	body := certificateBody{
		VehicleID: vehicleID,
		IssuedAt:  issuedAt.UTC(),
		From:      from.UTC(),
		To:        to.UTC(),
		Rules:     certificateRules,
		Drives:    drives,
		Charges:   charges,
	}
	if body.Drives == nil {
		body.Drives = []SessionBoundary{}
	}
	if body.Charges == nil {
		body.Charges = []SessionBoundary{}
	}
	raw, _ := json.Marshal(body)
	sum := sha256.Sum256(raw)
	out := SessionCertificate{
		VehicleID:       body.VehicleID,
		IssuedAt:        body.IssuedAt,
		From:            body.From,
		To:              body.To,
		Rules:           body.Rules,
		Drives:          body.Drives,
		Charges:         body.Charges,
		IntegritySHA256: hex.EncodeToString(sum[:]),
		Honesty:         certificateHonesty,
	}
	if len(hmacKey) > 0 {
		mac := hmac.New(sha256.New, hmacKey)
		_, _ = mac.Write(raw)
		encoded := hex.EncodeToString(mac.Sum(nil))
		out.HMACSHA256 = &encoded
	}
	return out
}
