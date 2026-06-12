//
//  ScrollRestoration.Views.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The presentational + behavioral SwiftUI layer for the scroll-restoration surface. The web component
//  does two things in one place (it reads global DOM: it listens to navigation AND moves the scroll
//  position of `#main-content`). SwiftUI cannot query a global scroll view, so the surface is split into
//  two cooperating pieces that share one ``ScrollRestorationModel``:
//
//    • ScrollRestorationStatusView — the visible status surface that renders EVERY restoration phase
//      (preparing / restored / freshTop / noSavedTop / unavailable) so the P4 "render every state"
//      contract is met with a legible visualization, never a blank box. (The production behavior itself
//      is invisible, faithful to the web `return null`; this view is how the states are surfaced.)
//    • .scrollRestoration(_:) — the modifier attached to the primary `ScrollView`. It is the native peer
//      of the web component's DOM scroll ops: it saves the live offset as the user scrolls (the throttled
//      `onScroll`) via `onScrollGeometryChange`, and applies the restore target on each navigation via a
//      bound `ScrollPosition` (iOS 18 / macOS 15). The companion (ScrollRestoration.swift) drives the
//      navigation seam; this modifier reacts to the model's `restoreToken`.
//
//  All copy resolves through P1/S10; all chrome is P1/S9 token-driven; transitions honor Reduce Motion;
//  no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - ScrollRestorationStatusView (renders every phase)

/// The status surface — a compact panel that names the current restoration phase, describes what it did,
/// shows the resolved target position, and surfaces the degraded banner when the session store cannot
/// persist. It renders EVERY phase (the P4 "render every state" contract); the production restoration
/// behavior is otherwise invisible (web `return null`). A pure function of its inputs, so previews +
/// tests can stage each branch deterministically.
public struct ScrollRestorationStatusView: View {
    private let phase: ScrollRestorationPhase
    private let restoreOffset: Double?
    private let storeAvailable: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(phase: ScrollRestorationPhase, restoreOffset: Double? = nil, storeAvailable: Bool = true) {
        self.phase = phase
        self.restoreOffset = restoreOffset
        self.storeAvailable = storeAvailable
    }

    /// Convenience binding to a live model — reads the published phase + restore target + store state.
    public init(model: ScrollRestorationModel) {
        self.init(
            phase: model.phase,
            restoreOffset: model.pendingRestoreOffset,
            storeAvailable: model.storeIsAvailable
        )
    }

    private var style: ScrollRestorationPhaseStyle {
        ScrollRestorationPhaseStyle.style(for: phase)
    }

    private var heading: String {
        ScrollRestorationStrings.string("scrollRestoration.title", "Scroll restoration")
    }

    private var positionLabel: String {
        ScrollRestorationStrings.string("scrollRestoration.position.label", "Target position")
    }

    private var positionValue: String {
        let offset = restoreOffset ?? 0
        if offset <= 0.5 {
            return ScrollRestorationStrings.string("scrollRestoration.offset.top", "Top")
        }
        let points = Int(offset.rounded())
        let unit = ScrollRestorationStrings.string("scrollRestoration.unit.points", "pt")
        return "\(points.formatted()) \(unit)"
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: heading)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
                ScrollRestorationStatusChip(phase: phase)
            }

            Text(verbatim: style.description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: positionLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: 0)
                Text(verbatim: positionValue)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .monospacedDigit()
            }

            if !storeAvailable {
                ScrollRestorationDegradedBanner()
            }
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: phase)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(heading). \(style.title). \(style.description)"))
    }
}

// MARK: - .scrollRestoration(_:) modifier (native peer of the web DOM scroll ops)

/// The modifier attached to the primary `ScrollView` — the native peer of the web component's scroll
/// operations on `#main-content`. It binds a `ScrollPosition` (iOS 18 / macOS 15) so it can move the
/// scroll view programmatically, saves the live offset as the user scrolls (the throttled `onScroll`)
/// through `onScrollGeometryChange`, and applies the model's pending restore target whenever the
/// `restoreToken` advances (a new navigation) or the view first appears.
private struct ScrollRestorationModifier: ViewModifier {
    let model: ScrollRestorationModel
    @State private var scrollPosition = ScrollPosition(edge: .top)

    func body(content: Content) -> some View {
        content
            .scrollPosition($scrollPosition)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.contentOffset.y
            } action: { _, newOffset in
                model.recordScroll(offset: Double(newOffset))
            }
            .onChange(of: model.restoreToken) {
                applyPendingRestore()
            }
            .onAppear {
                applyPendingRestore()
            }
            .onDisappear {
                model.flushCurrentOffset()
            }
    }

    /// Applies the model's pending restore target to the bound scroll position — the native peer of the
    /// web `setScrollTop(target, …)`. A target of `0` scrolls to the top (PUSH / REPLACE / no-saved).
    private func applyPendingRestore() {
        let target = CGFloat(model.pendingRestoreOffset)
        if target <= 0.5 {
            scrollPosition.scrollTo(edge: .top)
        } else {
            scrollPosition.scrollTo(y: target)
        }
    }
}

public extension View {
    /// Attaches scroll restoration to the primary scroll view — the native peer of mounting
    /// `<ScrollRestoration>` over `#main-content`. Pass the SAME ``ScrollRestorationModel`` instance the
    /// ``ScrollRestoration`` companion drives, so saves and restores share one session store + key.
    ///
    /// ```swift
    /// ScrollView { content }
    ///     .scrollRestoration(model)
    /// ```
    func scrollRestoration(_ model: ScrollRestorationModel) -> some View {
        modifier(ScrollRestorationModifier(model: model))
    }
}
