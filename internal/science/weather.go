package science

// AirDensityKgM3 returns dry-air density from archive temperature (°C)
// and mean-sea-level pressure (hPa). Labeled dry-air ideal gas.
func AirDensityKgM3(tempC, pressureHpa float64) float64 {
	const rDry = 287.058 // J/(kg K)
	tk := tempC + 273.15
	if tk <= 0 {
		return 0
	}
	return pressureHpa * 100 / (rDry * tk)
}

// WeatherCorrelations relates drive residual Wh/m to density and wind.
// Requires ≥5 joint points; else all correlations stay nil (unknown).
func WeatherCorrelations(density, wind, residual []float64) (densityR, windR *float64) {
	if len(density) != len(residual) || len(wind) != len(residual) || len(residual) < 5 {
		return nil, nil
	}
	if r, ok := Pearson(density, residual); ok {
		densityR = &r
	}
	if r, ok := Pearson(wind, residual); ok {
		windR = &r
	}
	return densityR, windR
}
