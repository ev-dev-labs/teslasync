// Package climate serves climate/HVAC history and latest-state endpoints.
//
// It preserves the pre-carve JSON shape while using StateReader timeline
// forward-folding so sparse HVAC emissions do not render blank chart rows.
//
// Layer: handler
package climate
