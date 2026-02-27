import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Process-level crash protection — prevent unhandled rejections from killing the server
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ Unhandled Promise Rejection (caught at process level):', reason?.message || reason);
  // Don't exit — log and continue. Background tasks (vision extraction, enrichment)
  // should never crash the main server process.
});

process.on('uncaughtException', (error: Error) => {
  console.error('🚨 Uncaught Exception:', error.message, error.stack);
  // For truly fatal errors, log but don't exit immediately — let NestJS handle graceful shutdown
  // Only OOM and similar V8 errors will bypass this handler entirely
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Configure CORS based on environment
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = isProduction
    ? ['https://app.fundlens.ai', 'https://fundlens.ai']
    : ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:3000'];
  
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400, // 24 hours
  });
  
  // Global prefix for all routes (excludes static assets and docs)
  app.setGlobalPrefix('api', {
    exclude: ['/', '/docs'],
  });
  
  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('FundLens Backend API')
    .setDescription('A comprehensive financial data backend providing SEC filing data and financial news aggregation')
    .setVersion('1.0')
    .addTag('SEC', 'SEC filing data and financial information')
    .addTag('News', 'Financial news and market updates')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log(`🚀 FundLens Backend is running on: http://localhost:${port}`);
  console.log(`🌐 Frontend available at: http://localhost:${port}`);
  console.log(`📚 API Documentation available at: http://localhost:${port}/docs`);
  console.log(`📊 SEC API available at: http://localhost:${port}/api/sec`);
  console.log(`📰 News API available at: http://localhost:${port}/api/news`);
}

bootstrap();
