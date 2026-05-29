package alerts

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// TestCreateAlert_AcceptsLegacyVehicleIDOnly pins the backward-compat
// contract from the prompt's resolution table: a legacy client that
// sends only `vehicle_id: 5` is interpreted as
// `all_vehicles=false, vehicle_ids=[5]` server-side.
// Phase-49 / Slice 0005 / Acceptance criterion 5.
func TestCreateAlert_AcceptsLegacyVehicleIDOnly(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(`"severity":"warn","vehicle_id":5`))))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("created rules = %d, want 1", len(repo.created))
	}
	got := repo.created[0]
	if got.AllVehicles {
		t.Fatalf("AllVehicles = true; legacy vehicle_id:5 must coalesce to all_vehicles=false")
	}
	if len(got.VehicleIDs) != 1 || got.VehicleIDs[0] != 5 {
		t.Fatalf("VehicleIDs = %v, want [5]", got.VehicleIDs)
	}
}

// TestCreateAlert_AcceptsNewShapeOnly pins the new canonical write
// path: explicit `all_vehicles: false` + `vehicle_ids: [1, 2]` round
// trips into the model unchanged. Phase-49 / Slice 0005.
func TestCreateAlert_AcceptsNewShapeOnly(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(`"severity":"warn","all_vehicles":false,"vehicle_ids":[2,1]`))))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("created rules = %d, want 1", len(repo.created))
	}
	got := repo.created[0]
	if got.AllVehicles {
		t.Fatalf("AllVehicles = true; explicit all_vehicles:false must be honoured")
	}
	if len(got.VehicleIDs) != 2 || got.VehicleIDs[0] != 1 || got.VehicleIDs[1] != 2 {
		t.Fatalf("VehicleIDs = %v, want sorted [1 2]", got.VehicleIDs)
	}
}

// TestCreateAlert_AcceptsStickyAllByDefault pins the default-for-new-rules
// behaviour: a request body with no vehicle keys at all defaults to
// `all_vehicles=true, vehicle_ids=[]`. Phase-49 / Slice 0005 / Decision D9.
func TestCreateAlert_AcceptsStickyAllByDefault(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(`"severity":"warn"`))))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	got := repo.created[0]
	if !got.AllVehicles {
		t.Fatalf("AllVehicles = false; absent vehicle keys must default to sticky-all")
	}
	if len(got.VehicleIDs) != 0 {
		t.Fatalf("VehicleIDs = %v, want empty", got.VehicleIDs)
	}
}

// TestCreateAlert_RejectsBothSpellingsConflict pins the validation rule
// from the prompt's resolution table: `all_vehicles=true` paired with
// any non-empty `vehicle_ids` is a 422 conflict.
// Phase-49 / Slice 0005 / Acceptance criterion 7.
func TestCreateAlert_RejectsBothSpellingsConflict(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{
			name: "all_vehicles_true_with_subset",
			body: `"severity":"warn","all_vehicles":true,"vehicle_ids":[1]`,
		},
		{
			name: "all_vehicles_true_with_legacy_id",
			body: `"severity":"warn","all_vehicles":true,"vehicle_id":1`,
		},
		{
			name: "explicit_false_with_empty_subset",
			body: `"severity":"warn","all_vehicles":false,"vehicle_ids":[]`,
		},
		{
			name: "negative_vehicle_id_in_subset",
			body: `"severity":"warn","all_vehicles":false,"vehicle_ids":[-1]`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
				strings.NewReader(typedAlertRuleBody(tc.body))))

			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want %d, body=%s",
					rec.Code, http.StatusUnprocessableEntity, rec.Body.String())
			}
		})
	}
}

// TestUpdateRule_PreservesVehicleAssignment_OnNonVehiclePatch pins the
// partial-update safety guarantee from rubber-duck blocking finding #2:
// a PATCH that touches only `name` MUST NOT wipe the existing rule's
// AllVehicles flag or VehicleIDs subset. Without this guarantee, every
// non-vehicle update would silently delete junction rows because
// existing.VehicleIDs would be nil from a hypothetical un-hydrated read.
// Phase-49 / Slice 0005 / Decision D8.
func TestUpdateRule_PreservesVehicleAssignment_OnNonVehiclePatch(t *testing.T) {
	existing := validAlertRuleForTest()
	existing.AllVehicles = false
	existing.VehicleIDs = []int64{3, 7}
	repo := &fakeAlertRuleRepo{existing: existing}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42",
		`{"name":"renamed"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.updated) != 1 {
		t.Fatalf("updated rules = %d, want 1", len(repo.updated))
	}
	got := repo.updated[0]
	if got.AllVehicles {
		t.Fatalf("AllVehicles = true; partial non-vehicle patch must preserve existing AllVehicles=false")
	}
	if len(got.VehicleIDs) != 2 || got.VehicleIDs[0] != 3 || got.VehicleIDs[1] != 7 {
		t.Fatalf("VehicleIDs = %v, want preserved [3 7]", got.VehicleIDs)
	}
	if got.Name != "renamed" {
		t.Fatalf("Name = %q, want %q", got.Name, "renamed")
	}
}

// TestUpdateRule_SwitchAllToSpecific pins the canonical "switch from
// sticky-all to explicit subset" path used by the multi-select UI.
// Phase-49 / Slice 0005.
func TestUpdateRule_SwitchAllToSpecific(t *testing.T) {
	existing := validAlertRuleForTest()
	existing.AllVehicles = true
	existing.VehicleIDs = []int64{}
	repo := &fakeAlertRuleRepo{existing: existing}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42",
		`{"all_vehicles":false,"vehicle_ids":[4,2]}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := repo.updated[0]
	if got.AllVehicles {
		t.Fatalf("AllVehicles = true; expected switch to false")
	}
	if len(got.VehicleIDs) != 2 || got.VehicleIDs[0] != 2 || got.VehicleIDs[1] != 4 {
		t.Fatalf("VehicleIDs = %v, want sorted [2 4]", got.VehicleIDs)
	}
}

