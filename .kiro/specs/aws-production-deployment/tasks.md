# Implementation Plan: AWS Production Deployment

## Overview

This implementation plan covers deploying FundLens to AWS production infrastructure using ECS Fargate for containerized backend services and CloudFront for frontend delivery. The plan is organized into phases: infrastructure setup, containerization, deployment automation, and verification.

## Tasks

- [x] 1. Create Docker configurations for containerization
  - [x] 1.1 Create Dockerfile for NestJS backend
    - Multi-stage build for smaller image size
    - Install production dependencies only
    - Set NODE_ENV=production
    - Expose port 3000
    - Health check command
    - _Requirements: 1.1, 1.4, 6.6_

  - [x] 1.2 Create Dockerfile for Python parser
    - Use python:3.11-slim base image
    - Install requirements.txt dependencies
    - Expose port 8000
    - Health check command
    - _Requirements: 1.2, 1.4_

  - [x] 1.3 Create docker-compose.yml for local testing
    - Define both services with sidecar networking
    - Mount volumes for development
    - Environment variable configuration
    - _Requirements: 1.4_

- [x] 2. Create AWS infrastructure with CloudFormation/CDK
  - [x] 2.1 Create VPC and networking stack
    - VPC with 10.0.0.0/16 CIDR
    - 2 public subnets for ALB
    - 2 private subnets for ECS
    - NAT Gateway for outbound access
    - VPC endpoints for ECR, S3, CloudWatch
    - _Requirements: 5.1, 5.5, 5.6_

  - [x] 2.2 Create security groups stack
    - ALB security group (443 inbound from internet)
    - ECS security group (3000 from ALB only)
    - Update existing RDS security group (5432 from ECS)
    - _Requirements: 5.2, 5.3, 5.4, 9.2_

  - [x] 2.3 Create ECR repositories
    - fundlens-backend repository
    - fundlens-python-parser repository
    - Lifecycle policies for image cleanup
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.4 Create ECS cluster and task definition
    - Fargate cluster
    - Task definition with both containers
    - Resource allocation (2 vCPU, 4GB)
    - CloudWatch log configuration
    - Secrets Manager integration
    - _Requirements: 1.4, 1.5, 1.7, 6.1, 6.2, 6.3, 7.1_

  - [x] 2.5 Create Application Load Balancer
    - ALB in public subnets
    - HTTPS listener with ACM certificate
    - Target group for ECS service
    - Health check configuration (/api/health)
    - _Requirements: 2.1, 2.2, 2.7_

  - [x] 2.6 Create ECS service with auto-scaling
    - Service with desired count 2
    - Auto-scaling policy (CPU-based)
    - Min 2, max 10 tasks
    - Rolling deployment configuration
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 8.4, 8.5_

- [x] 3. Create frontend hosting infrastructure
  - [x] 3.1 Create S3 bucket for static assets
    - Bucket for frontend files
    - Block public access (CloudFront only)
    - Bucket policy for CloudFront OAI
    - _Requirements: 3.1_

  - [x] 3.2 Create ACM certificate
    - Request certificate for app.fundlens.ai and *.fundlens.ai
    - DNS validation via Route53
    - _Requirements: 4.1, 4.2_

  - [x] 3.3 Create CloudFront distribution
    - S3 origin for static assets (default)
    - ALB origin for /api/* paths
    - HTTPS redirect behavior
    - Cache policies for static assets
    - Origin Access Identity for S3
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.6_

  - [x] 3.4 Create Route53 DNS records
    - A record alias for app.fundlens.ai → CloudFront
    - Optional: api.fundlens.ai → ALB
    - _Requirements: 4.3, 4.4_

- [x] 4. Create secrets and IAM configuration
  - [x] 4.1 Create Secrets Manager secrets
    - Database credentials secret
    - Cognito client secret
    - Platform admin key secret
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 Create IAM roles and policies
    - ECS task execution role (ECR, Secrets Manager, CloudWatch)
    - ECS task role (S3, Bedrock, Cognito, Lambda)
    - _Requirements: 10.5_

- [x] 5. Create monitoring and alerting
  - [x] 5.1 Create CloudWatch log groups
    - /ecs/fundlens-backend log group
    - /ecs/fundlens-python-parser log group
    - 30-day retention policy
    - _Requirements: 7.1, 7.2_

  - [x] 5.2 Create CloudWatch alarms
    - Error rate alarm (>5% for 5 min)
    - Latency alarm (p99 >3s)
    - CPU utilization alarm
    - _Requirements: 7.4, 7.5_

  - [x] 5.3 Create CloudWatch dashboard
    - Request count widget
    - Error rate widget
    - Latency percentiles widget
    - CPU/Memory utilization widget
    - _Requirements: 7.6_

  - [x] 5.4 Create SNS topic for alerts
    - Topic for alarm notifications
    - Email subscription for ops team
    - _Requirements: 7.7_

  - [x] 5.5 Configure ALB access logs
    - S3 bucket for access logs
    - ALB logging configuration
    - _Requirements: 7.3_

- [x] 6. Create deployment scripts
  - [x] 6.1 Create build-and-push.sh script
    - Build Docker images for both services
    - Tag with git SHA and timestamp
    - Push to ECR repositories
    - _Requirements: 8.1, 8.2_

  - [x] 6.2 Create deploy-backend.sh script
    - Register new task definition
    - Update ECS service
    - Wait for deployment to stabilize
    - Rollback on failure
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 6.3 Create deploy-frontend.sh script
    - Sync public/ to S3 bucket
    - Set cache headers
    - Create CloudFront invalidation
    - _Requirements: 8.6_

  - [x] 6.4 Create deploy-all.sh master script
    - Orchestrate full deployment
    - Build, push, deploy backend
    - Deploy frontend
    - Run smoke tests
    - _Requirements: 8.7_

- [x] 7. Update application configuration for production
  - [x] 7.1 Update NestJS configuration for production
    - Production database URL with SSL
    - Update CORS settings for app.fundlens.ai
    - Update Cognito callback URLs
    - _Requirements: 9.3, 9.4_

  - [x] 7.2 Update frontend API endpoints
    - Update API base URL to use relative paths (/api)
    - Update Cognito configuration for production domain
    - _Requirements: 3.4, 10.1_

- [x] 8. Checkpoint - Verify infrastructure deployment
  - Deploy CloudFormation stacks
  - Verify all resources created successfully
  - Test network connectivity between components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Initial deployment and verification
  - [x] 9.1 Build and push initial Docker images
    - Build both images locally
    - Push to ECR
    - Verify images in ECR console
    - _Requirements: 1.1, 1.2, 8.1, 8.2_

  - [x] 9.2 Deploy backend to ECS
    - Create initial task definition
    - Start ECS service
    - Verify tasks are running
    - Check health check status
    - _Requirements: 1.6, 8.3_

  - [x] 9.3 Deploy frontend to S3/CloudFront
    - Sync frontend assets to S3
    - Verify CloudFront distribution
    - Test HTTPS access
    - _Requirements: 3.1, 8.6_

  - [x] 9.4 Run smoke tests
    - Test homepage loads
    - Test API health endpoint
    - Test authentication flow
    - Test deal creation
    - Test RAG query
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 10. Final checkpoint - Production verification
  - Verify all endpoints accessible via app.fundlens.ai
  - Verify auto-scaling configuration
  - Verify monitoring and alerting
  - Verify existing Lambda function still works
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 10.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The deployment uses existing AWS resources (Cognito, Bedrock KB, RDS, S3 buckets)
- Infrastructure is defined as code for reproducibility
