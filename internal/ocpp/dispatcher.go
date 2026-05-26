package ocpp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
)

// Session is the in-memory representation of an active OCPP charging
// transaction. It mirrors the relevant fields of a Tesla charging
// session but is intentionally NOT stored in the same table — the
// Tesla schema is tied to VIN, the OCPP charger has no concept of a
// vehicle identity beyond the RFID tag.
//
// Callers that want durable persistence inject a SessionStore — the
// default in-memory implementation is sufficient for the foundation
// PR; a Postgres-backed store can be wired into cmd/ocpp-server in a
// follow-up without changing the protocol layer.
type Session struct {
	TransactionID int
	ChargePointID string
	ConnectorID   int
	IDTag         string
	StartedAt     time.Time
	StartMeterWh  int
	EndedAt       *time.Time
	EndMeterWh    *int
	StopReason    string
}

// EnergyDeliveredWh returns the kWh delivered if the session has
// ended, or 0 + false if still in progress.
func (s Session) EnergyDeliveredWh() (int, bool) {
	if s.EndMeterWh == nil {
		return 0, false
	}
	delta := *s.EndMeterWh - s.StartMeterWh
	if delta < 0 {
		// Defensive: a meter overflow or manual reset would produce
		// a negative delta. Don't surface a confusing negative kWh —
		// callers can detect "unknown" via the bool.
		return 0, false
	}
	return delta, true
}

// SessionStore is the persistence port the CSMS uses to record
// transactions + meter samples. Implementations MUST be goroutine-
// safe — the server may dispatch concurrent calls for the same
// charge point.
type SessionStore interface {
	StartSession(ctx context.Context, s Session) error
	StopSession(ctx context.Context, transactionID int, endedAt time.Time, endMeterWh int, reason string) error
	RecordMeterValues(ctx context.Context, transactionID int, mv MeterValuesReq) error
	RecordStatus(ctx context.Context, chargePointID string, st StatusNotificationReq) error
	RecordBoot(ctx context.Context, chargePointID string, b BootNotificationReq) error
}

// MemorySessionStore is the default zero-config store used by tests
// and bootstrap deployments. It's intentionally simple — no
// pagination, no expiry, no concurrent-eviction policy.
type MemorySessionStore struct {
	mu       sync.RWMutex
	sessions map[int]*Session
	statuses map[string]map[int]StatusNotificationReq // [chargePointID][connectorID]
	boots    map[string]BootNotificationReq
}

func NewMemorySessionStore() *MemorySessionStore {
	return &MemorySessionStore{
		sessions: map[int]*Session{},
		statuses: map[string]map[int]StatusNotificationReq{},
		boots:    map[string]BootNotificationReq{},
	}
}

func (m *MemorySessionStore) StartSession(_ context.Context, s Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *(&s)
	m.sessions[s.TransactionID] = &cp
	return nil
}

func (m *MemorySessionStore) StopSession(_ context.Context, txID int, endedAt time.Time, endMeterWh int, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[txID]
	if !ok {
		return fmt.Errorf("unknown transaction %d", txID)
	}
	s.EndedAt = &endedAt
	s.EndMeterWh = &endMeterWh
	s.StopReason = reason
	return nil
}

func (m *MemorySessionStore) RecordMeterValues(_ context.Context, txID int, _ MeterValuesReq) error {
	m.mu.RLock()
	_, ok := m.sessions[txID]
	m.mu.RUnlock()
	if !ok {
		// A MeterValues without an open transaction is a charger bug
		// per OCPP spec — log + drop rather than fail the response.
		log.Warn().Int("transaction_id", txID).Msg("MeterValues for unknown transaction")
	}
	return nil
}

func (m *MemorySessionStore) RecordStatus(_ context.Context, cpID string, st StatusNotificationReq) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.statuses[cpID] == nil {
		m.statuses[cpID] = map[int]StatusNotificationReq{}
	}
	m.statuses[cpID][st.ConnectorID] = st
	return nil
}

func (m *MemorySessionStore) RecordBoot(_ context.Context, cpID string, b BootNotificationReq) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.boots[cpID] = b
	return nil
}

