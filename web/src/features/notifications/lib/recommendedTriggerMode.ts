/**
 * Phase-49 / Slice 0008 — Smart-defaults engine.
 *
 * Maps each `AlertRuleOp` to a recommended `AlertRuleTriggerMode` so the
 * Alert Studio can surface a per-operator suggestion when the user is
 * forced to choose at create time. The mapping is locked verbatim to
 * the methodology table:
 *
 *   '=' / '!=' / 'changed'           -> 'once'   (state-confirmation alerts)
 *   '>' / '<' / '>=' / '<=' /
 *     'between' / 'outside'          -> 'repeat' (threshold/safety alerts)
 *
 * Implementation note: this is intentionally a `switch` (NOT a Map
 * literal) so a new operator added to `ALERT_RULE_OPS` triggers a
 * TypeScript exhaustiveness error here, forcing the author to extend
 * the mapping consciously rather than silently inheriting the default.
 */

import type { AlertRuleInput, AlertRuleTriggerMode } from '@/api/types'

type RuleOp = NonNullable<AlertRuleInput['op']>

export function recommendedTriggerMode(op: RuleOp): AlertRuleTriggerMode {
  switch (op) {
    case '=':
    case '!=':
    case 'changed':
      return 'once'
    case '>':
    case '<':
    case '>=':
    case '<=':
    case 'between':
    case 'outside':
      return 'repeat'
    default: {
      const _exhaustive: never = op
      void _exhaustive
      return 'repeat'
    }
  }
}
