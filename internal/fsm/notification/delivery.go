package notification

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// DeliveryState represents the notification delivery lifecycle.
type DeliveryState string

const (
	Created   DeliveryState = "created"
	Sending   DeliveryState = "sending"
	Delivered DeliveryState = "delivered"
	Partial   DeliveryState = "partial" // some channels succeeded, some failed
	Failed    DeliveryState = "failed"
	Retrying  DeliveryState = "retrying"
	Dead      DeliveryState = "dead" // max retries exhausted
)

// ChannelStatus tracks delivery status for a single channel.
type ChannelStatus struct {
	Type   string    `json:"type"`   // "push", "email", "webhook"
	Status string    `json:"status"` // "pending", "sent", "delivered", "failed"
	SentAt time.Time `json:"sent_at,omitempty"`
	Error  string    `json:"error,omitempty"`
}

const MaxRetries = 3

// DeliveryFSM manages the delivery lifecycle of a single notification.
type DeliveryFSM struct {
	mu          sync.Mutex
	state       DeliveryState
	channels    []ChannelStatus
	retryCount  int
	backoffBase time.Duration
	nextRetryAt time.Time
	createdAt   time.Time
	deliveredAt *time.Time
	logger      zerolog.Logger
}

// NewDeliveryFSM creates a delivery FSM in Created state.
func NewDeliveryFSM(notifID int64, channelTypes []string) *DeliveryFSM {
	channels := make([]ChannelStatus, len(channelTypes))
	for i, ct := range channelTypes {
		channels[i] = ChannelStatus{Type: ct, Status: "pending"}
	}
	return &DeliveryFSM{
		state:       Created,
		channels:    channels,
		backoffBase: 2 * time.Second,
		createdAt:   time.Now().UTC(),
		logger:      log.With().Str("component", "delivery_fsm").Int64("notification_id", notifID).Logger(),
	}
}

// State returns the current delivery state.
func (d *DeliveryFSM) State() DeliveryState {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.state
}

// Channels returns a copy of channel statuses.
func (d *DeliveryFSM) Channels() []ChannelStatus {
	d.mu.Lock()
	defer d.mu.Unlock()
	result := make([]ChannelStatus, len(d.channels))
	copy(result, d.channels)
	return result
}

// StartSending transitions from Created to Sending.
func (d *DeliveryFSM) StartSending() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.state == Created || d.state == Retrying {
		d.transition(Sending)
	}
}

// MarkChannelResult records the delivery result for a specific channel.
func (d *DeliveryFSM) MarkChannelResult(channelType string, success bool, errMsg string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	for i := range d.channels {
		if d.channels[i].Type == channelType {
			d.channels[i].SentAt = time.Now().UTC()
			if success {
				d.channels[i].Status = "delivered"
			} else {
				d.channels[i].Status = "failed"
				d.channels[i].Error = errMsg
			}
			break
		}
	}

	// Check if all channels are done
	allDone := true
	anySuccess := false
	anyFailed := false
	for _, ch := range d.channels {
		if ch.Status == "pending" {
			allDone = false
		}
		if ch.Status == "delivered" {
			anySuccess = true
		}
		if ch.Status == "failed" {
			anyFailed = true
		}
	}

	if !allDone {
		return
	}

	if anySuccess && !anyFailed {
		now := time.Now().UTC()
		d.deliveredAt = &now
		d.transition(Delivered)
	} else if anySuccess && anyFailed {
		d.transition(Partial)
	} else {
		d.transition(Failed)
	}
}

// ScheduleRetry moves to Retrying with exponential backoff, or Dead if max retries reached.
func (d *DeliveryFSM) ScheduleRetry() bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.state != Failed && d.state != Partial {
		return false
	}

	d.retryCount++
	if d.retryCount > MaxRetries {
		d.transition(Dead)
		return false
	}

	// Exponential backoff: 2s, 4s, 8s
	backoff := d.backoffBase * (1 << (d.retryCount - 1))
	d.nextRetryAt = time.Now().UTC().Add(backoff)

	// Reset failed channels to pending for retry
	for i := range d.channels {
		if d.channels[i].Status == "failed" {
			d.channels[i].Status = "pending"
			d.channels[i].Error = ""
		}
	}

	d.transition(Retrying)
	d.logger.Info().
		Int("retry", d.retryCount).
		Dur("backoff", backoff).
		Msg("scheduling retry")
	return true
}

// IsReadyForRetry returns true if backoff has expired.
func (d *DeliveryFSM) IsReadyForRetry() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.state == Retrying && time.Now().UTC().After(d.nextRetryAt)
}

// IsTerminal returns true if the notification reached a final state.
func (d *DeliveryFSM) IsTerminal() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.state == Delivered || d.state == Dead
}

// RetryCount returns the number of retries attempted.
func (d *DeliveryFSM) RetryCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.retryCount
}

func (d *DeliveryFSM) transition(to DeliveryState) {
	from := d.state
	d.state = to
	d.logger.Info().Str("from", string(from)).Str("to", string(to)).Msg("delivery transition")
}
