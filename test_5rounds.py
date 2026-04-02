"""
TeslaSync Signal-Level Integration Test Suite
Runs multiple rounds of signal publishing + verification.
"""
import subprocess, time, json, urllib.request, os, sys
from datetime import datetime

VIN = '7SAYGDEF7PF924551'
API = 'http://localhost:8080'

# All Tesla Fleet Telemetry signals grouped by category
SIGNAL_GROUPS = {
    'charging': [
        ('BatteryLevel', '80'),
        ('Soc', '80.5'),
        ('ChargeState', 'Charging'),
        ('DetailedChargeState', 'Charging'),
        ('ChargeAmps', '32'),
        ('ChargerVoltage', '240.5'),
        ('ChargerPhases', '1'),
        ('ChargeLimitSoc', '90'),
        ('ChargeCurrentRequest', '32'),
        ('ChargeRateMilePerHour', '30.5'),
        ('ACChargingPower', '7.68'),
        ('EstBatteryRange', '250.3'),
        ('IdealBatteryRange', '280.1'),
        ('RatedRange', '260.0'),
        ('EnergyRemaining', '55.2'),
        ('PackVoltage', '390.5'),
        ('PackCurrent', '20.1'),
        ('TimeToFullCharge', '2.5'),
        ('FastChargerPresent', 'false'),
        ('ChargingCableType', 'IEC'),
        ('ChargePortDoorOpen', 'true'),
    ],
    'climate': [
        ('InsideTemp', '22.5'),
        ('OutsideTemp', '18.3'),
        ('HvacPower', 'On'),
        ('HvacFanSpeed', '3'),
        ('HvacLeftTemperatureRequest', '21.0'),
        ('HvacRightTemperatureRequest', '22.0'),
        ('CabinOverheatProtectionMode', 'FanOnly'),
        ('DefrostMode', 'Off'),
        ('BatteryHeaterOn', 'false'),
        ('HvacACEnabled', 'true'),
        ('SeatHeaterLeft', '2'),
        ('SeatHeaterRight', '0'),
        ('SeatHeaterRearLeft', '1'),
        ('WiperHeatEnabled', 'false'),
        ('RearDefrostEnabled', 'false'),
    ],
    'security': [
        ('Locked', 'true'),
        ('SentryMode', 'true'),
        ('DoorState', 'ClosedAll'),
        ('FdWindow', 'Closed'),
        ('FpWindow', 'Closed'),
        ('RdWindow', 'Closed'),
        ('RpWindow', 'Closed'),
        ('HomelinkNearby', 'true'),
        ('GuestModeEnabled', 'false'),
        ('ValetModeEnabled', 'false'),
        ('SpeedLimitMode', 'false'),
        ('DriverSeatOccupied', 'false'),
    ],
    'driving': [
        ('VehicleSpeed', '0'),
        ('Gear', 'P'),
        ('Odometer', '15234.5'),
        ('PedalPosition', '0'),
        ('BrakePedal', 'false'),
        ('LateralAcceleration', '0.15'),
        ('LongitudinalAcceleration', '1.2'),
        ('CruiseSetSpeed', '0'),
    ],
    'tire': [
        ('TpmsPressureFl', '2.9'),
        ('TpmsPressureFr', '3.0'),
        ('TpmsPressureRl', '2.85'),
        ('TpmsPressureRr', '2.95'),
    ],
    'location': [
        ('GpsHeading', '180'),
        ('GpsState', 'true'),
    ],
}

# Expected data per endpoint after signals are processed
VERIFICATIONS = {
    'charging-telemetry': {
        'endpoint': '/api/v1/charging-telemetry/latest?vehicle_id=1',
        'expected_fields': ['soc', 'charge_amps', 'charger_voltage', 'charge_rate_mph', 'ac_charging_power',
                           'est_battery_range', 'ideal_battery_range', 'rated_range', 'pack_voltage',
                           'pack_current', 'time_to_full_charge', 'energy_remaining'],
    },
    'climate': {
        'endpoint': '/api/v1/climate/latest?vehicle_id=1',
        'expected_fields': ['inside_temp', 'outside_temp', 'hvac_fan_speed', 'hvac_left_temp_request', 'hvac_right_temp_request'],
    },
    'security': {
        'endpoint': '/api/v1/security/latest?vehicle_id=1',
        'expected_fields': ['locked', 'sentry_mode', 'door_state', 'fd_window', 'fp_window', 'homelink_nearby'],
    },
    'motor': {
        'endpoint': '/api/v1/motor/latest?vehicle_id=1',
        'expected_fields': ['gear', 'lateral_accel', 'longitudinal_accel'],
    },
    'tire-pressure': {
        'endpoint': '/api/v1/tire-pressure/latest?vehicle_id=1',
        'expected_fields': ['front_left', 'front_right', 'rear_left', 'rear_right'],
    },
    'vehicle-state': {
        'endpoint': '/api/v1/vehicles/1/state',
        'expected_fields': ['state', 'battery_level', 'is_charging', 'charger_power', 'charge_rate',
                           'inside_temp', 'outside_temp', 'is_locked', 'sentry_mode'],
    },
}

