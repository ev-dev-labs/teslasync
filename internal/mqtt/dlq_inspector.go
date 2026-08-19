// Package mqtt provides a DLQ inspector and replay backend.
//
// The PipelineSubscriber publishes any message that fails codec decode
// (wraps codec.ErrPayloadDrop) to {dlqTopic}/{vehicleID} as a JSON
// envelope (see DLQEntry in mqtt.go) containing reason + original topic +
// original payload + the legacy redelivery count (zero for immediate
// quarantine). Until this file, those messages were
// opaque to operators — no UI surfaced what was dropped or replayed it
// after a codec fix.
//
// This file adds a *separate* MQTT subscriber that:
//
//   1. Subscribes to {dlqTopic}/# with its own clientID so it does NOT
//      interfere with the PipelineSubscriber's manual-ack contract.
//
//   2. JSON-parses each delivery as a DLQEntry envelope so the inspector
//      can surface reason / vehicle / VIN / original topic to operators.
//      Malformed bodies are still surfaced (with parseError set + the raw
//      bytes preserved) so a publisher-side regression doesn't silently
//      vanish from the UI.
//
//   3. Keeps the last N (default 200) entries in a thread-safe ring
//      buffer. Older entries are dropped silently — matches Tesla's
//      "if you missed it, you missed it" telemetry contract. Replay
//      actions ARE persisted via dlq_replay_audit so a post-incident
//      forensic trail survives ring rotation.
//
//   4. Exposes Snapshot + Get + Replay so the HTTP handler can list,
//      fetch payloads, and re-publish to the *original* source topic
//      (read from the parsed envelope, NOT derived from the DLQ topic
//      structure — robust against changes to the per-vehicle suffix
//      convention).
//
// What this file does NOT do:
//
//   - It does NOT acknowledge messages back to the broker. The DLQ
//     publisher uses QoS 1 fire-and-forget; the inspector subscribes
//     at QoS 0 so we never apply back-pressure to the publisher.
//
//   - It does NOT persist payloads to PostgreSQL outside of replay
//     audits. Ring-only matches the lossy-telemetry contract.
//
//   - It does NOT re-route to other topics. Replay always targets the
//     envelope's original SourceTopic so the same PipelineSubscriber
//     pulls it again (now that the codec fix is in place).

package mqtt

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"
)

// DefaultDLQRingCapacity caps the in-memory ring buffer. 200 × ~4 KB
// average payload = ~800 KB RAM — negligible. Capacity can be overridden
// in DLQInspectorConfig for high-volume environments.
const DefaultDLQRingCapacity = 200

// ErrDLQReplayDisabled is returned by Replay when the inspector was
// constructed with replayEnabled=false. The HTTP handler translates this
// to a 403 with a structured code so the frontend can surface a
// "replay is disabled in this environment" message.
var ErrDLQReplayDisabled = errors.New("mqtt: dlq replay is disabled by configuration")

// ErrDLQEntryNotFound is returned by Get/Replay when the supplied id is
// not (or no longer) in the ring. The HTTP handler translates this to a
// 404. Expected after the ring wraps.
var ErrDLQEntryNotFound = errors.New("mqtt: dlq entry not found")

// ErrDLQEntryUnparseable is returned by Replay when the entry could not
// be JSON-decoded at ingestion time and therefore has no SourceTopic +
// no original payload to replay. The HTTP handler translates this to a
// 409 — replay is not possible, but the entry still appears in the list.
var ErrDLQEntryUnparseable = errors.New("mqtt: dlq entry cannot be replayed (envelope was unparseable at ingest)")

// DLQInspectorEntry is one captured dead-letter, decoded from the JSON
// envelope written by MQTTDLQPublisher. All fields are read-only after
// construction; the ring buffer hands out value copies so concurrent
// callers cannot mutate the canonical record.
type DLQInspectorEntry struct {
	// ID is a random 128-bit hex string assigned at ingest. Stable for
	// the lifetime of this entry in the ring. The audit row's `dlq_id`
	// column references this id.
	ID string
	// ArrivedAt is the broker-observed receive time at the inspector.
	// Not the original telemetry timestamp.
	ArrivedAt time.Time
	// DLQTopic is the topic the message arrived on
	// (e.g. "telemetry/dlq/123" or "telemetry/dlq/unknown").
	DLQTopic string
	// RawPayload is the raw broker payload — typically a JSON-encoded
	// DLQEntry envelope. Preserved verbatim so a publisher-side
	// regression that breaks the envelope shape is still surfaced.
	RawPayload []byte
	// ParsedReason / ParsedVehicleID / ParsedVIN / ParsedSourceTopic /
	// ParsedRedeliveries / ParsedTimestamp / ParsedInnerPayload come from
	// decoding RawPayload as DLQEntry JSON. ParseError is non-nil when
	// the decode failed — in that case the other Parsed* fields are zero
	// and Replay returns ErrDLQEntryUnparseable.
	ParsedReason       string
	ParsedVehicleID    int64
	ParsedVIN          string
	ParsedSourceTopic  string
	ParsedRedeliveries int
	ParsedTimestamp    time.Time
	ParsedInnerPayload []byte
	ParseError         string
}

