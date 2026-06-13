//
//  TimeMachineBanner.Model.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the historical "viewing data as of …" banner. The view binds through
//  `TimeMachineBannerModel`; no URL / persistence logic lives in the view. The web component reads the
//  `?as_of=` URL state through `useAsOfDate` and toggles a local picker (also opened from the command
//  palette via a window event); the native model keeps the same contract: a source emits the current
//  as-of anchor (plus the parent's loading / error / connectivity state), the model derives the
//  resolved banner over it together with the local picker flag, and `submit` / `returnToLive` write
//  back through the source (web `setAsOf` / `clear`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TimeMachineBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTimeMachineBannerTelemetry: TimeMachineBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound historical snapshot — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip (the point-in-time read is current); `stale` shows it and
/// triggers a one-shot auto-refresh (re-read); `offline` keeps the last cached snapshot on screen.
public enum TimeMachineConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (as-of anchor + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the current as-of anchor (web `useAsOfDate.asOf`,
/// `nil` in live mode) plus the parent's lifecycle (`isLoading`, an error message, connectivity). The
/// local picker flag is held by the model, not the source, since it is view state the user toggles.
public struct TimeMachineInput: Sendable, Equatable {
    public var asOf: Date?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TimeMachineConnection

    public init(
        asOf: Date? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TimeMachineConnection = .live
    ) {
        self.asOf = asOf
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the active banner render: the effective anchor (web
/// `effective`) and whether it is historical (web `effective != null`, which drives the body copy and
/// the "Return to live" affordance). A pure value so the view is a function of it and projection tests
/// assert it directly.
public struct TimeMachineData: Sendable, Equatable {
    public let asOf: Date?
    public let isHistorical: Bool

    public init(asOf: Date?, isHistorical: Bool) {
        self.asOf = asOf
        self.isHistorical = isHistorical
    }
}

/// The resolved, view-ready state — `phase` selects the body; the `.data` phase carries the derived
/// banner payload, so the view is a pure function of this value.
public struct TimeMachineResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: TimeMachineData?

    public init(phase: Phase, data: TimeMachineData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot + the local picker flag to the resolved view-state — the
/// native port of the web banner's render logic: the parent lifecycle (`isLoading`), then the
/// `if (effective == null && !pickerOpen) return null` guard rendered as the calm live-mode card
/// (P4 leaf contract, never a blank box), then the active banner. A feed failure surfaces at the leaf
/// as `error`. Unit tested across every branch.
public enum TimeMachineProjection {
    public static func resolve(input: TimeMachineInput, pickerOpen: Bool) -> TimeMachineResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return TimeMachineResolved(phase: .error(message), data: nil)
        }
        if input.isLoading {
            return TimeMachineResolved(phase: .loading, data: nil)
        }
        let isHistorical = input.asOf != nil
        // Web `if (effective == null && !pickerOpen) return null` → live mode with the picker closed.
        if !isHistorical, !pickerOpen {
            return TimeMachineResolved(phase: .empty, data: nil)
        }
        return TimeMachineResolved(
            phase: .data,
            data: TimeMachineData(asOf: input.asOf, isHistorical: isHistorical)
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `TimeMachineBannerSource`, recomputes the
/// resolved projection over the latest input + the local picker flag, exposes a render `phase` + the
/// resolved view-state and the `connection` axis, emits the `view.opened` diagnostics event once,
/// writes the anchor back through the source (web `setAsOf` / `clear`), and auto-refreshes a single
/// time when the feed transitions to stale.
@MainActor
@Observable
public final class TimeMachineBannerModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the canonical source of truth, re-exposed by
    /// the `TimeMachineBanner` view so the pure core stays self-contained.
    public static let surfaceSlug = "TimeMachineBanner"

    public private(set) var resolved: TimeMachineResolved = .init(phase: .loading, data: nil)
    public private(set) var connection: TimeMachineConnection = .live
    /// Whether the inline date-time picker is open (web `pickerOpen` state). View state the user
    /// toggles, also opened from the command-palette affordance via `openPicker()`.
    public private(set) var pickerOpen: Bool

    public var phase: TimeMachineResolved.Phase {
        resolved.phase
    }

    /// The current as-of anchor (web `effective`), so the picker can seed its draft from it.
    public var currentAsOf: Date? {
        lastInput.asOf
    }

    @ObservationIgnored private var lastInput = TimeMachineInput()
    @ObservationIgnored private let source: any TimeMachineBannerSource
    @ObservationIgnored private let telemetry: any TimeMachineBannerTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TimeMachineBannerSource,
        telemetry: any TimeMachineBannerTelemetry = OSLogTimeMachineBannerTelemetry(),
        pickerOpen: Bool = false
    ) {
        self.source = source
        self.telemetry = telemetry
        self.pickerOpen = pickerOpen
        source.onUpdate = { [weak self] input in self?.apply(input) }
        recompute()
    }

    /// Begins observing the as-of feed and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot — a re-read (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Toggles the inline picker (web `setPickerOpen(prev => !prev)` on the "Pick a date" button).
    public func togglePicker() {
        pickerOpen.toggle()
        recompute()
    }

    /// Opens the inline picker — the native parity of the web `TIME_MACHINE_OPEN_PICKER_EVENT` the
    /// command palette dispatches, surfaced here as a tappable affordance on the live-mode card.
    public func openPicker() {
        pickerOpen = true
        recompute()
    }

    /// Closes the inline picker without changing the anchor (web "Cancel").
    public func closePicker() {
        pickerOpen = false
        recompute()
    }

    /// Applies a picked anchor (web `handleSubmit` → `setAsOf(iso)` + close). Refuses an anchor that
    /// does not round-trip through the RFC 3339 contract, mirroring the web refusing malformed values.
    public func submit(_ date: Date) {
        guard TimeMachineRfc3339.isValid(TimeMachineRfc3339.format(date)) else { return }
        pickerOpen = false
        source.setAsOf(date)
        recompute()
    }

    /// Returns to live state (web `handleReturnToLive` → `clear()` + close).
    public func returnToLive() {
        pickerOpen = false
        source.clear()
        recompute()
    }

    private func apply(_ input: TimeMachineInput) {
        lastInput = input
        let previous = connection
        connection = input.connection
        recompute()
        // Stale → one-shot auto-refresh on the transition (re-read the point-in-time snapshot).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = TimeMachineProjection.resolve(input: lastInput, pickerOpen: pickerOpen)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "TimeMachineBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum TimeMachineBannerStrings {
    public static let table = "TimeMachineBanner"

    public static let string: TimeMachineResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
