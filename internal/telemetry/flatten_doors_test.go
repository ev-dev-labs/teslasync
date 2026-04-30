package telemetry

import (
	"testing"
)

func TestFlattenDoors(t *testing.T) {
	cases := []struct {
		name     string
		in       any
		wantLen  int
		wantOpen map[string]bool
		wantErr  bool
	}{
		{
			name: "all closed",
			in: map[string]any{
				"DriverFront": "Closed", "PassengerFront": "Closed",
				"DriverRear": "Closed", "PassengerRear": "Closed",
				"FrontTrunk": "Closed", "RearTrunk": "Closed",
			},
			wantLen: 6,
			wantOpen: map[string]bool{
				"DoorState_DriverFront": false, "DoorState_PassengerFront": false,
				"DoorState_DriverRear": false, "DoorState_PassengerRear": false,
				"DoorState_FrontTrunk": false, "DoorState_RearTrunk": false,
			},
		},
		{
			name: "driver open only",
			in: map[string]any{
				"DriverFront": "Open", "PassengerFront": "Closed",
				"DriverRear": "Closed", "PassengerRear": "Closed",
				"FrontTrunk": "Closed", "RearTrunk": "Closed",
			},
			wantLen: 6,
			wantOpen: map[string]bool{
				"DoorState_DriverFront": true, "DoorState_PassengerFront": false,
				"DoorState_DriverRear": false, "DoorState_PassengerRear": false,
				"DoorState_FrontTrunk": false, "DoorState_RearTrunk": false,
			},
		},
		{
			name: "all open",
			in: map[string]any{
				"DriverFront": "Open", "PassengerFront": "Open",
				"DriverRear": "Open", "PassengerRear": "Open",
				"FrontTrunk": "Open", "RearTrunk": "Open",
			},
			wantLen: 6,
			wantOpen: map[string]bool{
				"DoorState_DriverFront": true, "DoorState_PassengerFront": true,
				"DoorState_DriverRear": true, "DoorState_PassengerRear": true,
				"DoorState_FrontTrunk": true, "DoorState_RearTrunk": true,
			},
		},
		{
			name:     "partial payload (skips absent parts)",
			in:       map[string]any{"DriverFront": "Open"},
			wantLen:  1,
			wantOpen: map[string]bool{"DoorState_DriverFront": true},
		},
		{
			name:     "empty map",
			in:       map[string]any{},
			wantLen:  0,
			wantOpen: map[string]bool{},
		},
		{
			name:    "wrong top-level type",
			in:      "Open",
			wantErr: true,
		},
		{
			name:    "wrong per-part type",
			in:      map[string]any{"DriverFront": 123},
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := flattenDoors(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if len(got) != tc.wantLen {
				t.Fatalf("len = %d, want %d (%v)", len(got), tc.wantLen, got)
			}
			for _, a := range got {
				want, ok := tc.wantOpen[a.Name]
				if !ok {
					t.Errorf("unexpected atomic %s", a.Name)
					continue
				}
				b, ok := a.Value.(bool)
				if !ok {
					t.Errorf("%s value type = %T, want bool", a.Name, a.Value)
					continue
				}
				if b != want {
					t.Errorf("%s = %v, want %v", a.Name, b, want)
				}
			}
		})
	}
}
