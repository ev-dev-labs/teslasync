package chatbot

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
	"time"
)

// The chatbot package is a DTO leaf (ADR-006): no behaviour, just the wire +
// persistence contract. These tests pin that contract so it cannot regress
// silently:
//   - JSON keys are the exact snake_case names the React frontend consumes
//     (web/src/api/types.ts: ChatMessage, ChatSessionInfo).
//   - No field is dropped by omitempty — the frontend types are non-optional
//     (`string | null`), so nil pointers MUST serialise as explicit `null`.
//   - ChatSessionInfo.ID is intentionally asymmetric: json:"id" (frontend) but
//     db:"session_id" (matches the chatbot_messages column).
//   - Values survive a marshal→unmarshal round-trip losslessly, including
//     int64 IDs beyond JS's safe-integer range and nil/non-nil pointers.

// jsonMap marshals v and reparses it into a raw key→value map so tests can
// assert on the exact wire shape (keys present, null-ness) without coupling to
// field ordering.
func jsonMap(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal into map: %v (payload=%s)", err, b)
	}
	return m
}

func sortedKeys(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func ptr[T any](v T) *T { return &v }

var (
	chatMessageKeys     = []string{"content", "created_at", "id", "role", "session_id"}
	chatSessionInfoKeys = []string{"created_at", "first_message", "id", "last_message_at", "message_count", "title"}
)

// ---------------------------------------------------------------------------
// JSON key contract — the frontend depends on these exact snake_case keys.
// ---------------------------------------------------------------------------

func TestChatMessage_JSONKeys(t *testing.T) {
	now := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		msg  ChatMessage
	}{
		{"zero value", ChatMessage{}},
		{"user message", ChatMessage{ID: 1, SessionID: "s_1", Role: "user", Content: "hi", CreatedAt: now}},
		{"assistant message", ChatMessage{ID: 2, SessionID: "s_1", Role: "assistant", Content: "hello", CreatedAt: now}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sortedKeys(jsonMap(t, tt.msg))
			if !reflect.DeepEqual(got, chatMessageKeys) {
				t.Fatalf("JSON keys = %v, want %v (frontend ChatMessage contract)", got, chatMessageKeys)
			}
		})
	}
}

