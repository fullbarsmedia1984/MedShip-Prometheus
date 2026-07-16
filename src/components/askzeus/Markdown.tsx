// Minimal markdown renderer for AskZeus chat replies. Builds React elements
// directly (no HTML strings, no dangerouslySetInnerHTML) so model output can
// never inject markup. Supports the subset the system prompt asks the model
// to use: headings, lists, tables, fenced code, bold/italic/inline code/links.

import React from 'react'

// ---------------------------------------------------------------------------
// Inline pass: **bold**, *italic*, `code`, [text](https://url)
// ---------------------------------------------------------------------------

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('[')) {
      const closeBracket = token.indexOf('](')
      const label = token.slice(1, closeBracket)
      const href = token.slice(closeBracket + 2, -1)
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-medship-primary underline underline-offset-2 hover:opacity-80"
        >
          {label}
        </a>
      )
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

// ---------------------------------------------------------------------------
// Block pass
// ---------------------------------------------------------------------------

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed"
        >
          {code.join('\n')}
        </pre>
      )
      continue
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = renderInline(headingMatch[2], `h${key}`)
      const className =
        level === 1
          ? 'text-base font-bold'
          : level === 2
            ? 'text-[15px] font-semibold'
            : 'text-sm font-semibold'
      blocks.push(
        level <= 2 ? (
          <h3 key={key++} className={`${className} mt-1`}>
            {content}
          </h3>
        ) : (
          <h4 key={key++} className={`${className} mt-1`}>
            {content}
          </h4>
        )
      )
      i++
      continue
    }

    // Table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                {header.map((cell, index) => (
                  <th key={index} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {renderInline(cell, `th${key}-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-border/60 last:border-b-0"
                >
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-1.5 align-top">
                      {renderInline(cell, `td${key}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="ml-4 list-disc space-y-1">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ul${key}-${index}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="ml-4 list-decimal space-y-1">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ol${key}-${index}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Paragraph: consume consecutive plain lines
    const paragraph: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```') &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paragraph.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="leading-relaxed">
        {renderInline(paragraph.join(' '), `p${key}`)}
      </p>
    )
  }

  return <div className="space-y-2.5 text-sm">{blocks}</div>
}
