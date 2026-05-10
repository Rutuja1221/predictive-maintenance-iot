"""
AWS Lambda Function: IoT Sensor Processor
─────────────────────────────────────────
Trigger  : AWS IoT Core Rule → Lambda
Input    : JSON sensor payload from MQTT topic factory/sensors/+
Output   : Writes to DynamoDB table  "SensorReadings"
           Writes alert to DynamoDB  "MaintenanceAlerts"
           (Optional) Publishes SNS notification on CRITICAL status

Deploy:
  zip -r lambda.zip lambda_function.py
  aws lambda create-function \
    --function-name IoTSensorProcessor \
    --runtime python3.11 \
    --handler lambda_function.lambda_handler \
    --zip-file fileb://lambda.zip \
    --role arn:aws:iam::ACCOUNT_ID:role/LambdaIoTRole
"""

import json
import boto3
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

# ── AWS Resources ────────────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-south-1"))
sns      = boto3.client("sns",      region_name=os.environ.get("AWS_REGION", "ap-south-1"))

READINGS_TABLE = os.environ.get("READINGS_TABLE",  "SensorReadings")
ALERTS_TABLE   = os.environ.get("ALERTS_TABLE",    "MaintenanceAlerts")
SNS_TOPIC_ARN  = os.environ.get("SNS_TOPIC_ARN",   "")   # optional

# ── Anomaly Detection Thresholds ─────────────────────────────────────────────
THRESHOLDS = {
    "compressor": {"temperature": 90,  "vibration": 4.0, "pressure": 160},
    "motor":      {"temperature": 75,  "vibration": 3.5, "pressure": 999},
    "pump":       {"temperature": 65,  "vibration": 3.8, "pressure": 130},
    "conveyor":   {"temperature": 60,  "vibration": 5.0, "pressure": 999},
    "generator":  {"temperature": 100, "vibration": 4.5, "pressure": 100},
}

# Rolling window (last N readings) stored in DynamoDB for trend analysis
WINDOW_SIZE = 10


def float_to_decimal(obj):
    """DynamoDB requires Decimal, not float."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [float_to_decimal(i) for i in obj]
    return obj


def detect_anomaly(payload):
    """
    Multi-rule anomaly detection:
    1. Threshold breach         → immediate flag
    2. Anomaly score from sensor → pre-computed in simulator
    3. Combined severity level
    """
    mtype    = payload.get("machine_type", "compressor")
    sensors  = payload.get("sensors", {})
    score    = float(payload.get("anomaly_score", 0))
    thresholds = THRESHOLDS.get(mtype, THRESHOLDS["compressor"])

    breaches = []
    if sensors.get("temperature", 0) > thresholds["temperature"]:
        breaches.append(f"temperature={sensors['temperature']}°C > {thresholds['temperature']}°C")
    if sensors.get("vibration", 0) > thresholds["vibration"]:
        breaches.append(f"vibration={sensors['vibration']}g > {thresholds['vibration']}g")
    if thresholds["pressure"] < 999 and sensors.get("pressure", 999) > thresholds["pressure"]:
        breaches.append(f"pressure={sensors['pressure']} bar > {thresholds['pressure']} bar")

    severity = "NORMAL"
    if breaches or score > 0.3:
        severity = "CRITICAL"
    elif score > 0.1:
        severity = "WARNING"

    return severity, breaches, score


def write_reading(payload, severity):
    """Persist raw sensor reading to DynamoDB."""
    table = dynamodb.Table(READINGS_TABLE)
    item  = {
        "reading_id":    str(uuid.uuid4()),
        "machine_id":    payload["machine_id"],
        "machine_name":  payload["machine_name"],
        "machine_type":  payload["machine_type"],
        "timestamp":     payload["timestamp"],
        "sensors":       float_to_decimal(payload["sensors"]),
        "anomaly_score": Decimal(str(payload["anomaly_score"])),
        "fault_type":    payload.get("fault_type", "none"),
        "severity":      severity,
        # TTL: keep readings for 30 days (Unix epoch)
        "ttl":           int(datetime.now(timezone.utc).timestamp()) + 30 * 86400,
    }
    table.put_item(Item=item)
    return item["reading_id"]


def write_alert(payload, severity, breaches, reading_id):
    """Write a maintenance alert for WARNING/CRITICAL events."""
    table = dynamodb.Table(ALERTS_TABLE)
    item  = {
        "alert_id":      str(uuid.uuid4()),
        "machine_id":    payload["machine_id"],
        "machine_name":  payload["machine_name"],
        "machine_type":  payload["machine_type"],
        "timestamp":     payload["timestamp"],
        "severity":      severity,
        "breach_details": json.dumps(breaches),
        "anomaly_score": Decimal(str(payload["anomaly_score"])),
        "fault_type":    payload.get("fault_type", "none"),
        "reading_id":    reading_id,
        "resolved":      False,
        "ttl":           int(datetime.now(timezone.utc).timestamp()) + 7 * 86400,
    }
    table.put_item(Item=item)
    return item["alert_id"]


def send_sns_alert(payload, severity, breaches, alert_id):
    """Push SNS notification (email/SMS) for CRITICAL alerts."""
    if not SNS_TOPIC_ARN:
        return
    message = (
        f"🚨 CRITICAL ALERT — Predictive Maintenance System\n\n"
        f"Machine   : {payload['machine_name']} ({payload['machine_id']})\n"
        f"Type      : {payload['machine_type'].upper()}\n"
        f"Time      : {payload['timestamp']}\n"
        f"Score     : {payload['anomaly_score']}\n"
        f"Breaches  : {', '.join(breaches) if breaches else 'Anomaly score exceeded'}\n"
        f"Alert ID  : {alert_id}\n\n"
        f"Action Required: Inspect machine immediately."
    )
    sns.publish(
        TopicArn=SNS_TOPIC_ARN,
        Subject=f"[CRITICAL] Machine {payload['machine_id']} Fault Detected",
        Message=message,
    )


def lambda_handler(event, context):
    """
    Main entry point.
    IoT Rule passes the MQTT payload directly as the event.
    """
    print(f"[LAMBDA] Received event: {json.dumps(event)}")

    try:
        # IoT Core passes the payload as the event dict directly
        payload = event

        severity, breaches, score = detect_anomaly(payload)
        print(f"[DETECT] Machine={payload['machine_id']} severity={severity} score={score:.4f}")

        # Always save the raw reading
        reading_id = write_reading(payload, severity)

        alert_id = None
        if severity in ("WARNING", "CRITICAL"):
            alert_id = write_alert(payload, severity, breaches, reading_id)
            print(f"[ALERT] Created alert {alert_id} for {payload['machine_id']}")

            if severity == "CRITICAL":
                send_sns_alert(payload, severity, breaches, alert_id)

        return {
            "statusCode": 200,
            "reading_id": reading_id,
            "alert_id":   alert_id,
            "severity":   severity,
        }

    except Exception as e:
        print(f"[ERROR] {str(e)}")
        raise e
