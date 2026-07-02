import type { Meta, StoryObj } from '@storybook/react'
import { Zap } from 'lucide-react'
import { Button } from './Button'

/**
 * Scaffold smoke-test story for the Storybook 8 + Vite + Tailwind setup
 * (p1-tooling/0001-storybook-scaffold). Exercises every variant/size/state
 * branch of the real shared `<Button>` (`@/components/ui/Button`) used
 * across the app. The remaining ~197 shared components get their own
 * stories from the `p7-storybook-stories` program; this file only proves
 * the scaffold renders full design-system styling (Tailwind tokens, dark
 * theme, fonts) correctly end to end.
 */
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
    children: 'Button',
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
  args: { variant: 'danger', children: 'Delete' },
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
  args: { icon: <Zap className="h-4 w-4" />, children: 'Boost' },
}
