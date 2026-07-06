import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandInputDialog, validateField } from './CommandInputDialog';
import type { CommandDef } from '../commands';
import type { LucideIcon } from '@/lib/icons';

// Mock react-i18next so the dialog + shared <Label> get fallback strings and
// i18next-style `{{key}}` interpolation without booting the full i18n runtime.
// Mirrors the convention in components/layout/__tests__/PageContainer.test.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const StubIcon = ((props: { className?: string }) => (
  <svg data-testid="cmd-icon" className={props.className} aria-hidden="true" />
)) as unknown as LucideIcon;

// ── Fixtures ──────────────────────────────────────────────────────────────
const pinDef: CommandDef = {
  id: 'valet_mode',
  command: 'set_valet_mode',
  labelKey: 'commands.security.valetMode',
  labelFallback: 'Valet Mode',
  sublabelKey: 'commands.security.enterPin',
  sublabelFallback: 'PIN',
  icon: StubIcon,
  category: 'security',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.security.enterValetPin',
    promptFallback: 'Enter 4-digit valet PIN:',
    paramName: 'password',
    validation: 'pin',
  },
};

const speedDef: CommandDef = {
  id: 'speed_limit',
  command: 'speed_limit_set_limit',
  labelKey: 'commands.security.speedLimit',
  labelFallback: 'Speed Limit',
  sublabelKey: 'commands.security.setMph',
  sublabelFallback: 'Set MPH',
  icon: StubIcon,
  category: 'security',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.security.enterSpeedLimit',
    promptFallback: 'Enter speed limit (50-90 MPH):',
    paramName: 'limit_mph',
    validation: 'number',
    min: 50,
    max: 90,
    defaultValue: '70',
  },
};

const geoDef: CommandDef = {
  id: 'homelink',
  command: 'trigger_homelink',
  labelKey: 'commands.homelink.title',
  labelFallback: 'HomeLink',
  icon: StubIcon,
  category: 'doors',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.homelink.prompt',
    promptFallback: 'Enter coordinates:',
    paramName: 'unused',
    fields: [
      { name: 'lat', labelKey: 'commands.homelink.latitude', labelFallback: 'Latitude', placeholder: '37.7749', validation: 'decimal' },
      { name: 'lon', labelKey: 'commands.homelink.longitude', labelFallback: 'Longitude', placeholder: '-122.4194', validation: 'decimal' },
    ],
  },
};

const nameDef: CommandDef = {
  id: 'set_name',
  command: 'set_vehicle_name',
  labelKey: 'commands.vehicle.setName',
  labelFallback: 'Set Name',
  sublabelKey: 'commands.vehicle.name',
  sublabelFallback: 'Name',
  icon: StubIcon,
  category: 'vehicle',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.vehicle.enterName',
    promptFallback: 'Enter a new name:',
    paramName: 'vehicle_name',
    validation: 'text',
    getDefaultValue: ({ vehicle }) => vehicle?.display_name ?? '',
  },
};

function setup(
  overrides: {
    def?: CommandDef;
    open?: boolean;
    vehicle?: { display_name: string };
    loading?: boolean;
  } = {},
) {
  const { def = pinDef, open = true, vehicle, loading } = overrides;
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  const view = render(
    <CommandInputDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      def={def}
      vehicle={vehicle}
      loading={loading}
    />,
  );
  return { onClose, onSubmit, ...view };
}

afterEach(() => cleanup());

// ── Pure validation helper ──────────────────────────────────────────────────
describe('validateField', () => {
  it('flags empty and whitespace-only values as required', () => {
    expect(validateField('')).toEqual({ key: 'commands.input.required', fallback: 'Required' });
    expect(validateField('   ')).toEqual({ key: 'commands.input.required', fallback: 'Required' });
    expect(validateField('   ', 'pin')).toMatchObject({ key: 'commands.input.required' });
  });

  it('accepts only 4-digit pins', () => {
    expect(validateField('1234', 'pin')).toBeNull();
    expect(validateField('12', 'pin')).toEqual({ key: 'commands.input.pin', fallback: 'Enter a 4-digit PIN' });
    expect(validateField('abcd', 'pin')).toMatchObject({ key: 'commands.input.pin' });
    expect(validateField('12345', 'pin')).toMatchObject({ key: 'commands.input.pin' });
  });

  it('enforces whole numbers within min/max bounds', () => {
    expect(validateField('70', 'number', 50, 90)).toBeNull();
    expect(validateField('5.5', 'number')).toMatchObject({ key: 'commands.input.wholeNumber' });
    expect(validateField('40', 'number', 50, 90)).toEqual({
      key: 'commands.input.min',
      fallback: 'Minimum: {{min}}',
      values: { min: 50 },
    });
    expect(validateField('95', 'number', 50, 90)).toEqual({
      key: 'commands.input.max',
      fallback: 'Maximum: {{max}}',
      values: { max: 90 },
    });
  });

  it('parses decimals and applies bounds', () => {
    expect(validateField('37.7749', 'decimal')).toBeNull();
    expect(validateField('abc', 'decimal')).toMatchObject({ key: 'commands.input.decimal' });
    expect(validateField('-200', 'decimal', -180, 180)).toMatchObject({ key: 'commands.input.min' });
    expect(validateField('200', 'decimal', -180, 180)).toMatchObject({ key: 'commands.input.max' });
  });

  it('treats any non-empty free text as valid', () => {
    expect(validateField('hello', 'text')).toBeNull();
    expect(validateField('anything-goes')).toBeNull();
  });
});

