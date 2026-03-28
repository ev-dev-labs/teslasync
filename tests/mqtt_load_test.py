#!/usr/bin/env python3
"""
MQTT Fleet Telemetry Load Test for TeslaSync

Publishes 1 million dummy telemetry events to the local Mosquitto broker,
simulating fleet-telemetry's MQTT topic format: telemetry/{VIN}/v/{SignalName}.

Signals are sourced from Tesla's fleet-telemetry vehicle_data.proto definitions.

Usage:
    python tests/mqtt_load_test.py [--messages 1000000] [--vins 5] [--host localhost] [--port 1883]
"""

import argparse
import json
import math
import random
import string
import sys
import time
from collections import defaultdict

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Signal definitions based on teslamotors/fleet-telemetry vehicle_data.proto
# Each entry: (signal_name, generator_function)
# ---------------------------------------------------------------------------

def _lat():
    return round(random.uniform(25.0, 48.0), 6)    # continental US range

def _lon():
    return round(random.uniform(-124.0, -71.0), 6)

def _speed():
    return round(random.uniform(0, 130), 1)         # km/h

def _soc():
    return random.randint(5, 100)                    # state of charge %

def _battery_level():
    return random.randint(5, 100)

def _odometer():
    return round(random.uniform(100, 200000), 1)     # miles

def _voltage():
    return round(random.uniform(340, 410), 2)        # pack voltage

def _current():
    return round(random.uniform(-300, 300), 1)       # pack current amps

def _temp():
    return round(random.uniform(-20, 45), 1)         # celsius

def _tpms():
    return round(random.uniform(2.0, 3.5), 2)        # bar

def _power():
    return round(random.uniform(-100, 300), 1)       # kW

def _heading():
    return round(random.uniform(0, 360), 1)

def _bool():
    return random.choice([True, False])

def _gear():
    return random.choice(["P", "R", "N", "D"])

def _charge_state():
    return random.choice(["Disconnected", "Charging", "Complete", "Stopped"])

def _range():
    return round(random.uniform(50, 400), 1)         # miles


