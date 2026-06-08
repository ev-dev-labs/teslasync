//
//  OnboardingChecklistWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  Pure adapter — the unit-tested cached→projection core. A faithful Swift port of
//  the web `useChecklistTasks` task table and `shouldHideChecklist`
//  (features/onboarding/checklist.ts). No SwiftUI / transport here.
//

import Foundation

// MARK: - Routing constants (web `COMMAND_PALETTE_CTA` + route targets)

/// Navigation sentinels + targets shared by the catalog and the view's CTA
/// handler, mirroring the web checklist routing.
public enum ChecklistRouting {
    /// Sentinel `ctaTo` the view intercepts to toggle the command palette instead
    /// of pushing a route (web `COMMAND_PALETTE_CTA`).
    public static let commandPaletteCTA = "#open-command-palette"

    public static let connectVehicle = "/tesla-account"
    public static let appearance = "/settings#appearance"
    public static let alertRules = "/notifications/alerts"
    public static let channels = "/notifications/channels"
    public static let browserPush = "/notifications/browser"
    public static let dashboard = "/dashboard"
}

// MARK: - Adapter (faithful port of useChecklistTasks + shouldHideChecklist)

/// Pure functions that fold cached client-state (`ChecklistInputs`) into a
/// `ChecklistProjection` and decide whether the surface should hide itself.
/// Mirrors the web `features/onboarding/checklist.ts` exactly so both platforms
/// agree on the projection. This is the unit-tested core — no SwiftUI here.
public enum ChecklistBuilder {
    /// The default theme id — selecting any other theme counts as "picked a
    /// theme" (web `DEFAULT_THEME_ID`).
    public static let defaultThemeID = "neon-cyan"

    /// How long the celebratory "all set" state stays visible after 100 %
    /// (web `CELEBRATION_WINDOW_MS`, 24h).
    public static let celebrationWindow: TimeInterval = 24 * 60 * 60

    /// Builds the live projection from cached inputs (web `useChecklistTasks`).
    /// Every task is always visible — `show()` predicates would gate here — so
    /// `visibleTasks == tasks` and the counts reflect the full catalog.
    public static func buildProjection(from inputs: ChecklistInputs) -> ChecklistProjection {
        let tasks = catalog(for: inputs)
        let totalCount = tasks.count
        let completeCount = tasks.lazy.filter(\.complete).count
        let allComplete = totalCount > 0 && completeCount == totalCount
        let progressPercent = percent(complete: completeCount, total: totalCount)
        return ChecklistProjection(
            tasks: tasks,
            completeCount: completeCount,
            totalCount: totalCount,
            allComplete: allComplete,
            progressPercent: progressPercent
        )
    }

    /// Whether the widget should hide its checklist chrome entirely — the user
    /// dismissed it, or finished it long enough ago that the celebration window
    /// has elapsed (web `shouldHideChecklist`).
    public static func shouldHide(
        dismissed: Bool,
        allComplete: Bool,
        completedAt: Date?,
        now: Date = Date()
    ) -> Bool {
        if dismissed { return true }
        if allComplete, let completedAt {
            return now.timeIntervalSince(completedAt) > celebrationWindow
        }
        return false
    }

    /// The rounded completion percentage in `0...100` (web `progressPct`).
    public static func percent(complete: Int, total: Int) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(complete) / Double(total) * 100).rounded())
    }

    // MARK: Catalog (verbatim port of the web task table)

    /// The fixed seven-step catalog, in the web's order, with `complete`
    /// computed from the cached inputs by each spec's predicate.
    public static func catalog(for inputs: ChecklistInputs) -> [ChecklistTaskView] {
        checklistTaskSpecs.map { spec in
            ChecklistTaskView(
                id: spec.id,
                titleKey: spec.titleKey,
                titleFallback: spec.titleFallback,
                descriptionKey: spec.descriptionKey,
                descriptionFallback: spec.descriptionFallback,
                ctaKey: spec.ctaKey,
                ctaFallback: spec.ctaFallback,
                ctaTo: spec.ctaTo,
                systemImage: spec.systemImage,
                complete: spec.isComplete(inputs)
            )
        }
    }
}

// MARK: - Task specification (static metadata + completion predicate)

/// The static metadata for one catalog step plus its completion predicate. Keys
/// and English fallbacks are copied verbatim from
/// `features/onboarding/checklist.ts`; `isComplete` mirrors each task's web rule.
private struct ChecklistTaskSpec {
    let id: ChecklistTaskID
    let titleKey: String
    let titleFallback: String
    let descriptionKey: String
    let descriptionFallback: String
    let ctaKey: String
    let ctaFallback: String
    let ctaTo: String
    let systemImage: String
    let isComplete: @Sendable (ChecklistInputs) -> Bool
}

