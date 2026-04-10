import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  DataTable,
  Modal,
  MetricCard,
  AlertBanner,
  Accordion,
  ChartContainer,
  FormSection,
  type Column,
} from './Composites'

// ── DataTable ──

type Row = { id: number; name: string; score: number }

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: r => r.name, sortable: true },
  { key: 'score', header: 'Score', render: r => r.score, sortable: true },
]
const data: Row[] = [
  { id: 1, name: 'Alice', score: 90 },
  { id: 2, name: 'Bob', score: 85 },
]

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} keyExtractor={r => r.id} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Score')).toBeInTheDocument()
  })

  it('renders data rows', () => {
    render(<DataTable columns={columns} data={data} keyExtractor={r => r.id} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
  })

  it('shows empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} keyExtractor={r => r.id} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('shows default empty message', () => {
    render(<DataTable columns={columns} data={[]} keyExtractor={r => r.id} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('applies aria-sort on sorted columns', () => {
    render(
      <DataTable columns={columns} data={data} keyExtractor={r => r.id} sortKey="name" sortDir="asc" />
    )
    const nameTh = screen.getByText('Name').closest('th')
    expect(nameTh).toHaveAttribute('aria-sort', 'ascending')
  })

  it('applies aria-sort descending', () => {
    render(
      <DataTable columns={columns} data={data} keyExtractor={r => r.id} sortKey="score" sortDir="desc" />
    )
    const scoreTh = screen.getByText('Score').closest('th')
    expect(scoreTh).toHaveAttribute('aria-sort', 'descending')
  })
})

// ── Modal ──

describe('Modal', () => {
  it('returns null when open=false', () => {
    const { container } = render(<Modal open={false} onClose={() => {}}>Hidden</Modal>)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('renders title and children when open=true', () => {
    render(<Modal open={true} onClose={() => {}} title="Confirm">Are you sure?</Modal>)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('has role="dialog" and aria-modal="true"', () => {
    render(<Modal open={true} onClose={() => {}} title="Test">Content</Modal>)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})

// ── MetricCard ──

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Speed" value="120 mph" />)
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByText('120 mph')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(<MetricCard label="Battery" value="85%" icon={<span data-testid="icon">⚡</span>} />)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('shows change indicator positive', () => {
    render(<MetricCard label="Efficiency" value="4.2" change={{ value: '12%', positive: true }} />)
    expect(screen.getByText(/↑/)).toBeInTheDocument()
    expect(screen.getByText(/12%/)).toBeInTheDocument()
  })

  it('shows change indicator negative', () => {
    render(<MetricCard label="Range" value="280" change={{ value: '5%', positive: false }} />)
    expect(screen.getByText(/↓/)).toBeInTheDocument()
    expect(screen.getByText(/5%/)).toBeInTheDocument()
  })
})

// ── AlertBanner ──

describe('AlertBanner', () => {
  it('renders info variant styling', () => {
    const { container } = render(<AlertBanner variant="info" title="Info">Details</AlertBanner>)
    expect(container.firstChild).toHaveClass('border-neon-cyan/20')
  })

  it('renders danger variant styling', () => {
    const { container } = render(<AlertBanner variant="danger" title="Error">Failed</AlertBanner>)
    expect(container.firstChild).toHaveClass('border-neon-red/20')
  })

  it('renders title and children', () => {
    render(<AlertBanner variant="info" title="Notice">Please read</AlertBanner>)
    expect(screen.getByText('Notice')).toBeInTheDocument()
    expect(screen.getByText('Please read')).toBeInTheDocument()
  })

  it('shows close button when onClose provided', () => {
    const onClose = vi.fn()
    render(<AlertBanner variant="info" onClose={onClose}>Msg</AlertBanner>)
    const closeBtn = screen.getByRole('button')
    expect(closeBtn).toBeInTheDocument()
  })

  it('does not show close button when onClose not provided', () => {
    render(<AlertBanner variant="info">Msg</AlertBanner>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

// ── Accordion ──

describe('Accordion', () => {
  it('renders title', () => {
    render(<Accordion title="Details">Content here</Accordion>)
    expect(screen.getByText('Details')).toBeInTheDocument()
  })

  it('has aria-expanded attribute', () => {
    render(<Accordion title="Section">Body</Accordion>)
    const btn = screen.getByRole('button', { name: /Section/ })
    expect(btn).toHaveAttribute('aria-expanded')
  })

  it('is collapsed by default (aria-expanded=false)', () => {
    render(<Accordion title="Section">Body</Accordion>)
    const btn = screen.getByRole('button', { name: /Section/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows content when defaultOpen=true', () => {
    render(<Accordion title="Open" defaultOpen={true}>Visible content</Accordion>)
    const btn = screen.getByRole('button', { name: /Open/ })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Visible content')).toBeInTheDocument()
  })
})

// ── ChartContainer ──

describe('ChartContainer', () => {
  it('renders title', () => {
    render(<ChartContainer title="Usage Chart"><div>Chart</div></ChartContainer>)
    expect(screen.getByText('Usage Chart')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(<ChartContainer><div>My Chart</div></ChartContainer>)
    expect(screen.getByText('My Chart')).toBeInTheDocument()
  })
})

// ── FormSection ──

describe('FormSection', () => {
  it('renders title and description', () => {
    render(
      <FormSection title="Account" description="Manage your settings">
        <input />
      </FormSection>
    )
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Manage your settings')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <FormSection title="Prefs">
        <span>Child element</span>
      </FormSection>
    )
    expect(screen.getByText('Child element')).toBeInTheDocument()
  })
})
