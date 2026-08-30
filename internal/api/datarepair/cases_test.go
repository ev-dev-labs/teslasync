package datarepair

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type caseTransitionCall struct {
	id       int64
	status   systemmodel.RepairCaseStatus
	note     *string
	expected time.Time
}

type caseAssignCall struct {
	id       int64
	assignee *string
}

type fakeCaseRepository struct {
	cases          map[int64]*systemmodel.RepairCase
	listResult     []systemmodel.RepairCase
	listFn         func(systemmodel.RepairCaseListFilter) ([]systemmodel.RepairCase, error)
	stats          *systemmodel.RepairCaseStats
	comments       map[int64][]systemmodel.RepairCaseComment
	quarantine     map[int64]*systemmodel.RepairQuarantine
	quarantineList []systemmodel.RepairQuarantine

	getErr              error
	upsertErr           error
	listErr             error
	statsErr            error
	commentsErr         error
	quarantineErr       error
	createQuarantineErr error
	markQuarantineErr   error
	transitionErr       error
	assignErr           error
	commentErr          error

	getCalls              int
	upsertCalls           int
	listCalls             []systemmodel.RepairCaseListFilter
	statsCalls            int
	commentListCalls      int
	quarantineCalls       int
	quarantineListCalls   []systemmodel.RepairQuarantineListFilter
	createQuarantineCalls int
	markQuarantineCalls   int
	transitionCalls       []caseTransitionCall
	assignCalls           []caseAssignCall
	addCommentCalls       int
	nextCommentID         int64
	nextCaseID            int64
	nextQuarantineID      int64
}

func newFakeCaseRepository(cases ...*systemmodel.RepairCase) *fakeCaseRepository {
	repo := &fakeCaseRepository{
		cases:            make(map[int64]*systemmodel.RepairCase, len(cases)),
		comments:         make(map[int64][]systemmodel.RepairCaseComment),
		quarantine:       make(map[int64]*systemmodel.RepairQuarantine),
		nextCommentID:    100,
		nextCaseID:       1000,
		nextQuarantineID: 2000,
	}
	for _, repairCase := range cases {
		repo.cases[repairCase.ID] = cloneCase(repairCase)
	}
	return repo
}

