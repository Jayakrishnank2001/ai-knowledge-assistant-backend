import { Injectable, Logger } from '@nestjs/common'
import { PDFParse } from 'pdf-parse'
import { PageText } from './embedding.util'

/** Drops NUL bytes and normalises line endings; chunking flattens whitespace later. */
function normalizeText(text: string | undefined): string {
  return (text ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim()
}

/**
 * Extracts the text of a PDF, page by page.
 *
 * Kept behind this one service so the parser can be swapped without touching
 * the upload pipeline. `pageNumber` is 1-based and flows all the way into the
 * citations the chat returns, which is why we ask for per-page results rather
 * than the concatenated document text.
 */
@Injectable()
export class PdfTextService {
  private readonly logger = new Logger(PdfTextService.name)

  async extract(buffer: Buffer): Promise<PageText[]> {
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()

      const pages = (result.pages ?? [])
        .map((page) => ({ pageNumber: page.num, text: normalizeText(page.text) }))
        .filter((page) => page.text.length > 0)

      if (pages.length === 0) {
        // A few PDFs only expose content through the concatenated `text` field.
        const whole = normalizeText(result.text)
        if (whole) {
          this.logger.warn('No per-page text found - falling back to whole-document text')
          return [{ pageNumber: 1, text: whole }]
        }
      }

      this.logger.log(
        `Extracted ${pages.length} page(s) with text (document has ${result.total ?? pages.length} page(s))`,
      )
      return pages
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  }
}
