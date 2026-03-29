#!/usr/bin/env python3
"""Historical data generator for TeslaSync — generates 10 years of realistic vehicle data.

Inserts directly into PostgreSQL with backdated timestamps spanning 2016-03-28 to 2026-03-28.
Distributes work over a configurable duration (default 5 hours) and also publishes real-time
MQTT events so the live dashboard stays updated.

Usage:
    python tests/historical_data_generator.py --db-host localhost --mqtt-host localhost
"""

import argparse
import json
import math
import random
import signal
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary'])
    import psycopg2
    from psycopg2.extras import execute_values

try:
    import paho.mqtt.client as mqtt
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paho-mqtt'])
    import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
VEHICLE_ID = 1
VIN = "5YJ3E1EA327874020"
BATTERY_CAPACITY_KWH = 75.0
START_DATE = datetime(2016, 3, 28, tzinfo=timezone.utc)
END_DATE = datetime(2026, 3, 28, tzinfo=timezone.utc)
TOTAL_DAYS = (END_DATE - START_DATE).days  # ~3653

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
    # Fast degradation first 2 years, then levels off
    deg_pct = min(12.0, 4.0 * math.log1p(years_since_start * 1.2))
    health = round(100.0 - deg_pct, 2)
    capacity = round(BATTERY_CAPACITY_KWH * health / 100.0, 2)
    est_range = round(450.0 * health / 100.0, 1)
    cycles = int(years_since_start * 150)
    return dict(health=health, capacity=capacity, deg_pct=round(deg_pct, 2),
                est_range=est_range, cycles=cycles)


def range_for_battery(battery_pct: int, years: float) -> float:
    """Estimated range in km for a given battery percentage."""
    max_range = 350 + years * 3  # slight improvement via software
    max_range *= (100.0 - min(12, 4 * math.log1p(years * 1.2))) / 100.0
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
        # Bell-shaped: ramps up then down
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


# ---------------------------------------------------------------------------
# Data generators — each returns a list of tuples ready for execute_values
# ---------------------------------------------------------------------------

def generate_drives(day_dates: list, odometer_tracker: dict):
    """Generate drive records for a list of dates.

    Returns (drive_rows, position_rows, motor_rows, climate_rows, security_rows, state_rows, mileage_rows).
    """
    drives = []
    positions = []
    motors = []
    climates = []
    securities = []
    states = []
    mileages = []

    for dt_date in day_dates:
        if _shutdown:
            break
        weekday = dt_date.weekday()  # 0=Mon
        years = (dt_date - START_DATE.date()).days / 365.25

        # Decide number of drives today
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

            # Drive type
            roll = random.random()
            if roll < 0.06:  # road trip
                dist = random.uniform(200, 500)
                dur = random.uniform(120, 300)
                spd_max = random.uniform(120, 140)
            elif roll < 0.30:  # weekend / errand
                dist = random.uniform(50, 200)
                dur = random.uniform(45, 180)
                spd_max = random.uniform(100, 130)
            else:  # commute
                dist = random.uniform(15, 40)
                dur = random.uniform(20, 40)
                spd_max = random.uniform(80, 100)

            dist = round(dist, 1)
            dur = round(dur, 1)
            spd_max = round(spd_max, 1)

            # Battery
            battery_drain = dist * random.uniform(0.2, 0.3)  # % per km roughly
            start_batt = random.randint(40, 95)
            end_batt = max(5, int(start_batt - battery_drain))
            start_range = range_for_battery(start_batt, years)
            end_range = range_for_battery(end_batt, years)

            power_max = round(random.uniform(150, 350), 1)
            power_min = round(random.uniform(-80, -20), 1)  # regen

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

            # Vehicle state: driving
            states.append((VEHICLE_ID, 'driving', start_dt, end_dt, dur, start_dt))

            # Positions along the drive
            route = ROUTES[random.choice(ROUTE_NAMES)]
            n_pts = random.randint(10, 20)
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

                # Motor snapshot (~30% of position points)
                if random.random() < 0.3:
                    gear = 'D' if speeds[j] > 0 else 'P'
                    motors.append((
                        VEHICLE_ID,
                        'enabled' if speeds[j] > 0 else 'standby',
                        round(random.uniform(50, 400), 1),
                        round(speeds[j] * random.uniform(8, 12), 1),
                        round(random.uniform(30, 90), 1),
                        round(random.uniform(0, 100), 1),
                        speeds[j] < 1,
                        round(random.uniform(-2, 2), 2),
                        round(random.uniform(-3, 5), 2),
                        speeds[j],
                        gear,
                        pt_time,
                    ))

                # Climate snapshot (~20% of points)
                if random.random() < 0.2:
                    climates.append((
                        VEHICLE_ID, in_temp, out_temp,
                        round(random.uniform(0, 5), 2),
                        random.randint(0, 7),
                        round(random.uniform(18, 24), 1),
                        round(random.uniform(18, 24), 1),
                        random.choice(['Off', 'On', 'FanOnly']),
                        out_temp < 2,
                        out_temp < -5,
                        pt_time,
                    ))

            # Security events: unlock at start, lock at end
            securities.append((
                VEHICLE_ID, False, False, 'closed', 'closed', 'closed', 'closed', 'closed',
                random.random() > 0.7, False, start_dt,
            ))
            securities.append((
                VEHICLE_ID, True, random.random() > 0.6, 'closed', 'closed', 'closed', 'closed', 'closed',
                False, False, end_dt,
            ))

            day_distance += dist
            day_energy += dist * random.uniform(0.14, 0.20)
            day_drive_count += 1

        # Daily mileage
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

    return drives, positions, motors, climates, securities, states, mileages


