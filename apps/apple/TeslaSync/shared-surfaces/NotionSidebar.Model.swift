//
//  NotionSidebar.Model.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  Notion-style sidebar.
//
//    • NotionSidebarStrings — resolves the surface's copy by key with the English fallback so the Swift
//      sources hold no hardcoded prose. Keys mirror the web `nav.*` namespace verbatim (`nav.sidebar`,
//      `nav.favorites`, `nav.pages`, `nav.filterNoMatch`, `nav.filterClear`, `nav.pinPage`, `nav.unpinPage`,
//      `nav.vehicleCount`, `nav.staleCount`); they fold into the app catalog at integration time.
//
//    • NotionSidebarTelemetry — the `view.opened` diagnostics seam; the default logs via `os.Logger` and the
//      production app injects the shared-core sink.
//
//    • NotionSidebarModel — the @MainActor @Observable state-holder (the native peer of the web component's
//      `collapsed` + `filter` `useState`s plus the `activeSectionTitle` `useEffect`). It pins the bound
//      input, owns the local tree state, derives the resolved ``NotionSidebarPresentation`` through the pure
//      projection (so all filtering / expansion / active-state logic lives in one tested place, not the
//      view), and emits `view.opened` once. SwiftUI observation replaces React's re-render: a view reading
//      `presentation` redraws when the tree state or input changes — and the model skips the write when the
//      resolved value is unchanged, so a no-op mutation invalidates no observer. The pin / unpin intents are
//      forwarded to injected callbacks (the P1/S8 binding to the nav state holder that owns the pinned list —
//      web `onPin` / `onUnpin`); no networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` + `navLabel(label)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "NotionSidebar" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the
/// projection deterministic.
public enum NotionSidebarStrings {
    public static let table = "NotionSidebar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The surface's i18n closure — routes every lookup (copy + nav labels) through the same facade so it
    /// localizes alongside the rest of the catalog. `@Sendable` for the Foundation-only core under strict
    /// concurrency.
    public static let localize: NotionSidebarLocalize = { key, fallback in
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol NotionSidebarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogNotionSidebarTelemetry: NotionSidebarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - NotionSidebarModel (P1/S8) — web `collapsed` + `filter` + `activeSectionTitle` effect

/// The sidebar's state-holder — the native peer of the web component's `collapsed` / `filter` state plus the
/// `activeSectionTitle` effect. It pins the bound ``NotionSidebarInput``, owns the local
/// ``NotionSidebarTreeState``, derives the resolved ``NotionSidebarPresentation`` through the pure
/// projection, and emits `view.opened` once. Reading `presentation` inside a view body registers an
/// observation dependency, so the sidebar redraws when the tree state or input changes — and only then,
/// because every mutation skips the write when the resolved presentation is unchanged.
@MainActor
@Observable
public final class NotionSidebarModel {
    @ObservationIgnored private var input: NotionSidebarInput
    @ObservationIgnored private var tree: NotionSidebarTreeState
    @ObservationIgnored private var activeSectionID: String?
    @ObservationIgnored private let localize: NotionSidebarLocalize
    @ObservationIgnored private let telemetry: any NotionSidebarTelemetry
    @ObservationIgnored private let onPin: @MainActor (String) -> Void
    @ObservationIgnored private let onUnpin: @MainActor (String) -> Void
    @ObservationIgnored private var didEmitOpen = false

    /// The resolved, view-ready presentation (web per-render output). Recomputed on every mutation; the view
    /// reads it and draws.
    public private(set) var presentation: NotionSidebarPresentation

    public init(
        input: NotionSidebarInput,
        telemetry: any NotionSidebarTelemetry = OSLogNotionSidebarTelemetry(),
        localize: @escaping NotionSidebarLocalize = NotionSidebarStrings.localize,
        onPin: @escaping @MainActor (String) -> Void = { _ in },
        onUnpin: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.input = input
        self.localize = localize
        self.telemetry = telemetry
        self.onPin = onPin
        self.onUnpin = onUnpin
        let active = input.activeSectionID
        activeSectionID = active
        // Default: collapse every section EXCEPT the one containing the active page — web initial state
        // (Notion's "show me the page I'm on" behaviour; the rest start closed).
        var collapsed = Set(input.sections.map(\.id))
        if let active { collapsed.remove(active) }
        tree = NotionSidebarTreeState(collapsedSectionIDs: collapsed, filterText: "")
        presentation = NotionSidebarProjection.resolve(input: input, tree: tree, localize: localize)
    }

    // MARK: Read access (tests + the filter field binding)

    /// The current filter text — web `filter` (backs the search field's binding).
    public var filterText: String {
        tree.filterText
    }

    /// The bound input this model renders — exposed so the view + tests can read the props.
    public var boundInput: NotionSidebarInput {
        input
    }

    /// The id of the section currently holding the active page — web `activeSectionTitle`.
    public var activeSection: String? {
        activeSectionID
    }

    /// The localized prompt + accessibility label for the inline filter field. The web owns the filter state
    /// but renders its typing surface upstream; the native peer exposes the field here, so a dedicated
    /// (localizable) prompt backs it.
    public var localizedFilterPrompt: String {
        localize("nav.filterPrompt", "Filter")
    }

    // MARK: Tree intents (web `toggleSection` / `setFilter`)

    /// Toggles a section open / closed — web `toggleSection`. Force-expanded sections under an active filter
    /// ignore this (the projection re-derives expansion), matching the web.
    public func toggleSection(_ id: String) {
        var collapsed = tree.collapsedSectionIDs
        if collapsed.contains(id) {
            collapsed.remove(id)
        } else {
            collapsed.insert(id)
        }
        tree = NotionSidebarTreeState(collapsedSectionIDs: collapsed, filterText: tree.filterText)
        recompute()
    }

    /// Updates the inline tree filter — web `setFilter`. A no-op when the text is unchanged.
    public func setFilter(_ text: String) {
        guard text != tree.filterText else { return }
        tree = NotionSidebarTreeState(collapsedSectionIDs: tree.collapsedSectionIDs, filterText: text)
        recompute()
    }

    /// Clears the filter — web "Clear filter" button. Restores the prior collapse-based expansion.
    public func clearFilter() {
        setFilter("")
    }

    // MARK: Pin intents (web `onPin` / `onUnpin`)

    /// Forwards a pin-to-favorites intent to the bound nav state holder — web `onPin(to)`.
    public func pin(_ path: String) {
        onPin(path)
    }

    /// Forwards an unpin intent to the bound nav state holder — web `onUnpin(to)`.
    public func unpin(_ path: String) {
        onUnpin(path)
    }

    // MARK: Re-binding (web parent re-render: pin/unpin + navigation)

    /// Re-binds the input — the native peer of the parent passing new props (an updated pinned list after
    /// pin / unpin, or a new `pathname` / `activeSectionTitle` after navigation). When the active section
    /// changes into a currently-collapsed section, it auto-expands (web `useEffect([activeSectionTitle])`).
    public func update(input newInput: NotionSidebarInput) {
        let previousActive = activeSectionID
        input = newInput
        let nextActive = newInput.activeSectionID
        activeSectionID = nextActive
        if let nextActive, nextActive != previousActive, tree.collapsedSectionIDs.contains(nextActive) {
            var collapsed = tree.collapsedSectionIDs
            collapsed.remove(nextActive)
            tree = NotionSidebarTreeState(collapsedSectionIDs: collapsed, filterText: tree.filterText)
        }
        recompute()
    }

    // MARK: Lifecycle (P1/S11 view.opened)

    /// Emits `view.opened` once (P1/S11). Idempotent across the SwiftUI appear / disappear churn — the event
    /// fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: NotionSidebarSurface.slug)
    }

    // MARK: Private

    /// Re-derives the resolved presentation and publishes it only when it actually changed, so a mutation
    /// that does not alter the rendered tree invalidates no observer (web re-renders only on real change).
    private func recompute() {
        let next = NotionSidebarProjection.resolve(input: input, tree: tree, localize: localize)
        guard next != presentation else { return }
        presentation = next
    }
}
