// Keep Vite's complete locale import/preload table out of the synchronous shell.
const englishNamespaceModules = import.meta.glob<{ default: Record<string, unknown> }>(
  './en/locale-*.json',
)

export async function loadEnglishBundleResource(bundle: string): Promise<Record<string, unknown>> {
  const loadModule = englishNamespaceModules[`./en/locale-${bundle}.json`]
  if (!loadModule) throw new Error(`Unknown English locale bundle: ${bundle}`)
  return (await loadModule()).default
}
