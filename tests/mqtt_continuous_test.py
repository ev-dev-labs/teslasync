#!/usr/bin/env python3
"""
Continuous MQTT Fleet Telemetry Load Test for TeslaSync

Pushes realistic, high-volume telemetry events for a configurable duration.
Simulates realistic driving, charging, and parked scenarios with coherent
signal values (GPS moves along routes, battery drains/charges, etc.).

Uses Tesla fleet-telemetry topic format: telemetry/{VIN}/v/{SignalName}

Usage:
    python tests/mqtt_continuous_test.py --duration 7200 --vins 8 --rate 200
"""

import argparse
import json
import math
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Realistic driving routes (lat/lon waypoints)
# ---------------------------------------------------------------------------
ROUTES = {
    "sf_to_la": [
        (37.7749, -122.4194), (37.5585, -122.2711), (37.3382, -121.8863),
        (36.9741, -121.9552), (36.6002, -121.8947), (36.1540, -120.8563),
        (35.3733, -119.0187), (34.9530, -118.8281), (34.4208, -118.5589),
        (34.0522, -118.2437),
    ],
    "la_to_vegas": [
        (34.0522, -118.2437), (34.1478, -117.5665), (34.5362, -117.2928),
        (34.8958, -116.8767), (35.2528, -116.0626), (35.6117, -115.3923),
        (35.9279, -115.1740), (36.1699, -115.1398),
    ],
    "nyc_to_boston": [
        (40.7128, -74.0060), (40.8568, -73.8850), (41.0534, -73.5387),
        (41.1865, -73.1955), (41.3083, -72.9279), (41.7658, -72.6734),
        (41.8240, -71.4128), (42.3601, -71.0589),
    ],
    "austin_loop": [
        (30.2672, -97.7431), (30.3520, -97.7707), (30.4015, -97.7225),
        (30.3950, -97.6665), (30.3340, -97.6610), (30.2500, -97.7000),
        (30.2672, -97.7431),
    ],
    "miami_keys": [
        (25.7617, -80.1918), (25.6800, -80.3209), (25.5300, -80.4800),
        (25.0800, -80.6200), (24.9200, -80.6300), (24.6600, -81.1500),
        (24.5551, -81.7800),
    ],
    "seattle_portland": [
        (47.6062, -122.3321), (47.2529, -122.4443), (46.8523, -122.7607),
        (46.2740, -122.9082), (45.8696, -122.6727), (45.5152, -122.6784),
    ],
    "denver_loop": [
        (39.7392, -104.9903), (39.8561, -104.9739), (39.9139, -105.0768),
        (39.8283, -105.2066), (39.6653, -105.2050), (39.6133, -105.0166),
        (39.7392, -104.9903),
    ],
    "chicago_milwaukee": [
        (41.8781, -87.6298), (42.0451, -87.6877), (42.2711, -87.8120),
        (42.5263, -87.8301), (42.7257, -87.7829), (43.0389, -87.9065),
    ],
}

VEHICLE_NAMES = [
    "Midnight Runner", "Blue Thunder", "Red Lightning", "Shadow Hawk",
    "Starlight Express", "Silver Phantom", "Crimson Bolt", "Arctic Fox",
    "Desert Storm", "Neon Flash", "Iron Pulse", "Jade Serpent",
]

SOFTWARE_VERSIONS = [
    "2026.1.15", "2026.2.3", "2026.2.7", "2026.3.1", "2026.3.12",
]

TESLA_VIN_PREFIXES = [
    ("5YJ3E1EA", "Model 3"),
    ("5YJXCDE2", "Model X"),
    ("5YJSA1E2", "Model S"),
    ("7SAYGDEE", "Model Y"),
]


@dataclass
class VehicleState:
    vin: str
    name: str
    model: str
    mode: str = "driving"  # driving, charging, parked
    route_name: str = ""
    route_idx: float = 0.0
    route_direction: int = 1  # 1=forward, -1=reverse
    lat: float = 37.7749
    lon: float = -122.4194
    speed: float = 0.0
    heading: float = 0.0
    battery_level: int = 85
    odometer: float = 15000.0
    inside_temp: float = 22.0
    outside_temp: float = 20.0
    tire_fl: float = 2.85
    tire_fr: float = 2.87
    tire_rl: float = 2.82
    tire_rr: float = 2.84
    pack_voltage: float = 380.0
    pack_current: float = 0.0
    charge_state: str = "Disconnected"
    charge_limit: int = 90
    gear: str = "D"
    locked: bool = False
    sentry: bool = False
    version: str = "2026.3.12"
    mode_timer: float = 0.0
    mode_duration: float = 600.0  # seconds in current mode


