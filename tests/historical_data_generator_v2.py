#!/usr/bin/env python3
"""Historical data generator v2 — 25 years of comprehensive Tesla telemetry data.

Generates data across ALL 20 telemetry tables (including 6 new tables from migration
000017) spanning 2001-01-01 to 2026-03-29.  Runs for 4 hours by default, continuously
inserting data and publishing real-time MQTT events.

Usage:
    python tests/historical_data_generator_v2.py --db-host localhost --mqtt-host localhost
"""

import argparse
import json
import math
import random
import signal
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone, date as date_type

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    from psycopg2.extras import execute_values

try:
    import paho.mqtt.client as mqtt
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paho-mqtt', '-q'])
    import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
VEHICLE_ID = 1
VIN = "5YJ3E1EA327874020"
BATTERY_CAPACITY_KWH = 75.0
START_DATE = datetime(2001, 1, 1, tzinfo=timezone.utc)
END_DATE = datetime(2026, 3, 29, tzinfo=timezone.utc)
TOTAL_DAYS = (END_DATE - START_DATE).days  # ~9,219

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
ROUTE_NAMES = list(ROUTES.keys())

HOME_COORDS = (37.7749, -122.4194)  # San Francisco
WORK_COORDS = (37.3861, -122.0839)  # Mountain View

ALERT_TYPES = [
    ("battery_low", "warning", "Battery Low", "Battery level dropped below 10%."),
    ("speed_limit", "info", "Speed Limit Exceeded", "Vehicle exceeded the configured speed limit of 130 km/h."),
    ("temperature", "warning", "High Battery Temperature", "Battery temperature exceeded 45°C during charging."),
    ("sentry_event", "info", "Sentry Mode Event", "Motion detected near the vehicle while parked."),
    ("software_update", "info", "Software Update Available", "A new software update is available for installation."),
    ("geofence", "info", "Geofence Alert", "Vehicle left the configured home geofence zone."),
    ("battery_low", "critical", "Battery Critically Low", "Battery level dropped below 5%. Seek charging immediately."),
    ("temperature", "info", "Cabin Overheat Protection Activated", "Interior temperature exceeded threshold, climate activated."),
    ("sentry_event", "warning", "Sentry Mode: Impact Detected", "A possible impact was detected on the vehicle."),
    ("geofence", "warning", "Geofence Alert: Valet", "Vehicle left the valet geofence boundary."),
    ("tire_pressure", "warning", "Tire Pressure Low", "Front left tire pressure dropped below 2.5 bar."),
    ("connectivity", "info", "Connectivity Lost", "Vehicle lost cellular connectivity for >30 minutes."),
]

TRIP_NAMES = [
    "Weekend Getaway to LA", "Road Trip: SF to Vegas", "Holiday Drive to Boston",
    "Austin Day Trip", "Miami to Key West", "Seattle to Portland Run",
    "Denver Mountain Loop", "Chicago to Milwaukee", "Thanksgiving Road Trip",
    "Summer Vacation Drive", "Beach Day Trip", "Ski Resort Run",
    "Coastal Highway Drive", "National Park Visit", "Wine Country Tour",
    "Family Visit", "Concert Road Trip", "Camping Trip", "Wedding Drive",
    "Anniversary Getaway",
]

SONGS = [
    ("Bohemian Rhapsody", "Queen", "A Night at the Opera"),
    ("Hotel California", "Eagles", "Hotel California"),
    ("Stairway to Heaven", "Led Zeppelin", "Led Zeppelin IV"),
    ("Imagine", "John Lennon", "Imagine"),
    ("Smells Like Teen Spirit", "Nirvana", "Nevermind"),
    ("Billie Jean", "Michael Jackson", "Thriller"),
    ("Sweet Child O' Mine", "Guns N' Roses", "Appetite for Destruction"),
    ("Lose Yourself", "Eminem", "8 Mile Soundtrack"),
    ("Shape of You", "Ed Sheeran", "÷"),
    ("Blinding Lights", "The Weeknd", "After Hours"),
    ("Bad Guy", "Billie Eilish", "WHEN WE ALL FALL ASLEEP"),
    ("Uptown Funk", "Bruno Mars", "Unorthodox Jukebox"),
    ("Rolling in the Deep", "Adele", "21"),
    ("Shallow", "Lady Gaga", "A Star Is Born"),
    ("Old Town Road", "Lil Nas X", "7"),
]

DESTINATIONS = [
    "Home", "Work", "Tesla Supercharger", "Costco", "Whole Foods",
    "Airport", "Gym", "School", "Hospital", "Movie Theater",
    "Beach", "National Park", "Mall", "Restaurant", "Gas Station",
    "Hotel", "Friend's House", "Doctor's Office", "Pet Store", "Library",
]

PLAYBACK_SOURCES = ["Spotify", "Apple Music", "Radio FM", "Bluetooth Audio", "USB", "TuneIn", "Podcast"]

RADIO_STATIONS = ["KQED 88.5", "KOIT 96.5", "KNBR 680", "KGO 810", "KSFO 560", "KFOG 104.5"]

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
_shutdown = False


def _handle_signal(sig, frame):
    global _shutdown
    _shutdown = True
    print("\n⚠  Interrupt received — finishing current batch then exiting…")


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def seasonal_temp(dt: datetime) -> float:
    """Realistic seasonal temperature using sine wave."""
    doy = dt.timetuple().tm_yday
    base = 15.0 + 15.0 * math.sin((doy - 80) / 365.0 * 2 * math.pi)
    return round(base + random.gauss(0, 3), 1)


def battery_degradation(years_since_start: float) -> dict:
    """Logarithmic degradation curve for battery health."""
    deg_pct = min(15.0, 4.0 * math.log1p(years_since_start * 1.0))
    health = round(100.0 - deg_pct, 2)
    capacity = round(BATTERY_CAPACITY_KWH * health / 100.0, 2)
    est_range = round(450.0 * health / 100.0, 1)
    cycles = int(years_since_start * 130)
    return dict(health=health, capacity=capacity, deg_pct=round(deg_pct, 2),
                est_range=est_range, cycles=cycles)


def range_for_battery(battery_pct: int, years: float) -> float:
    """Estimated range in km for a given battery percentage."""
    max_range = 350 + years * 2
    max_range *= (100.0 - min(15, 4 * math.log1p(years * 1.0))) / 100.0
    return round(max_range * battery_pct / 100.0, 1)


def interpolate_route(route, num_points):
    """Generate *num_points* evenly spaced positions along a route with jitter."""
    if num_points <= 1:
        lat, lon = route[0]
        return [(lat + random.gauss(0, 0.0002), lon + random.gauss(0, 0.0002))]
    total_segs = len(route) - 1
    points = []
    for i in range(num_points):
        t = i / (num_points - 1)
        seg_f = t * total_segs
        seg_i = min(int(seg_f), total_segs - 1)
        frac = seg_f - seg_i
        lat = route[seg_i][0] + frac * (route[seg_i + 1][0] - route[seg_i][0])
        lon = route[seg_i][1] + frac * (route[seg_i + 1][1] - route[seg_i][1])
        lat += random.gauss(0, 0.0002)
        lon += random.gauss(0, 0.0002)
        points.append((round(lat, 6), round(lon, 6)))
    return points


def speed_profile(num_points: int, max_speed: float) -> list:
    """Generate realistic speed curve: accelerate → cruise → decelerate."""
    speeds = []
    for i in range(num_points):
        t = i / max(num_points - 1, 1)
        spd = max_speed * math.sin(t * math.pi) * random.uniform(0.85, 1.05)
        speeds.append(round(max(0, spd), 1))
    speeds[0] = 0.0
    speeds[-1] = 0.0
    return speeds


def software_version(dt: datetime) -> str:
    year = dt.year
    week = max(1, dt.isocalendar()[1])
    patch = random.randint(1, 40)
    return f"{year}.{week}.{patch}"


