//
//  DataTableResizer.Model.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  column-resize handle. The web `<DataTableResizer>` is purely presentational: it takes its data as plain
//  props and reports widths back through callbacks, with no fetcher — so the native peer needs no data
//  state-holder. What the holder DOES own is the surface's interaction state (the `isDragging` flag, the
//  native peer of the web `useState(dragging)`, plus the captured drag-start width, the peer of the web
//  `startWidth` ref), the page-supplied `onResize` / `onResizeEnd` closures (kept here so the value types
//  stay closure-free + `Equatable`), the derived ``DataTableResizerProjection`` (an observed read), and the
//  single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders no copy of its own — it builds the label inline and exposes the width through
//  `aria-valuenow` — so the only localized strings resolved here are the native VoiceOver additions (the
//  resize label, the spoken width value, and the gesture hint); there are no web `t()` keys to mirror.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the views hold no hardcoded prose.
/// Keys live in the "DataTableResizer" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source is anonymous, so these are native VoiceOver additions only.
public enum DataTableResizerStrings {
    public static let table = "DataTableResizer"

    public static let string: DataTableResizerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The accessible label — the spoken peer of the web `aria-label={label ?? \`Resize column
    /// ${columnKey}\`}`. A caller override wins; otherwise the column key is interpolated.
    public static func label(columnKey: String, override: String?) -> String {
        DataTableResizerProjector.accessibilityLabel(
            columnKey: columnKey,
            override: override,
            template: string("table.resizer.label", "Resize column {{column}}")
        )
    }

    /// The spoken width value — the native peer of the web `aria-valuenow` ("{{width}} points").
    public static func value(width: Double) -> String {
        DataTableResizerProjector.accessibilityValue(
            width: width,
            template: string("table.resizer.value", "{{width}} points")
        )
    }

    /// The VoiceOver hint describing the interaction (native addition — the web relies on the implicit
    /// `role="separator"` window-splitter semantics that VoiceOver does not narrate on Apple).
    public static var hint: String {
        string("table.resizer.hint", "Drag, or use the arrow keys, to resize the column")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataTableResizerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataTableResizerTelemetry: DataTableResizerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DataTableResizerModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``DataTableResizerInput`` (the web props) and
/// the `isDragging` interaction flag (web `useState`), captures the drag-start width when a gesture begins
/// (web `startWidth` ref), derives the pure ``DataTableResizerProjection`` as an observed read, and routes
/// every resize through the page-supplied callbacks: a drag streams clamped widths to `onResize` and emits
/// the final width to `onResizeEnd` on release (web pointer-move / pointer-up); the keyboard / VoiceOver
/// steps emit BOTH `onResize` and `onResizeEnd` with the stepped width (web `ArrowLeft`/`ArrowRight` /
/// `Home` / `End`). It emits `view.opened` exactly once per instance. The web component has no fetcher, so
/// neither does this holder.
@MainActor
@Observable
public final class DataTableResizerModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the controlling page rebinds a fresh `width`.
    public private(set) var input: DataTableResizerInput

    /// Whether a pointer drag is in progress (web `dragging`). Observed so the handle paints the active
    /// tint while the user drags.
    public private(set) var isDragging = false

    /// Whether the handle currently holds keyboard focus — drives the focus tint (web
    /// `focus-visible:bg-cyan-400/60`). Set by the view's focus binding.
    public private(set) var isFocused = false

    /// Whether the pointer is hovering the handle — drives the hover tint (web `hover:bg-cyan-400/40`).
    /// Set by the view's hover callback.
    public private(set) var isHovering = false

    @ObservationIgnored private var onResize: (@MainActor (Double) -> Void)?
    @ObservationIgnored private var onResizeEnd: (@MainActor (Double) -> Void)?
    @ObservationIgnored private let telemetry: any DataTableResizerTelemetry
    @ObservationIgnored private var dragStartWidth: Double = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DataTableResizerInput,
        onResize: (@MainActor (Double) -> Void)? = nil,
        onResizeEnd: (@MainActor (Double) -> Void)? = nil,
        telemetry: any DataTableResizerTelemetry = OSLogDataTableResizerTelemetry()
    ) {
        self.input = input
        self.onResize = onResize
        self.onResizeEnd = onResizeEnd
        self.telemetry = telemetry
    }

    /// The resolved, view-ready handle (web render output) — a pure function of the props + the interaction
    /// flags.
    public var projection: DataTableResizerProjection {
        DataTableResizerProjector.resolve(
            input,
            isDragging: isDragging,
            isFocused: isFocused,
            isHovering: isHovering
        )
    }

    // MARK: Hover / focus tint (web `hover:` / `focus-visible:`)

    /// Records the hover state — the native peer of the web resizer `hover:` class toggling.
    public func setHovering(_ hovering: Bool) {
        isHovering = hovering
    }

