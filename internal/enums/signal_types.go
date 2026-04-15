// Package enums — signal type registry derived from Tesla Fleet Telemetry proto.
// Source: github.com/teslamotors/fleet-telemetry/protos (vehicle_data.proto)
//
// When Tesla adds new signals, run: go get -u github.com/teslamotors/fleet-telemetry
// Then update this file if new compound/enum types are introduced.
package enums

import (
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
)

// SignalType classifies how a telemetry signal value should be parsed.
type SignalType int

const (
	// TypeFloat — numeric signal (float64, int, or double).
	TypeFloat SignalType = iota
	// TypeBool — boolean signal.
	TypeBool
	// TypeString — string signal (names, versions, etc.).
	TypeString
	// TypeEnum — Tesla-specific enum (arrives as prefixed string like "SentryModeStateArmed").
	TypeEnum
	// TypeLocation — compound LocationValue {latitude, longitude}.
	TypeLocation
	// TypeDoors — compound Doors message {DriverFront, DriverRear, ...}.
	TypeDoors
	// TypeTireLocation — compound TireLocation message.
	TypeTireLocation
	// TypeTime — compound Time message {hour, minute, second}.
	TypeTime
	// TypeRoute — RouteLine (encoded polyline string or complex object).
	TypeRoute
)

// SignalInfo holds the type classification and proto field ID for a signal.
type SignalInfo struct {
	Type    SignalType
	FieldID ftproto.Field
}

