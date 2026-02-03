# FundLens Backend

A comprehensive financial data backend that provides SEC filing data and financial news aggregation.

## 📁 Project Structure

```
src/
├── dataSources/          # External data source integrations
│   ├── sec/             # SEC filing data services
│   └── news/            # Financial news services
├── modules/              # Core business logic modules
│   ├── parsing/         # Document parsing
│   ├── embedding/       # Vector embeddings
│   └── llm/             # Large language model integration
├── prisma/              # Database schema and migrations
│   ├── schema.prisma    # Database schema definition
│   └── seed.ts          # Database seeding script
├── app.module.ts         # Main application module
└── main.ts              # Application entry point
```

## 🛠️ Installation

```bash
npm install
```

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
# Database Configuration
DATABASE_URL="postgresql://fundlens_user:fundlens_password@localhost:5432/fundlens_db?schema=public"
```

### Database Setup

#### Option 1: Automated Setup (Recommended)
```bash
npm run db:setup
```


#### Database Initialization
```bash
# Push the schema to the database
npm run db:push

# Generate Prisma client
npm run db:generate

# Seed the database with sample data
npm run db:seed

# Optional: Open Prisma Studio to view/edit data
npm run db:studio
```

## 🚀 Running the Application

```bash
# Development
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## 📚 API Documentation

### Swagger UI
Once the application is running, you can access the interactive API documentation at:
- **Swagger UI**: `http://localhost:3000/docs`

The Swagger documentation provides:
- Interactive API testing interface
- Detailed parameter descriptions and examples
- Response schemas and examples
- Request/response validation

### API Endpoints Overview

#### SEC Data Endpoints
All SEC endpoints are prefixed with `/api/sec`:

- **`GET /api/sec/lookup?ticker=AAPL`** - Convert ticker to CIK
- **`GET /api/sec/submissions?ticker=AAPL`** - Get company filings
- **`GET /api/sec/facts?ticker=AAPL`** - Get company financial facts
- **`GET /api/sec/concept?ticker=AAPL&tag=Revenues`** - Get specific financial metric
- **`GET /api/sec/frames?tag=Revenues&frame=CY2024Q4I`** - Get industry-wide data
- **`GET /api/sec/aggregate?ticker=AAPL&tag=Revenues`** - Get comprehensive data
- **`GET /api/sec/fillings?ticker=AAPL&formType=10-K&startDate=2020-01-01`** - Get SEC filings with filtering

#### News Endpoints
All news endpoints are prefixed with `/api/news`:

- **`GET /api/news/symbol/AAPL?limit=30`** - Get company-specific news
- **`GET /api/news/top?query=markets&limit=30`** - Get market news by query

## 🔒 Rate Limiting

The SEC API integration includes built-in rate limiting (150ms delay between requests) to comply with SEC's fair access guidelines.

## 📝 License

UNLICENSED - Private project
# fundlens-webapp
