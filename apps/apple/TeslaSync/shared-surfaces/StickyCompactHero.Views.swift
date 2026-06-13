//
//  StickyCompactHero.Views.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The presentational pieces of the compact hero bar: the bar chrome that renders the resolved
//  presentation (the native parity of the web rendered sticky `<div role="region">` — a backdrop-blurred
//  bar with a bottom hairline, a scroll-to-top button carrying the status icon + short headline in the
//  status hue, an optional "· last-checked" run, a trailing up-arrow, and an optional refresh button), the
//  refresh button (web `<RefreshCw>` with `animate-spin` while refreshing, honouring Reduce Motion), and a
//  DEBUG-only inspector that stages every REAL branch (each status, the with / without last-checked label,
//  the with / without refresh affordance, the refreshing case, and a friendly note for the hidden branch
//  the web renders as nothing) so the previews + the view-composition tests have a concrete reference. All
//  copy resolves through P1/S10; all chrome is token-driven (P1/S9); transitions respect Reduce Motion; no
//  raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - StickyCompactHeroBar (web rendered sticky `<div role="region">`)

/// The compact hero bar chrome — the native parity of the web rendered bar. It draws a backdrop-blurred
/// glass surface with a bottom hairline border, a full-width scroll-to-top button (the status icon + the
/// short headline in the status hue, an optional "· last-checked" run, and a trailing up-arrow glyph), and
/// — when the resolved presentation has a refresh affordance — a trailing refresh button that spins while
/// refreshing. The button labels are the composed `Scroll to top of page` / `Refresh status`; the whole
/// bar is one labelled region (web `role="region" aria-label="Status summary"`). It honours `topOffset` as
/// the top inset (web `style={{ top }}`).
public struct StickyCompactHeroBar: View {
    private let presentation: StickyCompactHeroPresentation
    private let onScrollToTop: (() -> Void)?
    private let onRefresh: (() -> Void)?

