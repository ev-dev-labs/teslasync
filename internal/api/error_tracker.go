package api

import (
	"net/http"
	"sync"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// ErrorTracker provides in-memory error aggregation and recent error tracking.
// It is safe for concurrent use.
type ErrorTracker struct {
	mu           sync.RWMutex
	codeCounts   map[string]*ErrorCount
	catCounts    map[string]*ErrorCount
	statusCounts map[int]*ErrorCount
	recentErrors []TrackedError
	maxRecent    int
	writeIdx     int
	totalErrors  int64
	startTime    time.Time
}

// ErrorCount tracks occurrences and last-seen time for an error bucket.
type ErrorCount struct {
	Count    int64     `json:"count"`
	LastSeen time.Time `json:"last_seen"`
	LastMsg  string    `json:"last_message"`
}

// TrackedError represents a single recorded error occurrence.
type TrackedError struct {
	Code      string    `json:"code"`
	Category  string    `json:"category"`
	Message   string    `json:"message"`
	Path      string    `json:"path"`
	Method    string    `json:"method"`
	RequestID string    `json:"request_id"`
	Status    int       `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

// ErrorStats is the JSON response for the error stats endpoint.
type ErrorStats struct {
	TotalErrors  int64                  `json:"total_errors"`
	Uptime       string                 `json:"uptime"`
	ByCode       map[string]*ErrorCount `json:"by_code"`
	ByCategory   map[string]*ErrorCount `json:"by_category"`
	ByStatus     map[int]*ErrorCount    `json:"by_status"`
	RecentErrors []TrackedError         `json:"recent_errors"`
}

// NewErrorTracker creates a tracker that keeps the last maxRecent errors.
func NewErrorTracker(maxRecent int) *ErrorTracker {
	if maxRecent <= 0 {
		maxRecent = 100
	}
	return &ErrorTracker{
		codeCounts:   make(map[string]*ErrorCount),
		catCounts:    make(map[string]*ErrorCount),
		statusCounts: make(map[int]*ErrorCount),
		recentErrors: make([]TrackedError, maxRecent),
		maxRecent:    maxRecent,
		startTime:    time.Now(),
	}
}

// Track records an error occurrence.
func (t *ErrorTracker) Track(code, category, message, path, method, requestID string, status int) {
	now := time.Now()

	t.mu.Lock()
	defer t.mu.Unlock()

	t.totalErrors++
	if _, ok := t.codeCounts[code]; !ok {
		t.codeCounts[code] = &ErrorCount{}
	}
	t.codeCounts[code].Count++
	t.codeCounts[code].LastSeen = now
	t.codeCounts[code].LastMsg = message
	if _, ok := t.catCounts[category]; !ok {
		t.catCounts[category] = &ErrorCount{}
	}
	t.catCounts[category].Count++
	t.catCounts[category].LastSeen = now
	t.catCounts[category].LastMsg = message
	if _, ok := t.statusCounts[status]; !ok {
		t.statusCounts[status] = &ErrorCount{}
	}
	t.statusCounts[status].Count++
	t.statusCounts[status].LastSeen = now
	t.statusCounts[status].LastMsg = message
	t.recentErrors[t.writeIdx] = TrackedError{
		Code:      code,
		Category:  category,
		Message:   message,
		Path:      path,
		Method:    method,
		RequestID: requestID,
		Status:    status,
		Timestamp: now,
	}
	t.writeIdx = (t.writeIdx + 1) % t.maxRecent
}

// Stats returns a snapshot of current error statistics.
func (t *ErrorTracker) Stats() ErrorStats {
	t.mu.RLock()
	defer t.mu.RUnlock()
	byCode := make(map[string]*ErrorCount, len(t.codeCounts))
	for k, v := range t.codeCounts {
		cp := *v
		byCode[k] = &cp
	}
	byCat := make(map[string]*ErrorCount, len(t.catCounts))
	for k, v := range t.catCounts {
		cp := *v
		byCat[k] = &cp
	}
	byStatus := make(map[int]*ErrorCount, len(t.statusCounts))
	for k, v := range t.statusCounts {
		cp := *v
		byStatus[k] = &cp
	}
	var recent []TrackedError
	n := int(t.totalErrors)
	if n > t.maxRecent {
		n = t.maxRecent
	}
	for i := 0; i < n; i++ {
		idx := (t.writeIdx - 1 - i + t.maxRecent) % t.maxRecent
		if !t.recentErrors[idx].Timestamp.IsZero() {
			recent = append(recent, t.recentErrors[idx])
		}
	}

	return ErrorStats{
		TotalErrors:  t.totalErrors,
		Uptime:       time.Since(t.startTime).Truncate(time.Second).String(),
		ByCode:       byCode,
		ByCategory:   byCat,
		ByStatus:     byStatus,
		RecentErrors: recent,
	}
}

// ErrorStatsHandler returns an HTTP handler that serves error statistics.
func ErrorStatsHandler(tracker *ErrorTracker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, tracker.Stats())
	}
}

// ErrorCatalogHandler returns an HTTP handler that lists all defined error codes.
func ErrorCatalogHandler() http.HandlerFunc {
	type catalogEntry struct {
		Code     string `json:"code"`
		Message  string `json:"default_message"`
		Status   int    `json:"http_status"`
		Category string `json:"category"`
	}

	catalog := ErrorCatalog()
	entries := make([]catalogEntry, len(catalog))
	for i, e := range catalog {
		entries[i] = catalogEntry{
			Code:     e.Code,
			Message:  e.Message,
			Status:   e.Status,
			Category: e.Category,
		}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total":  len(entries),
			"errors": entries,
		})
	}
}

// ErrorTrackingMiddleware intercepts error responses and records them in the tracker.
// It captures the response status after the handler runs and, for 4xx/5xx responses,
// records the error using the status code mapping from httpStatusCode.
func ErrorTrackingMiddleware(tracker *ErrorTracker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status >= 400 {
				code := httpStatusCode(status)
				category := statusToCategory(status)
				reqID := chimw.GetReqID(r.Context())
				tracker.Track(code, category, http.StatusText(status), r.URL.Path, r.Method, reqID, status)
			}
		})
	}
}

// statusToCategory maps HTTP status ranges to error categories.
func statusToCategory(status int) string {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return ErrCatAuth
	case status == http.StatusTooManyRequests:
		return ErrCatRateLimit
	case status == http.StatusBadRequest, status == http.StatusUnprocessableEntity:
		return ErrCatValidation
	case status == http.StatusNotFound:
		return ErrCatInternal // could be any domain — generic bucket
	case status == http.StatusBadGateway, status == http.StatusGatewayTimeout:
		return ErrCatTeslaAPI
	case status >= 500:
		return ErrCatInternal
	default:
		return ErrCatInternal
	}
}