def ensure_partition(cur, dt: datetime):
    """Create positions partition for month if it does not exist."""
    name = f"positions_{dt.year}_{dt.month:02d}"
    start = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if dt.month == 12:
        end = start.replace(year=dt.year + 1, month=1)
    else:
        end = start.replace(month=dt.month + 1)
    cur.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_class WHERE relname = '{name}'
            ) THEN
                CREATE TABLE {name} PARTITION OF positions
                    FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}');
            END IF;
        END $$;
    """)


def haversine_km(lat1, lon1, lat2, lon2):
    """Approximate distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Data generators — existing tables with expanded columns
# ---------------------------------------------------------------------------

def generate_drives(day_dates: list, odometer_tracker: dict):
    """Generate drive records plus associated telemetry for a batch of dates.

    Returns (drive_rows, position_rows, motor_rows, climate_rows, security_rows,
             state_rows, mileage_rows, media_rows, location_rows, charging_telemetry_rows).
    """
    drives = []
    positions = []
    motors = []
    climates = []
    securities = []
    states = []
    mileages = []
    media_rows = []
    location_rows = []

    for dt_date in day_dates:
        if _shutdown:
            break
        weekday = dt_date.weekday()
        years = (dt_date - START_DATE.date()).days / 365.25

        if weekday < 5:
            n_drives = random.choices([0, 1, 2, 3], weights=[5, 55, 30, 10])[0]
        else:
            n_drives = random.choices([0, 1, 2], weights=[20, 55, 25])[0]

        day_distance = 0.0
        day_energy = 0.0
        day_drive_count = 0

        for _ in range(n_drives):
            out_temp = seasonal_temp(datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc))
            in_temp = round(max(18, min(26, 22 + random.gauss(0, 1.5))), 1)

            roll = random.random()
            if roll < 0.06:
                dist = random.uniform(200, 500)
                dur = random.uniform(120, 300)
                spd_max = random.uniform(120, 140)
            elif roll < 0.30:
                dist = random.uniform(50, 200)
                dur = random.uniform(45, 180)
                spd_max = random.uniform(100, 130)
            else:
                dist = random.uniform(15, 40)
                dur = random.uniform(20, 40)
                spd_max = random.uniform(80, 100)

            dist = round(dist, 1)
            dur = round(dur, 1)
            spd_max = round(spd_max, 1)

            battery_drain = dist * random.uniform(0.2, 0.3)
            start_batt = random.randint(40, 95)
            end_batt = max(5, int(start_batt - battery_drain))
            start_range = range_for_battery(start_batt, years)
            end_range = range_for_battery(end_batt, years)

            power_max = round(random.uniform(150, 350), 1)
            power_min = round(random.uniform(-80, -20), 1)

            hour = random.choice([7, 8, 9, 12, 13, 17, 18, 19]) + random.random()
            start_dt = datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=hour)
            end_dt = start_dt + timedelta(minutes=dur)

            odo_start = odometer_tracker['value']
            odo_end = odo_start + dist
            odometer_tracker['value'] = odo_end

            drives.append((
                VEHICLE_ID, start_dt, end_dt, dist, dur, spd_max,
                power_max, power_min, start_batt, end_batt,
                start_range, end_range, in_temp, out_temp,
            ))

            states.append((VEHICLE_ID, 'driving', start_dt, end_dt, dur, start_dt))

            # Positions along the drive
            route = ROUTES[random.choice(ROUTE_NAMES)]
            n_pts = random.randint(10, 15)
            pts = interpolate_route(route, n_pts)
            speeds = speed_profile(n_pts, spd_max)

            for j, (lat, lon) in enumerate(pts):
                t_frac = j / max(n_pts - 1, 1)
                pt_time = start_dt + timedelta(minutes=dur * t_frac)
                pt_batt = int(start_batt - (start_batt - end_batt) * t_frac)
                pt_odo = round(odo_start + dist * t_frac, 1)
                heading = random.randint(0, 359)
                elev = round(random.uniform(0, 500), 1)
                power = round(speeds[j] * random.uniform(0.5, 1.5), 1) if speeds[j] > 0 else 0
                positions.append((
                    VEHICLE_ID, lat, lon, speeds[j], power, heading, elev,
                    pt_odo, range_for_battery(pt_batt, years),
                    range_for_battery(pt_batt, years) * 0.95,
                    pt_batt, in_temp, out_temp, random.randint(0, 5),
                    random.random() > 0.5, pt_time,
                ))

                # Motor snapshot — ALL quad-motor fields (~5-6 per drive)
                if random.random() < 0.42:
                    gear = 'D' if speeds[j] > 0 else 'P'
                    is_moving = speeds[j] > 1
                    base_torque = random.uniform(50, 400) if is_moving else 0
                    base_speed_ax = speeds[j] * random.uniform(8, 12) if is_moving else 0
                    stator_base = random.uniform(30, 90) if is_moving else random.uniform(20, 35)
                    motor_state = 'enabled' if is_moving else 'standby'

                    motors.append((
                        VEHICLE_ID,
                        motor_state,
                        round(base_torque, 1),
                        round(base_speed_ax, 1),
                        round(stator_base, 1),
                        round(random.uniform(0, 100), 1),
                        speeds[j] < 1,
                        round(random.uniform(-2, 2), 2),
                        round(random.uniform(-3, 5), 2),
                        speeds[j],
                        gear,
                        # Expanded quad-motor fields
                        round(base_torque * random.uniform(0.4, 0.6), 1) if is_moving else None,
                        round(base_torque * random.uniform(0.4, 0.6), 1) if is_moving else None,
                        round(base_torque * random.uniform(0.1, 0.3), 1) if is_moving else None,
                        round(base_torque * random.uniform(0.1, 0.3), 1) if is_moving else None,
                        round(base_speed_ax * random.uniform(0.95, 1.05), 1) if is_moving else None,
                        round(base_speed_ax * random.uniform(0.95, 1.05), 1) if is_moving else None,
                        round(base_speed_ax * random.uniform(0.95, 1.05), 1) if is_moving else None,
                        motor_state,
                        motor_state,
                        motor_state,
                        round(stator_base + random.gauss(0, 3), 1),
                        round(stator_base + random.gauss(0, 3), 1),
                        round(stator_base + random.gauss(0, 3), 1),
                        round(stator_base * 0.8 + random.gauss(0, 2), 1),
                        round(stator_base * 0.8 + random.gauss(0, 2), 1),
                        round(stator_base * 0.8 + random.gauss(0, 2), 1),
                        round(stator_base * 0.8 + random.gauss(0, 2), 1),
                        round(stator_base * 0.75 + random.gauss(0, 2), 1),
                        round(stator_base * 0.75 + random.gauss(0, 2), 1),
                        round(stator_base * 0.75 + random.gauss(0, 2), 1),
                        round(stator_base * 0.75 + random.gauss(0, 2), 1),
                        round(random.uniform(50, 300), 1) if is_moving else None,
                        round(random.uniform(50, 300), 1) if is_moving else None,
                        round(random.uniform(20, 150), 1) if is_moving else None,
                        round(random.uniform(20, 150), 1) if is_moving else None,
                        round(random.uniform(360, 405), 1),
                        round(random.uniform(360, 405), 1),
                        round(random.uniform(360, 405), 1),
                        round(random.uniform(360, 405), 1),
                        round(base_torque * random.uniform(0.8, 1.0), 1) if is_moving else None,
                        random.choice(['nominal', 'low', None]),
                        round(random.uniform(0, 100), 1) if not is_moving or speeds[j] < 1 else None,
                        round(random.uniform(40, 130), 1) if random.random() > 0.5 else None,
                        is_moving,
                        pt_time,
                    ))

                # Climate snapshot — ALL expanded fields (~3-4 per drive)
                if random.random() < 0.25:
                    seat_h_l = random.choice([0, 0, 0, 1, 2, 3])
                    seat_h_r = random.choice([0, 0, 0, 1, 2, 3])
                    cold = out_temp < 10
                    hot = out_temp > 28
                    climates.append((
                        VEHICLE_ID, in_temp, out_temp,
                        round(random.uniform(0, 5), 2),
                        random.randint(0, 7),
                        round(random.uniform(18, 24), 1),
                        round(random.uniform(18, 24), 1),
                        random.choice(['Off', 'On', 'FanOnly']),
                        out_temp < 2,
                        out_temp < -5,
                        # Expanded climate fields
                        True,
                        random.choice(['auto', 'manual', 'off']),
                        random.randint(0, 7),
                        cold,
                        random.randint(0, 3) if cold else 0,
                        random.choice(['off', 'on', 'dog', 'camp', 'keep']),
                        random.choice(['Low', 'Medium', 'High']) if hot else None,
                        False,
                        seat_h_l,
                        seat_h_r,
                        random.choice([0, 0, 1, 2]) if cold else 0,
                        random.choice([0, 0, 0, 1]) if cold else 0,
                        random.choice([0, 0, 1, 2]) if cold else 0,
                        hot and random.random() > 0.7,
                        random.randint(0, 3) if hot else 0,
                        random.randint(0, 3) if hot else 0,
                        random.random() > 0.5,
                        random.random() > 0.5,
                        out_temp < 5 and random.random() > 0.5,
                        False,
                        out_temp < 2,
                        pt_time,
                    ))

            # Security events: unlock at start, lock at end — with ALL expanded fields
            sentry_on = random.random() > 0.6
            securities.append((
                VEHICLE_ID, False, False, 'closed', 'closed', 'closed', 'closed', 'closed',
                random.random() > 0.7, False,
                # Expanded security fields
                random.randint(0, 3),
                None,
                True,
                'on',
                False,
                False,
                False,
                None,
                random.randint(0, 3),
                False, False, 'off',
                None, None, None,
                True, random.random() > 0.3,
                start_dt,
            ))
            securities.append((
                VEHICLE_ID, True, sentry_on, 'closed', 'closed', 'closed', 'closed', 'closed',
                False, False,
                random.randint(0, 3),
                None,
                False,
                'off',
                False,
                False,
                False,
                None,
                random.randint(0, 3),
                False, False, 'off',
                None, None, None,
                True, random.random() > 0.3,
                end_dt,
            ))

            # Media snapshots during drives (~1 per drive, ~50% of drives)
            if random.random() < 0.5:
                n_media = random.randint(1, 3)
                for m_i in range(n_media):
                    t_f = random.uniform(0.1, 0.9)
                    m_time = start_dt + timedelta(minutes=dur * t_f)
                    song = random.choice(SONGS)
                    source = random.choice(PLAYBACK_SOURCES)
                    station = random.choice(RADIO_STATIONS) if 'Radio' in source else None
                    duration_s = random.randint(150, 360)
                    elapsed_s = random.randint(0, duration_s)
                    media_rows.append((
                        VEHICLE_ID,
                        song[0], song[1], song[2],
                        station,
                        duration_s, elapsed_s,
                        random.choice(['Playing', 'Playing', 'Playing', 'Paused']),
                        source,
                        round(random.uniform(3, 11), 1),
                        11.0,
                        m_time,
                    ))

            # Location snapshots during drives (~50% of drives have navigation)
            if random.random() < 0.55:
                dest = random.choice(DESTINATIONS)
                dest_route = random.choice(list(ROUTES.values()))
                dest_lat, dest_lon = dest_route[-1]
                orig_lat, orig_lon = dest_route[0]
                total_miles = dist * 0.621371
                total_minutes = dur

                n_loc = random.randint(2, 4)
                for l_i in range(n_loc):
                    t_f = l_i / max(n_loc - 1, 1)
                    l_time = start_dt + timedelta(minutes=dur * t_f)
                    miles_left = round(total_miles * (1 - t_f), 1)
                    mins_left = round(total_minutes * (1 - t_f), 1)
                    traffic_delay = round(random.uniform(0, 5), 1)

                    at_home = dest == "Home" and t_f > 0.9
                    is_work_hours = 8 <= l_time.hour <= 17
                    at_work = dest == "Work" and t_f > 0.9 and is_work_hours

                    location_rows.append((
                        VEHICLE_ID,
                        dest,
                        round(dest_lat + random.gauss(0, 0.001), 6),
                        round(dest_lon + random.gauss(0, 0.001), 6),
                        round(orig_lat + random.gauss(0, 0.001), 6),
                        round(orig_lon + random.gauss(0, 0.001), 6),
                        miles_left,
                        mins_left,
                        "cGxhY2Vob2xkZXJfcm91dGVfbGluZQ==",  # placeholder base64
                        traffic_delay,
                        at_home,
                        at_work,
                        False,
                        True,
                        l_time,
                    ))

            day_distance += dist
            day_energy += dist * random.uniform(0.14, 0.20)
            day_drive_count += 1

        # Daily mileage — always one record per day
        if day_drive_count > 0:
            mileages.append((
                VEHICLE_ID, dt_date, round(day_distance, 1),
                round(odometer_tracker['value'] - day_distance, 1),
                round(odometer_tracker['value'], 1),
                day_drive_count, round(day_energy, 2),
            ))
        else:
            mileages.append((
                VEHICLE_ID, dt_date, 0.0,
                round(odometer_tracker['value'], 1),
                round(odometer_tracker['value'], 1),
                0, 0.0,
            ))

    return drives, positions, motors, climates, securities, states, mileages, media_rows, location_rows


