/**
 * Unit Tests for CognitoAuthService
 * 
 * Tests authentication flows including signup, signin, token refresh,
 * password reset, and error handling.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { CognitoAuthService } from '../../src/auth/cognito-auth.service';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  return {
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    InitiateAuthCommand: jest.fn(),
    SignUpCommand: jest.fn(),
    ConfirmSignUpCommand: jest.fn(),
    ForgotPasswordCommand: jest.fn(),
    ConfirmForgotPasswordCommand: jest.fn(),
    GlobalSignOutCommand: jest.fn(),
    GetUserCommand: jest.fn(),
    AdminCreateUserCommand: jest.fn(),
    AdminSetUserPasswordCommand: jest.fn(),
    AdminUpdateUserAttributesCommand: jest.fn(),
    AdminGetUserCommand: jest.fn(),
    AdminDeleteUserCommand: jest.fn(),
    ResendConfirmationCodeCommand: jest.fn(),
    AuthFlowType: {
      USER_PASSWORD_AUTH: 'USER_PASSWORD_AUTH',
      REFRESH_TOKEN_AUTH: 'REFRESH_TOKEN_AUTH',
    },
    ChallengeNameType: {
      NEW_PASSWORD_REQUIRED: 'NEW_PASSWORD_REQUIRED',
    },
    RespondToAuthChallengeCommand: jest.fn(),
  };
});

describe('CognitoAuthService', () => {
  let service: CognitoAuthService;
  let mockCognitoClient: any;

  const mockTokens = {
    AccessToken: 'mock-access-token',
    RefreshToken: 'mock-refresh-token',
    IdToken: 'mock-id-token',
    ExpiresIn: 3600,
    TokenType: 'Bearer',
  };

  const mockUserAttributes = [
    { Name: 'email', Value: 'test@example.com' },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'custom:tenant_id', Value: 'tenant-123' },
    { Name: 'custom:tenant_slug', Value: 'test-tenant' },
    { Name: 'custom:tenant_role', Value: 'admin' },
  ];

  beforeEach(async () => {
    // Set environment variables
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_APP_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_APP_CLIENT_SECRET = 'test-client-secret';
    process.env.COGNITO_REGION = 'us-east-1';

    const module: TestingModule = await Test.createTestingModule({
      providers: [CognitoAuthService],
    }).compile();

    service = module.get<CognitoAuthService>(CognitoAuthService);
    
    // Get the mock client
    mockCognitoClient = (service as any).cognitoClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signUp', () => {
    it('should successfully sign up a new user', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({
        UserSub: 'user-123',
        UserConfirmed: false,
      });

      const result = await service.signUp({
        email: 'test@example.com',
        password: 'SecurePass123!',
        tenantId: 'tenant-123',
        tenantSlug: 'test-tenant',
        tenantRole: 'admin',
      });

      expect(result.userId).toBe('user-123');
      expect(result.userConfirmed).toBe(false);
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException for existing user', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'UsernameExistsException',
        message: 'User already exists',
      });

      await expect(
        service.signUp({
          email: 'existing@example.com',
          password: 'SecurePass123!',
          tenantId: 'tenant-123',
          tenantSlug: 'test-tenant',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid password', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'InvalidPasswordException',
        message: 'Password does not meet requirements',
      });

      await expect(
        service.signUp({
          email: 'test@example.com',
          password: 'weak',
          tenantId: 'tenant-123',
          tenantSlug: 'test-tenant',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('signIn', () => {
    it('should successfully sign in and return tokens', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({
        AuthenticationResult: mockTokens,
      });

      const result = await service.signIn({
        email: 'test@example.com',
        password: 'SecurePass123!',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.idToken).toBe('mock-id-token');
      expect(result.expiresIn).toBe(3600);
      expect(result.tokenType).toBe('Bearer');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'NotAuthorizedException',
        message: 'Incorrect username or password',
      });

      await expect(
        service.signIn({
          email: 'test@example.com',
          password: 'wrongpassword',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'UserNotFoundException',
        message: 'User does not exist',
      });

      await expect(
        service.signIn({
          email: 'nonexistent@example.com',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for unconfirmed user', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'UserNotConfirmedException',
        message: 'User is not confirmed',
      });

      await expect(
        service.signIn({
          email: 'unconfirmed@example.com',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh tokens', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600,
          TokenType: 'Bearer',
        },
      });

      const result = await service.refreshToken('mock-refresh-token', 'test@example.com');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token'); // Refresh token doesn't change
      expect(result.idToken).toBe('new-id-token');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'NotAuthorizedException',
        message: 'Invalid refresh token',
      });

      await expect(
        service.refreshToken('invalid-token', 'test@example.com')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('signOut', () => {
    it('should successfully sign out user', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({});

      await expect(
        service.signOut('mock-access-token')
      ).resolves.not.toThrow();

      expect(mockCognitoClient.send).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'NotAuthorizedException',
        message: 'Invalid access token',
      });

      await expect(
        service.signOut('invalid-token')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getUserInfo', () => {
    it('should return user info from access token', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({
        Username: 'user-123',
        UserAttributes: mockUserAttributes,
      });

      const result = await service.getUserInfo('mock-access-token');

      expect(result.userId).toBe('user-123');
      expect(result.email).toBe('test@example.com');
      expect(result.emailVerified).toBe(true);
      expect(result.tenantId).toBe('tenant-123');
      expect(result.tenantSlug).toBe('test-tenant');
      expect(result.tenantRole).toBe('admin');
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'NotAuthorizedException',
        message: 'Invalid access token',
      });

      await expect(
        service.getUserInfo('invalid-token')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('confirmSignUp', () => {
    it('should successfully confirm user signup', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({});

      await expect(
        service.confirmSignUp('test@example.com', '123456')
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException for invalid code', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'CodeMismatchException',
        message: 'Invalid verification code',
      });

      await expect(
        service.confirmSignUp('test@example.com', 'wrong-code')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired code', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'ExpiredCodeException',
        message: 'Verification code has expired',
      });

      await expect(
        service.confirmSignUp('test@example.com', 'expired-code')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    it('should initiate password reset', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({});

      // Should not throw even for non-existent user (security)
      await expect(
        service.forgotPassword('test@example.com')
      ).resolves.not.toThrow();
    });

    it('should not throw for non-existent user (security)', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'UserNotFoundException',
        message: 'User does not exist',
      });

      // Should not throw - prevents user enumeration
      await expect(
        service.forgotPassword('nonexistent@example.com')
      ).resolves.not.toThrow();
    });
  });

  describe('confirmForgotPassword', () => {
    it('should successfully reset password', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({});

      await expect(
        service.confirmForgotPassword({
          email: 'test@example.com',
          code: '123456',
          newPassword: 'NewSecurePass123!',
        })
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException for invalid code', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'CodeMismatchException',
        message: 'Invalid verification code',
      });

      await expect(
        service.confirmForgotPassword({
          email: 'test@example.com',
          code: 'wrong-code',
          newPassword: 'NewSecurePass123!',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminCreateUser', () => {
    it('should create user with admin privileges', async () => {
      mockCognitoClient.send
        .mockResolvedValueOnce({ User: { Username: 'user-123' } }) // AdminCreateUser
        .mockResolvedValueOnce({}); // AdminSetUserPassword

      const result = await service.adminCreateUser(
        'admin@example.com',
        'SecurePass123!',
        'tenant-123',
        'test-tenant',
        'admin'
      );

      expect(result).toBe('user-123');
      expect(mockCognitoClient.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('adminGetUser', () => {
    it('should return user info', async () => {
      mockCognitoClient.send.mockResolvedValueOnce({
        Username: 'user-123',
        UserAttributes: mockUserAttributes,
      });

      const result = await service.adminGetUser('test@example.com');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-123');
      expect(result?.tenantId).toBe('tenant-123');
    });

    it('should return null for non-existent user', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'UserNotFoundException',
        message: 'User does not exist',
      });

      const result = await service.adminGetUser('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('rate limiting', () => {
    it('should throw BadRequestException for too many requests', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'TooManyRequestsException',
        message: 'Rate exceeded',
      });

      await expect(
        service.signIn({
          email: 'test@example.com',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for limit exceeded', async () => {
      mockCognitoClient.send.mockRejectedValueOnce({
        name: 'LimitExceededException',
        message: 'Limit exceeded',
      });

      await expect(
        service.signIn({
          email: 'test@example.com',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
