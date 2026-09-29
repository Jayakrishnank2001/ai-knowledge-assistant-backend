import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DEFAULT_CHAT_MODEL, SettingsService } from './settings.service'

describe('SettingsService', () => {
  let tmpDir: string
  let envFile: string
  let service: SettingsService
  const originalChatModel = process.env.GEMINI_CHAT_MODEL

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-spec-'))
    envFile = path.join(tmpDir, '.env')
    service = new SettingsService(new ConfigService({}))
    service.envFilePath = envFile
    delete process.env.GEMINI_CHAT_MODEL
  })

  afterEach(async () => {
    if (originalChatModel === undefined) delete process.env.GEMINI_CHAT_MODEL
    else process.env.GEMINI_CHAT_MODEL = originalChatModel
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('getChatModel', () => {
    it('returns the default when nothing is configured', () => {
      expect(service.getChatModel()).toBe(DEFAULT_CHAT_MODEL)
    })

    it('reads the live process.env value', () => {
      process.env.GEMINI_CHAT_MODEL = 'gemini-3.6-flash'
      expect(service.getChatModel()).toBe('gemini-3.6-flash')
    })
  })

  describe('setChatModel', () => {
    it('replaces the GEMINI_CHAT_MODEL line in place, preserving other keys', async () => {
      const original = [
        'PORT=3001',
        'MONGODB_URI=mongodb://example',
        'GEMINI_CHAT_MODEL=gemini-3.6-flash',
        'RAG_TOP_K=6',
        '',
      ].join('\n')
      await fs.writeFile(envFile, original, 'utf8')

      await service.setChatModel('gemini-3.8-flash')

      const written = await fs.readFile(envFile, 'utf8')
      expect(written).toContain('GEMINI_CHAT_MODEL=gemini-3.8-flash')
      expect(written).not.toContain('gemini-3.6-flash')
      expect(written).toContain('PORT=3001')
      expect(written).toContain('MONGODB_URI=mongodb://example')
      expect(written).toContain('RAG_TOP_K=6')
      // only one GEMINI_CHAT_MODEL line, and no stray duplicate
      expect(written.match(/^GEMINI_CHAT_MODEL=/gm)).toHaveLength(1)
    })

    it('appends the key when it is missing from .env', async () => {
      await fs.writeFile(envFile, 'PORT=3001', 'utf8')

      await service.setChatModel('gemini-3.5-flash-lite')

      const written = await fs.readFile(envFile, 'utf8')
      expect(written).toBe('PORT=3001\nGEMINI_CHAT_MODEL=gemini-3.5-flash-lite\n')
    })

    it('creates .env when the file does not exist', async () => {
      await service.setChatModel('gemini-3.6-flash')
      const written = await fs.readFile(envFile, 'utf8')
      expect(written).toBe('GEMINI_CHAT_MODEL=gemini-3.6-flash\n')
    })

    it('applies the change to process.env so it takes effect without restart', async () => {
      await service.setChatModel('gemini-3.8-flash')
      expect(process.env.GEMINI_CHAT_MODEL).toBe('gemini-3.8-flash')
      expect(service.getChatModel()).toBe('gemini-3.8-flash')
    })

    it('rejects models outside the allowlist without touching .env', async () => {
      await fs.writeFile(envFile, 'GEMINI_CHAT_MODEL=gemini-3.6-flash', 'utf8')

      await expect(service.setChatModel('evil-model; rm -rf /')).rejects.toThrow(BadRequestException)

      const written = await fs.readFile(envFile, 'utf8')
      expect(written).toBe('GEMINI_CHAT_MODEL=gemini-3.6-flash')
      expect(process.env.GEMINI_CHAT_MODEL).toBeUndefined()
    })
  })
})