SIGNALS = [
    # Location & Navigation
    ("Latitude", _lat),
    ("Longitude", _lon),
    ("GpsHeading", _heading),
    ("GpsState", lambda: random.choice(["GPSValid", "GPSInvalid"])),
    ("VehicleSpeed", _speed),
    ("Odometer", _odometer),
    ("Gear", _gear),

    # Battery & Power
    ("PackVoltage", _voltage),
    ("PackCurrent", _current),
    ("PackPower", _power),
    ("Soc", _soc),
    ("BatteryLevel", _battery_level),
    ("EstBatteryRange", _range),
    ("IdealBatteryRange", _range),
    ("EnergyRemaining", lambda: round(random.uniform(10, 80), 1)),

    # Charging
    ("ChargeState", _charge_state),
    ("DetailedChargeState", _charge_state),
    ("ChargeAmps", lambda: random.randint(0, 48)),
    ("ChargerVoltage", lambda: random.choice([0, 120, 240, 277, 480])),
    ("ChargerPhases", lambda: random.choice([0, 1, 2, 3])),
    ("ChargeLimitSoc", lambda: random.choice([50, 70, 80, 90, 100])),
    ("ChargeCurrentRequest", lambda: random.randint(0, 48)),
    ("ChargeRateMilePerHour", lambda: round(random.uniform(0, 44), 1)),
    ("DCChargingPower", _power),
    ("ACChargingPower", lambda: round(random.uniform(0, 19.2), 1)),
    ("FastChargerPresent", _bool),
    ("FastChargerType", lambda: random.choice(["", "Tesla", "CCS", "CHAdeMO"])),
    ("ChargingCableType", lambda: random.choice(["IEC", "SAE", "GB_AC", "GB_DC"])),
    ("TimeToFullCharge", lambda: round(random.uniform(0, 12), 2)),
    ("DCChargingEnergyIn", lambda: round(random.uniform(0, 80), 2)),
    ("ACChargingEnergyIn", lambda: round(random.uniform(0, 80), 2)),
    ("BatteryHeaterOn", _bool),

    # Climate
    ("InsideTemp", _temp),
    ("OutsideTemp", _temp),
    ("HvacPower", lambda: round(random.uniform(0, 6), 1)),
    ("HvacFanSpeed", lambda: random.randint(0, 10)),
    ("HvacLeftTemperatureRequest", lambda: round(random.uniform(16, 28), 1)),
    ("HvacRightTemperatureRequest", lambda: round(random.uniform(16, 28), 1)),
    ("CabinOverheatProtectionMode", lambda: random.choice(["Off", "On", "FanOnly"])),
    ("DefrostMode", lambda: random.choice(["Off", "Normal", "Max"])),
    ("PreconditioningEnabled", _bool),

    # Vehicle State
    ("Locked", _bool),
    ("DoorState", lambda: random.choice(["Closed", "DriverOpen", "PassengerOpen"])),
    ("FdWindow", lambda: random.choice(["Closed", "Open", "PartiallyOpen"])),
    ("FpWindow", lambda: random.choice(["Closed", "Open", "PartiallyOpen"])),
    ("RdWindow", lambda: random.choice(["Closed", "Open"])),
    ("RpWindow", lambda: random.choice(["Closed", "Open"])),
    ("SentryMode", _bool),
    ("HomelinkNearby", _bool),
    ("GuestModeEnabled", _bool),
    ("SpeedLimitMode", _bool),
    ("CurrentLimitMph", lambda: random.choice([0, 55, 65, 75, 85])),

    # Tire Pressure (bar)
    ("TpmsPressureFl", _tpms),
    ("TpmsPressureFr", _tpms),
    ("TpmsPressureRl", _tpms),
    ("TpmsPressureRr", _tpms),

    # Drive unit
    ("DiStateR", lambda: random.choice(["Unavailable", "Standby", "Enabled", "Fault"])),
    ("DiAxleSpeedR", lambda: round(random.uniform(0, 1500), 1)),
    ("DiTorquemotor", lambda: round(random.uniform(-500, 500), 1)),
    ("DiStatorTempR", lambda: round(random.uniform(20, 120), 1)),
    ("PedalPosition", lambda: round(random.uniform(0, 100), 1)),
    ("BrakePedal", lambda: random.choice([0, 1])),
    ("LateralAcceleration", lambda: round(random.uniform(-1.5, 1.5), 3)),
    ("LongitudinalAcceleration", lambda: round(random.uniform(-4.0, 4.0), 3)),

    # Battery internals
    ("BrickVoltageMax", lambda: round(random.uniform(3.8, 4.2), 3)),
    ("BrickVoltageMin", lambda: round(random.uniform(3.6, 4.0), 3)),
    ("ModuleTempMax", lambda: round(random.uniform(15, 50), 1)),
    ("ModuleTempMin", lambda: round(random.uniform(10, 40), 1)),
    ("IsolationResistance", lambda: random.randint(500, 5000)),

    # Software
    ("Version", lambda: f"2026.{random.randint(1,12)}.{random.randint(1,20)}"),
    ("VehicleName", lambda: random.choice(["Red Thunder", "Blue Lightning", "Midnight", "Shadow", "Starlight"])),
]


def generate_vin():
    """Generate a realistic-looking Tesla VIN."""
    # Tesla VINs: 5YJ3 (Model 3), 5YJX (Model X), 5YJS (Model S), 7SA (Model Y)
    prefix = random.choice(["5YJ3E1EA", "5YJXCDE2", "5YJSA1E2", "7SAYGDEE"])
    suffix = ''.join(random.choices(string.digits, k=9))
    return prefix + suffix


