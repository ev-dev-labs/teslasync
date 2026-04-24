#!/usr/bin/env python3
"""Fast signal replay using direct MQTT connection (no docker exec overhead)."""

import csv
import sys
import time
import argparse
from datetime import datetime
from collections import Counter

import paho.mqtt.client as mqtt


def parse_args():
    p = argparse.ArgumentParser(description="Fast signal replay via paho-mqtt")
    p.add_argument("--csv", required=True, help="Path to signal CSV")
    p.add_argument("--vin", required=True, help="Vehicle VIN")
    p.add_argument("--speed", type=int, default=500, help="Speed multiplier (default 500)")
    p.add_argument("--host", default="localhost", help="MQTT host")
    p.add_argument("--port", type=int, default=1883, help="MQTT port")
    p.add_argument("--no-delay", action="store_true", help="Publish as fast as possible (no timing)")
    p.add_argument("--batch-delay-ms", type=int, default=0,
                   help="If set, sleep this many ms every 1000 signals (gives backend breathing room)")
    p.add_argument("--start", help="Start time filter (YYYY-MM-DD HH:MM:SS)")
    p.add_argument("--end", help="End time filter (YYYY-MM-DD HH:MM:SS)")
    return p.parse_args()


def main():
    args = parse_args()

    # Connect MQTT
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="replay-fast")
    client.connect(args.host, args.port, keepalive=60)
    client.loop_start()
    print(f"Connected to MQTT {args.host}:{args.port}")

    # Load CSV
    print(f"Loading {args.csv}...")
    rows = []
    with open(args.csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = row["created_at"]
            if args.start and ts < args.start:
                continue
            if args.end and ts > args.end:
                continue
            rows.append(row)

    rows.sort(key=lambda r: r["created_at"])
    total = len(rows)
    print(f"Signals to replay: {total}")
    if total == 0:
        print("No signals. Exiting.")
        sys.exit(1)

    first_ts = datetime.fromisoformat(rows[0]["created_at"].replace("+00", "+00:00"))
    last_ts = datetime.fromisoformat(rows[-1]["created_at"].replace("+00", "+00:00"))
    duration = (last_ts - first_ts).total_seconds()
    mode = "NO DELAY (max speed)" if args.no_delay else f"{args.speed}x"
    print(f"Time window: {duration/60:.1f} min | Mode: {mode}")
    print(f"VIN: {args.vin}")

    published = 0
    skipped = 0
    errors = 0
    signal_counts = Counter()
    start_wall = time.monotonic()
    prev_ts = first_ts

    print("\n=== REPLAY STARTED ===\n")

    for row in rows:
        signal = row["signal"]
        ts = datetime.fromisoformat(row["created_at"].replace("+00", "+00:00"))

        # Optional delay
        if not args.no_delay:
            gap = (ts - prev_ts).total_seconds() / args.speed
            if 0.01 < gap < 30:
                time.sleep(gap)
            prev_ts = ts

        # Determine value
        value = row.get("value_num") or row.get("value_str") or ""
        if not value:
            vb = row.get("value_bool", "")
            if vb == "t":
                value = "true"
            elif vb == "f":
                value = "false"
        if not value:
            skipped += 1
            continue

        topic = f"telemetry/{args.vin}/v/{signal}"
        result = client.publish(topic, value, qos=0)
        if result.rc != 0:
            errors += 1
            if errors <= 5:
                print(f"  ERROR: {topic} = {value} (rc={result.rc})")

        published += 1
        signal_counts[signal] += 1

        # Batch breathing room
        if args.batch_delay_ms and published % 1000 == 0:
            time.sleep(args.batch_delay_ms / 1000.0)

        # Progress
        if published % 5000 == 0:
            elapsed = time.monotonic() - start_wall
            pct = published / total * 100
            rate = published / elapsed if elapsed > 0 else 0
            print(f"  [{pct:.1f}%] {published}/{total} | {elapsed:.0f}s | {rate:.0f} msg/s")

    # Flush
    time.sleep(1)
    client.loop_stop()
    client.disconnect()

    elapsed = time.monotonic() - start_wall
    print(f"\n=== REPLAY COMPLETE ===")
    print(f"  Published: {published}")
    print(f"  Skipped:   {skipped} (empty value)")
    print(f"  Errors:    {errors}")
    print(f"  Duration:  {elapsed:.1f}s | {published/elapsed:.0f} msg/s")
    print(f"  Unique signals: {len(signal_counts)}")
    print(f"\nTop 10 signals:")
    for sig, cnt in signal_counts.most_common(10):
        print(f"  {cnt:>6} {sig}")


if __name__ == "__main__":
    main()
