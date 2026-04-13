package notification

import (
	"testing"
	"time"
)

// ─── Cooldown FSM Tests ─────────────────────────────────

func TestCooldown_Armed_ConditionMet_Fires(t *testing.T) {
	c := NewCooldownFSM(1, 1, DefaultCooldownConfig())
	if !c.ShouldFire() {
		t.Fatal("expected fire from Armed state")
	}
	if c.State() != Fired {
		t.Fatalf("expected Fired, got %s", c.State())
	}
}

func TestCooldown_Fired_WithinCooldown_Suppressed(t *testing.T) {
	c := NewCooldownFSM(1, 1, CooldownConfig{CooldownDuration: 15 * time.Minute, MaxFiresPerHour: 10})
	c.ShouldFire() // fire
	if c.ShouldFire() {
		t.Fatal("expected suppression within cooldown")
	}
	if c.State() != Suppressed {
		t.Fatalf("expected Suppressed, got %s", c.State())
	}
}

func TestCooldown_MaxFiresPerHour_Suppressed(t *testing.T) {
	c := NewCooldownFSM(1, 1, CooldownConfig{CooldownDuration: 0, MaxFiresPerHour: 2})
	c.ShouldFire() // 1
	c.ShouldFire() // 2
	if c.ShouldFire() {
		t.Fatal("expected suppression at max fires per hour")
	}
}

func TestCooldown_CooldownExpires_ReArmed(t *testing.T) {
	c := NewCooldownFSM(1, 1, CooldownConfig{CooldownDuration: 1 * time.Millisecond, MaxFiresPerHour: 100})
	c.ShouldFire()
	time.Sleep(5 * time.Millisecond)
	if !c.ShouldFire() {
		t.Fatal("expected fire after cooldown expired")
	}
}

func TestCooldown_Stats(t *testing.T) {
	c := NewCooldownFSM(1, 1, CooldownConfig{CooldownDuration: time.Hour, MaxFiresPerHour: 10})
	c.ShouldFire() // fire
	c.ShouldFire() // suppressed
	c.ShouldFire() // suppressed
	fires, suppressed, _ := c.Stats()
	if fires != 1 {
		t.Fatalf("expected 1 fire, got %d", fires)
	}
	if suppressed != 2 {
		t.Fatalf("expected 2 suppressed, got %d", suppressed)
	}
}

// ─── Delivery FSM Tests ─────────────────────────────────

func TestDelivery_Created_StartSending(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push", "email"})
	if d.State() != Created {
		t.Fatalf("expected Created, got %s", d.State())
	}
	d.StartSending()
	if d.State() != Sending {
		t.Fatalf("expected Sending, got %s", d.State())
	}
}

func TestDelivery_AllChannelsOK_Delivered(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push", "email"})
	d.StartSending()
	d.MarkChannelResult("push", true, "")
	d.MarkChannelResult("email", true, "")
	if d.State() != Delivered {
		t.Fatalf("expected Delivered, got %s", d.State())
	}
}

func TestDelivery_PushOK_EmailFailed_Partial(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push", "email"})
	d.StartSending()
	d.MarkChannelResult("push", true, "")
	d.MarkChannelResult("email", false, "SMTP timeout")
	if d.State() != Partial {
		t.Fatalf("expected Partial, got %s", d.State())
	}
}

func TestDelivery_AllFailed_Failed(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push", "email"})
	d.StartSending()
	d.MarkChannelResult("push", false, "connection refused")
	d.MarkChannelResult("email", false, "SMTP timeout")
	if d.State() != Failed {
		t.Fatalf("expected Failed, got %s", d.State())
	}
}

func TestDelivery_Failed_RetryWithBackoff(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push"})
	d.StartSending()
	d.MarkChannelResult("push", false, "error")
	ok := d.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry to be scheduled")
	}
	if d.State() != Retrying {
		t.Fatalf("expected Retrying, got %s", d.State())
	}
	if d.RetryCount() != 1 {
		t.Fatalf("expected retry count 1, got %d", d.RetryCount())
	}
}

func TestDelivery_Failed_MaxRetries_Dead(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push"})
	for i := 0; i <= MaxRetries; i++ {
		d.StartSending()
		d.MarkChannelResult("push", false, "error")
		d.ScheduleRetry()
	}
	if d.State() != Dead {
		t.Fatalf("expected Dead after max retries, got %s", d.State())
	}
}

func TestDelivery_SingleChannel_Delivered(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"webhook"})
	d.StartSending()
	d.MarkChannelResult("webhook", true, "")
	if d.State() != Delivered {
		t.Fatalf("expected Delivered, got %s", d.State())
	}
	if !d.IsTerminal() {
		t.Fatal("expected terminal state")
	}
}

func TestDelivery_RetryResetsFailedChannels(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push", "email"})
	d.StartSending()
	d.MarkChannelResult("push", true, "")
	d.MarkChannelResult("email", false, "error")
	d.ScheduleRetry()
	// Failed channels should be reset to pending
	channels := d.Channels()
	for _, ch := range channels {
		if ch.Type == "email" && ch.Status != "pending" {
			t.Fatalf("expected email reset to pending, got %s", ch.Status)
		}
		if ch.Type == "push" && ch.Status != "delivered" {
			t.Fatalf("expected push to stay delivered, got %s", ch.Status)
		}
	}
}

func TestDelivery_IsReadyForRetry(t *testing.T) {
	d := NewDeliveryFSM(1, []string{"push"})
	d.StartSending()
	d.MarkChannelResult("push", false, "error")
	d.ScheduleRetry()
	// backoff is 2s for first retry — should not be ready immediately
	if d.IsReadyForRetry() {
		t.Fatal("should not be ready immediately (2s backoff)")
	}
}