def generate_charging_sessions(day_dates: list):
    """Generate charging sessions and per-minute charging telemetry.

    Returns (session_rows, state_rows, telemetry_rows).
    """
    sessions = []
    states = []
    telemetry_rows = []

    for dt_date in day_dates:
        if _shutdown:
            break
        if random.random() > 0.78:
            continue

        years = (dt_date - START_DATE.date()).days / 365.25
        out_temp = seasonal_temp(datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc))

        roll = random.random()
        if roll < 0.70:  # home
            voltage, phases, current = 240, 1, 32
            power = round(voltage * current / 1000, 1)
            cable, fast_type, fast_brand = 'SAE', None, None
            dur = random.uniform(120, 480)
            cost_per_kwh = 0.12
            start_batt = random.randint(20, 40)
            end_batt = random.randint(70, 90)
            hour = random.uniform(21, 23)
            is_dc = False
        elif roll < 0.85:  # work L2
            voltage, phases, current = 240, 1, 48
            power = round(voltage * current / 1000, 1)
            cable, fast_type, fast_brand = 'SAE', None, None
            dur = random.uniform(120, 360)
            cost_per_kwh = 0.15
            start_batt = random.randint(25, 45)
            end_batt = random.randint(70, 90)
            hour = random.uniform(9, 11)
            is_dc = False
        else:  # supercharger
            voltage, phases, current = 480, 3, 250
            power = round(random.uniform(72, 250), 1)
            cable, fast_type, fast_brand = 'Tesla', 'Tesla Supercharger', 'Tesla'
            dur = random.uniform(20, 45)
            cost_per_kwh = 0.30
            start_batt = random.randint(10, 20)
            end_batt = random.randint(75, 90)
            hour = random.uniform(10, 18)
            is_dc = True

        energy_added = round((end_batt - start_batt) / 100.0 * BATTERY_CAPACITY_KWH, 2)
        energy_used = round(energy_added * random.uniform(1.05, 1.12), 2)
        cost = round(energy_added * cost_per_kwh, 2)
        dur = round(dur, 1)

        start_dt = datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=hour)
        end_dt = start_dt + timedelta(minutes=dur)

        start_range = range_for_battery(start_batt, years)
        end_range = range_for_battery(end_batt, years)

        sessions.append((
            VEHICLE_ID, start_dt, end_dt, energy_added, energy_used,
            start_batt, end_batt, start_range, end_range,
            phases, voltage, current, power,
            fast_type, fast_brand, cable, cost, dur,
        ))

        states.append((VEHICLE_ID, 'charging', start_dt, end_dt, dur, start_dt))

        # Charging telemetry — ~1 per 6 minutes during charging (for volume control)
        n_telemetry = max(1, int(dur / 6))
        bms_states = ['Charging', 'Charging', 'Charging', 'Balancing', 'Complete']
        lifetime_energy = round(random.uniform(20000, 80000), 1)
        has_powershare = random.random() < 0.05  # 5% of sessions

        for t_i in range(n_telemetry):
            t_frac = t_i / max(n_telemetry - 1, 1)
            t_time = start_dt + timedelta(minutes=dur * t_frac)
            cur_batt = start_batt + (end_batt - start_batt) * t_frac
            cur_soc = cur_batt

            pack_v = round(random.uniform(340, 405), 1)
            pack_i = round(random.uniform(-5, 200) if is_dc else random.uniform(-2, 48), 1)

            brick_max = round(random.uniform(3.95, 4.20), 3)
            brick_min = round(brick_max - random.uniform(0.005, 0.040), 3)
            mod_temp_max = round(out_temp + random.uniform(5, 25), 1)
            mod_temp_min = round(mod_temp_max - random.uniform(1, 5), 1)

            bms_idx = min(int(t_frac * len(bms_states)), len(bms_states) - 1)
            charge_rate = round(random.uniform(5, 40) if is_dc else random.uniform(10, 30), 1)
            dc_power = round(pack_v * pack_i / 1000, 1) if is_dc else None
            ac_power = round(voltage * current * phases / 1000, 1) if not is_dc else None

            remaining_hours = round(dur * (1 - t_frac) / 60, 2)

            telemetry_rows.append((
                VEHICLE_ID,
                round(cur_batt, 1),
                round(cur_soc, 1),
                'Charging' if t_frac < 0.95 else 'Complete',
                bms_states[bms_idx],
                80 if end_batt < 90 else 90,
                round(current * t_frac + 5, 1),
                round(float(current), 1),
                round(float(current), 1),
                True,
                round(float(voltage), 1),
                phases,
                charge_rate,
                dc_power,
                round(energy_added * t_frac, 2) if is_dc else None,
                ac_power,
                round(energy_added * t_frac, 2) if not is_dc else None,
                round(BATTERY_CAPACITY_KWH * cur_batt / 100, 2),
                round(range_for_battery(int(cur_batt), years) * 0.621371, 1),
                round(range_for_battery(int(cur_batt), years), 1),
                round(range_for_battery(int(cur_batt), years), 1),
                pack_v,
                pack_i,
                True,
                'Engaged' if t_frac < 0.95 else 'Disengaged',
                out_temp < 0,
                cable,
                is_dc,
                fast_type if is_dc else None,
                remaining_hours,
                remaining_hours,
                None,
                False,
                out_temp < 5,
                brick_max,
                brick_min,
                random.randint(1, 96),
                random.randint(1, 96),
                mod_temp_max,
                mod_temp_min,
                random.randint(1, 16),
                random.randint(1, 16),
                out_temp < 0,
                out_temp < -10,
                bms_states[bms_idx],
                t_frac > 0.98,
                True,
                round(random.uniform(500, 2000), 0),
                round(lifetime_energy + energy_added * t_frac, 1),
                is_dc,
                'Active' if has_powershare else None,
                'V2H' if has_powershare else None,
                None,
                random.randint(1, 8) if has_powershare else None,
                round(random.uniform(2, 10), 1) if has_powershare else None,
                t_time,
            ))

    return sessions, states, telemetry_rows


