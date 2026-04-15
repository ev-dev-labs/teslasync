package dto

// DashboardStatsResponse is the API response for dashboard statistics.
type DashboardStatsResponse struct {
	TotalVehicles         int     `json:"totalVehicles"`
	TotalMiles            float64 `json:"totalMiles"`
	TotalEnergyKWh       float64 `json:"totalEnergyKwh"`
	TotalChargingSessions int     `json:"totalChargingSessions"`
	TotalTrips            int     `json:"totalTrips"`
	AvgEfficiency         float64 `json:"avgEfficiency"`
	TotalCostCents        int     `json:"totalCostCents"`
}
