/**
 * Typography primitive unit tests.
 *
 * Locks in the contract for the shared text system that every page renders
 * through (see `@/lib/tokens` typography.role/size/weight/color):
 *   1. <Heading> maps each semantic `level` to the correct HTML tag + role
 *      classes, and honours an `as` tag override.
 *   2. <Text> renders a pre-composed `variant`, OR granular size/weight/color,
 *      and — crucially — still applies `mono` on top of a `variant` (a bug that
 *      previously dropped monospace on `<Text variant="body" mono>`).
 *   3. Every convenience wrapper (PageTitle … Code) renders the right element
 *      and role, and ErrorText exposes role="alert" for screen readers.
 *   4. className is merged (not clobbered) and arbitrary HTML attributes pass
 *      through to the DOM node.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { type ComponentType, type ReactNode } from 'react'
import { typography } from '@/lib/tokens'
import {
  Heading,
  Text,
  PageTitle,
  SectionTitle,
  PanelTitle,
  Subhead,
  Caption,
  HelperText,
  ErrorText,
  Label,
  MetricValue,
  MetricLabel,
  Code,
  type HeadingProps,
  type HeadingLevel,
  type TextProps,
} from './Typography'

/**
 * Every class in `expected` must be present on the element. Order-independent
 * and robust to tailwind-merge re-ordering / de-duplication.
 */