    /// Records the focus state — the native peer of the web resizer `focus-visible:` class toggling.
    public func setFocused(_ focused: Bool) {
        isFocused = focused
    }

    // MARK: Pointer drag (web pointer-down / move / up)

    /// Streams a drag — the verbatim port of the web pointer-down + pointer-move: the first call captures
    /// the drag-start width (web `startWidth.current = width`) and raises the `dragging` flag (web
    /// `setDragging(true)`); every call clamps `startWidth + translation` and pushes it to `onResize` (web
    /// `onResize(clamp(startWidth.current + delta))`). `translation` is the pointer movement since the
    /// gesture began.
    public func dragChanged(translation: Double) {
        if !isDragging {
            isDragging = true
            dragStartWidth = input.width
        }
        let next = DataTableResizerProjector.resizing(
            startWidth: dragStartWidth,
            translation: translation,
            minWidth: input.minWidth,
            maxWidth: input.maxWidth
        )
        onResize?(next)
    }

    /// Ends a drag — the verbatim port of the web `finishDrag`: clear the `dragging` flag (web
    /// `setDragging(false)`) and emit the final width to `onResizeEnd` (web `onResizeEnd?.(width)`, the
    /// controlled `width` prop that has been streaming back during the drag). A no-op when not dragging
    /// (web `if (!dragging) return`).
    public func dragEnded() {
        guard isDragging else { return }
        isDragging = false
        onResizeEnd?(input.width)
    }

    // MARK: Keyboard / VoiceOver steps (web `ArrowLeft`/`ArrowRight`/`Home`/`End`)

    /// Shrinks the column by one step — the web `ArrowLeft`: `clamp(width - 8)` pushed to BOTH `onResize`
    /// and `onResizeEnd` (the web key handler commits immediately).
    public func stepSmaller() {
        commit(DataTableResizerProjector.adjusted(
            width: input.width,
            by: -DataTableResizerProjector.step,
            minWidth: input.minWidth,
            maxWidth: input.maxWidth
        ))
    }

    /// Grows the column by one step — the web `ArrowRight`: `clamp(width + 8)` pushed to BOTH `onResize`
    /// and `onResizeEnd`.
    public func stepLarger() {
        commit(DataTableResizerProjector.adjusted(
            width: input.width,
            by: DataTableResizerProjector.step,
            minWidth: input.minWidth,
            maxWidth: input.maxWidth
        ))
    }

    /// Resets the column to the default width — the web `Home`: `clamp(80)` pushed to BOTH callbacks.
    public func resetToDefault() {
        commit(DataTableResizerProjector.clamp(
            DataTableResizerProjector.homeWidth,
            minWidth: input.minWidth,
            maxWidth: input.maxWidth
        ))
    }

    /// Maxes the column out — the web `End`: `clamp(maxWidth)` pushed to BOTH callbacks.
    public func maximize() {
        commit(DataTableResizerProjector.clamp(
            input.maxWidth,
            minWidth: input.minWidth,
            maxWidth: input.maxWidth
        ))
    }

    /// Maps the VoiceOver adjustable action to the keyboard steps — increment grows the column (web
    /// `ArrowRight`), decrement shrinks it (web `ArrowLeft`), so a VoiceOver user resizes with a swipe.
    public func adjust(_ direction: AccessibilityAdjustmentDirectionShim) {
        switch direction {
        case .increment: stepLarger()
        case .decrement: stepSmaller()
        }
    }

    /// Commits a stepped width to BOTH callbacks — the web key handler always calls `onResize(next)` then
    /// `onResizeEnd?.(next)` so the change persists without a separate release gesture.
    private func commit(_ next: Double) {
        onResize?(next)
        onResizeEnd?(next)
    }

    // MARK: Lifecycle

    /// Replaces the props + the page closures — the native peer of React re-rendering with new props. The
    /// closures are always refreshed (they are recreated each parent render); the props reassign only when
    /// they actually change so an unrelated re-render does not invalidate observers spuriously. This is how
    /// the controlled `width` streams back during a drag.
    public func update(
        _ input: DataTableResizerInput,
        onResize: (@MainActor (Double) -> Void)?,
        onResizeEnd: (@MainActor (Double) -> Void)?
    ) {
        self.onResize = onResize
        self.onResizeEnd = onResizeEnd
        if input != self.input {
            self.input = input
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DataTableResizerSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}

// MARK: - Accessibility adjustment shim (SwiftUI-free seam)

/// A SwiftUI-free mirror of `AccessibilityAdjustmentDirection` so the state-holder's ``adjust(_:)`` rule
/// stays unit-testable without importing SwiftUI. The view maps the SwiftUI value to this at the call site.
public enum DataTableResizerAdjustment: Sendable, Equatable {
    case increment
    case decrement
}

/// The adjustment type the model consumes. Aliased so the call site reads naturally while the underlying
/// type stays SwiftUI-free.
public typealias AccessibilityAdjustmentDirectionShim = DataTableResizerAdjustment
