"""
Sensor Simulator for Predictive Maintenance Platform
Simulates 5 industrial machines, each with 4 sensors.
Publishes data to AWS IoT Core via MQTT.

Install deps:
    pip install AWSIoTPythonSDK boto3

Run:
    python sensor_simulator.py
"""

import json
import time
import random
import math
import argparse
from datetime import datetime, timezone
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient

# ── AWS IoT Config ──────────────────────────────────────────────────────────
IOT_ENDPOINT  = "YOUR_IOT_ENDPOINT.iot.ap-south-1.amazonaws.com"  # replace
CLIENT_ID     = "sensor-simulator-01"
TOPIC_PREFIX  = "factory/sensors"
CERT_PATH     = "certs/device.cert.pem"
KEY_PATH      = "certs/device.private.key"
ROOT_CA_PATH  = "certs/root-CA.crt"

# ── Machine Definitions ─────────────────────────────────────────────────────
MACHINES = [
    {"id": "M001", "name": "Compressor Unit A",    "type": "compressor"},
    {"id": "M002", "name": "Motor Drive B",         "type": "motor"},
    {"id": "M003", "name": "Pump Station C",        "type": "pump"},
    {"id": "M004", "name": "Conveyor Belt D",       "type": "conveyor"},
    {"id": "M005", "name": "Generator Unit E",      "type": "generator"},
]

# Normal operating ranges per machine type
NORMAL_RANGES = {
    "compressor": {"temperature": (60, 85),  "vibration": (0.5, 2.0), "pressure": (100, 150), "rpm": (1400, 1600)},
    "motor":      {"temperature": (40, 70),  "vibration": (0.2, 1.5), "pressure": (0, 0),     "rpm": (2800, 3200)},
    "pump":       {"temperature": (35, 60),  "vibration": (0.3, 1.8), "pressure": (80, 120),  "rpm": (1800, 2200)},
    "conveyor":   {"temperature": (30, 55),  "vibration": (0.4, 2.5), "pressure": (0, 0),     "rpm": (500, 700)},
    "generator":  {"temperature": (70, 95),  "vibration": (0.6, 2.2), "pressure": (50, 90),   "rpm": (3000, 3600)},
}

# Fault injection state per machine
fault_state = {m["id"]: {"active": False, "start_time": None, "type": None} for m in MACHINES}


def inject_fault(machine_id):
    """Randomly start a fault on a machine (5% chance per cycle)."""
    if not fault_state[machine_id]["active"] and random.random() < 0.05:
        fault_state[machine_id]["active"] = True
        fault_state[machine_id]["start_time"] = time.time()
        fault_state[machine_id]["type"] = random.choice(["overheating", "vibration_spike", "pressure_drop"])
        print(f"[FAULT INJECTED] Machine {machine_id} → {fault_state[machine_id]['type']}")
    # Auto-clear after 60 s
    if fault_state[machine_id]["active"]:
        elapsed = time.time() - fault_state[machine_id]["start_time"]
        if elapsed > 60:
            fault_state[machine_id]["active"] = False
            print(f"[FAULT CLEARED] Machine {machine_id}")


def generate_sensor_reading(machine):
    """Generate one sensor payload for a machine."""
    mid   = machine["id"]
    mtype = machine["type"]
    ranges = NORMAL_RANGES[mtype]
    inject_fault(mid)

    fault = fault_state[mid]
    ftype = fault["type"] if fault["active"] else None
    elapsed = (time.time() - fault["start_time"]) if fault["active"] else 0
    severity = min(elapsed / 30.0, 1.0)   # ramps up over 30 s

    def pick(lo, hi, spike_lo=None, spike_hi=None):
        base = random.uniform(lo, hi) + random.gauss(0, (hi - lo) * 0.05)
        if ftype and spike_lo is not None:
            base += severity * random.uniform(spike_lo, spike_hi)
        return round(base, 2)

    temp_lo, temp_hi = ranges["temperature"]
    vib_lo,  vib_hi  = ranges["vibration"]
    prs_lo,  prs_hi  = ranges["pressure"]
    rpm_lo,  rpm_hi  = ranges["rpm"]

    temperature = pick(temp_lo, temp_hi,
                       spike_lo=20 if ftype == "overheating" else 0,
                       spike_hi=40 if ftype == "overheating" else 0)
    vibration   = pick(vib_lo, vib_hi,
                       spike_lo=3  if ftype == "vibration_spike" else 0,
                       spike_hi=8  if ftype == "vibration_spike" else 0)
    pressure    = pick(prs_lo, prs_hi,
                       spike_lo=-30 if ftype == "pressure_drop" else 0,
                       spike_hi=-10 if ftype == "pressure_drop" else 0) if prs_hi > 0 else 0.0
    rpm         = pick(rpm_lo, rpm_hi)

    # Simple anomaly score: how far outside normal bounds (0–1 scale)
    anomaly_score = round(max(
        max(0, (temperature - temp_hi) / temp_hi),
        max(0, (vibration   - vib_hi)  / vib_hi),
        max(0, (prs_lo - pressure)     / prs_lo) if prs_lo > 0 else 0,
    ), 4)

    status = "CRITICAL" if anomaly_score > 0.3 else "WARNING" if anomaly_score > 0.1 else "NORMAL"

    return {
        "machine_id":     mid,
        "machine_name":   machine["name"],
        "machine_type":   mtype,
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "sensors": {
            "temperature":  temperature,
            "vibration":    vibration,
            "pressure":     pressure,
            "rpm":          rpm,
        },
        "anomaly_score":  anomaly_score,
        "status":         status,
        "fault_type":     ftype or "none",
    }


def setup_mqtt_client():
    client = AWSIoTMQTTClient(CLIENT_ID)
    client.configureEndpoint(IOT_ENDPOINT, 8883)
    client.configureCredentials(ROOT_CA_PATH, KEY_PATH, CERT_PATH)
    client.configureAutoReconnectBackoffTime(1, 32, 20)
    client.configureOfflinePublishQueueing(-1)
    client.configureDrainingFrequency(2)
    client.configureConnectDisconnectTimeout(10)
    client.configureMQTTOperationTimeout(5)
    client.connect()
    print("[MQTT] Connected to AWS IoT Core ✓")
    return client


def run_simulator(use_mqtt=True, interval=5):
    client = setup_mqtt_client() if use_mqtt else None

    print(f"[SIM] Starting sensor simulation — {len(MACHINES)} machines, {interval}s interval")
    print("─" * 60)

    while True:
        for machine in MACHINES:
            payload = generate_sensor_reading(machine)
            topic   = f"{TOPIC_PREFIX}/{payload['machine_id']}"

            if client:
                client.publish(topic, json.dumps(payload), 1)

            # Always print to console for debugging
            flag = "⚠ " if payload["status"] != "NORMAL" else "  "
            print(f"{flag}[{payload['machine_id']}] {payload['machine_name']:25s} "
                  f"temp={payload['sensors']['temperature']:6.1f}°C  "
                  f"vib={payload['sensors']['vibration']:5.2f}g  "
                  f"score={payload['anomaly_score']:.4f}  [{payload['status']}]")

        print("─" * 60)
        time.sleep(interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Industrial IoT Sensor Simulator")
    parser.add_argument("--no-mqtt", action="store_true", help="Run without MQTT (console only)")
    parser.add_argument("--interval", type=int, default=5, help="Publish interval in seconds")
    args = parser.parse_args()

    run_simulator(use_mqtt=not args.no_mqtt, interval=args.interval)