def generate_charging_sessions(day_dates: list, rng_state: dict):
    """Generate charging sessions.  ~0.82 sessions per day on average."""
    sessions = []
    states = []
    for dt_date in day_dates:
        if _shutdown:
            break
        # ~82% chance of charging on a given day
        if random.random() > 0.82:
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
        elif roll < 0.85:  # work L2
            voltage, phases, current = 240, 1, 48
            power = round(voltage * current / 1000, 1)
            cable, fast_type, fast_brand = 'SAE', None, None
            dur = random.uniform(120, 360)
            cost_per_kwh = 0.15
            start_batt = random.randint(25, 45)
            end_batt = random.randint(70, 90)
            hour = random.uniform(9, 11)
        else:  # supercharger
            voltage, phases, current = 480, 3, 250
            power = round(random.uniform(72, 250), 1)
            cable, fast_type, fast_brand = 'Tesla', 'Tesla Supercharger', 'Tesla'
            dur = random.uniform(20, 45)
            cost_per_kwh = 0.30
            start_batt = random.randint(10, 20)
            end_batt = random.randint(75, 90)
            hour = random.uniform(10, 18)

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

    return sessions, states


def generate_battery_snapshots(month_dates: list):
    """~1 snapshot per month."""
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
    """~1 snapshot per week."""
    rows = []
    for dt in week_dates:
        if _shutdown:
            break
        out_temp = seasonal_temp(dt)
        # Higher in warm weather, lower in cold
        temp_offset = (out_temp - 15) * 0.005
        base = 3.0 + temp_offset
        fl = round(base + random.gauss(0, 0.05), 2)
        fr = round(base + random.gauss(0, 0.05), 2)
        rl = round(base + random.gauss(0, 0.05), 2)
        rr = round(base + random.gauss(0, 0.05), 2)
        # Occasional low-pressure event (~3%)
        if random.random() < 0.03:
            idx = random.randint(0, 3)
            vals = [fl, fr, rl, rr]
            vals[idx] = round(random.uniform(2.0, 2.5), 2)
            fl, fr, rl, rr = vals
        rows.append((VEHICLE_ID, fl, fr, rl, rr, dt))
    return rows


def generate_vampire_drain(month_dates: list):
    """~1.7 events per month → ~200 over 10 years."""
    rows = []
    for dt in month_dates:
        if _shutdown:
            break
        # 1-2 events per month
        n = random.choices([1, 2, 3], weights=[50, 40, 10])[0]
        for _ in range(n):
            out_temp = seasonal_temp(dt)
            sentry = random.random() > 0.5
            dur_hours = random.uniform(8, 72)
            if sentry:
                rate = random.uniform(0.5, 1.5)
            else:
                rate = random.uniform(0.2, 0.5)
            # Worse in cold
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
    """~4 per year → ~40 total."""
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
    """~50 alerts over 10 years."""
    rows = []
    for _ in range(50):
        if _shutdown:
            break
        days_offset = random.randint(0, TOTAL_DAYS - 1)
        dt = START_DATE + timedelta(days=days_offset, hours=random.uniform(0, 23))
        a = random.choice(ALERT_TYPES)
        rows.append((VEHICLE_ID, a[0], a[1], a[2], a[3], True, dt))
    rows.sort(key=lambda r: r[6])
    return rows


