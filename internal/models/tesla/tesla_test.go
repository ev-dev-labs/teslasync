package tesla

import (
	"bytes"
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

// This suite treats the tesla DTO leaf as a contract package: its
// observable behaviour is (1) the one exported method, TeslaToken.IsActive,
// and (2) the JSON/DB wire shape every handler and repo in the tree relies
// on. The tests below pin both so a future edit that flips a branch, drops a
// db tag, camelCases a json key, or — most dangerously — removes the
// json:"-" redaction from a credential/VIN field fails loudly instead of
// silently leaking or breaking the frontend.

// ---------- small pointer helpers ----------

func sptr(s string) *string       { return &s }
func fptr(f float64) *float64     { return &f }
func bptr(b bool) *bool           { return &b }
func iptr(i int) *int             { return &i }
func i64ptr(i int64) *int64       { return &i }
func tptr(t time.Time) *time.Time { return &t }

// Deterministic timestamps: fixed UTC values round-trip through RFC3339
// exactly and never depend on the wall clock, so tests stay stable under
// -race with no sleeps.
var (
	tRef     = time.Date(2026, 3, 14, 9, 26, 53, 0, time.UTC)
	tExpired = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	tFuture  = time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
)

// ---------- TeslaToken.IsActive (the only exported method) ----------

// TestTeslaToken_IsActive is the table-driven contract for the token
// liveness check the Tesla API client and ai voice-mode snapshot both gate
// on. It pins the nil-receiver safety net, the strict before-expiry
// comparison, and the zero-value (never-set expiry ⇒ inactive) branch.
func TestTeslaToken_IsActive(t *testing.T) {
	t.Parallel()
	now := time.Now()
	cases := []struct {
		name string
		tok  *TeslaToken
		want bool
	}{
		{"nil receiver is inactive", nil, false},
		{"zero-value expiry is inactive", &TeslaToken{}, false},
		{"deterministic past expiry is inactive", &TeslaToken{ExpiresAt: tExpired}, false},
		{"deterministic future expiry is active", &TeslaToken{ExpiresAt: tFuture}, true},
		{"expires one hour from now is active", &TeslaToken{ExpiresAt: now.Add(time.Hour)}, true},
		{"expired one hour ago is inactive", &TeslaToken{ExpiresAt: now.Add(-time.Hour)}, false},
		{"expired one millisecond ago is inactive", &TeslaToken{ExpiresAt: now.Add(-time.Millisecond)}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := c.tok.IsActive(); got != c.want {
				t.Fatalf("IsActive() = %v, want %v", got, c.want)
			}
		})
	}
}

// TestTeslaToken_IsActive_DoesNotMutate confirms the read-only contract:
// evaluating liveness must never alter the receiver's expiry.
func TestTeslaToken_IsActive_DoesNotMutate(t *testing.T) {
	t.Parallel()
	tok := &TeslaToken{ExpiresAt: tFuture}
	_ = tok.IsActive()
	if !tok.ExpiresAt.Equal(tFuture) {
		t.Fatalf("IsActive mutated ExpiresAt to %v", tok.ExpiresAt)
	}
}

// ---------- TeslaToken credential redaction (ADR-005) ----------

// TestTeslaToken_JSON_OmitsSecrets pins the ADR-005 security contract: the
// encrypted AccessToken/RefreshToken ciphertext is tagged json:"-" and must
// never appear — by key OR by value — in a serialised token. A regression
// that drops the "-" would leak credentials into any API response that
// echoes a TeslaToken.
func TestTeslaToken_JSON_OmitsSecrets(t *testing.T) {
	t.Parallel()
	tok := &TeslaToken{
		ID:           1,
		AccountEmail: "owner@example.com",
		AccessToken:  "SECRET-ACCESS-abc123",
		RefreshToken: "SECRET-REFRESH-def456",
		TokenType:    "Bearer",
		ExpiresAt:    tFuture,
		ObtainedAt:   tRef,
		CreatedAt:    tRef,
		UpdatedAt:    tRef,
	}
	b, err := json.Marshal(tok)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(b)
	for _, secret := range []string{"SECRET-ACCESS-abc123", "SECRET-REFRESH-def456"} {
		if strings.Contains(s, secret) {
			t.Errorf("credential value leaked into JSON: %s", s)
		}
	}
	for _, key := range []string{"access_token", "refresh_token", "AccessToken", "RefreshToken"} {
		if strings.Contains(s, key) {
			t.Errorf("credential key %q leaked into JSON: %s", key, s)
		}
	}
	// Non-secret identity fields must still be present.
	if !strings.Contains(s, `"account_email":"owner@example.com"`) {
		t.Errorf("expected account_email in JSON, got %s", s)
	}
}

