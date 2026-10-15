import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Text } from '@/components/ui';
import { CATEGORY_META, COMMANDS, type CommandDef } from '../../commands';
import { CommandDomainBrowser } from './CommandDomainBrowser';
import { COMMAND_DOMAINS, type CommandDomainId } from './commandDomains';

type BrowserProps = ComponentProps<typeof CommandDomainBrowser>;

function renderDefinition(definition: CommandDef) {
  return (
    <Text key={definition.id} data-testid={`definition-${definition.id}`}>
      {definition.labelFallback}
    </Text>
  );
}

function renderBrowser(overrides: Partial<BrowserProps> = {}) {
  const props: BrowserProps = {
    activeDomainId: 'access',
    vehicleKey: 42,
    onDomainChange: vi.fn(),
    renderTile: renderDefinition,
    ...overrides,
  };
  return { ...render(<CommandDomainBrowser {...props} />), props };
}

function ControlledBrowser({
  onChange,
}: {
  onChange: (domain: CommandDomainId) => void;
}) {
  const [activeDomainId, setActiveDomainId] = useState<CommandDomainId>('access');
  return (
    <CommandDomainBrowser
      activeDomainId={activeDomainId}
      vehicleKey={42}
      onDomainChange={(domain) => {
        onChange(domain);
        setActiveDomainId(domain);
      }}
      renderTile={renderDefinition}
    />
  );
}

