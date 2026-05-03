package codec

import (
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// fixed reference instants used across flatten tests so failures point at
// a single timestamp rather than time.Now drift.
var (
	fixedEmittedAt = time.Date(2025, time.March, 15, 12, 30, 45, 0, time.UTC)
	fixedVIN       = "5YJ3E1EA0KF000123"
)

// fieldNames extracts and sorts the Field column from a slice of Atomic
// for set-equality assertions. Sorting is intentional because the
// ordering of children inside a single flatten call is a private
// implementation detail of the per-compound flattener; tests assert the
// SET of names, not the order.
func fieldNames(atoms []Atomic) []string {
	names := make([]string, len(atoms))
	for i, a := range atoms {
		names[i] = a.Field
	}
	sort.Strings(names)
	return names
}

// findAtomic returns the first Atomic with the given Field, or t.Fatal's
// the test if no entry matches. Used by per-compound tests to assert
// individual values once the set-equality check has confirmed the right
// shape was produced.
func findAtomic(t *testing.T, atoms []Atomic, field string) Atomic {
	t.Helper()
	for _, a := range atoms {
		if a.Field == field {
			return a
		}
	}
	t.Fatalf("flattened atoms missing expected field %q; got %v", field, fieldNames(atoms))
	return Atomic{}
}

func TestFlattenLocation_FullyPopulated(t *testing.T) {
	loc := protomodel.Location{Latitude: 37.7749, Longitude: -122.4194}
	got := flattenLocation(loc, "Location", fixedEmittedAt, fixedVIN)

	wantNames := []string{"LocationLatitude", "LocationLongitude"}
	if !reflect.DeepEqual(fieldNames(got), wantNames) {
		t.Fatalf("flattenLocation field set = %v, want %v", fieldNames(got), wantNames)
	}

	lat := findAtomic(t, got, "LocationLatitude")
	if v, ok := lat.Value.(float64); !ok || v != 37.7749 {
		t.Errorf("LocationLatitude value = %v (%T), want float64(37.7749)", lat.Value, lat.Value)
	}
	if !lat.EmittedAt.Equal(fixedEmittedAt) {
		t.Errorf("LocationLatitude EmittedAt = %v, want %v", lat.EmittedAt, fixedEmittedAt)
	}
	if lat.VehicleID != fixedVIN {
		t.Errorf("LocationLatitude VehicleID = %q, want %q", lat.VehicleID, fixedVIN)
	}

	lng := findAtomic(t, got, "LocationLongitude")
	if v, ok := lng.Value.(float64); !ok || v != -122.4194 {
		t.Errorf("LocationLongitude value = %v (%T), want float64(-122.4194)", lng.Value, lng.Value)
	}
}

func TestFlattenLocation_FieldNamePrefixDistinguishesSources(t *testing.T) {
	loc := protomodel.Location{Latitude: 1, Longitude: 2}
	originAtoms := flattenLocation(loc, "OriginLocation", fixedEmittedAt, fixedVIN)
	destAtoms := flattenLocation(loc, "DestinationLocation", fixedEmittedAt, fixedVIN)

	wantOrigin := []string{"OriginLocationLatitude", "OriginLocationLongitude"}
	wantDest := []string{"DestinationLocationLatitude", "DestinationLocationLongitude"}
	if !reflect.DeepEqual(fieldNames(originAtoms), wantOrigin) {
		t.Errorf("OriginLocation field set = %v, want %v", fieldNames(originAtoms), wantOrigin)
	}
	if !reflect.DeepEqual(fieldNames(destAtoms), wantDest) {
		t.Errorf("DestinationLocation field set = %v, want %v", fieldNames(destAtoms), wantDest)
	}
}

func TestFlattenDoors_FullyPopulated(t *testing.T) {
	d := protomodel.Doors{
		DriverFront:    true,
		DriverRear:     false,
		PassengerFront: true,
		PassengerRear:  false,
		TrunkFront:     true,
		TrunkRear:      false,
	}
	got := flattenDoors(d, "DoorState", fixedEmittedAt, fixedVIN)

	wantNames := []string{
		"DoorStateDriverFront", "DoorStateDriverRear",
		"DoorStatePassengerFront", "DoorStatePassengerRear",
		"DoorStateTrunkFront", "DoorStateTrunkRear",
	}
	sort.Strings(wantNames)
	if !reflect.DeepEqual(fieldNames(got), wantNames) {
		t.Fatalf("flattenDoors field set = %v, want %v", fieldNames(got), wantNames)
	}

	cases := map[string]bool{
		"DoorStateDriverFront":    true,
		"DoorStateDriverRear":     false,
		"DoorStatePassengerFront": true,
		"DoorStatePassengerRear":  false,
		"DoorStateTrunkFront":     true,
		"DoorStateTrunkRear":      false,
	}
	for name, want := range cases {
		a := findAtomic(t, got, name)
		v, ok := a.Value.(bool)
		if !ok || v != want {
			t.Errorf("%s = %v (%T), want bool(%v)", name, a.Value, a.Value, want)
		}
	}
}

func TestFlattenTireLocation_FullyPopulated(t *testing.T) {
	tl := protomodel.TireLocation{
		FrontLeft:            true,
		FrontRight:           false,
		RearLeft:             true,
		RearRight:            false,
		SemiMiddleAxleLeft2:  true,
		SemiMiddleAxleRight2: false,
		SemiRearAxleLeft:     true,
		SemiRearAxleRight:    false,
		SemiRearAxleLeft2:    true,
		SemiRearAxleRight2:   false,
	}
	got := flattenTireLocation(tl, "TpmsHardWarnings", fixedEmittedAt, fixedVIN)

	wantNames := []string{
		"TpmsHardWarningsFrontLeft", "TpmsHardWarningsFrontRight",
		"TpmsHardWarningsRearLeft", "TpmsHardWarningsRearRight",
		"TpmsHardWarningsSemiMiddleAxleLeft2", "TpmsHardWarningsSemiMiddleAxleRight2",
		"TpmsHardWarningsSemiRearAxleLeft", "TpmsHardWarningsSemiRearAxleRight",
		"TpmsHardWarningsSemiRearAxleLeft2", "TpmsHardWarningsSemiRearAxleRight2",
	}
	sort.Strings(wantNames)
	if !reflect.DeepEqual(fieldNames(got), wantNames) {
		t.Fatalf("flattenTireLocation field set = %v, want %v", fieldNames(got), wantNames)
	}
	if len(got) != 10 {
		t.Errorf("flattenTireLocation produced %d atoms, want 10", len(got))
	}

	// spot-check one bool round-trips so we know the per-position struct
	// access maps to the right atomic Field name.
	fl := findAtomic(t, got, "TpmsHardWarningsFrontLeft")
	if v, ok := fl.Value.(bool); !ok || v != true {
		t.Errorf("TpmsHardWarningsFrontLeft value = %v (%T), want bool(true)", fl.Value, fl.Value)
	}
}

func TestFlattenTime_FullyPopulated(t *testing.T) {
	tv := protomodel.Time{Hour: 14, Minute: 25, Second: 33}
	got := flattenTime(tv, "ChargeStartTime", fixedEmittedAt, fixedVIN)

	if len(got) != 1 {
		t.Fatalf("flattenTime produced %d atoms, want 1", len(got))
	}
	a := got[0]
	if a.Field != "ChargeStartTime" {
		t.Errorf("flattenTime field = %q, want %q", a.Field, "ChargeStartTime")
	}
	gotTime, ok := a.Value.(time.Time)
	if !ok {
		t.Fatalf("flattenTime value type = %T, want time.Time", a.Value)
	}
	want := time.Date(
		fixedEmittedAt.Year(), fixedEmittedAt.Month(), fixedEmittedAt.Day(),
		14, 25, 33, 0, time.UTC,
	)
	if !gotTime.Equal(want) {
		t.Errorf("flattenTime time = %v, want %v", gotTime, want)
	}
}

func TestFlattenTime_ZeroEmittedAtFallsBackToEpochYear(t *testing.T) {
	tv := protomodel.Time{Hour: 1, Minute: 2, Second: 3}
	got := flattenTime(tv, "ScheduledThing", time.Time{}, fixedVIN)

	gotTime := got[0].Value.(time.Time)
	if gotTime.Year() != 1 {
		t.Errorf("zero EmittedAt should anchor to year 1, got year %d", gotTime.Year())
	}
	if gotTime.Hour() != 1 || gotTime.Minute() != 2 || gotTime.Second() != 3 {
		t.Errorf("clock components = %02d:%02d:%02d, want 01:02:03",
			gotTime.Hour(), gotTime.Minute(), gotTime.Second())
	}
}

func TestFlattenDoorStateJSON_FullyPopulated(t *testing.T) {
	payload := `{"DriverFront":true,"DriverRear":false,"PassengerFront":true,"PassengerRear":false,"FrontTrunk":true,"RearTrunk":false}`
	got, err := flattenDoorStateJSON(payload, fixedEmittedAt, fixedVIN)
	if err != nil {
		t.Fatalf("flattenDoorStateJSON unexpected err = %v", err)
	}

	wantNames := []string{
		"DoorStateDriverFront", "DoorStateDriverRear",
		"DoorStatePassengerFront", "DoorStatePassengerRear",
		"DoorStateFrontTrunk", "DoorStateRearTrunk",
	}
	sort.Strings(wantNames)
	if !reflect.DeepEqual(fieldNames(got), wantNames) {
		t.Fatalf("flattenDoorStateJSON field set = %v, want %v", fieldNames(got), wantNames)
	}

	cases := map[string]bool{
		"DoorStateDriverFront":    true,
		"DoorStateDriverRear":     false,
		"DoorStatePassengerFront": true,
		"DoorStatePassengerRear":  false,
		"DoorStateFrontTrunk":     true,
		"DoorStateRearTrunk":      false,
	}
	for name, want := range cases {
		a := findAtomic(t, got, name)
		v, ok := a.Value.(bool)
		if !ok || v != want {
			t.Errorf("%s = %v (%T), want bool(%v)", name, a.Value, a.Value, want)
		}
	}
}

func TestFlattenDoorStateJSON_MalformedReturnsError(t *testing.T) {
	_, err := flattenDoorStateJSON("not json", fixedEmittedAt, fixedVIN)
	if err == nil {
		t.Fatalf("flattenDoorStateJSON on garbage payload returned nil err")
	}
}

func TestFlattenScheduledChargingStartTimeJSON_FullyPopulated(t *testing.T) {
	payload := `{"Hour":7,"Minute":30,"Second":0}`
	got, err := flattenScheduledChargingStartTimeJSON(payload, fixedEmittedAt, fixedVIN)
	if err != nil {
		t.Fatalf("flattenScheduledChargingStartTimeJSON unexpected err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("produced %d atoms, want 1", len(got))
	}
	if got[0].Field != "ScheduledChargingStartTime" {
		t.Errorf("Field = %q, want ScheduledChargingStartTime", got[0].Field)
	}
	tm, ok := got[0].Value.(time.Time)
	if !ok {
		t.Fatalf("Value type = %T, want time.Time", got[0].Value)
	}
	if tm.Hour() != 7 || tm.Minute() != 30 || tm.Second() != 0 {
		t.Errorf("clock components = %02d:%02d:%02d, want 07:30:00",
			tm.Hour(), tm.Minute(), tm.Second())
	}
}

func TestFlattenScheduledDepartureTimeJSON_FullyPopulated(t *testing.T) {
	payload := `{"Hour":18,"Minute":15,"Second":42}`
	got, err := flattenScheduledDepartureTimeJSON(payload, fixedEmittedAt, fixedVIN)
	if err != nil {
		t.Fatalf("flattenScheduledDepartureTimeJSON unexpected err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("produced %d atoms, want 1", len(got))
	}
	if got[0].Field != "ScheduledDepartureTime" {
		t.Errorf("Field = %q, want ScheduledDepartureTime", got[0].Field)
	}
	tm, ok := got[0].Value.(time.Time)
	if !ok {
		t.Fatalf("Value type = %T, want time.Time", got[0].Value)
	}
	if tm.Hour() != 18 || tm.Minute() != 15 || tm.Second() != 42 {
		t.Errorf("clock components = %02d:%02d:%02d, want 18:15:42",
			tm.Hour(), tm.Minute(), tm.Second())
	}
}

func TestFlattenScheduledDepartureTimeJSON_MalformedReturnsError(t *testing.T) {
	_, err := flattenScheduledDepartureTimeJSON("{not json", fixedEmittedAt, fixedVIN)
	if err == nil {
		t.Fatalf("flattenScheduledDepartureTimeJSON on garbage payload returned nil err")
	}
}
