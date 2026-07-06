// Package units normalises Tesla vehicle-reported measurements — whose wire
// units follow the car's SettingDistanceUnit / SettingTemperatureUnit /
// SettingTirePressureUnit — into this legacy path's canonical display units:
// miles, mph, Celsius and PSI. It also exposes GetUnitFromSnapshot for
// reading a unit preference out of a signal snapshot map.
//
// These are NOT SI conversions. Canonical SI normalisation for the Phase-42
// telemetry pipeline lives in internal/tesla/units (meters, m/s, Pascals);
// prefer that package for any new ingest-path code.
//
// Layer: platform
package units
