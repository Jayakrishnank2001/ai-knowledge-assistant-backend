import { Controller, Get } from '@nestjs/common'
import { OverviewService } from './overview.service'

@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get('stats')
  stats() {
    return this.overviewService.stats()
  }

  @Get('recent-documents')
  recentDocuments() {
    return this.overviewService.recentDocuments()
  }
}