def create_vehicle(vin: str = None) -> VehicleState:
    prefix, model = random.choice(TESLA_VIN_PREFIXES)
    if vin is None:
        suffix = ''.join([str(random.randint(0, 9)) for _ in range(9)])
        vin = prefix + suffix
    route_name = random.choice(list(ROUTES.keys()))
    route = ROUTES[route_name]
    start_idx = random.randint(0, len(route) - 2)

    return VehicleState(
        vin=vin,
        name=random.choice(VEHICLE_NAMES),
        model=model,
        mode=random.choice(["driving", "driving", "driving", "charging", "parked"]),
        route_name=route_name,
        route_idx=float(start_idx),
        lat=route[start_idx][0],
        lon=route[start_idx][1],
        battery_level=random.randint(20, 95),
        odometer=round(random.uniform(1000, 80000), 1),
        outside_temp=round(random.uniform(5, 35), 1),
        inside_temp=round(random.uniform(18, 25), 1),
        version=random.choice(SOFTWARE_VERSIONS),
        mode_duration=random.uniform(300, 1200),
    )


def interpolate_route(route: List[Tuple[float, float]], idx: float) -> Tuple[float, float]:
    """Interpolate position along route at fractional index."""
    i = int(idx)
    frac = idx - i
    if i >= len(route) - 1:
        return route[-1]
    if i < 0:
        return route[0]
    lat = route[i][0] + frac * (route[i + 1][0] - route[i][0])
    lon = route[i][1] + frac * (route[i + 1][1] - route[i][1])
    # Add small random jitter for realism
    lat += random.gauss(0, 0.0002)
    lon += random.gauss(0, 0.0002)
    return round(lat, 6), round(lon, 6)


def calc_heading(lat1, lon1, lat2, lon2) -> float:
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    heading = math.degrees(math.atan2(dlon, dlat)) % 360
    return round(heading, 1)


def update_vehicle(v: VehicleState, dt: float):
    """Advance vehicle state by dt seconds."""
    v.mode_timer += dt

    # Mode transitions
    if v.mode_timer >= v.mode_duration:
        v.mode_timer = 0
        if v.mode == "driving":
            if v.battery_level < 20:
                v.mode = "charging"
                v.mode_duration = random.uniform(600, 2400)  # 10-40 min charge
                v.charge_state = random.choice(["Charging"])
                v.gear = "P"
                v.speed = 0
            else:
                v.mode = random.choice(["driving", "parked", "parked"])
                v.mode_duration = random.uniform(120, 900)
                if v.mode == "parked":
                    v.gear = "P"
                    v.speed = 0
                    v.charge_state = "Disconnected"
        elif v.mode == "charging":
            if v.battery_level >= v.charge_limit:
                v.mode = "driving"
                v.mode_duration = random.uniform(300, 1800)
                v.charge_state = "Disconnected"
                v.gear = "D"
        elif v.mode == "parked":
            v.mode = "driving"
            v.mode_duration = random.uniform(300, 1800)
            v.gear = "D"
            v.charge_state = "Disconnected"

    if v.mode == "driving":
        route = ROUTES[v.route_name]
        # Target speed: 40-120 km/h with variation
        target_speed = random.uniform(40, 120)
        v.speed = v.speed * 0.9 + target_speed * 0.1  # smooth acceleration
        v.speed = round(max(0, v.speed), 1)

        # Move along route
        step = (v.speed / 3600.0) * dt * 0.02  # scale for route segments
        old_lat, old_lon = v.lat, v.lon
        v.route_idx += step * v.route_direction

        # Bounce at route ends
        if v.route_idx >= len(route) - 1:
            v.route_idx = len(route) - 1.01
            v.route_direction = -1
        elif v.route_idx <= 0:
            v.route_idx = 0.01
            v.route_direction = 1

        v.lat, v.lon = interpolate_route(route, v.route_idx)
        v.heading = calc_heading(old_lat, old_lon, v.lat, v.lon)

        # Battery drain while driving (~0.3% per km at 300Wh/km)
        km_driven = (v.speed / 3600.0) * dt
        v.battery_level = max(3, v.battery_level - random.uniform(0, 0.02))
        v.odometer += km_driven * 0.621371  # km to miles

        # Pack power (positive = discharging)
        v.pack_current = round(random.uniform(20, 200), 1)
        v.pack_voltage = round(340 + v.battery_level * 0.7, 1)
        v.pack_current = round(v.speed * 0.8 + random.uniform(-10, 30), 1)
        v.gear = "D"

    elif v.mode == "charging":
        v.speed = 0
        v.gear = "P"
        # Charge rate: ~1% per 30-60 seconds
        charge_rate = random.uniform(0.01, 0.05)
        v.battery_level = min(100, v.battery_level + charge_rate)
        v.charge_state = "Charging" if v.battery_level < v.charge_limit else "Complete"
        v.pack_current = round(random.uniform(-200, -30), 1)  # negative = charging
        v.pack_voltage = round(340 + v.battery_level * 0.7, 1)

    elif v.mode == "parked":
        v.speed = 0
        v.gear = "P"
        v.pack_current = round(random.uniform(-2, 2), 1)  # vampire drain

    # Temps drift slowly
    v.outside_temp += random.gauss(0, 0.05)
    v.outside_temp = round(max(-10, min(45, v.outside_temp)), 1)
    v.inside_temp += random.gauss(0, 0.03)
    v.inside_temp = round(max(15, min(30, v.inside_temp)), 1)

    # Tire pressures drift very slowly
    for attr in ['tire_fl', 'tire_fr', 'tire_rl', 'tire_rr']:
        p = getattr(v, attr) + random.gauss(0, 0.002)
        setattr(v, attr, round(max(2.0, min(3.5, p)), 2))


