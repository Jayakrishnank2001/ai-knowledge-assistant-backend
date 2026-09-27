import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { UpdateAiPreferencesDto } from './dto/update-ai-preferences.dto'
import { SettingsService } from './settings.service'

/** AI preferences (currently: the Gemini chat model persisted to .env). */
@UseGuards(AuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('ai')
  getAiPreferences() {
    return {
      chatModel: this.settings.getChatModel(),
      availableModels: this.settings.availableModels,
    }
  }

  @Put('ai')
  updateAiPreferences(@Body() dto: UpdateAiPreferencesDto) {
    return this.settings.setChatModel(dto.chatModel).then((chatModel) => ({
      chatModel,
      availableModels: this.settings.availableModels,
    }))
  }
}