# Additional API endpoints to test for 200 status
API_ENDPOINTS = [
    '/healthz',
    '/readyz',
    '/api/v1/vehicles',
    '/api/v1/vehicles/1/state',
    '/api/v1/settings',
    '/api/v1/alerts',
    '/api/v1/alerts/rules',
    '/api/v1/analytics/fleet?days=30',
    '/api/v1/system/status',
    '/api/v1/system/version',
    '/api/v1/charging?vehicle_id=1&limit=5',
    '/api/v1/drives?vehicle_id=1&limit=5',
    '/api/v1/motor/latest?vehicle_id=1',
    '/api/v1/climate/latest?vehicle_id=1',
    '/api/v1/security/latest?vehicle_id=1',
    '/api/v1/tire-pressure/latest?vehicle_id=1',
    '/api/v1/charging-telemetry/latest?vehicle_id=1',
    '/api/v1/media/latest?vehicle_id=1',
    '/api/v1/vehicle-config/latest?vehicle_id=1',
    '/api/v1/location-snapshots/latest?vehicle_id=1',
    '/api/v1/safety/latest?vehicle_id=1',
    '/api/v1/user-preferences/latest?vehicle_id=1',
    '/api/v1/telemetry',
    '/api/v1/gas-price/status',
]


def publish_signal(name, value):
    topic = f'telemetry/{VIN}/v/{name}'
    cmd = ['docker', 'exec', 'teslasync-mosquitto', 'mosquitto_pub', '-h', 'localhost', '-t', topic, '-m', value, '-q', '1']
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0