def generate_battery_snapshots(month_dates: list):
    rows = []
    for dt in month_dates:
        if _shutdown:
            break
        years = (dt - START_DATE).total_seconds() / (365.25 * 86400)
        d = battery_degradation(years)
        cell_temp = round(20 + 8 * math.sin((dt.timetuple().tm_yday - 80) / 365 * 2 * math.pi) + random.gauss(0, 2), 1)
        rows.append((
            VEHICLE_ID, d['health'], d['capacity'], d['deg_pct'],
            d['est_range'], d['cycles'], cell_temp, dt,
        ))
    return rows


def generate_tire_pressure(week_dates: list):
    """Tire pressure snapshots with expanded columns from 000017."""
    rows = []
    for dt in week_dates:
        if _shutdown:
            break
        out_temp = seasonal_temp(dt)
        temp_offset = (out_temp - 15) * 0.005
        base = 3.0 + temp_offset
        fl = round(base + random.gauss(0, 0.05), 2)
        fr = round(base + random.gauss(0, 0.05), 2)
        rl = round(base + random.gauss(0, 0.05), 2)
        rr = round(base + random.gauss(0, 0.05), 2)

        # Occasional low-pressure event (~3%)
        hard_warn = None
        soft_warn = None
        if random.random() < 0.03:
            idx = random.randint(0, 3)
            vals = [fl, fr, rl, rr]
            vals[idx] = round(random.uniform(2.0, 2.5), 2)
            fl, fr, rl, rr = vals
            tire_names = ['FL', 'FR', 'RL', 'RR']
            if vals[idx] < 2.2:
                hard_warn = tire_names[idx]
            else:
                soft_warn = tire_names[idx]

        rows.append((
            VEHICLE_ID, fl, fr, rl, rr,
            hard_warn,
            soft_warn,
            dt - timedelta(minutes=random.randint(0, 30)),
            dt - timedelta(minutes=random.randint(0, 30)),
            dt - timedelta(minutes=random.randint(0, 30)),
            dt - timedelta(minutes=random.randint(0, 30)),
            dt,
        ))
    return rows


def generate_vampire_drain(month_dates: list):
    rows = []
    for dt in month_dates:
        if _shutdown:
            break
        n = random.choices([1, 2, 3], weights=[50, 40, 10])[0]
        for _ in range(n):
            out_temp = seasonal_temp(dt)
            sentry = random.random() > 0.5
            dur_hours = random.uniform(8, 72)
            rate = random.uniform(0.5, 1.5) if sentry else random.uniform(0.2, 0.5)
            if out_temp < 5:
                rate *= random.uniform(1.2, 1.8)
            batt_lost = min(15, round(rate * dur_hours, 1))
            start_batt = random.randint(50, 95)
            end_batt = max(5, int(start_batt - batt_lost))
            batt_lost_actual = start_batt - end_batt
            range_lost = round(batt_lost_actual / 100 * 450, 1)
            day_offset = random.randint(0, 27)
            start_dt = dt + timedelta(days=day_offset, hours=random.uniform(0, 12))
            end_dt = start_dt + timedelta(hours=dur_hours)
            rows.append((
                VEHICLE_ID, start_dt, end_dt, start_batt, end_batt,
                batt_lost_actual, range_lost, round(dur_hours, 2),
                round(rate, 3), round(out_temp, 1), sentry, start_dt,
            ))
    return rows


def generate_software_updates():
    rows = []
    dt = START_DATE + timedelta(days=random.randint(30, 90))
    while dt < END_DATE:
        if _shutdown:
            break
        ver = software_version(dt)
        sched = dt
        install_delay = timedelta(days=random.randint(0, 3), hours=random.randint(0, 12))
        installed = dt + install_delay
        rows.append((VEHICLE_ID, ver, 'installed', sched, installed, dt))
        dt += timedelta(days=random.randint(70, 110))
    return rows


def generate_alerts():
    rows = []
    for _ in range(150):
        if _shutdown:
            break
        days_offset = random.randint(0, TOTAL_DAYS - 1)
        dt = START_DATE + timedelta(days=days_offset, hours=random.uniform(0, 23))
        a = random.choice(ALERT_TYPES)
        rows.append((VEHICLE_ID, a[0], a[1], a[2], a[3], random.random() > 0.3, dt))
    rows.sort(key=lambda r: r[6])
    return rows


