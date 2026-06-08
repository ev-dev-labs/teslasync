//
//  EnvironmentSlide.Views.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  The presentational subviews composed by `EnvironmentSlide`: the content slide (globe, label,
//  green animated figure, trees caption, staggered tree grid, overflow chip), the native flow
//  `Layout` that wraps + centers the tree glyphs (web `flex flex-wrap justify-center`), the stale /
//  offline freshness banner, and the loading / empty / error states. All consume the P1/S10 facade
//  and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Content slide (web happy-path body)

/// The populated slide (web content body). Reproduces the web composition top-to-bottom and drives
/// the same staged entrance animations, every one of which collapses to an instant reveal under
/// Reduce Motion.
struct EnvironmentSlideContent: View {
    let projection: EnvironmentSlideProjection
    let connection: EnvironmentSlideConnection
    let isFetching: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var figure = "0"

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            if connection != .live {
                EnvironmentSlideFreshnessBanner(connection: connection, isFetching: isFetching)
            }

            Text(verbatim: "🌍")
                .font(.system(size: 56))
                .accessibilityHidden(true)
                .popIn(delay: 0, reduceMotion: reduceMotion)

            EnvironmentSlideStrings.text("yearReview.co2Offset", "CO₂ offset")
                .font(Font.TS.section)
                .textCase(.uppercase)
                .tracking(1.5)
                .foregroundStyle(Color.TS.textSecondary)
                .slideIn(delay: 0.2, yOffset: 20, reduceMotion: reduceMotion)

            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                TSAnimatedNumber(formatted: figure)
                    .foregroundStyle(Color.TS.statusSuccess)
                Text(verbatim: projection.co2Unit)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            .slideIn(delay: 0.4, yOffset: 30, reduceMotion: reduceMotion)

            Text(verbatim: EnvironmentSlideStrings.trees(projection.treesPlanted))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .slideIn(delay: 0.8, yOffset: 0, reduceMotion: reduceMotion)

            if projection.treeIconCount > 0 || projection.hasOverflow {
                EnvironmentTreeGrid(projection: projection, reduceMotion: reduceMotion)
                    .slideIn(delay: 1.0, yOffset: 0, reduceMotion: reduceMotion)
            }
        }
        .frame(maxWidth: 360)
        .multilineTextAlignment(.center)
        .onAppear { figure = projection.co2Value }
        .onChange(of: projection.co2Value) { _, newValue in figure = newValue }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: EnvironmentSlideAccessibility.summary(for: projection)))
    }
}

// MARK: - Tree grid (web `flex flex-wrap justify-center gap-2`)

/// The wrapping, centered grid of tree glyphs plus the "+N more" overflow chip. The glyphs are
/// decorative — the trees-planted count is already spoken by the content slide's combined a11y
/// label — so the whole grid is hidden from VoiceOver.
struct EnvironmentTreeGrid: View {
    let projection: EnvironmentSlideProjection
    let reduceMotion: Bool

    var body: some View {
        EnvironmentTreeFlow(spacing: TSSpacing.sm) {
            ForEach(Array(0 ..< projection.treeIconCount), id: \.self) { index in
                EnvironmentTreeGlyph(index: index, reduceMotion: reduceMotion)
            }
            if projection.hasOverflow {
                Text(verbatim: overflowText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: 320)
        .accessibilityHidden(true)
    }

    /// Web `+{treesPlanted - 30} {t('more')}`.
    private var overflowText: String {
        let more = EnvironmentSlideStrings.string("yearReview.more", "more")
        return "+\(projection.overflow) \(more)"
    }
}

/// One tree glyph that springs in with the web per-index stagger (`delay: 1.1 + i * 0.05`). Under
/// Reduce Motion it is shown immediately at full scale.
struct EnvironmentTreeGlyph: View {
    let index: Int
    let reduceMotion: Bool

    @State private var shown = false

    var body: some View {
        Text(verbatim: "🌳")
            .font(.system(size: 28))
            .scaleEffect(shown || reduceMotion ? 1 : 0.01)
            .opacity(shown || reduceMotion ? 1 : 0)
            .onAppear {
                guard !reduceMotion else {
                    shown = true
                    return
                }
                let delay = 1.1 + Double(index) * 0.05
                withAnimation(.spring(response: 0.4, dampingFraction: 0.6).delay(delay)) {
                    shown = true
                }
            }
    }
}

// MARK: - Flow layout (web `flex-wrap justify-center`)

/// A wrapping, per-row-centered flow layout — the native primitive standing in for the web
/// `flex flex-wrap justify-center`. Lays children left-to-right, wrapping to a new row when the next
/// child would exceed the proposed width, and centers each row horizontally.
struct EnvironmentTreeFlow: Layout {
    var spacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let rows = layoutRows(maxWidth: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let rows = layoutRows(maxWidth: bounds.width, subviews: subviews)
        var originY = bounds.minY
        for row in rows {
            let rowOriginX = bounds.minX + max(0, (bounds.width - row.width) / 2)
            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: rowOriginX + item.xOffset, y: originY),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(item.size)
                )
            }
            originY += row.height + spacing
        }
    }

    private func layoutRows(maxWidth: CGFloat, subviews: Subviews) -> [FlowRow] {
        let limit = maxWidth.isFinite ? maxWidth : .greatestFiniteMagnitude
        var rows: [FlowRow] = []
        var current = FlowRow()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !current.items.isEmpty, current.width + spacing + size.width > limit {
                rows.append(current)
                current = FlowRow()
            }
            let xOffset = current.items.isEmpty ? 0 : current.width + spacing
            current.items.append(FlowItem(index: index, xOffset: xOffset, size: size))
            current.width = xOffset + size.width
            current.height = max(current.height, size.height)
        }
        if !current.items.isEmpty {
            rows.append(current)
        }
        return rows
    }
}

