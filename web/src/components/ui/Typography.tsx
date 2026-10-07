import { type ReactNode, type ElementType, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import {
  typography,
  type TypographyRole,
  type TypographyColor,
  type TypographyWeight,
  type TypographySize,
} from '@/lib/tokens'

type CommonProps = {
  className?: string
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'color'>

// ─────────────────────────────────────────────
// Heading — use for h1/h2/h3/h4
// ─────────────────────────────────────────────

export type HeadingLevel = 'page' | 'section' | 'panel' | 'sub'

export interface HeadingProps extends CommonProps {
  level?: HeadingLevel
  /** Override the default semantic tag for this heading level. */
  as?: ElementType
}

const HEADING_TAG: Record<HeadingLevel, ElementType> = {
  page: 'h1',
  section: 'h2',
  panel: 'h3',
  sub: 'h4',
}

const HEADING_ROLE: Record<HeadingLevel, TypographyRole> = {
  page: 'pageTitle',
  section: 'sectionTitle',
  panel: 'panelTitle',
  sub: 'subhead',
}

export function Heading({ level = 'section', as, className, children, ...rest }: HeadingProps) {
  const Tag = as ?? HEADING_TAG[level]
  return (
    <Tag className={cn(typography.role[HEADING_ROLE[level]], className)} {...rest}>
      {children}
    </Tag>
  )
}

// ─────────────────────────────────────────────
// Text — generic body / span
// ─────────────────────────────────────────────

export interface TextProps extends CommonProps {
  /** Pre-composed role. If set, size/weight/color are ignored (mono still composes on top). */
  variant?: TypographyRole
  /** Granular size — only applied when variant is unset. */
  size?: TypographySize
  /** Granular weight — only applied when variant is unset. */
  weight?: TypographyWeight
  /** Granular color — only applied when variant is unset. */
  color?: TypographyColor
  /** Switch the font family to JetBrains Mono. */
  mono?: boolean
  as?: ElementType
}

export function Text({
  variant,
  size,
  weight,
  color,
  mono,
  as = 'span',
  className,
  children,
  ...rest
}: TextProps) {
  const Tag = as
  // `variant` supplies the pre-composed role (size/weight/color). `mono` is an
  // orthogonal family switch that must still apply on top of a role — several
  // call sites use `<Text variant="body" mono>` for monospaced values.
  const classes = variant
    ? cn(typography.role[variant], mono && typography.family.mono)
    : cn(
        size && typography.size[size],
        weight && typography.weight[weight],
        color && typography.color[color],
        mono && typography.family.mono,
      )
  return (
    <Tag className={cn(classes, className)} {...rest}>
      {children}
    </Tag>
  )
}

// ─────────────────────────────────────────────
// Convenience — match common roles 1:1
// ─────────────────────────────────────────────

export const PageTitle = (p: CommonProps) => <Heading level="page" {...p} />
export const SectionTitle = (p: CommonProps) => <Heading level="section" {...p} />
export const PanelTitle = (p: CommonProps) => <Heading level="panel" {...p} />
export const Subhead = (p: CommonProps) => <Heading level="sub" {...p} />

export const Caption = (p: CommonProps) => <Text as="span" variant="caption" {...p} />
export const HelperText = (p: CommonProps) => <Text as="p" variant="helper" {...p} />
export const ErrorText = (p: CommonProps) => <Text as="p" variant="error" role="alert" {...p} />
export const Label = (p: CommonProps) => <Text as="span" variant="label" {...p} />
export const MetricValue = (p: CommonProps) => <Text as="div" variant="metricValue" {...p} />
export const MetricLabel = (p: CommonProps) => <Text as="div" variant="metricLabel" {...p} />
export const Code = (p: CommonProps) => <Text as="code" variant="code" {...p} />
