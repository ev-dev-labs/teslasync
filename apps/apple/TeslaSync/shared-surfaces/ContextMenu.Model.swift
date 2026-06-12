//
//  ContextMenu.Model.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the caller-facing action value type, and the
//  observable state-holder (P1/S8) for the app-global contextual action menu. The web `<ContextMenu>` keeps
//  its state in a module-level pub/sub store read through `useSyncExternalStore`; the native peer is the
//  `@Observable` ``ContextMenuController`` — an app-global ``shared`` instance (the module-store parity)
//  that is equally instantiable for previews / tests. The holder owns the open presentation (web
//  `MenuState`: the items, the anchor point, and the monotonic open nonce so a re-open at the same spot
//  still re-renders), the keyboard-focused row (web the focused `menuitem`), routes a row invocation (web
//  `invoke` — close first, then run the handler so navigations see the menu already torn down), reproduces
//  the keyboard traversal through the pure ``ContextMenuProjector``, and emits the single `view.opened`
//  diagnostics event. No networking lives here.
//

import CoreGraphics
import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web label, routed through a key

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "ContextMenu" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source routes its one literal through `t('contextMenu.menuLabel',
/// 'Context menu')`; the native surface routes it plus the native accessibility additions through the
/// facade per the no-hardcoded-English rule.
public enum ContextMenuStrings {
    public static let table = "ContextMenu"

    public static let string: ContextMenuResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The menu container's accessible name (web `aria-label={t('contextMenu.menuLabel', 'Context menu')}`).
    public static var menuLabel: String {
        string("contextMenu.menuLabel", "Context menu")
    }

    /// Friendly body shown when a menu is asked to render with no rows (native — never a blank box; the web
    /// silently refuses to open an empty menu).
    public static var empty: String {
        string("contextMenu.empty", "No actions")
    }

    /// The dismiss-backdrop accessible name (native a11y addition — the tap-outside-to-close affordance the
    /// web wires to a document `pointerdown` listener).
    public static var dismiss: String {
        string("contextMenu.dismiss", "Dismiss menu")
    }

    /// VoiceOver value announced for a destructive row (native a11y addition — the web only tints the row
    /// red; the native surface also names the consequence).
    public static var destructive: String {
        string("contextMenu.destructive", "Destructive")
    }