def generate_sleep_states(day_dates: list):
    rows = []
    for dt_date in day_dates:
        if _shutdown:
            break
        base = datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc)
        s1 = base + timedelta(hours=random.uniform(0, 1))
        e1 = base + timedelta(hours=random.uniform(6, 7))
        rows.append((VEHICLE_ID, 'asleep', s1, e1, round((e1 - s1).total_seconds() / 60, 1), s1))

        if random.random() < 0.3:
            s2 = base + timedelta(hours=random.uniform(10, 14))
            e2 = s2 + timedelta(minutes=random.uniform(2, 15))
            rows.append((VEHICLE_ID, 'online', s2, e2, round((e2 - s2).total_seconds() / 60, 1), s2))

        s3 = base + timedelta(hours=random.uniform(21, 23))
        e3 = base + timedelta(hours=23, minutes=59)
        rows.append((VEHICLE_ID, 'asleep', s3, e3, round((e3 - s3).total_seconds() / 60, 1), s3))
    return rows


# ---------------------------------------------------------------------------
# NEW table generators (migration 000017)
# ---------------------------------------------------------------------------

def generate_vehicle_config_snapshots(sw_updates: list):
    """Generate vehicle config snapshots — one per software update plus a few extras."""
    rows = []
    configs = [
        ('Model3', 'Long Range AWD', 'Pearl White Multi-Coat', 'Glass', 'Aero19', '0', 'None', 'Standard'),
    ]
    exterior_colors = [
        'Pearl White Multi-Coat', 'Solid Black', 'Midnight Silver Metallic',
        'Deep Blue Metallic', 'Red Multi-Coat',
    ]
    wheel_types = ['Aero19', 'Sport19', 'Überturbine20']

    for i, upd in enumerate(sw_updates):
        if _shutdown:
            break
        ver = upd[1]  # version string
        dt = upd[5]   # created_at
        color = exterior_colors[0] if i < len(sw_updates) * 0.8 else random.choice(exterior_colors)
        wheel = wheel_types[0] if i < len(sw_updates) * 0.6 else random.choice(wheel_types)

        # download/install percentages
        dl_pct = 100
        inst_pct = 100
        exp_dur = random.randint(15, 45)

        rows.append((
            VEHICLE_ID,
            'Model3',
            'Long Range AWD',
            color,
            'Glass',
            wheel,
            '0',
            'None',
            'Standard',
            False,
            False,
            True,
            'CCS',
            False,
            ver,
            f"Test Model 3 #{i + 1}",
            ver,
            dl_pct,
            inst_pct,
            exp_dur,
            dt,
        ))

    return rows


def generate_safety_snapshots(month_dates: list, odometer_tracker: dict):
    """Generate periodic safety config readings — ~2 per year."""
    rows = []
    miles_since_reset = 0.0
    self_driving_miles = 0.0

    for i, dt in enumerate(month_dates):
        if _shutdown:
            break
        if i % 6 != 0:  # every 6 months
            continue

        miles_since_reset += random.uniform(3000, 8000)
        self_driving_miles += random.uniform(300, 800)

        rows.append((
            VEHICLE_ID,
            True,
            False,
            True,
            random.choice(['1', '2', '3', '4', '5']),
            True,
            random.choice(['Off', 'Medium', 'Late']),
            random.choice(['Off', 'Warning', 'Assist']),
            random.choice(['Off', 'Display', 'Chime']),
            random.random() > 0.8,
            round(miles_since_reset, 1),
            round(self_driving_miles, 1),
            dt,
        ))

    return rows


def generate_user_preference_snapshots():
    """Generate occasional user preference changes — ~50 over 25 years."""
    rows = []
    dt = START_DATE + timedelta(days=random.randint(1, 30))

    prefs = {
        '24hr': False,
        'charge_unit': 'mi',
        'dist': 'mi',
        'temp': 'F',
        'tire': 'PSI',
    }

    while len(rows) < 50 and dt < END_DATE:
        if _shutdown:
            break

        # Occasionally flip a setting
        if random.random() < 0.15:
            prefs['dist'] = 'km' if prefs['dist'] == 'mi' else 'mi'
        if random.random() < 0.10:
            prefs['temp'] = 'C' if prefs['temp'] == 'F' else 'F'
        if random.random() < 0.08:
            prefs['24hr'] = not prefs['24hr']
        if random.random() < 0.05:
            prefs['tire'] = 'Bar' if prefs['tire'] == 'PSI' else 'PSI'

        rows.append((
            VEHICLE_ID,
            prefs['24hr'],
            prefs['charge_unit'],
            prefs['dist'],
            prefs['temp'],
            prefs['tire'],
            dt,
        ))

        dt += timedelta(days=random.randint(60, 250))

    return rows