function hasAllClasses(el: Element | null, expected: string): boolean {
  const actual = new Set((el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
  return expected
    .split(/\s+/)
    .filter(Boolean)
    .every((c) => actual.has(c))
}

describe('Heading', () => {
  const levels: Array<{ level: HeadingLevel; tag: string; role: string }> = [
    { level: 'page', tag: 'H1', role: typography.role.pageTitle },
    { level: 'section', tag: 'H2', role: typography.role.sectionTitle },
    { level: 'panel', tag: 'H3', role: typography.role.panelTitle },
    { level: 'sub', tag: 'H4', role: typography.role.subhead },
  ]

  it.each(levels)('level "$level" renders <$tag> with its role classes', ({ level, tag, role }) => {
    const { container } = render(<Heading level={level}>Title</Heading>)
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe(tag)
    expect(el.textContent).toBe('Title')
    expect(hasAllClasses(el, role)).toBe(true)
  })

  it('defaults to level "section" (<h2>) when no level is given', () => {
    render(<Heading>Untitled</Heading>)
    const el = screen.getByRole('heading', { level: 2, name: 'Untitled' })
    expect(el.tagName).toBe('H2')
    expect(hasAllClasses(el, typography.role.sectionTitle)).toBe(true)
  })

  it('honours the `as` tag override while keeping the level role classes', () => {
    const { container } = render(
      <Heading level="page" as="div">
        Hero
      </Heading>,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe('DIV')
    expect(hasAllClasses(el, typography.role.pageTitle)).toBe(true)
  })

  it('merges caller className with the role classes instead of clobbering them', () => {
    const { container } = render(<Heading className="mt-4">X</Heading>)
    const cls = (container.firstElementChild as HTMLElement).className
    expect(cls).toContain('mt-4')
    // sectionTitle role still present.
    expect(cls).toContain('font-semibold')
    expect(cls).toContain('text-[var(--text-primary)]')
  })

  it('forwards arbitrary HTML attributes to the underlying element', () => {
    render(
      <Heading id="hero" data-testid="h" aria-label="Hero heading">
        H
      </Heading>,
    )
    const el = screen.getByTestId('h')
    expect(el.id).toBe('hero')
    expect(el.getAttribute('aria-label')).toBe('Hero heading')
  })
})

describe('Text', () => {
  it('renders a <span> with its children by default (no classes)', () => {
    const { container } = render(<Text>hello</Text>)
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe('SPAN')
    expect(el.textContent).toBe('hello')
    // No variant / size / weight / color / mono → no typography classes.
    expect(el.className).toBe('')
  })

  it('applies a pre-composed `variant` role', () => {
    const { container } = render(<Text variant="body">body copy</Text>)
    const el = container.firstElementChild as HTMLElement
    expect(hasAllClasses(el, typography.role.body)).toBe(true)
  })

  it('ignores granular size/weight/color when a `variant` is set', () => {
    const { container } = render(
      <Text variant="caption" size="3xl" weight="bold" color="primary">
        c
      </Text>,
    )
    const cls = (container.firstElementChild as HTMLElement).className
    // caption role wins…
    expect(cls).toContain('text-xs')
    expect(cls).toContain('text-[var(--text-muted)]')
    // …and the granular overrides are dropped.
    expect(cls).not.toContain('text-3xl')
    expect(cls).not.toContain('font-bold')
    expect(cls).not.toContain('text-[var(--text-primary)]')
  })

  it('composes granular size/weight/color/mono when no `variant` is set', () => {
    const { container } = render(
      <Text size="lg" weight="semibold" color="secondary" mono>
        g
      </Text>,
    )
    const cls = (container.firstElementChild as HTMLElement).className
    expect(cls).toContain(typography.size.lg)
    expect(cls).toContain(typography.weight.semibold)
    expect(cls).toContain(typography.color.secondary)
    expect(cls).toContain(typography.family.mono)
  })

  it('still applies `mono` on top of a `variant` (regression: mono was dropped)', () => {
    const { container } = render(
      <Text variant="body" mono>
        123
      </Text>,
    )
    const el = container.firstElementChild as HTMLElement
    // font-mono is present…
    expect(el.className).toContain(typography.family.mono)
    // …alongside the variant's colour role.
    expect(el.className).toContain('text-[var(--text-primary)]')
  })

  it('does NOT add font-mono for a variant when `mono` is not requested', () => {
    const { container } = render(<Text variant="body">plain</Text>)
    expect((container.firstElementChild as HTMLElement).className).not.toContain('font-mono')
  })

  it('renders the tag supplied via `as`', () => {
    const { container } = render(
      <Text as="div" variant="label">
        L
      </Text>,
    )
    expect(container.querySelector('div')).toBeInTheDocument()
    expect(container.querySelector('span')).toBeNull()
  })

  it('merges className and forwards arbitrary attributes', () => {
    render(
      <Text className="truncate" data-testid="t" id="node" title="tip">
        v
      </Text>,
    )
    const el = screen.getByTestId('t')
    expect(el.className).toContain('truncate')
    expect(el.id).toBe('node')
    expect(el.getAttribute('title')).toBe('tip')
  })
})

describe('convenience heading wrappers', () => {
  const cases: Array<{ name: string; Comp: ComponentType<{ className?: string; children?: ReactNode }>; tag: string; role: string }> = [
    { name: 'PageTitle', Comp: PageTitle, tag: 'H1', role: typography.role.pageTitle },
    { name: 'SectionTitle', Comp: SectionTitle, tag: 'H2', role: typography.role.sectionTitle },
    { name: 'PanelTitle', Comp: PanelTitle, tag: 'H3', role: typography.role.panelTitle },
    { name: 'Subhead', Comp: Subhead, tag: 'H4', role: typography.role.subhead },
  ]

  it.each(cases)('$name renders <$tag> with its role classes', ({ Comp, tag, role }) => {
    const { container } = render(<Comp>content</Comp>)
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe(tag)
    expect(el.textContent).toBe('content')
    expect(hasAllClasses(el, role)).toBe(true)
  })
})

describe('convenience text wrappers', () => {
  const cases: Array<{ name: string; Comp: ComponentType<{ className?: string; children?: ReactNode }>; tag: string; role: string }> = [
    { name: 'Caption', Comp: Caption, tag: 'SPAN', role: typography.role.caption },
    { name: 'HelperText', Comp: HelperText, tag: 'P', role: typography.role.helper },
    { name: 'Label', Comp: Label, tag: 'SPAN', role: typography.role.label },
    { name: 'MetricValue', Comp: MetricValue, tag: 'DIV', role: typography.role.metricValue },
    { name: 'MetricLabel', Comp: MetricLabel, tag: 'DIV', role: typography.role.metricLabel },
    { name: 'Code', Comp: Code, tag: 'CODE', role: typography.role.code },
  ]

  it.each(cases)('$name renders <$tag> with its role classes', ({ Comp, tag, role }) => {
    const { container } = render(<Comp>content</Comp>)
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe(tag)
    expect(el.textContent).toBe('content')
    expect(hasAllClasses(el, role)).toBe(true)
  })

  it('ErrorText renders a <p> with role="alert" and the error role classes', () => {
    render(<ErrorText>Something went wrong</ErrorText>)
    const el = screen.getByRole('alert')
    expect(el.tagName).toBe('P')
    expect(el.textContent).toBe('Something went wrong')
    expect(hasAllClasses(el, typography.role.error)).toBe(true)
  })

  it('convenience wrappers forward className without dropping their role', () => {
    const { container } = render(<Caption className="mt-2">c</Caption>)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('mt-2')
    expect(el.className).toContain('text-[var(--text-muted)]')
  })
})

describe('exported prop types (compile-time contract)', () => {
  it('accepts values typed as HeadingProps / HeadingLevel / TextProps', () => {
    const headingProps: HeadingProps = { level: 'panel', children: 'HP' }
    const level: HeadingLevel = 'sub'
    const textProps: TextProps = { variant: 'label', mono: true, children: 'TP' }

    render(<Heading {...headingProps} />)
    render(<Heading level={level}>lvl</Heading>)
    render(<Text {...textProps} />)

    expect(screen.getByText('HP').tagName).toBe('H3')
    expect(screen.getByText('lvl').tagName).toBe('H4')
    const tp = screen.getByText('TP')
    expect(tp.tagName).toBe('SPAN')
    expect(tp.className).toContain(typography.family.mono)
  })
})
