import { Global, Module } from '@nestjs/common'
import { DatabaseService } from './database.service'
import { VectorIndexService } from './vector-index.service'

/**
 * @Global() means every other module can inject DatabaseService and
 * VectorIndexService without having to import DatabaseModule themselves.
 */
@Global()
@Module({
  providers: [DatabaseService, VectorIndexService],
  exports: [DatabaseService, VectorIndexService],
})
export class DatabaseModule {}