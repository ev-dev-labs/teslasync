package notification

import (
	"context"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Phase-46 / Prompt 19 — quiet-hours / Do-Not-Disturb decision logic.
//
// The dispatcher (Worker.processNotification) consults a QuietHoursDecider
// before delivering each notification. When a window is active for the
// notification's severity, the row is logged with status=deferred_dnd
// and delivery is skipped. The replay loop in cmd/notification-worker
// picks up deferred rows once their causing window ends and dispatches
// them through the same MQTT pipeline.

// StatusDeferredDND is the notification_logs.status value the
// dispatcher writes when a Do-Not-Disturb window suppressed delivery.
// Kept here (not in models/) so the dispatcher has a single source of
// truth and the frontend's deferred-badge code-path matches.
const StatusDeferredDND = "deferred_dnd"

// QuietHoursDecider abstracts the lookup the dispatcher performs against
// notification_quiet_hours rows. Implemented by *QuietHoursRepoDecider
// in production and trivially mockable in tests.
type QuietHoursDecider interface {
	// ShouldDefer returns true when delivery of a request with the
	// supplied severity should be suppressed at `now`. The matched
	// window is returned so callers can log diagnostic context (which
	// window fired, when the window ends).
	ShouldDefer(ctx context.Context, severity string, now time.Time) (bool, *models.QuietHoursWindow, error)
}

// QuietHoursLister is the narrow read surface the decider needs. The
// production implementation is *database.QuietHoursRepo (its
// ListEnabled method).
type QuietHoursLister interface {
	ListEnabled(ctx context.Context) ([]*models.QuietHoursWindow, error)
}

// NewRepoDecider wraps a QuietHoursLister in the QuietHoursDecider
// contract. The lister is called on every dispatch — callers that
// expect heavy traffic should layer a small TTL cache in front.
func NewRepoDecider(repo QuietHoursLister) QuietHoursDecider {
	if repo == nil {
		return nil
	}
	return &repoDecider{repo: repo}
}

type repoDecider struct {
	repo QuietHoursLister
}

func (d *repoDecider) ShouldDefer(ctx context.Context, severity string, now time.Time) (bool, *models.QuietHoursWindow, error) {
	windows, err := d.repo.ListEnabled(ctx)
	if err != nil {
		return false, nil, err
	}
	w, ok := MatchActiveWindow(windows, severity, now)
	return ok, w, nil
}

// MatchActiveWindow returns the first enabled window that is active at
// `now` AND does not list `severity` in its bypass set. Pure function
// so dispatcher behaviour is fully covered by table-driven tests
// without spinning up the database. Returns (nil, false) when no window
// matches, i.e. delivery should proceed.
func MatchActiveWindow(windows []*models.QuietHoursWindow, severity string, now time.Time) (*models.QuietHoursWindow, bool) {
	severity = strings.ToLower(strings.TrimSpace(severity))
	if severity == "" {
		severity = "info"
	}
	for _, w := range windows {
		if w == nil || !w.Enabled {
			continue
		}
		if isSeverityBypassed(severity, w.BypassSeverities) {
			continue
		}
		if IsWindowActiveAt(w, now) {
			return w, true
		}
	}
	return nil, false
}

// IsWindowActiveAt reports whether the supplied window covers `now`,
// taking the configured timezone, weekday bitmask, and cross-midnight
// wrap into account. Returns false on any parse error so a misconfigured
// window never blocks delivery silently.
func IsWindowActiveAt(w *models.QuietHoursWindow, now time.Time) bool {
	if w == nil || !w.Enabled {
		return false
	}
	loc, err := time.LoadLocation(w.Timezone)
	if err != nil {
		return false
	}
	local := now.In(loc)
	startMin, ok := minutesOfDay(w.StartLocal)
	if !ok {
		return false
	}
	endMin, ok := minutesOfDay(w.EndLocal)
	if !ok {
		return false
	}
	if startMin == endMin {
		return false
	}
	nowMin := local.Hour()*60 + local.Minute()
	if startMin < endMin {
		// Same-day window. Active iff start <= now < end on a matching weekday.
		if nowMin < startMin || nowMin >= endMin {
			return false
		}
		return weekdayMatches(w.Weekdays, local.Weekday())
	}
	// Cross-midnight wrap: covers [start..24:00) ∪ [00:00..end).
	// The "anchor" weekday is the one the window started on:
	//   * In the [start..24:00) leg the anchor is today.
	//   * In the [00:00..end) leg the anchor is yesterday.
	if nowMin >= startMin {
		return weekdayMatches(w.Weekdays, local.Weekday())
	}
	if nowMin < endMin {
		yesterday := local.AddDate(0, 0, -1).Weekday()
		return weekdayMatches(w.Weekdays, yesterday)
	}
	return false
}

// NextWindowEndAt computes the soonest moment the window stops being
// active after `now`. Returns the zero time when the window is not
// currently active; callers that need a "next start" should call this
// after MatchActiveWindow returns true.
func NextWindowEndAt(w *models.QuietHoursWindow, now time.Time) time.Time {
	if w == nil {
		return time.Time{}
	}
	loc, err := time.LoadLocation(w.Timezone)
	if err != nil {
		return time.Time{}
	}
	local := now.In(loc)
	startMin, ok := minutesOfDay(w.StartLocal)
	if !ok {
		return time.Time{}
	}
	endMin, ok := minutesOfDay(w.EndLocal)
	if !ok {
		return time.Time{}
	}
	if startMin == endMin {
		return time.Time{}
	}
	nowMin := local.Hour()*60 + local.Minute()
	if startMin < endMin {
		if nowMin < startMin || nowMin >= endMin {
			return time.Time{}
		}
		return time.Date(local.Year(), local.Month(), local.Day(), endMin/60, endMin%60, 0, 0, loc)
	}
	// Cross-midnight: end is on the *next* calendar day relative to the
	// start anchor. If we're past start we end tomorrow, if we're before
	// end we end today.
	if nowMin >= startMin {
		next := local.AddDate(0, 0, 1)
		return time.Date(next.Year(), next.Month(), next.Day(), endMin/60, endMin%60, 0, 0, loc)
	}
	if nowMin < endMin {
		return time.Date(local.Year(), local.Month(), local.Day(), endMin/60, endMin%60, 0, 0, loc)
	}
	return time.Time{}
}

func isSeverityBypassed(severity string, bypass []string) bool {
	for _, b := range bypass {
		if strings.ToLower(strings.TrimSpace(b)) == severity {
			return true
		}
	}
	return false
}

func weekdayMatches(mask int, w time.Weekday) bool {
	if mask <= 0 {
		return false
	}
	return mask&(1<<uint(w)) != 0
}

func minutesOfDay(s string) (int, bool) {
	if len(s) < 5 || s[2] != ':' {
		return 0, false
	}
	if s[0] < '0' || s[0] > '9' || s[1] < '0' || s[1] > '9' ||
		s[3] < '0' || s[3] > '9' || s[4] < '0' || s[4] > '9' {
		return 0, false
	}
	h := (int(s[0]-'0') * 10) + int(s[1]-'0')
	m := (int(s[3]-'0') * 10) + int(s[4]-'0')
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}