    public init(
        presentation: StickyCompactHeroPresentation,
        onScrollToTop: (() -> Void)? = nil,
        onRefresh: (() -> Void)? = nil
    ) {
        self.presentation = presentation
        self.onScrollToTop = onScrollToTop
        self.onRefresh = onRefresh
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            scrollToTopButton
            if presentation.showsRefresh {
                StickyCompactHeroRefreshButton(
                    label: presentation.refreshLabel,
                    refreshingValue: presentation.refreshingValue,
                    isRefreshing: presentation.isRefreshing,
                    action: { onRefresh?() }
                )
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.sm)
        .padding(.top, presentation.topOffset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface)
        .overlay(alignment: .bottom) { hairline }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: presentation.regionLabel))
    }

    /// The full-width scroll-to-top button — web `<button onClick={handleScrollTop}>`. Carries the status
    /// icon + the short headline (status hue), the optional "· last-checked" run, and the trailing
    /// up-arrow; its accessibility label is `Scroll to top of page` and its value is the spoken status
    /// summary (so VoiceOver announces the health the icon conveys visually).
    private var scrollToTopButton: some View {
        Button { onScrollToTop?() } label: { summaryRow }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .accessibilityLabel(Text(verbatim: presentation.scrollToTopLabel))
            .accessibilityValue(Text(verbatim: presentation.regionValue))
            .accessibilityAddTraits(.isButton)
    }

    /// The status run — web `flex flex-1 items-center gap-2`: the status icon, the short headline, the
    /// optional "· last-checked" label, and the trailing up-arrow glyph.
    private var summaryRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: presentation.iconSystemName)
                .font(Font.TS.body)
                .foregroundStyle(presentation.status.tone.color)
                .accessibilityHidden(true)
            Text(verbatim: presentation.headline)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(presentation.status.tone.color)
                .lineLimit(1)
            if presentation.showsLastChecked, let lastChecked = presentation.lastCheckedLabel {
                Text(verbatim: "· \(lastChecked)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            Image(systemName: "arrow.up")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }

    /// The backdrop-blurred glass surface — web `bg-[var(--bg-1)]/95 backdrop-blur`.
    private var surface: some View {
        Color.TS.surfaceGlass.background(.ultraThinMaterial)
    }

    /// The bottom hairline — web `border-b border-white/[0.06]`.
    private var hairline: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

// MARK: - StickyCompactHeroRefreshButton (web `<button><RefreshCw animate-spin></button>`)

/// The refresh affordance — the native peer of the web refresh `<button>` with the `<RefreshCw>` glyph
/// that spins while refreshing. It is a 36×36 minimum tap target (web `min-h-[36px] min-w-[36px]`),
/// disabled and dimmed while a refresh is in flight (web `disabled={refreshing}` + `opacity-60`), and
/// spoken as `Refresh status` with a `Refreshing` value while busy. The continuous spin honours Reduce
/// Motion: when motion is reduced the glyph stays still and the in-flight state is conveyed by the dimmed,
/// disabled chrome + the accessibility value alone.
struct StickyCompactHeroRefreshButton: View {
    let label: String
    let refreshingValue: String
    let isRefreshing: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var angle: Double = 0

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .rotationEffect(.degrees(angle))
                .frame(minWidth: 36, minHeight: 36)
                .contentShape(Rectangle())
                .opacity(isRefreshing ? 0.6 : 1)
        }
        .buttonStyle(.plain)
        .disabled(isRefreshing)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: isRefreshing ? refreshingValue : ""))
        .onAppear { syncSpin(isRefreshing) }
        .onChange(of: isRefreshing) { _, refreshing in syncSpin(refreshing) }
        .onChange(of: reduceMotion) { _, _ in syncSpin(isRefreshing) }
    }

    /// Starts or stops the continuous spin — a linear `repeatForever` rotation while refreshing, snapped
    /// back to rest otherwise. Skipped entirely under Reduce Motion (the glyph stays still).
    private func syncSpin(_ refreshing: Bool) {
        if refreshing, !reduceMotion {
            angle = 0
            withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) {
                angle = 360
            }
        } else {
            withAnimation(.none) { angle = 0 }
        }
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// The DEBUG sample presentations — a small, representative slice so the previews + tests exercise
    /// every real branch of the bar (each status, with / without last-checked, with / without refresh, and
    /// the refreshing case). All copy routes through the P1/S10 facade (DEBUG fallbacks).
    enum StickyCompactHeroSampleData {
        /// A representative last-checked relative label (web example: "12s ago").
        static var lastChecked: String {
            StickyCompactHeroStrings.string("stickyCompactHero.sample.lastChecked", "12s ago")
        }

        /// Builds a VISIBLE presentation for a status + state — drives the direct bar previews + the
        /// view-composition tests without scrolling. The geometry is a scrolled-past snapshot
        /// (`targetTop < 0`, not intersecting), so the projection resolves `isVisible == true`.
        static func presentation(
            status: StickyCompactHeroStatus,
            showsLastChecked: Bool = true,
            hasRefresh: Bool = true,
            refreshing: Bool = false
        ) -> StickyCompactHeroPresentation {
            StickyCompactHeroProjection.resolve(
                config: StickyCompactHeroConfig(
                    status: status,
                    lastCheckedLabel: showsLastChecked ? lastChecked : nil,
                    hasRefresh: hasRefresh,
                    refreshing: refreshing
                ),
                geometry: StickyCompactHeroGeometry(targetTop: -160, targetBottom: -40, viewportHeight: 800),
                localize: StickyCompactHeroStrings.localize
            )
        }
    }

    /// One staged scenario the inspector renders directly (without scrolling) — every real branch of the
    /// bar gets a row, so no state is hidden behind a blank box.
    enum StickyCompactHeroScenario: String, CaseIterable, Identifiable {
        case healthy
        case degraded
        case unhealthy
        case unknown
        case maintenance
        case refreshing
        case noLastChecked
        case noRefresh

        var id: String {
            rawValue
        }

        var status: StickyCompactHeroStatus {
            switch self {
            case .healthy, .refreshing, .noLastChecked, .noRefresh: .healthy
            case .degraded: .degraded
            case .unhealthy: .unhealthy
            case .unknown: .unknown
            case .maintenance: .maintenance
            }
        }

        var presentation: StickyCompactHeroPresentation {
            StickyCompactHeroSampleData.presentation(
                status: status,
                showsLastChecked: self != .noLastChecked,
                hasRefresh: self != .noRefresh,
                refreshing: self == .refreshing
            )
        }

        var titleKey: String {
            "stickyCompactHero.sample.scenario.\(rawValue)"
        }

        var titleFallback: String {
            switch self {
            case .healthy: "Healthy · last-checked · refresh"
            case .degraded: "Degraded"
            case .unhealthy: "Outage"
            case .unknown: "Status unknown"
            case .maintenance: "Maintenance"
            case .refreshing: "Refreshing (spinner)"
            case .noLastChecked: "No last-checked label"
            case .noRefresh: "No refresh affordance"
            }
        }
    }

    // MARK: - Inspector rows (every branch rendered — never a blank box)

    /// One inspector row: the scenario title plus the bar rendered for that scenario.
    struct StickyCompactHeroScenarioRow: View {
        let scenario: StickyCompactHeroScenario

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: StickyCompactHeroStrings.string(scenario.titleKey, scenario.titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                StickyCompactHeroBar(
                    presentation: scenario.presentation,
                    onScrollToTop: {},
                    onRefresh: {}
                )
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The hidden-branch note — the web renderer shows nothing until the hero scrolls past, so the
    /// inspector explains it rather than leaving a blank box.
    struct StickyCompactHeroHiddenRow: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: StickyCompactHeroStrings.string(
                    "stickyCompactHero.sample.scenario.hidden",
                    "Hidden (hero in view)"
                ))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "eye.slash")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: StickyCompactHeroStrings.string(
                        "stickyCompactHero.sample.note.hidden",
                        "Bar hidden until the hero scrolls above the top"
                    ))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The DEBUG inspector: every status + state direct branch plus the hidden note.
    struct StickyCompactHeroInspector: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(StickyCompactHeroScenario.allCases) { scenario in
                    StickyCompactHeroScenarioRow(scenario: scenario)
                }
                StickyCompactHeroHiddenRow()
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }

    // MARK: - Live scroll sample (the real hidden ⇄ visible transition)

    /// A real `ScrollView` with a tall hero marked ``SwiftUI/View/stickyCompactHeroTarget()`` and the
    /// ``SwiftUI/View/stickyCompactHero(status:lastCheckedLabel:onRefresh:refreshing:topOffset:telemetry:)``
    /// bar — scrolling past the hero reveals the compact bar exactly as a real page does, and the refresh
    /// button toggles the in-flight spinner.
    struct StickyCompactHeroLiveSample: View {
        @State private var refreshing = false

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    hero
                    ForEach(0 ..< 12, id: \.self) { index in
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .fill(Color.TS.surface)
                            .frame(height: 64)
                            .overlay(alignment: .leading) {
                                Text(verbatim: StickyCompactHeroStrings.string(
                                    "stickyCompactHero.sample.row",
                                    "Section"
                                ) + " #\(index + 1)")
                                    .font(Font.TS.body)
                                    .foregroundStyle(Color.TS.textSecondary)
                                    .padding(.leading, TSSpacing.md)
                            }
                    }
                }
                .padding(TSSpacing.md)
            }
            .stickyCompactHero(
                status: .healthy,
                lastCheckedLabel: StickyCompactHeroSampleData.lastChecked,
                onRefresh: { refreshing.toggle() },
                refreshing: refreshing
            )
            .background(Color.TS.bg)
        }

        private var hero: some View {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(Color.TS.surface)
                .frame(height: 240)
                .overlay {
                    Text(verbatim: StickyCompactHeroStrings.string("stickyCompactHero.sample.hero", "Instance health"))
                        .font(Font.TS.title)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .stickyCompactHeroTarget()
        }
    }
#endif