func (f *fakeCaseRepository) UpsertCase(
	_ context.Context,
	_ database.DBTX,
	candidate *systemmodel.RepairCase,
) (int64, error) {
	f.upsertCalls++
	if f.upsertErr != nil {
		return 0, f.upsertErr
	}
	for id, existing := range f.cases {
		if existing.Fingerprint == candidate.Fingerprint &&
			(existing.Status == systemmodel.RepairCaseStatusOpen ||
				existing.Status == systemmodel.RepairCaseStatusInReview ||
				existing.Status == systemmodel.RepairCaseStatusDismissed) {
			updated := cloneCase(candidate)
			updated.ID = id
			updated.Status = existing.Status
			updated.CreatedAt = existing.CreatedAt
			updated.UpdatedAt = testNow
			f.cases[id] = updated
			return id, nil
		}
	}
	f.nextCaseID++
	created := cloneCase(candidate)
	created.ID = f.nextCaseID
	created.CreatedAt = testNow
	created.UpdatedAt = testNow
	created.FirstSeenAt = testNow
	created.LastSeenAt = testNow
	f.cases[created.ID] = created
	return created.ID, nil
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func cloneCase(repairCase *systemmodel.RepairCase) *systemmodel.RepairCase {
	if repairCase == nil {
		return nil
	}
	out := *repairCase
	out.AssignedTo = cloneString(repairCase.AssignedTo)
	out.ResolutionNote = cloneString(repairCase.ResolutionNote)
	return &out
}

func cloneCaseMap(source map[int64]*systemmodel.RepairCase) map[int64]*systemmodel.RepairCase {
	out := make(map[int64]*systemmodel.RepairCase, len(source))
	for id, repairCase := range source {
		out[id] = cloneCase(repairCase)
	}
	return out
}

func cloneCommentMap(source map[int64][]systemmodel.RepairCaseComment) map[int64][]systemmodel.RepairCaseComment {
	out := make(map[int64][]systemmodel.RepairCaseComment, len(source))
	for id, comments := range source {
		out[id] = append([]systemmodel.RepairCaseComment(nil), comments...)
	}
	return out
}

func cloneQuarantineMap(
	source map[int64]*systemmodel.RepairQuarantine,
) map[int64]*systemmodel.RepairQuarantine {
	out := make(map[int64]*systemmodel.RepairQuarantine, len(source))
	for caseID, record := range source {
		if record == nil {
			out[caseID] = nil
			continue
		}
		copyRecord := *record
		copyRecord.OriginalRow = append(json.RawMessage(nil), record.OriginalRow...)
		copyRecord.RestoredBy = cloneString(record.RestoredBy)
		if record.RestoredAt != nil {
			value := *record.RestoredAt
			copyRecord.RestoredAt = &value
		}
		out[caseID] = &copyRecord
	}
	return out
}

func (f *fakeCaseRepository) ListCases(
	_ context.Context,
	filter systemmodel.RepairCaseListFilter,
) ([]systemmodel.RepairCase, error) {
	f.listCalls = append(f.listCalls, filter)
	if f.listFn != nil {
		return f.listFn(filter)
	}
	if f.listErr != nil {
		return nil, f.listErr
	}
	return append([]systemmodel.RepairCase(nil), f.listResult...), nil
}

func (f *fakeCaseRepository) GetStats(
	_ context.Context,
	_ *int64,
) (*systemmodel.RepairCaseStats, error) {
	f.statsCalls++
	if f.statsErr != nil {
		return nil, f.statsErr
	}
	if f.stats == nil {
		return &systemmodel.RepairCaseStats{}, nil
	}
	copyStats := *f.stats
	return &copyStats, nil
}

func (f *fakeCaseRepository) GetCase(
	_ context.Context,
	id int64,
) (*systemmodel.RepairCase, error) {
	f.getCalls++
	if f.getErr != nil {
		return nil, f.getErr
	}
	return cloneCase(f.cases[id]), nil
}

func (f *fakeCaseRepository) GetCaseForUpdate(
	ctx context.Context,
	_ database.DBTX,
	id int64,
) (*systemmodel.RepairCase, error) {
	return f.GetCase(ctx, id)
}

func (f *fakeCaseRepository) FindActiveCaseByFingerprint(
	_ context.Context,
	fingerprint string,
) (*systemmodel.RepairCase, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	for _, repairCase := range f.cases {
		if repairCase.Fingerprint == fingerprint &&
			(repairCase.Status == systemmodel.RepairCaseStatusOpen ||
				repairCase.Status == systemmodel.RepairCaseStatusInReview) {
			return cloneCase(repairCase), nil
		}
	}
	return nil, nil
}

func (f *fakeCaseRepository) TransitionStatus(
	_ context.Context,
	_ database.DBTX,
	caseID int64,
	status systemmodel.RepairCaseStatus,
	note *string,
	expected time.Time,
) error {
	f.transitionCalls = append(f.transitionCalls, caseTransitionCall{
		id:       caseID,
		status:   status,
		note:     cloneString(note),
		expected: expected,
	})
	if f.transitionErr != nil {
		return f.transitionErr
	}
	repairCase := f.cases[caseID]
	if repairCase == nil || !repairCase.UpdatedAt.Equal(expected) {
		return datarepairdb.ErrConcurrentModification
	}
	repairCase.Status = status
	repairCase.ResolutionNote = cloneString(note)
	repairCase.UpdatedAt = repairCase.UpdatedAt.Add(time.Second)
	return nil
}

func (f *fakeCaseRepository) AssignCase(
	_ context.Context,
	_ database.DBTX,
	caseID int64,
	assignee *string,
) error {
	f.assignCalls = append(f.assignCalls, caseAssignCall{
		id:       caseID,
		assignee: cloneString(assignee),
	})
	if f.assignErr != nil {
		return f.assignErr
	}
	repairCase := f.cases[caseID]
	if repairCase == nil {
		return errors.New("not found")
	}
	repairCase.AssignedTo = cloneString(assignee)
	repairCase.UpdatedAt = repairCase.UpdatedAt.Add(time.Second)
	return nil
}

func (f *fakeCaseRepository) AddComment(
	_ context.Context,
	_ database.DBTX,
	comment *systemmodel.RepairCaseComment,
) (int64, error) {
	f.addCommentCalls++
	if f.commentErr != nil {
		return 0, f.commentErr
	}
	f.nextCommentID++
	comment.ID = f.nextCommentID
	comment.CreatedAt = testNow
	f.comments[comment.CaseID] = append(f.comments[comment.CaseID], *comment)
	return comment.ID, nil
}

func (f *fakeCaseRepository) ListComments(
	_ context.Context,
	caseID int64,
) ([]systemmodel.RepairCaseComment, error) {
	f.commentListCalls++
	if f.commentsErr != nil {
		return nil, f.commentsErr
	}
	return append([]systemmodel.RepairCaseComment(nil), f.comments[caseID]...), nil
}

func (f *fakeCaseRepository) GetQuarantineByCase(
	_ context.Context,
	caseID int64,
) (*systemmodel.RepairQuarantine, error) {
	f.quarantineCalls++
	if f.quarantineErr != nil {
		return nil, f.quarantineErr
	}
	if f.quarantine[caseID] == nil {
		return nil, nil
	}
	copyQuarantine := *f.quarantine[caseID]
	return &copyQuarantine, nil
}

func (f *fakeCaseRepository) CreateQuarantine(
	_ context.Context,
	_ database.DBTX,
	record *systemmodel.RepairQuarantine,
) (int64, error) {
	f.createQuarantineCalls++
	if f.createQuarantineErr != nil {
		return 0, f.createQuarantineErr
	}
	for _, existing := range f.quarantine {
		if existing.Kind == record.Kind &&
			existing.SessionID == record.SessionID &&
			existing.RestoredAt == nil {
			return 0, datarepairdb.ErrActiveQuarantineExists
		}
	}
	f.nextQuarantineID++
	record.ID = f.nextQuarantineID
	record.QuarantinedAt = testNow
	copyRecord := *record
	copyRecord.OriginalRow = append(json.RawMessage(nil), record.OriginalRow...)
	f.quarantine[record.CaseID] = &copyRecord
	return record.ID, nil
}

func (f *fakeCaseRepository) GetQuarantine(
	_ context.Context,
	id int64,
) (*systemmodel.RepairQuarantine, error) {
	if f.quarantineErr != nil {
		return nil, f.quarantineErr
	}
	for _, record := range f.quarantine {
		if record.ID == id {
			copyRecord := *record
			copyRecord.OriginalRow = append(json.RawMessage(nil), record.OriginalRow...)
			return &copyRecord, nil
		}
	}
	return nil, nil
}

func (f *fakeCaseRepository) GetQuarantineForUpdate(
	ctx context.Context,
	_ database.DBTX,
	id int64,
) (*systemmodel.RepairQuarantine, error) {
	return f.GetQuarantine(ctx, id)
}

func (f *fakeCaseRepository) ListQuarantines(
	_ context.Context,
	filter systemmodel.RepairQuarantineListFilter,
) ([]systemmodel.RepairQuarantine, error) {
	f.quarantineListCalls = append(f.quarantineListCalls, filter)
	if f.quarantineErr != nil {
		return nil, f.quarantineErr
	}
	if f.quarantineList != nil {
		return append([]systemmodel.RepairQuarantine(nil), f.quarantineList...), nil
	}
	out := make([]systemmodel.RepairQuarantine, 0, len(f.quarantine))
	for _, record := range f.quarantine {
		out = append(out, *record)
	}
	return out, nil
}

func (f *fakeCaseRepository) MarkQuarantineRestored(
	_ context.Context,
	_ database.DBTX,
	id int64,
	actor string,
) error {
	f.markQuarantineCalls++
	if f.markQuarantineErr != nil {
		return f.markQuarantineErr
	}
	for _, record := range f.quarantine {
		if record.ID == id && record.RestoredAt == nil {
			restoredAt := testNow
			record.RestoredAt = &restoredAt
			record.RestoredBy = &actor
			return nil
		}
	}
	return datarepairdb.ErrQuarantineNotActive
}

type caseHandlerFixture struct {
	handler     *DataRepairHandler
	repo        *fakeCaseRepository
	audits      []auditEntry
	auditCalls  int
	auditFailAt int
	txCalls     int
}

func newCaseHandlerFixture(cases ...*systemmodel.RepairCase) *caseHandlerFixture {
	fixture := &caseHandlerFixture{repo: newFakeCaseRepository(cases...)}
	fixture.handler = NewDataRepairHandler(
		nil,
		WithCaseRepository(fixture.repo),
		WithForwardAuthHeader("X-Operator"),
	)
	fixture.handler.clock = func() time.Time { return testNow }
	fixture.handler.audit = func(_ context.Context, _ database.DBTX, entry auditEntry) error {
		fixture.auditCalls++
		if fixture.auditFailAt > 0 && fixture.auditCalls == fixture.auditFailAt {
			return errBoom
		}
		fixture.audits = append(fixture.audits, entry)
		return nil
	}
	fixture.handler.transaction = func(ctx context.Context, fn func(database.DBTX) error) error {
		fixture.txCalls++
		caseSnapshot := cloneCaseMap(fixture.repo.cases)
		commentSnapshot := cloneCommentMap(fixture.repo.comments)
		quarantineSnapshot := cloneQuarantineMap(fixture.repo.quarantine)
		nextCommentID := fixture.repo.nextCommentID
		nextCaseID := fixture.repo.nextCaseID
		nextQuarantineID := fixture.repo.nextQuarantineID
		auditCount := len(fixture.audits)
		if err := fn(nil); err != nil {
			fixture.repo.cases = caseSnapshot
			fixture.repo.comments = commentSnapshot
			fixture.repo.quarantine = quarantineSnapshot
			fixture.repo.nextCommentID = nextCommentID
			fixture.repo.nextCaseID = nextCaseID
			fixture.repo.nextQuarantineID = nextQuarantineID
			fixture.audits = fixture.audits[:auditCount]
			return err
		}
		return nil
	}
	return fixture
}

func sampleRepairCase(id int64, status systemmodel.RepairCaseStatus) *systemmodel.RepairCase {
	return &systemmodel.RepairCase{
		ID:                         id,
		Fingerprint:                strings.Repeat("a", 64),
		Kind:                       systemmodel.RepairCaseKindDrive,
		SessionID:                  1000 + id,
		VehicleID:                  7,
		Rule:                       "drive_open_park_observed",
		Confidence:                 systemmodel.RepairCaseConfidenceHigh,
		Status:                     status,
		Applicable:                 true,
		EvidenceStartedAt:          testNow.Add(-4 * time.Hour),
		EvidenceContradictionTs:    testNow.Add(-3 * time.Hour),
		EvidenceContradictionSrc:   "signal_log",
		EvidenceContradictionField: "Gear",
		EvidenceContradictionValue: "P",
		FirstSeenAt:                testNow.Add(-2 * time.Hour),
		LastSeenAt:                 testNow.Add(-time.Duration(id) * time.Minute),
		CreatedAt:                  testNow.Add(-2 * time.Hour),
		UpdatedAt:                  testNow.Add(-time.Duration(id) * time.Second),
	}
}

func newCaseRouter(handler *DataRepairHandler) chi.Router {
	router := chi.NewRouter()
	router.Get("/data-repair/cases", handler.ListCases)
	router.Get("/data-repair/cases/stats", handler.GetCaseStats)
	router.Get("/data-repair/cases/{id}", handler.GetCase)
	router.Post("/data-repair/cases/{id}/transition", handler.TransitionCase)
	router.Put("/data-repair/cases/{id}/assignment", handler.AssignCase)
	router.Post("/data-repair/cases/{id}/comments", handler.AddCaseComment)
	router.Post("/data-repair/cases/{id}/quarantine", handler.QuarantineCase)
	router.Post("/data-repair/cases/bulk-transition", handler.BulkTransitionCases)
	router.Get("/data-repair/quarantine", handler.ListQuarantines)
	router.Post("/data-repair/quarantine/{id}/restore", handler.RestoreQuarantine)
	return router
}

func doCaseRequest(
	t *testing.T,
	handler *DataRepairHandler,
	method string,
	path string,
	body io.Reader,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Operator", "operator@example.test")
	recorder := httptest.NewRecorder()
	newCaseRouter(handler).ServeHTTP(recorder, request)
	return recorder
}

func TestParseCaseListFilter(t *testing.T) {
	t.Run("valid complete filter", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet,
			"/?vehicle_id=7&status=in_review&kind=drive&confidence=high&assigned_to=%20alice%20"+
				"&cursor_last_seen_at=2026-06-01T11:00:00Z&cursor_id=9&limit=25",
			nil,
		)
		filter, requested, err := parseCaseListFilter(request)
		if err != nil {
			t.Fatalf("parseCaseListFilter() error = %v", err)
		}
		if requested != 25 || filter.Limit != 26 {
			t.Fatalf("limits = requested %d/repo %d, want 25/26", requested, filter.Limit)
		}
		if filter.VehicleID == nil || *filter.VehicleID != 7 ||
			filter.Status == nil || *filter.Status != systemmodel.RepairCaseStatusInReview ||
			filter.Kind == nil || *filter.Kind != systemmodel.RepairCaseKindDrive ||
			filter.Confidence == nil || *filter.Confidence != systemmodel.RepairCaseConfidenceHigh ||
			filter.AssignedTo == nil || *filter.AssignedTo != "alice" ||
			filter.CursorID == nil || *filter.CursorID != 9 ||
			filter.CursorLastSeenAt == nil {
			t.Fatalf("unexpected parsed filter: %+v", filter)
		}
	})

	t.Run("defaults", func(t *testing.T) {
		filter, requested, err := parseCaseListFilter(httptest.NewRequest(http.MethodGet, "/", nil))
		if err != nil {
			t.Fatalf("parseCaseListFilter() error = %v", err)
		}
		if requested != defaultCaseListLimit || filter.Limit != defaultCaseListLimit+1 {
			t.Fatalf("limits = requested %d/repo %d", requested, filter.Limit)
		}
	})

	tooLongAssignee := url.QueryEscape(strings.Repeat("x", maxCaseAssigneeChars+1))
	tests := []struct {
		name  string
		query string
	}{
		{"vehicle nonnumeric", "?vehicle_id=nope"},
		{"vehicle zero", "?vehicle_id=0"},
		{"status", "?status=pending"},
		{"kind", "?kind=trip"},
		{"confidence", "?confidence=low"},
		{"blank assignee", "?assigned_to=%20"},
		{"long assignee", "?assigned_to=" + tooLongAssignee},
		{"cursor timestamp alone", "?cursor_last_seen_at=2026-06-01T11:00:00Z"},
		{"cursor id alone", "?cursor_id=2"},
		{"bad cursor timestamp", "?cursor_last_seen_at=yesterday&cursor_id=2"},
		{"bad cursor id", "?cursor_last_seen_at=2026-06-01T11:00:00Z&cursor_id=-1"},
		{"zero limit", "?limit=0"},
		{"invalid limit", "?limit=many"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/"+test.query, nil)
			if _, _, err := parseCaseListFilter(request); err == nil {
				t.Fatal("parseCaseListFilter() error = nil, want validation error")
			}
		})
	}

	t.Run("limit is capped", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet,
			fmt.Sprintf("/?limit=%d", maxCaseListLimit+1), nil)
		filter, requested, err := parseCaseListFilter(request)
		if err != nil {
			t.Fatalf("parseCaseListFilter() error = %v", err)
		}
		if requested != maxCaseListLimit || filter.Limit != maxCaseListLimit {
			t.Fatalf("limits = requested %d/repo %d, want capped %d",
				requested, filter.Limit, maxCaseListLimit)
		}
	})
}

