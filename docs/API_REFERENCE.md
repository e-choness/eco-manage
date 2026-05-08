# 📡 API Reference

## Overview

EcoManage provides a RESTful API for all client operations. All endpoints use JSON for request/response bodies and require authentication via JWT tokens (except for auth endpoints).

**Base URL**: `http://localhost:3000/api` (development)

---

## Authentication

### Headers Required

```http
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

### Example

```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:3000/api/dashboard/overview
```

---

## Response Format

### Success Response

```json
{
  "status": "success",
  "data": {
    // endpoint-specific data
  }
}
```

### Error Response

```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": [
    {
      "field": "fieldName",
      "message": "Validation error message"
    }
  ]
}
```

---

## Authentication Endpoints

### Register User

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response** (201 Created)
```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "60d5ec49c1234567890abcde",
      "email": "user@example.com",
      "name": "John Doe"
    }
  }
}
```

**Errors**
- `400`: Invalid input (email format, password strength)
- `409`: Email already exists

---

### Login User

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "60d5ec49c1234567890abcde",
      "email": "user@example.com",
      "name": "John Doe"
    }
  }
}
```

**Errors**
- `401`: Invalid email or password
- `400`: Missing required fields

---

### Refresh Token

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Errors**
- `401`: Invalid or expired refresh token
- `400`: Missing refresh token

---

## Dashboard Endpoints

### Get Dashboard Overview

```http
GET /api/dashboard/overview
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "totalProduction": 250,
    "currentPower": 45,
    "dailyProduction": 480,
    "monthlyProduction": 14400,
    "systemStatus": "optimal",
    "weatherCondition": "sunny",
    "temperature": 22,
    "savings": 1250,
    "carbonOffset": 15
  }
}
```

---

### Get Energy Flow

```http
GET /api/dashboard/energy-flow
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "solar": 180,
    "wind": 45,
    "battery": 25,
    "grid": -10,
    "consumption": 240
  }
}
```

---

## Analytics Endpoints

### Get Analytics Data

```http
GET /api/analytics?period=month
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- period: "week" | "month" | "year" (default: "month")
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "startDate": "2024-04-01",
    "endDate": "2024-04-30",
    "totalProduction": 14400,
    "averageDailyProduction": 480,
    "peakProduction": 850,
    "trends": [
      {
        "date": "2024-04-01",
        "production": 450
      }
    ],
    "efficiency": 89.5
  }
}
```

---

### Get AI Insights

```http
POST /api/analytics/insights
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "period": "month",
  "analysisType": "comprehensive"
}
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "insights": "Based on your energy data for April, your system performed well with an average daily production of 480 kWh. Peak production occurred during sunny days with southfacing panels. Consider scheduling maintenance during low-production periods to maximize uptime.",
    "recommendations": [
      "Increase battery capacity for better energy storage",
      "Monitor panel cleanliness monthly",
      "Optimize consumption during peak production hours"
    ]
  }
}
```

**Errors**
- `503`: LLM service unavailable

---

## Devices Endpoints

### List Devices

```http
GET /api/devices
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- status: "online" | "offline" | "charging" (optional)
- type: "solar" | "wind" | "battery" (optional)
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "devices": [
      {
        "_id": "60d5ec49c1234567890abcde",
        "name": "Solar Panel Array A",
        "type": "solar",
        "maxOutput": 250,
        "currentOutput": 180,
        "efficiency": 95,
        "status": "online",
        "lastMaintenance": "2024-03-15",
        "createdAt": "2024-01-10"
      }
    ]
  }
}
```

---

### Get Device Details

```http
GET /api/devices/:id
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "name": "Solar Panel Array A",
    "type": "solar",
    "maxOutput": 250,
    "currentOutput": 180,
    "efficiency": 95,
    "status": "online",
    "lastMaintenance": "2024-03-15",
    "createdAt": "2024-01-10",
    "updatedAt": "2024-05-07"
  }
}
```

---

### Create Device

```http
POST /api/devices
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "name": "Wind Turbine 1",
  "type": "wind",
  "maxOutput": 150
}
```

**Response** (201 Created)
```json
{
  "status": "success",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "name": "Wind Turbine 1",
    "type": "wind",
    "maxOutput": 150,
    "currentOutput": 0,
    "efficiency": 0,
    "status": "offline",
    "lastMaintenance": "2024-05-07",
    "createdAt": "2024-05-07"
  }
}
```

**Errors**
- `400`: Invalid input data
- `409`: Device already exists

---

### Update Device

```http
PUT /api/devices/:id
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "name": "Wind Turbine 1 Updated",
  "maxOutput": 160
}
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "name": "Wind Turbine 1 Updated",
    "type": "wind",
    "maxOutput": 160,
    "currentOutput": 0,
    "efficiency": 0,
    "status": "offline",
    "lastMaintenance": "2024-05-07",
    "updatedAt": "2024-05-07"
  }
}
```

---

### Delete Device

```http
DELETE /api/devices/:id
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "message": "Device deleted successfully"
}
```

**Errors**
- `404`: Device not found

---

## Financial Endpoints

### Get Financial Overview

