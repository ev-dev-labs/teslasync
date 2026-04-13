package command

import "testing"

// ─── Happy Path ──────────────────────────────────────────

func TestCommand_CarAwake_SendsImmediately_Succeeds(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAwake()
	if m.State() != Sending {
		t.Fatalf("expected Sending, got %s", m.State())
	}
	m.MarkSucceeded()
	if m.State() != Succeeded {
		t.Fatalf("expected Succeeded, got %s", m.State())
	}
	if !m.IsTerminal() {
		t.Fatal("expected terminal")
	}
}

func TestCommand_CarAsleep_WakesThenSends(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAsleep()
	if m.State() != Waking {
		t.Fatalf("expected Waking, got %s", m.State())
	}
	m.MarkWakeConfirmed()
	if m.State() != WakeConfirmed {
		t.Fatalf("expected WakeConfirmed, got %s", m.State())
	}
	m.StartSending()
	if m.State() != Sending {
		t.Fatalf("expected Sending, got %s", m.State())
	}
	m.MarkSucceeded()
	if m.State() != Succeeded {
		t.Fatalf("expected Succeeded, got %s", m.State())
	}
}

// ─── Wake Failures ───────────────────────────────────────

func TestCommand_WakeTimeout_RetriesWake(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAsleep()
	m.MarkWakeTimeout()
	if m.State() != WakeTimeout {
		t.Fatalf("expected WakeTimeout, got %s", m.State())
	}
	m.RetryWake()
	if m.State() != Waking {
		t.Fatalf("expected Waking (retry), got %s", m.State())
	}
}

func TestCommand_WakeTimeout_MaxRetries_GivesUp(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAsleep()
	for i := 0; i <= MaxWakeRetries; i++ {
		m.MarkWakeTimeout()
		if m.State() != GaveUp {
			m.RetryWake()
		}
	}
	if m.State() != GaveUp {
		t.Fatalf("expected GaveUp after max wake retries, got %s", m.State())
	}
}

func TestCommand_WakeTimeout_ThenWakeSucceeds(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAsleep()
	m.MarkWakeTimeout()
	m.RetryWake()
	m.MarkWakeConfirmed()
	m.StartSending()
	m.MarkSucceeded()
	if m.State() != Succeeded {
		t.Fatalf("expected Succeeded, got %s", m.State())
	}
}

// ─── Command Failures ────────────────────────────────────

func TestCommand_RateLimit429_Retries(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAwake()
	m.MarkFailed(&CommandError{StatusCode: 429, Message: "rate limited", Category: "rate_limit"})
	ok := m.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry for rate limit")
	}
	if m.State() != Retrying {
		t.Fatalf("expected Retrying, got %s", m.State())
	}
}

func TestCommand_ServerError500_Retries(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAwake()
	m.MarkFailed(&CommandError{StatusCode: 500, Message: "server error", Category: "server"})
	ok := m.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry for 500")
	}
}

func TestCommand_AuthError401_NoRetry_GivesUp(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAwake()
	m.MarkFailed(&CommandError{StatusCode: 401, Message: "unauthorized", Category: "auth"})
	ok := m.ScheduleRetry()
	if ok {
		t.Fatal("should NOT retry auth errors")
	}
	if m.State() != GaveUp {
		t.Fatalf("expected GaveUp, got %s", m.State())
	}
}

func TestCommand_Timeout_Retries(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	m.MarkVehicleAwake()
	m.MarkTimedOut()
	if m.State() != TimedOut {
		t.Fatalf("expected TimedOut, got %s", m.State())
	}
	ok := m.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry for timeout")
	}
}

func TestCommand_MaxRetries_GivesUp(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	for i := 0; i <= MaxCmdRetries; i++ {
		m.MarkVehicleAwake()
		m.StartSending()
		m.MarkFailed(&CommandError{StatusCode: 500, Message: "error", Category: "network"})
		m.ScheduleRetry()
	}
	if m.State() != GaveUp {
		t.Fatalf("expected GaveUp after max retries, got %s", m.State())
	}
	if !m.IsTerminal() {
		t.Fatal("expected terminal")
	}
}

// ─── SSE Status Messages ────────────────────────────────

func TestCommand_StatusMessages(t *testing.T) {
	m := NewExecutionFSM(1, 1, "lock")
	if m.StatusMessage() != "Command queued..." {
		t.Fatalf("wrong message: %s", m.StatusMessage())
	}
	m.MarkVehicleAsleep()
	if m.StatusMessage() != "Waking vehicle..." {
		t.Fatalf("wrong message: %s", m.StatusMessage())
	}
	m.MarkWakeConfirmed()
	m.StartSending()
	if m.StatusMessage() != "Sending command..." {
		t.Fatalf("wrong message: %s", m.StatusMessage())
	}
	m.MarkSucceeded()
	if m.StatusMessage() != "✅ lock succeeded" {
		t.Fatalf("wrong message: %s", m.StatusMessage())
	}
}
