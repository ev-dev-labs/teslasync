package teslausage

import "testing"

func TestAuditServiceDistinguishesProxyFromFleet(t *testing.T) {
	base := "https://fleet-api.prd.na.vn.cloud.tesla.com"
	for _, tc := range []struct {
		request, want string
	}{
		{base + "/api/1/vehicles/1/vehicle_data", "tesla-api"},
		{"/api/1/vehicles/1/wake_up", "tesla-api"},
		{"https://proxy.example.test/api/1/vehicles/1/command/door_lock", "tesla-command-proxy"},
	} {
		if got := AuditService(base, tc.request); got != tc.want {
			t.Errorf("AuditService(%q) = %q, want %q", tc.request, got, tc.want)
		}
	}
}