// TestUpdateRule_SwitchSpecificToAll pins the inverse: switching back
// to sticky-all clears the junction (resolved VehicleIDs is empty).
// Phase-49 / Slice 0005.
func TestUpdateRule_SwitchSpecificToAll(t *testing.T) {
	existing := validAlertRuleForTest()
	existing.AllVehicles = false
	existing.VehicleIDs = []int64{1, 2}
	repo := &fakeAlertRuleRepo{existing: existing}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42",
		`{"all_vehicles":true}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := repo.updated[0]
	if !got.AllVehicles {
		t.Fatalf("AllVehicles = false; expected switch to true")
	}
	if len(got.VehicleIDs) != 0 {
		t.Fatalf("VehicleIDs = %v, want empty (sticky-all)", got.VehicleIDs)
	}
}

// TestGetAlertRule_EmitsLegacyAndNewVehicleFields pins the response
// shape contract from the prompt's "Server response" table: every
// rule response includes `all_vehicles`, `vehicle_ids` (always an
// array, never null), AND the legacy `vehicle_id` (mirrored from the
// subset for backward compat). Phase-49 / Slice 0005.
func TestGetAlertRule_EmitsLegacyAndNewVehicleFields(t *testing.T) {
	cases := []struct {
		name           string
		rule           *alertmodel.AlertRule
		wantAll        bool
		wantIDs        []int64
		wantHasLegacy  bool
		wantLegacy     int64
		wantIDsIsArray bool // confirms `[]` not `null`
	}{
		{
			name: "sticky_all_emits_empty_array_and_null_legacy",
			rule: &alertmodel.AlertRule{
				ID: 42, Name: "r1", Severity: "warn", SignalName: "VehicleSpeed", Op: ">",
				ValueNum:    func() *float64 { v := 70.0; return &v }(),
				CooldownMin: 15, TriggerMode: "repeat", Kind: "signal",
				AllVehicles: true,
				VehicleIDs:  []int64{},
				VehicleID:   nil,
			},
			wantAll: true, wantIDs: []int64{}, wantHasLegacy: false, wantIDsIsArray: true,
		},
		{
			name: "explicit_subset_emits_array_and_legacy_min",
			rule: &alertmodel.AlertRule{
				ID: 42, Name: "r2", Severity: "warn", SignalName: "VehicleSpeed", Op: ">",
				ValueNum:    func() *float64 { v := 70.0; return &v }(),
				CooldownMin: 15, TriggerMode: "repeat", Kind: "signal",
				AllVehicles: false,
				VehicleIDs:  []int64{3, 7},
				VehicleID:   testInt64Ptr(3),
			},
			wantAll: false, wantIDs: []int64{3, 7}, wantHasLegacy: true, wantLegacy: 3, wantIDsIsArray: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeAlertRuleRepo{
				byID: map[int64]*alertmodel.AlertRule{tc.rule.ID: tc.rule},
			}
			handler := newAlertHandlerForTestWithRepo(repo)
			rec := httptest.NewRecorder()

			handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42",
				`{"name":"unchanged"}`))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}

			var raw map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
				t.Fatalf("decode response: %v body=%s", err, rec.Body.String())
			}
			if _, ok := raw["all_vehicles"]; !ok {
				t.Fatalf("response missing required `all_vehicles` field; got=%s", rec.Body.String())
			}
			rawIDs, ok := raw["vehicle_ids"]
			if !ok {
				t.Fatalf("response missing required `vehicle_ids` field; got=%s", rec.Body.String())
			}
			if tc.wantIDsIsArray {
				s := strings.TrimSpace(string(rawIDs))
				if !strings.HasPrefix(s, "[") {
					t.Fatalf("vehicle_ids = %s; must be a JSON array (rubber-duck non-blocking #4: never null)", s)
				}
			}

			var allVehicles bool
			if err := json.Unmarshal(raw["all_vehicles"], &allVehicles); err != nil {
				t.Fatalf("decode all_vehicles: %v", err)
			}
			if allVehicles != tc.wantAll {
				t.Fatalf("all_vehicles = %v, want %v", allVehicles, tc.wantAll)
			}

			var vehicleIDs []int64
			if err := json.Unmarshal(raw["vehicle_ids"], &vehicleIDs); err != nil {
				t.Fatalf("decode vehicle_ids: %v", err)
			}
			if len(vehicleIDs) != len(tc.wantIDs) {
				t.Fatalf("vehicle_ids = %v, want %v", vehicleIDs, tc.wantIDs)
			}
			for i := range vehicleIDs {
				if vehicleIDs[i] != tc.wantIDs[i] {
					t.Fatalf("vehicle_ids = %v, want %v", vehicleIDs, tc.wantIDs)
				}
			}
		})
	}
}

func testInt64Ptr(v int64) *int64 { return &v }

func itoaInt64(v int64) string {
	// Avoid importing strconv just for one call site at test time;
	// the test rule IDs are tiny.
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	digits := make([]byte, 0, 4)
	for v > 0 {
		digits = append(digits, byte('0'+v%10))
		v /= 10
	}
	for i, j := 0, len(digits)-1; i < j; i, j = i+1, j-1 {
		digits[i], digits[j] = digits[j], digits[i]
	}
	if neg {
		return "-" + string(digits)
	}
	return string(digits)
}
