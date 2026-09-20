import mongoose, { Model, Schema } from 'mongoose'

// ---------------------------------------------------------------------------
// Entity types (the plain "shape" of every record persisted in MongoDB)
// ---------------------------------------------------------------------------

export type DocumentStatus = 'processing' | 'completed' | 'failed'

export interface SourceRef {
  name: string
  page: number
  relevance?: string
}

export interface ChatMessageEntity {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: SourceRef[]
}

export interface ConversationEntity {
  title: string
  preview: string
  date: Date
  messages: ChatMessageEntity[]
}

export interface DocumentEntity {
  fileName: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: Date
  pageCount: number
}

export interface UserEntity {
  email: string
  password: string
  name: string
}

// ---------------------------------------------------------------------------
// Schemas — the MongoDB-level rules for each collection
// ---------------------------------------------------------------------------

const sourceRefSchema = new Schema(
  {
    name: { type: String, required: true },
    page: { type: Number, required: true },
    relevance: { type: String },
  },
  { _id: false }, // a source ref is a value object inside a message
)

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    sources: { type: [sourceRefSchema], default: undefined },
  },
  { _id: true },
)

const conversationSchema = new Schema(
  {
    title: { type: String, required: true },
    preview: { type: String, default: '' },
    date: { type: Date, default: Date.now },
    messages: { type: [messageSchema], default: [] },
  },
  { collection: 'conversations' },
)

const documentSchema = new Schema(
  {
    fileName: { type: String, required: true },
    fileSizeBytes: { type: Number, required: true },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
    },
    uploadedAt: { type: Date, default: Date.now },
    pageCount: { type: Number, default: 0 },
  },
  { collection: 'documents' },
)

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
  },
  { collection: 'users' },
)

// ---------------------------------------------------------------------------
// Models — the typed handles the application uses to query each collection
// ---------------------------------------------------------------------------

export const UserModel: Model<UserEntity> = mongoose.model<UserEntity>('User', userSchema)
export const DocumentModel: Model<DocumentEntity> = mongoose.model<DocumentEntity>('Document', documentSchema)
export const ConversationModel: Model<ConversationEntity> = mongoose.model<ConversationEntity>(
  'Conversation',
  conversationSchema,
)