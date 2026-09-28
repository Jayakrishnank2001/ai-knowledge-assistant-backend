import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { OverviewService } from './overview.service'

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name: string }
}

@UseGuards(AuthGuard)
@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  /** Dashboard counters for the logged-in user only. */
  @Get('stats')
  stats(@Req() request: AuthenticatedRequest) {
    return this.overviewService.stats(request.user.id)
  }

  /** The logged-in user's most recent documents (plus the shared knowledge base). */
  @Get('recent-documents')
  recentDocuments(@Req() request: AuthenticatedRequest) {
    return this.overviewService.recentDocuments(request.user.id)
  }
}