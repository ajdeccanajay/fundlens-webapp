/**
 * Authentication Controller
 * 
 * REST API endpoints for user authentication with AWS Cognito.
 * 
 * IMPORTANT: This is enterprise software - there is NO public signup.
 * All user accounts are created by platform administrators through
 * the internal admin API (/api/v1/internal/ops/clients).
 * 
 * This controller only handles:
 * - Sign in (for existing users created by admins)
 * - Token refresh
 * - Password reset
 * - Sign out
 * - Get current user info
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CognitoAuthService, SignInDto, AuthTokens, UserInfo } from './cognito-auth.service';

// DTOs for request validation
class SignInRequestDto {
  email: string;
  password: string;
}

class RefreshTokenRequestDto {
  refreshToken: string;
  email: string;
}

class ForgotPasswordRequestDto {
  email: string;
}

class ConfirmPasswordResetRequestDto {
  email: string;
  code: string;
  newPassword: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: CognitoAuthService) {}

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', example: 'user@company.com' },
        password: { type: 'string', example: 'SecurePass123!' },
      },
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Sign in successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        tokens: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            idToken: { type: 'string' },
            expiresIn: { type: 'number' },
            tokenType: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async signIn(@Body() dto: SignInRequestDto): Promise<{
    success: boolean;
    tokens: AuthTokens;
  }> {
    this.logger.log(`Sign in request for: ${dto.email}`);

    const tokens = await this.authService.signIn({
      email: dto.email,
      password: dto.password,
    });

    return {
      success: true,
      tokens,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken', 'email'],
      properties: {
        refreshToken: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenRequestDto): Promise<{
    success: boolean;
    tokens: AuthTokens;
  }> {
    this.logger.log('Token refresh request');

    const tokens = await this.authService.refreshToken(dto.refreshToken, dto.email);

    return {
      success: true,
      tokens,
    };
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out (invalidate all tokens)' })
  @ApiResponse({ status: 200, description: 'Signed out successfully' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async signOut(@Headers('authorization') authHeader: string): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log('Sign out request');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new BadRequestException('Authorization header required');
    }

    const accessToken = authHeader.substring(7);
    await this.authService.signOut(accessToken);

    return {
      success: true,
      message: 'Signed out successfully',
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate password reset' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Password reset initiated' })
  async forgotPassword(@Body() dto: ForgotPasswordRequestDto): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Forgot password request for: ${dto.email}`);

    await this.authService.forgotPassword(dto.email);

    // Always return success to prevent user enumeration
    return {
      success: true,
      message: 'If an account exists with this email, a password reset code has been sent.',
    };
  }

  @Post('confirm-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete password reset with verification code' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'code', 'newPassword'],
      properties: {
        email: { type: 'string', format: 'email' },
        code: { type: 'string', example: '123456' },
        newPassword: { 
          type: 'string', 
          minLength: 12,
          description: 'Min 12 chars, uppercase, lowercase, number, special char'
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid code or password' })
  async confirmPassword(@Body() dto: ConfirmPasswordResetRequestDto): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Confirm password reset for: ${dto.email}`);

    // Validate new password strength
    if (!this.isValidPassword(dto.newPassword)) {
      throw new BadRequestException(
        'Password must be at least 12 characters with uppercase, lowercase, number, and special character'
      );
    }

    await this.authService.confirmForgotPassword({
      email: dto.email,
      code: dto.code,
      newPassword: dto.newPassword,
    });

    return {
      success: true,
      message: 'Password reset successfully. You can now sign in with your new password.',
    };
  }

  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  @ApiResponse({ status: 200, description: 'User info retrieved' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async getMe(@Headers('authorization') authHeader: string): Promise<{
    success: boolean;
    user: UserInfo;
  }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new BadRequestException('Authorization header required');
    }

    const token = authHeader.substring(7);
    
    // Try to decode the token to get user info
    // This works for both ID tokens (which contain custom claims) and access tokens
    try {
      // First try to get user info from Cognito (works with access token)
      const user = await this.authService.getUserInfo(token);
      return {
        success: true,
        user,
      };
    } catch (error) {
      // If that fails, try to decode the ID token directly
      this.logger.log('Falling back to ID token decode');
      const payload = this.decodeJwt(token);
      if (!payload) {
        throw new BadRequestException('Invalid token');
      }
      
      return {
        success: true,
        user: {
          userId: payload.sub || '',
          email: payload.email || payload['cognito:username'] || '',
          emailVerified: payload.email_verified === true || payload.email_verified === 'true',
          tenantId: payload['custom:tenant_id'] || '',
          tenantSlug: payload['custom:tenant_slug'] || '',
          tenantRole: payload['custom:tenant_role'] || 'viewer',
        },
      };
    }
  }

  // Helper methods

  private decodeJwt(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
      return payload;
    } catch {
      return null;
    }
  }

  private isValidPassword(password: string): boolean {
    // At least 12 characters
    if (password.length < 12) return false;
    // At least one uppercase
    if (!/[A-Z]/.test(password)) return false;
    // At least one lowercase
    if (!/[a-z]/.test(password)) return false;
    // At least one number
    if (!/[0-9]/.test(password)) return false;
    // At least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;
    return true;
  }
}