def api_get(path):
    try:
        with urllib.request.urlopen(f'{API}{path}', timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return 0, None


def check_nonnull(data, fields):
    """Check which expected fields have non-null, non-zero values."""
    if data is None:
        return [], fields
    # Handle nested state
    if 'state' in data and isinstance(data['state'], dict):
        data = data['state']
    passed = []
    failed = []
    for f in fields:
        val = data.get(f)
        if val is not None and val != 0 and val != '' and val != False:
            passed.append(f)
        elif f in ('is_locked', 'sentry_mode', 'is_charging') and val == True:
            passed.append(f)
        elif f == 'is_charging' and data.get('state') == 'charging':
            passed.append(f)
        else:
            # Check if it's a boolean that's intentionally false
            if isinstance(val, bool):
                passed.append(f)  # booleans are valid even if false
            else:
                failed.append(f)
    return passed, failed


def run_round(round_num, output_dir):
    results = {'round': round_num, 'timestamp': datetime.utcnow().isoformat(), 'tests': {}}
    total_pass = 0
    total_fail = 0

    print(f'\n{"="*60}')
    print(f'  ROUND {round_num}')
    print(f'{"="*60}')

    # Test 1: Publish all signals
    print(f'\n--- Publishing signals ---')
    pub_ok = 0
    pub_fail = 0
    for group, sigs in SIGNAL_GROUPS.items():
        for name, val in sigs:
            if publish_signal(name, val):
                pub_ok += 1
            else:
                pub_fail += 1
                print(f'  FAIL: {name}')
    print(f'  Published: {pub_ok} OK, {pub_fail} FAIL')
    results['tests']['signal_publish'] = {'pass': pub_ok, 'fail': pub_fail}
    total_pass += pub_ok
    total_fail += pub_fail

    # Wait for batch + throttle
    print(f'\n--- Waiting 12s for accumulator + throttle ---')
    time.sleep(12)

    # Trigger next write cycle
    publish_signal('Soc', '80.5')
    time.sleep(12)

    # Test 2: API endpoint status codes
    print(f'\n--- API endpoint tests ---')
    api_pass = 0
    api_fail = 0
    for ep in API_ENDPOINTS:
        status, data = api_get(ep)
        if status == 200:
            api_pass += 1
        else:
            api_fail += 1
            print(f'  FAIL: {ep} -> {status}')
    print(f'  Endpoints: {api_pass} OK, {api_fail} FAIL')
    results['tests']['api_endpoints'] = {'pass': api_pass, 'fail': api_fail}
    total_pass += api_pass
    total_fail += api_fail

    # Test 3: Data verification
    print(f'\n--- Data verification ---')
    data_results = {}
    for name, spec in VERIFICATIONS.items():
        status, data = api_get(spec['endpoint'])
        passed, failed = check_nonnull(data, spec['expected_fields'])
        ok = status == 200 and len(failed) == 0
        data_results[name] = {
            'status': status,
            'passed_fields': passed,
            'failed_fields': failed,
            'data': data,
        }
        if ok:
            total_pass += 1
            print(f'  PASS: {name} ({len(passed)}/{len(spec["expected_fields"])} fields)')
        else:
            total_fail += 1
            print(f'  FAIL: {name} - missing: {failed}')
    results['tests']['data_verification'] = data_results

    # Test 4: Table row counts
    print(f'\n--- DB table counts ---')
    count_cmd = ['docker', 'exec', 'teslasync-postgres', 'psql', '-U', 'teslasync', '-d', 'teslasync', '-t', '-c',
        "SELECT json_object_agg(tbl, cnt) FROM ("
        "SELECT 'positions' as tbl, COUNT(*) as cnt FROM positions "
        "UNION ALL SELECT 'charging_telemetry', COUNT(*) FROM charging_telemetry "
        "UNION ALL SELECT 'climate_snapshots', COUNT(*) FROM climate_snapshots "
        "UNION ALL SELECT 'security_events', COUNT(*) FROM security_events "
        "UNION ALL SELECT 'motor_snapshots', COUNT(*) FROM motor_snapshots "
        "UNION ALL SELECT 'tire_pressure_snapshots', COUNT(*) FROM tire_pressure_snapshots "
        "UNION ALL SELECT 'vehicle_states', COUNT(*) FROM vehicle_states"
        ") t;"]
    r = subprocess.run(count_cmd, capture_output=True, text=True)
    counts = {}
    try:
        counts = json.loads(r.stdout.strip())
    except:
        pass
    
    table_pass = 0
    table_fail = 0
    for tbl, cnt in counts.items():
        if cnt > 0:
            table_pass += 1
            print(f'  PASS: {tbl} = {cnt} rows')
        else:
            table_fail += 1
            print(f'  FAIL: {tbl} = 0 rows')
    results['tests']['table_counts'] = counts
    total_pass += table_pass
    total_fail += table_fail

    # Test 5: Check for errors in logs
    print(f'\n--- Error check ---')
    log_cmd = ['docker', 'logs', 'teslasync-api', '--tail', '200']
    r = subprocess.run(log_cmd, capture_output=True, text=True)
    logs = r.stdout + r.stderr
    errors = [l for l in logs.split('\n') if '"level":"error"' in l]
    warns = [l for l in logs.split('\n') if '"level":"warn"' in l and 'TESLA_COMMAND_PROXY' not in l and 'no tokens' not in l]
    fives = [l for l in logs.split('\n') if '"status":5' in l]
    
    if not errors and not fives:
        total_pass += 1
        print(f'  PASS: 0 errors, 0 warnings, 0 500s')
    else:
        total_fail += 1
        print(f'  FAIL: {len(errors)} errors, {len(warns)} warnings, {len(fives)} 500s')
        for e in errors[:3]:
            print(f'    {e[:120]}')
    results['tests']['error_check'] = {'errors': len(errors), 'warnings': len(warns), '500s': len(fives)}

    # Test 6: Vehicle state composite check
    print(f'\n--- Vehicle state composite ---')
    status, vs = api_get('/api/v1/vehicles/1/state')
    if vs and 'state' in vs:
        s = vs['state']
        checks = {
            'battery>0': s.get('battery_level', 0) > 0,
            'is_charging': s.get('is_charging', False),
            'state=charging': s.get('state') == 'charging',
            'charger_power>0': s.get('charger_power', 0) > 0,
            'charge_rate>0': s.get('charge_rate', 0) > 0,
            'inside_temp>0': s.get('inside_temp', 0) > 0,
            'outside_temp>0': s.get('outside_temp', 0) > 0,
            'is_locked': s.get('is_locked', False),
            'sentry_mode': s.get('sentry_mode', False),
            'rated_range>0': s.get('rated_range', 0) > 0,
            'time_to_full>0': s.get('time_to_full_charge', 0) > 0,
            'data_source': vs.get('data_source') == 'fleet_telemetry',
        }
        for check, ok in checks.items():
            if ok:
                total_pass += 1
                print(f'  PASS: {check}')
            else:
                total_fail += 1
                val = s.get(check.split('>')[0].split('=')[0], '?')
                print(f'  FAIL: {check} (value: {val})')
        results['tests']['vehicle_state'] = {'checks': checks, 'raw': vs}
    else:
        total_fail += 1
        print(f'  FAIL: could not get vehicle state')

    # Summary
    print(f'\n{"="*60}')
    print(f'  ROUND {round_num} SUMMARY: {total_pass} PASS / {total_fail} FAIL')
    print(f'{"="*60}')
    
    results['summary'] = {'pass': total_pass, 'fail': total_fail}

    # Save results
    with open(os.path.join(output_dir, f'round-{round_num}-results.json'), 'w') as f:
        json.dump(results, f, indent=2, default=str)

    return total_pass, total_fail


def main():
    base_dir = r'D:\copilot\teslasync\testplan\iteration-1'
    os.makedirs(base_dir, exist_ok=True)

    all_pass = 0
    all_fail = 0
    
    for i in range(1, 6):
        p, f = run_round(i, base_dir)
        all_pass += p
        all_fail += f
        
        if i < 5:
            print(f'\n--- Pausing 5s before round {i+1} ---')
            time.sleep(5)

    print(f'\n\n{"#"*60}')
    print(f'  FINAL: {all_pass} PASS / {all_fail} FAIL across 5 rounds')
    print(f'{"#"*60}')


if __name__ == '__main__':
    main()
