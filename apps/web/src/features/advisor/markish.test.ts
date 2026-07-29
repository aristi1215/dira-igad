import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { renderMarkish } from './markish'

/*
 * Vitest runs in the `node` environment here, so these walk the returned React
 * element tree rather than mounting it. That is enough: what matters is which
 * elements are produced and that every leaf is a string, never markup.
 */
function tags(node: ReactNode, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) tags(child, found)
    return found
  }
  if (isValidElement(node)) {
    if (typeof node.type === 'string') found.push(node.type)
    tags((node.props as { children?: ReactNode }).children, found)
  }
  return found
}

function text(node: ReactNode, parts: string[] = []): string {
  if (typeof node === 'string') {
    parts.push(node)
  } else if (Array.isArray(node)) {
    for (const child of node) text(child, parts)
  } else if (isValidElement(node)) {
    text((node.props as { children?: ReactNode }).children, parts)
  }
  return parts.join('')
}

describe('renderMarkish', () => {
  it('renders paragraphs separated by blank lines', () => {
    const output = renderMarkish('First line.\n\nSecond line.')
    expect(tags(output).filter((tag) => tag === 'p')).toHaveLength(2)
  })

  it('joins wrapped lines into one paragraph', () => {
    const output = renderMarkish('a line\nand its continuation')
    expect(tags(output).filter((tag) => tag === 'p')).toHaveLength(1)
    expect(text(output)).toBe('a line and its continuation')
  })

  it('renders bullets as a list, whichever marker the model chose', () => {
    for (const source of ['- one\n- two', '* one\n* two', '1. one\n2. two']) {
      const found = tags(renderMarkish(source))
      expect(found, source).toContain('ul')
      expect(found.filter((tag) => tag === 'li'), source).toHaveLength(2)
    }
  })

  it('strips the bullet marker from the text', () => {
    expect(text(renderMarkish('- brief the peace committees'))).toBe(
      'brief the peace committees',
    )
  })

  it('renders **bold** as emphasis, not as literal asterisks', () => {
    const output = renderMarkish('Do **not** delay.')
    expect(tags(output)).toContain('strong')
    expect(text(output)).toBe('Do not delay.')
  })

  /*
   * The advisor's output is model-generated and goes straight into the DOM.
   * Every branch of the renderer must produce elements and text nodes only —
   * there is no `dangerouslySetInnerHTML` anywhere in it, and this is the
   * assertion that keeps it that way.
   */
  it('never turns model output into markup', () => {
    const source = '<img src=x onerror="alert(1)"> and <b>bold</b>'
    const output = renderMarkish(source)
    expect(tags(output)).not.toContain('img')
    expect(tags(output)).not.toContain('b')
    expect(text(output)).toContain('<img src=x')
  })

  it('leaves unsupported syntax as literal text rather than dropping it', () => {
    expect(text(renderMarkish('# A heading'))).toBe('# A heading')
  })

  it('returns nothing for empty input', () => {
    expect(renderMarkish('')).toHaveLength(0)
  })
})
