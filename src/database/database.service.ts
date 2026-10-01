import { Injectable } from '@nestjs/common'
import {
  ConversationModel,
  DocumentChunkModel,
  DocumentModel,
  MessageModel,
  RevokedTokenModel,
  SignupOtpModel,
  UserModel,
} from './models'

export type {
  ConversationEntity,
  DocumentChunkEntity,
  DocumentEntity,
  DocumentStatus,
  MessageEntity,
  RevokedTokenEntity,
  SourceRef,
  UserEntity,
} from './models'

/**
 * Think of this as the "data access layer". Every feature service injects this
 * class and talks to `.users / .documents / .chunks / .conversations /
 * .messages` (Mongoose models) instead of touching MongoDB directly.
 */
@Injectable()
export class DatabaseService {
  readonly users = UserModel
  readonly documents = DocumentModel
  readonly chunks = DocumentChunkModel
  readonly conversations = ConversationModel
  readonly messages = MessageModel
  readonly revokedTokens = RevokedTokenModel
  readonly signupOtps = SignupOtpModel
}
