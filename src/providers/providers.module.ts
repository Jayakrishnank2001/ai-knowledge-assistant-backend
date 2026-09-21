import { Module, Global } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MockEmbeddingProvider, EmbeddingProviderFactory } from './embedding.provider'
import { MockLlmProvider, LlmProviderFactory } from './llm.provider'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    MockEmbeddingProvider,
    EmbeddingProviderFactory,
    MockLlmProvider,
    LlmProviderFactory,
  ],
  exports: [EmbeddingProviderFactory, LlmProviderFactory],
})
export class ProvidersModule {}