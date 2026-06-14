//
//  StaggerContainer.Views.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The presentational pieces of the staggered-entrance container — the native peers of the web behaviour:
//  the orchestration context the container publishes into the SwiftUI environment (the native peer of
//  Framer Motion's variant inheritance — the parent's `staggerChildren` reaching every child), the
//  `staggerChild(index:)` modifier a descendant uses to inherit the cascade (mapping the container's phase
//  to an opacity + vertical offset, animated with the per-index delay — web child `motion.div` `variants`
//  under the container's `transition: { staggerChildren }`), and the friendly empty-content leaf rendered
//  when the container has nothing to stagger (the native "never a blank box" peer). All chrome is
//  token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - Orchestration context (web React context inheritance of `staggerChildren`)

/// The cascade context a ``StaggerContainer`` publishes to its descendants — the native peer of how the
/// web container's `staggerChildren` transition reaches every child through Framer Motion's variant
/// inheritance. It carries the resolved ``StaggerContainerProjection`` (the cascade step + the hosted
/// child's hidden variant + duration) and the current ``StaggerContainerPhase``; a descendant
/// ``SwiftUICore/View/staggerChild(index:)`` reads it to reveal on the phase flip, delayed by its index.
public struct StaggerContainerContext: Equatable, Sendable {
    /// The resolved cascade (web `staggerChildren` + the hosted child's variant + duration).
    public let projection: StaggerContainerProjection
    /// The container's current orchestration phase (web `hidden` / `show`).
    public let phase: StaggerContainerPhase

    public init(projection: StaggerContainerProjection, phase: StaggerContainerPhase) {
        self.projection = projection
        self.phase = phase
    }

    /// The default context for a ``SwiftUICore/View/staggerChild(index:)`` used outside any container — the
    /// phase is already `shown`, so the child renders in its final, fully-visible state (no orphaned hiding,
    /// the web peer of a `<StaggerItem>` mounted without a `<StaggerContainer>` parent).
    public static let inert = StaggerContainerContext(
        projection: StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false),
        phase: .shown
    )
}

private struct StaggerContainerContextKey: EnvironmentKey {
    static let defaultValue = StaggerContainerContext.inert
}

public extension EnvironmentValues {
    /// The active cascade context (web container `staggerChildren` inheritance) — ``StaggerContainerContext/inert``
    /// outside any ``StaggerContainer``, so a stray ``SwiftUICore/View/staggerChild(index:)`` stays visible.
    var staggerContainerContext: StaggerContainerContext {
        get { self[StaggerContainerContextKey.self] }
        set { self[StaggerContainerContextKey.self] = newValue }
    }
}

// MARK: - Child entrance animation (web child `transition` under container `staggerChildren`)

/// Builds the SwiftUI entrance animation for the child at `index` from the published projection — the native
/// boundary that turns the Foundation-only timing into a SwiftUI `Animation`. Returns `nil` under reduced
/// motion so the reveal is instant (the hidden variant already equals the final state). The curve is
/// `easeOut`, matching the app's `TSFadeIn` motion language; the delay is the index-derived cascade (web
/// container `staggerChildren`).
public enum StaggerContainerMotion {
    /// The child entrance animation for `index`, or `nil` when reduced motion is in effect.
    public static func childEntrance(for projection: StaggerContainerProjection, index: Int) -> Animation? {
        guard !projection.reduce else { return nil }
        return .easeOut(duration: projection.childDurationSeconds)
            .delay(projection.delaySeconds(forIndex: index))
    }
}

// MARK: - staggerChild(index:) (web child `motion.div` variants under the container)

/// Maps the container's current phase to an opacity + vertical offset for one cascade child — the native
/// peer of a `<StaggerItem>` inside a `<StaggerContainer>`. Reads the published ``StaggerContainerContext``
/// from the environment so it tracks the container's phase flip, and animates the change with the per-index
/// cascade delay (or settles instantly under reduced motion). The wrapper is transparent to VoiceOver: it
/// adds no accessibility traits of its own, leaving the hosted content to own its semantics.
public struct StaggerContainerChildModifier: ViewModifier {
    private let index: Int
    @Environment(\.staggerContainerContext) private var context

    public init(index: Int) {
        self.index = index
    }

    public func body(content: Content) -> some View {
        let projection = context.projection
        let phase = context.phase
        return content
            .opacity(projection.childOpacity(for: phase))
            .offset(y: CGFloat(projection.childOffsetY(for: phase)))
            .animation(StaggerContainerMotion.childEntrance(for: projection, index: index), value: phase)
    }
}

public extension View {
    /// Opts this view into its ``StaggerContainer``'s cascade as the child at `index` — the ergonomic,
    /// idiomatic-Swift spelling of wrapping it in a `<StaggerItem>`. It lifts + fades in on the container's
    /// appear, delayed by `index * 0.06 s` (web `staggerChildren`); outside a container it renders in its
    /// final, fully-visible state.
    func staggerChild(index: Int) -> some View {
        modifier(StaggerContainerChildModifier(index: index))
    }
}

// MARK: - Empty-content leaf (native — never a blank box)

/// The friendly leaf a host passes when there is nothing to stagger — a labelled card rather than a bare box
/// (native HIG). The web container simply hosts no children; the native peer states the condition so the
/// surface never collapses to an unexplained empty space. Token-driven (P1/S9); copy via the P1/S10 facade;
/// combined into a single VoiceOver element.
public struct StaggerContainerEmptyContent: View {
    public init() {}

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "rectangle.stack")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: StaggerContainerStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: StaggerContainerStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(StaggerContainerStrings.emptyTitle). \(StaggerContainerStrings.emptyMessage)")
        )
    }
}
