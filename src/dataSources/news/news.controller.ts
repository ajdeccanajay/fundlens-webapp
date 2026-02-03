import { Controller, Get, Query, Param, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiParam } from '@nestjs/swagger';
import { NewsService } from './news.service';
import { HeadlineDto, NewsResponseDto } from './dto/news.dto';

@ApiTags('News')
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  // 1) Top headlines for a TICKER (company-specific via insights)
  // GET /news/symbol/AAPL?limit=30
  @ApiOperation({ summary: 'Get company-specific news', description: 'Retrieves latest news headlines for a specific company ticker symbol' })
  @ApiParam({ name: 'symbol', description: 'Stock ticker symbol', example: 'AAPL' })
  @ApiQuery({ name: 'limit', description: 'Maximum number of news articles to return', required: false, default: 30, example: 30 })
  @ApiResponse({ status: 200, description: 'Successfully retrieved company news', type: [HeadlineDto] })
  @Get('symbol/:symbol')
  async bySymbol(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    return this.news.headlinesBySymbol(symbol, limit);
  }

  // 2) Top headlines by QUERY (general market via search)
  // GET /news/top?query=markets&limit=30
  @ApiOperation({ summary: 'Get market news by query', description: 'Retrieves general market news headlines based on search query' })
  @ApiQuery({ name: 'query', description: 'Search query for news topics', required: false, default: 'markets', example: 'markets' })
  @ApiQuery({ name: 'limit', description: 'Maximum number of news articles to return', required: false, default: 30, example: 30 })
  @ApiQuery({ name: 'lang', description: 'Language for news articles', required: false, default: 'en-US', example: 'en-US' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved market news', type: [HeadlineDto] })
  @Get('top')
  async byQuery(
    @Query('query') query = 'markets',
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('lang') lang = 'en-US',
    @Query('region') region = 'US',
  ) {
    return this.news.headlinesByQuery(query, limit, lang, region);
  }
}