```http
GET /api/financial/overview
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- period: "month" | "year" (default: "month")
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "totalSavings": 1250,
    "costsAvoided": 950,
    "maintenanceCosts": 300,
    "netSavings": 650,
    "returnOnInvestment": 15.5,
    "paybackPeriod": 6.4,
    "costTrend": [
      {
        "date": "2024-05-01",
        "savings": 45,
        "costs": 0
      }
    ]
  }
}
```

---

### Get Cost Analysis

```http
GET /api/financial/analysis
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- breakdown: "daily" | "weekly" | "monthly" (default: "monthly")
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "breakdown": "monthly",
    "costBreakdown": {
      "maintenance": 300,
      "operations": 150,
      "utilities": 200
    },
    "savingsBySource": {
      "solar": 600,
      "wind": 400,
      "battery": 250
    },
    "recommendations": [
      "Optimize night consumption timing",
      "Schedule maintenance during low-cost periods"
    ]
  }
}
```

---

## Alerts Endpoints

### List Alerts

```http
GET /api/alerts
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- status: "read" | "unread" (optional)
- severity: "low" | "medium" | "high" (optional)
- limit: 20 (default)
- skip: 0 (default for pagination)
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "alerts": [
      {
        "_id": "60d5ec49c1234567890abcde",
        "type": "system_alert",
        "severity": "high",
        "message": "Panel efficiency dropped below 80%",
        "isRead": false,
        "timestamp": "2024-05-07T10:30:00Z",
        "createdAt": "2024-05-07T10:30:00Z"
      }
    ],
    "total": 45,
    "unreadCount": 12
  }
}
```

---

### Mark Alert as Read

```http
POST /api/alerts/:id/read
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "type": "system_alert",
    "severity": "high",
    "message": "Panel efficiency dropped below 80%",
    "isRead": true,
    "timestamp": "2024-05-07T10:30:00Z"
  }
}
```

---

### Create Alert

```http
POST /api/alerts
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "type": "custom_alert",
  "severity": "medium",
  "message": "Scheduled maintenance reminder"
}
```

**Response** (201 Created)
```json
{
  "status": "success",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "type": "custom_alert",
    "severity": "medium",
    "message": "Scheduled maintenance reminder",
    "isRead": false,
    "timestamp": "2024-05-07T10:30:00Z",
    "createdAt": "2024-05-07T10:30:00Z"
  }
}
```

---

## Optimization Endpoints

### Get Optimization Recommendations

```http
GET /api/optimization/recommendations
Authorization: Bearer <ACCESS_TOKEN>

Query Parameters:
- category: "efficiency" | "cost" | "sustainability" (optional)
```

**Response** (200 OK)
```json
{
  "status": "success",
  "data": {
    "recommendations": [
      {
        "_id": "60d5ec49c1234567890abcde",
        "title": "Increase Battery Capacity",
        "description": "Your battery storage is at 85% utilization. Consider expanding capacity to store more peak production.",
        "estimatedSavings": 500,
        "implementationCost": 2000,
        "paybackPeriod": 4.0,
        "category": "efficiency",
        "accepted": false
      }
    ],
    "totalEstimatedSavings": 2500
  }
}
```

---

### Accept Recommendation

```http
POST /api/optimization/recommendations/:id/accept
Authorization: Bearer <ACCESS_TOKEN>
```

**Response** (200 OK)
```json
{
  "status": "success",
  "message": "Recommendation accepted. Implementation scheduled.",
  "data": {
    "_id": "60d5ec49c1234567890abcde",
    "accepted": true,
    "acceptedAt": "2024-05-07T10:30:00Z"
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| VALIDATION_ERROR | 400 | Input validation failed |
| UNAUTHORIZED | 401 | Missing or invalid authentication |
| FORBIDDEN | 403 | User doesn't have permission |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| INTERNAL_ERROR | 500 | Server error |
| SERVICE_UNAVAILABLE | 503 | External service unavailable |

---

## Rate Limiting

- **Limit**: 100 requests per minute per IP
- **Headers**: 
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Pagination

Use `limit` and `skip` parameters for paginated endpoints:

```http
GET /api/alerts?limit=20&skip=40
```

Returns items 41-60.

---

## Filtering

Most list endpoints support filtering:

```http
GET /api/devices?status=online&type=solar
GET /api/alerts?severity=high&isRead=false
```

---

## Environment Variables

```env
# Server Port
PORT=3000

# JWT Configuration
JWT_SECRET=your_super_secret_key
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_EXPIRY=900  # 15 minutes in seconds
JWT_REFRESH_EXPIRY=604800  # 7 days in seconds

# Database
DATABASE_URL=mongodb://localhost:27017/ecomanage

# LLM Service (optional)
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4
```

---

## Testing API

### Using cURL

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Pass123!","name":"User"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Pass123!"}'

# Get dashboard (with token)
curl -X GET http://localhost:3000/api/dashboard/overview \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Using Postman

1. Import the OpenAPI spec: (coming soon)
2. Set up environment variables for base URL and token
3. Use pre-configured request collection

---

## Related Documents

- [Architecture Overview](./ARCHITECTURE.md)
- [Testing Guide](./TESTING.md)
- [Database Schema](./DATABASE.md)

---

[⬆ Back to Top](#-api-reference)