// SignalRegistry maps every subscribed Tesla signal name to its type and proto field ID.
// This is the single source of truth for signal type information in the app.
var SignalRegistry = map[string]SignalInfo{
	// ── Charging (numeric) ──────────────────────────────────────────
	"ACChargingEnergyIn":              {TypeFloat, ftproto.Field_ACChargingEnergyIn},
	"ACChargingPower":                 {TypeFloat, ftproto.Field_ACChargingPower},
	"BatteryLevel":                    {TypeFloat, ftproto.Field_BatteryLevel},
	"BatteryHeaterOn":                 {TypeBool, ftproto.Field_BatteryHeaterOn},
	"BmsFullchargecomplete":           {TypeBool, ftproto.Field_BmsFullchargecomplete},
	"BrickVoltageMax":                 {TypeFloat, ftproto.Field_BrickVoltageMax},
	"BrickVoltageMin":                 {TypeFloat, ftproto.Field_BrickVoltageMin},
	"ChargeAmps":                      {TypeFloat, ftproto.Field_ChargeAmps},
	"ChargeCurrentRequest":            {TypeFloat, ftproto.Field_ChargeCurrentRequest},
	"ChargeCurrentRequestMax":         {TypeFloat, ftproto.Field_ChargeCurrentRequestMax},
	"ChargeEnableRequest":             {TypeBool, ftproto.Field_ChargeEnableRequest},
	"ChargeLimitSoc":                  {TypeFloat, ftproto.Field_ChargeLimitSoc},
	"ChargePortColdWeatherMode":       {TypeBool, ftproto.Field_ChargePortColdWeatherMode},
	"ChargePortDoorOpen":              {TypeBool, ftproto.Field_ChargePortDoorOpen},
	"ChargeRateMilePerHour":           {TypeFloat, ftproto.Field_ChargeRateMilePerHour},
	"ChargerPhases":                   {TypeFloat, ftproto.Field_ChargerPhases},
	"ChargerVoltage":                  {TypeFloat, ftproto.Field_ChargerVoltage},
	"DCChargingEnergyIn":              {TypeFloat, ftproto.Field_DCChargingEnergyIn},
	"DCChargingPower":                 {TypeFloat, ftproto.Field_DCChargingPower},
	"DCDCEnable":                      {TypeBool, ftproto.Field_DCDCEnable},
	"EnergyRemaining":                 {TypeFloat, ftproto.Field_EnergyRemaining},
	"EstBatteryRange":                 {TypeFloat, ftproto.Field_EstBatteryRange},
	"EstimatedHoursToChargeTermination": {TypeFloat, ftproto.Field_EstimatedHoursToChargeTermination},
	"ExpectedEnergyPercentAtTripArrival": {TypeFloat, ftproto.Field_ExpectedEnergyPercentAtTripArrival},
	"FastChargerPresent":              {TypeBool, ftproto.Field_FastChargerPresent},
	"IdealBatteryRange":               {TypeFloat, ftproto.Field_IdealBatteryRange},
	"LifetimeEnergyUsed":              {TypeFloat, ftproto.Field_LifetimeEnergyUsed},
	"ModuleTempMax":                   {TypeFloat, ftproto.Field_ModuleTempMax},
	"ModuleTempMin":                   {TypeFloat, ftproto.Field_ModuleTempMin},
	"NotEnoughPowerToHeat":            {TypeBool, ftproto.Field_NotEnoughPowerToHeat},
	"NumBrickVoltageMax":              {TypeFloat, ftproto.Field_NumBrickVoltageMax},
	"NumBrickVoltageMin":              {TypeFloat, ftproto.Field_NumBrickVoltageMin},
	"NumModuleTempMax":                {TypeFloat, ftproto.Field_NumModuleTempMax},
	"NumModuleTempMin":                {TypeFloat, ftproto.Field_NumModuleTempMin},
	"PackCurrent":                     {TypeFloat, ftproto.Field_PackCurrent},
	"PackVoltage":                     {TypeFloat, ftproto.Field_PackVoltage},
	"PreconditioningEnabled":          {TypeBool, ftproto.Field_PreconditioningEnabled},
	"RatedRange":                      {TypeFloat, ftproto.Field_RatedRange},
	"Soc":                             {TypeFloat, ftproto.Field_Soc},
	"SuperchargerSessionTripPlanner":  {TypeBool, ftproto.Field_SuperchargerSessionTripPlanner},
	"TimeToFullCharge":                {TypeFloat, ftproto.Field_TimeToFullCharge},

	// ── Charging (enums) ────────────────────────────────────────────
	"BMSState":                        {TypeEnum, ftproto.Field_BMSState},
	"ChargePort":                      {TypeEnum, ftproto.Field_ChargePort},
	"ChargePortLatch":                 {TypeEnum, ftproto.Field_ChargePortLatch},
	"ChargeState":                     {TypeEnum, ftproto.Field_ChargeState},
	"ChargingCableType":               {TypeEnum, ftproto.Field_ChargingCableType},
	"DetailedChargeState":             {TypeEnum, ftproto.Field_DetailedChargeState},
	"FastChargerType":                 {TypeEnum, ftproto.Field_FastChargerType},
	"ScheduledChargingMode":           {TypeEnum, ftproto.Field_ScheduledChargingMode},
	"ScheduledChargingPending":        {TypeBool, ftproto.Field_ScheduledChargingPending},
	"ScheduledChargingStartTime":      {TypeTime, ftproto.Field_ScheduledChargingStartTime},
	"ScheduledDepartureTime":          {TypeTime, ftproto.Field_ScheduledDepartureTime},

	// ── Powershare ──────────────────────────────────────────────────
	"PowershareHoursLeft":             {TypeFloat, ftproto.Field_PowershareHoursLeft},
	"PowershareInstantaneousPowerKW":  {TypeFloat, ftproto.Field_PowershareInstantaneousPowerKW},
	"PowershareStatus":                {TypeEnum, ftproto.Field_PowershareStatus},
	"PowershareStopReason":            {TypeEnum, ftproto.Field_PowershareStopReason},
	"PowershareType":                  {TypeEnum, ftproto.Field_PowershareType},

	// ── Climate ─────────────────────────────────────────────────────
	"AutoSeatClimateLeft":             {TypeBool, ftproto.Field_AutoSeatClimateLeft},
	"AutoSeatClimateRight":            {TypeBool, ftproto.Field_AutoSeatClimateRight},
	"CabinOverheatProtectionMode":     {TypeEnum, ftproto.Field_CabinOverheatProtectionMode},
	"CabinOverheatProtectionTemperatureLimit": {TypeEnum, ftproto.Field_CabinOverheatProtectionTemperatureLimit},
	"ClimateKeeperMode":               {TypeEnum, ftproto.Field_ClimateKeeperMode},
	"ClimateSeatCoolingFrontLeft":      {TypeFloat, ftproto.Field_ClimateSeatCoolingFrontLeft},
	"ClimateSeatCoolingFrontRight":     {TypeFloat, ftproto.Field_ClimateSeatCoolingFrontRight},
	"DefrostForPreconditioning":       {TypeBool, ftproto.Field_DefrostForPreconditioning},
	"DefrostMode":                     {TypeEnum, ftproto.Field_DefrostMode},
	"HvacACEnabled":                   {TypeBool, ftproto.Field_HvacACEnabled},
	"HvacAutoMode":                    {TypeEnum, ftproto.Field_HvacAutoMode},
	"HvacFanSpeed":                    {TypeFloat, ftproto.Field_HvacFanSpeed},
	"HvacFanStatus":                   {TypeFloat, ftproto.Field_HvacFanStatus},
	"HvacLeftTemperatureRequest":      {TypeFloat, ftproto.Field_HvacLeftTemperatureRequest},
	"HvacPower":                       {TypeEnum, ftproto.Field_HvacPower},
	"HvacRightTemperatureRequest":     {TypeFloat, ftproto.Field_HvacRightTemperatureRequest},
	"HvacSteeringWheelHeatAuto":       {TypeBool, ftproto.Field_HvacSteeringWheelHeatAuto},
	"HvacSteeringWheelHeatLevel":      {TypeFloat, ftproto.Field_HvacSteeringWheelHeatLevel},
	"InsideTemp":                      {TypeFloat, ftproto.Field_InsideTemp},
	"OutsideTemp":                     {TypeFloat, ftproto.Field_OutsideTemp},
	"RearDefrostEnabled":              {TypeBool, ftproto.Field_RearDefrostEnabled},
	"RearDisplayHvacEnabled":          {TypeBool, ftproto.Field_RearDisplayHvacEnabled},
	"SeatHeaterLeft":                  {TypeFloat, ftproto.Field_SeatHeaterLeft},
	"SeatHeaterRearCenter":            {TypeFloat, ftproto.Field_SeatHeaterRearCenter},
	"SeatHeaterRearLeft":              {TypeFloat, ftproto.Field_SeatHeaterRearLeft},
	"SeatHeaterRearRight":             {TypeFloat, ftproto.Field_SeatHeaterRearRight},
	"SeatHeaterRight":                 {TypeFloat, ftproto.Field_SeatHeaterRight},
	"SeatVentEnabled":                 {TypeBool, ftproto.Field_SeatVentEnabled},
	"WiperHeatEnabled":                {TypeBool, ftproto.Field_WiperHeatEnabled},

	// ── Driving ─────────────────────────────────────────────────────
	"BrakePedal":                      {TypeFloat, ftproto.Field_BrakePedal},
	"BrakePedalPos":                   {TypeFloat, ftproto.Field_BrakePedalPos},
	"CruiseSetSpeed":                  {TypeFloat, ftproto.Field_CruiseSetSpeed},
	"DriveRail":                       {TypeFloat, ftproto.Field_DriveRail},
	"Gear":                            {TypeEnum, ftproto.Field_Gear},
	"LateralAcceleration":             {TypeFloat, ftproto.Field_LateralAcceleration},
	"LifetimeEnergyGainedRegen":       {TypeFloat, ftproto.Field_LifetimeEnergyGainedRegen},
	"LifetimeEnergyUsedDrive":         {TypeFloat, ftproto.Field_LifetimeEnergyUsedDrive},
	"LongitudinalAcceleration":        {TypeFloat, ftproto.Field_LongitudinalAcceleration},
	"PedalPosition":                   {TypeFloat, ftproto.Field_PedalPosition},
	"RouteTrafficMinutesDelay":        {TypeFloat, ftproto.Field_RouteTrafficMinutesDelay},
	"VehicleSpeed":                    {TypeFloat, ftproto.Field_VehicleSpeed},

	// ── Powertrain ──────────────────────────────────────────────────
	"DiAxleSpeedF":                    {TypeFloat, ftproto.Field_DiAxleSpeedF},
	"DiAxleSpeedR":                    {TypeFloat, ftproto.Field_DiAxleSpeedR},
	"DiAxleSpeedREL":                  {TypeFloat, ftproto.Field_DiAxleSpeedREL},
	"DiAxleSpeedRER":                  {TypeFloat, ftproto.Field_DiAxleSpeedRER},
	"DiHeatsinkTF":                    {TypeFloat, ftproto.Field_DiHeatsinkTF},
	"DiHeatsinkTR":                    {TypeFloat, ftproto.Field_DiHeatsinkTR},
	"DiHeatsinkTREL":                  {TypeFloat, ftproto.Field_DiHeatsinkTREL},
	"DiHeatsinkTRER":                  {TypeFloat, ftproto.Field_DiHeatsinkTRER},
	"DiInverterTF":                    {TypeFloat, ftproto.Field_DiInverterTF},
	"DiInverterTR":                    {TypeFloat, ftproto.Field_DiInverterTR},
	"DiInverterTREL":                  {TypeFloat, ftproto.Field_DiInverterTREL},
	"DiInverterTRER":                  {TypeFloat, ftproto.Field_DiInverterTRER},
	"DiMotorCurrentF":                 {TypeFloat, ftproto.Field_DiMotorCurrentF},
	"DiMotorCurrentR":                 {TypeFloat, ftproto.Field_DiMotorCurrentR},
	"DiMotorCurrentREL":               {TypeFloat, ftproto.Field_DiMotorCurrentREL},
	"DiMotorCurrentRER":               {TypeFloat, ftproto.Field_DiMotorCurrentRER},
	"DiSlaveTorqueCmd":                {TypeFloat, ftproto.Field_DiSlaveTorqueCmd},
	"DiStateF":                        {TypeEnum, ftproto.Field_DiStateF},
	"DiStateR":                        {TypeEnum, ftproto.Field_DiStateR},
	"DiStateREL":                      {TypeEnum, ftproto.Field_DiStateREL},
	"DiStateRER":                      {TypeEnum, ftproto.Field_DiStateRER},
	"DiStatorTempF":                   {TypeFloat, ftproto.Field_DiStatorTempF},
	"DiStatorTempR":                   {TypeFloat, ftproto.Field_DiStatorTempR},
	"DiStatorTempREL":                 {TypeFloat, ftproto.Field_DiStatorTempREL},
	"DiStatorTempRER":                 {TypeFloat, ftproto.Field_DiStatorTempRER},
	"DiTorqueActualF":                 {TypeFloat, ftproto.Field_DiTorqueActualF},
	"DiTorqueActualR":                 {TypeFloat, ftproto.Field_DiTorqueActualR},
	"DiTorqueActualREL":               {TypeFloat, ftproto.Field_DiTorqueActualREL},
	"DiTorqueActualRER":               {TypeFloat, ftproto.Field_DiTorqueActualRER},
	"DiTorquemotor":                   {TypeFloat, ftproto.Field_DiTorquemotor},
	"DiVBatF":                         {TypeFloat, ftproto.Field_DiVBatF},
	"DiVBatR":                         {TypeFloat, ftproto.Field_DiVBatR},
	"DiVBatREL":                       {TypeFloat, ftproto.Field_DiVBatREL},
	"DiVBatRER":                       {TypeFloat, ftproto.Field_DiVBatRER},
	"Hvil":                            {TypeEnum, ftproto.Field_Hvil},
	"IsolationResistance":             {TypeFloat, ftproto.Field_IsolationResistance},

	// ── Location ────────────────────────────────────────────────────
	"DestinationLocation":             {TypeLocation, ftproto.Field_DestinationLocation},
	"DestinationName":                 {TypeString, ftproto.Field_DestinationName},
	"GpsHeading":                      {TypeFloat, ftproto.Field_GpsHeading},
	"GpsState":                        {TypeString, ftproto.Field_GpsState},
	"LocatedAtFavorite":               {TypeBool, ftproto.Field_LocatedAtFavorite},
	"LocatedAtHome":                   {TypeBool, ftproto.Field_LocatedAtHome},
	"LocatedAtWork":                   {TypeBool, ftproto.Field_LocatedAtWork},
	"Location":                        {TypeLocation, ftproto.Field_Location},
	"MilesToArrival":                  {TypeFloat, ftproto.Field_MilesToArrival},
	"MinutesToArrival":                {TypeFloat, ftproto.Field_MinutesToArrival},
	"OriginLocation":                  {TypeLocation, ftproto.Field_OriginLocation},
	"RouteLine":                       {TypeRoute, ftproto.Field_RouteLine},
	"RouteLastUpdated":                {TypeString, ftproto.Field_RouteLastUpdated},

	// ── Media ───────────────────────────────────────────────────────
	"MediaAudioVolume":                {TypeFloat, ftproto.Field_MediaAudioVolume},
	"MediaAudioVolumeIncrement":       {TypeFloat, ftproto.Field_MediaAudioVolumeIncrement},
	"MediaAudioVolumeMax":             {TypeFloat, ftproto.Field_MediaAudioVolumeMax},
	"MediaNowPlayingAlbum":            {TypeString, ftproto.Field_MediaNowPlayingAlbum},
	"MediaNowPlayingArtist":           {TypeString, ftproto.Field_MediaNowPlayingArtist},
	"MediaNowPlayingDuration":         {TypeFloat, ftproto.Field_MediaNowPlayingDuration},
	"MediaNowPlayingElapsed":          {TypeFloat, ftproto.Field_MediaNowPlayingElapsed},
	"MediaNowPlayingStation":          {TypeString, ftproto.Field_MediaNowPlayingStation},
	"MediaNowPlayingTitle":            {TypeString, ftproto.Field_MediaNowPlayingTitle},
	"MediaPlaybackSource":             {TypeString, ftproto.Field_MediaPlaybackSource},
	"MediaPlaybackStatus":             {TypeEnum, ftproto.Field_MediaPlaybackStatus},

	// ── Safety ──────────────────────────────────────────────────────
	"AutomaticBlindSpotCamera":        {TypeBool, ftproto.Field_AutomaticBlindSpotCamera},
	"AutomaticEmergencyBrakingOff":    {TypeBool, ftproto.Field_AutomaticEmergencyBrakingOff},
	"BlindSpotCollisionWarningChime":  {TypeBool, ftproto.Field_BlindSpotCollisionWarningChime},
	"CruiseFollowDistance":            {TypeEnum, ftproto.Field_CruiseFollowDistance},
	"DriverSeatBelt":                  {TypeEnum, ftproto.Field_DriverSeatBelt},
	"EmergencyLaneDepartureAvoidance": {TypeBool, ftproto.Field_EmergencyLaneDepartureAvoidance},
	"ForwardCollisionWarning":         {TypeEnum, ftproto.Field_ForwardCollisionWarning},
	"LaneDepartureAvoidance":          {TypeEnum, ftproto.Field_LaneDepartureAvoidance},
	"Locked":                          {TypeBool, ftproto.Field_Locked},
	"MilesSinceReset":                 {TypeFloat, ftproto.Field_MilesSinceReset},
	"PassengerSeatBelt":               {TypeEnum, ftproto.Field_PassengerSeatBelt},
	"PinToDriveEnabled":               {TypeBool, ftproto.Field_PinToDriveEnabled},
	"SelfDrivingMilesSinceReset":      {TypeFloat, ftproto.Field_SelfDrivingMilesSinceReset},
	"SpeedLimitWarning":               {TypeEnum, ftproto.Field_SpeedLimitWarning},

	// ── Service / TPMS ──────────────────────────────────────────────
	"TpmsHardWarnings":                {TypeTireLocation, ftproto.Field_TpmsHardWarnings},
	"TpmsLastSeenPressureTimeFl":      {TypeFloat, ftproto.Field_TpmsLastSeenPressureTimeFl},
	"TpmsLastSeenPressureTimeFr":      {TypeFloat, ftproto.Field_TpmsLastSeenPressureTimeFr},
	"TpmsLastSeenPressureTimeRl":      {TypeFloat, ftproto.Field_TpmsLastSeenPressureTimeRl},
	"TpmsLastSeenPressureTimeRr":      {TypeFloat, ftproto.Field_TpmsLastSeenPressureTimeRr},
	"TpmsPressureFl":                  {TypeFloat, ftproto.Field_TpmsPressureFl},
	"TpmsPressureFr":                  {TypeFloat, ftproto.Field_TpmsPressureFr},
	"TpmsPressureRl":                  {TypeFloat, ftproto.Field_TpmsPressureRl},
	"TpmsPressureRr":                  {TypeFloat, ftproto.Field_TpmsPressureRr},
	"TpmsSoftWarnings":                {TypeTireLocation, ftproto.Field_TpmsSoftWarnings},

	// ── Vehicle State ───────────────────────────────────────────────
	"CenterDisplay":                   {TypeEnum, ftproto.Field_CenterDisplay},
	"CurrentLimitMph":                 {TypeFloat, ftproto.Field_CurrentLimitMph},
	"DoorState":                       {TypeDoors, ftproto.Field_DoorState},
	"DriverSeatOccupied":              {TypeBool, ftproto.Field_DriverSeatOccupied},
	"FdWindow":                        {TypeEnum, ftproto.Field_FdWindow},
	"FpWindow":                        {TypeEnum, ftproto.Field_FpWindow},
	"GuestModeEnabled":                {TypeBool, ftproto.Field_GuestModeEnabled},
	"GuestModeMobileAccessState":      {TypeEnum, ftproto.Field_GuestModeMobileAccessState},
	"HomelinkDeviceCount":             {TypeFloat, ftproto.Field_HomelinkDeviceCount},
	"HomelinkNearby":                  {TypeBool, ftproto.Field_HomelinkNearby},
	"LightsHazardsActive":             {TypeBool, ftproto.Field_LightsHazardsActive},
	"LightsHighBeams":                 {TypeBool, ftproto.Field_LightsHighBeams},
	"LightsTurnSignal":                {TypeEnum, ftproto.Field_LightsTurnSignal},
	"Odometer":                        {TypeFloat, ftproto.Field_Odometer},
	"PairedPhoneKeyAndKeyFobQty":      {TypeFloat, ftproto.Field_PairedPhoneKeyAndKeyFobQty},
	"RdWindow":                        {TypeEnum, ftproto.Field_RdWindow},
	"RpWindow":                        {TypeEnum, ftproto.Field_RpWindow},
	"SentryMode":                      {TypeEnum, ftproto.Field_SentryMode},
	"ServiceMode":                     {TypeBool, ftproto.Field_ServiceMode},
	"SpeedLimitMode":                  {TypeBool, ftproto.Field_SpeedLimitMode},
	"SoftwareUpdateDownloadPercentComplete":      {TypeFloat, ftproto.Field_SoftwareUpdateDownloadPercentComplete},
	"SoftwareUpdateExpectedDurationMinutes":      {TypeFloat, ftproto.Field_SoftwareUpdateExpectedDurationMinutes},
	"SoftwareUpdateInstallationPercentComplete":  {TypeFloat, ftproto.Field_SoftwareUpdateInstallationPercentComplete},
	"SoftwareUpdateScheduledStartTime":           {TypeString, ftproto.Field_SoftwareUpdateScheduledStartTime},
	"SoftwareUpdateVersion":                      {TypeString, ftproto.Field_SoftwareUpdateVersion},
	"TonneauOpenPercent":              {TypeFloat, ftproto.Field_TonneauOpenPercent},
	"TonneauPosition":                 {TypeEnum, ftproto.Field_TonneauPosition},
	"TonneauTentMode":                 {TypeEnum, ftproto.Field_TonneauTentMode},
	"ValetModeEnabled":                {TypeBool, ftproto.Field_ValetModeEnabled},

	// ── Vehicle Configuration ───────────────────────────────────────
	"CarType":                         {TypeEnum, ftproto.Field_CarType},
	"EfficiencyPackage":               {TypeString, ftproto.Field_EfficiencyPackage},
	"EuropeVehicle":                   {TypeBool, ftproto.Field_EuropeVehicle},
	"ExteriorColor":                   {TypeString, ftproto.Field_ExteriorColor},
	"OffroadLightbarPresent":          {TypeBool, ftproto.Field_OffroadLightbarPresent},
	"RearSeatHeaters":                 {TypeFloat, ftproto.Field_RearSeatHeaters},
	"RemoteStartEnabled":              {TypeBool, ftproto.Field_RemoteStartEnabled},
	"RightHandDrive":                  {TypeBool, ftproto.Field_RightHandDrive},
	"RoofColor":                       {TypeString, ftproto.Field_RoofColor},
	"SunroofInstalled":                {TypeEnum, ftproto.Field_SunroofInstalled},
	"Trim":                            {TypeString, ftproto.Field_Trim},
	"VehicleName":                     {TypeString, ftproto.Field_VehicleName},
	"Version":                         {TypeString, ftproto.Field_Version},
	"WheelType":                       {TypeString, ftproto.Field_WheelType},

	// ── User Preferences ────────────────────────────────────────────
	"Setting24HourTime":               {TypeBool, ftproto.Field_Setting24HourTime},
	"SettingChargeUnit":               {TypeEnum, ftproto.Field_SettingChargeUnit},
	"SettingDistanceUnit":             {TypeEnum, ftproto.Field_SettingDistanceUnit},
	"SettingTemperatureUnit":          {TypeEnum, ftproto.Field_SettingTemperatureUnit},
	"SettingTirePressureUnit":         {TypeEnum, ftproto.Field_SettingTirePressureUnit},
}

