//
//  UnitInput.Model.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the unit field. The view binds through `UnitInputFieldModel`; no networking
//  lives in the view. The web `UnitInput` is a controlled field: the parent feeds it the canonical
//  `value` and receives `onChange(next)`; the component keeps a local text buffer that re-syncs to
//  the formatted display whenever the parent value / unit / settings change — UNLESS the field is
//  focused (so an external change never clobbers in-progress typing). The native model keeps the
//  same contract: a source emits the current snapshot plus the parent's loading / error /
//  connectivity state, the model derives the render phase + the canonical display, and the editing
//  buffer re-syncs only while the field is not being edited.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol UnitInputFieldTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogUnitInputFieldTelemetry: UnitInputFieldTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum UnitInputFieldConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (the web props + parent lifecycle)

/// One coalesced snapshot of the field's inputs — the web `value` / `unit` / `parseStrict` / `label`
/// props plus the resolved `useSettings()` slice and the parent's lifecycle (`isLoading`, an error
/// message, connectivity). `value` is the canonical metric storage; `nil` is the web blank value.
public struct UnitInputFieldInput: Sendable, Equatable {
    public var value: Double?
    public var kind: UnitInputFieldKind
    public var settings: UnitInputFieldSettings
    public var label: String
    public var parseStrict: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: UnitInputFieldConnection
    public var isRequired: Bool
    public var isDisabled: Bool

    public init(
        value: Double? = nil,
        kind: UnitInputFieldKind = .distance,
        settings: UnitInputFieldSettings = UnitInputFieldSettings(),
        label: String = "",
        parseStrict: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: UnitInputFieldConnection = .live,
        isRequired: Bool = false,
        isDisabled: Bool = false
    ) {
        self.value = value
        self.kind = kind
        self.settings = settings
        self.label = label
        self.parseStrict = parseStrict
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
        self.isRequired = isRequired
        self.isDisabled = isDisabled
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the `ready` phase the
/// canonical display string, trailing symbol, field label, and field flags are carried so the view
/// is a pure function of this value. The editing buffer lives on the model (it changes on every
/// keystroke), not here.
public struct UnitInputFieldResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case ready
        case error(String)
    }

    public let phase: Phase
    /// The display-unit symbol shown as the trailing adornment (web `suffix`).
    public let symbol: String
    /// The field label forwarded as the visible label + accessibility label (web `label`).
    public let label: String
    /// The canonical formatted value (web `formatForUnit`), `""` when the value is empty.
    public let canonicalDisplay: String
    /// `true` when the bound value is `nil` (the web blank field) — drives the "not set" hint.
    public let isEmptyValue: Bool
    public let isRequired: Bool
    public let isDisabled: Bool

    public init(
        phase: Phase,
        symbol: String = "",
        label: String = "",
        canonicalDisplay: String = "",
        isEmptyValue: Bool = true,
        isRequired: Bool = false,
        isDisabled: Bool = false
    ) {
        self.phase = phase
        self.symbol = symbol
        self.label = label
        self.canonicalDisplay = canonicalDisplay
        self.isEmptyValue = isEmptyValue
        self.isRequired = isRequired
        self.isDisabled = isDisabled
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. A non-empty error message
/// surfaces as `error` (web `QueryError` peer), an in-flight parent fetch as `loading`, otherwise the
/// editable `ready` field — which always renders (empty OR populated), never a hidden box. The
/// canonical display + symbol are computed here so the view holds no formatting logic. Unit tested
/// across loading / ready-empty / ready-populated / error.
public enum UnitInputFieldProjection {
    public static func resolve(_ input: UnitInputFieldInput) -> UnitInputFieldResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return UnitInputFieldResolved(phase: .error(message))
        }
        if input.isLoading {
            return UnitInputFieldResolved(phase: .loading)
        }
        let symbol = UnitInputFieldConverter.symbol(kind: input.kind, settings: input.settings)
        let display = UnitInputFieldConverter.format(
            value: input.value,
            kind: input.kind,
            settings: input.settings
        )
        return UnitInputFieldResolved(
            phase: .ready,
            symbol: symbol,
            label: input.label,
            canonicalDisplay: display,
            isEmptyValue: input.value == nil,
            isRequired: input.isRequired,
            isDisabled: input.isDisabled
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `UnitInputFieldSource`, recomputes the
/// resolved projection, exposes the render `phase` + the canonical display + the live editing buffer
/// + the `connection` axis, commits parsed edits back through the source (the web `onChange`), and
/// auto-refreshes once when the feed transitions to stale. The editing buffer re-syncs to the
/// canonical display only while the field is NOT being edited (the web focus guard).
@MainActor
@Observable
public final class UnitInputFieldModel {
    public private(set) var resolved: UnitInputFieldResolved = .init(phase: .loading)
    public private(set) var connection: UnitInputFieldConnection = .live

    /// The live text buffer the field binds to (the web local `text` state). Mutated on every
    /// keystroke by the view; re-synced to the canonical display on external change when idle.
    public var editingText: String = ""

    public var phase: UnitInputFieldResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private var current = UnitInputFieldInput()
    @ObservationIgnored private var isEditing = false
    @ObservationIgnored private let source: any UnitInputFieldSource
    @ObservationIgnored private let telemetry: any UnitInputFieldTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any UnitInputFieldSource,
        telemetry: any UnitInputFieldTelemetry = OSLogUnitInputFieldTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: UnitInputFieldMeta.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Marks the field as focused (web `onFocus`): from now on external value / unit / settings
    /// changes no longer clobber the in-progress text.
    public func beginEditing() {
        isEditing = true
    }

    /// Commits the current buffer on blur (web `onBlur`): parse → write the canonical value back
    /// through the source → renormalise the visible text to the canonical-rounded form → end editing.
    public func commitEditing() {
        commitBuffer()
        isEditing = false
    }

    /// Commits on Enter (web `onKeyDown` Enter) WITHOUT ending the editing session — the field keeps
    /// focus, so the buffer is renormalised but external changes still won't clobber it.
    public func submit() {
        commitBuffer()
    }

    // MARK: Private

    private func commitBuffer() {
        let parsed = UnitInputFieldConverter.parse(
            text: editingText,
            kind: current.kind,
            settings: current.settings,
            strict: current.parseStrict
        )
        source.commit(parsed)
        editingText = UnitInputFieldConverter.format(
            value: parsed,
            kind: current.kind,
            settings: current.settings
        )
    }

    private func apply(_ input: UnitInputFieldInput) {
        current = input
        resolved = UnitInputFieldProjection.resolve(input)
        // Web focus guard: only re-sync the buffer when the user is not editing.
        if !isEditing {
            editingText = resolved.canonicalDisplay
        }
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "UnitInput" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum UnitInputFieldStrings {
    public static let table = "UnitInput"

    public static let string: UnitInputFieldResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
