/**
 * Ambient type shim for `js-yaml` (v4.2.0), which ships no bundled declarations
 * and has no `@types/js-yaml` installed in this workspace.
 *
 * The native API-Playground page (web-parity) is the ONLY js-yaml consumer in
 * the entire app (verified against web/src), so this single minimal ambient
 * declaration is sufficient and cannot collide with another converted file. It
 * mirrors only the `yaml.load(text)` surface the web page uses.
 */
declare module 'js-yaml' {
  export function load(input: string): unknown;
  const jsYaml: {load: typeof load};
  export default jsYaml;
}
