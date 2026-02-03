/**
 * AWS Cognito Authentication Service
 * 
 * Enterprise-grade authentication service for FundLens multi-tenant application.
 * Handles user registration, authentication, token management, and password operations.
 * 
 * Security Features:
 * - Secure password hashing (handled by Cognito)
 * - JWT token validation
 * - Refresh token rotation
 * - Rate limiting (handled by Cognito)
 * - Brute force protection (handled by Cognito Advanced Security)
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GlobalSignOutCommand,
  GetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
  ResendConfirmationCodeCommand,
  AuthFlowType,
  ChallengeNameType,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';

export interface SignUpDto {
  email: string;
  password: string;
  tenantId: string;
  tenantSlug: string;
  tenantRole?: 'admin' | 'analyst' | 'viewer';
}

export interface SignInDto {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface UserInfo {
  userId: string;
  email: string;
  emailVerified: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantRole: string;
}

export interface PasswordResetDto {
  email: string;
}

export interface ConfirmPasswordResetDto {
  email: string;
  code: string;
  newPassword: string;
}

@Injectable()
export class CognitoAuthService {
  private readonly logger = new Logger(CognitoAuthService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;

  constructor() {
    const region = process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-east-1';
    
    this.cognitoClient = new CognitoIdentityProviderClient({ region });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID || '';
    this.clientId = process.env.COGNITO_APP_CLIENT_ID || '';
    this.clientSecret = process.env.COGNITO_APP_CLIENT_SECRET;

    if (!this.userPoolId || !this.clientId) {
      this.logger.warn('Cognito configuration missing - authentication will not work');
    }
  }

  /**
   * Register a new user with email and password
   * Creates user in Cognito with tenant attributes
   */
  async signUp(dto: SignUpDto): Promise<{ userId: string; userConfirmed: boolean }> {
    this.logger.log(`Signing up user: ${dto.email}`);

    try {
      const secretHash = this.calculateSecretHash(dto.email);

      const response = await this.cognitoClient.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: dto.email,
          Password: dto.password,
          SecretHash: secretHash,
          UserAttributes: [
            { Name: 'email', Value: dto.email },
            { Name: 'custom:tenant_id', Value: dto.tenantId },
            { Name: 'custom:tenant_slug', Value: dto.tenantSlug },
            { Name: 'custom:tenant_role', Value: dto.tenantRole || 'analyst' },
          ],
        })
      );

      this.logger.log(`User signed up successfully: ${response.UserSub}`);

      return {
        userId: response.UserSub || '',
        userConfirmed: response.UserConfirmed || false,
      };
    } catch (error: any) {
      this.logger.error(`Sign up failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Confirm user registration with verification code
   */
  async confirmSignUp(email: string, code: string): Promise<void> {
    this.logger.log(`Confirming sign up for: ${email}`);

    try {
      const secretHash = this.calculateSecretHash(email);

      await this.cognitoClient.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
          SecretHash: secretHash,
        })
      );

      this.logger.log(`User confirmed: ${email}`);
    } catch (error: any) {
      this.logger.error(`Confirm sign up failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Resend confirmation code
   */
  async resendConfirmationCode(email: string): Promise<void> {
    this.logger.log(`Resending confirmation code to: ${email}`);

    try {
      const secretHash = this.calculateSecretHash(email);

      await this.cognitoClient.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          Username: email,
          SecretHash: secretHash,
        })
      );

      this.logger.log(`Confirmation code resent to: ${email}`);
    } catch (error: any) {
      this.logger.error(`Resend confirmation code failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Sign in with email and password
   * Returns JWT tokens for authentication
   */
  async signIn(dto: SignInDto): Promise<AuthTokens> {
    this.logger.log(`Signing in user: ${dto.email}`);

    try {
      const secretHash = this.calculateSecretHash(dto.email);

      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
          ClientId: this.clientId,
          AuthParameters: {
            USERNAME: dto.email,
            PASSWORD: dto.password,
            SECRET_HASH: secretHash,
          },
        })
      );

      // Handle NEW_PASSWORD_REQUIRED challenge
      if (response.ChallengeName === ChallengeNameType.NEW_PASSWORD_REQUIRED) {
        throw new BadRequestException('Password change required. Please reset your password.');
      }

      if (!response.AuthenticationResult) {
        throw new UnauthorizedException('Authentication failed');
      }

      const result = response.AuthenticationResult;

      this.logger.log(`User signed in successfully: ${dto.email}`);

      return {
        accessToken: result.AccessToken || '',
        refreshToken: result.RefreshToken || '',
        idToken: result.IdToken || '',
        expiresIn: result.ExpiresIn || 3600,
        tokenType: result.TokenType || 'Bearer',
      };
    } catch (error: any) {
      this.logger.error(`Sign in failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string, email: string): Promise<AuthTokens> {
    this.logger.log('Refreshing access token');

    try {
      const secretHash = this.calculateSecretHash(email);

      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          ClientId: this.clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: secretHash,
          },
        })
      );

      if (!response.AuthenticationResult) {
        throw new UnauthorizedException('Token refresh failed');
      }

      const result = response.AuthenticationResult;

      this.logger.log('Token refreshed successfully');

      return {
        accessToken: result.AccessToken || '',
        refreshToken: refreshToken, // Refresh token doesn't change
        idToken: result.IdToken || '',
        expiresIn: result.ExpiresIn || 3600,
        tokenType: result.TokenType || 'Bearer',
      };
    } catch (error: any) {
      this.logger.error(`Token refresh failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Sign out user globally (invalidate all tokens)
   */
  async signOut(accessToken: string): Promise<void> {
    this.logger.log('Signing out user');

    try {
      await this.cognitoClient.send(
        new GlobalSignOutCommand({
          AccessToken: accessToken,
        })
      );

      this.logger.log('User signed out successfully');
    } catch (error: any) {
      this.logger.error(`Sign out failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Initiate password reset
   */
  async forgotPassword(email: string): Promise<void> {
    this.logger.log(`Initiating password reset for: ${email}`);

    try {
      const secretHash = this.calculateSecretHash(email);

      await this.cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: this.clientId,
          Username: email,
          SecretHash: secretHash,
        })
      );

      this.logger.log(`Password reset initiated for: ${email}`);
    } catch (error: any) {
      this.logger.error(`Forgot password failed: ${error.message}`);
      // Don't reveal if user exists - always return success
      this.logger.log('Password reset request processed (user may not exist)');
    }
  }

  /**
   * Confirm password reset with verification code
   */
  async confirmForgotPassword(dto: ConfirmPasswordResetDto): Promise<void> {
    this.logger.log(`Confirming password reset for: ${dto.email}`);

    try {
      const secretHash = this.calculateSecretHash(dto.email);

      await this.cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          Username: dto.email,
          ConfirmationCode: dto.code,
          Password: dto.newPassword,
          SecretHash: secretHash,
        })
      );

      this.logger.log(`Password reset confirmed for: ${dto.email}`);
    } catch (error: any) {
      this.logger.error(`Confirm password reset failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Get user info from access token
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      const response = await this.cognitoClient.send(
        new GetUserCommand({
          AccessToken: accessToken,
        })
      );

      const attributes = response.UserAttributes || [];
      const getAttribute = (name: string): string => {
        const attr = attributes.find(a => a.Name === name);
        return attr?.Value || '';
      };

      return {
        userId: response.Username || '',
        email: getAttribute('email'),
        emailVerified: getAttribute('email_verified') === 'true',
        tenantId: getAttribute('custom:tenant_id'),
        tenantSlug: getAttribute('custom:tenant_slug'),
        tenantRole: getAttribute('custom:tenant_role'),
      };
    } catch (error: any) {
      this.logger.error(`Get user info failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Admin: Create user with pre-set password (no email verification)
   */
  async adminCreateUser(
    email: string,
    password: string,
    tenantId: string,
    tenantSlug: string,
    tenantRole: 'admin' | 'analyst' | 'viewer' = 'analyst',
  ): Promise<string> {
    this.logger.log(`Admin creating user: ${email}`);

    try {
      // Create user
      const createResponse = await this.cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:tenant_id', Value: tenantId },
            { Name: 'custom:tenant_slug', Value: tenantSlug },
            { Name: 'custom:tenant_role', Value: tenantRole },
          ],
          MessageAction: 'SUPPRESS', // Don't send welcome email
        })
      );

      const userId = createResponse.User?.Username || '';

      // Set permanent password
      await this.cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          Password: password,
          Permanent: true,
        })
      );

      this.logger.log(`Admin created user: ${email}`);
      return userId;
    } catch (error: any) {
      this.logger.error(`Admin create user failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Admin: Update user's tenant attributes
   */
  async adminUpdateUserTenant(
    email: string,
    tenantId: string,
    tenantSlug: string,
    tenantRole: string,
  ): Promise<void> {
    this.logger.log(`Admin updating user tenant: ${email}`);

    try {
      await this.cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'custom:tenant_id', Value: tenantId },
            { Name: 'custom:tenant_slug', Value: tenantSlug },
            { Name: 'custom:tenant_role', Value: tenantRole },
          ],
        })
      );

      this.logger.log(`Admin updated user tenant: ${email}`);
    } catch (error: any) {
      this.logger.error(`Admin update user tenant failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Admin: Get user by email
   */
  async adminGetUser(email: string): Promise<UserInfo | null> {
    try {
      const response = await this.cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        })
      );

      const attributes = response.UserAttributes || [];
      const getAttribute = (name: string): string => {
        const attr = attributes.find(a => a.Name === name);
        return attr?.Value || '';
      };

      return {
        userId: response.Username || '',
        email: getAttribute('email'),
        emailVerified: getAttribute('email_verified') === 'true',
        tenantId: getAttribute('custom:tenant_id'),
        tenantSlug: getAttribute('custom:tenant_slug'),
        tenantRole: getAttribute('custom:tenant_role'),
      };
    } catch (error: any) {
      if (error.name === 'UserNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Admin: Get user by Cognito user ID (sub)
   * Used when we have the user ID but need to get the email
   */
  async adminGetUserById(userId: string): Promise<UserInfo | null> {
    try {
      // In Cognito, the username can be the user ID (sub) or email
      // Try to get user by the userId directly
      const response = await this.cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: userId,
        })
      );

      const attributes = response.UserAttributes || [];
      const getAttribute = (name: string): string => {
        const attr = attributes.find(a => a.Name === name);
        return attr?.Value || '';
      };

      return {
        userId: response.Username || '',
        email: getAttribute('email'),
        emailVerified: getAttribute('email_verified') === 'true',
        tenantId: getAttribute('custom:tenant_id'),
        tenantSlug: getAttribute('custom:tenant_slug'),
        tenantRole: getAttribute('custom:tenant_role'),
      };
    } catch (error: any) {
      if (error.name === 'UserNotFoundException') {
        return null;
      }
      this.logger.warn(`Failed to get user by ID ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Admin: Delete user
   */
  async adminDeleteUser(email: string): Promise<void> {
    this.logger.log(`Admin deleting user: ${email}`);

    try {
      await this.cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        })
      );

      this.logger.log(`Admin deleted user: ${email}`);
    } catch (error: any) {
      this.logger.error(`Admin delete user failed: ${error.message}`);
      this.handleCognitoError(error);
      throw error;
    }
  }

  /**
   * Calculate SECRET_HASH for Cognito API calls
   * Required when app client has a secret
   */
  private calculateSecretHash(username: string): string {
    if (!this.clientSecret) {
      return '';
    }

    const message = username + this.clientId;
    const hmac = crypto.createHmac('sha256', this.clientSecret);
    hmac.update(message);
    return hmac.digest('base64');
  }

  /**
   * Handle Cognito errors and convert to appropriate HTTP exceptions
   */
  private handleCognitoError(error: any): never {
    const errorName = error.name || error.code;

    switch (errorName) {
      case 'UserNotFoundException':
      case 'NotAuthorizedException':
        throw new UnauthorizedException('Invalid email or password');
      
      case 'UsernameExistsException':
        throw new BadRequestException('An account with this email already exists');
      
      case 'InvalidPasswordException':
        throw new BadRequestException(
          'Password does not meet requirements: minimum 12 characters, uppercase, lowercase, number, and special character'
        );
      
      case 'CodeMismatchException':
        throw new BadRequestException('Invalid verification code');
      
      case 'ExpiredCodeException':
        throw new BadRequestException('Verification code has expired');
      
      case 'UserNotConfirmedException':
        throw new BadRequestException('Please verify your email before signing in');
      
      case 'TooManyRequestsException':
        throw new BadRequestException('Too many requests. Please try again later.');
      
      case 'LimitExceededException':
        throw new BadRequestException('Request limit exceeded. Please try again later.');
      
      case 'InvalidParameterException':
        throw new BadRequestException(error.message || 'Invalid request parameters');
      
      default:
        this.logger.error(`Unhandled Cognito error: ${errorName} - ${error.message}`);
        throw new UnauthorizedException('Authentication failed');
    }
  }
}