    /// VoiceOver value announced for a disabled row (native a11y addition — the web parity of
    /// `aria-disabled`).
    public static var unavailable: String {
        string("contextMenu.unavailable", "Unavailable")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ContextMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogContextMenuTelemetry: ContextMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ContextMenuAction (web `ContextMenuItem`, carries its handler)

/// One contextual action — the caller-facing native peer of the web `ContextMenuItem`, the only type a
/// call site constructs. It carries the row's display ``ContextMenuItemDescriptor`` fields plus the
/// `@MainActor` handler the web calls `onClick`. Equality compares the descriptor only (two actions with
/// the same id, label, glyph, flags, and shortcut are equal regardless of their closures), so a
/// presentation can diff cheaply; identity is the row id.
public struct ContextMenuAction: Identifiable {
    /// Stable identity (web `item.id`).
    public let id: String
    /// Inline row text (web `item.label`).
    public let label: String
    /// Optional leading SF Symbol glyph (web `item.icon`).
    public let systemImage: String?
    /// Rendered visibly but non-interactive (web `item.disabled`).
    public let isDisabled: Bool
    /// Tinted with the danger color (web `item.destructive`).
    public let isDestructive: Bool
    /// Optional right-aligned shortcut hint (web `item.shortcut`).
    public let shortcut: String?
    /// The action invoked when the row is chosen (web `item.onClick`). Run on the main actor after the menu
    /// closes.
    public let perform: @MainActor () -> Void

    public init(
        id: String,
        label: String,
        systemImage: String? = nil,
        isDisabled: Bool = false,
        isDestructive: Bool = false,
        shortcut: String? = nil,
        perform: @escaping @MainActor () -> Void
    ) {
        self.id = id
        self.label = label
        self.systemImage = systemImage
        self.isDisabled = isDisabled
        self.isDestructive = isDestructive
        self.shortcut = shortcut
        self.perform = perform
    }

    /// The closure-free, view-ready description of this row (fed to the pure projector + the row view).
    public var descriptor: ContextMenuItemDescriptor {
        ContextMenuItemDescriptor(
            id: id,
            label: label,
            systemImage: systemImage,
            isDisabled: isDisabled,
            isDestructive: isDestructive,
            shortcut: shortcut
        )
    }
}

extension ContextMenuAction: Equatable {
    public static func == (lhs: ContextMenuAction, rhs: ContextMenuAction) -> Bool {
        lhs.descriptor == rhs.descriptor
    }
}

// MARK: - ContextMenuPresentation (web `MenuState`)

/// The open-menu state — the native peer of the web `MenuState`: the actions to render, the anchor point in
/// the host's coordinate space (web `x` / `y`), and the monotonic `nonce` so a re-open with an identical
/// (items, anchor) still re-renders, e.g. a second right-click in the same spot (web `nonceCounter`). The
/// web `restoreFocusEl` has no value-type peer — native focus restoration is handled by SwiftUI's focus
/// system at the view layer.
public struct ContextMenuPresentation: Equatable {
    /// The actions to render, in order (web `MenuState.items`).
    public let actions: [ContextMenuAction]
    /// The open point in the host's coordinate space (web `x` / `y`).
    public let anchor: CGPoint
    /// Monotonic open counter so re-opens re-render (web `nonce`).
    public let nonce: Int

    public init(actions: [ContextMenuAction], anchor: CGPoint, nonce: Int) {
        self.actions = actions
        self.anchor = anchor
        self.nonce = nonce
    }

    /// The closure-free row descriptions for the view + the pure projector (web `state.items` mapped to the
    /// render model).
    public var descriptors: [ContextMenuItemDescriptor] {
        actions.map(\.descriptor)
    }
}

// MARK: - ContextMenuController (P1/S8) — app-global store + keyboard + routing

/// The surface's observable state-holder — the native peer of the web module-level pub/sub store read
/// through `useSyncExternalStore`. The app mounts one ``ContextMenu`` host bound to ``shared`` (the
/// module-store parity); previews and tests inject their own instance. It owns the open
/// ``ContextMenuPresentation`` (web `state`), the keyboard-focused row (web the focused `menuitem`; `nil`
/// means the menu container holds focus, web's initial state), opens / closes the menu honoring the
/// empty-open guard (web `openContextMenu` early-return), routes a row invocation (web `invoke`: close
/// first, then run the handler), drives keyboard traversal through the pure ``ContextMenuProjector``, and
/// emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class ContextMenuController {
    /// The app-global instance — the native peer of the web module-level store. Call sites that do not
    /// inject a controller (the default ``ContextMenu`` host and `teslaSyncContextMenu` trigger) share it.
    public static let shared = ContextMenuController()

    /// The open menu, or `nil` when closed (web `state`). Observed so the host renders / tears down the
    /// floating menu when it changes.
    public private(set) var presentation: ContextMenuPresentation?

    /// The keyboard-focused row index, or `nil` when the menu container holds focus (web initial focus on
    /// the container; first Arrow Down moves to the first enabled row).
    public private(set) var focusedIndex: Int?

    @ObservationIgnored private let telemetry: any ContextMenuTelemetry
    @ObservationIgnored private var nonceCounter = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(telemetry: any ContextMenuTelemetry = OSLogContextMenuTelemetry()) {
        self.telemetry = telemetry
    }

    /// Whether a menu is currently open (web `state !== null`).
    public var isOpen: Bool {
        presentation != nil
    }

    /// The open menu's row descriptions, or empty when closed (web `state.items`).
    public var descriptors: [ContextMenuItemDescriptor] {
        presentation?.descriptors ?? []
    }

    /// The id of the keyboard-focused row, or `nil` when the container holds focus / there is no such row.
    public var focusedActionID: String? {
        guard let focusedIndex, let actions = presentation?.actions, actions.indices.contains(focusedIndex)
        else { return nil }
        return actions[focusedIndex].id
    }

    /// Opens the menu at a point — the native peer of the web `openContextMenu(items, x, y)`. Honors the
    /// empty-open guard (an empty list is refused, web early-return), bumps the open nonce so a re-open at
    /// the same spot still re-renders, and resets focus to the container (web auto-focuses the container,
    /// not the first row).
    public func open(_ actions: [ContextMenuAction], at anchor: CGPoint) {
        guard ContextMenuProjector.shouldOpen(actions.map(\.descriptor)) else { return }
        nonceCounter += 1
        presentation = ContextMenuPresentation(actions: actions, anchor: anchor, nonce: nonceCounter)
        focusedIndex = nil
    }

    /// Closes the menu — the native peer of the web `closeContextMenu()` (a no-op when already closed).
    public func close() {
        guard presentation != nil else { return }
        presentation = nil
        focusedIndex = nil
    }

    /// Invokes a row by id — the native peer of the web `invoke(item)`: a disabled row is ignored, the menu
    /// closes first, then the handler runs on the next main-actor tick (web `queueMicrotask`) so any
    /// navigation or re-render the action triggers sees the menu already torn down.
    public func invoke(id: String) {
        guard let action = presentation?.actions.first(where: { $0.id == id }) else { return }
        guard !action.isDisabled else { return }
        let handler = action.perform
        close()
        Task { @MainActor in handler() }
    }

    /// Invokes the keyboard-focused row (web Enter / Space on the focused `menuitem`). No-op when the
    /// container holds focus.
    public func invokeFocused() {
        guard let focusedActionID else { return }
        invoke(id: focusedActionID)
    }

    /// Moves keyboard focus one enabled row in the given direction — the native peer of the web Arrow Down /
    /// Arrow Up (`focusNextEnabled`), wrapping around and skipping disabled rows. From the container (focus
    /// `nil`) it lands on the first enabled row going down, the last going up.
    public func moveFocus(step: Int) {
        focusedIndex = ContextMenuProjector.nextEnabledIndex(after: focusedIndex, in: descriptors, step: step)
    }

    /// Moves keyboard focus to the first enabled row (web Home / `focusFirstEnabled`).
    public func focusFirst() {
        focusedIndex = ContextMenuProjector.firstEnabledIndex(descriptors)
    }

    /// Moves keyboard focus to the last enabled row (web End / `focusLastEnabled`).
    public func focusLast() {
        focusedIndex = ContextMenuProjector.lastEnabledIndex(descriptors)
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ContextMenuSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
