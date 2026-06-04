// Package ocpp implements a minimal Charging Station Management
// System (CSMS) for OCPP 1.6-J (JSON-over-WebSocket).
//
// Scope: this is a foundation, not a full CSMS. It implements the six
// messages that cover ~95% of the home/garage charger handshake +
// session lifecycle:
//
//	BootNotification     — charger announces vendor/model/firmware on startup
//	Heartbeat            — keep-alive every N seconds, charger drifts to our clock
//	StatusNotification   — connector state machine (Available/Charging/Faulted/…)
//	MeterValues          — kWh + kW + voltage + current samples mid-session
//	StartTransaction     — charger asks for a transactionId for an authorized RFID/auto-start
//	StopTransaction      — charger reports final meter + reason at session end
//
// Out of scope (deferred to a follow-up): RemoteStartTransaction,
// ChangeConfiguration, FirmwareUpdate, ReserveNow, OCPP 2.0.1 (BTC
// Smart Charging Profiles, ISO 15118 Plug & Charge). The transport
// + dispatch table here are protocol-version-agnostic, so adding 2.0.1
// messages later is additive.
//
// Why a separate binary (cmd/ocpp-server) and not a route on the main
// API server: OCPP-J uses WebSocket with the `ocpp1.6` subprotocol +
// the OCPP message envelope ([2|3|4, msgId, action, payload]) — both
// of which are foreign concerns to the existing chi router. Keeping
// it isolated also means a CSMS bug can't take down the SPA API.
package ocpp

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// MessageType is the leading integer of the OCPP-J envelope:
//
//	2 = Call            — request (CSMS → charger or charger → CSMS)
//	3 = CallResult      — successful response
//	4 = CallError       — error response
//
// See OCPP-J 1.6 specification §3.4 for the canonical definition.
type MessageType int

const (
	MessageTypeCall       MessageType = 2
	MessageTypeCallResult MessageType = 3
	MessageTypeCallError  MessageType = 4
)

// ErrorCode is the standardized OCPP-J error code returned in a
// CallError envelope. We surface a subset relevant to a minimal CSMS.
type ErrorCode string

const (
	ErrFormationViolation      ErrorCode = "FormationViolation"
	ErrInternalError           ErrorCode = "InternalError"
	ErrNotImplemented          ErrorCode = "NotImplemented"
	ErrNotSupported            ErrorCode = "NotSupported"
	ErrOccurrenceConstraint    ErrorCode = "OccurrenceConstraintViolation"
	ErrPropertyConstraint      ErrorCode = "PropertyConstraintViolation"
	ErrProtocolError           ErrorCode = "ProtocolError"
	ErrSecurityError           ErrorCode = "SecurityError"
	ErrTypeConstraintViolation ErrorCode = "TypeConstraintViolation"
)

// Call is the parsed form of an inbound OCPP request envelope.
// Payload is left as raw JSON because the action-specific handler
// owns the strongly-typed decode.
type Call struct {
	MessageID string
	Action    string
	Payload   json.RawMessage
}

// CallResult is what handlers return on success. Payload is
// re-marshaled to JSON before being placed in the wire envelope.
type CallResult struct {
	MessageID string
	Payload   interface{}
}

// CallError mirrors the OCPP CallError frame layout.
type CallError struct {
	MessageID    string
	Code         ErrorCode
	Description  string
	ErrorDetails interface{}
}

// ParseCall decodes a raw OCPP-J Call frame ([2, msgId, action, payload]).
// Returns ErrFormationViolation when the wire envelope is malformed —
// callers should respond with a CallError that mirrors the same code.
func ParseCall(raw []byte) (*Call, error) {
	var frame []json.RawMessage
	if err := json.Unmarshal(raw, &frame); err != nil {
		return nil, fmt.Errorf("envelope decode: %w", err)
	}
	if len(frame) != 4 {
		return nil, errors.New("call envelope must have 4 elements")
	}
	var msgType MessageType
	if err := json.Unmarshal(frame[0], &msgType); err != nil {
		return nil, fmt.Errorf("message type decode: %w", err)
	}
	if msgType != MessageTypeCall {
		return nil, fmt.Errorf("expected Call (2), got %d", msgType)
	}
	var msgID, action string
	if err := json.Unmarshal(frame[1], &msgID); err != nil {
		return nil, fmt.Errorf("message id decode: %w", err)
	}
	if err := json.Unmarshal(frame[2], &action); err != nil {
		return nil, fmt.Errorf("action decode: %w", err)
	}
	return &Call{MessageID: msgID, Action: action, Payload: frame[3]}, nil
}

// EncodeCallResult builds the wire form of a successful response:
// [3, msgId, payload].
func EncodeCallResult(r CallResult) ([]byte, error) {
	payloadRaw, err := json.Marshal(r.Payload)
	if err != nil {
		return nil, fmt.Errorf("payload marshal: %w", err)
	}
	if len(payloadRaw) == 0 || string(payloadRaw) == "null" {
		// OCPP-J requires an empty-object payload when there's no
		// response data; "null" is not a valid payload per spec.
		payloadRaw = []byte("{}")
	}
	frame := []json.RawMessage{
		json.RawMessage(fmt.Sprintf("%d", MessageTypeCallResult)),
		mustQuote(r.MessageID),
		payloadRaw,
	}
	return json.Marshal(frame)
}

// EncodeCallError builds the wire form of an error response:
// [4, msgId, errorCode, errorDescription, errorDetails].
func EncodeCallError(e CallError) ([]byte, error) {
	details := e.ErrorDetails
	if details == nil {
		details = map[string]interface{}{}
	}
	detailsRaw, err := json.Marshal(details)
	if err != nil {
		return nil, fmt.Errorf("error details marshal: %w", err)
	}
	frame := []json.RawMessage{
		json.RawMessage(fmt.Sprintf("%d", MessageTypeCallError)),
		mustQuote(e.MessageID),
		mustQuote(string(e.Code)),
		mustQuote(e.Description),
		detailsRaw,
	}
	return json.Marshal(frame)
}

func mustQuote(s string) json.RawMessage {
	b, _ := json.Marshal(s)
	return b
}

// formatTime formats a time per OCPP-J — ISO-8601 UTC with millisecond
// precision is the most widely-accepted form across charger vendors.
// Always use UTC even if the caller passes a local-zone time.
func formatTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
