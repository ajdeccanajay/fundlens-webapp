# Requirements Document

## Introduction

This specification defines the requirements for deploying the FundLens application to AWS production infrastructure. The deployment will be fully containerized using ECS Fargate for auto-scaling, with the frontend served via CloudFront CDN. The application will be accessible at `app.fundlens.ai` with HTTPS encryption.

## Glossary

- **ECS_Cluster**: AWS Elastic Container Service cluster that manages containerized workloads
- **Fargate_Task**: Serverless container execution unit that runs without managing EC2 instances
- **ALB**: Application Load Balancer that distributes traffic to ECS tasks
- **CloudFront_Distribution**: AWS CDN that serves static frontend assets globally with low latency
- **ACM_Certificate**: AWS Certificate Manager SSL/TLS certificate for HTTPS
- **ECR_Repository**: Elastic Container Registry that stores Docker images
- **Route53_Record**: DNS record that maps domain names to AWS resources
- **VPC**: Virtual Private Cloud network isolation for backend services
- **Security_Group**: Firewall rules controlling inbound/outbound traffic
- **Task_Definition**: Blueprint for ECS containers including CPU, memory, environment variables
- **Service_Discovery**: Internal DNS for container-to-container communication

## Requirements

### Requirement 1: Container Infrastructure

**User Story:** As a DevOps engineer, I want containerized backend services, so that I can scale the application horizontally based on demand.

#### Acceptance Criteria

1. THE ECR_Repository SHALL store Docker images for the NestJS backend service
2. THE ECR_Repository SHALL store Docker images for the Python parser service
3. WHEN a new image is pushed to ECR, THE ECS_Cluster SHALL be able to pull and deploy it
4. THE Fargate_Task SHALL run both NestJS and Python containers as sidecars in the same task
5. THE Fargate_Task SHALL allocate minimum 2 vCPU and 4GB memory for production workloads
6. WHEN container health checks fail, THE ECS_Cluster SHALL automatically restart the container
7. THE Task_Definition SHALL include environment variables for all AWS service connections

### Requirement 2: Load Balancing and Auto-Scaling

**User Story:** As a platform operator, I want automatic scaling based on traffic, so that the application handles variable load without manual intervention.

#### Acceptance Criteria

1. THE ALB SHALL distribute incoming HTTPS traffic across healthy ECS tasks
2. THE ALB SHALL perform health checks on the `/api/health` endpoint every 30 seconds
3. WHEN CPU utilization exceeds 70% for 3 minutes, THE ECS_Cluster SHALL scale out by adding tasks
4. WHEN CPU utilization drops below 30% for 10 minutes, THE ECS_Cluster SHALL scale in by removing tasks
5. THE ECS_Cluster SHALL maintain minimum 2 tasks for high availability
6. THE ECS_Cluster SHALL allow maximum 10 tasks during peak load
7. THE ALB SHALL use sticky sessions for WebSocket connections if needed

### Requirement 3: Frontend Static Hosting

**User Story:** As a user, I want fast page loads globally, so that I can access the application with minimal latency.

#### Acceptance Criteria

1. THE S3_Bucket SHALL store all static frontend assets from the `public/` directory
2. THE CloudFront_Distribution SHALL serve frontend assets with edge caching
3. THE CloudFront_Distribution SHALL redirect HTTP requests to HTTPS
4. WHEN a request matches `/api/*`, THE CloudFront_Distribution SHALL forward it to the ALB origin
5. WHEN a request matches `/*` (non-API), THE CloudFront_Distribution SHALL serve from S3 origin
6. THE CloudFront_Distribution SHALL use the ACM_Certificate for `app.fundlens.ai`
7. THE CloudFront_Distribution SHALL set cache headers for static assets (1 year for versioned, 1 hour for HTML)

### Requirement 4: DNS and SSL Configuration

**User Story:** As a user, I want to access the application via a secure, memorable domain, so that I can trust the connection is encrypted.

#### Acceptance Criteria

1. THE ACM_Certificate SHALL be issued for `app.fundlens.ai` and `*.fundlens.ai`
2. THE ACM_Certificate SHALL be validated via DNS validation in Route53
3. THE Route53_Record SHALL create an A record aliasing `app.fundlens.ai` to CloudFront
4. THE Route53_Record SHALL create a CNAME for `api.fundlens.ai` pointing to the ALB (optional, for direct API access)
5. WHEN the certificate is near expiration, ACM SHALL automatically renew it
6. THE CloudFront_Distribution SHALL enforce TLS 1.2 minimum

