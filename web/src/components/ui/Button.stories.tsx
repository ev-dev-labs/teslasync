import type { Meta, StoryObj } from '@storybook/react'
import { Power, RefreshCw, Trash2, Zap } from 'lucide-react'
import { Button } from './Button'

/**
 * Gold-standard Storybook coverage for the shared `<Button>`
 * (`@/components/ui/Button`) — the primitive behind 268+ call-sites across
 * every feature domain.
 *
 * Every visually distinct branch of the component gets its own story so the
 * design-system regression suite (Chromatic) can snapshot each in isolation:
 * the five `variant`s, the four `size`s, the `loading` spinner branch, the
 * `disabled` branch, the leading-`icon` branch, the icon-only (no text
 * label) branch, and a 375px mobile-viewport story that proves the
 * full-width CTA layout and ≥44px touch target hold at phone width.
 *
 * `<Button>` is a pure presentational primitive — no TanStack Query / i18n /
 * Router context is required — so it renders directly against the global
 * dark-theme + density decorators already wired in `.storybook/preview.ts`;
 * no per-story decorator is added here.
 */

// Custom 375px (iPhone-class) viewport for the mobile story. Defined locally
// rather than reaching for addon-viewport's INITIAL_VIEWPORTS so the exact
// target width this unit must demonstrate is explicit and self-documenting.
const MOBILE_VIEWPORTS = {
  mobile375: {
    name: 'Mobile — 375px',
    styles: { width: '375px', height: '812px' },
    type: 'mobile',
  },
} as const

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'danger', 'ghost'],
      description: 'Visual style of the button.',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'auto'],
      description: "Height/padding. `auto` follows the user's density setting.",
    },
    loading: {
      control: 'boolean',
      description: 'Shows a spinner in place of `icon` and disables interaction.',
    },
    disabled: {
      control: 'boolean',
    },
    icon: {
      control: false,
      description: 'Optional leading icon node.',
    },
    children: {
      control: 'text',
    },
  },
  args: {
    children: 'Save changes',
    variant: 'primary',
    size: 'md',
    loading: false,
    disabled: false,
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: { variant: 'primary' },
}

export const Secondary: Story = {
  args: { variant: 'secondary' },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const Danger: Story = {
  args: { variant: 'danger', icon: <Trash2 className="h-4 w-4" />, children: 'Delete vehicle' },
}

export const Ghost: Story = {
  args: { variant: 'ghost' },
}

export const Small: Story = {
  args: { size: 'sm' },
}

export const Large: Story = {
  args: { size: 'lg' },
}

export const Loading: Story = {
  args: { loading: true, children: 'Saving…' },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const WithIcon: Story = {
  args: { icon: <Zap className="h-4 w-4" />, children: 'Start charging' },
}

/**
 * Icon-only (no text label) — e.g. a compact toolbar action. An `aria-label`
 * supplies the accessible name the visible text would otherwise provide, and
 * the `lg` size keeps the tap target ≥44px so it stays usable on touch.
 */
export const IconOnly: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Button variant="secondary" size="lg" aria-label="Wake vehicle" icon={<Power className="h-5 w-5" />} />
  ),
}

/**
 * Error-recovery affordance — the outline/refresh pairing surfaced by
 * `QueryError` when a request fails and the user can retry it.
 */
export const Retry: Story = {
  args: { variant: 'outline', icon: <RefreshCw className="h-4 w-4" />, children: 'Retry' },
}

/**
 * All five variants side by side — the reference matrix Chromatic diffs on
 * every design-token change.
 */
export const AllVariants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
}

/** Every size token side by side, including the density-aware `auto`. */
export const AllSizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="auto">Auto</Button>
    </div>
  ),
}

/**
 * Mobile viewport (375px). Primary CTAs on phones stretch full-width and use
 * the `lg` size (48px tall) to clear the 44px minimum touch target. The
 * `viewport` param drives Storybook's device-frame preview; the render
 * wrapper mirrors the app's mobile edge padding so there is no layout shift
 * between the story frame and the real screen.
 */
export const Mobile: Story = {
  parameters: {
    layout: 'fullscreen',
    viewport: {
      viewports: MOBILE_VIEWPORTS,
      defaultViewport: 'mobile375',
    },
  },
  args: {
    variant: 'primary',
    size: 'lg',
    icon: <Zap className="h-5 w-5" />,
    children: 'Start charging',
  },
  render: (args) => (
    <div className="w-full max-w-[375px] p-4">
      <Button {...args} className="w-full" />
    </div>
  ),
}
