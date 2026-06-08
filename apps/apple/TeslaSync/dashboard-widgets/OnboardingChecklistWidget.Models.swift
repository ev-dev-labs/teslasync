//
//  OnboardingChecklistWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  Domain value types ported from the web onboarding checklist
//  (features/onboarding/checklist.ts + features/dashboard/widgets/OnboardingChecklistWidget.tsx):
//  the per-task view row, the merged projection the surface renders, the cached
//  client-state inputs the adapter consumes, the coalesced source update, and the
//  load/connection status enums.
//

import Foundation

// MARK: - Task identity (web `ChecklistTask.id`)

/// The stable identifier for one checklist step — the verbatim web `id`, reused
/// for keys, analytics, and test selectors so both platforms agree.
public enum ChecklistTaskID: String, Sendable, CaseIterable {
    case connectVehicle = "connect-vehicle"
    case pickTheme = "pick-theme"
    case firstAlert = "first-alert"
    case notificationChannel = "notification-channel"
    case tryCommandPalette = "try-command-palette"
    case enablePush = "enable-push"
    case customizeDashboard = "customize-dashboard"
}

// MARK: - Task row (web `ChecklistTask`)

/// One rendered checklist row — a faithful port of the web `ChecklistTask`. The
/// `complete` flag is computed by `ChecklistBuilder` from the cached inputs; the
/// rest is static catalog metadata. Strings are carried as `(key, fallback)`
/// pairs so the view resolves them through the P1/S10 facade.
public struct ChecklistTaskView: Sendable, Equatable, Identifiable {
    public let id: ChecklistTaskID
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String
    public let ctaKey: String
    public let ctaFallback: String
    /// Where the CTA navigates. The sentinel `ChecklistRouting.commandPaletteCTA`
    /// opens the command palette instead of pushing a route (web `handleCta`).
    public let ctaTo: String
    /// SF Symbol for the row's leading icon box (web `task.icon`).
    public let systemImage: String
    /// Whether the underlying client state satisfies this step.
    public let complete: Bool

    public init(
        id: ChecklistTaskID,
        titleKey: String,
        titleFallback: String,
        descriptionKey: String,
        descriptionFallback: String,
        ctaKey: String,
        ctaFallback: String,
        ctaTo: String,
        systemImage: String,
        complete: Bool
    ) {
        self.id = id
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.ctaKey = ctaKey
        self.ctaFallback = ctaFallback
        self.ctaTo = ctaTo
        self.systemImage = systemImage
        self.complete = complete
    }
}

// MARK: - Projection (web `ChecklistState` view-relevant slice)

/// The merged, render-ready checklist the surface draws — the Swift analogue of
/// the parts of the web `ChecklistState` the widget reads (`visibleTasks`,
/// `completeCount`, `totalCount`, `allComplete`) plus the derived progress
/// percentage the header shows.
public struct ChecklistProjection: Sendable, Equatable {
    public var tasks: [ChecklistTaskView]
    public var completeCount: Int
    public var totalCount: Int
    public var allComplete: Bool
    /// Rounded completion percentage in `0...100` (web `progressPct`).
    public var progressPercent: Int

    public init(
        tasks: [ChecklistTaskView],
        completeCount: Int,
        totalCount: Int,
        allComplete: Bool,
        progressPercent: Int
    ) {
        self.tasks = tasks
        self.completeCount = completeCount
        self.totalCount = totalCount
        self.allComplete = allComplete
        self.progressPercent = progressPercent
    }

    /// The empty projection (no steps) — the web `totalCount === 0` branch.
    public static let empty = ChecklistProjection(
        tasks: [],
        completeCount: 0,
        totalCount: 0,
        allComplete: false,
        progressPercent: 0
    )
}

// MARK: - Cached inputs (web `useChecklistTasks` dependencies)

/// The cached client-state the adapter folds into a `ChecklistProjection`. Each
/// field mirrors one dependency of the web `useChecklistTasks` hook — counts from
/// the vehicle / alert-rule / channel stores, the active theme id, and the
/// localStorage discovery / dismissal flags. The production source projects these
/// from the shared P1/S8 state holders; previews and tests build them by hand.
public struct ChecklistInputs: Sendable, Equatable {
    public var vehicleCount: Int
    public var alertRuleCount: Int
    public var channelCount: Int
    public var themeID: String?
    public var commandPaletteDiscovered: Bool
    public var pushGranted: Bool
    public var customizeDashboardCompleted: Bool
    /// The user explicitly dismissed the checklist (web `CHECKLIST_DISMISSED_KEY`).
    public var dismissed: Bool
    /// When the checklist first reached 100 % (web `CHECKLIST_COMPLETED_AT_KEY`).
    public var completedAt: Date?

    public init(
        vehicleCount: Int = 0,
        alertRuleCount: Int = 0,
        channelCount: Int = 0,
        themeID: String? = nil,
        commandPaletteDiscovered: Bool = false,
        pushGranted: Bool = false,
        customizeDashboardCompleted: Bool = false,
        dismissed: Bool = false,
        completedAt: Date? = nil
    ) {
        self.vehicleCount = vehicleCount
        self.alertRuleCount = alertRuleCount
        self.channelCount = channelCount
        self.themeID = themeID
        self.commandPaletteDiscovered = commandPaletteDiscovered
        self.pushGranted = pushGranted
        self.customizeDashboardCompleted = customizeDashboardCompleted
        self.dismissed = dismissed
        self.completedAt = completedAt
    }
}

// MARK: - Source update lifecycle

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the underlying stores.
public enum ChecklistLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ChecklistConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot a `OnboardingChecklistSource` pushes: the cached inputs
/// plus their load/connection status. The model turns this into a projection and
/// a render phase.
public struct ChecklistUpdate: Sendable, Equatable {
    public var status: ChecklistLoadStatus
    public var connection: ChecklistConnection
    public var inputs: ChecklistInputs?
    public var updatedAt: Date?

    public init(
        status: ChecklistLoadStatus = .loading,
        connection: ChecklistConnection = .live,
        inputs: ChecklistInputs? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.inputs = inputs
        self.updatedAt = updatedAt
    }
}
