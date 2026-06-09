//
//  SlideRenderer.Views.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  The presentational building blocks of the SlideRenderer surface:
//    • `SlideGradientBackground` — the web `bg-gradient-to-br` + `slide.bg`, top-leading→bottom-
//      trailing, from the adapter's resolved stops.
//    • `SlideTransitionContainer` — the web `AnimatePresence mode="wait"` + `motion.div` keyed by the
//      slide index (enter from x:+50 / fade-in, exit to x:-50 / fade-out, easeInOut). Honors Reduce
//      Motion (crossfade only).
//    • `SlideDispatchContent` + `SlideHeroView` — the renderer's built-in, data-bound default body for
//      each `SlideHero` case (the parent injects the real child surfaces via the generic seam).
//    • The freshness chip + connectivity banner + loading / empty / error chrome (ADR-013 live-state +
//      the P4 states the web parent story shell owns).
//  Slide bodies sit on a fixed dark ×900 gradient, so their ink is fixed-light (not the theme-adaptive
//  tokens, which would be dark-on-dark in light mode) — matching the web `text-white` slides. Every
//  state carries an accessibility label and motion honors Reduce Motion.
//

import SwiftUI

// MARK: - Slide ink (fixed-light, for the dark ×900 gradient backdrop)

/// Fixed light foreground colors for slide bodies. The gradient backdrop is always dark (Tailwind
/// ×900) regardless of the app theme, so the slide ink is theme-independent white — exactly the web
/// `text-white` / `var(--text-secondary)` slides. Chrome OUTSIDE the gradient (loading/empty/error)
/// still uses the adaptive `Color.TS` tokens.
enum SlideInk {
    static let primary = Color.white
    static let secondary = Color.white.opacity(0.82)
    static let muted = Color.white.opacity(0.6)
    static let panel = Color.white.opacity(0.08)
    static let panelBorder = Color.white.opacity(0.12)
}

// MARK: - Gradient background (web `bg-gradient-to-br` + `slide.bg`)

/// The slide's full-bleed gradient — the native parity of the web `bg-gradient-to-br ${slide.bg}`.
/// Stops resolve in the adapter (`SlideRendererGradient`); the direction is fixed top-leading →
/// bottom-trailing.
struct SlideGradientBackground: View {
    let stops: [SlideGradientStop]

    var body: some View {
        LinearGradient(
            colors: stops.map { Color(.sRGB, red: $0.red, green: $0.green, blue: $0.blue, opacity: 1) },
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .accessibilityHidden(true)
    }
}

// MARK: - Transition container (web `AnimatePresence` + `motion.div`)

/// Wraps the keyed slide so a change of `index` animates the swap — the native parity of the web
/// `AnimatePresence mode="wait"` + `motion.div` (enter from x:+50 with fade-in, exit to x:-50 with
/// fade-out, 0.35s easeInOut). Under Reduce Motion it crossfades only.
struct SlideTransitionContainer<Content: View>: View {
    let index: Int
    @ViewBuilder var content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        content()
            .id(index)
            .transition(transition)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration), value: index)
    }

    private var transition: AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .asymmetric(
            insertion: .offset(x: 50).combined(with: .opacity),
            removal: .offset(x: -50).combined(with: .opacity)
        )
    }
}

// MARK: - Decorative emoji (web scale-in glyph)

/// A decorative slide emoji that scales + fades in on appear (web `motion.span` spring). Static under
/// Reduce Motion; accessibility-hidden (the slide's combined label speaks the content).
struct SlideEmoji: View {
    private let emoji: String
    private let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    init(_ emoji: String, size: CGFloat) {
        self.emoji = emoji
        self.size = size
    }

    var body: some View {
        Text(verbatim: emoji)
            .font(.system(size: size))
            .scaleEffect(shown ? 1 : 0.6)
            .opacity(shown ? 1 : 0)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) { shown = true }
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (ADR-013 live-state)

/// The live/stale/offline freshness chip shown over the slide. A colored dot + status word on a
/// translucent dark capsule so it reads on the gradient. Mirrors the web `DataFreshness` chip.
struct SlideRendererFreshnessChip: View {
    let connection: SlideRendererConnection
    let isFetching: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(SlideInk.secondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.28), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return SlideInk.secondary }
        switch connection {
        case .live: return Color(.sRGB, red: 0.063, green: 0.725, blue: 0.506, opacity: 1)
        case .stale: return Color(.sRGB, red: 0.961, green: 0.620, blue: 0.043, opacity: 1)
        case .offline: return SlideInk.muted
        }
    }

    private var label: String {
        if isFetching { return SlideRendererStrings.string("slideRenderer.updating", "Updating") }
        switch connection {
        case .live: return SlideRendererStrings.string("slideRenderer.live", "Live")
        case .stale: return SlideRendererStrings.string("slideRenderer.stale", "Stale")
        case .offline: return SlideRendererStrings.string("slideRenderer.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (cached-data notice)

/// The inline cached-data banner shown above the slide whenever the connection is not live, so a stale
/// or offline recap is clearly labeled. Mirrors the web story shell's reconnecting / offline notice.
struct SlideRendererConnectivityBanner: View {
    let connection: SlideRendererConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: bannerText)
                .font(Font.TS.caption)
        }
        .foregroundStyle(SlideInk.primary)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.black.opacity(0.3), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var bannerText: String {
        isOffline
            ? SlideRendererStrings.string("slideRenderer.offlineBanner", "Offline — showing last known recap")
            : SlideRendererStrings.string("slideRenderer.staleBanner", "Reconnecting — recap may be stale")
    }
}

// MARK: - Loading / empty / error chrome (every state renders)

/// The initial-fetch skeleton: a redacted slide hero (glyph + value + caption) on the surface, honoring
/// Reduce Motion via `TSSkeleton`. Carries a single "Loading …" accessibility label.
struct SlideRendererLoadingChrome: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 68, height: 68, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 160, height: 44, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 120, height: 14)
            TSSkeleton(width: 90, height: 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.x2xl)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SlideRendererStrings.string(
            "slideRenderer.loading",
            "Loading year in review"
        )))
    }
}

/// The friendly empty state shown when the recap resolved with no data. Uses `ContentUnavailableView`
/// so it is never a blank box.
struct SlideRendererEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SlideRendererStrings.string("slideRenderer.noData", "No year-in-review data"))
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            Text(verbatim: SlideRendererStrings.string(
                "slideRenderer.emptyHint",
                "Drive through the year to build up your recap."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The fetch-failure state with a retry affordance (web `QueryError`). Shows the failure detail when
/// present and a single combined accessibility element.
struct SlideRendererErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SlideRendererStrings.string("slideRenderer.errorTitle", "Couldn't load year in review"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: SlideRendererStrings.string("slideRenderer.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SlideRendererStrings.string("slideRenderer.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
