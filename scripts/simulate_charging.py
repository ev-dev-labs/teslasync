"""
Simulate a realistic 1-hour Tesla charging session via MQTT.
Publishes signals to telemetry/{VIN}/v/{SignalName} every 10 seconds.

Usage: python scripts/simulate_charging.py
"""

import json
import time
import random
import paho.mqtt.client as mqtt

VIN = "5YJ3E1EA1PF123456"
BROKER = "localhost"
PORT = 1883
TOPIC_BASE = "telemetry"
INTERVAL = 10  # seconds between signal batches
SESSION_DURATION = 3600  # 1 hour in seconds

# Charging curve parameters (Level 2 AC, 11kW)
START_SOC = 22
END_SOC = 88
CHARGER_VOLTAGE = 240
CHARGER_AMPS_MAX = 48
CHARGER_POWER_KW = 11.5
BATTERY_CAPACITY_KWH = 75.0
RATED_RANGE_PER_SOC = 3.6  # km per 1% SOC

# Location: Supercharger Mountain View
LAT = 37.3861
LON = -122.0839


def publish_signal(client, signal_name, value):
    topic = f"{TOPIC_BASE}/{VIN}/v/{signal_name}"
    payload = json.dumps(value)
    client.publish(topic, payload, qos=0)


def charging_curve(elapsed_pct):
    """Simulate charging rate tapering above 80% SOC."""
    if elapsed_pct < 0.7:
        return 1.0
    return max(0.3, 1.0 - (elapsed_pct - 0.7) * 2.3)


