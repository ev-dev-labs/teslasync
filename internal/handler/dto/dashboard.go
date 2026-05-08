package dto

// DashboardStatsResponse is the API response for dashboard statistics.
type DashboardStatsResponse struct {
	TotalVehicles         int     `json:"totalVehicles"`
	TotalM                float64 `json:"totalM"`
	TotalEnergyWh         float64 `json:"totalEnergyWh"`
	TotalChargingSessions int     `json:"totalChargingSessions"`
	TotalTrips            int     `json:"totalTrips"`
	AvgEfficiency         float64 `json:"avgEfficiency"`
	TotalCostCents        int     `json:"totalCostCents"`
}