// Snapshot returns the current in-memory state for tests + debugging.
func (m *MemorySessionStore) Snapshot() (sessions []Session, statuses map[string]map[int]StatusNotificationReq, boots map[string]BootNotificationReq) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sessions = make([]Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, *s)
	}
	// Defensive copy so callers don't mutate internal maps.
	statuses = make(map[string]map[int]StatusNotificationReq, len(m.statuses))
	for k, inner := range m.statuses {
		out := make(map[int]StatusNotificationReq, len(inner))
		for ck, cv := range inner {
			out[ck] = cv
		}
		statuses[k] = out
	}
	boots = make(map[string]BootNotificationReq, len(m.boots))
	for k, v := range m.boots {
		boots[k] = v
	}
	return sessions, statuses, boots
}

// Dispatcher routes parsed Call frames to the right handler, manages
// the monotonically-increasing transaction id, and produces the
// response bytes. It is the single object cmd/ocpp-server wraps with
// a WebSocket transport — keeping the protocol layer transport-free
// makes it trivially testable.
type Dispatcher struct {
	store SessionStore
	// nextTxID is incremented atomically per StartTransaction. The
	// OCPP spec requires transactionId > 0; we start at 1.
	nextTxID int64
	// heartbeatInterval is returned in BootNotification responses;
	// configurable so operators can tune charger network chatter.
	heartbeatInterval time.Duration
	// now is injectable so tests can pin time.
	now func() time.Time
}

// NewDispatcher constructs a CSMS dispatcher with the given session
// store and heartbeat interval. If store is nil a memory store is
// used; if heartbeat <= 0, 300s is used (OCPP spec default).
func NewDispatcher(store SessionStore, heartbeat time.Duration) *Dispatcher {
	if store == nil {
		store = NewMemorySessionStore()
	}
	if heartbeat <= 0 {
		heartbeat = 300 * time.Second
	}
	return &Dispatcher{
		store:             store,
		heartbeatInterval: heartbeat,
		now:               time.Now,
	}
}

// Dispatch processes one inbound Call from chargePointID and returns
// the wire bytes that should be sent back. The caller (WebSocket
// transport) only needs to write the returned []byte; this method
// hides all OCPP envelope construction.
//
// Errors from Dispatch represent transport-level problems (malformed
// frame). Protocol-level rejections are returned as a CallError frame
// inside the []byte — the caller still writes them as a normal
// outbound message.
func (d *Dispatcher) Dispatch(ctx context.Context, chargePointID string, raw []byte) ([]byte, error) {
	call, err := ParseCall(raw)
	if err != nil {
		// We can't echo a message id back if envelope parsing failed
		// — OCPP spec says to drop. Surface as a transport error so
		// the WebSocket layer can decide whether to close.
		return nil, fmt.Errorf("parse call: %w", err)
	}
	res, errPayload := d.handle(ctx, chargePointID, *call)
	if errPayload != nil {
		errPayload.MessageID = call.MessageID
		return EncodeCallError(*errPayload)
	}
	res.MessageID = call.MessageID
	return EncodeCallResult(res)
}

// handle is the action dispatch table. Adding a new OCPP message =
// one new case + one new typed handler.
func (d *Dispatcher) handle(ctx context.Context, cpID string, c Call) (CallResult, *CallError) {
	switch c.Action {
	case "BootNotification":
		return d.handleBoot(ctx, cpID, c)
	case "Heartbeat":
		return d.handleHeartbeat()
	case "StatusNotification":
		return d.handleStatus(ctx, cpID, c)
	case "MeterValues":
		return d.handleMeterValues(ctx, c)
	case "StartTransaction":
		return d.handleStart(ctx, cpID, c)
	case "StopTransaction":
		return d.handleStop(ctx, c)
	case "Authorize":
		// Optional — we accept every tag for the foundation PR. A
		// real deployment would consult an allow-list here.
		return CallResult{Payload: map[string]interface{}{
			"idTagInfo": IDTagInfo{Status: "Accepted"},
		}}, nil
	default:
		return CallResult{}, &CallError{
			Code:        ErrNotImplemented,
			Description: "Action not supported: " + c.Action,
		}
	}
}

