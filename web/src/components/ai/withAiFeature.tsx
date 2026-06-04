import type { ComponentType } from 'react'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { AI_FEATURES, type AiFeatureId } from '@/ai/features'

/**
 * AI-Off Contract (ADR-015).
 *
 * Higher-order component that wraps an AI feature's UI in the
 * sanctioned visibility gate. The wrapped component returns `null`
 * unless {@link useAiEnabled} reports `feature` as on; when on, it
 * renders the inner component inside a `<div>` carrying the
 * `data-ai-feature="<id>"` attribute and one `data-testid` per
 * registered UI test ID. Those markers exist so the off-mode
 * invariant tests (Vitest + Playwright) can prove that no AI surface
 * leaks into the DOM in `ai_mode='off'`.
 *
 * Why an HOC and not a render-prop or `<If>` component:
 *
 *  - The ESLint rule `teslasync/ai-component-must-be-wrapped` checks
 *    statically that every default-exported AI component is the
 *    return value of `withAiFeature(...)`. A function-call wrapper
 *    is greppable and AST-detectable in a way that JSX siblings are
 *    not.
 *
 *  - The wrapper's name (`withAiFeature(<id>, <Inner>)`) shows up in
 *    React DevTools, so a developer inspecting an AI surface can
 *    immediately see which feature flag controls it.
 *
 *  - Unknown feature IDs throw at module load (not at render), so a
 *    typo is caught the first time the file is imported rather than
 *    silently rendering nothing forever.
 */
export function withAiFeature<P extends object>(
  feature: AiFeatureId,
  Inner: ComponentType<P>,
): ComponentType<P> {
  if (!AI_FEATURES[feature]) {
    throw new Error(
      `withAiFeature: unknown AI feature id ${JSON.stringify(feature)}. ` +
        `Add it to internal/ai/features/registry.go and run \`make generate\`.`,
    )
  }
  const meta = AI_FEATURES[feature]
  const innerName = Inner.displayName ?? Inner.name ?? 'Component'

  const Wrapped: ComponentType<P> = (props) => {
    const enabled = useAiEnabled(feature)
    if (!enabled) return null
    return (
      <div
        data-ai-feature={feature}
        data-testid={meta.uiTestIds[0] ?? `ai-feature-${feature}`}
      >
        <Inner {...props} />
      </div>
    )
  }
  Wrapped.displayName = `withAiFeature(${feature}, ${innerName})`
  return Wrapped
}
