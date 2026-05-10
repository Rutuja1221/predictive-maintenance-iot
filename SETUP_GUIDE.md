# Predictive Maintenance IoT Platform — Setup Guide
## CS509 ETL Mini Project

---

## Project Architecture

```
Sensor Simulator (Python)
       │  MQTT (port 8883)
       ▼
AWS IoT Core  ──────────────────────────────────────────────
       │  IoT Rule: SELECT * FROM 'factory/sensors/+'
       ▼
AWS Lambda: IoTSensorProcessor
       │  writes to
       ├──▶ DynamoDB: SensorReadings   (all readings, TTL 30 days)
       ├──▶ DynamoDB: MaintenanceAlerts (WARNING/CRITICAL events)
       └──▶ SNS Topic  (email on CRITICAL)

API Gateway (REST)
       │  routes: /machines  /readings  /alerts
       ▼
AWS Lambda: DashboardAPI
       │  reads from DynamoDB
       ▼
React Dashboard (S3 static website)
```

---

## Step 1 — AWS Account Setup (10 min)

1. Log in to AWS Console → switch region to **ap-south-1** (Mumbai)
2. Create an IAM user for Terraform:
   - IAM → Users → Create user → name: `terraform-iot`
   - Attach policy: `AdministratorAccess` (for project; restrict in production)
   - Create access key → download CSV
3. Install AWS CLI and configure:
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Key, region=ap-south-1, format=json
   ```

---

## Step 2 — Deploy AWS Infrastructure with Terraform (15 min)

```bash
# Install Terraform: https://developer.hashicorp.com/terraform/downloads

cd iot-maintenance/backend

# Edit main.tf:
# - Change var.alert_email default to your email address

terraform init
terraform plan
terraform apply   # type "yes" when prompted
```

After apply, note the output values:
- `api_gateway_url`     → you'll need this for the frontend `.env`
- `iot_endpoint_command` → run it to get your IoT endpoint

---

## Step 3 — Create IoT Device Certificate (10 min)

In AWS Console → IoT Core → Security → Certificates:

```bash
# Or via CLI:
mkdir -p backend/certs && cd backend/certs

# Create certificate
aws iot create-keys-and-certificate \
  --set-as-active \
  --certificate-pem-outfile device.cert.pem \
  --public-key-outfile device.public.key \
  --private-key-outfile device.private.key

# Download Root CA
curl -o root-CA.crt https://www.amazontrust.com/repository/AmazonRootCA1.pem

# Attach policy to certificate (create policy first in IoT Console)
# Policy name: SensorPolicy
# Policy document: allow iot:Connect, iot:Publish on factory/sensors/*
```

IoT Policy JSON (paste in console):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["iot:Connect"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["iot:Publish"],
      "Resource": "arn:aws:iot:ap-south-1:*:topic/factory/sensors/*"
    }
  ]
}
```

---

## Step 4 — Configure Sensor Simulator (5 min)

Edit `backend/sensor_simulator.py`:
```python
IOT_ENDPOINT = "YOUR_ENDPOINT.iot.ap-south-1.amazonaws.com"
# Get it by running:
# aws iot describe-endpoint --endpoint-type iot:Data-ATS
```

Install dependencies and run:
```bash
cd backend
pip install AWSIoTPythonSDK boto3

# Test without MQTT first (console only):
python sensor_simulator.py --no-mqtt

# Then with MQTT:
python sensor_simulator.py --interval 5
```

---

## Step 5 — Run the Dashboard Locally (5 min)

```bash
cd frontend

# Create .env file:
echo "VITE_API_URL=https://YOUR_API_GATEWAY_URL/prod" > .env
# (leave empty to use built-in mock data for testing)

npm install
npm run dev
# → opens at http://localhost:5173
```

The dashboard works with **mock data** even without AWS, so you can
demo it anytime.

---

## Step 6 — Deploy Frontend to S3 (10 min)

```bash
cd frontend
npm run build

# Create S3 bucket
aws s3 mb s3://iot-maintenance-dashboard --region ap-south-1

# Enable static website hosting
aws s3 website s3://iot-maintenance-dashboard \
  --index-document index.html --error-document index.html

# Upload build
aws s3 sync dist/ s3://iot-maintenance-dashboard --acl public-read

# Your site URL:
# http://iot-maintenance-dashboard.s3-website.ap-south-1.amazonaws.com
```

---

## Team Task Split (4 members, 6 weeks)

| Member | Responsibility |
|--------|----------------|
| Member 1 | AWS infra (Terraform), IoT Core setup, certificates |
| Member 2 | Lambda functions (IoT processor + API), DynamoDB design |
| Member 3 | Sensor simulator (Python), anomaly detection logic |
| Member 4 | React dashboard, charts, S3 deployment |

### Week-by-Week Plan
- **Week 1**: AWS setup, Terraform deploy, DynamoDB tables live
- **Week 2**: Lambda IoT processor working, sensor sim publishing
- **Week 3**: API Lambda + API Gateway, data flowing end to end
- **Week 4**: React dashboard, connect to real API
- **Week 5**: Testing, fault injection demo, bug fixes
- **Week 6**: Report, presentation, final demo

---

## Demo Script (for viva)

1. Show simulator running in terminal — sensors publishing live
2. Open DynamoDB console — show SensorReadings filling up
3. Show IoT Core → Test → subscribe to `factory/sensors/#`
4. Open dashboard → show machine cards updating
5. Manually force a fault: temporarily lower a threshold in Lambda
6. Show CRITICAL alert appearing on dashboard
7. Click "Resolve" → alert disappears from active list
8. Open Machine Detail → show real-time sensor charts

---

## Connecting to Course Material

| Platform Feature | Chapter Reference |
|-----------------|-------------------|
| Cloud-based sensor analytics | Ch.13 — Energy Systems Prognostics |
| Lambda + DynamoDB architecture | Ch.5 — Analytics App Reference Architecture |
| Auto-scaling infra (API Gateway) | Ch.5 — Scalability Design Consideration |
| IoT Rule → Lambda → DB | Ch.13 — Collecting Sensor Data in Cloud |
| Case-based anomaly scoring | Ch.13 — Case Based Reasoning for Fault Prediction |
| REST API for dashboard | Ch.5 — RESTful Web Services |
| Docker (optional local dev) | Ch.5 — Deployment & Management |
