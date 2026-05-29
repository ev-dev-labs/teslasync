// Package costforecast hosts the energy cost-forecast HTTP handler and the
// production forecast.CostForecaster adapter used by the AI narration tools.
//
// Both call sites share the package-level ComputeCostForecast helper so the
// REST chart and the AI surface are grounded in the SAME deterministic model.
//
// Layer: handler
package costforecast