// Replayable reports whether the entry has enough metadata to be
// re-published. Returns false when the envelope failed to parse OR when
// the original topic is empty.
func (e DLQInspectorEntry) Replayable() bool {
	return e.ParseError == "" && strings.TrimSpace(e.ParsedSourceTopic) != ""
}

// DLQInspector owns the ring buffer + subscription. Methods are
// concurrency-safe under a single sync.Mutex — the workload is
// read-mostly + low-frequency-write so RWMutex would not change
// observed latency.
type DLQInspector struct {
	client         pahomqtt.Client
	dlqTopic       string
	replayEnabled  bool
	replayQoS      byte
	replayRetained bool
	logger         zerolog.Logger

	mu        sync.Mutex
	ring      []DLQInspectorEntry
	nextIndex int
	wrapped   bool
}

// DLQInspectorConfig groups the optional knobs. Zero values are the
// production defaults.
type DLQInspectorConfig struct {
	Capacity       int  // ring buffer capacity; 0 → DefaultDLQRingCapacity
	ReplayEnabled  bool // false → Replay returns ErrDLQReplayDisabled
	ReplayQoS      byte // QoS for re-published messages; default 0
	ReplayRetained bool // retain flag; default false
}

// NewDLQInspector constructs an inspector backed by client. dlqTopic is
// the broker-facing root the PipelineSubscriber publishes failures to
// (typically "{topicBase}/dlq"). NewDLQInspector does NOT subscribe; the
// caller must invoke Start() — keeping Start separate so wiring code can
// install the inspector before the broker connection is fully ready.
func NewDLQInspector(client pahomqtt.Client, dlqTopic string, cfg DLQInspectorConfig, logger zerolog.Logger) (*DLQInspector, error) {
	if client == nil {
		return nil, errors.New("mqtt: NewDLQInspector: client must be non-nil")
	}
	if strings.TrimSpace(dlqTopic) == "" {
		return nil, errors.New("mqtt: NewDLQInspector: dlqTopic must be non-empty")
	}
	cap := cfg.Capacity
	if cap <= 0 {
		cap = DefaultDLQRingCapacity
	}
	return &DLQInspector{
		client:         client,
		dlqTopic:       strings.TrimRight(dlqTopic, "/"),
		replayEnabled:  cfg.ReplayEnabled,
		replayQoS:      cfg.ReplayQoS,
		replayRetained: cfg.ReplayRetained,
		logger:         logger,
		ring:           make([]DLQInspectorEntry, cap),
	}, nil
}

// Start subscribes to {dlqTopic}/# with QoS 0 so the inspector receives
// every dead-letter without imposing back-pressure on the broker. Safe
// to call once; subsequent calls re-subscribe (idempotent on the broker).
func (i *DLQInspector) Start() error {
	if i == nil || i.client == nil {
		return errors.New("mqtt: DLQInspector.Start: nil inspector or client")
	}
	wildcard := i.dlqTopic + "/#"
	token := i.client.Subscribe(wildcard, 0, i.handleMessage)
	token.Wait()
	if err := token.Error(); err != nil {
		return fmt.Errorf("mqtt: DLQInspector.Start: subscribe %q: %w", wildcard, err)
	}
	i.logger.Info().
		Str("topic", wildcard).
		Int("ring_capacity", len(i.ring)).
		Bool("replay_enabled", i.replayEnabled).
		Msg("dlq inspector subscribed")
	return nil
}

// Stop unsubscribes the inspector. Safe to call multiple times.
func (i *DLQInspector) Stop() {
	if i == nil || i.client == nil {
		return
	}
	wildcard := i.dlqTopic + "/#"
	token := i.client.Unsubscribe(wildcard)
	token.Wait()
	if err := token.Error(); err != nil {
		i.logger.Warn().Err(err).Str("topic", wildcard).Msg("dlq inspector unsubscribe failed")
	}
}