def main():
    parser = argparse.ArgumentParser(description="MQTT Fleet Telemetry Load Test")
    parser.add_argument("--messages", type=int, default=1_000_000, help="Total messages to publish")
    parser.add_argument("--vins", type=int, default=5, help="Number of simulated vehicles")
    parser.add_argument("--host", type=str, default="localhost", help="MQTT broker host")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--topic-base", type=str, default="telemetry", help="Fleet telemetry topic base")
    parser.add_argument("--qos", type=int, default=0, help="MQTT QoS level (0=fire-and-forget, 1=at-least-once)")
    parser.add_argument("--batch-size", type=int, default=10000, help="Report progress every N messages")
    args = parser.parse_args()

    # Generate VINs
    vins = [generate_vin() for _ in range(args.vins)]
    print(f"\n{'='*60}")
    print(f"  MQTT Fleet Telemetry Load Test")
    print(f"{'='*60}")
    print(f"  Broker:     {args.host}:{args.port}")
    print(f"  Topic base: {args.topic_base}")
    print(f"  Messages:   {args.messages:,}")
    print(f"  Vehicles:   {args.vins}")
    print(f"  Signals:    {len(SIGNALS)} types")
    print(f"  QoS:        {args.qos}")
    print(f"  VINs:       {', '.join(vins)}")
    print(f"{'='*60}\n")

    # Connect to MQTT
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teslasync-load-test")
    try:
        client.connect(args.host, args.port, keepalive=60)
    except Exception as e:
        print(f"ERROR: Could not connect to MQTT broker at {args.host}:{args.port}: {e}")
        sys.exit(1)
    client.loop_start()

    print("Connected to MQTT broker. Starting load test...\n")

    sent = 0
    errors = 0
    start_time = time.time()
    last_report = start_time
    per_vin_count = defaultdict(int)

    try:
        while sent < args.messages:
            vin = random.choice(vins)
            signal_name, generator = random.choice(SIGNALS)

            topic = f"{args.topic_base}/{vin}/v/{signal_name}"
            value = generator()
            payload = json.dumps(value)

            result = client.publish(topic, payload, qos=args.qos)
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                sent += 1
                per_vin_count[vin] += 1
            else:
                errors += 1

            # Progress report
            if sent % args.batch_size == 0:
                now = time.time()
                elapsed = now - start_time
                batch_elapsed = now - last_report
                overall_rate = sent / elapsed if elapsed > 0 else 0
                batch_rate = args.batch_size / batch_elapsed if batch_elapsed > 0 else 0
                pct = (sent / args.messages) * 100
                eta = (args.messages - sent) / overall_rate if overall_rate > 0 else 0

                print(f"  [{pct:5.1f}%] {sent:>10,} / {args.messages:,}  |  "
                      f"rate: {batch_rate:,.0f} msg/s (avg {overall_rate:,.0f})  |  "
                      f"errors: {errors}  |  ETA: {eta:.0f}s")
                last_report = now

    except KeyboardInterrupt:
        print(f"\n\nInterrupted after {sent:,} messages.")

    end_time = time.time()
    total_elapsed = end_time - start_time

    # Drain any remaining queued messages
    print("\nFlushing remaining queued messages...")
    time.sleep(2)
    client.loop_stop()
    client.disconnect()

    # Summary
    print(f"\n{'='*60}")
    print(f"  LOAD TEST COMPLETE")
    print(f"{'='*60}")
    print(f"  Total sent:     {sent:,}")
    print(f"  Errors:         {errors:,}")
    print(f"  Duration:       {total_elapsed:.1f}s")
    print(f"  Throughput:     {sent / total_elapsed:,.0f} msg/s")
    print(f"  Avg per signal: {total_elapsed / sent * 1000:.3f}ms" if sent > 0 else "")
    print(f"\n  Per-vehicle breakdown:")
    for vin in sorted(per_vin_count.keys()):
        count = per_vin_count[vin]
        print(f"    {vin}: {count:>10,} messages ({count/sent*100:.1f}%)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
