export function testTranslation(key: string, fallbackOrOptions?: unknown, options?: unknown): string {
  const values = typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
    ? fallbackOrOptions as Record<string, unknown>
    : typeof options === 'object' && options !== null ? options as Record<string, unknown> : {};
  const fallback = typeof fallbackOrOptions === 'string'
    ? fallbackOrOptions
    : typeof values.defaultValue === 'string' ? values.defaultValue : key;
  return fallback.replace(/{{(\w+)}}/g, (_, name: string) =>
    name in values ? String(values[name]) : `{{${name}}}`,
  );
}
