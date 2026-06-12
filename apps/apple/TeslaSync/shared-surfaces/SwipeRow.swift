//
//  SwipeRow.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The SwipeRow shared surface — the SwiftUI parity of `web/src/components/mobile/SwipeRow.tsx`. It
//  wraps an arbitrary row (`content`, the web `children`) and adds the iOS Mail / Notes swipe-to-action
//  interaction: drag left to reveal the right-edge action, drag right to reveal the left-edge action,
//  peek past the reveal threshold, or auto-fire past half the row width. Touch-only by default (the
//  web `useIsCoarsePointer` capability, bound through `SwipeRowModel`); on a fine pointer the row is a
//  straight pass-through with no gesture, exactly as the web component attaches zero handlers there.
//
//  States (every one renders — no hidden surface):
//    • loading — the host is resolving the row → a skeleton row.
//    • empty   — there is no row to show → a friendly empty card, never a blank box.
//    • error   — the feed failed → an error row with Retry (web `QueryError` peer).
//    • content — the wrapped row renders; swipe-enabled when active (capability ∧ an action is wired).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip with a one-shot
//                auto-refresh on the stale transition.
//
//  `useMotionPreference` binds at the view boundary (`@Environment(\.accessibilityReduceMotion)`):
//  the snap-back animation collapses to an instant transition under Reduce Motion (web
//  `prefers-reduced-motion`). `view.opened` is emitted once on appear (P1/S11).
//

import SwiftUI

// MARK: - Swipe action (web `SwipeAction`)

/// One swipe-revealed action — the native mirror of the web `SwipeAction`. `label` is the host's
/// already-localized button text (web labels arrive localized); `tone` paints the danger/default
/// token; `systemImage` overrides the tone's default SF Symbol (web `icon`); `accessibilityLabel`
/// overrides the spoken label when the visible text is not screen-reader friendly (web `ariaLabel`).
public struct SwipeAction {
    public let label: String
    public let tone: SwipeActionTone
    public let systemImage: String?
    public let accessibilityLabel: String?
    public let onAction: @MainActor () -> Void

    public init(
        label: String,
        tone: SwipeActionTone = .default,
        systemImage: String? = nil,
        accessibilityLabel: String? = nil,
        onAction: @escaping @MainActor () -> Void
    ) {
        self.label = label
        self.tone = tone
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
        self.onAction = onAction
    }

    /// The SF Symbol the action renders — the caller's override, else the tone's default (web
    /// `defaultIcon`: `Trash2` for danger, `Archive` otherwise).
    var resolvedSymbolName: String {
        systemImage ?? tone.defaultSymbolName
    }
}

// MARK: - SwipeRow (the shared surface)

/// The SwipeRow shared surface. Generic over the wrapped row `Content` (web `children`); binds the
/// swipe-enabled capability + leaf/freshness state through `SwipeRowModel` (P1/S8) and renders every
/// state. The actions are view props (they carry the host's callbacks, like the web prop closures),
/// not fetched data.
public struct SwipeRow<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SwipeRowModel.surfaceSlug
    }

    @State private var model: SwipeRowModel
    private let leftAction: SwipeAction?
    private let rightAction: SwipeAction?
    private let revealThreshold: Double
    private let content: () -> Content

    // MARK: Model-driven initializer (host owns the state-holder)

    /// Binds an externally-owned model — the spy/in-memory source in tests and previews, the
    /// production controlled source in the app.
    public init(
        model: SwipeRowModel,
        leftAction: SwipeAction? = nil,
        rightAction: SwipeAction? = nil,
        revealThreshold: Double = SwipeRowGeometry.revealThreshold,
        @ViewBuilder content: @escaping () -> Content
    ) {
        _model = State(initialValue: model)
        self.leftAction = leftAction
        self.rightAction = rightAction
        self.revealThreshold = revealThreshold
        self.content = content
    }

    // MARK: Controlled-host initializer (the parity of mounting `<SwipeRow …>`)

    /// The convenience initializer mirroring the web prop signature. `enabled` overrides the
    /// touch-only default (web `enabled ?? useIsCoarsePointer()`); the lifecycle flags drive the leaf
    /// and freshness states the web pure render has no concept of.
    public init(
        leftAction: SwipeAction? = nil,
        rightAction: SwipeAction? = nil,
        enabled: Bool? = nil,
        hasContent: Bool = true,
        connection: SwipeRowConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        revealThreshold: Double = SwipeRowGeometry.revealThreshold,
        telemetry: any SwipeRowTelemetry = OSLogSwipeRowTelemetry(),
        @ViewBuilder content: @escaping () -> Content
    ) {
        let source = StaticSwipeRowSource(
            isCoarsePointer: enabled ?? SwipeRowCapability.coarsePointerDefault,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        _model = State(initialValue: SwipeRowModel(source: source, telemetry: telemetry))
        self.leftAction = leftAction
        self.rightAction = rightAction
        self.revealThreshold = revealThreshold
        self.content = content
    }

    // MARK: Body

    /// Whether the row is interactive — the web `active` guard: the coarse-pointer capability AND at
    /// least one wired action. Otherwise the row is a straight pass-through.
    private var isActive: Bool {
        model.isCoarsePointer && (leftAction != nil || rightAction != nil)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            phaseContent
            if model.connection != .live {
                SwipeRowFreshnessBanner(connection: model.connection) { model.refresh() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) { freshnessChip }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            SwipeRowLoadingView()
        case .empty:
            SwipeRowEmptyView()
        case let .error(message):
            SwipeRowErrorView(message: message) { model.refresh() }
        case .content:
            contentPhase
        }
    }

    @ViewBuilder
    private var contentPhase: some View {
        if isActive {
            SwipeRowInteractiveContent(
                leftAction: leftAction,
                rightAction: rightAction,
                revealThreshold: revealThreshold,
                content: content
            )
        } else {
            // Web `!active` branch: render the row straight through with no gesture handlers.
            content()
        }
    }

    @ViewBuilder
    private var freshnessChip: some View {
        if model.connection != .live {
            SwipeRowFreshnessChip(connection: model.connection) { model.refresh() }
                .padding(TSSpacing.sm)
        }
    }
}