def generate_sleep_states(day_dates: list):
    """Generate asleep / online / updating states to fill gaps."""
    rows = []
    for dt_date in day_dates:
        if _shutdown:
            break
        base = datetime.combine(dt_date, datetime.min.time(), tzinfo=timezone.utc)
        # Asleep overnight
        s1 = base + timedelta(hours=random.uniform(0, 1))
        e1 = base + timedelta(hours=random.uniform(6, 7))
        rows.append((VEHICLE_ID, 'asleep', s1, e1, round((e1 - s1).total_seconds() / 60, 1), s1))

        # Possibly online for app check
        if random.random() < 0.3:
            s2 = base + timedelta(hours=random.uniform(10, 14))
            e2 = s2 + timedelta(minutes=random.uniform(2, 15))
            rows.append((VEHICLE_ID, 'online', s2, e2, round((e2 - s2).total_seconds() / 60, 1), s2))

        # Asleep again
        s3 = base + timedelta(hours=random.uniform(21, 23))
        e3 = base + timedelta(hours=23, minutes=59)
        rows.append((VEHICLE_ID, 'asleep', s3, e3, round((e3 - s3).total_seconds() / 60, 1), s3))

    return rows


def generate_trips(conn):
    """Generate ~100 trips from existing drives in the database."""
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

    while len(trips) < 100 and attempts < 300:
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
        "Odometer": round(random.uniform(50000, 140000), 1),
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
            longitudinal_accel, vehicle_speed, gear, created_at)
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
            cabin_overheat_mode, defrost_mode, battery_heater_on, created_at)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, rows)
    return len(rows)


