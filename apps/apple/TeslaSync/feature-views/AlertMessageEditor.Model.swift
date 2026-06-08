//
//  AlertMessageEditor.Model.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  per-rule notification message-template editor. The view binds through `AlertMessageEditorModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/notifications/components/AlertMessageEditor.tsx.
//
//  The web component is controlled by its parent (`msgTemplate` / `includeTitle` / `draft` +
//  `onTemplateChange` / `onIncludeTitleChange`) and owns the ephemeral editor UI (autocomplete
//  popover, preset modal, debounced preview). The native model owns that whole lifecycle: it forwards
//  the parent callbacks, drives the `{{`-trigger autocomplete, gates the preset gallery on op
//  validity, debounces the live preview, resolves each area's render phase + freshness, and emits
//  `view.opened` once. The three helper catalogs flow in through the bound `AlertMessageEditorSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated + redacted there.
public protocol AlertMessageEditorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAlertMessageEditorTelemetry: AlertMessageEditorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AlertMessageEditor" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum AlertMessageEditorStrings {
    public static let table = "AlertMessageEditor"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// A `(key, fallback) -> String` localizer for the SwiftUI-free projector + a11y summaries.
    public static func localize(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }

    /// The projector's injected, pre-localized VoiceOver role words.
    public static func copy() -> AlertMessageEditorCopy {
        AlertMessageEditorCopy(
            tokenRole: string("alertEditor.a11y.tokenRole", "Suggestion"),
            presetRole: string("alertEditor.a11y.presetRole", "Message preset")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `AlertMessageEditorSource`: the three helper catalogs + their
/// load status, the rendered preview + its status, the live-state connection, the in-flight flag,
/// and the last-update timestamp.
public struct AlertMessageEditorUpdate: Sendable, Equatable {
    public var tokensStatus: AlertMessageLoadStatus
    public var tokens: [AlertMessageTokenDTO]
    public var presetsStatus: AlertMessageLoadStatus
    public var presets: [AlertMessagePresetDTO]
    public var previewStatus: AlertMessageLoadStatus
    public var preview: AlertMessagePreviewResultDTO?
    public var connection: AlertMessageConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        tokensStatus: AlertMessageLoadStatus = .idle,
        tokens: [AlertMessageTokenDTO] = [],
        presetsStatus: AlertMessageLoadStatus = .idle,
        presets: [AlertMessagePresetDTO] = [],
        previewStatus: AlertMessageLoadStatus = .idle,
        preview: AlertMessagePreviewResultDTO? = nil,
        connection: AlertMessageConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.tokensStatus = tokensStatus
        self.tokens = tokens
        self.presetsStatus = presetsStatus
        self.presets = presets
        self.previewStatus = previewStatus
        self.preview = preview
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// wiring `loadTokens` / `loadPresets` / `renderPreview` to the message-helper queries the web reads.
/// Previews + tests use `InMemoryAlertMessageEditorSource`. The view never talks to the network.
@MainActor
public protocol AlertMessageEditorSource: AnyObject {
    var onUpdate: (@MainActor (AlertMessageEditorUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Loads the autocomplete catalog for the rule shape (web token-catalog query).
    func loadTokens(kind: AlertRuleKind?, signalName: String?, op: AlertRuleOp?, metricID: String?)
    /// Loads the preset gallery for the rule kind (web preset-gallery query).
    func loadPresets(kind: AlertRuleKind?)
    /// Renders a single preview for the draft (web preview mutation; the model debounces it).
    func renderPreview(_ request: AlertMessagePreviewRequestDTO)
    /// Re-runs the current catalog loads (error-state retry / stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Owns the controlled template / include-title / draft, the
/// ephemeral autocomplete + preset-modal UI, and the resolved render phases + freshness for every
/// area. Forwards the parent `onTemplateChange` / `onIncludeTitleChange`, debounces the live preview,
/// and emits the `view.opened` diagnostics event once.
@MainActor
@Observable
public final class AlertMessageEditorModel {
    // Controlled inputs (web props).
    public internal(set) var template: String
    public internal(set) var includeTitle: Bool
    public internal(set) var draft: AlertMessageDraft
    public let disabled: Bool
    public let labelOverride: String?
    public let helpOverride: String?

    // Ephemeral autocomplete UI (web autocomplete state).
    public internal(set) var isAutocompleteOpen = false
    public internal(set) var autocompleteCursor = 0
    public internal(set) var tokenProjection: TokenSuggestionProjection = .empty
    public internal(set) var tokenPhase: TokenSuggestionsPhase = .hidden

    // Ephemeral preset gallery UI (web preset modal state).
    public internal(set) var isPresetModalOpen = false
    public internal(set) var activeTag: String?
    public internal(set) var galleryProjection: PresetGalleryProjection = .empty
    public internal(set) var presetPhase: PresetGalleryPhase = .loading

    // Live preview + freshness (web preview + ADR-013).
    public internal(set) var preview: AlertMessagePreviewResultDTO?
    public internal(set) var previewPhase: PreviewPhase = .empty
    public internal(set) var connection: AlertMessageConnection = .live
    public internal(set) var refreshing = false
    public internal(set) var updatedAt: Date?

    /// A monotonic version the view observes to apply a requested caret to its `TextSelection`.
    public internal(set) var caretRequestVersion = 0
    /// The caret offset to restore after a token insert / preset apply (web `setSelectionRange`).
    public internal(set) var caretRequest: Int?

    @ObservationIgnored let source: any AlertMessageEditorSource
    @ObservationIgnored let copy: AlertMessageEditorCopy
    @ObservationIgnored let onTemplateChange: @MainActor (String) -> Void
    @ObservationIgnored let onIncludeTitleChange: @MainActor (Bool) -> Void
    @ObservationIgnored let previewDebounce: TimeInterval
    @ObservationIgnored private let telemetry: any AlertMessageEditorTelemetry

    @ObservationIgnored var caret = 0
    @ObservationIgnored var triggerIndex: Int?
    @ObservationIgnored var autocompleteFilter = ""
    @ObservationIgnored var latestTokens: [AlertMessageTokenDTO] = []
    @ObservationIgnored var latestTokensStatus: AlertMessageLoadStatus = .idle
    @ObservationIgnored var latestPresets: [AlertMessagePresetDTO] = []
    @ObservationIgnored var latestPresetsStatus: AlertMessageLoadStatus = .idle
    @ObservationIgnored var latestPreviewStatus: AlertMessageLoadStatus = .idle
    @ObservationIgnored var previewTask: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AlertMessageEditorSource,
        template: String = "",
        includeTitle: Bool = true,
        draft: AlertMessageDraft = AlertMessageDraft(),
        disabled: Bool = false,
        labelOverride: String? = nil,
        helpOverride: String? = nil,
        telemetry: any AlertMessageEditorTelemetry = OSLogAlertMessageEditorTelemetry(),
        copy: AlertMessageEditorCopy = AlertMessageEditorStrings.copy(),
        previewDebounce: TimeInterval = AlertMessageEditorConfig.previewDebounceInterval,
        onTemplateChange: @escaping @MainActor (String) -> Void = { _ in },
        onIncludeTitleChange: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
        self.source = source
        self.template = template
        self.includeTitle = includeTitle
        self.draft = draft
        self.disabled = disabled
        self.labelOverride = labelOverride
        self.helpOverride = helpOverride
        self.telemetry = telemetry
        self.copy = copy
        self.previewDebounce = previewDebounce
        self.onTemplateChange = onTemplateChange
        self.onIncludeTitleChange = onIncludeTitleChange
        caret = template.count
        source.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// Begins observing, loads the catalogs, schedules the first preview, and emits `view.opened`.
    /// Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AlertMessageEditorSurface.slug)
        source.start()
        reloadCatalogs()
        schedulePreview()
    }

    /// Stops observing and cancels the pending debounced preview.
    public func stop() {
        started = false
        previewTask?.cancel()
        previewTask = nil
        source.stop()
    }

    /// Loads the token + preset catalogs for the current draft (web query keys). Tokens honour the
    /// web `enabled: !disabled`.
    func reloadCatalogs() {
        if !disabled {
            source.loadTokens(
                kind: draft.kind,
                signalName: draft.signalName,
                op: draft.op,
                metricID: draft.metricID
            )
        }
        source.loadPresets(kind: draft.kind)
    }

    private func apply(_ update: AlertMessageEditorUpdate) {
        latestTokens = update.tokens
        latestTokensStatus = update.tokensStatus
        latestPresets = update.presets
        latestPresetsStatus = update.presetsStatus
        latestPreviewStatus = update.previewStatus
        if let preview = update.preview { self.preview = preview }
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached catalogs without
    /// refetching.
    private func handleAutoRefresh(for connection: AlertMessageConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional snapshot on `start()`, records the
/// requested loads/previews/refreshes, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAlertMessageEditorSource: AlertMessageEditorSource {
    public var onUpdate: (@MainActor (AlertMessageEditorUpdate) -> Void)?
    public internal(set) var startCount = 0
    public internal(set) var stopCount = 0
    public internal(set) var refreshCount = 0
    public internal(set) var tokenLoads: [String] = []
    public internal(set) var presetLoads: [String] = []
    public internal(set) var previewRequests: [AlertMessagePreviewRequestDTO] = []

    private let initial: AlertMessageEditorUpdate?

    public init(initial: AlertMessageEditorUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func loadTokens(kind: AlertRuleKind?, signalName: String?, op: AlertRuleOp?, metricID: String?) {
        tokenLoads
            .append([kind?.rawValue ?? "", signalName ?? "", op?.rawValue ?? "", metricID ?? ""].joined(separator: "|"))
    }

    public func loadPresets(kind: AlertRuleKind?) {
        presetLoads.append(kind?.rawValue ?? "")
    }

    public func renderPreview(_ request: AlertMessagePreviewRequestDTO) {
        previewRequests.append(request)
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: AlertMessageEditorUpdate) {
        onUpdate?(update)
    }
}