// TestTeslaToken_JSON_OmitEmpty verifies the omitempty pointer fields
// (Scopes, LastRefreshedAt) are absent when nil and present when set.
func TestTeslaToken_JSON_OmitEmpty(t *testing.T) {
	t.Parallel()

	bare, err := json.Marshal(&TeslaToken{ID: 1, ExpiresAt: tFuture})
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	for _, key := range []string{"scopes", "last_refreshed_at"} {
		if strings.Contains(string(bare), key) {
			t.Errorf("nil optional %q should be omitted, got %s", key, bare)
		}
	}

	full, err := json.Marshal(&TeslaToken{
		ID:              1,
		ExpiresAt:       tFuture,
		Scopes:          sptr("vehicle_device_data openid"),
		LastRefreshedAt: tptr(tRef),
	})
	if err != nil {
		t.Fatalf("marshal full: %v", err)
	}
	for _, key := range []string{"scopes", "last_refreshed_at"} {
		if !strings.Contains(string(full), key) {
			t.Errorf("set optional %q should be present, got %s", key, full)
		}
	}
}

// ---------- APICallLog wire shape ----------

// TestAPICallLog_JSON pins the observability-log wire contract: snake_case
// keys the UI reads, omitempty on the nullable fields, and value fidelity
// through a round trip.
func TestAPICallLog_JSON(t *testing.T) {
	t.Parallel()

	full := &APICallLog{
		ID:           7,
		Ts:           tRef,
		VehicleID:    i64ptr(42),
		Service:      "tesla-api",
		HTTPMethod:   "GET",
		Endpoint:     "/api/1/vehicles",
		StatusCode:   200,
		DurationMs:   123,
		ErrorMessage: sptr("none"),
		RateLimited:  true,
		RequestBody:  sptr("{}"),
		ResponseBody: sptr(`{"ok":true}`),
	}
	b, err := json.Marshal(full)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, key := range []string{`"vehicle_id"`, `"http_method"`, `"status_code"`, `"duration_ms"`, `"rate_limited"`} {
		if !strings.Contains(string(b), key) {
			t.Errorf("missing wire key %s in %s", key, b)
		}
	}

	var back APICallLog
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.ID != 7 || back.StatusCode != 200 || back.DurationMs != 123 || !back.RateLimited {
		t.Errorf("scalar fields not preserved: %+v", back)
	}
	if back.VehicleID == nil || *back.VehicleID != 42 {
		t.Errorf("VehicleID not preserved: %v", back.VehicleID)
	}

	// Nil nullables must be omitted, not rendered.
	bare, err := json.Marshal(&APICallLog{ID: 1, Service: "x", HTTPMethod: "GET", Endpoint: "/", StatusCode: 204})
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	for _, key := range []string{"vehicle_id", "error_message", "request_body", "response_body"} {
		if strings.Contains(string(bare), key) {
			t.Errorf("nil optional %q should be omitted, got %s", key, bare)
		}
	}
}

// ---------- VIN redaction on access-control records ----------

// TestVIN_NotSerialized pins the privacy contract for the two share/access
// DTOs: their VIN is a join key carried in-process only and is tagged
// json:"-", so it must never reach the wire even when populated. (VIN on
// charging history/session records is intentionally NOT redacted and is
// covered by the round-trip suite.)
func TestVIN_NotSerialized(t *testing.T) {
	t.Parallel()
	const vin = "5YJ3E1EA1PF000001"
	cases := []struct {
		name string
		val  any
	}{
		{"TeslaVehicleDriver", &TeslaVehicleDriver{ID: 1, VehicleID: 2, VIN: vin, DriverEmail: sptr("d@example.com")}},
		{"TeslaVehicleInvitation", &TeslaVehicleInvitation{ID: 1, VehicleID: 2, VIN: vin, InvitationID: "inv-1", Status: "pending"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			b, err := json.Marshal(c.val)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			s := string(b)
			if strings.Contains(s, vin) {
				t.Errorf("VIN value leaked into JSON: %s", s)
			}
			if strings.Contains(s, `"vin"`) {
				t.Errorf("vin key leaked into JSON: %s", s)
			}
		})
	}
}

