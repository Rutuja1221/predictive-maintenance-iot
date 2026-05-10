# ─────────────────────────────────────────────────────────────────────────────
# Terraform: Predictive Maintenance IoT Platform — AWS Infrastructure
# Region: ap-south-1 (Mumbai)
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.5.0"
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region"    { default = "ap-south-1" }
variable "project_name"  { default = "iot-maintenance" }
variable "alert_email"   { default = "your-email@example.com" }   # ← change this

# ─── DynamoDB: Sensor Readings ────────────────────────────────────────────────
resource "aws_dynamodb_table" "sensor_readings" {
  name           = "SensorReadings"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "reading_id"

  attribute {
    name = "reading_id"
    type = "S"
  }
  attribute {
    name = "machine_id"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }

  global_secondary_index {
    name               = "machine_id-timestamp-index"
    hash_key           = "machine_id"
    range_key          = "timestamp"
    projection_type    = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = { Project = var.project_name }
}

# ─── DynamoDB: Maintenance Alerts ─────────────────────────────────────────────
resource "aws_dynamodb_table" "maintenance_alerts" {
  name           = "MaintenanceAlerts"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "alert_id"

  attribute {
    name = "alert_id"
    type = "S"
  }
  attribute {
    name = "machine_id"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }

  global_secondary_index {
    name               = "machine_id-timestamp-index"
    hash_key           = "machine_id"
    range_key          = "timestamp"
    projection_type    = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = { Project = var.project_name }
}

# ─── SNS: Alert Notifications ─────────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
  tags = { Project = var.project_name }
}

resource "aws_sns_topic_subscription" "email_alert" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ─── IAM: Lambda Execution Role ───────────────────────────────────────────────
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem","dynamodb:GetItem","dynamodb:Query",
                    "dynamodb:Scan","dynamodb:UpdateItem"]
        Resource = [
          aws_dynamodb_table.sensor_readings.arn,
          "${aws_dynamodb_table.sensor_readings.arn}/index/*",
          aws_dynamodb_table.maintenance_alerts.arn,
          "${aws_dynamodb_table.maintenance_alerts.arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.alerts.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ─── Lambda: IoT Sensor Processor ─────────────────────────────────────────────
data "archive_file" "iot_lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/lambda_function.py"
  output_path = "${path.module}/lambda_function.zip"
}

resource "aws_lambda_function" "iot_processor" {
  filename         = data.archive_file.iot_lambda_zip.output_path
  function_name    = "IoTSensorProcessor"
  role             = aws_iam_role.lambda_role.arn
  handler          = "lambda_function.lambda_handler"
  runtime          = "python3.11"
  timeout          = 30
  source_code_hash = data.archive_file.iot_lambda_zip.output_base64sha256

  environment {
    variables = {
      READINGS_TABLE = aws_dynamodb_table.sensor_readings.name
      ALERTS_TABLE   = aws_dynamodb_table.maintenance_alerts.name
      SNS_TOPIC_ARN  = aws_sns_topic.alerts.arn
      AWS_REGION     = var.aws_region
    }
  }

  tags = { Project = var.project_name }
}

# ─── Lambda: Dashboard API ────────────────────────────────────────────────────
data "archive_file" "api_lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/api_lambda.py"
  output_path = "${path.module}/api_lambda.zip"
}

resource "aws_lambda_function" "api" {
  filename         = data.archive_file.api_lambda_zip.output_path
  function_name    = "DashboardAPI"
  role             = aws_iam_role.lambda_role.arn
  handler          = "api_lambda.lambda_handler"
  runtime          = "python3.11"
  timeout          = 30
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256

  environment {
    variables = {
      READINGS_TABLE = aws_dynamodb_table.sensor_readings.name
      ALERTS_TABLE   = aws_dynamodb_table.maintenance_alerts.name
      AWS_REGION     = var.aws_region
    }
  }

  tags = { Project = var.project_name }
}

# ─── API Gateway ──────────────────────────────────────────────────────────────
resource "aws_api_gateway_rest_api" "dashboard_api" {
  name = "${var.project_name}-api"
  tags = { Project = var.project_name }
}

resource "aws_api_gateway_resource" "machines" {
  rest_api_id = aws_api_gateway_rest_api.dashboard_api.id
  parent_id   = aws_api_gateway_rest_api.dashboard_api.root_resource_id
  path_part   = "machines"
}

resource "aws_api_gateway_resource" "readings" {
  rest_api_id = aws_api_gateway_rest_api.dashboard_api.id
  parent_id   = aws_api_gateway_rest_api.dashboard_api.root_resource_id
  path_part   = "readings"
}

resource "aws_api_gateway_resource" "alerts" {
  rest_api_id = aws_api_gateway_rest_api.dashboard_api.id
  parent_id   = aws_api_gateway_rest_api.dashboard_api.root_resource_id
  path_part   = "alerts"
}

locals {
  api_resources = [
    aws_api_gateway_resource.machines.id,
    aws_api_gateway_resource.readings.id,
    aws_api_gateway_resource.alerts.id,
  ]
  api_paths = ["machines", "readings", "alerts"]
}

resource "aws_api_gateway_method" "get_machines" {
  rest_api_id   = aws_api_gateway_rest_api.dashboard_api.id
  resource_id   = aws_api_gateway_resource.machines.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_machines" {
  rest_api_id             = aws_api_gateway_rest_api.dashboard_api.id
  resource_id             = aws_api_gateway_resource.machines.id
  http_method             = aws_api_gateway_method.get_machines.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api.invoke_arn
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.dashboard_api.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "dashboard" {
  rest_api_id = aws_api_gateway_rest_api.dashboard_api.id
  stage_name  = "prod"

  depends_on = [aws_api_gateway_integration.get_machines]
}

# ─── IoT Core Rule ────────────────────────────────────────────────────────────
resource "aws_iot_topic_rule" "sensor_rule" {
  name        = "SensorDataToLambda"
  enabled     = true
  sql         = "SELECT * FROM 'factory/sensors/+'"
  sql_version = "2016-03-23"

  lambda {
    function_arn = aws_lambda_function.iot_processor.arn
  }
}

resource "aws_lambda_permission" "iot_invoke" {
  statement_id  = "AllowIoTCoreInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.iot_processor.function_name
  principal     = "iot.amazonaws.com"
  source_arn    = aws_iot_topic_rule.sensor_rule.arn
}

# ─── Outputs ──────────────────────────────────────────────────────────────────
output "api_gateway_url" {
  value = "${aws_api_gateway_deployment.dashboard.invoke_url}"
  description = "Paste this URL into frontend/.env as VITE_API_URL"
}

output "iot_endpoint_command" {
  value = "aws iot describe-endpoint --endpoint-type iot:Data-ATS --region ${var.aws_region}"
  description = "Run this command to get your IoT endpoint for sensor_simulator.py"
}

output "dynamodb_readings_table" {
  value = aws_dynamodb_table.sensor_readings.name
}

output "dynamodb_alerts_table" {
  value = aws_dynamodb_table.maintenance_alerts.name
}