func (d *Dispatcher) handleBoot(ctx context.Context, cpID string, c Call) (CallResult, *CallError) {
	req, err := DecodePayload[BootNotificationReq](c.Payload)
	if err != nil {
		return CallResult{}, &CallError{Code: ErrPropertyConstraint, Description: err.Error()}
	}
	if req.ChargePointVendor == "" || req.ChargePointModel == "" {
		return CallResult{}, &CallError{Code: ErrOccurrenceConstraint, Description: "chargePointVendor + chargePointModel required"}
	}
	if err := d.store.RecordBoot(ctx, cpID, req); err != nil {
		log.Warn().Err(err).Str("charge_point", cpID).Msg("RecordBoot failed; accepting boot anyway")
	}
	return CallResult{Payload: BootNotificationRes{
		CurrentTime: formatTime(d.now()),
		Interval:    int(d.heartbeatInterval.Seconds()),
		Status:      "Accepted",
	}}, nil
}

func (d *Dispatcher) handleHeartbeat() (CallResult, *CallError) {
	return CallResult{Payload: HeartbeatRes{CurrentTime: formatTime(d.now())}}, nil
}

func (d *Dispatcher) handleStatus(ctx context.Context, cpID string, c Call) (CallResult, *CallError) {
	req, err := DecodePayload[StatusNotificationReq](c.Payload)
	if err != nil {
		return CallResult{}, &CallError{Code: ErrPropertyConstraint, Description: err.Error()}
	}
	if err := d.store.RecordStatus(ctx, cpID, req); err != nil {
		log.Warn().Err(err).Str("charge_point", cpID).Msg("RecordStatus failed")
	}
	return CallResult{Payload: map[string]interface{}{}}, nil
}

func (d *Dispatcher) handleMeterValues(ctx context.Context, c Call) (CallResult, *CallError) {
	req, err := DecodePayload[MeterValuesReq](c.Payload)
	if err != nil {
		return CallResult{}, &CallError{Code: ErrPropertyConstraint, Description: err.Error()}
	}
	if req.TransactionID != nil {
		if err := d.store.RecordMeterValues(ctx, *req.TransactionID, req); err != nil {
			log.Warn().Err(err).Int("transaction_id", *req.TransactionID).Msg("RecordMeterValues failed")
		}
	}
	return CallResult{Payload: map[string]interface{}{}}, nil
}

func (d *Dispatcher) handleStart(ctx context.Context, cpID string, c Call) (CallResult, *CallError) {
	req, err := DecodePayload[StartTransactionReq](c.Payload)
	if err != nil {
		return CallResult{}, &CallError{Code: ErrPropertyConstraint, Description: err.Error()}
	}
	startedAt, parseErr := ParseISOTime(req.Timestamp)
	if parseErr != nil || startedAt.IsZero() {
		startedAt = d.now()
	}
	txID := int(atomic.AddInt64(&d.nextTxID, 1))
	if err := d.store.StartSession(ctx, Session{
		TransactionID: txID,
		ChargePointID: cpID,
		ConnectorID:   req.ConnectorID,
		IDTag:         req.IDTag,
		StartedAt:     startedAt,
		StartMeterWh:  req.MeterStart,
	}); err != nil {
		return CallResult{}, &CallError{Code: ErrInternalError, Description: err.Error()}
	}
	return CallResult{Payload: StartTransactionRes{
		TransactionID: txID,
		IDTagInfo:     IDTagInfo{Status: "Accepted"},
	}}, nil
}

func (d *Dispatcher) handleStop(ctx context.Context, c Call) (CallResult, *CallError) {
	req, err := DecodePayload[StopTransactionReq](c.Payload)
	if err != nil {
		return CallResult{}, &CallError{Code: ErrPropertyConstraint, Description: err.Error()}
	}
	endedAt, parseErr := ParseISOTime(req.Timestamp)
	if parseErr != nil || endedAt.IsZero() {
		endedAt = d.now()
	}
	reason := req.Reason
	if reason == "" {
		reason = "Local"
	}
	if err := d.store.StopSession(ctx, req.TransactionID, endedAt, req.MeterStop, reason); err != nil {
		return CallResult{}, &CallError{Code: ErrInternalError, Description: err.Error()}
	}
	// idTagInfo is optional per spec — omit when no auth-list applies.
	return CallResult{Payload: StopTransactionRes{}}, nil
}

// SetClock replaces the dispatcher's clock — tests only.
func (d *Dispatcher) SetClock(fn func() time.Time) {
	if fn == nil {
		return
	}
	d.now = fn
}

// Ensure compile-time we haven't accidentally dropped the json import.
var _ = json.Marshal
var _ = errors.New