def batch_insert_securities(cur, rows):
    if not rows:
        return 0
    execute_values(cur, """
        INSERT INTO security_events (vehicle_id, locked, sentry_mode, door_state,
            fd_window, fp_window, rd_window, rp_window, homelink_nearby,
            guest_mode, created_at)
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
            rear_left, rear_right, created_at)
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
        description='Generate 10 years of historical TeslaSync data (2016–2026)',
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
    parser.add_argument('--duration', type=int, default=18000,
                        help='Run duration in seconds (default: 18000 = 5 hours)')
    parser.add_argument('--batch-days', type=int, default=30,
                        help='Days of data to generate per batch (default: 30)')
    parser.add_argument('--seed', type=int, default=42, help='Random seed for reproducibility')
    args = parser.parse_args()

    random.seed(args.seed)
    start_wall = time.time()
    deadline = start_wall + args.duration

    print("=" * 70)
    print("  TeslaSync Historical Data Generator")
    print("=" * 70)
    print(f"  VIN:        {VIN}  (vehicle_id={VEHICLE_ID})")
    print(f"  Date range: {START_DATE.date()} → {END_DATE.date()} ({TOTAL_DAYS} days)")
    print(f"  Duration:   {args.duration}s ({args.duration / 3600:.1f} hours)")
    print(f"  DB:         {args.db_user}@{args.db_host}:{args.db_port}/{args.db_name}")
    print(f"  MQTT:       {args.mqtt_host}:{args.mqtt_port}")
    print("=" * 70)

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
        mqtt_client = mqtt.Client(client_id="historical-data-gen", protocol=mqtt.MQTTv311)
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

    # ── Build day list and compute pacing ──────────────────────────────────
    all_days = []
    d = START_DATE.date()
    while d <= END_DATE.date():
        all_days.append(d)
        d += timedelta(days=1)

    total_batches = math.ceil(len(all_days) / args.batch_days)
    sleep_between = max(0, (args.duration - 120) / max(total_batches, 1))  # reserve 2 min for trips/one-off

    print(f"\n📊 Plan: {len(all_days)} days in {total_batches} batches of ~{args.batch_days} days")
    print(f"   Sleep between batches: {sleep_between:.1f}s")

    # ── One-off data: software updates, alerts ─────────────────────────────
    print("\n── Phase 0: One-off data ──────────────────────────────────────")
    cur = conn.cursor()
    try:
        updates = generate_software_updates()
        n = batch_insert_updates(cur, updates)
        conn.commit()
        print(f"  ✓ Software updates: {n}")

        alerts = generate_alerts()
        n = batch_insert_alerts(cur, alerts)
        conn.commit()
        print(f"  ✓ Alerts: {n}")
    except Exception as e:
        conn.rollback()
        print(f"  ⚠ One-off insert error: {e}")
    cur.close()

    # ── Battery snapshots (monthly) ────────────────────────────────────────
    print("\n── Phase 0b: Battery snapshots (monthly) ──────────────────────")
    month_dates = []
    dt = START_DATE
    while dt < END_DATE:
        month_dates.append(dt + timedelta(days=random.randint(0, 27)))
        if dt.month == 12:
            dt = dt.replace(year=dt.year + 1, month=1)
        else:
            dt = dt.replace(month=dt.month + 1)

    cur = conn.cursor()
    try:
        batt_rows = generate_battery_snapshots(month_dates)
        n = batch_insert_battery(cur, batt_rows)
        conn.commit()
        print(f"  ✓ Battery snapshots: {n}")
    except Exception as e:
        conn.rollback()
        print(f"  ⚠ Battery snapshot error: {e}")
    cur.close()

    # ── Tire pressure (weekly) ─────────────────────────────────────────────
    print("\n── Phase 0c: Tire pressure (weekly) ───────────────────────────")
    week_dates = []
    dt = START_DATE
    while dt < END_DATE:
        week_dates.append(dt + timedelta(hours=random.uniform(8, 20)))
        dt += timedelta(days=7)

    cur = conn.cursor()
    try:
        tire_rows = generate_tire_pressure(week_dates)
        n = batch_insert_tire(cur, tire_rows)
        conn.commit()
        print(f"  ✓ Tire pressure: {n}")
    except Exception as e:
        conn.rollback()
        print(f"  ⚠ Tire pressure error: {e}")
    cur.close()

    # ── Vampire drain (monthly generation) ─────────────────────────────────
    print("\n── Phase 0d: Vampire drain events ─────────────────────────────")
    cur = conn.cursor()
    try:
        vamp_rows = generate_vampire_drain(month_dates)
        n = batch_insert_vampire(cur, vamp_rows)
        conn.commit()
        print(f"  ✓ Vampire drain events: {n}")
    except Exception as e:
        conn.rollback()
        print(f"  ⚠ Vampire drain error: {e}")
    cur.close()

    # ── Main loop: daily data in batches ───────────────────────────────────
    print("\n── Phase 1: Daily data (drives, charging, positions, states) ─")
    odometer = {'value': 500.0}
    total_inserted = {
        'drives': 0, 'positions': 0, 'charging': 0, 'mileage': 0,
        'motors': 0, 'climates': 0, 'securities': 0, 'states': 0,
    }
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
            # Drives + positions + motor/climate/security/states + mileage
            drives, positions, motors, climates, securities, drive_states, mileages = \
                generate_drives(batch_days, odometer)

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

            # Charging
            charge_rows, charge_states = generate_charging_sessions(batch_days, {})
            n_ch = batch_insert_charging(cur, charge_rows)
            conn.commit()

            # All states (drive + charge + sleep)
            sleep_states = generate_sleep_states(batch_days)
            all_states = drive_states + charge_states + sleep_states
            n_st = batch_insert_states(cur, all_states)
            conn.commit()

            # Daily mileage
            n_mi = batch_insert_mileages(cur, mileages)
            conn.commit()

            total_inserted['drives'] += n_d
            total_inserted['positions'] += n_p
            total_inserted['motors'] += n_m
            total_inserted['climates'] += n_cl
            total_inserted['securities'] += n_se
            total_inserted['charging'] += n_ch
            total_inserted['states'] += n_st
            total_inserted['mileage'] += n_mi

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
            time.sleep(min(sleep_between, 2.0))  # cap at 2s for responsiveness

    # ── Phase 2: Trips (depends on drives being inserted) ──────────────────
    if not _shutdown:
        print("\n── Phase 2: Trips ─────────────────────────────────────────────")
        try:
            generate_trips(conn)
        except Exception as e:
            print(f"  ⚠ Trip generation error: {e}")
            traceback.print_exc()

    # ── Phase 3: Continuous MQTT for remaining duration ─────────────────────
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

    # ── Summary ────────────────────────────────────────────────────────────
    elapsed = time.time() - start_wall
    total_recs = sum(total_inserted.values())
    print("\n" + "=" * 70)
    print("  Generation Complete!")
    print("=" * 70)
    print(f"  Duration:      {elapsed:.0f}s ({elapsed / 3600:.2f} hours)")
    print(f"  Odometer:      {odometer['value']:,.1f} km")
    print(f"  Total records: {total_recs:,}")
    print(f"  Breakdown:")
    for k, v in sorted(total_inserted.items()):
        print(f"    {k:15s}: {v:>8,}")
    print("=" * 70)

    # Cleanup
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    conn.close()


if __name__ == '__main__':
    main()