def run_simulation():
    client = mqtt.Client(client_id="charging-simulator", protocol=mqtt.MQTTv311)
    client.connect(BROKER, PORT, 60)
    client.loop_start()

    print(f"  Starting charging simulation for {VIN}")
    print(f"   SOC: {START_SOC}% -> {END_SOC}%  |  Power: {CHARGER_POWER_KW} kW  |  Duration: {SESSION_DURATION//60} min")
    print(f"   Broker: {BROKER}:{PORT}  |  Interval: {INTERVAL}s")
    print()

    start_time = time.time()
    step = 0

    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed >= SESSION_DURATION:
                break

            elapsed_pct = elapsed / SESSION_DURATION
            taper = charging_curve(elapsed_pct)

            # Calculate current SOC
            soc = START_SOC + (END_SOC - START_SOC) * min(elapsed_pct * 1.05, 1.0)
            soc = min(soc, END_SOC)
            battery_level = int(soc)

            # Current charging rate
            current_amps = CHARGER_AMPS_MAX * taper + random.uniform(-0.5, 0.5)
            current_power = (CHARGER_VOLTAGE * current_amps) / 1000.0
            charge_rate_mph = current_power * 3.1

            # Range
            rated_range = soc * RATED_RANGE_PER_SOC
            ideal_range = rated_range * 1.05
            est_range = rated_range * 0.92

            # Energy
            energy_added = (soc - START_SOC) / 100.0 * BATTERY_CAPACITY_KWH
            energy_remaining = soc / 100.0 * BATTERY_CAPACITY_KWH

            # Time to full
            remaining_soc = END_SOC - soc
            if current_power > 0:
                hours_remaining = (remaining_soc / 100.0 * BATTERY_CAPACITY_KWH) / current_power
            else:
                hours_remaining = 0

            # Temperature (battery warms during charging)
            base_temp = 25.0
            battery_temp = base_temp + min(elapsed / 300, 8) + random.uniform(-0.5, 0.5)

            # Publish all charging signals
            signals = {
                # Core charging
                "BatteryLevel": battery_level,
                "Soc": round(soc, 1),
                "ChargeState": "Charging",
                "DetailedChargeState": "Charging",
                "ChargeAmps": round(current_amps, 1),
                "ChargerVoltage": CHARGER_VOLTAGE + random.randint(-2, 2),
                "ChargeCurrentRequest": CHARGER_AMPS_MAX,
                "ChargeCurrentRequestMax": CHARGER_AMPS_MAX,
                "ACChargingPower": round(current_power, 2),
                "ACChargingEnergyIn": round(energy_added, 2),
                "ChargeRateMilePerHour": round(charge_rate_mph, 1),
                "ChargeLimitSoc": END_SOC,
                "ChargeEnableRequest": True,
                "TimeToFullCharge": round(hours_remaining, 2),
                "ChargePortDoorOpen": True,
                "ChargePortLatch": "Engaged",
                "ChargePort": "US",
                "ChargingCableType": "SAE",
                "FastChargerPresent": False,

                # Range
                "RatedRange": round(rated_range, 1),
                "IdealBatteryRange": round(ideal_range, 1),
                "EstBatteryRange": round(est_range, 1),
                "EnergyRemaining": round(energy_remaining, 2),

                # Battery health
                "PackVoltage": round(350 + soc * 0.55 + random.uniform(-1, 1), 1),
                "PackCurrent": round(-current_amps * 0.98, 1),
                "ModuleTempMax": round(battery_temp + 2, 1),
                "ModuleTempMin": round(battery_temp - 2, 1),
                "BrickVoltageMax": round(3.9 + soc * 0.003, 3),
                "BrickVoltageMin": round(3.88 + soc * 0.003, 3),

                # Location (parked at charger)
                "Location": {"latitude": LAT + random.uniform(-0.0001, 0.0001),
                             "longitude": LON + random.uniform(-0.0001, 0.0001)},
                "GpsState": "Fix3D",
                "Gear": "P",
                "VehicleSpeed": 0,

                # Vehicle state
                "Locked": True,
                "SentryMode": True,
                "InsideTemp": round(22 + random.uniform(-1, 1), 1),
                "OutsideTemp": round(18 + random.uniform(-2, 2), 1),
                "Odometer": 45250.3,

                # Tire pressure
                "TpmsPressureFl": round(2.95 + random.uniform(-0.05, 0.05), 2),
                "TpmsPressureFr": round(2.93 + random.uniform(-0.05, 0.05), 2),
                "TpmsPressureRl": round(2.85 + random.uniform(-0.05, 0.05), 2),
                "TpmsPressureRr": round(2.87 + random.uniform(-0.05, 0.05), 2),
            }

            for signal_name, value in signals.items():
                publish_signal(client, signal_name, value)

            # Print progress
            bar_len = 30
            filled = int(bar_len * elapsed_pct)
            bar = "#" * filled + "-" * (bar_len - filled)
            mins_elapsed = int(elapsed // 60)
            print(f"  [{bar}] {battery_level}% SOC | {current_power:.1f} kW | "
                  f"{energy_added:.1f} kWh added | {mins_elapsed}m/{SESSION_DURATION//60}m | "
                  f"ETA: {hours_remaining:.1f}h")

            step += 1
            time.sleep(INTERVAL)

    except KeyboardInterrupt:
        print("\n  Simulation interrupted")
    else:
        # Send final "charging complete" signals
        print(f"\n  Charging complete! {START_SOC}% -> {END_SOC}%")
        final_signals = {
            "BatteryLevel": END_SOC,
            "Soc": float(END_SOC),
            "ChargeState": "Complete",
            "DetailedChargeState": "ChargeComplete",
            "ChargeAmps": 0,
            "ACChargingPower": 0,
            "ChargeRateMilePerHour": 0,
            "TimeToFullCharge": 0,
            "RatedRange": round(END_SOC * RATED_RANGE_PER_SOC, 1),
            "VehicleSpeed": 0,
            "Gear": "P",
        }
        for signal_name, value in final_signals.items():
            publish_signal(client, signal_name, value)

    client.loop_stop()
    client.disconnect()
    print("  Disconnected from MQTT")


if __name__ == "__main__":
    run_simulation()
