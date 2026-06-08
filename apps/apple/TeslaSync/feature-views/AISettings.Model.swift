//
//  AISettings.Model.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Helix (AI) settings surface — the SwiftUI parity of
//  features/settings/components/AISettings.tsx. The view binds through
//  `AiSettingsModel`; no networking lives in the view. The web component is driven by
//  `useSettings` (current persisted state), `useSaveAiSettings` (the save mutation),
//  and `useAiUsageToday` (today's spend for the cost-cap bar); this model folds those
//  three feeds into one input snapshot plus a save seam.
//
//  States: the web surface is presentational over its hooks (mode defaults to `off`
//  while settings load). On top of that this surface honours the P4 leaf contract: a
//  `phase` (loading / empty / error / data) fed by the settings query, an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition, plus the save lifecycle
//  (idle / saving / saved / failed) that backs the web `saveAi.isPending` button.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol AiSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAiSettingsTelemetry: AiSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AiSettingsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Save lifecycle (web `saveAi` mutation status)

/// The save mutation lifecycle — the native mirror of the web `useMutation` status
/// that drives the button (`isPending` → "Saving…") and the post-save feedback.
public enum AiSavePhase: Sendable, Equatable {
    case idle
    case saving
    case saved
    case failed(String)

    /// Whether a save is in flight (web `saveAi.isPending`).
    public var isSaving: Bool {
        if case .saving = self { return true }
        return false
    }
}

/// The patch the save seam persists — the in-scope slice of the web `saveAi.mutate`
/// payload (`ai_mode`). The provider config + per-feature toggles are owned by the
/// out-of-scope child surfaces, so only the mode flips here.
public struct AiSettingsDraft: Sendable, Equatable {
    public var mode: AiMode

    public init(mode: AiMode) {
        self.mode = mode
    }
}

/// The result of a save attempt the seam reports back — the native mirror of the web
/// mutation settling to success or an error toast.
public enum AiSaveOutcome: Sendable, Equatable {
    case saved
    case failed(String)
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 AiSettings state holder (settings + usage feeds) and its save
/// mutation; previews and tests use `InMemoryAiSettingsSource`. The view never talks
/// to the network directly.
@MainActor
public protocol AiSettingsSource: AnyObject {
    var onUpdate: (@MainActor (AiSettingsInput) -> Void)? { get set }
    var onSaveOutcome: (@MainActor (AiSaveOutcome) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func save(_ draft: AiSettingsDraft)
}

// MARK: - View model

/// The surface's observable view-model. Subscribes to an `AiSettingsSource`, mirrors
/// the persisted mode into an editable `selectedMode` (the web `useState` draft),
/// exposes the render `phase`, the `connection` axis, the save lifecycle, and the
/// derived cost-cap readout, and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class AiSettingsModel {
    public private(set) var resolved: AiSettingsResolved =
        AiSettingsProjection.resolve(AiSettingsInput(isLoading: true))
    public private(set) var connection: AiSettingsConnection = .live
    public private(set) var savePhase: AiSavePhase = .idle

    /// The editable mode (web `const [mode, setMode] = useState(...)`). Hydrated from
    /// the persisted `savedMode` on the first resolved settings payload.
    public private(set) var selectedMode: AiMode = .off

    @ObservationIgnored private let source: any AiSettingsSource
    @ObservationIgnored private let telemetry: any AiSettingsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didHydrateSelection = false

    public init(
        source: any AiSettingsSource,
        telemetry: any AiSettingsTelemetry = OSLogAiSettingsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
        source.onSaveOutcome = { [weak self] outcome in self?.applySave(outcome) }
    }

    /// The current render phase (web render gate + P4 leaf contract).
    public var phase: AiSettingsResolved.Phase {
        resolved.phase
    }

    /// Whether the editable mode differs from the persisted one (web dirty form).
    public var isDirty: Bool {
        selectedMode != resolved.savedMode
    }

    /// The off-mode helper banner is shown only while `off` is selected (web
    /// `mode === 'off'` → `ai.settings.bannerOff`).
    public var showsOffBanner: Bool {
        selectedMode == .off
    }

    /// The cost-cap spend bar lives only in cloud mode with a non-zero cap (web
    /// `isCloud && provider.cost_cap_cents > 0`).
    public var showsCostCapBar: Bool {
        selectedMode == .cloud && resolved.costCapCents > 0
    }

    /// The derived cost-cap readout for the bar (today's spend vs cap).
    public var costCap: HelixCostCap {
        HelixCostCap.compute(todayMicroCents: resolved.todayMicroCents, capCents: resolved.costCapCents)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AISettings.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Selects a Helix mode (web `handleModeChange`). A no-op when unchanged; clears
    /// a prior failed-save banner so the user gets a clean retry.
    public func selectMode(_ mode: AiMode) {
        guard mode != selectedMode else { return }
        selectedMode = mode
        if case .failed = savePhase {
            savePhase = .idle
        }
    }

    /// Persists the selected mode (web `handleSave` → `saveAi.mutate`). Re-entrancy is
    /// guarded so a double-tap cannot fan out two requests.
    public func save() {
        guard !savePhase.isSaving else { return }
        savePhase = .saving
        source.save(AiSettingsDraft(mode: selectedMode))
    }

    private func apply(_ input: AiSettingsInput) {
        resolved = AiSettingsProjection.resolve(input)
        // Hydrate the editable mode from the first resolved settings payload so the
        // picker reflects the persisted value (web initial `useState`).
        if !didHydrateSelection, input.savedMode != nil {
            didHydrateSelection = true
            selectedMode = resolved.savedMode
        }
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func applySave(_ outcome: AiSaveOutcome) {
        switch outcome {
        case .saved:
            savePhase = .saved
        case let .failed(message):
            savePhase = .failed(message)
        }
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit/UI tests. Seed it with an initial input and
/// an optional canned save outcome, or drive it manually via `push(_:)` /
/// `pushSave(_:)` to script multi-step flows.
@MainActor
public final class InMemoryAiSettingsSource: AiSettingsSource {
    public var onUpdate: (@MainActor (AiSettingsInput) -> Void)?
    public var onSaveOutcome: (@MainActor (AiSaveOutcome) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var saveCount = 0
    public private(set) var lastSavedDraft: AiSettingsDraft?

    private let initial: AiSettingsInput?
    private let saveOutcome: AiSaveOutcome?

    public init(initial: AiSettingsInput? = nil, saveOutcome: AiSaveOutcome? = nil) {
        self.initial = initial
        self.saveOutcome = saveOutcome
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func save(_ draft: AiSettingsDraft) {
        saveCount += 1
        lastSavedDraft = draft
        if let saveOutcome { onSaveOutcome?(saveOutcome) }
    }

    /// Pushes a settings snapshot to the bound model (test/preview affordance).
    public func push(_ input: AiSettingsInput) {
        onUpdate?(input)
    }

    /// Pushes a save outcome to the bound model (test/preview affordance).
    public func pushSave(_ outcome: AiSaveOutcome) {
        onSaveOutcome?(outcome)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the cost-cap bar from already-localised parts, so
/// the spoken content is asserted without rendering the view.
public enum AiSettingsAccessibility {
    /// The cost-cap bar spoken value: "{spent} of {cap}, {percent}%".
    public static func costCapValue(spent: String, cap: String, percent: Int) -> String {
        "\(spent) / \(cap), \(percent)%"
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AISettings" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The web source keys
/// (`ai.settings.*`) are preserved verbatim so a shared catalog resolves identically
/// across web and native.
public enum AiSettingsStrings {
    public static let table = "AISettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