/// One placed child within a flow row.
private struct FlowItem {
    let index: Int
    let xOffset: CGFloat
    let size: CGSize
}

/// One accumulated flow row.
private struct FlowRow {
    var items: [FlowItem] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
}

// MARK: - Freshness banner (stale / offline — P4 connection states)

/// The stale / offline banner shown above the cached slide when the query is not live — the native
/// parity of the web `DataFreshness` chip. The slide stays visible behind it (last-known recap)
/// while a stale query auto-refreshes.
struct EnvironmentSlideFreshnessBanner: View {
    let connection: EnvironmentSlideConnection
    let isFetching: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var symbol: String {
        switch connection {
        case .offline: "wifi.slash"
        case .stale: isFetching ? "arrow.clockwise" : "clock.arrow.circlepath"
        case .live: "checkmark.circle"
        }
    }

    private var tone: Color {
        switch connection {
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        case .live: Color.TS.statusSuccess
        }
    }

    private var label: String {
        switch connection {
        case .offline:
            return EnvironmentSlideStrings.string("environment.offlineBanner", "Offline — showing last known recap")
        case .stale:
            let key = isFetching ? "environment.updatingBanner" : "environment.staleBanner"
            let fallback = isFetching ? "Refreshing your recap…" : "Reconnecting — recap may be stale"
            return EnvironmentSlideStrings.string(key, fallback)
        case .live:
            return EnvironmentSlideStrings.string("environment.liveBanner", "Live")
        }
    }
}

// MARK: - Loading (web initial fetch → skeleton chrome)

/// The initial-fetch skeleton: a redacted echo of the slide's shape (globe disc, label, figure,
/// caption, a short row of tree blocks). Shimmer respects Reduce Motion via `TSSkeleton`.
struct EnvironmentSlideLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(width: 64, height: 64, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 120, height: 12)
            TSSkeleton(width: 180, height: 32, cornerRadius: TSRadius.md)
            TSSkeleton(width: 160, height: 12)
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: 360)
        .accessibilityElement()
        .accessibilityLabel(
            EnvironmentSlideStrings.text("environment.loadingA11y", "Loading environmental recap")
        )
    }
}

// MARK: - Empty (web data resolved, no recap)

/// The friendly empty state shown when the recap resolves with no data — never a blank slide.
struct EnvironmentSlideEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                EnvironmentSlideStrings.text("environment.emptyTitle", "No environmental recap yet")
            } icon: {
                Image(systemName: "leaf")
            }
        } description: {
            EnvironmentSlideStrings.text(
                "environment.emptyHint",
                "Drive through the year to grow your forest."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error (web fetch failed → QueryError equivalent + retry)

/// The failure state — the P4 states contract's `QueryError` equivalent: an icon, a title, the
/// upstream message, and a retry affordance wired to the model's refresh.
struct EnvironmentSlideErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)

            EnvironmentSlideStrings.text("environment.errorTitle", "Couldn't load your environmental recap")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)

            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: onRetry) {
                EnvironmentSlideStrings.text("environment.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(EnvironmentSlideStrings.text("environment.retry", "Retry"))
        }
        .frame(maxWidth: 360)
        .accessibilityElement(children: .combine)
    }
}
