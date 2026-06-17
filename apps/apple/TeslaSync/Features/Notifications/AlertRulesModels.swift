//
//  AlertRulesModels.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Domain models
//
//  SwiftUI / HIG parity of `web/src/features/notifications/pages/AlertRulesPage.tsx`
//  (web route `/notifications/rules`). The page's focused projection of the web
//  `AlertRule` type (`web/src/api/types.ts`): the streamlined "manage many at once"
//  list only needs id / name / signal / severity / enabled — the full CRUD shape
//  lives in Alert Studio. Severity reuses the module's canonical `AlertRuleSeverity`
//  (declared in `AlertMessageEditor.Models.swift`; web `'info' | 'warn' |
//  'critical'`); its view tone/icon mapping lives in `AlertRulesPage.Components`.
//

import Foundation

// MARK: - Alert rule (focused web `AlertRule` projection)

/// One alert rule row. The list view's projection of the web `AlertRule`
/// (`id`, `name`, `signal_name`, `severity`, `enabled`); the editor-only fields
/// (op, thresholds, cooldown, trigger mode, …) are intentionally omitted because
/// this surface only renames + bulk enable/disable/deletes.
struct AlertRule: Identifiable, Sendable, Equatable {
    let id: Int64
    var name: String
    let signalName: String
    let severity: AlertRuleSeverity
    var enabled: Bool
}