func TestListCases_ResponseShapeAndCursor(t *testing.T) {
	fixture := newCaseHandlerFixture()
	first := sampleRepairCase(3, systemmodel.RepairCaseStatusOpen)
	second := sampleRepairCase(2, systemmodel.RepairCaseStatusInReview)
	third := sampleRepairCase(1, systemmodel.RepairCaseStatusResolved)
	fixture.repo.listResult = []systemmodel.RepairCase{*first, *second, *third}

	recorder := doCaseRequest(t, fixture.handler, http.MethodGet, "/data-repair/cases?limit=2", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}

	var response struct {
		Cases      []systemmodel.RepairCase `json:"cases"`
		HasMore    bool                     `json:"has_more"`
		NextCursor *repairCaseCursor        `json:"next_cursor"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Cases) != 2 || !response.HasMore || response.NextCursor == nil {
		t.Fatalf("unexpected list response: %+v", response)
	}
	if response.NextCursor.ID != second.ID || !response.NextCursor.LastSeenAt.Equal(second.LastSeenAt) {
		t.Fatalf("next_cursor = %+v, want case %d cursor", response.NextCursor, second.ID)
	}
	if len(fixture.repo.listCalls) != 1 || fixture.repo.listCalls[0].Limit != 3 {
		t.Fatalf("repo list filters = %+v, want one call with limit 3", fixture.repo.listCalls)
	}
	if fixture.txCalls != 0 || len(fixture.audits) != 0 {
		t.Fatal("GET list performed a mutation")
	}
}

func TestListCases_EmptyArrayShape(t *testing.T) {
	fixture := newCaseHandlerFixture()
	recorder := doCaseRequest(t, fixture.handler, http.MethodGet, "/data-repair/cases", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if string(response["cases"]) != "[]" || string(response["has_more"]) != "false" {
		t.Fatalf("response = %s, want cases=[] and has_more=false", recorder.Body.String())
	}
	if _, exists := response["next_cursor"]; exists {
		t.Fatalf("next_cursor must be omitted when there is no next page: %s", recorder.Body.String())
	}
}

func TestListCases_RepositoryCapUsesOneRowProbe(t *testing.T) {
	fixture := newCaseHandlerFixture()
	page := make([]systemmodel.RepairCase, maxCaseListLimit)
	for i := range page {
		page[i] = *sampleRepairCase(int64(maxCaseListLimit-i), systemmodel.RepairCaseStatusOpen)
	}
	fixture.repo.listFn = func(filter systemmodel.RepairCaseListFilter) ([]systemmodel.RepairCase, error) {
		if filter.CursorID != nil {
			return []systemmodel.RepairCase{
				*sampleRepairCase(*filter.CursorID-1, systemmodel.RepairCaseStatusOpen),
			}, nil
		}
		return page, nil
	}

	recorder := doCaseRequest(t, fixture.handler, http.MethodGet,
		fmt.Sprintf("/data-repair/cases?limit=%d", maxCaseListLimit), nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response repairCaseListResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Cases) != maxCaseListLimit || !response.HasMore || response.NextCursor == nil {
		t.Fatalf("unexpected capped response: cases=%d has_more=%t cursor=%+v",
			len(response.Cases), response.HasMore, response.NextCursor)
	}
	if len(fixture.repo.listCalls) != 2 || fixture.repo.listCalls[1].Limit != 1 {
		t.Fatalf("repo calls = %+v, want capped page plus one-row probe", fixture.repo.listCalls)
	}
}

func TestGetCaseStats_FrontendShapeIsDirect(t *testing.T) {
	oldest := testNow.Add(-24 * time.Hour)
	lastScan := testNow.Add(-time.Minute)
	fixture := newCaseHandlerFixture()
	fixture.repo.stats = &systemmodel.RepairCaseStats{
		Total:            35,
		OpenCount:        2,
		InReviewCount:    3,
		AppliedCount:     4,
		DismissedCount:   5,
		QuarantinedCount: 6,
		RestoredCount:    7,
		ResolvedCount:    8,
		DriveCount:       15,
		ChargingCount:    20,
		OldestOpenAt:     &oldest,
		LastScanAt:       &lastScan,
	}

	recorder := doCaseRequest(t, fixture.handler, http.MethodGet, "/data-repair/cases/stats?vehicle_id=7", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	wantKeys := []string{
		"total", "open", "in_review", "applied", "dismissed", "quarantined",
		"restored", "resolved", "drive", "charging", "oldest_open_at", "last_scan_at",
	}
	if len(response) != len(wantKeys) {
		t.Fatalf("response keys = %v, want exactly %v", reflect.ValueOf(response).MapKeys(), wantKeys)
	}
	for _, key := range wantKeys {
		if _, exists := response[key]; !exists {
			t.Errorf("response missing %q: %s", key, recorder.Body.String())
		}
	}
	if string(response["total"]) != "35" {
		t.Errorf("total = %s, want 35", response["total"])
	}
}

func TestGetCaseStats_RejectsInvalidVehicleID(t *testing.T) {
	fixture := newCaseHandlerFixture()
	for _, value := range []string{"", "0", "-1", "vehicle"} {
		recorder := doCaseRequest(t, fixture.handler, http.MethodGet,
			"/data-repair/cases/stats?vehicle_id="+url.QueryEscape(value), nil)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("vehicle_id=%q: status = %d, want 400", value, recorder.Code)
		}
	}
	if fixture.repo.statsCalls != 0 {
		t.Fatalf("stats repository calls = %d, want 0", fixture.repo.statsCalls)
	}
}

func TestGetCase_DetailShapeAndNotFound(t *testing.T) {
	repairCase := sampleRepairCase(8, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(repairCase)
	fixture.repo.comments[8] = []systemmodel.RepairCaseComment{
		{ID: 1, CaseID: 8, Actor: "one", Body: "first", CreatedAt: testNow},
	}

	recorder := doCaseRequest(t, fixture.handler, http.MethodGet, "/data-repair/cases/8", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response) != 3 || string(response["quarantine"]) != "null" {
		t.Fatalf("detail response shape = %s", recorder.Body.String())
	}
	var comments []systemmodel.RepairCaseComment
	if err := json.Unmarshal(response["comments"], &comments); err != nil || len(comments) != 1 {
		t.Fatalf("comments = %s, err=%v", response["comments"], err)
	}
	if fixture.repo.commentListCalls != 1 || fixture.repo.quarantineCalls != 1 {
		t.Fatalf("detail reads = comments %d/quarantine %d, want 1/1",
			fixture.repo.commentListCalls, fixture.repo.quarantineCalls)
	}

	missing := doCaseRequest(t, fixture.handler, http.MethodGet, "/data-repair/cases/999", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.Code)
	}
}

func TestTransitionCase_SuccessAndAudit(t *testing.T) {
	repairCase := sampleRepairCase(4, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(repairCase)
	body := fmt.Sprintf(`{"status":"resolved","expected_updated_at":%q,"resolution_note":" fixed "}`,
		repairCase.UpdatedAt.Format(time.RFC3339Nano))

	recorder := doCaseRequest(t, fixture.handler, http.MethodPost, "/data-repair/cases/4/transition", strings.NewReader(body))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response systemmodel.RepairCase
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != systemmodel.RepairCaseStatusResolved ||
		response.ResolutionNote == nil || *response.ResolutionNote != "fixed" {
		t.Fatalf("updated case = %+v", response)
	}
	if len(fixture.audits) != 1 {
		t.Fatalf("audits = %d, want 1", len(fixture.audits))
	}
	audit := fixture.audits[0]
	if audit.Action != AuditActionCaseTransition ||
		audit.EntityType != auditEntityDataRepairCase ||
		audit.EntityID == nil || *audit.EntityID != 4 {
		t.Fatalf("audit = %+v", audit)
	}
	if strings.Contains(audit.Detail, "fixed") {
		t.Fatalf("audit detail leaked resolution text: %q", audit.Detail)
	}
}

func TestTransitionCase_ValidationConflictAndLifecycle(t *testing.T) {
	base := sampleRepairCase(4, systemmodel.RepairCaseStatusOpen)
	tests := []struct {
		name       string
		status     systemmodel.RepairCaseStatus
		current    systemmodel.RepairCaseStatus
		expected   string
		noteJSON   string
		wantStatus int
	}{
		{"system applied forbidden", systemmodel.RepairCaseStatusApplied, systemmodel.RepairCaseStatusOpen, base.UpdatedAt.Format(time.RFC3339Nano), "", http.StatusBadRequest},
		{"system quarantined forbidden", systemmodel.RepairCaseStatusQuarantined, systemmodel.RepairCaseStatusOpen, base.UpdatedAt.Format(time.RFC3339Nano), "", http.StatusBadRequest},
		{"bad expected timestamp", systemmodel.RepairCaseStatusInReview, systemmodel.RepairCaseStatusOpen, "yesterday", "", http.StatusBadRequest},
		{"missing expected timestamp", systemmodel.RepairCaseStatusInReview, systemmodel.RepairCaseStatusOpen, "", "", http.StatusBadRequest},
		{"dismissed needs reason", systemmodel.RepairCaseStatusDismissed, systemmodel.RepairCaseStatusOpen, base.UpdatedAt.Format(time.RFC3339Nano), "", http.StatusBadRequest},
		{"overlong resolution", systemmodel.RepairCaseStatusResolved, systemmodel.RepairCaseStatusOpen, base.UpdatedAt.Format(time.RFC3339Nano), `,"resolution_note":"` + strings.Repeat("x", maxCaseResolutionNoteChars+1) + `"`, http.StatusBadRequest},
		{"terminal current rejected", systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusApplied, base.UpdatedAt.Format(time.RFC3339Nano), "", http.StatusConflict},
		{"same state rejected", systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusOpen, base.UpdatedAt.Format(time.RFC3339Nano), "", http.StatusConflict},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repairCase := sampleRepairCase(4, test.current)
			fixture := newCaseHandlerFixture(repairCase)
			body := fmt.Sprintf(`{"status":%q,"expected_updated_at":%q%s}`,
				test.status, test.expected, test.noteJSON)
			recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
				"/data-repair/cases/4/transition", strings.NewReader(body))
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			if len(fixture.repo.transitionCalls) != 0 || len(fixture.audits) != 0 {
				t.Fatal("rejected transition mutated state or wrote an audit")
			}
		})
	}
}

func TestBulkTransitionCases_RepositoryFailureRollsBackWholeBatch(t *testing.T) {
	first := sampleRepairCase(1, systemmodel.RepairCaseStatusOpen)
	second := sampleRepairCase(2, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(first, second)
	fixture.repo.transitionErr = errBoom

	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/bulk-transition",
		strings.NewReader(`{"case_ids":[1,2],"status":"in_review"}`))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", recorder.Code, recorder.Body.String())
	}
	if fixture.repo.cases[1].Status != systemmodel.RepairCaseStatusOpen ||
		fixture.repo.cases[2].Status != systemmodel.RepairCaseStatusOpen {
		t.Fatal("repository failure partially committed the batch")
	}
	if len(fixture.audits) != 0 {
		t.Fatalf("committed audits = %d, want 0", len(fixture.audits))
	}
}

func TestTransitionCase_OptimisticConflict(t *testing.T) {
	repairCase := sampleRepairCase(9, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(repairCase)
	fixture.repo.transitionErr = datarepairdb.ErrConcurrentModification
	body := fmt.Sprintf(`{"status":"in_review","expected_updated_at":%q}`,
		repairCase.UpdatedAt.Format(time.RFC3339Nano))

	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/9/transition", strings.NewReader(body))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", recorder.Code, recorder.Body.String())
	}
	if len(fixture.audits) != 0 {
		t.Fatalf("audits = %d, want 0", len(fixture.audits))
	}
}

func TestAssignCase_AssignAndUnassign(t *testing.T) {
	tests := []struct {
		name string
		body string
		want *string
	}{
		{"assign trimmed value", `{"assigned_to":"  alice@example.test  "}`, caseStringPointer("alice@example.test")},
		{"unassign with null", `{"assigned_to":null}`, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repairCase := sampleRepairCase(2, systemmodel.RepairCaseStatusOpen)
			previous := "previous@example.test"
			repairCase.AssignedTo = &previous
			fixture := newCaseHandlerFixture(repairCase)

			recorder := doCaseRequest(t, fixture.handler, http.MethodPut,
				"/data-repair/cases/2/assignment", strings.NewReader(test.body))
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
			}
			if !reflect.DeepEqual(fixture.repo.cases[2].AssignedTo, test.want) {
				t.Fatalf("assigned_to = %v, want %v", fixture.repo.cases[2].AssignedTo, test.want)
			}
			var response systemmodel.RepairCase
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.ID != 2 || !reflect.DeepEqual(response.AssignedTo, test.want) {
				t.Fatalf("assignment response = %+v", response)
			}
			if len(fixture.audits) != 1 ||
				fixture.audits[0].Action != AuditActionCaseAssignment {
				t.Fatalf("audits = %+v", fixture.audits)
			}
		})
	}
}

func caseStringPointer(value string) *string {
	return &value
}

func TestAssignCase_RejectsMissingBlankAndOverlong(t *testing.T) {
	tests := []string{
		`{}`,
		`{"assigned_to":""}`,
		`{"assigned_to":"   "}`,
		`{"assigned_to":"alice","unexpected":true}`,
		fmt.Sprintf(`{"assigned_to":%q}`, strings.Repeat("x", maxCaseAssigneeChars+1)),
	}
	for _, body := range tests {
		repairCase := sampleRepairCase(2, systemmodel.RepairCaseStatusOpen)
		fixture := newCaseHandlerFixture(repairCase)
		recorder := doCaseRequest(t, fixture.handler, http.MethodPut,
			"/data-repair/cases/2/assignment", strings.NewReader(body))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, recorder.Code)
		}
		if len(fixture.repo.assignCalls) != 0 {
			t.Errorf("body %s: assignment repository was called", body)
		}
	}
}

func TestAddCaseComment_TrimsReturnsAndAudits(t *testing.T) {
	fixture := newCaseHandlerFixture(sampleRepairCase(6, systemmodel.RepairCaseStatusOpen))
	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/6/comments", strings.NewReader(`{"body":"  reviewed evidence  "}`))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", recorder.Code, recorder.Body.String())
	}
	var comment systemmodel.RepairCaseComment
	if err := json.Unmarshal(recorder.Body.Bytes(), &comment); err != nil {
		t.Fatalf("decode comment: %v", err)
	}
	if comment.Body != "reviewed evidence" || comment.Actor != "operator@example.test" ||
		comment.ID == 0 || comment.CaseID != 6 {
		t.Fatalf("comment = %+v", comment)
	}
	if len(fixture.audits) != 1 || fixture.audits[0].Action != AuditActionCaseComment {
		t.Fatalf("audits = %+v", fixture.audits)
	}
	if strings.Contains(fixture.audits[0].Detail, comment.Body) {
		t.Fatalf("audit detail leaked comment body: %q", fixture.audits[0].Detail)
	}
}

func TestAddCaseComment_ValidatesLengthAndExistence(t *testing.T) {
	tests := []struct {
		name       string
		caseExists bool
		body       string
		wantStatus int
	}{
		{"missing body", true, `{}`, http.StatusBadRequest},
		{"blank body", true, `{"body":"   "}`, http.StatusBadRequest},
		{"overlong body", true, fmt.Sprintf(`{"body":%q}`, strings.Repeat("x", maxCaseCommentChars+1)), http.StatusBadRequest},
		{"missing case", false, `{"body":"valid"}`, http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var cases []*systemmodel.RepairCase
			if test.caseExists {
				cases = append(cases, sampleRepairCase(6, systemmodel.RepairCaseStatusOpen))
			}
			fixture := newCaseHandlerFixture(cases...)
			recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
				"/data-repair/cases/6/comments", strings.NewReader(test.body))
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			if fixture.repo.addCommentCalls != 0 {
				t.Fatal("invalid comment reached repository mutation")
			}
		})
	}
}

func TestBulkTransitionCases_DeduplicatesAndSkipsSafely(t *testing.T) {
	fixture := newCaseHandlerFixture(
		sampleRepairCase(1, systemmodel.RepairCaseStatusOpen),
		sampleRepairCase(2, systemmodel.RepairCaseStatusInReview),
		sampleRepairCase(3, systemmodel.RepairCaseStatusResolved),
	)
	body := `{"case_ids":[1,1,2,3,4],"status":"dismissed","resolution_note":" duplicate data "}`
	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/bulk-transition", strings.NewReader(body))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response bulkTransitionCaseResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Updated != 2 || response.Skipped != 2 {
		t.Fatalf("response = %+v, want updated=2 skipped=2", response)
	}
	if len(fixture.repo.transitionCalls) != 2 || len(fixture.audits) != 2 {
		t.Fatalf("transitions/audits = %d/%d, want 2/2",
			len(fixture.repo.transitionCalls), len(fixture.audits))
	}
	for _, audit := range fixture.audits {
		if audit.Action != AuditActionCaseBulkTransition ||
			audit.EntityType != auditEntityDataRepairCase {
			t.Errorf("unexpected bulk audit: %+v", audit)
		}
	}
}

func TestBulkTransitionCases_ValidationBounds(t *testing.T) {
	tooMany := make([]int64, maxBulkCaseIDs+1)
	for i := range tooMany {
		tooMany[i] = int64(i + 1)
	}
	tooManyBody, err := json.Marshal(map[string]interface{}{
		"case_ids": tooMany,
		"status":   "in_review",
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []string{
		`{"case_ids":[],"status":"in_review"}`,
		`{"case_ids":[1,0],"status":"in_review"}`,
		`{"case_ids":[1],"status":"resolved"}`,
		`{"case_ids":[1],"status":"dismissed"}`,
		string(tooManyBody),
	}
	for _, body := range tests {
		fixture := newCaseHandlerFixture(sampleRepairCase(1, systemmodel.RepairCaseStatusOpen))
		recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
			"/data-repair/cases/bulk-transition", strings.NewReader(body))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, recorder.Code)
		}
		if len(fixture.repo.transitionCalls) != 0 || len(fixture.audits) != 0 {
			t.Errorf("body %s: rejected bulk request mutated state", body)
		}
	}
}

func TestBulkTransitionCases_ConcurrentCaseIsSkipped(t *testing.T) {
	fixture := newCaseHandlerFixture(sampleRepairCase(1, systemmodel.RepairCaseStatusOpen))
	fixture.repo.transitionErr = datarepairdb.ErrConcurrentModification

	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/bulk-transition",
		strings.NewReader(`{"case_ids":[1],"status":"in_review"}`))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response bulkTransitionCaseResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Updated != 0 || response.Skipped != 1 || len(fixture.audits) != 0 {
		t.Fatalf("response/audits = %+v/%d, want updated=0 skipped=1 audits=0",
			response, len(fixture.audits))
	}
}

func TestMetadataAuditFailureRollsBack(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   func(*systemmodel.RepairCase) string
		assert func(*testing.T, *caseHandlerFixture, *systemmodel.RepairCase)
	}{
		{
			name:   "transition",
			method: http.MethodPost,
			path:   "/data-repair/cases/1/transition",
			body: func(repairCase *systemmodel.RepairCase) string {
				return fmt.Sprintf(`{"status":"in_review","expected_updated_at":%q}`,
					repairCase.UpdatedAt.Format(time.RFC3339Nano))
			},
			assert: func(t *testing.T, fixture *caseHandlerFixture, before *systemmodel.RepairCase) {
				t.Helper()
				if fixture.repo.cases[1].Status != before.Status {
					t.Fatalf("status = %q, want rolled back %q", fixture.repo.cases[1].Status, before.Status)
				}
			},
		},
		{
			name:   "assignment",
			method: http.MethodPut,
			path:   "/data-repair/cases/1/assignment",
			body: func(*systemmodel.RepairCase) string {
				return `{"assigned_to":"alice"}`
			},
			assert: func(t *testing.T, fixture *caseHandlerFixture, _ *systemmodel.RepairCase) {
				t.Helper()
				if fixture.repo.cases[1].AssignedTo != nil {
					t.Fatalf("assigned_to = %v, want rolled back nil", fixture.repo.cases[1].AssignedTo)
				}
			},
		},
		{
			name:   "comment",
			method: http.MethodPost,
			path:   "/data-repair/cases/1/comments",
			body: func(*systemmodel.RepairCase) string {
				return `{"body":"reviewed"}`
			},
			assert: func(t *testing.T, fixture *caseHandlerFixture, _ *systemmodel.RepairCase) {
				t.Helper()
				if len(fixture.repo.comments[1]) != 0 {
					t.Fatalf("comments = %d, want rolled back", len(fixture.repo.comments[1]))
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repairCase := sampleRepairCase(1, systemmodel.RepairCaseStatusOpen)
			fixture := newCaseHandlerFixture(repairCase)
			fixture.auditFailAt = 1
			recorder := doCaseRequest(t, fixture.handler, test.method, test.path,
				strings.NewReader(test.body(repairCase)))
			if recorder.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500; body=%s", recorder.Code, recorder.Body.String())
			}
			test.assert(t, fixture, repairCase)
			if len(fixture.audits) != 0 {
				t.Fatalf("committed audits = %d, want 0", len(fixture.audits))
			}
		})
	}
}

func TestBulkTransitionCases_AuditFailureRollsBackWholeBatch(t *testing.T) {
	first := sampleRepairCase(1, systemmodel.RepairCaseStatusOpen)
	second := sampleRepairCase(2, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(first, second)
	fixture.auditFailAt = 2

	recorder := doCaseRequest(t, fixture.handler, http.MethodPost,
		"/data-repair/cases/bulk-transition",
		strings.NewReader(`{"case_ids":[1,2],"status":"in_review"}`))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", recorder.Code, recorder.Body.String())
	}
	if fixture.repo.cases[1].Status != systemmodel.RepairCaseStatusOpen ||
		fixture.repo.cases[2].Status != systemmodel.RepairCaseStatusOpen {
		t.Fatalf("batch was partially committed: statuses=%q/%q",
			fixture.repo.cases[1].Status, fixture.repo.cases[2].Status)
	}
	if len(fixture.audits) != 0 {
		t.Fatalf("committed audits = %d, want 0", len(fixture.audits))
	}
}

func TestCaseEndpoints_NilRepositoryReturns503(t *testing.T) {
	handler := NewDataRepairHandler(nil)
	tests := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/data-repair/cases", ""},
		{http.MethodGet, "/data-repair/cases/stats", ""},
		{http.MethodGet, "/data-repair/cases/1", ""},
		{http.MethodPost, "/data-repair/cases/1/transition", `{}`},
		{http.MethodPut, "/data-repair/cases/1/assignment", `{}`},
		{http.MethodPost, "/data-repair/cases/1/comments", `{}`},
		{http.MethodPost, "/data-repair/cases/bulk-transition", `{}`},
	}
	for _, test := range tests {
		var body io.Reader
		if test.body != "" {
			body = strings.NewReader(test.body)
		}
		recorder := doCaseRequest(t, handler, test.method, test.path, body)
		if recorder.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s: status = %d, want 503; body=%s",
				test.method, test.path, recorder.Code, recorder.Body.String())
		}
	}
}

func TestNewDataRepairHandler_CaseRepositoryWiring(t *testing.T) {
	if handler := NewDataRepairHandler(nil); handler.caseRepo != nil {
		t.Fatal("nil DB installed a case repository; endpoints must report unavailable")
	}
	if handler := NewDataRepairHandler(&database.DB{}); handler.caseRepo == nil {
		t.Fatal("non-nil DB did not install the production case repository")
	}

	fake := newFakeCaseRepository()
	if handler := NewDataRepairHandler(nil, WithCaseRepository(fake)); handler.caseRepo != fake {
		t.Fatal("WithCaseRepository did not install the injected repository")
	}
}

func TestCaseGetEndpointsDoNotMutate(t *testing.T) {
	repairCase := sampleRepairCase(1, systemmodel.RepairCaseStatusOpen)
	fixture := newCaseHandlerFixture(repairCase)
	fixture.repo.listResult = []systemmodel.RepairCase{*repairCase}

	requests := []string{
		"/data-repair/cases",
		"/data-repair/cases/stats",
		"/data-repair/cases/1",
	}
	for _, path := range requests {
		recorder := doCaseRequest(t, fixture.handler, http.MethodGet, path, nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s: status = %d, want 200; body=%s", path, recorder.Code, recorder.Body.String())
		}
	}
	if fixture.txCalls != 0 ||
		len(fixture.repo.transitionCalls) != 0 ||
		len(fixture.repo.assignCalls) != 0 ||
		fixture.repo.addCommentCalls != 0 ||
		len(fixture.audits) != 0 {
		t.Fatalf(
			"GET side effects: tx=%d transition=%d assignment=%d comments=%d audits=%d",
			fixture.txCalls,
			len(fixture.repo.transitionCalls),
			len(fixture.repo.assignCalls),
			fixture.repo.addCommentCalls,
			len(fixture.audits),
		)
	}
}

func TestCaseMetadataWrites_ReturnNotFoundWithoutMutation(t *testing.T) {
	tests := []struct {
		method string
		path   string
		body   string
	}{
		{
			http.MethodPost,
			"/data-repair/cases/99/transition",
			fmt.Sprintf(`{"status":"in_review","expected_updated_at":%q}`, testNow.Format(time.RFC3339)),
		},
		{http.MethodPut, "/data-repair/cases/99/assignment", `{"assigned_to":null}`},
		{http.MethodPost, "/data-repair/cases/99/comments", `{"body":"reviewed"}`},
	}
	for _, test := range tests {
		fixture := newCaseHandlerFixture()
		recorder := doCaseRequest(t, fixture.handler, test.method, test.path, strings.NewReader(test.body))
		if recorder.Code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404; body=%s",
				test.method, test.path, recorder.Code, recorder.Body.String())
		}
		if fixture.txCalls != 0 || len(fixture.audits) != 0 {
			t.Errorf("%s %s: not-found request mutated state", test.method, test.path)
		}
	}
}

func TestCaseTransitionPolicy(t *testing.T) {
	allowed := map[[2]systemmodel.RepairCaseStatus]bool{
		{systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusInReview}:      true,
		{systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusDismissed}:     true,
		{systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusResolved}:      true,
		{systemmodel.RepairCaseStatusInReview, systemmodel.RepairCaseStatusOpen}:      true,
		{systemmodel.RepairCaseStatusInReview, systemmodel.RepairCaseStatusDismissed}: true,
		{systemmodel.RepairCaseStatusInReview, systemmodel.RepairCaseStatusResolved}:  true,
		{systemmodel.RepairCaseStatusDismissed, systemmodel.RepairCaseStatusOpen}:     true,
		{systemmodel.RepairCaseStatusResolved, systemmodel.RepairCaseStatusOpen}:      true,
	}
	for _, from := range systemmodel.ValidRepairCaseStatuses {
		for _, to := range systemmodel.ValidRepairCaseStatuses {
			want := allowed[[2]systemmodel.RepairCaseStatus{from, to}]
			if got := caseTransitionAllowed(from, to); got != want {
				t.Errorf("caseTransitionAllowed(%q, %q) = %t, want %t", from, to, got, want)
			}
		}
	}
}
