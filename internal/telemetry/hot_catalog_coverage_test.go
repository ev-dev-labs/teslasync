package telemetry

import (
	"sort"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// KnownColdSignals are signals deliberately routed to signal_observations
// (not promoted to typed columns). Promoting one means moving it OUT of
// this set and INTO a hot_catalog_*.go file.
//
// Alphabetized for easy review. Per ADR-009, every signal in
// enums.SignalRegistry must be either here or in HotCatalog — orphans fail
// TestHotCatalogCoverage.
var KnownColdSignals = map[string]struct{}{
	"AutoSeatClimateLeft":                       {},
	"AutoSeatClimateRight":                      {},
	"AutomaticBlindSpotCamera":                  {},
	"AutomaticEmergencyBrakingOff":              {},
	"BMSState":                                  {},
	"BatteryHeaterOn":                           {},
	"BlindSpotCollisionWarningChime":            {},
	"BmsFullchargecomplete":                     {},
	"BrakePedal":                                {},
	"BrakePedalPos":                             {},
	"BrickVoltageMax":                           {},
	"BrickVoltageMin":                           {},
	"CabinOverheatProtectionTemperatureLimit":   {},
	"CarType":                                   {},
	"CenterDisplay":                             {},
	"ChargeAmps":                                {},
	"ChargeCurrentRequest":                      {},
	"ChargeCurrentRequestMax":                   {},
	"ChargeEnableRequest":                       {},
	"ChargePort":                                {},
	"ChargePortColdWeatherMode":                 {},
	"ChargePortDoorOpen":                        {},
	"ChargePortLatch":                           {},
	"ChargingCableType":                         {},
	"ClimateKeeperMode":                         {},
	"ClimateSeatCoolingFrontLeft":               {},
	"ClimateSeatCoolingFrontRight":              {},
	"CruiseFollowDistance":                      {},
	"CruiseSetSpeed":                            {},
	"CurrentLimitMph":                           {},
	"DCDCEnable":                                {},
	"DestinationLocation":                       {},
	"DestinationName":                           {},
	"DetailedChargeState":                       {},
	"DiAxleSpeedF":                              {},
	"DiAxleSpeedR":                              {},
	"DiAxleSpeedREL":                            {},
	"DiAxleSpeedRER":                            {},
	"DiHeatsinkTF":                              {},
	"DiHeatsinkTR":                              {},
	"DiHeatsinkTREL":                            {},
	"DiHeatsinkTRER":                            {},
	"DiInverterTF":                              {},
	"DiInverterTR":                              {},
	"DiInverterTREL":                            {},
	"DiInverterTRER":                            {},
	"DiMotorCurrentF":                           {},
	"DiMotorCurrentR":                           {},
	"DiMotorCurrentREL":                         {},
	"DiMotorCurrentRER":                         {},
	"DiSlaveTorqueCmd":                          {},
	"DiStateF":                                  {},
	"DiStateR":                                  {},
	"DiStateREL":                                {},
	"DiStateRER":                                {},
	"DiStatorTempF":                             {},
	"DiStatorTempR":                             {},
	"DiStatorTempREL":                           {},
	"DiStatorTempRER":                           {},
	"DiTorqueActualF":                           {},
	"DiTorqueActualR":                           {},
	"DiTorqueActualREL":                         {},
	"DiTorqueActualRER":                         {},
	"DiTorquemotor":                             {},
	"DiVBatF":                                   {},
	"DiVBatR":                                   {},
	"DiVBatREL":                                 {},
	"DiVBatRER":                                 {},
	"DriveRail":                                 {},
	"DriverSeatBelt":                            {},
	"DriverSeatOccupied":                        {},
	"EfficiencyPackage":                         {},
	"EmergencyLaneDepartureAvoidance":           {},
	"EnergyRemaining":                           {},
	"EstBatteryRange":                           {},
	"EstimatedHoursToChargeTermination":         {},
	"EuropeVehicle":                             {},
	"ExpectedEnergyPercentAtTripArrival":        {},
	"ExteriorColor":                             {},
	"FastChargerPresent":                        {},
	"FastChargerType":                           {},
	"FdWindow":                                  {},
	"ForwardCollisionWarning":                   {},
	"FpWindow":                                  {},
	"GuestModeEnabled":                          {},
	"GuestModeMobileAccessState":                {},
	"HomelinkDeviceCount":                       {},
	"HomelinkNearby":                            {},
	"HvacACEnabled":                             {},
	"HvacFanSpeed":                              {},
	"HvacSteeringWheelHeatLevel":                {},
	"Hvil":                                      {},
	"IdealBatteryRange":                         {},
	"IsolationResistance":                       {},
	"LaneDepartureAvoidance":                    {},
	"LateralAcceleration":                       {},
	"LifetimeEnergyGainedRegen":                 {},
	"LifetimeEnergyUsed":                        {},
	"LifetimeEnergyUsedDrive":                   {},
	"LightsHazardsActive":                       {},
	"LightsHighBeams":                           {},
	"LightsTurnSignal":                          {},
	"LocatedAtFavorite":                         {},
	"LocatedAtHome":                             {},
	"LocatedAtWork":                             {},
	"LongitudinalAcceleration":                  {},
	"MediaAudioVolume":                          {},
	"MediaAudioVolumeIncrement":                 {},
	"MediaAudioVolumeMax":                       {},
	"MediaNowPlayingAlbum":                      {},
	"MediaNowPlayingArtist":                     {},
	"MediaNowPlayingDuration":                   {},
	"MediaNowPlayingElapsed":                    {},
	"MediaNowPlayingStation":                    {},
	"MediaNowPlayingTitle":                      {},
	"MediaPlaybackSource":                       {},
	"MediaPlaybackStatus":                       {},
	"MilesSinceReset":                           {},
	"MilesToArrival":                            {},
	"MinutesToArrival":                          {},
	"ModuleTempMax":                             {},
	"ModuleTempMin":                             {},
	"NotEnoughPowerToHeat":                      {},
	"NumBrickVoltageMax":                        {},
	"NumBrickVoltageMin":                        {},
	"NumModuleTempMax":                          {},
	"NumModuleTempMin":                          {},
	"Odometer":                                  {},
	"OffroadLightbarPresent":                    {},
	"OriginLocation":                            {},
	"PackCurrent":                               {},
	"PackVoltage":                               {},
	"PairedPhoneKeyAndKeyFobQty":                {},
	"PassengerSeatBelt":                         {},
	"PedalPosition":                             {},
	"PinToDriveEnabled":                         {},
	"PowershareHoursLeft":                       {},
	"PowershareInstantaneousPowerKW":            {},
	"PowershareStatus":                          {},
	"PowershareStopReason":                      {},
	"PowershareType":                            {},
	"PreconditioningEnabled":                    {},
	"RdWindow":                                  {},
	"RearDefrostEnabled":                        {},
	"RearDisplayHvacEnabled":                    {},
	"RearSeatHeaters":                           {},
	"RemoteStartEnabled":                        {},
	"RightHandDrive":                            {},
	"RoofColor":                                 {},
	"RouteLastUpdated":                          {},
	"RouteLine":                                 {},
	"RouteTrafficMinutesDelay":                  {},
	"RpWindow":                                  {},
	"ScheduledChargingMode":                     {},
	"ScheduledDepartureTime":                    {},
	"SeatHeaterRearCenter":                      {},
	"SeatVentEnabled":                           {},
	"SelfDrivingMilesSinceReset":                {},
	"ServiceMode":                               {},
	"Setting24HourTime":                         {},
	"SettingChargeUnit":                         {},
	"SettingDistanceUnit":                       {},
	"SettingTemperatureUnit":                    {},
	"SettingTirePressureUnit":                   {},
	"SoftwareUpdateDownloadPercentComplete":     {},
	"SoftwareUpdateExpectedDurationMinutes":     {},
	"SoftwareUpdateInstallationPercentComplete": {},
	"SoftwareUpdateScheduledStartTime":          {},
	"SoftwareUpdateVersion":                     {},
	"SpeedLimitMode":                            {},
	"SpeedLimitWarning":                         {},
	"SunroofInstalled":                          {},
	"SuperchargerSessionTripPlanner":            {},
	"TimeToFullCharge":                          {},
	"TonneauOpenPercent":                        {},
	"TpmsHardWarnings":                          {},
	"TpmsLastSeenPressureTimeFl":                {},
	"TpmsLastSeenPressureTimeFr":                {},
	"TpmsLastSeenPressureTimeRl":                {},
	"TpmsLastSeenPressureTimeRr":                {},
	"TpmsPressureFl":                            {},
	"TpmsPressureFr":                            {},
	"TpmsPressureRl":                            {},
	"TpmsPressureRr":                            {},
	"TpmsSoftWarnings":                          {},
	"Trim":                                      {},
	"ValetModeEnabled":                          {},
	"VehicleName":                               {},
	"WheelType":                                 {},
	"WiperHeatEnabled":                          {},
}

// TestHotCatalogCoverage asserts every signal declared in enums.SignalRegistry
// is either in HotCatalog (promoted to a typed column) or KnownColdSignals
// (deliberately routed to signal_observations). Orphans = regression.
func TestHotCatalogCoverage(t *testing.T) {
	var orphans []string
	for _, name := range enums.AllSignalNames() {
		if _, hot := HotCatalog[name]; hot {
			continue
		}
		if _, cold := KnownColdSignals[name]; cold {
			continue
		}
		orphans = append(orphans, name)
	}
	if len(orphans) > 0 {
		sort.Strings(orphans)
		t.Fatalf("orphan signals (neither hot nor explicitly cold): %v", orphans)
	}
}

// TestHotAndColdAreDisjoint asserts no signal is simultaneously hot and cold.
// Per ADR-009, KnownColdSignals must shrink (and HotCatalog grow) when a
// signal is promoted — never both at once.
func TestHotAndColdAreDisjoint(t *testing.T) {
	for name := range KnownColdSignals {
		if _, hot := HotCatalog[name]; hot {
			t.Errorf("%s is in BOTH HotCatalog and KnownColdSignals", name)
		}
	}
}
