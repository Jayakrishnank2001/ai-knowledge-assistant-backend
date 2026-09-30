import { Controller, Get, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser, AuthUserPayload } from '../common/authenticated-request'
import { OverviewService } from './overview.service'

@UseGuards(AuthGuard)
@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  /** Dashboard counters for the logged-in user only. */
  @Get('stats')
  stats(@CurrentUser() user: AuthUserPayload) {
    return this.overviewService.stats(user.id)
  }

  /** The logged-in user's most recent documents (plus the shared knowledge base). */
  @Get('recent-documents')
  recentDocuments(@CurrentUser() user: AuthUserPayload) {
    return this.overviewService.recentDocuments(user.id)
  }
}