def generate_trips(conn):
    """Generate ~200 trips from existing drives in the database."""
    cur = conn.cursor()
    cur.execute("""
        SELECT id, start_date, end_date, distance, duration_min
        FROM drives WHERE vehicle_id = %s
        ORDER BY start_date
    """, (VEHICLE_ID,))
    all_drives = cur.fetchall()
    cur.close()
    if len(all_drives) < 10:
        return

    trips = []
    trip_drive_links = []
    used_ids = set()
    attempts = 0

    while len(trips) < 200 and attempts < 600:
        attempts += 1
        idx = random.randint(0, len(all_drives) - 3)
        n = random.randint(2, 5)
        chunk = all_drives[idx:idx + n]
        chunk_ids = [d[0] for d in chunk]
        if any(cid in used_ids for cid in chunk_ids):
            continue
        for cid in chunk_ids:
            used_ids.add(cid)

        name = random.choice(TRIP_NAMES)
        start_date = chunk[0][1]
        end_date = chunk[-1][2] or chunk[-1][1] + timedelta(minutes=chunk[-1][4] or 30)
        total_dist = round(sum(d[3] or 0 for d in chunk), 1)
        total_energy = round(total_dist * 0.17, 2)
        total_cost = round(total_energy * 0.13, 2)

        trips.append((
            VEHICLE_ID, name, start_date, end_date, total_dist,
            total_energy, total_cost, len(chunk), random.randint(0, 2), start_date,
        ))
        trip_drive_links.append(chunk_ids)

    if not trips:
        return

    cur = conn.cursor()
    inserted_ids = []
    for t in trips:
        cur.execute("""
            INSERT INTO trips (vehicle_id, name, start_date, end_date, total_distance_km,
                               total_energy_kwh, total_cost, drive_count, charge_count, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, t)
        inserted_ids.append(cur.fetchone()[0])
    conn.commit()

    td_rows = []
    for trip_id, drive_ids in zip(inserted_ids, trip_drive_links):
        for did in drive_ids:
            td_rows.append((trip_id, did))

    if td_rows:
        execute_values(cur, """
            INSERT INTO trip_drives (trip_id, drive_id) VALUES %s
            ON CONFLICT DO NOTHING
        """, td_rows)
        conn.commit()
    cur.close()
    print(f"    ✓ Inserted {len(trips)} trips with {len(td_rows)} trip_drive links")


# ---------------------------------------------------------------------------
# MQTT real-time publisher
# ---------------------------------------------------------------------------

def publish_mqtt_snapshot(client: mqtt.Client, topic_base: str):
    """Publish a current-time telemetry snapshot so SSE/live UI works."""
    now = datetime.now(timezone.utc)
    batt = random.randint(50, 90)
    speed = round(random.uniform(0, 100), 1)
    lat, lon = 37.7749 + random.gauss(0, 0.01), -122.4194 + random.gauss(0, 0.01)
    out_temp = seasonal_temp(now)
    in_temp = round(22 + random.gauss(0, 1), 1)

    signals = {
        "Latitude": lat, "Longitude": lon,
        "Location": json.dumps({"latitude": lat, "longitude": lon}),
        "GpsHeading": random.randint(0, 359),
        "GpsState": "GPSValid",
        "VehicleSpeed": speed,
        "Odometer": round(random.uniform(50000, 200000), 1),
        "Gear": random.choice(["P", "D", "R"]),
        "BatteryLevel": batt, "Soc": batt,
        "PackVoltage": round(random.uniform(350, 400), 1),
        "PackCurrent": round(random.uniform(-50, 200), 1),
        "PackPower": round(random.uniform(-20, 80), 1),
        "EstBatteryRange": round(batt * 3.8, 1),
        "IdealBatteryRange": round(batt * 4.0, 1),
        "EnergyRemaining": round(batt * 0.75, 2),
        "ChargeState": "Disconnected",
        "ChargeLimitSoc": 80,
        "InsideTemp": in_temp, "OutsideTemp": out_temp,
        "TpmsPressureFl": round(3.0 + random.gauss(0, 0.03), 2),
        "TpmsPressureFr": round(3.0 + random.gauss(0, 0.03), 2),
        "TpmsPressureRl": round(3.0 + random.gauss(0, 0.03), 2),
        "TpmsPressureRr": round(3.0 + random.gauss(0, 0.03), 2),
        "Locked": True, "SentryMode": False,
        "VehicleName": "Test Model 3",
        "Version": "2026.12.3",
        # Expanded signals
        "SeatHeaterLeft": random.randint(0, 3),
        "SeatHeaterRight": random.randint(0, 3),
        "MediaPlaybackStatus": random.choice(["Playing", "Paused", "Stopped"]),
        "DestinationName": random.choice(DESTINATIONS),
    }

    for sig_name, val in signals.items():
        topic = f"{topic_base}/{VIN}/v/{sig_name}"
        payload = val if isinstance(val, str) else json.dumps(val)
        client.publish(topic, payload, qos=0)


# ---------------------------------------------------------------------------
# Batch insert helpers
# ---------------------------------------------------------------------------

def batch_insert_drives(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO drives (vehicle_id, start_date, end_date, distance, duration_min,
            speed_max, power_max, power_min, start_battery_level, end_battery_level,
            start_range_km, end_range_km, inside_temp_avg, outside_temp_avg)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_positions(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO positions (vehicle_id, latitude, longitude, speed, power, heading,
            elevation, odometer, ideal_range, rated_range, battery_level,
            inside_temp, outside_temp, fan_status, is_climate_on, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_motors(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO motor_snapshots (vehicle_id, di_state, di_torque, di_axle_speed,
            di_stator_temp, pedal_position, brake_pedal, lateral_accel,
            longitudinal_accel, vehicle_speed, gear,
            di_torque_actual_f, di_torque_actual_r,
            di_torque_actual_rel, di_torque_actual_rer,
            di_axle_speed_f, di_axle_speed_rel, di_axle_speed_rer,
            di_state_f, di_state_rel, di_state_rer,
            di_stator_temp_f, di_stator_temp_rel, di_stator_temp_rer,
            di_heatsink_t_f, di_heatsink_t_r, di_heatsink_t_rel, di_heatsink_t_rer,
            di_inverter_t_f, di_inverter_t_r, di_inverter_t_rel, di_inverter_t_rer,
            di_motor_current_f, di_motor_current_r,
            di_motor_current_rel, di_motor_current_rer,
            di_v_bat_f, di_v_bat_r, di_v_bat_rel, di_v_bat_rer,
            di_slave_torque_cmd,
            hvil, brake_pedal_pos, cruise_set_speed, drive_rail,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_climates(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp, hvac_power,
            hvac_fan_speed, hvac_left_temp_request, hvac_right_temp_request,
            cabin_overheat_mode, defrost_mode, battery_heater_on,
            hvac_ac_enabled, hvac_auto_mode, hvac_fan_status,
            hvac_steering_wheel_heat_auto, hvac_steering_wheel_heat_level,
            climate_keeper_mode, cabin_overheat_protection_temp_limit,
            defrost_for_preconditioning,
            seat_heater_left, seat_heater_right,
            seat_heater_rear_left, seat_heater_rear_center, seat_heater_rear_right,
            seat_vent_enabled,
            climate_seat_cooling_front_left, climate_seat_cooling_front_right,
            auto_seat_climate_left, auto_seat_climate_right,
            rear_defrost_enabled, rear_display_hvac_enabled,
            wiper_heat_enabled,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_securities(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO security_events (vehicle_id, locked, sentry_mode, door_state,
            fd_window, fp_window, rd_window, rp_window, homelink_nearby, guest_mode,
            homelink_device_count, guest_mode_mobile_access_state,
            driver_seat_occupied, center_display,
            speed_limit_mode, valet_mode_enabled, service_mode,
            current_limit_mph, paired_phone_key_count,
            lights_hazards_active, lights_high_beams, lights_turn_signal,
            tonneau_position, tonneau_open_percent, tonneau_tent_mode,
            driver_seat_belt, passenger_seat_belt,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_states(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO vehicle_states (vehicle_id, state, start_date, end_date,
            duration_min, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_mileages(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO daily_mileage (vehicle_id, date, distance_km, odometer_start,
            odometer_end, drive_count, energy_used_kwh)
        VALUES %s
        ON CONFLICT (vehicle_id, date) DO UPDATE SET
            distance_km = EXCLUDED.distance_km,
            odometer_end = EXCLUDED.odometer_end,
            drive_count = EXCLUDED.drive_count,
            energy_used_kwh = EXCLUDED.energy_used_kwh
    """, rows)
    return len(rows)