// ---------- reflective contract guards over every exported struct ----------

// modelSamples returns one fully-populated pointer per exported struct in
// the package. Populating every field (all pointers non-nil) exercises the
// omitempty "present" path and gives the round-trip guard full coverage.
func modelSamples() []any {
	return []any{
		&TeslaToken{
			ID: 1, AccountEmail: "owner@example.com",
			AccessToken: "cipher-a", RefreshToken: "cipher-r", TokenType: "Bearer",
			Scopes: sptr("openid"), ExpiresAt: tFuture, ObtainedAt: tRef,
			LastRefreshedAt: tptr(tRef), CreatedAt: tRef, UpdatedAt: tRef,
		},
		&APICallLog{
			ID: 7, Ts: tRef, VehicleID: i64ptr(42), Service: "tesla-api",
			HTTPMethod: "GET", Endpoint: "/api/1/vehicles", StatusCode: 200,
			DurationMs: 123, ErrorMessage: sptr("none"), RateLimited: true,
			RequestBody: sptr("{}"), ResponseBody: sptr(`{"ok":true}`),
		},
		&TeslaEnergySite{
			ID: 1, EnergySiteID: 1000, ResourceType: "battery", SiteName: "Home",
			GatewayID: sptr("gw-1"), TotalPackEnergy: fptr(13500), PercentageCharged: fptr(87.5),
			BatteryType: sptr("ac_powerwall"), BackupCapable: true, StormModeEnabled: true,
			HasSolar: true, HasBattery: true, HasGrid: true, HasLoadMeter: true,
			TOUCapable: true, StormModeCapable: true, SiteInfoJSON: sptr(`{"v":1}`),
			SiteInfoFetchedAt: tptr(tRef), FetchedAt: tRef, CreatedAt: tRef, UpdatedAt: tRef,
		},
		&TeslaEnergyLiveStatus{
			ID: 1, EnergySiteID: 1000, SolarPower: fptr(2500), BatteryPower: fptr(-500),
			LoadPower: fptr(2000), GridPower: fptr(0), GridServicesPower: fptr(0),
			EnergyLeft: fptr(11000), TotalPackEnergy: fptr(13500), PercentageCharged: fptr(81.4),
			GridStatus: sptr("Active"), BackupCapable: bptr(true), StormModeActive: bptr(false),
			Timestamp: tRef, FetchedAt: tRef,
		},
		&TeslaChargingHistoryEntry{
			ID: 1, SessionID: 555, VIN: "5YJ3E1EA1PF000001", SiteLocationName: "SC Fremont",
			ChargeStartDatetime: tRef, ChargeStopDatetime: tptr(tRef.Add(time.Hour)),
			Country: sptr("US"), State: sptr("CA"), County: sptr("Alameda"), PostalCode: sptr("94538"),
			BillingType: sptr("immediate"), FeeType: sptr("charging"), CurrencyCode: sptr("USD"),
			PricingType: sptr("per_kwh"), RateBase: fptr(0.28), UsageWh: fptr(42000),
			TotalDue: fptr(11.76), HasInvoice: true, InvoiceContentID: sptr("inv-9"),
			FetchedAt: tRef, CreatedAt: tRef,
		},
		&TeslaChargingHistorySummary{
			TotalSessions: 12, TotalWh: fptr(500000), TotalSpend: fptr(140.5), AvgCostPerKWh: fptr(0.281),
		},
		&TeslaChargingSession{
			ID: 1, SessionID: 777, VIN: "5YJ3E1EA1PF000001", ChargerID: sptr("chg-1"),
			SiteLocationName: "Depot", ChargeStartDatetime: tRef, ChargeStopDatetime: tptr(tRef.Add(2 * time.Hour)),
			EnergyAddedKWh: fptr(50), PeakPowerKW: fptr(11), MaxChargeRateKW: fptr(11),
			ChargeDurationS: iptr(7200), ChargerType: sptr("ac"), CurrencyCode: sptr("USD"),
			TotalCost: fptr(15), PerKWhRate: fptr(0.3), IdleFee: fptr(0), CongestionFee: fptr(0),
			Latitude: fptr(37.5), Longitude: fptr(-122.0), FetchedAt: tRef, CreatedAt: tRef,
		},
		&TeslaChargingSessionSummary{
			TotalSessions: 5, TotalWh: fptr(250000), TotalCost: fptr(75), AvgCostPerKWh: fptr(0.3), PeakPowerKW: fptr(11),
		},
		&TeslaEnergyHistory{
			ID: 1, EnergySiteID: 1000, Period: "day", Timestamp: tRef,
			SolarEnergyWh: fptr(12000), BatteryEnergyInWh: fptr(4000), BatteryEnergyOutWh: fptr(3500),
			GridEnergyInWh: fptr(1000), GridEnergyOutWh: fptr(500), ConsumerEnergyWh: fptr(9000), FetchedAt: tRef,
		},
		&TeslaEnergyBackupEvent{
			ID: 1, EnergySiteID: 1000, Period: "day", Timestamp: tRef, DurationSeconds: 600, FetchedAt: tRef,
		},
		&TeslaEnergyWCCharging{
			ID: 1, EnergySiteID: 1000, DIN: sptr("ABC-123"), Timestamp: tRef, EnergyWh: fptr(7000), FetchedAt: tRef,
		},
		&TeslaUserConfig{
			ID: 1, ConfigType: "feature_config", Data: `{"x":true}`, FetchedAt: tRef, CreatedAt: tRef, UpdatedAt: tRef,
		},
		&TeslaUserOrder{
			ID: 1, OrderID: "RN123", Model: "Model 3", Status: "BOOKED",
			DeliveryDate: tptr(tFuture), VIN: sptr("5YJ3E1EA1PF000001"), ReferralCode: sptr("ref-1"),
			IsUpgradable: true, FetchedAt: tRef, CreatedAt: tRef, UpdatedAt: tRef,
		},
		&TeslaUserProfile{
			ID: 1, Email: "owner@example.com", FullName: "Test Owner",
			ProfileImageURL: sptr("https://example.com/a.png"), FetchedAt: tRef, CreatedAt: tRef, UpdatedAt: tRef,
		},
		&TeslaVehicleDriver{
			ID: 1, VehicleID: 2, VIN: "5YJ3E1EA1PF000001", ShareUserID: i64ptr(9),
			DriverEmail: sptr("d@example.com"), DriverName: sptr("Driver"), Role: sptr("driver"), FetchedAt: tRef,
		},
		&TeslaVehicleInvitation{
			ID: 1, VehicleID: 2, VIN: "5YJ3E1EA1PF000001", InvitationID: "inv-1",
			InviteURL: sptr("https://example.com/i"), Status: "pending", ExpiresAt: tptr(tFuture),
			CreatedBy: sptr("owner@example.com"), FetchedAt: tRef, CreatedAt: tRef,
		},
	}
}

