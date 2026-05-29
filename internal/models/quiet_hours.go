package models

import "time"

// QuietHoursWindow mirrors a per-user Do-Not-Disturb window in the
// notification_quiet_hours table.
// Multiple windows per user are allowed; the dispatcher considers any
// enabled window when deciding whether to defer a notification.
//
// Time fields:
//   - StartLocal / EndLocal are wall-clock times (no date) interpreted in
//     the configured Timezone.
//   - When EndLocal <= StartLocal the window wraps past midnight: it covers
//     [StartLocal..24:00) ∪ [00:00..EndLocal) for any matching weekday.
//
// Severity bypass:
//   - BypassSeverities lists severities that ALWAYS deliver, regardless
//     of this window. Defaults to {"critical"} server-side. Compared
//     case-insensitively to the dispatcher's request severity.
type QuietHoursWindow struct {
	ID               int64     `json:"id"                db:"id"`
	UserID           string    `json:"user_id"           db:"user_id"`
	Enabled          bool      `json:"enabled"           db:"enabled"`
	StartLocal       string    `json:"start_local"       db:"start_local"`       // "HH:MM"
	EndLocal         string    `json:"end_local"         db:"end_local"`         // "HH:MM"
	Timezone         string    `json:"timezone"          db:"timezone"`          // IANA name
	Weekdays         int       `json:"weekdays"          db:"weekdays"`          // bitmask Sun=1..Sat=64
	BypassSeverities []string  `json:"bypass_severities" db:"bypass_severities"` // wire severities
	CreatedAt        time.Time `json:"created_at"        db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"        db:"updated_at"`
}

// Quiet-hours weekday bitmask constants. Matches Go's time.Weekday so the
// dispatcher can compute (1 << weekday) directly without remapping.
const (
	QuietHoursWeekdaySun = 1 << 0
	QuietHoursWeekdayMon = 1 << 1
	QuietHoursWeekdayTue = 1 << 2
	QuietHoursWeekdayWed = 1 << 3
	QuietHoursWeekdayThu = 1 << 4
	QuietHoursWeekdayFri = 1 << 5
	QuietHoursWeekdaySat = 1 << 6
	QuietHoursWeekdayAll = QuietHoursWeekdaySun | QuietHoursWeekdayMon | QuietHoursWeekdayTue | QuietHoursWeekdayWed | QuietHoursWeekdayThu | QuietHoursWeekdayFri | QuietHoursWeekdaySat
)