func TestChatSessionInfo_JSONKeys(t *testing.T) {
	now := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		info ChatSessionInfo
	}{
		{"zero value (all pointers nil)", ChatSessionInfo{}},
		{
			"fully populated",
			ChatSessionInfo{
				ID:            "s_1",
				Title:         ptr("Road trip"),
				FirstMessage:  ptr("how far did I drive?"),
				MessageCount:  4,
				LastMessageAt: ptr(now),
				CreatedAt:     ptr(now.Add(-time.Hour)),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sortedKeys(jsonMap(t, tt.info))
			if !reflect.DeepEqual(got, chatSessionInfoKeys) {
				t.Fatalf("JSON keys = %v, want %v (frontend ChatSessionInfo contract)", got, chatSessionInfoKeys)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Nullable semantics — no omitempty, so nil pointers must be explicit null and
// present, because the frontend types are `T | null` (not `T | undefined`).
// ---------------------------------------------------------------------------

func TestChatSessionInfo_NilPointersSerializeAsNull(t *testing.T) {
	m := jsonMap(t, ChatSessionInfo{ID: "s_1", MessageCount: 0})
	nullable := []string{"title", "first_message", "last_message_at", "created_at"}
	for _, key := range nullable {
		raw, ok := m[key]
		if !ok {
			t.Fatalf("key %q missing; frontend expects it present as null (no omitempty)", key)
		}
		if string(raw) != "null" {
			t.Errorf("key %q = %s, want null when the Go pointer is nil", key, raw)
		}
	}
	// Non-pointer fields are still present with zero values.
	if got := string(m["message_count"]); got != "0" {
		t.Errorf("message_count = %s, want 0", got)
	}
	if got := string(m["id"]); got != `"s_1"` {
		t.Errorf("id = %s, want \"s_1\"", got)
	}
}

func TestChatSessionInfo_SetPointersSerializeAsValues(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	m := jsonMap(t, ChatSessionInfo{
		ID:            "s_2",
		Title:         ptr("My Session"),
		FirstMessage:  ptr("first"),
		MessageCount:  7,
		LastMessageAt: ptr(ts),
		CreatedAt:     ptr(ts),
	})
	cases := map[string]string{
		"title":           `"My Session"`,
		"first_message":   `"first"`,
		"message_count":   "7",
		"last_message_at": `"2026-01-02T03:04:05Z"`,
		"created_at":      `"2026-01-02T03:04:05Z"`,
	}
	for key, want := range cases {
		if got := string(m[key]); got != want {
			t.Errorf("key %q = %s, want %s", key, got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// Round-trip fidelity — marshal then unmarshal must preserve every field.
// ---------------------------------------------------------------------------

func chatMessageEqual(a, b ChatMessage) bool {
	return a.ID == b.ID &&
		a.SessionID == b.SessionID &&
		a.Role == b.Role &&
		a.Content == b.Content &&
		a.CreatedAt.Equal(b.CreatedAt)
}

func TestChatMessage_RoundTrip(t *testing.T) {
	now := time.Date(2026, 7, 5, 20, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		msg  ChatMessage
	}{
		{"zero value", ChatMessage{}},
		{"typical user", ChatMessage{ID: 10, SessionID: "s_abc", Role: "user", Content: "How many drives this week?", CreatedAt: now}},
		{"typical assistant", ChatMessage{ID: 11, SessionID: "s_abc", Role: "assistant", Content: "You completed **3 drives**.", CreatedAt: now}},
		{"empty content", ChatMessage{ID: 12, SessionID: "s_abc", Role: "user", Content: "", CreatedAt: now}},
		{"unicode content", ChatMessage{ID: 13, SessionID: "s_x", Role: "assistant", Content: "🔋 battery: 80% — naïve façade", CreatedAt: now}},
		{"int64 beyond JS safe range", ChatMessage{ID: 9007199254740993, SessionID: "s_big", Role: "user", Content: "x", CreatedAt: now}},
		{"zero time", ChatMessage{ID: 14, SessionID: "s_x", Role: "user", Content: "x", CreatedAt: time.Time{}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ChatMessage
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !chatMessageEqual(got, tt.msg) {
				t.Fatalf("round-trip mismatch:\n got  %+v\n want %+v\n json %s", got, tt.msg, b)
			}
		})
	}
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func strPtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func TestChatSessionInfo_RoundTrip(t *testing.T) {
	ts := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	tests := []struct {
		name string
		info ChatSessionInfo
	}{
		{"all pointers nil", ChatSessionInfo{ID: "s_1", MessageCount: 0}},
		{
			"all populated",
			ChatSessionInfo{
				ID:            "s_2",
				Title:         ptr("Renamed"),
				FirstMessage:  ptr("first user message"),
				MessageCount:  42,
				LastMessageAt: ptr(ts),
				CreatedAt:     ptr(ts.Add(-24 * time.Hour)),
			},
		},
		{
			"title nil, others set (unrenamed session)",
			ChatSessionInfo{
				ID:            "s_3",
				Title:         nil,
				FirstMessage:  ptr("what is my top speed?"),
				MessageCount:  2,
				LastMessageAt: ptr(ts),
				CreatedAt:     ptr(ts),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.info)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ChatSessionInfo
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got.ID != tt.info.ID {
				t.Errorf("ID = %q, want %q", got.ID, tt.info.ID)
			}
			if got.MessageCount != tt.info.MessageCount {
				t.Errorf("MessageCount = %d, want %d", got.MessageCount, tt.info.MessageCount)
			}
			if !strPtrEqual(got.Title, tt.info.Title) {
				t.Errorf("Title = %v, want %v", got.Title, tt.info.Title)
			}
			if !strPtrEqual(got.FirstMessage, tt.info.FirstMessage) {
				t.Errorf("FirstMessage = %v, want %v", got.FirstMessage, tt.info.FirstMessage)
			}
			if !timePtrEqual(got.LastMessageAt, tt.info.LastMessageAt) {
				t.Errorf("LastMessageAt = %v, want %v", got.LastMessageAt, tt.info.LastMessageAt)
			}
			if !timePtrEqual(got.CreatedAt, tt.info.CreatedAt) {
				t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, tt.info.CreatedAt)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Inbound decode — payloads shaped exactly like the frontend TS interfaces
// (including JSON null for the nullable fields) must decode correctly.
// ---------------------------------------------------------------------------

func TestChatMessage_UnmarshalWireShape(t *testing.T) {
	const payload = `{"id":99,"session_id":"s_wire","role":"assistant","content":"hi there","created_at":"2026-07-05T20:00:22Z"}`
	var m ChatMessage
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m.ID != 99 || m.SessionID != "s_wire" || m.Role != "assistant" || m.Content != "hi there" {
		t.Fatalf("decoded scalar fields wrong: %+v", m)
	}
	want := time.Date(2026, 7, 5, 20, 0, 22, 0, time.UTC)
	if !m.CreatedAt.Equal(want) {
		t.Errorf("CreatedAt = %v, want %v", m.CreatedAt, want)
	}
}

func TestChatSessionInfo_UnmarshalWithNulls(t *testing.T) {
	// Matches an unrenamed session with no user message yet: title, first_message,
	// last_message_at and created_at all null on the wire.
	const payload = `{"id":"s_null","title":null,"first_message":null,"message_count":0,"last_message_at":null,"created_at":null}`
	var info ChatSessionInfo
	if err := json.Unmarshal([]byte(payload), &info); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if info.ID != "s_null" {
		t.Errorf("ID = %q, want s_null", info.ID)
	}
	if info.Title != nil {
		t.Errorf("Title = %v, want nil for JSON null", info.Title)
	}
	if info.FirstMessage != nil {
		t.Errorf("FirstMessage = %v, want nil for JSON null", info.FirstMessage)
	}
	if info.LastMessageAt != nil {
		t.Errorf("LastMessageAt = %v, want nil for JSON null", info.LastMessageAt)
	}
	if info.CreatedAt != nil {
		t.Errorf("CreatedAt = %v, want nil for JSON null", info.CreatedAt)
	}
	if info.MessageCount != 0 {
		t.Errorf("MessageCount = %d, want 0", info.MessageCount)
	}
}

func TestChatSessionInfo_UnmarshalWithValues(t *testing.T) {
	const payload = `{"id":"s_full","title":"Trip","first_message":"how far?","message_count":3,"last_message_at":"2026-07-05T20:00:22Z","created_at":"2026-07-04T10:00:00Z"}`
	var info ChatSessionInfo
	if err := json.Unmarshal([]byte(payload), &info); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if info.Title == nil || *info.Title != "Trip" {
		t.Errorf("Title = %v, want \"Trip\"", info.Title)
	}
	if info.FirstMessage == nil || *info.FirstMessage != "how far?" {
		t.Errorf("FirstMessage = %v, want \"how far?\"", info.FirstMessage)
	}
	if info.MessageCount != 3 {
		t.Errorf("MessageCount = %d, want 3", info.MessageCount)
	}
	if info.LastMessageAt == nil || !info.LastMessageAt.Equal(time.Date(2026, 7, 5, 20, 0, 22, 0, time.UTC)) {
		t.Errorf("LastMessageAt = %v, want 2026-07-05T20:00:22Z", info.LastMessageAt)
	}
	if info.CreatedAt == nil || !info.CreatedAt.Equal(time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("CreatedAt = %v, want 2026-07-04T10:00:00Z", info.CreatedAt)
	}
}

// ---------------------------------------------------------------------------
// Struct-tag contract — reflection pin for both the JSON (frontend) and db
// (repo scan convention) tags, including the deliberate ID asymmetry.
// ---------------------------------------------------------------------------

func TestStructTags(t *testing.T) {
	type want struct{ jsonTag, dbTag string }
	tests := []struct {
		name  string
		typ   reflect.Type
		byFld map[string]want
	}{
		{
			name: "ChatMessage",
			typ:  reflect.TypeOf(ChatMessage{}),
			byFld: map[string]want{
				"ID":        {"id", "id"},
				"SessionID": {"session_id", "session_id"},
				"Role":      {"role", "role"},
				"Content":   {"content", "content"},
				"CreatedAt": {"created_at", "created_at"},
			},
		},
		{
			name: "ChatSessionInfo",
			typ:  reflect.TypeOf(ChatSessionInfo{}),
			byFld: map[string]want{
				// ID is asymmetric on purpose: emitted as "id" for the frontend,
				// scanned from the "session_id" column in the repo.
				"ID":            {"id", "session_id"},
				"Title":         {"title", "title"},
				"FirstMessage":  {"first_message", "first_message"},
				"MessageCount":  {"message_count", "message_count"},
				"LastMessageAt": {"last_message_at", "last_message_at"},
				"CreatedAt":     {"created_at", "created_at"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.typ.NumField() != len(tt.byFld) {
				t.Fatalf("%s has %d fields, contract lists %d — update the test if the DTO changed",
					tt.name, tt.typ.NumField(), len(tt.byFld))
			}
			for i := 0; i < tt.typ.NumField(); i++ {
				f := tt.typ.Field(i)
				w, ok := tt.byFld[f.Name]
				if !ok {
					t.Errorf("unexpected field %q on %s", f.Name, tt.name)
					continue
				}
				if got := f.Tag.Get("json"); got != w.jsonTag {
					t.Errorf("%s.%s json tag = %q, want %q", tt.name, f.Name, got, w.jsonTag)
				}
				if got := f.Tag.Get("db"); got != w.dbTag {
					t.Errorf("%s.%s db tag = %q, want %q", tt.name, f.Name, got, w.dbTag)
				}
			}
		})
	}
}

// TestChatSessionInfo_IDTagAsymmetry documents, as an executable pin, why the
// ID field carries json:"id" but db:"session_id": the frontend keys off `id`
// while the repo query selects/scans the `session_id` column. "Fixing" either
// tag to match the other silently breaks one side.
func TestChatSessionInfo_IDTagAsymmetry(t *testing.T) {
	f, ok := reflect.TypeOf(ChatSessionInfo{}).FieldByName("ID")
	if !ok {
		t.Fatal("ChatSessionInfo.ID field not found")
	}
	if got := f.Tag.Get("json"); got != "id" {
		t.Errorf("json tag = %q, want id (frontend ChatSessionInfo.id)", got)
	}
	if got := f.Tag.Get("db"); got != "session_id" {
		t.Errorf("db tag = %q, want session_id (repo scans the session_id column)", got)
	}

	// And the serialised object really does key off "id", not "session_id".
	m := jsonMap(t, ChatSessionInfo{ID: "s_1"})
	if _, ok := m["id"]; !ok {
		t.Error("serialised ChatSessionInfo missing \"id\" key")
	}
	if _, ok := m["session_id"]; ok {
		t.Error("serialised ChatSessionInfo must NOT emit \"session_id\" (that is the db column, not the wire key)")
	}
}
