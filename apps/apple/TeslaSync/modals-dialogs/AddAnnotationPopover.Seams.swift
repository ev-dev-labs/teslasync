//
//  AddAnnotationPopover.Seams.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The dependency seams the AddAnnotationPopover view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the submit/cancel control seam (web
//  `onAdd` / `onCancel`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory
//  source for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver
//  string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol AddAnnotationTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAddAnnotationTelemetry: AddAnnotationTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Submit/cancel control seam (web `onAdd` / `onCancel`)

/// The dialog's command seam. `submit` is the web `onAdd(label, category, description?, occurredAt)`
/// (the chart host appends the annotation + closes the popover); `cancel` is the web `onCancel`.
/// Keeps the annotation store out of the view; the production app injects an adapter that drives the
/// real `useChartAnnotations` mutation, previews/tests use the logging / spy defaults.
public protocol AddAnnotationController: Sendable {
    func submit(draft: AddAnnotationDraft)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without mutating a store, so previews run
/// safely.
public struct OSLogAddAnnotationController: AddAnnotationController {
    private let logger: Logger
    private let surface = AddAnnotationSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "annotations")
    }

    public func submit(draft: AddAnnotationDraft) {
        let category = draft.category.rawValue
        logger.info("annotation.add category=\(category, privacy: .public) surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("annotation.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `AddAnnotationSource`: the load status, the resolved draft
/// context (the target timestamp + editable flag), the live-state freshness, and the in-flight flag.
public struct AddAnnotationUpdate: Sendable, Equatable {
    public var status: AddAnnotationLoadStatus
    public var context: AddAnnotationDraftContext?
    public var connection: AddAnnotationConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AddAnnotationLoadStatus = .loading,
        context: AddAnnotationDraftContext? = nil,
        connection: AddAnnotationConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.context = context
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// resolving the draft context (the chart-anchored timestamp + whether the date is editable) and the
/// live-state freshness, plus a refresh affordance. Previews/tests use `InMemoryAddAnnotationSource`.
/// The view never reads persistence directly.
@MainActor
public protocol AddAnnotationSource: AnyObject {
    var onUpdate: (@MainActor (AddAnnotationUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the draft context + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAddAnnotationSource: AddAnnotationSource {
    public var onUpdate: (@MainActor (AddAnnotationUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AddAnnotationUpdate?

    public init(initial: AddAnnotationUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: AddAnnotationUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AddAnnotationPopover" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum AddAnnotationStrings {
    public static let table = "AddAnnotationPopover"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum AddAnnotationAccessibility {
    /// The dialog summary: the modal title (web `aria-labelledby` heading).
    public static func summary(localize: (String, String) -> String) -> String {
        localize("annotation.addTitle", "Add Annotation")
    }

    /// One category pill's VoiceOver label, with the selected state appended so the pill reads its
    /// status (web pill `aria-pressed`).
    public static func categoryLabel(
        _ option: AddAnnotationCategoryOption,
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        let name = localize(option.labelKey, option.labelFallback)
        guard selected else { return name }
        let selectedWord = localize("addAnnotation.selected", "selected")
        return "\(name), \(selectedWord)"
    }

    /// The read-only timestamp's VoiceOver label (web fixed-date text), substituting the formatted
    /// day into the template.
    public static func timestampLabel(_ day: String, localize: (String, String) -> String) -> String {
        let template = localize("addAnnotation.timestampAria", "Annotating {{0}}")
        return template.replacingOccurrences(of: "{{0}}", with: day)
    }
}
