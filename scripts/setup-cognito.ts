/**
 * AWS Cognito User Pool Setup Script
 * 
 * This script creates and configures a Cognito User Pool for FundLens multi-tenant authentication.
 * 
 * Features:
 * - Email/password authentication
 * - Email verification
 * - Custom attributes for tenant_id and tenant_role
 * - Secure password policy (Wall Street grade)
 * - App client with USER_PASSWORD_AUTH flow
 * 
 * Usage: npx ts-node scripts/setup-cognito.ts
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  DescribeUserPoolCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  ListUserPoolsCommand,
  UserPoolType,
} from '@aws-sdk/client-cognito-identity-provider';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const USER_POOL_NAME = 'fundlens-user-pool';
const APP_CLIENT_NAME = 'fundlens-web-client';

interface CognitoSetupResult {
  userPoolId: string;
  userPoolArn: string;
  appClientId: string;
  appClientSecret?: string;
}

async function findExistingUserPool(): Promise<UserPoolType | null> {
  console.log('🔍 Checking for existing user pool...');
  
  const response = await cognitoClient.send(
    new ListUserPoolsCommand({ MaxResults: 60 })
  );
  
  const existingPool = response.UserPools?.find(
    pool => pool.Name === USER_POOL_NAME
  );
  
  if (existingPool) {
    console.log(`✅ Found existing user pool: ${existingPool.Id}`);
    return existingPool;
  }
  
  return null;
}

async function createUserPool(): Promise<{ userPoolId: string; userPoolArn: string }> {
  console.log('🏗️  Creating Cognito User Pool...');
  
  const response = await cognitoClient.send(
    new CreateUserPoolCommand({
      PoolName: USER_POOL_NAME,
      
      // Password policy - Enterprise grade
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 7,
        },
      },
      
      // Auto-verify email
      AutoVerifiedAttributes: ['email'],
      
      // Username configuration - use email as username
      UsernameAttributes: ['email'],
      
      // Username case sensitivity
      UsernameConfiguration: {
        CaseSensitive: false,
      },
      
      // Email verification
      VerificationMessageTemplate: {
        DefaultEmailOption: 'CONFIRM_WITH_CODE',
        EmailSubject: 'FundLens - Verify your email',
        EmailMessage: 'Your FundLens verification code is {####}. This code expires in 24 hours.',
      },
      
      // Account recovery
      AccountRecoverySetting: {
        RecoveryMechanisms: [
          {
            Name: 'verified_email',
            Priority: 1,
          },
        ],
      },
      
      // MFA configuration (optional, can be enabled later)
      MfaConfiguration: 'OFF',
      
      // Custom attributes for multi-tenancy
      Schema: [
        {
          Name: 'tenant_id',
          AttributeDataType: 'String',
          Mutable: true,
          Required: false,
          StringAttributeConstraints: {
            MinLength: '1',
            MaxLength: '256',
          },
        },
        {
          Name: 'tenant_role',
          AttributeDataType: 'String',
          Mutable: true,
          Required: false,
          StringAttributeConstraints: {
            MinLength: '1',
            MaxLength: '50',
          },
        },
        {
          Name: 'tenant_slug',
          AttributeDataType: 'String',
          Mutable: true,
          Required: false,
          StringAttributeConstraints: {
            MinLength: '1',
            MaxLength: '100',
          },
        },
      ],
      
      // Admin create user config
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: false,
        InviteMessageTemplate: {
          EmailSubject: 'Welcome to FundLens',
          EmailMessage: 'Your FundLens account has been created. Username: {username}. Your temporary password is {####}. Please sign in and change your password.',
        },
      },
      
      // User pool add-ons
      UserPoolAddOns: {
        AdvancedSecurityMode: 'ENFORCED',
      },
      
      // Tags
      UserPoolTags: {
        Application: 'FundLens',
        Environment: process.env.NODE_ENV || 'development',
      },
    })
  );
  
  const userPoolId = response.UserPool?.Id;
  const userPoolArn = response.UserPool?.Arn;
  
  if (!userPoolId || !userPoolArn) {
    throw new Error('Failed to create user pool - no ID returned');
  }
  
  console.log(`✅ User Pool created: ${userPoolId}`);
  return { userPoolId, userPoolArn };
}

async function createAppClient(userPoolId: string): Promise<{ appClientId: string; appClientSecret?: string }> {
  console.log('🔧 Creating App Client...');
  
  const response = await cognitoClient.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: APP_CLIENT_NAME,
      
      // Generate client secret for server-side auth
      GenerateSecret: true,
      
      // Explicit auth flows
      ExplicitAuthFlows: [
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH',
        'ALLOW_USER_SRP_AUTH',
        'ALLOW_ADMIN_USER_PASSWORD_AUTH',
      ],
      
      // Token validity
      AccessTokenValidity: 1, // 1 hour
      IdTokenValidity: 1, // 1 hour
      RefreshTokenValidity: 30, // 30 days
      TokenValidityUnits: {
        AccessToken: 'hours',
        IdToken: 'hours',
        RefreshToken: 'days',
      },
      
      // Prevent user existence errors (security)
      PreventUserExistenceErrors: 'ENABLED',
      
      // Read/write attributes
      ReadAttributes: [
        'email',
        'email_verified',
        'custom:tenant_id',
        'custom:tenant_role',
        'custom:tenant_slug',
      ],
      WriteAttributes: [
        'email',
        'custom:tenant_id',
        'custom:tenant_role',
        'custom:tenant_slug',
      ],
      
      // Supported identity providers
      SupportedIdentityProviders: ['COGNITO'],
    })
  );
  
  const appClientId = response.UserPoolClient?.ClientId;
  const appClientSecret = response.UserPoolClient?.ClientSecret;
  
  if (!appClientId) {
    throw new Error('Failed to create app client - no ID returned');
  }
  
  console.log(`✅ App Client created: ${appClientId}`);
  return { appClientId, appClientSecret };
}

async function updateEnvFile(config: CognitoSetupResult): Promise<void> {
  console.log('📝 Updating .env file...');
  
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  
  // Remove existing Cognito config if present
  envContent = envContent.replace(/\n# AWS Cognito Configuration[\s\S]*?(?=\n#|$)/g, '');
  
  // Add new Cognito config
  const cognitoConfig = `
# AWS Cognito Configuration
COGNITO_USER_POOL_ID=${config.userPoolId}
COGNITO_APP_CLIENT_ID=${config.appClientId}
${config.appClientSecret ? `COGNITO_APP_CLIENT_SECRET=${config.appClientSecret}` : ''}
COGNITO_REGION=${process.env.AWS_REGION || 'us-east-1'}
`;
  
  envContent += cognitoConfig;
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env file updated with Cognito configuration');
}

async function createTestTenantAndUser(userPoolId: string): Promise<void> {
  console.log('👤 Creating test tenant and user...');
  
  const testEmail = 'admin@fundlens-test.com';
  const testPassword = 'FundLens2025!Secure';
  const testTenantId = '00000000-0000-0000-0000-000000000001';
  const testTenantSlug = 'fundlens-test';
  
  try {
    // Create admin user
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: testEmail,
        UserAttributes: [
          { Name: 'email', Value: testEmail },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:tenant_id', Value: testTenantId },
          { Name: 'custom:tenant_role', Value: 'admin' },
          { Name: 'custom:tenant_slug', Value: testTenantSlug },
        ],
        MessageAction: 'SUPPRESS', // Don't send welcome email
      })
    );
    
    // Set permanent password
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: testEmail,
        Password: testPassword,
        Permanent: true,
      })
    );
    
    console.log(`✅ Test user created: ${testEmail}`);
    console.log(`   Password: ${testPassword}`);
    console.log(`   Tenant ID: ${testTenantId}`);
    console.log(`   Tenant Slug: ${testTenantSlug}`);
    console.log(`   Role: admin`);
  } catch (error: any) {
    if (error.name === 'UsernameExistsException') {
      console.log(`ℹ️  Test user already exists: ${testEmail}`);
    } else {
      throw error;
    }
  }
}

async function main(): Promise<void> {
  console.log('🚀 FundLens Cognito Setup\n');
  
  try {
    let userPoolId: string;
    let userPoolArn: string;
    
    // Check for existing user pool
    const existingPool = await findExistingUserPool();
    
    if (existingPool && existingPool.Id) {
      userPoolId = existingPool.Id;
      userPoolArn = existingPool.Arn || '';
      console.log(`ℹ️  Using existing user pool: ${userPoolId}`);
    } else {
      // Create new user pool
      const poolResult = await createUserPool();
      userPoolId = poolResult.userPoolId;
      userPoolArn = poolResult.userPoolArn;
    }
    
    // Create app client
    const clientResult = await createAppClient(userPoolId);
    
    // Update .env file
    const config: CognitoSetupResult = {
      userPoolId,
      userPoolArn,
      appClientId: clientResult.appClientId,
      appClientSecret: clientResult.appClientSecret,
    };
    
    await updateEnvFile(config);
    
    // Create test user
    await createTestTenantAndUser(userPoolId);
    
    console.log('\n✅ Cognito setup complete!\n');
    console.log('Configuration:');
    console.log(`  User Pool ID: ${userPoolId}`);
    console.log(`  App Client ID: ${clientResult.appClientId}`);
    console.log(`  Region: ${process.env.AWS_REGION || 'us-east-1'}`);
    console.log('\nTest credentials:');
    console.log('  Email: admin@fundlens-test.com');
    console.log('  Password: FundLens2025!Secure');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

main();