def generate_signals(v: VehicleState) -> List[Tuple[str, object]]:
    """Generate all signals for current vehicle state."""
    bl = int(v.battery_level)
    signals = [
        # Location & navigation (always sent)
        ("Latitude", v.lat),
        ("Longitude", v.lon),
        ("Location", {"latitude": v.lat, "longitude": v.lon}),
        ("GpsHeading", v.heading),
        ("GpsState", "GPSValid"),
        ("VehicleSpeed", round(v.speed, 1)),
        ("Odometer", round(v.odometer, 1)),
        ("Gear", v.gear),

        # Battery
        ("BatteryLevel", bl),
        ("Soc", bl),
        ("PackVoltage", round(v.pack_voltage, 1)),
        ("PackCurrent", round(v.pack_current, 1)),
        ("PackPower", round(v.pack_voltage * v.pack_current / 1000, 1)),
        ("EstBatteryRange", round(bl * 3.2 + random.uniform(-5, 5), 1)),
        ("IdealBatteryRange", round(bl * 3.5 + random.uniform(-3, 3), 1)),
        ("EnergyRemaining", round(bl * 0.75 + random.uniform(-1, 1), 1)),

        # Charging
        ("ChargeState", v.charge_state),
        ("ChargeLimitSoc", v.charge_limit),

        # Climate
        ("InsideTemp", v.inside_temp),
        ("OutsideTemp", v.outside_temp),

        # Tires
        ("TpmsPressureFl", v.tire_fl),
        ("TpmsPressureFr", v.tire_fr),
        ("TpmsPressureRl", v.tire_rl),
        ("TpmsPressureRr", v.tire_rr),

        # Vehicle state
        ("Locked", v.locked),
        ("SentryMode", v.sentry),
        ("VehicleName", v.name),
        ("Version", v.version),
    ]

    if v.mode == "driving":
        signals.extend([
            ("PedalPosition", round(random.uniform(10, 80), 1)),
            ("BrakePedal", 0),
            ("DiStateR", "Enabled"),
            ("DiAxleSpeedR", round(v.speed * 10.5 + random.uniform(-20, 20), 1)),
            ("DiTorquemotor", round(v.speed * 2.5 + random.uniform(-50, 50), 1)),
            ("DiStatorTempR", round(40 + v.speed * 0.3 + random.uniform(-5, 5), 1)),
            ("LateralAcceleration", round(random.gauss(0, 0.3), 3)),
            ("LongitudinalAcceleration", round(random.gauss(0.1, 0.5), 3)),
            ("BrickVoltageMax", round(3.9 + random.uniform(0, 0.3), 3)),
            ("BrickVoltageMin", round(3.7 + random.uniform(0, 0.2), 3)),
            ("ModuleTempMax", round(25 + v.speed * 0.2 + random.uniform(-3, 3), 1)),
            ("ModuleTempMin", round(20 + v.speed * 0.15 + random.uniform(-3, 3), 1)),
            ("HvacPower", round(random.uniform(0.5, 3.0), 1)),
            ("HvacFanSpeed", random.randint(2, 6)),
            ("DoorState", "Closed"),
            ("FdWindow", "Closed"),
            ("FpWindow", "Closed"),
            ("RdWindow", "Closed"),
            ("RpWindow", "Closed"),
        ])

    elif v.mode == "charging":
        charge_power = abs(v.pack_current * v.pack_voltage / 1000)
        is_dc = charge_power > 20
        signals.extend([
            ("DetailedChargeState", "Charging"),
            ("ChargeAmps", abs(round(v.pack_current, 0))),
            ("ChargerVoltage", 480 if is_dc else 240),
            ("ChargerPhases", 3 if is_dc else 1),
            ("ChargeCurrentRequest", abs(round(v.pack_current, 0))),
            ("ChargeRateMilePerHour", round(charge_power * 3.5, 1)),
            ("DCChargingPower" if is_dc else "ACChargingPower", round(charge_power, 1)),
            ("FastChargerPresent", is_dc),
            ("FastChargerType", "Tesla" if is_dc else ""),
            ("ChargingCableType", "SAE" if is_dc else "IEC"),
            ("TimeToFullCharge", round((v.charge_limit - v.battery_level) * 0.02, 2)),
            ("BatteryHeaterOn", v.outside_temp < 5),
            ("PedalPosition", 0.0),
            ("BrakePedal", 1),
            ("DiStateR", "Standby"),
        ])

    elif v.mode == "parked":
        signals.extend([
            ("PedalPosition", 0.0),
            ("BrakePedal", 0),
            ("DiStateR", "Standby"),
            ("DiAxleSpeedR", 0.0),
            ("CabinOverheatProtectionMode", "On" if v.outside_temp > 30 else "Off"),
            ("DoorState", "Closed"),
            ("HvacPower", 0.0),
            ("HvacFanSpeed", 0),
        ])

    return signals


