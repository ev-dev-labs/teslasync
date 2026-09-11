package batterydegradation

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// Battery certificate: a server-signed, buyer-verifiable attestation of a
// vehicle's battery health for resale. The seller issues it (authenticated),
// shares the JSON + signature with a buyer, and anyone verifies it against
// the public verify endpoint without an account.
//
// The signature is HMAC-SHA256 over the struct's encoding/json bytes, which
// are deterministic (field order follows declaration order), keyed by a
// domain-separated derivation of the auth JWT secret so no new secret needs
// provisioning and the JWT key is never reused across protocols.

const (
	// batteryCertIssuer identifies the attestation origin.
	batteryCertIssuer = "teslasync"
	// batteryCertVersion versions the signed payload shape.
	batteryCertVersion = 1
	// batteryCertValidity bounds how long an issued certificate verifies.
	batteryCertValidity = 30 * 24 * time.Hour
	// batteryCertKeyDomain separates the derived HMAC key from the JWT key.
	batteryCertKeyDomain = "teslasync-battery-cert-v1\x00"
)

// BatteryCertificate is the signed payload. Compact by design: only the
// buyer-relevant health snapshot, no history or per-session detail.
type BatteryCertificate struct {
	Issuer                  string    `json:"issuer"`
	Version                 int       `json:"version"`
	VehicleID               int64     `json:"vehicle_id"`
	IssuedAt                time.Time `json:"issued_at"`
	ExpiresAt               time.Time `json:"expires_at"`
	CurrentSOH              float64   `json:"current_soh"`
	EstimatedCapacityKWh    float64   `json:"estimated_capacity_kwh"`
	OriginalCapacityKWh     float64   `json:"original_capacity_kwh"`
	DegradationRatePctPerYr float64   `json:"degradation_rate_pct_per_year"`
	BatteryAgeMonths        int       `json:"battery_age_months"`
	TotalCycles             int       `json:"total_cycles"`
	ChargeHabitsScore       float64   `json:"charge_habits_score"`
	StressLevel             string    `json:"stress_level"`
	FastChargePct           float64   `json:"fast_charge_pct"`
	TempExposureScore       *int      `json:"temp_exposure_score"`
	TempExposureReason      *string   `json:"temp_exposure_reason"`
}

// NewBatteryCertificate builds the signed payload from a health response.
// Pure: no I/O, deterministic for a fixed now.
func NewBatteryCertificate(health *batteryHealthResponse, now time.Time) *BatteryCertificate {
	now = now.UTC().Truncate(time.Second)
	return &BatteryCertificate{
		Issuer:                  batteryCertIssuer,
		Version:                 batteryCertVersion,
		VehicleID:               health.VehicleID,
		IssuedAt:                now,
		ExpiresAt:               now.Add(batteryCertValidity),
		CurrentSOH:              health.CurrentSoh,
		EstimatedCapacityKWh:    health.EstimatedCapacityWh / 1000.0,
		OriginalCapacityKWh:     health.OriginalCapacityWh / 1000.0,
		DegradationRatePctPerYr: health.DegradationRatePctPerYear,
		BatteryAgeMonths:        health.BatteryAgeMonths,
		TotalCycles:             health.TotalCycles,
		ChargeHabitsScore:       health.ChargeHabitsScore,
		StressLevel:             health.StressLevel,
		FastChargePct:           health.FastChargePct,
		TempExposureScore:       health.TempExposureScore,
		TempExposureReason:      health.TempExposureReason,
	}
}

// DeriveCertKey derives the certificate HMAC key from the auth JWT secret
// with a fixed domain separator.
func DeriveCertKey(jwtSecret string) []byte {
	sum := sha256.Sum256([]byte(batteryCertKeyDomain + jwtSecret))
	return sum[:]
}

// CertSigner signs and verifies battery certificates. The zero value is
// unusable; construct with a derived key. Safe for concurrent use.
type CertSigner struct {
	key []byte
}

// NewCertSigner wires a signer. Panics on an empty key (fail-fast wiring).
func NewCertSigner(key []byte) *CertSigner {
	if len(key) == 0 {
		panic("batterydegradation: empty certificate key")
	}
	return &CertSigner{key: key}
}

// Sign returns the hex HMAC-SHA256 of the certificate's canonical bytes.
func (s *CertSigner) Sign(cert *BatteryCertificate) (string, error) {
	raw, err := json.Marshal(cert)
	if err != nil {
		return "", fmt.Errorf("marshal certificate: %w", err)
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// Verify reports whether sig is a valid signature for cert at time now. A
// structurally valid but expired certificate does NOT verify: expiry is
// part of authenticity for a point-in-time health attestation.
func (s *CertSigner) Verify(cert *BatteryCertificate, sig string, now time.Time) bool {
	if cert == nil || cert.Issuer != batteryCertIssuer || cert.Version != batteryCertVersion {
		return false
	}
	if !now.Before(cert.ExpiresAt) || now.Before(cert.IssuedAt.Add(-time.Hour)) {
		return false
	}
	want, err := s.Sign(cert)
	if err != nil {
		return false
	}
	got, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	wantRaw, _ := hex.DecodeString(want)
	return subtle.ConstantTimeCompare(got, wantRaw) == 1
}