/// The canonical seven-step table, in the web's order.
private let checklistTaskSpecs: [ChecklistTaskSpec] = [
    ChecklistTaskSpec(
        id: .connectVehicle,
        titleKey: "checklist.tasks.connectVehicle.title",
        titleFallback: "Connect your Tesla",
        descriptionKey: "checklist.tasks.connectVehicle.description",
        descriptionFallback: "Link your Tesla account to start syncing data.",
        ctaKey: "checklist.tasks.connectVehicle.cta",
        ctaFallback: "Connect",
        ctaTo: ChecklistRouting.connectVehicle,
        systemImage: "car.fill",
        isComplete: { $0.vehicleCount > 0 }
    ),
    ChecklistTaskSpec(
        id: .pickTheme,
        titleKey: "checklist.tasks.pickTheme.title",
        titleFallback: "Pick a theme",
        descriptionKey: "checklist.tasks.pickTheme.description",
        descriptionFallback: "Choose an accent color that fits your style.",
        ctaKey: "checklist.tasks.pickTheme.cta",
        ctaFallback: "Open",
        ctaTo: ChecklistRouting.appearance,
        systemImage: "paintpalette.fill",
        isComplete: { ($0.themeID ?? ChecklistBuilder.defaultThemeID) != ChecklistBuilder.defaultThemeID }
    ),
    ChecklistTaskSpec(
        id: .firstAlert,
        titleKey: "checklist.tasks.firstAlert.title",
        titleFallback: "Create your first alert rule",
        descriptionKey: "checklist.tasks.firstAlert.description",
        descriptionFallback: "Get notified when something changes — battery low, charge complete, etc.",
        ctaKey: "checklist.tasks.firstAlert.cta",
        ctaFallback: "Create",
        ctaTo: ChecklistRouting.alertRules,
        systemImage: "bell.badge.fill",
        isComplete: { $0.alertRuleCount > 0 }
    ),
    ChecklistTaskSpec(
        id: .notificationChannel,
        titleKey: "checklist.tasks.notify.title",
        titleFallback: "Add a notification channel",
        descriptionKey: "checklist.tasks.notify.description",
        descriptionFallback: "Without a channel (Discord, ntfy, email, …) your alerts go to /dev/null.",
        ctaKey: "checklist.tasks.notify.cta",
        ctaFallback: "Configure",
        ctaTo: ChecklistRouting.channels,
        systemImage: "paperplane.fill",
        isComplete: { $0.channelCount > 0 }
    ),
    ChecklistTaskSpec(
        id: .tryCommandPalette,
        titleKey: "checklist.tasks.commandPalette.title",
        titleFallback: "Try the command palette",
        descriptionKey: "checklist.tasks.commandPalette.description",
        descriptionFallback: "Press Ctrl+K (or ⌘K) to jump anywhere instantly.",
        ctaKey: "checklist.tasks.commandPalette.cta",
        ctaFallback: "Open",
        ctaTo: ChecklistRouting.commandPaletteCTA,
        systemImage: "command",
        isComplete: { $0.commandPaletteDiscovered }
    ),
    ChecklistTaskSpec(
        id: .enablePush,
        titleKey: "checklist.tasks.enablePush.title",
        titleFallback: "Enable web push notifications",
        descriptionKey: "checklist.tasks.enablePush.description",
        descriptionFallback: "Get alerts in your browser even when TeslaSync is closed.",
        ctaKey: "checklist.tasks.enablePush.cta",
        ctaFallback: "Enable",
        ctaTo: ChecklistRouting.browserPush,
        systemImage: "app.badge.fill",
        isComplete: { $0.pushGranted }
    ),
    ChecklistTaskSpec(
        id: .customizeDashboard,
        titleKey: "checklist.tasks.customizeDashboard.title",
        titleFallback: "Customize your dashboard",
        descriptionKey: "checklist.tasks.customizeDashboard.description",
        descriptionFallback: "Add widgets that match how you use TeslaSync.",
        ctaKey: "checklist.tasks.customizeDashboard.cta",
        ctaFallback: "Open",
        ctaTo: ChecklistRouting.dashboard,
        systemImage: "square.grid.2x2.fill",
        isComplete: { $0.customizeDashboardCompleted }
    )
]