// TestModels_JSONRoundTripStable marshals every DTO, decodes it back into a
// fresh instance of the same type, and re-marshals: the two blobs must be
// byte-identical. This catches type-mismatched tags, fields that marshal but
// fail to decode, and any drift that would break a repo Scan → handler
// Encode cycle. json:"-" fields (credentials, VIN) are absent in both blobs,
// so redaction does not break stability.
func TestModels_JSONRoundTripStable(t *testing.T) {
	t.Parallel()
	for _, sample := range modelSamples() {
		name := reflect.TypeOf(sample).Elem().Name()
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			first, err := json.Marshal(sample)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if len(first) == 0 || string(first) == "{}" {
				t.Fatalf("%s marshalled to an empty object", name)
			}
			fresh := reflect.New(reflect.TypeOf(sample).Elem()).Interface()
			if err := json.Unmarshal(first, fresh); err != nil {
				t.Fatalf("unmarshal: %v\njson=%s", err, first)
			}
			second, err := json.Marshal(fresh)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			if !bytes.Equal(first, second) {
				t.Fatalf("round-trip changed JSON:\n first=%s\nsecond=%s", first, second)
			}
		})
	}
}

var snakeCase = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)

// jsonName returns the wire name and whether the field is deliberately
// excluded (json:"-").
func jsonName(tag string) (name string, excluded bool) {
	if tag == "" {
		return "", false
	}
	name = strings.Split(tag, ",")[0]
	if name == "-" {
		return "", true
	}
	return name, false
}