def batch_insert_charging(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO charging_sessions (vehicle_id, start_date, end_date,
            charge_energy_added, charge_energy_used, start_battery_level,
            end_battery_level, start_range_km, end_range_km, charger_phases,
            charger_voltage, charger_actual_current, charger_power,
            fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_battery(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh,
            degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_tire(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right,
            rear_left, rear_right, hard_warnings, soft_warnings,
            last_seen_fl, last_seen_fr, last_seen_rl, last_seen_rr, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_vampire(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO vampire_drain_events (vehicle_id, start_date, end_date,
            start_battery, end_battery, battery_lost, range_lost_km,
            duration_hours, drain_rate_pct_per_hour, outside_temp_avg,
            sentry_mode, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_updates(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO software_updates (vehicle_id, version, status, scheduled_at,
            installed_at, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_alerts(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO alerts (vehicle_id, type, severity, title, message, is_read, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_charging_telemetry(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO charging_telemetry (vehicle_id,
            battery_level, soc, charge_state, detailed_charge_state,
            charge_limit_soc, charge_amps, charge_current_request,
            charge_current_request_max, charge_enable_request,
            charger_voltage, charger_phases, charge_rate_mph,
            dc_charging_power, dc_charging_energy_in,
            ac_charging_power, ac_charging_energy_in,
            energy_remaining, est_battery_range, ideal_battery_range, rated_range,
            pack_voltage, pack_current,
            charge_port_door_open, charge_port_latch, charge_port_cold_weather_mode,
            charging_cable_type, fast_charger_present, fast_charger_type,
            time_to_full_charge, estimated_hours_to_charge,
            scheduled_charging_mode, scheduled_charging_pending,
            preconditioning_enabled,
            brick_voltage_max, brick_voltage_min,
            num_brick_voltage_max, num_brick_voltage_min,
            module_temp_max, module_temp_min,
            num_module_temp_max, num_module_temp_min,
            battery_heater_on, not_enough_power_to_heat,
            bms_state, bms_fullcharge_complete,
            dcdc_enable, isolation_resistance, lifetime_energy_used,
            supercharger_session_trip_planner,
            powershare_status, powershare_type, powershare_stop_reason,
            powershare_hours_left, powershare_power_kw,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_media(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO media_snapshots (vehicle_id,
            now_playing_title, now_playing_artist, now_playing_album,
            now_playing_station, now_playing_duration, now_playing_elapsed,
            playback_status, playback_source, audio_volume, audio_volume_max,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_vehicle_config(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO vehicle_config_snapshots (vehicle_id,
            car_type, trim, exterior_color, roof_color, wheel_type,
            rear_seat_heaters, sunroof_installed, efficiency_package,
            europe_vehicle, right_hand_drive, remote_start_enabled,
            charge_port, offroad_lightbar_present,
            version, vehicle_name,
            software_update_version, software_update_download_pct,
            software_update_install_pct, software_update_expected_duration,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_location(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO location_snapshots (vehicle_id,
            destination_name, destination_lat, destination_lon,
            origin_lat, origin_lon,
            miles_to_arrival, minutes_to_arrival,
            route_line, route_traffic_delay_min,
            located_at_home, located_at_work, located_at_favorite,
            gps_state,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_safety(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO safety_snapshots (vehicle_id,
            automatic_blind_spot_camera, automatic_emergency_braking_off,
            blind_spot_collision_warning, cruise_follow_distance,
            emergency_lane_departure_avoidance,
            forward_collision_warning, lane_departure_avoidance,
            speed_limit_warning, pin_to_drive_enabled,
            miles_since_reset, self_driving_miles_since_reset,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_user_prefs(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO user_preference_snapshots (vehicle_id,
            setting_24hr_time, setting_charge_unit,
            setting_distance_unit, setting_temperature_unit,
            setting_tire_pressure_unit,
            created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# Partition management
# ---------------------------------------------------------------------------

def create_all_partitions(conn):
    """Pre-create monthly partitions for the entire date range."""
    cur = conn.cursor()
    dt = START_DATE.replace(day=1)
    end = END_DATE.replace(day=1) + timedelta(days=32)
    end = end.replace(day=1)
    count = 0
    while dt <= end:
        ensure_partition(cur, dt)
        if dt.month == 12:
            dt = dt.replace(year=dt.year + 1, month=1)
        else:
            dt = dt.replace(month=dt.month + 1)
        count += 1
    conn.commit()
    cur.close()
    print(f"  ✓ Ensured {count} monthly position partitions exist")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Generate 25 years of historical TeslaSync data (2001–2026)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--db-host', default='localhost', help='PostgreSQL host (default: localhost)')
    parser.add_argument('--db-port', type=int, default=5432, help='PostgreSQL port (default: 5432)')
    parser.add_argument('--db-name', default='teslasync', help='Database name (default: teslasync)')
    parser.add_argument('--db-user', default='teslasync', help='Database user (default: teslasync)')
    parser.add_argument('--db-password', default='teslasync', help='Database password (default: teslasync)')
    parser.add_argument('--mqtt-host', default='localhost', help='MQTT broker host (default: localhost)')
    parser.add_argument('--mqtt-port', type=int, default=1883, help='MQTT broker port (default: 1883)')
    parser.add_argument('--topic-base', default='telemetry', help='MQTT topic base (default: telemetry)')
    parser.add_argument('--duration', type=int, default=14400,
                        help='Run duration in seconds (default: 14400 = 4 hours)')
    parser.add_argument('--batch-days', type=int, default=30,
                        help='Days of data to generate per batch (default: 30)')
    parser.add_argument('--seed', type=int, default=42, help='Random seed for reproducibility')
    args = parser.parse_args()

    random.seed(args.seed)
    start_wall = time.time()
    deadline = start_wall + args.duration

    print("=" * 72)
    print("  TeslaSync Historical Data Generator v2 — All 20 Tables")
    print("=" * 72)
    print(f"  VIN:        {VIN}  (vehicle_id={VEHICLE_ID})")
    print(f"  Date range: {START_DATE.date()} → {END_DATE.date()} ({TOTAL_DAYS} days)")
    print(f"  Duration:   {args.duration}s ({args.duration / 3600:.1f} hours)")
    print(f"  DB:         {args.db_user}@{args.db_host}:{args.db_port}/{args.db_name}")
    print(f"  MQTT:       {args.mqtt_host}:{args.mqtt_port}")
    print("=" * 72)

    # ── Connect to PostgreSQL ──────────────────────────────────────────────
    print("\n⏳ Connecting to PostgreSQL…")
    try:
        conn = psycopg2.connect(
            host=args.db_host, port=args.db_port, dbname=args.db_name,
            user=args.db_user, password=args.db_password,
        )
        conn.autocommit = False
        print("  ✓ Connected")
    except Exception as e:
        print(f"  ✗ PostgreSQL connection failed: {e}")
        sys.exit(1)

    # ── Connect to MQTT ────────────────────────────────────────────────────
    mqtt_client = None
    try:
        print("⏳ Connecting to MQTT broker…")
        mqtt_client = mqtt.Client(client_id="historical-data-gen-v2", protocol=mqtt.MQTTv311)
        mqtt_client.connect(args.mqtt_host, args.mqtt_port, keepalive=60)
        mqtt_client.loop_start()
        print("  ✓ Connected")
    except Exception as e:
        print(f"  ⚠ MQTT connection failed ({e}) — continuing without real-time events")
        mqtt_client = None

    # ── Pre-create partitions ──────────────────────────────────────────────
    print("\n⏳ Creating position partitions…")
    try:
        create_all_partitions(conn)
    except Exception as e:
        print(f"  ⚠ Partition creation issue (may already exist): {e}")
        conn.rollback()

    # ── Build date lists ───────────────────────────────────────────────────
    all_days = []
    d = START_DATE.date()
    while d <= END_DATE.date():
        all_days.append(d)
        d += timedelta(days=1)

    month_dates = []
    dt = START_DATE
    while dt < END_DATE:
        month_dates.append(dt + timedelta(days=random.randint(0, 27)))
        if dt.month == 12:
            dt = dt.replace(year=dt.year + 1, month=1)
        else:
            dt = dt.replace(month=dt.month + 1)

    week_dates = []
    dt = START_DATE
    while dt < END_DATE:
        week_dates.append(dt + timedelta(hours=random.uniform(8, 20)))
        dt += timedelta(days=7)

    total_batches = math.ceil(len(all_days) / args.batch_days)
    sleep_between = max(0, (args.duration - 180) / max(total_batches, 1))

    print(f"\n📊 Plan: {len(all_days)} days in {total_batches} batches of ~{args.batch_days} days")
    print(f"   Sleep between batches: {sleep_between:.1f}s")

    # ── Track all inserted records ─────────────────────────────────────────
    total_inserted = {
        'drives': 0, 'positions': 0, 'charging_sessions': 0,
        'daily_mileage': 0, 'vehicle_states': 0,
        'motor_snapshots': 0, 'climate_snapshots': 0, 'security_events': 0,
        'battery_snapshots': 0, 'tire_pressure': 0,
        'vampire_drain': 0, 'software_updates': 0, 'alerts': 0,
        'charging_telemetry': 0, 'media_snapshots': 0,
        'vehicle_config': 0, 'location_snapshots': 0,
        'safety_snapshots': 0, 'user_preferences': 0,
    }

    # ══════════════════════════════════════════════════════════════════════
    # Phase 0: One-off / low-frequency data
    # ══════════════════════════════════════════════════════════════════════
    print("\n── Phase 0: One-off / periodic data ───────────────────────────")

    cur = conn.cursor()
    try:
        # Software updates (~100 over 25 years)
        sw_updates = generate_software_updates()
        n = batch_insert_updates(cur, sw_updates)
        conn.commit()
        total_inserted['software_updates'] += n
        print(f"  ✓ Software updates: {n}")

        # Alerts (~150)
        alert_rows = generate_alerts()
        n = batch_insert_alerts(cur, alert_rows)
        conn.commit()
        total_inserted['alerts'] += n
        print(f"  ✓ Alerts: {n}")

        # Battery snapshots (~300 monthly)
        batt_rows = generate_battery_snapshots(month_dates)
        n = batch_insert_battery(cur, batt_rows)
        conn.commit()
        total_inserted['battery_snapshots'] += n
        print(f"  ✓ Battery snapshots: {n}")

        # Tire pressure (~1,300 weekly with expanded columns)
        tire_rows = generate_tire_pressure(week_dates)
        n = batch_insert_tire(cur, tire_rows)
        conn.commit()
        total_inserted['tire_pressure'] += n
        print(f"  ✓ Tire pressure snapshots: {n}")

        # Vampire drain (~500)
        vamp_rows = generate_vampire_drain(month_dates)
        n = batch_insert_vampire(cur, vamp_rows)
        conn.commit()
        total_inserted['vampire_drain'] += n
        print(f"  ✓ Vampire drain events: {n}")

        # Vehicle config snapshots (~100, tied to software updates)
        config_rows = generate_vehicle_config_snapshots(sw_updates)
        n = batch_insert_vehicle_config(cur, config_rows)
        conn.commit()
        total_inserted['vehicle_config'] += n
        print(f"  ✓ Vehicle config snapshots: {n}")

        # Safety snapshots (~50, every 6 months)
        odo_for_safety = {'value': 0.0}
        safety_rows = generate_safety_snapshots(month_dates, odo_for_safety)
        n = batch_insert_safety(cur, safety_rows)
        conn.commit()
        total_inserted['safety_snapshots'] += n
        print(f"  ✓ Safety snapshots: {n}")

        # User preference snapshots (~50)
        pref_rows = generate_user_preference_snapshots()
        n = batch_insert_user_prefs(cur, pref_rows)
        conn.commit()
        total_inserted['user_preferences'] += n
        print(f"  ✓ User preference snapshots: {n}")

    except Exception as e:
        conn.rollback()
        print(f"  ⚠ Phase 0 error: {e}")
        traceback.print_exc()
    cur.close()

    # ══════════════════════════════════════════════════════════════════════
    # Phase 1: Daily data in monthly batches
    # ══════════════════════════════════════════════════════════════════════
    print("\n── Phase 1: Daily data (drives, charging, positions, telemetry) ─")
    odometer = {'value': 500.0}
    batch_num = 0
    last_progress = time.time()

    for batch_start in range(0, len(all_days), args.batch_days):
        if _shutdown:
            break
        if time.time() > deadline:
            print("\n⏰ Duration limit reached — stopping.")
            break

        batch_num += 1
        batch_days = all_days[batch_start:batch_start + args.batch_days]
        batch_label = f"{batch_days[0]} → {batch_days[-1]}"

        cur = conn.cursor()
        try:
            # Generate drives + associated telemetry across all related tables
            (drives, positions, motors, climates, securities,
             drive_states, mileages, media, locations) = generate_drives(batch_days, odometer)

            n_d = batch_insert_drives(cur, drives)
            conn.commit()

            n_p = batch_insert_positions(cur, positions)
            conn.commit()

            n_m = batch_insert_motors(cur, motors)
            conn.commit()

            n_cl = batch_insert_climates(cur, climates)
            conn.commit()

            n_se = batch_insert_securities(cur, securities)
            conn.commit()

            n_med = batch_insert_media(cur, media)
            conn.commit()

            n_loc = batch_insert_location(cur, locations)
            conn.commit()

            # Charging sessions + charging telemetry
            charge_rows, charge_states, charge_telem = generate_charging_sessions(batch_days)

            n_ch = batch_insert_charging(cur, charge_rows)
            conn.commit()

            n_ct = batch_insert_charging_telemetry(cur, charge_telem)
            conn.commit()

            # All vehicle states (drive + charge + sleep)
            sleep_states = generate_sleep_states(batch_days)
            all_states = drive_states + charge_states + sleep_states
            n_st = batch_insert_states(cur, all_states)
            conn.commit()

            # Daily mileage
            n_mi = batch_insert_mileages(cur, mileages)
            conn.commit()

            total_inserted['drives'] += n_d
            total_inserted['positions'] += n_p
            total_inserted['motor_snapshots'] += n_m
            total_inserted['climate_snapshots'] += n_cl
            total_inserted['security_events'] += n_se
            total_inserted['media_snapshots'] += n_med
            total_inserted['location_snapshots'] += n_loc
            total_inserted['charging_sessions'] += n_ch
            total_inserted['charging_telemetry'] += n_ct
            total_inserted['vehicle_states'] += n_st
            total_inserted['daily_mileage'] += n_mi

        except Exception as e:
            conn.rollback()
            print(f"  ⚠ Batch {batch_num} error: {e}")
            traceback.print_exc()
        finally:
            cur.close()

        # Progress report
        now = time.time()
        if now - last_progress >= 30 or batch_num == 1 or batch_start + args.batch_days >= len(all_days):
            elapsed = now - start_wall
            pct = min(100, batch_start / len(all_days) * 100)
            total_recs = sum(total_inserted.values())
            eta = (elapsed / max(pct, 0.1) * (100 - pct)) if pct > 0 else 0
            print(f"  [{elapsed:7.0f}s] Batch {batch_num}/{total_batches}  "
                  f"{batch_label}  {pct:5.1f}%  "
                  f"records={total_recs:,}  odo={odometer['value']:,.0f}km  "
                  f"ETA {eta / 60:.0f}min")
            last_progress = now

        # Publish MQTT snapshot for live dashboard
        if mqtt_client:
            try:
                publish_mqtt_snapshot(mqtt_client, args.topic_base)
            except Exception:
                pass

        # Pace to fill the duration
        if sleep_between > 0 and not _shutdown:
            time.sleep(min(sleep_between, 2.0))

    # ══════════════════════════════════════════════════════════════════════
    # Phase 2: Trips (depend on drives being inserted first)
    # ══════════════════════════════════════════════════════════════════════
    if not _shutdown:
        print("\n── Phase 2: Trips ─────────────────────────────────────────────")
        try:
            generate_trips(conn)
        except Exception as e:
            print(f"  ⚠ Trip generation error: {e}")
            traceback.print_exc()

    # ══════════════════════════════════════════════════════════════════════
    # Phase 3: Continuous MQTT for remaining duration
    # ══════════════════════════════════════════════════════════════════════
    if mqtt_client and not _shutdown:
        remaining = deadline - time.time()
        if remaining > 10:
            print(f"\n── Phase 3: Real-time MQTT events ({remaining / 60:.0f} min remaining) ──")
            mqtt_cycles = 0
            while time.time() < deadline and not _shutdown:
                try:
                    publish_mqtt_snapshot(mqtt_client, args.topic_base)
                    mqtt_cycles += 1
                    if mqtt_cycles % 60 == 0:
                        elapsed = time.time() - start_wall
                        print(f"  [{elapsed:7.0f}s] MQTT cycles: {mqtt_cycles}")
                except Exception:
                    pass
                time.sleep(5)

    # ══════════════════════════════════════════════════════════════════════
    # Summary
    # ══════════════════════════════════════════════════════════════════════
    elapsed = time.time() - start_wall
    total_recs = sum(total_inserted.values())
    print("\n" + "=" * 72)
    print("  Generation Complete!")
    print("=" * 72)
    print(f"  Duration:      {elapsed:.0f}s ({elapsed / 3600:.2f} hours)")
    print(f"  Odometer:      {odometer['value']:,.1f} km")
    print(f"  Total records: {total_recs:,}")
    print(f"  Breakdown:")
    for k, v in sorted(total_inserted.items()):
        print(f"    {k:25s}: {v:>8,}")
    print("=" * 72)

    # Cleanup
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    conn.close()


if __name__ == '__main__':
    main()
