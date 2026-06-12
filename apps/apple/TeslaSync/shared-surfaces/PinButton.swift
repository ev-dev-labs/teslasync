//
//  PinButton.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The shared pin affordance — the SwiftUI parity of `components/ui/PinButton.tsx`. A focusable icon-only
//  (or icon-plus-label) button that toggles the user's pin state for a single row, binding through
//  ``PinButtonModel`` (P1/S8); no networking lives here. Like the web it composes the unified pin store so
//  any open surface (vehicle picker, alerts list, dashboard widgets, …) re-derives pinned-first the moment
//  a pin is added or removed.
//
//  States (faithful to the web source — every branch reproduced):
//    • unpinned   — plain pushpin (web `Pin`), muted, tooltip + label "Pin", `aria-pressed` false.
//    • pinned     — slashed pin (web `PinOff`), amber, tooltip "Unpin" / label "Pinned", `.isSelected`.
//    • busy       — a pin / unpin mutation is in flight (web `toggle.isPending`) → disabled + dimmed.
//    • cold load  — first fetch with no cached set → a button-sized spinner in place of the glyph,
//                   disabled (never a blank box); resolves to unpinned when the set arrives empty (web
//                   `pinned = []` default).
//    • stale / offline / error (cached) — the P4 freshness axis the web swallows: the cached pinned-ness
//                   stays on the glyph beneath a small corner badge (offline → error → stale precedence);
//                   the badge's VoiceOver "Retry" action re-requests the set, and `stale` auto-refreshes.
//

import SwiftUI

// MARK: - PinButton (the shared surface)

/// The shared pin button. Renders an always-present toggle (the web never hides it), binding through
/// ``PinButtonModel``. Drop it into a list cell or card header; tapping pins / unpins the row through the
/// unified pin store without triggering the row's own navigation (a SwiftUI `Button` does not propagate
/// its tap to an enclosing tap target, the native parity of the web `e.stopPropagation()`).
public struct PinButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PinButtonSurface.slug

    @State private var model: PinButtonModel
    @State private var isHovering = false
    private let trackedInput: PinButtonInput?

    /// Injects a pre-built model — the production seam (a model wired to the live `/pinned` store) and the
    /// preview / test seam (a model over ``InMemoryPinnedStore`` + a spy telemetry).
    public init(model: PinButtonModel) {
        _model = State(initialValue: model)
        trackedInput = nil
    }

    /// The prop-style initializer — the parity of `<PinButton itemType itemId context size showLabel />`.
    /// Builds an ``InMemoryPinnedStore`` seeded with the known pin state for previews + known-state
    /// mounting; production callers inject a model wired to the live pin store via ``init(model:)`` instead.
    public init(
        itemType: PinnedItemKind,
        itemID: String,
        context: String? = nil,
        size: PinButtonSize = .small,
        showLabel: Bool = false,
        pinned: Bool = false,
        status: PinLoadStatus = .loaded,
        freshness: PinFreshness = .fresh,
        telemetry: any PinButtonTelemetry = OSLogPinButtonTelemetry()
    ) {
        let input = PinButtonInput(
            itemType: itemType,
            itemID: itemID,
            context: context,
            size: size,
            showLabel: showLabel
        )
        let snapshot = PinnedSnapshot(
            status: status,
            freshness: freshness,
            pinnedIDs: pinned ? [itemID] : [],
            hasLoaded: status != .loading
        )
        let store = InMemoryPinnedStore(snapshot: snapshot)
        _model = State(initialValue: PinButtonModel(input: input, store: store, telemetry: telemetry))
        trackedInput = input
    }

    public var body: some View {
        let projection = model.projection
        return Button { model.toggle() } label: {
            HStack(spacing: TSSpacing.xs) {
                PinGlyphView(projection: projection, size: model.input.size)
                if projection.showsLabel {
                    PinInlineLabel(projection: projection, size: model.input.size)
                }
            }
            .frame(
                minWidth: projection.showsLabel ? nil : model.input.size.controlSide,
                minHeight: model.input.size.controlSide
            )
            .padding(.horizontal, projection.showsLabel ? TSSpacing.sm : 0)
            .background(hoverBackground)
            .overlay(alignment: .topTrailing) { badgeOverlay(projection) }
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!projection.isInteractive)
        .opacity(projection.isBusy ? 0.6 : 1)
        .help(Text(verbatim: PinButtonStrings.tooltip(projection.presentation)))
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: PinButtonStrings.tooltip(projection.presentation)))
        .accessibilityValue(Text(verbatim: PinButtonStrings.accessibilityValue(for: projection)))
        .accessibilityAddTraits(projection.isPinned ? .isSelected : [])
        .modifier(PinRetryAction(projection: projection) { model.refresh() })
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: trackedInput) { _, newValue in
            if let newValue { model.update(newValue) }
        }
    }

    /// The faint rounded hover tint (web `hover:bg-amber-500/10` / `hover:bg-[var(--surface-2)]`),
    /// pointer-only — transparent unless the pointer is over the control.
    private var hoverBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(model.projection.presentation.tone.hoverTint.opacity(isHovering ? 0.1 : 0))
    }

    /// The gated freshness / error corner badge, inert to hit-testing so the whole control stays one tap
    /// target (the meaning is folded into the button's accessibility value).
    @ViewBuilder
    private func badgeOverlay(_ projection: PinButtonProjection) -> some View {
        if let badge = projection.statusBadge {
            PinStatusBadgeView(badge: badge)
                .offset(x: TSSpacing.xs, y: -TSSpacing.xs)
                .allowsHitTesting(false)
        }
    }
}

// MARK: - PinRetryAction (VoiceOver "Retry" for the failed / stale badge)

/// Attaches a VoiceOver custom action ("Retry") that re-requests the pin set — the accessible parity of
/// the web `QueryError` retry affordance, scoped to this tiny control. Added only when the projected
/// status badge is retryable (failed / stale); a no-op otherwise.
private struct PinRetryAction: ViewModifier {
    let projection: PinButtonProjection
    let onRetry: () -> Void

    func body(content: Content) -> some View {
        if projection.statusBadge?.showsRetry == true {
            content.accessibilityAction(named: Text(verbatim: PinButtonStrings.retry), onRetry)
        } else {
            content
        }
    }
}
