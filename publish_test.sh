#!/bin/sh
MQTT_API="http://mqtt-emqx.mqtt.svc.cluster.local:18083/api/v5/publish"
AUTH="Authorization: Basic YWRtaW46cHVibGlj"
VIN="7SAYGDEF7PF924551"

pub() {
  wget -qO- --post-data="{\"topic\":\"telemetry/$VIN/v/$1\",\"payload\":\"$2\",\"qos\":1}" --header="Content-Type: application/json" --header="$AUTH" "$MQTT_API" 2>/dev/null && echo "OK: $1" || echo "FAIL: $1"
}

pub BatteryLevel 80
pub Soc 80.5
pub ChargeAmps 32
pub ChargerVoltage 240.5
pub ChargeRateMilePerHour 30.5
pub ACChargingPower 7.68
pub EstBatteryRange 250.3
pub IdealBatteryRange 280.1
pub RatedRange 260.0
pub EnergyRemaining 55.2
pub PackVoltage 390.5
pub TimeToFullCharge 2.5
pub InsideTemp 22.5
pub OutsideTemp 18.3
pub HvacFanSpeed 3
pub Locked true
pub SentryMode true
pub TpmsPressureFl 2.9
pub TpmsPressureFr 3.0
pub TpmsPressureRl 2.85
pub TpmsPressureRr 2.95
pub Odometer 15234.5
