//
//  AlertRulesDataSource.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack hook
//  name so the call sites in `AlertRulesPageModel` read like the React page:
//  `useAlertRules` → GET /alerts/rules, `useBulkEnableRules` → POST
//  /alerts/rules/bulk/enable, `useBulkDisableRules` → POST /alerts/rules/bulk/disable,
//  `useDeleteAlertRule` → DELETE /alerts/rules/{id}, `useSaveAlertRule` →
//  PUT /alerts/rules/{id} (rename) / POST /alerts/rules (create). Today the bodies
//  resolve from a deterministic in-memory fixture; when the generated client lands
//  (P1/S2-S3) only this file changes — the view + model never touch the network.
//

import Foundation

// MARK: - Data source contract (hook-named, web parity at the call site)

/// The Alert Rules data seam. Method names mirror the web hooks verbatim so the
/// model's call sites match `AlertRulesPage.tsx`.
protocol AlertRulesDataSource: Sendable {
    /// `useAlertRules` → GET /alerts/rules.
    func useAlertRules() async throws -> [AlertRule]

    /// `useBulkEnableRules` → POST /alerts/rules/bulk/enable `{ ids }`.
    func useBulkEnableRules(ids: [Int64]) async throws

    /// `useBulkDisableRules` → POST /alerts/rules/bulk/disable `{ ids }`.
    func useBulkDisableRules(ids: [Int64]) async throws

    /// `useDeleteAlertRule` → DELETE /alerts/rules/{id}.
    func useDeleteAlertRule(id: Int64) async throws

    /// `useSaveAlertRule` → PUT /alerts/rules/{id} (rename here) / POST /alerts/rules.
    func useSaveAlertRule(id: Int64, name: String) async throws
}

// MARK: - Errors (web query failure surface)

/// Failures surfaced by the seam (web query / mutation `onError`). Drives the
/// page's reachable error arm.
enum AlertRulesError: LocalizedError {
    case loadFailed

    var errorDescription: String? {
        ARStrings.text("alertRules.loadError", "Failed to load alert rules")
    }
}

// MARK: - Sample source (deterministic fixture; replaced by the live client)

/// A representative local seed used as the page / preview default until the
/// KMP-backed source is injected at composition time. It is API-response-shaped
/// (a mix of severities + enabled/disabled rules) so the table, severity badges,
/// status badges, and bulk affordances all render their populated success state
/// out of the box. It is an `actor` because the bulk / delete / rename mutations
/// persist between the model's optimistic refetches (web mutation → invalidate →
/// refetch), exactly like the server would.
actor SampleAlertRulesDataSource: AlertRulesDataSource {
    private var rules: [AlertRule]

    init(rules: [AlertRule]? = nil) {
        self.rules = rules ?? Self.seed
    }

    func useAlertRules() async throws -> [AlertRule] {
        rules
    }

    func useBulkEnableRules(ids: [Int64]) async throws {
        setEnabled(ids: Set(ids), to: true)
    }

    func useBulkDisableRules(ids: [Int64]) async throws {
        setEnabled(ids: Set(ids), to: false)
    }

    func useDeleteAlertRule(id: Int64) async throws {
        rules.removeAll { $0.id == id }
    }

    func useSaveAlertRule(id: Int64, name: String) async throws {
        guard let index = rules.firstIndex(where: { $0.id == id }) else { return }
        rules[index].name = name
    }

    private func setEnabled(ids: Set<Int64>, to enabled: Bool) {
        for index in rules.indices where ids.contains(rules[index].id) {
            rules[index].enabled = enabled
        }
    }

    private static let seed: [AlertRule] = [
        AlertRule(id: 1, name: "Low battery", signalName: "battery_level",
                  severity: .critical, enabled: true),
        AlertRule(id: 2, name: "Charging complete", signalName: "charging_state",
                  severity: .info, enabled: true),
        AlertRule(id: 3, name: "Cabin overheating", signalName: "inside_temp",
                  severity: .warn, enabled: true),
        AlertRule(id: 4, name: "Tire pressure low (front-left)", signalName: "tpms_pressure_fl",
                  severity: .warn, enabled: false),
        AlertRule(id: 5, name: "Sentry triggered", signalName: "sentry_mode",
                  severity: .critical, enabled: true),
        AlertRule(id: 6, name: "Speed over limit", signalName: "vehicle_speed",
                  severity: .info, enabled: false)
    ]
}

#if DEBUG
    /// Preview/test seam with no rules — drives the page's empty state.
    struct EmptyAlertRulesDataSource: AlertRulesDataSource {
        func useAlertRules() async throws -> [AlertRule] { [] }
        func useBulkEnableRules(ids _: [Int64]) async throws {}
        func useBulkDisableRules(ids _: [Int64]) async throws {}
        func useDeleteAlertRule(id _: Int64) async throws {}
        func useSaveAlertRule(id _: Int64, name _: String) async throws {}
    }

    /// Preview/test seam whose primary load fails — drives the error state.
    struct FailingAlertRulesDataSource: AlertRulesDataSource {
        func useAlertRules() async throws -> [AlertRule] {
            throw AlertRulesError.loadFailed
        }

        func useBulkEnableRules(ids _: [Int64]) async throws { throw AlertRulesError.loadFailed }
        func useBulkDisableRules(ids _: [Int64]) async throws { throw AlertRulesError.loadFailed }
        func useDeleteAlertRule(id _: Int64) async throws { throw AlertRulesError.loadFailed }
        func useSaveAlertRule(id _: Int64, name _: String) async throws { throw AlertRulesError.loadFailed }
    }
#endif
