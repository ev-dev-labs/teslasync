package drive

import (
	"encoding/json"
	"strings"
	"testing"
)

type odometerScanRow struct {
	start *float64
	end   *float64
}

func (r odometerScanRow) Scan(dest ...any) error {
	*dest[22].(**float64) = r.start
	*dest[23].(**float64) = r.end
	return nil
}

func TestScanDriveOdometerEndpoints(t *testing.T) {
	zero, end := 0.0, 120040000.0
	for _, tt := range []struct {
		name  string
		start *float64
		end   *float64
	}{
		{name: "missing"},
		{name: "zero departure and recorded arrival", start: &zero, end: &end},
		{name: "in progress", start: &end},
	} {
		t.Run(tt.name, func(t *testing.T) {
			d, err := scanDrive(odometerScanRow{start: tt.start, end: tt.end})
			if err != nil {
				t.Fatal(err)
			}
			if d.StartOdometerM != tt.start || d.EndOdometerM != tt.end {
				t.Fatalf("endpoint readings changed: %#v", d)
			}
			data, err := json.Marshal(d)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(data, &fields); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"start_odometer_m", "end_odometer_m"} {
				if _, ok := fields[key]; !ok {
					t.Fatalf("missing nullable SI wire field %s", key)
				}
			}
			if tt.start == nil && string(fields["start_odometer_m"]) != "null" {
				t.Fatalf("missing departure became %s", fields["start_odometer_m"])
			}
		})
	}
	if !strings.HasSuffix(driveColumns, "start_odometer_m, end_odometer_m") {
		t.Fatal("endpoint columns must match scan order")
	}
}
