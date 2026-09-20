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

// A chat message now lives in its own collection, referenced by conversationId.
export interface MessageEntity {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: SourceRef[]
}

export interface ConversationEntity {
  title: string
  preview: string
  date: Date
}

// `documents` = metadata about an uploaded PDF, NOT the binary.
// The binary lives in GridFS (`fs.files` / `fs.chunks`), pointed to by gridFsFileId.
export interface DocumentEntity {
  userId: string | null
  fileName: string
  mimeType: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: Date
  pageCount: number
  gridFsFileId?: string | null
}

// `document_chunks` = extracted text + embedding; this is what RAG retrieval searches.
export interface DocumentChunkEntity {
  documentId: string
  content: string
  pageNumber: number
  chunkIndex: number
  embedding: number[]
}

export interface UserEntity {
  email: string
  password: string
  name: string
  workspaceName?: string
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
  { _id: false },
)

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    sources: { type: [sourceRefSchema], default: undefined },
  },
  { collection: 'messages' },
)
// "give me all messages of a conversation, in order"
messageSchema.index({ conversationId: 1, timestamp: 1 })

const conversationSchema = new Schema(
  {
    title: { type: String, required: true },
    preview: { type: String, default: '' },
    date: { type: Date, default: Date.now },
  },
  { collection: 'conversations' },
)

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: 'application/pdf' },
    fileSizeBytes: { type: Number, required: true },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
    },
    uploadedAt: { type: Date, default: Date.now },
    pageCount: { type: Number, default: 0 },
    gridFsFileId: { type: Schema.Types.ObjectId, default: null }, // fs.files._id
  },
  { collection: 'documents' },
)

const documentChunkSchema = new Schema(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    content: { type: String, required: true },
    pageNumber: { type: Number, required: true },
    chunkIndex: { type: Number, required: true },
    embedding: { type: [Number], default: undefined },
  },
  { collection: 'document_chunks' },
)
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 })

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    workspaceName: { type: String, default: 'Acme knowledge base' },
  },
  { collection: 'users' },
)

// ---------------------------------------------------------------------------
// Models — the typed handles used to query each collection
// ---------------------------------------------------------------------------

export const UserModel: Model<UserEntity> = mongoose.model<UserEntity>('User', userSchema)
export const DocumentModel: Model<DocumentEntity> = mongoose.model<DocumentEntity>('Document', documentSchema)
export const DocumentChunkModel: Model<DocumentChunkEntity> = mongoose.model<DocumentChunkEntity>(
  'DocumentChunk',
  documentChunkSchema,
)
export const ConversationModel: Model<ConversationEntity> = mongoose.model<ConversationEntity>(
  'Conversation',
  conversationSchema,
)
export const MessageModel: Model<MessageEntity> = mongoose.model<MessageEntity>('Message', messageSchema)