### Requirement 5: Network Security

**User Story:** As a security engineer, I want proper network isolation, so that backend services are protected from unauthorized access.

#### Acceptance Criteria

1. THE VPC SHALL have public subnets for ALB and private subnets for ECS tasks
2. THE Security_Group for ALB SHALL allow inbound traffic only on ports 80 and 443
3. THE Security_Group for ECS tasks SHALL allow inbound traffic only from the ALB security group
4. THE Security_Group for RDS SHALL allow inbound traffic only from the ECS task security group
5. THE ECS tasks SHALL access AWS services (S3, Bedrock, Cognito) via VPC endpoints or NAT Gateway
6. THE VPC SHALL span at least 2 Availability Zones for high availability
7. IF a security group rule is overly permissive (0.0.0.0/0 on non-HTTP ports), THEN THE deployment SHALL fail validation

### Requirement 6: Environment Configuration

**User Story:** As a developer, I want secure environment variable management, so that secrets are not exposed in code or logs.

#### Acceptance Criteria

1. THE Task_Definition SHALL retrieve database credentials from AWS Secrets Manager
2. THE Task_Definition SHALL retrieve API keys from AWS Secrets Manager
3. THE Task_Definition SHALL use environment variables for non-sensitive configuration
4. WHEN a secret is rotated in Secrets Manager, THE ECS tasks SHALL pick up new values on next deployment
5. THE CloudWatch_Logs SHALL NOT contain any secret values (masked in application code)
6. THE Task_Definition SHALL set `NODE_ENV=production` for the NestJS container

### Requirement 7: Monitoring and Logging

**User Story:** As an operator, I want centralized logging and metrics, so that I can troubleshoot issues and monitor application health.

#### Acceptance Criteria

1. THE ECS tasks SHALL send application logs to CloudWatch Logs
2. THE CloudWatch_Logs SHALL retain logs for 30 days
3. THE ALB SHALL send access logs to an S3 bucket
4. THE CloudWatch_Alarm SHALL alert when error rate exceeds 5% over 5 minutes
5. THE CloudWatch_Alarm SHALL alert when p99 latency exceeds 3 seconds
6. THE CloudWatch_Dashboard SHALL display key metrics: request count, error rate, latency, CPU, memory
7. WHEN an alarm triggers, THE SNS_Topic SHALL send notifications to the operations team

### Requirement 8: Deployment Pipeline

**User Story:** As a developer, I want automated deployments, so that I can ship changes quickly and safely.

#### Acceptance Criteria

1. THE Deployment_Script SHALL build Docker images for both NestJS and Python services
2. THE Deployment_Script SHALL push images to ECR with unique tags (git SHA + timestamp)
3. THE Deployment_Script SHALL update the ECS service to use the new task definition
4. THE ECS_Service SHALL perform rolling deployments with zero downtime
5. WHEN a new deployment fails health checks, THE ECS_Service SHALL automatically rollback
6. THE Deployment_Script SHALL sync frontend assets to S3 and invalidate CloudFront cache
7. THE Deployment_Script SHALL be executable locally and in CI/CD (GitHub Actions compatible)

### Requirement 9: Database Connectivity

**User Story:** As a backend service, I want reliable database connectivity, so that queries execute without connection failures.

#### Acceptance Criteria

1. THE ECS tasks SHALL connect to the existing RDS PostgreSQL instance
2. THE Security_Group for RDS SHALL be updated to allow connections from ECS task security group
3. THE DATABASE_URL environment variable SHALL use the RDS endpoint with SSL enabled
4. THE connection pool SHALL be configured for 10 connections per task (matching current config)
5. IF the RDS instance is in a different VPC, THEN VPC peering SHALL be configured

### Requirement 10: Integration with Existing AWS Services

**User Story:** As a platform, I want to reuse existing AWS resources, so that data continuity is maintained.

#### Acceptance Criteria

1. THE ECS tasks SHALL use the existing Cognito User Pool (`us-east-1_4OYqnpE18`) for authentication
2. THE ECS tasks SHALL use the existing Bedrock Knowledge Base (`NB5XNMHBQT`) for RAG
3. THE ECS tasks SHALL use the existing S3 bucket (`fundlens-bedrock-chunks`) for KB sync
4. THE ECS tasks SHALL use the existing S3 bucket (`fundlens-data-lake`) for document storage
5. THE IAM_Role for ECS tasks SHALL have permissions for all integrated AWS services
6. THE existing Lambda function (`bedrock-kb-sync`) SHALL continue to function with the new deployment