describe('CommandDomainBrowser ordinary button contract (F10)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('names a group of four native pressed buttons without incomplete tab roles', () => {
    renderBrowser();
    const group = screen.getByRole('group', { name: 'Command domains' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    buttons.forEach((button, index) => {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAccessibleName(COMMAND_DOMAINS[index].labelFallback);
      expect(button).toHaveAttribute('aria-pressed', String(index === 0));
      expect(button).not.toHaveAttribute('aria-selected');
      expect(button.tabIndex).toBe(0);
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('links every domain button to one existing region named by the active button', () => {
    const { props, rerender } = renderBrowser();
    const region = screen.getByRole('region', { name: 'Access & security' });
    const buttons = within(screen.getByRole('group')).getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('aria-controls', region.id);
      expect(document.getElementById(button.getAttribute('aria-controls') ?? ''))
        .toBe(region);
    });
    expect(region).toHaveAttribute('aria-labelledby', buttons[0].id);

    rerender(<CommandDomainBrowser {...props} activeDomainId="charging" />);
    const updated = screen.getByRole('region', { name: 'Charging & schedules' });
    expect(updated.id).toBe(region.id);
    expect(updated).toHaveAttribute('aria-labelledby', buttons[2].id);
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses unique stable associations for multiple browsers independent of vehicle keys', () => {
    render(
      <>
        <CommandDomainBrowser activeDomainId="access" vehicleKey={42}
          onDomainChange={vi.fn()} renderTile={renderDefinition} />
        <CommandDomainBrowser activeDomainId="vehicle" vehicleKey={42}
          onDomainChange={vi.fn()} renderTile={renderDefinition} />
      </>,
    );
    const regions = screen.getAllByRole('region');
    expect(regions[0].id).not.toBe(regions[1].id);
    const groups = screen.getAllByRole('group');
    const controlIds = groups.flatMap((group) =>
      within(group).getAllByRole('button').map((button) => button.id),
    );
    expect(new Set(controlIds).size).toBe(8);
    groups.forEach((group, index) => {
      within(group).getAllByRole('button').forEach((button) => {
        expect(button).toHaveAttribute('aria-controls', regions[index].id);
      });
    });
  });

  it('keeps controlled selection until the parent accepts a pointer change', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderBrowser();
    const button = screen.getByRole('button', { name: 'Climate & comfort' });
    await user.click(button);
    expect(props.onDomainChange).toHaveBeenCalledExactlyOnceWith('comfort');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region')).toHaveAccessibleName('Access & security');
    rerender(<CommandDomainBrowser {...props} activeDomainId="comfort" />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region')).toHaveAccessibleName('Climate & comfort');
    expect(button).toHaveFocus();
  });

  it('supports native Enter and Space activation without command execution or form submission', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<form onSubmit={onSubmit}><ControlledBrowser onChange={onChange} /></form>);
    const comfort = screen.getByRole('button', { name: 'Climate & comfort' });
    comfort.focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('comfort');
    expect(comfort).toHaveAttribute('aria-pressed', 'true');
    expect(comfort).toHaveFocus();

    const charging = screen.getByRole('button', { name: 'Charging & schedules' });
    charging.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('charging');
    expect(charging).toHaveAttribute('aria-pressed', 'true');
    expect(charging).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps all four domain buttons in forward and backward native Tab order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledBrowser onChange={onChange} />);
    const buttons = within(screen.getByRole('group')).getAllByRole('button');
    for (const button of buttons) {
      await user.tab();
      expect(button).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByRole('button', { name: /Security & access/ })).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[3]).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[2]).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not emulate tab arrows or Home/End on ordinary buttons', async () => {
    const user = userEvent.setup();
    const { props } = renderBrowser();
    const button = screen.getByRole('button', { name: 'Charging & schedules' });
    button.focus();
    await user.keyboard('{ArrowRight}{ArrowLeft}{ArrowUp}{ArrowDown}{Home}{End}{Escape}');
    expect(button).toHaveFocus();
    expect(props.onDomainChange).not.toHaveBeenCalled();
    expect(screen.getByRole('region')).toHaveAccessibleName('Access & security');
  });

  it('retains fallback selection and full access content for an unknown runtime domain', () => {
    renderBrowser({ activeDomainId: 'unknown' as CommandDomainId });
    expect(screen.getByRole('button', { name: 'Access & security' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region')).toHaveAccessibleName('Access & security');
    expect(screen.getByRole('heading', { name: 'Access & security' })).toBeVisible();
  });

  it.each(COMMAND_DOMAINS)('preserves $id categories, counts, descriptions and every action', (domain) => {
    renderBrowser({ activeDomainId: domain.id });
    const region = screen.getByRole('region', { name: domain.labelFallback });
    const definitions = COMMANDS.filter((definition) =>
      domain.categories.includes(definition.category),
    );
    expect(within(region).getByText(domain.descriptionFallback)).toBeVisible();
    expect(within(region).getByText(`${definitions.length} actions`)).toBeVisible();
    expect(within(region).getAllByRole('button')).toHaveLength(domain.categories.length);
    domain.categories.forEach((category, index) => {
      const definitionsInCategory = definitions.filter((definition) =>
        definition.category === category,
      );
      const button = within(region).getByRole('button', {
        name: `${CATEGORY_META[category].fallback} (${definitionsInCategory.length})`,
      });
      expect(button).toHaveAttribute('aria-expanded', String(index === 0));
      if (index !== 0) fireEvent.click(button);
    });
    expect(within(region).getAllByTestId(/^definition-/)).toHaveLength(definitions.length);
    definitions.forEach((definition) => {
      expect(within(region).getByTestId(`definition-${definition.id}`))
        .toHaveTextContent(definition.labelFallback);
    });
  });

  it('preserves category expansion preferences across domain changes and isolates vehicle keys', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('teslasync-cat-42-security', 'false');
    sessionStorage.setItem('teslasync-cat-42-doors', 'true');
    sessionStorage.setItem('teslasync-cat-99-security', 'true');
    const { props, rerender } = renderBrowser();
    expect(screen.getByRole('button', { name: /Security & access/ }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Doors & trunk/ }))
      .toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /Doors & trunk/ }));
    expect(sessionStorage.getItem('teslasync-cat-42-doors')).toBe('false');
    rerender(<CommandDomainBrowser {...props} activeDomainId="comfort" />);
    rerender(<CommandDomainBrowser {...props} activeDomainId="access" />);
    expect(screen.getByRole('button', { name: /Doors & trunk/ }))
      .toHaveAttribute('aria-expanded', 'false');
    rerender(<CommandDomainBrowser {...props} vehicleKey={99} activeDomainId="comfort" />);
    rerender(<CommandDomainBrowser {...props} vehicleKey={99} activeDomainId="access" />);
    expect(screen.getByRole('button', { name: /Security & access/ }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(sessionStorage.getItem('teslasync-cat-42-security')).toBe('false');
  });

  it('forwards original command definitions to the renderer and retains its independent actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const renderTile = vi.fn((definition: CommandDef) => (
      <Button key={definition.id} type="button" onClick={() => onAction(definition)}>
        {definition.labelFallback}
      </Button>
    ));
    const { props } = renderBrowser({ renderTile });
    COMMANDS.filter((definition) =>
      COMMAND_DOMAINS[0].categories.includes(definition.category),
    ).forEach((definition) => {
      expect(renderTile.mock.calls.some(([rendered]) => rendered === definition)).toBe(true);
    });
    const definition = COMMANDS.find((command) => command.category === 'security');
    expect(definition).toBeDefined();
    await user.click(screen.getByRole('button', { name: definition?.labelFallback }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(definition);
    expect(props.onDomainChange).not.toHaveBeenCalled();
  });

  it('retains the two-column mobile/four-column desktop layout and large shared controls', () => {
    renderBrowser();
    const group = screen.getByRole('group');
    expect(group).toHaveClass('grid', 'grid-cols-2', 'gap-2', 'xl:grid-cols-4');
    within(group).getAllByRole('button').forEach((button) => {
      expect(button).toHaveClass('h-auto', 'min-h-12', 'justify-start', 'text-left');
      expect(button).not.toBeDisabled();
    });
    expect(screen.getByRole('region')).toHaveClass('p-3', 'sm:p-4');
  });
});
