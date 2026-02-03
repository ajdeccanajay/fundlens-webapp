import { ApiProperty } from '@nestjs/swagger';

export class HeadlineDto {
  @ApiProperty({ 
    example: 'Apple Reports Record Q4 Earnings Driven by iPhone Sales', 
    description: 'News headline title' 
  })
  title: string;

  @ApiProperty({ 
    example: 'https://example.com/apple-q4-earnings-2024', 
    description: 'URL to the full news article' 
  })
  link: string;

  @ApiProperty({ 
    example: '2024-01-15T10:30:00.000Z', 
    description: 'Publication date in ISO 8601 format' 
  })
  pubDate: string;

  @ApiProperty({ 
    example: 'Reuters', 
    description: 'News source/publisher',
    required: false 
  })
  source?: string;

  @ApiProperty({ 
    example: 'earnings', 
    description: 'Type of news article',
    required: false 
  })
  type?: string;
}

export class NewsResponseDto {
  @ApiProperty({ 
    description: 'Array of news headlines',
    type: [HeadlineDto]
  })
  headlines: HeadlineDto[];

  @ApiProperty({ 
    example: 30, 
    description: 'Total number of headlines returned' 
  })
  count: number;

  @ApiProperty({ 
    example: 'AAPL', 
    description: 'Company ticker symbol (for company-specific news)',
    required: false 
  })
  symbol?: string;

  @ApiProperty({ 
    example: 'markets', 
    description: 'Search query used (for market news)',
    required: false 
  })
  query?: string;
} 