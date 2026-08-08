import { useCallback } from 'react';
import type { CommandDef, Vehicle } from '../../commands';
import { CommandConfirmDialog } from '../CommandConfirmDialog';
import { CommandInputDialog } from '../CommandInputDialog';
import { CommandSelectDialog } from '../CommandSelectDialog';

export interface ActiveCommandDialog {
  kind: 'input' | 'select' | 'confirm';
  definition: CommandDef;
}

interface CommandDialogsProps {
  active: ActiveCommandDialog | null;
  vehicle: Vehicle;
  loading: boolean;
  onClose: () => void;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandDialogs({
  active,
  vehicle,
  loading,
  onClose,
  onExecute,
}: CommandDialogsProps) {
  const handleInputSubmit = useCallback((values: Record<string, string>) => {
    const definition = active?.definition;
    const config = definition?.inputConfig;
    if (!definition || !config) return;

    const params = config.buildParams
      ? config.buildParams(values)
      : {
          ...definition.params,
          [config.paramName]: config.transform
            ? config.transform(values[config.paramName] ?? '')
            : values[config.paramName] ?? '',
        };

    onExecute(definition.command, params);
    onClose();
  }, [active, onClose, onExecute]);

  const handleSelect = useCallback((value: string) => {
    const definition = active?.definition;
    const config = definition?.selectConfig;
    if (!definition || !config) return;

    onExecute(definition.command, {
      ...definition.params,
      [config.paramName]: value,
    });
    onClose();
  }, [active, onClose, onExecute]);

  const handleConfirm = useCallback(() => {
    if (!active) return;
    onExecute(active.definition.command, active.definition.params);
    onClose();
  }, [active, onClose, onExecute]);

  if (!active) return null;

  if (active.kind === 'input') {
    return (
      <CommandInputDialog
        open
        onClose={onClose}
        onSubmit={handleInputSubmit}
        def={active.definition}
        vehicle={{ display_name: vehicle.display_name || vehicle.vin }}
        loading={loading}
      />
    );
  }

  if (active.kind === 'select') {
    return (
      <CommandSelectDialog
        open
        onClose={onClose}
        onSelect={handleSelect}
        def={active.definition}
        loading={loading}
      />
    );
  }

  return (
    <CommandConfirmDialog
      open
      onClose={onClose}
      onConfirm={handleConfirm}
      def={active.definition}
      loading={loading}
    />
  );
}
