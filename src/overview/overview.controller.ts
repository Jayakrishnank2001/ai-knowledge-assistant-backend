import { Controller, Get, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { OverviewService } from './overview.service'

@UseGuards(AuthGuard)
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