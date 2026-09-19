import { Test, TestingModule } from '@nestjs/testing'
import { AppController } from './app.controller'
import { AppService } from './app.service'

describe('AppController', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile()

    appController = app.get<AppController>(AppController)
  })

  describe('root', () => {
    it('should return the service name', () => {
      expect(appController.getRoot().service).toBe('ai-knowledge-assistant-backend')
    })

    it('should return health status ok', () => {
      expect(appController.getHealth().status).toBe('ok')
    })
  })
})