// TestModels_JSONTagsSnakeCaseAndUnique enforces the repo-wide convention
// that every exported field carries an explicit snake_case json tag (or the
// "-" exclusion) and that no two fields collide on a wire key. camelCase or
// PascalCase keys would silently break the snake_case frontend contract.
func TestModels_JSONTagsSnakeCaseAndUnique(t *testing.T) {
	t.Parallel()
	for _, sample := range modelSamples() {
		typ := reflect.TypeOf(sample).Elem()
		t.Run(typ.Name(), func(t *testing.T) {
			t.Parallel()
			seen := map[string]string{}
			for i := 0; i < typ.NumField(); i++ {
				f := typ.Field(i)
				if f.PkgPath != "" {
					continue // unexported
				}
				tag, ok := f.Tag.Lookup("json")
				if !ok || tag == "" {
					t.Errorf("%s.%s missing json tag", typ.Name(), f.Name)
					continue
				}
				name, excluded := jsonName(tag)
				if excluded {
					continue
				}
				if !snakeCase.MatchString(name) {
					t.Errorf("%s.%s json tag %q is not snake_case", typ.Name(), f.Name, name)
				}
				if prev, dup := seen[name]; dup {
					t.Errorf("%s: json key %q used by both %s and %s", typ.Name(), name, prev, f.Name)
				}
				seen[name] = f.Name
			}
		})
	}
}

// TestModels_PersistenceStructsHaveDBTags enforces db-tag completeness: any
// struct that maps to a table (i.e. carries at least one db tag) must carry a
// snake_case, unique db tag on every exported field — otherwise a pgx
// named-scan would silently miss a column. Pure aggregate DTOs (the two
// summaries) carry no db tags and are correctly exempt.
func TestModels_PersistenceStructsHaveDBTags(t *testing.T) {
	t.Parallel()
	for _, sample := range modelSamples() {
		typ := reflect.TypeOf(sample).Elem()
		t.Run(typ.Name(), func(t *testing.T) {
			t.Parallel()
			hasAnyDB := false
			for i := 0; i < typ.NumField(); i++ {
				if _, ok := typ.Field(i).Tag.Lookup("db"); ok {
					hasAnyDB = true
					break
				}
			}
			if !hasAnyDB {
				return // aggregate/computed DTO — no table backing
			}
			seen := map[string]string{}
			for i := 0; i < typ.NumField(); i++ {
				f := typ.Field(i)
				if f.PkgPath != "" {
					continue
				}
				col, ok := f.Tag.Lookup("db")
				if !ok || col == "" {
					t.Errorf("%s.%s: persistence struct field missing db tag", typ.Name(), f.Name)
					continue
				}
				if !snakeCase.MatchString(col) {
					t.Errorf("%s.%s db tag %q is not snake_case", typ.Name(), f.Name, col)
				}
				if prev, dup := seen[col]; dup {
					t.Errorf("%s: db column %q used by both %s and %s", typ.Name(), col, prev, f.Name)
				}
				seen[col] = f.Name
			}
		})
	}
}

// TestModels_SensitiveFieldsNotSerialized locks in, by reflection, the exact
// set of fields that MUST stay json:"-": the two token credentials and the
// two access-control VINs. This is the structural backstop behind the
// behavioural redaction tests above — it fails the instant someone re-tags
// one of these fields onto the wire.
func TestModels_SensitiveFieldsNotSerialized(t *testing.T) {
	t.Parallel()
	sensitive := []struct {
		typ   reflect.Type
		field string
	}{
		{reflect.TypeOf(TeslaToken{}), "AccessToken"},
		{reflect.TypeOf(TeslaToken{}), "RefreshToken"},
		{reflect.TypeOf(TeslaVehicleDriver{}), "VIN"},
		{reflect.TypeOf(TeslaVehicleInvitation{}), "VIN"},
	}
	for _, s := range sensitive {
		f, ok := s.typ.FieldByName(s.field)
		if !ok {
			t.Errorf("%s has no field %s", s.typ.Name(), s.field)
			continue
		}
		if _, excluded := jsonName(f.Tag.Get("json")); !excluded {
			t.Errorf("%s.%s MUST be json:\"-\" (got tag %q)", s.typ.Name(), s.field, f.Tag.Get("json"))
		}
	}
}