def main():
    parser = argparse.ArgumentParser(description="Continuous MQTT Fleet Telemetry Load Test")
    parser.add_argument("--duration", type=int, default=7200, help="Test duration in seconds (default: 7200 = 2 hours)")
    parser.add_argument("--vins", type=int, default=8, help="Number of simulated vehicles")
    parser.add_argument("--host", type=str, default="localhost", help="MQTT broker host")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--topic-base", type=str, default="telemetry", help="Fleet telemetry topic base")
    parser.add_argument("--rate", type=int, default=300, help="Target signals per second (across all vehicles)")
    parser.add_argument("--qos", type=int, default=0, help="MQTT QoS level")
    parser.add_argument("--include-vin", type=str, default="5YJ3E1EA327874020", help="Include this specific VIN")
    args = parser.parse_args()

    # Create vehicles - include the known test VIN
    vehicles = []
    if args.include_vin:
        v = create_vehicle(vin=args.include_vin)
        v.name = "Test Model 3"
        v.model = "Model 3"
        v.mode = "driving"
        vehicles.append(v)

    while len(vehicles) < args.vins:
        vehicles.append(create_vehicle())

    # Assign different routes
    route_names = list(ROUTES.keys())
    for i, v in enumerate(vehicles):
        v.route_name = route_names[i % len(route_names)]
        route = ROUTES[v.route_name]
        v.route_idx = random.uniform(0, len(route) - 1.5)
        v.lat, v.lon = interpolate_route(route, v.route_idx)

    print(f"\n{'='*70}")
    print(f"  CONTINUOUS MQTT FLEET TELEMETRY LOAD TEST")
    print(f"{'='*70}")
    print(f"  Broker:      {args.host}:{args.port}")
    print(f"  Topic base:  {args.topic_base}")
    print(f"  Duration:    {args.duration}s ({args.duration/3600:.1f} hours)")
    print(f"  Vehicles:    {args.vins}")
    print(f"  Target rate: ~{args.rate} signals/sec")
    print(f"  QoS:         {args.qos}")
    print(f"  Vehicles:")
    for v in vehicles:
        print(f"    {v.vin} | {v.model:10s} | {v.name:20s} | {v.mode:10s} | {v.route_name}")
    print(f"{'='*70}\n")

    # Connect
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teslasync-continuous-test")
    try:
        client.connect(args.host, args.port, keepalive=60)
    except Exception as e:
        print(f"ERROR: Could not connect to MQTT broker at {args.host}:{args.port}: {e}")
        sys.exit(1)
    client.loop_start()
    print("Connected to MQTT broker. Streaming events...\n")

    sent = 0
    errors = 0
    start_time = time.time()
    last_report = start_time
    report_interval = 30  # report every 30 seconds
    per_vin_count = defaultdict(int)
    per_vin_mode = {}

    # Calculate timing: signals per vehicle per cycle
    sim_dt = 1.0  # simulate 1 second of vehicle time per cycle
    signals_per_vehicle = 35  # ~35 signals per vehicle per update
    cycle_delay = max(0.01, (args.vins * signals_per_vehicle) / args.rate)

    try:
        while True:
            now = time.time()
            elapsed = now - start_time
            if elapsed >= args.duration:
                break

            # Pick a random vehicle to update
            v = random.choice(vehicles)
            update_vehicle(v, sim_dt)
            signals = generate_signals(v)

            # Publish all signals for this vehicle
            for signal_name, value in signals:
                topic = f"{args.topic_base}/{v.vin}/v/{signal_name}"
                payload = json.dumps(value)
                result = client.publish(topic, payload, qos=args.qos)
                if result.rc == mqtt.MQTT_ERR_SUCCESS:
                    sent += 1
                    per_vin_count[v.vin] += 1
                else:
                    errors += 1

            per_vin_mode[v.vin] = (v.mode, v.name, v.model, int(v.battery_level))

            # Throttle to target rate
            if cycle_delay > 0.01:
                time.sleep(cycle_delay)

            # Progress report
            if now - last_report >= report_interval:
                rate = sent / elapsed if elapsed > 0 else 0
                remaining = args.duration - elapsed
                hours = int(remaining // 3600)
                mins = int((remaining % 3600) // 60)
                secs = int(remaining % 60)

                print(f"  [{elapsed/args.duration*100:5.1f}%] {sent:>12,} signals | "
                      f"{rate:,.0f} sig/s | errors: {errors} | "
                      f"remaining: {hours}h {mins:02d}m {secs:02d}s")

                # Show vehicle states
                for vin in sorted(per_vin_mode.keys()):
                    mode, name, model, batt = per_vin_mode[vin]
                    icon = {"driving": "🚗", "charging": "⚡", "parked": "🅿️"}.get(mode, "❓")
                    cnt = per_vin_count[vin]
                    print(f"         {icon} {vin} {name:20s} {mode:10s} 🔋{batt}% ({cnt:,} signals)")
                print()
                last_report = now

    except KeyboardInterrupt:
        print(f"\n\nStopped by user after {sent:,} signals.")

    end_time = time.time()
    total_elapsed = end_time - start_time
    client.loop_stop()
    client.disconnect()

    print(f"\n{'='*70}")
    print(f"  LOAD TEST COMPLETE")
    print(f"{'='*70}")
    print(f"  Total sent:  {sent:,}")
    print(f"  Errors:      {errors:,}")
    print(f"  Duration:    {total_elapsed:.1f}s ({total_elapsed/3600:.2f} hours)")
    print(f"  Throughput:  {sent/total_elapsed:,.0f} signals/sec")
    print(f"\n  Final vehicle states:")
    for vin in sorted(per_vin_mode.keys()):
        mode, name, model, batt = per_vin_mode[vin]
        cnt = per_vin_count[vin]
        print(f"    {vin} | {name:20s} | {mode:10s} | 🔋{batt:3d}% | {cnt:>10,} signals")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
