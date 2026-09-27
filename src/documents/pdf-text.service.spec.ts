import { PdfTextService } from './pdf-text.service'

/**
 * Builds a tiny but valid single/multi-page PDF with uncompressed content
 * streams, so the extractor can be tested without committing a binary fixture.
 *
 * Text is wrapped into positioned lines (`Tm` per line) exactly like a real
 * generator does - a single `Tj` run wider than the page gets clipped by pdf.js.
 */
function buildPdf(pageTexts: string[]): Buffer {
  const escape = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

  const wrap = (text: string, max = 70): string[] => {
    const lines: string[] = []
    let line = ''
    for (const word of text.split(/\s+/)) {
      if (line && line.length + word.length + 1 > max) {
        lines.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    if (line) lines.push(line)
    return lines
  }

  const contentFor = (text: string): string =>
    wrap(text)
      .map((line, index) => `1 0 0 1 72 ${720 - index * 14} Tm (${escape(line)}) Tj`)
      .join('\n')

  const kids = pageTexts.map((_, index) => `${4 + index * 2} 0 R`)

  const bodies: string[] = []
  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageTexts.length} >>`
  bodies[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  pageTexts.forEach((text, index) => {
    const pageObject = 4 + index * 2
    const contentObject = pageObject + 1
    const stream = `BT /F1 12 Tf\n${contentFor(text)}\nET`

    bodies[pageObject] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`
    bodies[contentObject] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  })

  let file = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let index = 1; index < bodies.length; index++) {
    offsets[index] = Buffer.byteLength(file, 'latin1')
    file += `${index} 0 obj\n${bodies[index]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(file, 'latin1')
  const size = bodies.length
  file += `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let index = 1; index < bodies.length; index++) {
    file += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  file += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(file, 'latin1')
}

describe('PdfTextService', () => {
  const service = new PdfTextService()
  const answer =
    'Eligible employees may take 16 weeks of paid parental leave following the birth or adoption of a child.'

  /**
   * pdf.js inserts line breaks wherever the *layout* wrapped, so assertions are
   * compared with whitespace flattened - which is also exactly what the chunker
   * does before embedding.
   */
  const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

  it('extracts text page by page, numbered from 1', async () => {
    const pages = await service.extract(buildPdf(['First page content.', 'Second page content.']))

    expect(pages).toHaveLength(2)
    expect(pages[0].pageNumber).toBe(1)
    expect(flat(pages[0].text)).toContain('First page content.')
    expect(pages[1].pageNumber).toBe(2)
    expect(flat(pages[1].text)).toContain('Second page content.')
  })

  it('extracts a real policy sentence intact', async () => {
    const pages = await service.extract(buildPdf([`Leave policy. ${answer}`]))

    expect(pages).toHaveLength(1)
    expect(flat(pages[0].text)).toContain(answer)
  })

  it('handles parentheses and backslashes in the text', async () => {
    const pages = await service.extract(buildPdf(['Escaped (parens) and backslash \\ here']))

    expect(flat(pages[0].text)).toContain('Escaped (parens) and backslash \\ here')
  })
})
