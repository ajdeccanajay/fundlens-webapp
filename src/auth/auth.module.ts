/**
 * Authentication Module
 * 
 * Provides AWS Cognito authentication services for the FundLens application.
 * Exports CognitoAuthService for use in other modules.
 */

import { Module } from '@nestjs/common';
import { CognitoAuthService } from './cognito-auth.service';
import { AuthController } from './auth.controller';

@Module({
  controllers: [AuthController],
  providers: [CognitoAuthService],
  exports: [CognitoAuthService],
})
export class AuthModule {}