// IsCompoundSignal returns true if the signal is a compound type (Location, Doors, etc.)
// that arrives as a nested JSON object rather than a flat value.
func IsCompoundSignal(name string) bool {
	info, ok := SignalRegistry[name]
	if !ok {
		return false
	}
	switch info.Type {
	case TypeLocation, TypeDoors, TypeTireLocation, TypeRoute, TypeTime:
		return true
	}
	return false
}

// IsEnumSignal returns true if the signal arrives as a Tesla enum string.
func IsEnumSignal(name string) bool {
	info, ok := SignalRegistry[name]
	return ok && info.Type == TypeEnum
}

// IsLocationSignal returns true if the signal is a LocationValue compound type.
func IsLocationSignal(name string) bool {
	info, ok := SignalRegistry[name]
	return ok && info.Type == TypeLocation
}

// GetSignalType returns the type classification for a signal, or TypeString as fallback.
func GetSignalType(name string) SignalType {
	info, ok := SignalRegistry[name]
	if !ok {
		return TypeString
	}
	return info.Type
}

// ProtoFieldID returns the Tesla proto field ID for a signal name, or Field_Unknown.
func ProtoFieldID(name string) ftproto.Field {
	info, ok := SignalRegistry[name]
	if !ok {
		return ftproto.Field_Unknown
	}
	return info.FieldID
}