// ── Component behaviour ─────────────────────────────────────────────────────
describe('CommandInputDialog', () => {
  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Enter 4-digit valet PIN:')).toBeNull();
  });

  it('exposes an accessible dialog name, heading, prompt and icon', () => {
    setup({ def: speedDef });
    expect(screen.getByRole('dialog', { name: 'Speed Limit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Speed Limit' })).toBeInTheDocument();
    expect(screen.getByText('Enter speed limit (50-90 MPH):')).toBeInTheDocument();
    expect(screen.getByTestId('cmd-icon')).toHaveClass('h-5', 'w-5');
  });

  it('seeds the single input from inputConfig.defaultValue', () => {
    setup({ def: speedDef });
    expect(screen.getByLabelText('Set MPH')).toHaveValue('70');
  });

  it('derives the default value from the vehicle via getDefaultValue', () => {
    setup({ def: nameDef, vehicle: { display_name: 'My Model 3' } });
    expect(screen.getByLabelText('Name')).toHaveValue('My Model 3');
  });

  it('shows a translated validation error on blur and disables submit', () => {
    setup({ def: pinDef });
    const input = screen.getByLabelText('PIN');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    expect(screen.getByText('Enter a 4-digit PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('re-validates on change after a field is touched and clears the error', () => {
    setup({ def: pinDef });
    const input = screen.getByLabelText('PIN');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    expect(screen.getByText('Enter a 4-digit PIN')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '1234' } });
    expect(screen.queryByText('Enter a 4-digit PIN')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('submits the entered values when valid', () => {
    const { onSubmit } = setup({ def: pinDef });
    const input = screen.getByLabelText('PIN');
    fireEvent.change(input, { target: { value: '1234' } });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ password: '1234' });
  });

  it('interpolates minimum and maximum bound errors for number fields', () => {
    setup({ def: speedDef });
    const input = screen.getByLabelText('Set MPH');

    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.blur(input);
    expect(screen.getByText('Minimum: 50')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '95' } });
    expect(screen.getByText('Maximum: 90')).toBeInTheDocument();
    expect(screen.queryByText('Minimum: 50')).toBeNull();
  });

  it('renders one input per field and submits multi-field values', () => {
    const { onSubmit } = setup({ def: geoDef });
    const lat = screen.getByLabelText('Latitude');
    const lon = screen.getByLabelText('Longitude');
    expect(lat).toBeInTheDocument();
    expect(lon).toBeInTheDocument();

    fireEvent.change(lat, { target: { value: '37.7749' } });
    fireEvent.change(lon, { target: { value: '-122.4194' } });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith({ lat: '37.7749', lon: '-122.4194' });
  });

  it('validates each field independently and reports the invalid one', () => {
    setup({ def: geoDef });
    const lat = screen.getByLabelText('Latitude');
    fireEvent.change(lat, { target: { value: 'abc' } });
    fireEvent.blur(lat);
    expect(screen.getByText('Enter a valid number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('marks all fields touched and blocks submit when submitted while invalid', () => {
    const { onSubmit } = setup({ def: geoDef });
    const form = screen.getByRole('button', { name: 'Send' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('Required')).toHaveLength(2);
  });

  it('closes without submitting when Cancel is clicked', () => {
    const { onClose, onSubmit } = setup({ def: pinDef });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes when Escape is pressed inside the dialog', () => {
    const { onClose } = setup({ def: pinDef });
    fireEvent.keyDown(screen.getByLabelText('PIN'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('disables and marks the submit button busy while loading', () => {
    setup({ def: pinDef, loading: true });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('aria-busy', 'true');
  });

  it('resets values back to the default when reopened', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <CommandInputDialog open onClose={onClose} onSubmit={onSubmit} def={speedDef} />,
    );
    fireEvent.change(screen.getByLabelText('Set MPH'), { target: { value: '88' } });
    expect(screen.getByLabelText('Set MPH')).toHaveValue('88');

    rerender(<CommandInputDialog open={false} onClose={onClose} onSubmit={onSubmit} def={speedDef} />);
    expect(screen.queryByLabelText('Set MPH')).toBeNull();

    rerender(<CommandInputDialog open onClose={onClose} onSubmit={onSubmit} def={speedDef} />);
    expect(screen.getByLabelText('Set MPH')).toHaveValue('70');
  });
});
