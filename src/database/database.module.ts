import { Global, Module } from '@nestjs/common'
import { DatabaseService } from './database.service'

/**
 * @Global() means every other module can inject DatabaseService
 * without having to import DatabaseModule themselves.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}