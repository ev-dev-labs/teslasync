package ocpp

import (
	"encoding/json"
	"time"
)

// Strongly-typed payloads for the OCPP 1.6 messages this CSMS handles.
// Every Req/Res pair has explicit json tags so the encoder produces
// the camelCase wire form the charger expects — never the Go default
// PascalCase.

// BootNotificationReq is sent by the charger once on startup and
// (per spec) again whenever the CSMS rejects a previous boot. The
// CSMS uses the vendor/model fields to drive any vendor-specific
// quirks (none implemented today — recorded for observability).
type BootNotificationReq struct {
	ChargePointVendor       string `json:"chargePointVendor"`
	ChargePointModel        string `json:"chargePointModel"`
	ChargePointSerialNumber string `json:"chargePointSerialNumber,omitempty"`
	FirmwareVersion         string `json:"firmwareVersion,omitempty"`
	Iccid                   string `json:"iccid,omitempty"`
	Imsi                    string `json:"imsi,omitempty"`
	MeterSerialNumber       string `json:"meterSerialNumber,omitempty"`
	MeterType               string `json:"meterType,omitempty"`
}

type BootNotificationRes struct {
	CurrentTime string `json:"currentTime"`
	Interval    int    `json:"interval"`
	Status      string `json:"status"` // Accepted | Pending | Rejected
}

type HeartbeatRes struct {
	CurrentTime string `json:"currentTime"`
}

// StatusNotificationReq carries the connector's state-machine
// transition. We persist the latest status per (connectorId) so
// the SPA can render a per-connector availability indicator.
type StatusNotificationReq struct {
	ConnectorID     int    `json:"connectorId"`
	Status          string `json:"status"`    // Available, Preparing, Charging, …
	ErrorCode       string `json:"errorCode"` // NoError, ConnectorLockFailure, …
	Info            string `json:"info,omitempty"`
	Timestamp       string `json:"timestamp,omitempty"`
	VendorID        string `json:"vendorId,omitempty"`
	VendorErrorCode string `json:"vendorErrorCode,omitempty"`
}

// SampledValue is one numeric sample within a MeterValues batch.
// Measurand defaults to "Energy.Active.Import.Register" per spec —
// that's the lifetime kWh counter every charger reports.
type SampledValue struct {
	Value     string `json:"value"`
	Context   string `json:"context,omitempty"`
	Format    string `json:"format,omitempty"`
	Measurand string `json:"measurand,omitempty"`
	Phase     string `json:"phase,omitempty"`
	Location  string `json:"location,omitempty"`
	Unit      string `json:"unit,omitempty"`
}

type MeterValue struct {
	Timestamp    string         `json:"timestamp"`
	SampledValue []SampledValue `json:"sampledValue"`
}

type MeterValuesReq struct {
	ConnectorID   int          `json:"connectorId"`
	TransactionID *int         `json:"transactionId,omitempty"`
	MeterValue    []MeterValue `json:"meterValue"`
}

type StartTransactionReq struct {
	ConnectorID   int    `json:"connectorId"`
	IDTag         string `json:"idTag"`
	MeterStart    int    `json:"meterStart"`
	Timestamp     string `json:"timestamp"`
	ReservationID *int   `json:"reservationId,omitempty"`
}

// IDTagInfo is the standardized authorization envelope returned in
// StartTransaction + Authorize responses.
type IDTagInfo struct {
	Status      string `json:"status"` // Accepted | Blocked | Expired | Invalid | ConcurrentTx
	ExpiryDate  string `json:"expiryDate,omitempty"`
	ParentIDTag string `json:"parentIdTag,omitempty"`
}

type StartTransactionRes struct {
	TransactionID int       `json:"transactionId"`
	IDTagInfo     IDTagInfo `json:"idTagInfo"`
}

type StopTransactionReq struct {
	IDTag           string       `json:"idTag,omitempty"`
	MeterStop       int          `json:"meterStop"`
	Timestamp       string       `json:"timestamp"`
	TransactionID   int          `json:"transactionId"`
	Reason          string       `json:"reason,omitempty"`
	TransactionData []MeterValue `json:"transactionData,omitempty"`
}

type StopTransactionRes struct {
	IDTagInfo *IDTagInfo `json:"idTagInfo,omitempty"`
}

// DecodePayload is a small helper for handlers — they declare the
// concrete request type and we hand back the decoded value.
func DecodePayload[T any](raw json.RawMessage) (T, error) {
	var v T
	if len(raw) == 0 {
		return v, nil
	}
	err := json.Unmarshal(raw, &v)
	return v, err
}

// ParseISOTime parses the various ISO-8601 forms chargers emit. Most
// emit `2006-01-02T15:04:05.000Z`; some omit the fractional seconds
// or use a `+00:00` offset. We try the strict form first then fall
// back to time.RFC3339 / time.RFC3339Nano.
func ParseISOTime(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.000Z",
		time.RFC3339Nano,
		time.RFC3339,
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, errInvalidTime(s)
}

type errInvalidTime string

func (e errInvalidTime) Error() string { return "invalid OCPP timestamp: " + string(e) }
