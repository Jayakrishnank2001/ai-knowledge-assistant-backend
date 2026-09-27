import { IsIn } from 'class-validator'
import { AVAILABLE_CHAT_MODELS } from '../settings.service'

/** Body for PUT /settings/ai - only allowlisted model ids are accepted. */
export class UpdateAiPreferencesDto {
  @IsIn([...AVAILABLE_CHAT_MODELS], {
    message: (args) =>
      `chatModel must be one of: ${(AVAILABLE_CHAT_MODELS as readonly string[]).join(', ')}`,
  })
  chatModel!: string
}