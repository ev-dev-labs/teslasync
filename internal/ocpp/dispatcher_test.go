package ocpp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestParseCall_HappyPath(t *testing.T) {
	raw := []byte(`[2,"msg-1","Heartbeat",{}]`)
	c, err := ParseCall(raw)
	if err != nil {
		t.Fatalf("ParseCall: %v", err)
	}
	if c.MessageID != "msg-1" || c.Action != "Heartbeat" {
		t.Errorf("parsed wrong: %+v", c)
	}
}

func TestParseCall_RejectsNonCall(t *testing.T) {
	raw := []byte(`[3,"msg-1",{}]`)
	if _, err := ParseCall(raw); err == nil {
		t.Fatal("expected error for CallResult envelope")
	}
}

func TestParseCall_RejectsTruncated(t *testing.T) {
	raw := []byte(`[2,"msg-1"]`)
	if _, err := ParseCall(raw); err == nil {
		t.Fatal("expected error for short envelope")
	}
}

func TestEncodeCallResult_EmptyPayloadBecomesObject(t *testing.T) {
	out, err := EncodeCallResult(CallResult{MessageID: "x"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.Contains(string(out), `{}`) {
		t.Errorf("want empty {} payload, got: %s", out)
	}
	if !strings.HasPrefix(string(out), "[3,") {
		t.Errorf("want CallResult prefix, got: %s", out)
	}
}

func TestEncodeCallError(t *testing.T) {
	out, err := EncodeCallError(CallError{MessageID: "x", Code: ErrNotImplemented, Description: "no"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.HasPrefix(string(out), "[4,") {
		t.Errorf("want CallError prefix, got: %s", out)
	}
	if !strings.Contains(string(out), `"NotImplemented"`) {
		t.Errorf("missing code: %s", out)
	}
}

func TestDispatcher_BootNotification(t *testing.T) {
	d := NewDispatcher(nil, 60*time.Second)
	fixedNow := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	d.SetClock(func() time.Time { return fixedNow })

	call := buildCall(t, "boot-1", "BootNotification", BootNotificationReq{
		ChargePointVendor: "Wallbox",
		ChargePointModel:  "Pulsar Plus",
	})
	out, err := d.Dispatch(context.Background(), "cp-1", call)
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !strings.Contains(string(out), `"Accepted"`) {
		t.Errorf("expected Accepted, got: %s", out)
	}
	if !strings.Contains(string(out), `"interval":60`) {
		t.Errorf("expected interval=60, got: %s", out)
	}
}

func TestDispatcher_BootNotification_RejectsMissingVendor(t *testing.T) {
	d := NewDispatcher(nil, 60*time.Second)
	call := buildCall(t, "boot-1", "BootNotification", BootNotificationReq{
		ChargePointModel: "X",
	})
	out, _ := d.Dispatch(context.Background(), "cp-1", call)
	if !strings.HasPrefix(string(out), "[4,") {
		t.Errorf("expected CallError, got: %s", out)
	}
}

func TestDispatcher_StartStopTransaction_FullLifecycle(t *testing.T) {
	store := NewMemorySessionStore()
	d := NewDispatcher(store, 60*time.Second)

	startCall := buildCall(t, "s-1", "StartTransaction", StartTransactionReq{
		ConnectorID: 1,
		IDTag:       "AABB1122",
		MeterStart:  1000,
		Timestamp:   "2026-01-02T03:04:05.000Z",
	})
	out, err := d.Dispatch(context.Background(), "cp-1", startCall)
	if err != nil {
		t.Fatalf("Dispatch start: %v", err)
	}
	// Pull the transaction id back out of the wire envelope.
	var frame []json.RawMessage
	if err := json.Unmarshal(out, &frame); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	var resPayload StartTransactionRes
	if err := json.Unmarshal(frame[2], &resPayload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if resPayload.TransactionID < 1 {
		t.Errorf("want transactionId >= 1, got %d", resPayload.TransactionID)
	}

	// Stop with a meter delta of 5000 Wh.
	stopCall := buildCall(t, "s-2", "StopTransaction", StopTransactionReq{
		TransactionID: resPayload.TransactionID,
		MeterStop:     6000,
		Timestamp:     "2026-01-02T04:04:05.000Z",
		Reason:        "Local",
	})
	if _, err := d.Dispatch(context.Background(), "cp-1", stopCall); err != nil {
		t.Fatalf("Dispatch stop: %v", err)
	}
	sessions, _, _ := store.Snapshot()
	if len(sessions) != 1 {
		t.Fatalf("want 1 session, got %d", len(sessions))
	}
	wh, ok := sessions[0].EnergyDeliveredWh()
	if !ok || wh != 5000 {
		t.Errorf("want 5000 Wh delivered, got %d ok=%v", wh, ok)
	}
}

func TestDispatcher_UnknownActionReturnsCallError(t *testing.T) {
	d := NewDispatcher(nil, 0)
	call := buildCall(t, "x", "RemoteStartTransaction", map[string]string{})
	out, err := d.Dispatch(context.Background(), "cp-1", call)
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !strings.Contains(string(out), `"NotImplemented"`) {
		t.Errorf("want NotImplemented, got: %s", out)
	}
}

func TestDispatcher_Heartbeat_ReturnsCurrentTime(t *testing.T) {
	d := NewDispatcher(nil, 0)
	fixed := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	d.SetClock(func() time.Time { return fixed })
	out, err := d.Dispatch(context.Background(), "cp-1", buildCall(t, "h-1", "Heartbeat", map[string]string{}))
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !strings.Contains(string(out), "2026-06-15T12:00:00.000Z") {
		t.Errorf("want fixed time in response, got: %s", out)
	}
}

func TestParseISOTime(t *testing.T) {
	cases := []struct {
		in  string
		ok  bool
		utc string
	}{
		{"", true, ""},
		{"2026-01-02T03:04:05.000Z", true, "2026-01-02T03:04:05Z"},
		{"2026-01-02T03:04:05Z", true, "2026-01-02T03:04:05Z"},
		{"2026-01-02T03:04:05+00:00", true, "2026-01-02T03:04:05Z"},
		{"not-a-timestamp", false, ""},
	}
	for _, c := range cases {
		got, err := ParseISOTime(c.in)
		if c.ok && err != nil {
			t.Errorf("ParseISOTime(%q) unexpected error: %v", c.in, err)
		}
		if !c.ok && err == nil {
			t.Errorf("ParseISOTime(%q) want error, got %v", c.in, got)
		}
		if c.ok && c.utc != "" && got.Format(time.RFC3339) != c.utc {
			t.Errorf("ParseISOTime(%q) = %q, want %q", c.in, got.Format(time.RFC3339), c.utc)
		}
	}
}

func buildCall(t *testing.T, msgID, action string, payload interface{}) []byte {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	frame := []json.RawMessage{
		json.RawMessage("2"),
		mustQuote(msgID),
		mustQuote(action),
		body,
	}
	out, err := json.Marshal(frame)
	if err != nil {
		t.Fatalf("marshal frame: %v", err)
	}
	return out
}
