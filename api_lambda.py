"""
AWS Lambda Function: Dashboard API
────────────────────────────────────
Trigger  : API Gateway (REST)
Routes:
  GET /machines          → list all machines with latest status
  GET /readings?machine_id=M001&limit=50  → recent readings
  GET /alerts?resolved=false              → open alerts
  PUT /alerts/{alert_id}/resolve          → mark alert resolved

Deploy:
  zip -r api_lambda.zip api_lambda.py
  (then create API Gateway and link routes to this function)
"""

import json
import boto3
import os
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from boto3.dynamodb.conditions import Key, Attr

dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-south-1"))

READINGS_TABLE = os.environ.get("READINGS_TABLE", "SensorReadings")
ALERTS_TABLE   = os.environ.get("ALERTS_TABLE",   "MaintenanceAlerts")

MACHINES = [
    {"id": "M001", "name": "Compressor Unit A",  "type": "compressor"},
    {"id": "M002", "name": "Motor Drive B",       "type": "motor"},
    {"id": "M003", "name": "Pump Station C",      "type": "pump"},
    {"id": "M004", "name": "Conveyor Belt D",     "type": "conveyor"},
    {"id": "M005", "name": "Generator Unit E",    "type": "generator"},
]


def decimal_to_float(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def cors_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type":                "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(decimal_to_float(body)),
    }


def get_latest_reading(machine_id):
    """Scan for the most recent reading for a machine (use GSI in production)."""
    table = dynamodb.Table(READINGS_TABLE)
    resp  = table.query(
        IndexName="machine_id-timestamp-index",   # GSI: machine_id (PK), timestamp (SK)
        KeyConditionExpression=Key("machine_id").eq(machine_id),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_machines(params):
    results = []
    for m in MACHINES:
        latest = get_latest_reading(m["id"])
        results.append({
            "id":            m["id"],
            "name":          m["name"],
            "type":          m["type"],
            "status":        latest["severity"]      if latest else "UNKNOWN",
            "anomaly_score": latest["anomaly_score"] if latest else 0,
            "last_seen":     latest["timestamp"]     if latest else None,
            "sensors":       latest["sensors"]       if latest else {},
        })
    return cors_response(200, results)


def get_readings(params):
    machine_id = params.get("machine_id", "M001")
    limit      = int(params.get("limit", 50))
    table      = dynamodb.Table(READINGS_TABLE)
    resp = table.query(
        IndexName="machine_id-timestamp-index",
        KeyConditionExpression=Key("machine_id").eq(machine_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return cors_response(200, resp.get("Items", []))


def get_alerts(params):
    resolved_str = params.get("resolved", "false")
    resolved     = resolved_str.lower() == "true"
    table        = dynamodb.Table(ALERTS_TABLE)
    resp = table.scan(
        FilterExpression=Attr("resolved").eq(resolved),
        Limit=100,
    )
    items = sorted(resp.get("Items", []), key=lambda x: x.get("timestamp", ""), reverse=True)
    return cors_response(200, items)


def resolve_alert(alert_id):
    table = dynamodb.Table(ALERTS_TABLE)
    table.update_item(
        Key={"alert_id": alert_id},
        UpdateExpression="SET resolved = :r, resolved_at = :t",
        ExpressionAttributeValues={
            ":r": True,
            ":t": datetime.now(timezone.utc).isoformat(),
        },
    )
    return cors_response(200, {"message": "Alert resolved", "alert_id": alert_id})


def lambda_handler(event, context):
    print(f"[API] event: {json.dumps(event)}")

    method   = event.get("httpMethod", "GET")
    path     = event.get("path", "/machines")
    params   = event.get("queryStringParameters") or {}
    path_params = event.get("pathParameters") or {}

    if method == "OPTIONS":
        return cors_response(200, {})

    try:
        if path == "/machines":
            return get_machines(params)
        elif path == "/readings":
            return get_readings(params)
        elif path == "/alerts":
            return get_alerts(params)
        elif "/alerts/" in path and method == "PUT":
            alert_id = path_params.get("alert_id") or path.split("/")[-2]
            return resolve_alert(alert_id)
        else:
            return cors_response(404, {"error": "Route not found"})
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        return cors_response(500, {"error": str(e)})
