import type { CommandDef, InputConfig } from '../../commands';

export function normalizeCommandValues(config: InputConfig, values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const validation = config.fields
      ? config.fields.find(field => field.name === name)?.validation
      : config.validation;
    return [name, validation === 'number' || validation === 'decimal'
      ? String(Number(value.trim())) : validation === 'pin' ? value.trim() : value];
  }));
}

export function buildCommandParams(definition: CommandDef, values: Record<string, string>) {
  const config = definition.inputConfig!;
  const normalized = normalizeCommandValues(config, values);
  return config.buildParams ? config.buildParams(normalized) : {
    ...definition.params,
    [config.paramName]: config.transform
      ? config.transform(normalized[config.paramName] ?? '')
      : normalized[config.paramName] ?? '',
  };
}

export function supportsInlineInput(definition: CommandDef) {
  const config = definition.inputConfig;
  return definition.type === 'input' && !definition.dangerous
    && !definition.confirmInput && !definition.countdown
    && definition.command !== 'set_charging_amps'
    && (definition.selectConfig != null || config != null
      && !config.fields && config.validation !== 'pin');
}