// handleMessage is the paho callback invoked for every DLQ message.
// MUST NOT block — paho dispatches all handlers on a single goroutine
// by default. JSON decode + ring append are both O(1) per message.
func (i *DLQInspector) handleMessage(_ pahomqtt.Client, msg pahomqtt.Message) {
	raw := append([]byte(nil), msg.Payload()...) // copy: paho reuses the slice
	entry := DLQInspectorEntry{
		ID:         newDLQEntryID(),
		ArrivedAt:  time.Now().UTC(),
		DLQTopic:   msg.Topic(),
		RawPayload: raw,
	}
	var env DLQEntry
	if err := json.Unmarshal(raw, &env); err != nil {
		entry.ParseError = err.Error()
	} else {
		entry.ParsedReason = env.Reason
		entry.ParsedVehicleID = env.VehicleID
		entry.ParsedVIN = env.VIN
		entry.ParsedSourceTopic = env.Topic
		entry.ParsedRedeliveries = env.Redeliveries
		entry.ParsedTimestamp = env.Timestamp
		if len(env.Payload) > 0 {
			entry.ParsedInnerPayload = append([]byte(nil), env.Payload...)
		}
	}
	i.appendRing(entry)
}

func (i *DLQInspector) appendRing(e DLQInspectorEntry) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.ring[i.nextIndex] = e
	i.nextIndex++
	if i.nextIndex >= len(i.ring) {
		i.nextIndex = 0
		i.wrapped = true
	}
}

// Snapshot returns a copy of every currently-live entry, sorted newest
// first. Returns an empty slice (not nil) when the ring is empty so
// callers can iterate without nil-checks.
func (i *DLQInspector) Snapshot() []DLQInspectorEntry {
	i.mu.Lock()
	defer i.mu.Unlock()
	live := i.liveLocked()
	out := make([]DLQInspectorEntry, 0, len(live))
	out = append(out, live...)
	// reverse to newest-first
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

// Get fetches a single entry by id. Returns ErrDLQEntryNotFound when the
// id is not (or no longer) in the ring.
func (i *DLQInspector) Get(id string) (DLQInspectorEntry, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	for _, e := range i.liveLocked() {
		if e.ID == id {
			return e, nil
		}
	}
	return DLQInspectorEntry{}, ErrDLQEntryNotFound
}

// Replay re-publishes the entry's parsed inner payload to its parsed
// source topic via the underlying paho client. Returns:
//   - ErrDLQReplayDisabled when the inspector was constructed with
//     ReplayEnabled=false
//   - ErrDLQEntryNotFound when id has rotated out of the ring
//   - ErrDLQEntryUnparseable when the entry's envelope failed to parse
//     at ingest (no source topic + no inner payload to replay)
//
// Returns the replayed entry on success so the HTTP handler can persist
// an audit row capturing exactly what was replayed.
func (i *DLQInspector) Replay(ctx context.Context, id string) (DLQInspectorEntry, error) {
	if !i.replayEnabled {
		return DLQInspectorEntry{}, ErrDLQReplayDisabled
	}
	entry, err := i.Get(id)
	if err != nil {
		return DLQInspectorEntry{}, err
	}
	if !entry.Replayable() {
		return entry, ErrDLQEntryUnparseable
	}
	target := entry.ParsedSourceTopic
	body := entry.ParsedInnerPayload
	if len(body) == 0 {
		// Envelope parsed but had an empty Payload field. Replaying with
		// an empty body would corrupt the pipeline silently — fail loudly.
		return entry, ErrDLQEntryUnparseable
	}
	token := i.client.Publish(target, i.replayQoS, i.replayRetained, body)
	select {
	case <-ctx.Done():
		return entry, ctx.Err()
	case <-tokenDone(token):
	}
	if err := token.Error(); err != nil {
		return entry, fmt.Errorf("mqtt: DLQInspector.Replay: publish %q: %w", target, err)
	}
	i.logger.Info().
		Str("id", id).
		Str("source_topic", target).
		Int("payload_bytes", len(body)).
		Int64("vehicle_id", entry.ParsedVehicleID).
		Msg("dlq replay published")
	return entry, nil
}

// liveLocked returns the in-order slice of live entries (oldest first).
// Caller MUST hold i.mu.
func (i *DLQInspector) liveLocked() []DLQInspectorEntry {
	cap := len(i.ring)
	if !i.wrapped {
		return i.ring[:i.nextIndex]
	}
	// Wrapped: oldest is at nextIndex, newest at nextIndex-1.
	out := make([]DLQInspectorEntry, 0, cap)
	out = append(out, i.ring[i.nextIndex:]...)
	out = append(out, i.ring[:i.nextIndex]...)
	return out
}

// newDLQEntryID returns a 32-char hex id (128 bits of entropy).
func newDLQEntryID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// tokenDone bridges paho's blocking Wait() into a channel for select.
// paho v1.5 has no native Done() channel; this is the standard idiom.
func tokenDone(t pahomqtt.Token) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		t.Wait()
		close(done)
	}()
	return done
}
