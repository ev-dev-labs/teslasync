/** Canonicalize JavaScript fetch hints without changing CSS cascade order. */
export function canonicalPreloadDependencies(dependencies: readonly string[]): string[] {
  const scripts = dependencies.filter(dependency => dependency.endsWith('.js')).sort();
  let index = 0;
  return dependencies.map(dependency => dependency.endsWith('.js') ? scripts[index++] : dependency);
}
