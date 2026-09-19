import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class AskQuestionDto {
  @IsString()
  @IsNotEmpty()
  question!: string

  /** When omitted, a brand-new conversation is created. */
  @IsOptional()
  @IsString()
  conversationId?: string
}