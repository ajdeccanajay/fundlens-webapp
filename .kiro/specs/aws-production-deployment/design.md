# Design Document: AWS Production Deployment

## Overview

This design specifies the AWS infrastructure for deploying FundLens to production. The architecture uses a containerized approach with ECS Fargate for the backend (NestJS + Python parser as sidecars), CloudFront CDN for frontend delivery, and integrates with existing AWS resources (Cognito, Bedrock KB, RDS, S3).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Route 53 (app.fundlens.ai)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CloudFront Distribution (HTTPS)                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Origin 1: S3 (Frontend)    │  │  Origin 2: ALB (API)                │  │
│  │  Path: /* (default)         │  │  Path: /api/*                       │  │
│  └─────────────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
           │                                          │
           ▼                                          ▼
┌─────────────────────┐              ┌────────────────────────────────────────┐
│  S3 Bucket          │              │  Application Load Balancer             │
│  (Static Frontend)  │              │  (HTTPS → Target Group)                │
└─────────────────────┘              └────────────────────────────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VPC (10.0.0.0/16)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Private Subnets (ECS Tasks)                       │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                    ECS Fargate Task                          │    │   │
│  │  │  ┌─────────────────────┐  ┌─────────────────────────────┐   │    │   │
│  │  │  │  NestJS Container   │  │  Python Parser Container    │   │    │   │
│  │  │  │  Port: 3000         │◄─┤  Port: 8000                 │   │    │   │
│  │  │  │  1.5 vCPU, 3GB      │  │  0.5 vCPU, 1GB              │   │    │   │
│  │  │  └─────────────────────┘  └─────────────────────────────┘   │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Existing AWS Resources                            │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │   │
│  │  │ RDS Postgres │ │ Bedrock KB   │ │ S3 Buckets   │ │ Cognito    │  │   │
│  │  │ (existing)   │ │ (existing)   │ │ (existing)   │ │ (existing) │  │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Architecture

### Container Architecture

The backend runs as a single ECS Fargate task with two containers (sidecar pattern):

1. **NestJS Container** (Primary)
   - Image: `fundlens-backend:latest`
   - Port: 3000
   - Resources: 1.5 vCPU, 3GB memory
   - Health check: `GET /api/health`
   - Communicates with Python parser via `localhost:8000`

2. **Python Parser Container** (Sidecar)
   - Image: `fundlens-python-parser:latest`
   - Port: 8000
   - Resources: 0.5 vCPU, 1GB memory
   - Health check: `GET /health`
   - FastAPI server for SEC filing parsing

Both containers share the same network namespace (localhost communication) and scale together as a unit.

### Network Architecture

```
VPC: 10.0.0.0/16
├── Public Subnets (ALB)
│   ├── 10.0.1.0/24 (us-east-1a)
│   └── 10.0.2.0/24 (us-east-1b)
├── Private Subnets (ECS Tasks)
│   ├── 10.0.10.0/24 (us-east-1a)
│   └── 10.0.20.0/24 (us-east-1b)
└── NAT Gateway (for outbound internet access)
```

### Security Groups

| Security Group | Inbound Rules | Outbound Rules |
|---------------|---------------|----------------|
| ALB-SG | 443 from 0.0.0.0/0 | All to ECS-SG |
| ECS-SG | 3000 from ALB-SG | All to 0.0.0.0/0 (NAT) |
| RDS-SG | 5432 from ECS-SG | None |

## Components and Interfaces

### 1. ECR Repositories

```typescript
interface ECRRepository {
  name: string;
  imageTagMutability: 'MUTABLE' | 'IMMUTABLE';
  scanOnPush: boolean;
  lifecyclePolicy: {
    maxImageCount: number;
    tagPrefixList: string[];
  };
}

// Repositories to create:
const repositories: ECRRepository[] = [
  {
    name: 'fundlens-backend',
    imageTagMutability: 'MUTABLE',
    scanOnPush: true,
    lifecyclePolicy: { maxImageCount: 10, tagPrefixList: ['prod-'] }
  },
  {
    name: 'fundlens-python-parser',
    imageTagMutability: 'MUTABLE',
    scanOnPush: true,
    lifecyclePolicy: { maxImageCount: 10, tagPrefixList: ['prod-'] }
  }
];
```

### 2. ECS Task Definition

```typescript
interface TaskDefinition {
  family: string;
  cpu: string;
  memory: string;
  networkMode: 'awsvpc';
  requiresCompatibilities: ['FARGATE'];
  executionRoleArn: string;
  taskRoleArn: string;
  containerDefinitions: ContainerDefinition[];
}

interface ContainerDefinition {
  name: string;
  image: string;
  essential: boolean;
  portMappings: { containerPort: number; protocol: 'tcp' }[];
  environment: { name: string; value: string }[];
  secrets: { name: string; valueFrom: string }[];
  logConfiguration: {
    logDriver: 'awslogs';
    options: {
      'awslogs-group': string;
      'awslogs-region': string;
      'awslogs-stream-prefix': string;
    };
  };
  healthCheck?: {
    command: string[];
    interval: number;
    timeout: number;
    retries: number;
    startPeriod: number;
  };
}
```

### 3. CloudFront Distribution

```typescript
interface CloudFrontConfig {
  origins: Origin[];
  defaultCacheBehavior: CacheBehavior;
  cacheBehaviors: CacheBehavior[];
  viewerCertificate: {
    acmCertificateArn: string;
    sslSupportMethod: 'sni-only';
    minimumProtocolVersion: 'TLSv1.2_2021';
  };
  aliases: string[];
  defaultRootObject: string;
  priceClass: 'PriceClass_100'; // US, Canada, Europe
}

interface Origin {
  id: string;
  domainName: string;
  originPath?: string;
  s3OriginConfig?: { originAccessIdentity: string };
  customOriginConfig?: {
    httpPort: number;
    httpsPort: number;
    originProtocolPolicy: 'https-only';
  };
}

interface CacheBehavior {
  pathPattern?: string;
  targetOriginId: string;
  viewerProtocolPolicy: 'redirect-to-https';
  allowedMethods: string[];
  cachedMethods: string[];
  cachePolicyId?: string;
  originRequestPolicyId?: string;
  compress: boolean;
}
```

### 4. Deployment Script Interface

```typescript
interface DeploymentConfig {
  environment: 'production';
  region: string;
  ecrRepositories: {
    backend: string;
    pythonParser: string;
  };
  ecsCluster: string;
  ecsService: string;
  s3FrontendBucket: string;
  cloudFrontDistributionId: string;
}

interface DeploymentResult {
  success: boolean;
  backendImageTag: string;
  pythonParserImageTag: string;
  taskDefinitionArn: string;
  deploymentId: string;
  cloudFrontInvalidationId?: string;
  errors?: string[];
}
```

## Data Models

### Secrets Manager Structure

```json
{
  "fundlens/production/database": {
    "host": "fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com",
    "port": "5432",
    "database": "fundlens_db",
    "username": "fundlens_admin",
    "password": "***"
  },
  "fundlens/production/cognito": {
    "userPoolId": "us-east-1_4OYqnpE18",
    "clientId": "4s4k1usimlqkr6sk55gbva183s",
    "clientSecret": "***"
  },
  "fundlens/production/platform": {
    "adminKey": "***"
  }
}
```

### Environment Variables (Non-Secret)

```bash
# NestJS Container
NODE_ENV=production
PORT=3000
AWS_REGION=us-east-1
PYTHON_PARSER_URL=http://localhost:8000
BEDROCK_KB_ID=NB5XNMHBQT
BEDROCK_DATA_SOURCE_ID=OQMSFOE5SL
BEDROCK_CHUNKS_BUCKET=fundlens-bedrock-chunks
S3_DATA_LAKE_BUCKET=fundlens-data-lake
S3_BUCKET_NAME=fundlens-documents-dev
KB_SYNC_LAMBDA_NAME=bedrock-kb-sync
SEC_USER_AGENT=FundLensAI/1.0 (contact: ops@fundlens.ai)
REQUEST_DELAY_MS=150
CACHE_TTL_MS=86400000

# Python Parser Container
PYTHONUNBUFFERED=1
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Container Health Consistency
*For any* ECS task in the cluster, if the NestJS container reports healthy on `/api/health`, then the Python parser container must also be reachable on `localhost:8000/health` from within the task.
**Validates: Requirements 1.4, 1.6**

### Property 2: Traffic Routing Correctness
*For any* HTTP request to `app.fundlens.ai`, if the path starts with `/api/`, then CloudFront must forward it to the ALB origin; otherwise, it must serve from the S3 origin.
**Validates: Requirements 3.4, 3.5**

### Property 3: Auto-Scaling Bounds
*For any* scaling event, the number of running ECS tasks must remain within the range [2, 10] inclusive.
**Validates: Requirements 2.5, 2.6**

### Property 4: Security Group Isolation
*For any* network connection to an ECS task on port 3000, the source must be the ALB security group; direct internet access to ECS tasks must be blocked.
**Validates: Requirements 5.2, 5.3**

### Property 5: Secret Injection Completeness
*For any* ECS task deployment, all secrets referenced in the task definition must exist in Secrets Manager and be successfully injected before the container starts.
**Validates: Requirements 6.1, 6.2**

### Property 6: Zero-Downtime Deployment
*For any* ECS service update, at least one healthy task must remain running throughout the deployment process until new tasks pass health checks.
**Validates: Requirements 8.4, 8.5**

### Property 7: SSL/TLS Enforcement
*For any* request to `app.fundlens.ai`, the connection must use TLS 1.2 or higher; HTTP requests must be redirected to HTTPS.
**Validates: Requirements 3.3, 4.6**

## Error Handling

### Container Failures

| Error Scenario | Detection | Recovery Action |
|---------------|-----------|-----------------|
| NestJS crash | Health check fails 3x | ECS restarts container |
| Python parser crash | NestJS health check fails | ECS restarts entire task |
| OOM (Out of Memory) | Container exits code 137 | ECS restarts task, alert triggered |
| Deadlock | Health check timeout | ECS restarts container |

### Deployment Failures

| Error Scenario | Detection | Recovery Action |
|---------------|-----------|-----------------|
| New task fails health check | ALB health check | ECS rolls back to previous task definition |
| ECR image pull failure | Task fails to start | Deployment aborted, alert triggered |
| Secrets Manager access denied | Task fails to start | Deployment aborted, check IAM role |
| Database connection failure | App health check fails | Task marked unhealthy, investigate RDS |

### Infrastructure Failures

| Error Scenario | Detection | Recovery Action |
|---------------|-----------|-----------------|
| AZ failure | ALB health checks | Traffic routed to healthy AZ |
| NAT Gateway failure | Outbound connections fail | Failover to NAT in other AZ |
| CloudFront origin failure | Origin health check | Return 503, alert triggered |

## Testing Strategy

### Unit Tests
- Dockerfile syntax validation (hadolint)
- CloudFormation/Terraform template validation
- IAM policy validation (least privilege check)
- Security group rule validation

### Integration Tests
- Container builds successfully locally
- Containers communicate via localhost
- Health check endpoints respond correctly
- Environment variables are properly set

### Infrastructure Tests (Property-Based)
- **Property 1**: Deploy task, verify both containers healthy
- **Property 2**: Send requests to CloudFront, verify routing
- **Property 3**: Trigger scaling, verify task count bounds
- **Property 4**: Attempt direct ECS access, verify blocked
- **Property 6**: Deploy update, verify zero downtime

### Smoke Tests (Post-Deployment)
1. `GET https://app.fundlens.ai/` → Returns login page
2. `GET https://app.fundlens.ai/api/health` → Returns 200 OK
3. `POST https://app.fundlens.ai/api/auth/login` → Cognito auth works
4. `GET https://app.fundlens.ai/api/deals` → Returns deals (authenticated)
5. `POST https://app.fundlens.ai/api/rag/query` → Bedrock KB responds

### Load Tests
- Baseline: 100 concurrent users, 5 minutes
- Verify auto-scaling triggers at expected thresholds
- Verify response times remain under 3s p99
