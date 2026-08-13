import { formatRelative } from '@/lib/dateFormat';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { COMMANDS, type CommandDef } from '../../commands';

export type CommandTranslate = (
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) => string;

const COMMAND_BY_WIRE_NAME = new Map<string, CommandDef>();

for (const definition of COMMANDS) {
  COMMAND_BY_WIRE_NAME.set(definition.command, definition);
  if (definition.commandOff) {
    COMMAND_BY_WIRE_NAME.set(definition.commandOff, definition);
  }
}

export function getCommandDefinition(command: string): CommandDef | undefined {
  return COMMAND_BY_WIRE_NAME.get(command);
}

export function getCommandLabel(command: string, t: CommandTranslate): string {
  const definition = getCommandDefinition(command);
  if (definition && definition.command === command) {
    return t(definition.labelKey, definition.labelFallback);
  }

  const humanized = command
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

  if (definition?.commandOff === command) {
    return t(`commands.activity.commands.${command}`, humanized);
  }

  return t('commands.activity.unknownCommand', '{{command}}', {
    command: humanized || '—',
  });
}

export function getLatestCommandStatus(entry: CommandLogEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const marker = entry.status === 'success' ? '✓' : '✗';
  return `${marker} ${formatRelative(entry.created_at)}`;
}
