// Package climate serves GET /api/v1/climate and GET /api/v1/climate/latest
// (the climate/HVAC history and current-state endpoints consumed by the SPA)
// backed by signal.StateReader and signal.LiveStateReader.
//
// Wire-shape stability: the /api/v1/climate JSON row shape is preserved from
// the pre-carve parent-package handler, including created_at, timestamp, and
// id aliases on history rows.
//
// Climate fields change rarely once set; List relies on StateReader.Timeline
// forward-folding so stable cabin temperature and HVAC fields carry across
// sparse signal-log emissions instead of rendering blank chart rows.
//
// Layer: handler
package climate
