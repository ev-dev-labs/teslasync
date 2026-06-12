//
//  PageHeaderSticky.Views.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The presentational pieces of the sticky bar: the bar chrome that renders the resolved presentation
//  (the native parity of the web rendered sticky `<div>` / `<button>` — a backdrop-blurred bar with a
//  bottom hairline, a truncating summary row, and a trailing up-arrow glyph when it is a scroll-to-top
//  affordance) and a DEBUG-only inspector that stages every REAL branch (a live scroll demo that reveals
//  the bar, the scroll-to-top + plain variants, a long-summary truncation case, and a friendly note for
//  the hidden branch where the web renderer shows nothing) so the previews + the view-composition tests
//  have a concrete reference. All copy resolves through P1/S10; all chrome is token-driven (P1/S9);
//  transitions respect Reduce Motion; no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - PageHeaderStickyBar (web rendered sticky `<div>` / `<button>`)

/// The sticky bar chrome — the native parity of the web rendered bar. It draws a backdrop-blurred glass
/// surface with a bottom hairline border, a single-line truncating summary row (web `flex-1 min-w-0
/// truncate`), and — when the resolved presentation is a scroll-to-top affordance — a trailing up-arrow
/// glyph (web `<ArrowUp>`) and a full-width button wrapper whose accessibility label is the composed
/// `${ariaLabel} — scroll to top`. A plain (non-interactive) bar is instead a labeled region. It honors
/// `topOffset` as the top inset (web `style={{ top }}`).
public struct PageHeaderStickyBar<Summary: View>: View {
    private let presentation: PageHeaderStickyPresentation
    private let onScrollToTop: (() -> Void)?
    private let summary: Summary

    public init(
        presentation: PageHeaderStickyPresentation,
        onScrollToTop: (() -> Void)? = nil,
        @ViewBuilder summary: () -> Summary
    ) {
        self.presentation = presentation
        self.onScrollToTop = onScrollToTop
        self.summary = summary()
    }

    public var body: some View {
        barContent
            .background(surface)
            .overlay(alignment: .bottom) { hairline }
    }

    /// The scroll-to-top button (web default) vs. the plain labeled region (web `scrollToTop={false}`).
    @ViewBuilder
    private var barContent: some View {
        if presentation.isScrollToTop {
            Button { onScrollToTop?() } label: { row }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: presentation.scrollToTopLabel))
                .accessibilityAddTraits(.isButton)
        } else {
            row
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: presentation.regionLabel))
        }
    }

    /// The summary row — the truncating content plus the trailing up-arrow when interactive (web
    /// `flex items-center gap-3 px-4 py-2`).
    private var row: some View {
        HStack(spacing: TSSpacing.md) {
            summary
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if presentation.isScrollToTop {
                Image(systemName: "arrow.up")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.sm)
        .padding(.top, presentation.topOffset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
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

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// The DEBUG sample summaries + presentations — a small, representative slice so the previews + tests
    /// exercise every real branch of the bar. All copy routes through the P1/S10 facade (DEBUG keys).
    enum PageHeaderStickySampleData {
        /// A representative compressed page summary (web example: "🚗 Test Model Y · 4 drives · avg Ⓑ").
        static var summary: String {
            PageHeaderStickyStrings.string("pageHeaderSticky.sample.summary", "Test Model Y · Last 30 days · 4 drives")
        }

        /// An over-long summary that forces single-line truncation (web `truncate`).
        static var longSummary: String {
            PageHeaderStickyStrings.string(
                "pageHeaderSticky.sample.longSummary",
                "Test Model Y · Last 90 days · 142 drives · 3,820 mi · 263 Wh/mi · 18 charges · 92% efficiency"
            )
        }

        static let ariaLabel = "Drive history summary"

        /// Builds a VISIBLE presentation for a mode — drives the direct bar previews without scrolling.
        static func presentation(mode: PageHeaderStickyMode) -> PageHeaderStickyPresentation {
            PageHeaderStickyProjection.resolve(
                config: PageHeaderStickyConfig(
                    targetID: "drives-overview",
                    ariaLabel: ariaLabel,
                    scrollToTop: mode == .scrollToTop
                ),
                // targetTop < 0 and not intersecting → visible (the hero has scrolled above the top).
                geometry: PageHeaderStickyGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800),
                localize: PageHeaderStickyStrings.localize
            )
        }
    }

    /// One staged scenario the inspector renders directly (without scrolling).
    enum PageHeaderStickyScenario: String, CaseIterable, Identifiable {
        case scrollToTop
        case plain
        case longContent

        var id: String {
            rawValue
        }

        var mode: PageHeaderStickyMode {
            self == .plain ? .plain : .scrollToTop
        }

        var summaryText: String {
            self == .longContent ? PageHeaderStickySampleData.longSummary : PageHeaderStickySampleData.summary
        }

        var titleKey: String {
            "pageHeaderSticky.sample.scenario.\(rawValue)"
        }

        var titleFallback: String {
            switch self {
            case .scrollToTop: "Scroll-to-top button (default)"
            case .plain: "Plain bar (scrollToTop = false)"
            case .longContent: "Long summary (truncated)"
            }
        }
    }

    // MARK: - Inspector rows (every branch rendered — never a blank box)

    /// One inspector row: the scenario title plus the bar rendered for that scenario.
    struct PageHeaderStickyScenarioRow: View {
        let scenario: PageHeaderStickyScenario

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: PageHeaderStickyStrings.string(scenario.titleKey, scenario.titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                PageHeaderStickyBar(
                    presentation: PageHeaderStickySampleData.presentation(mode: scenario.mode),
                    onScrollToTop: {},
                    summary: { Text(verbatim: scenario.summaryText) }
                )
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The hidden-branch note — the web renderer shows nothing until the hero scrolls past, so the
    /// inspector explains it rather than leaving a blank box.
    struct PageHeaderStickyHiddenRow: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: PageHeaderStickyStrings.string(
                    "pageHeaderSticky.sample.scenario.hidden",
                    "Hidden (hero in view)"
                ))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "eye.slash")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: PageHeaderStickyStrings.string(
                        "pageHeaderSticky.sample.note.hidden",
                        "Bar hidden until the hero scrolls above the top"
                    ))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Live scroll sample (the real hidden ⇄ visible transition)

    /// A real `ScrollView` with a tall hero marked ``SwiftUI/View/pageHeaderStickyTarget()`` and the
    /// ``SwiftUI/View/pageHeaderSticky(targetID:ariaLabel:scrollToTop:topOffset:testID:summary:)`` bar —
    /// scrolling past the hero reveals the bar exactly as a real page does.
    struct PageHeaderStickyLiveSample: View {
        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    hero
                    ForEach(0 ..< 12, id: \.self) { index in
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .fill(Color.TS.surface)
                            .frame(height: 64)
                            .overlay(alignment: .leading) {
                                Text(verbatim: PageHeaderStickyStrings.string(
                                    "pageHeaderSticky.sample.row",
                                    "Drive"
                                ) + " #\(index + 1)")
                                    .font(Font.TS.body)
                                    .foregroundStyle(Color.TS.textSecondary)
                                    .padding(.leading, TSSpacing.md)
                            }
                    }
                }
                .padding(TSSpacing.md)
            }
            .pageHeaderSticky(targetID: "drives-overview", ariaLabel: PageHeaderStickySampleData.ariaLabel) {
                Text(verbatim: PageHeaderStickySampleData.summary)
            }
            .background(Color.TS.bg)
        }

        private var hero: some View {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(Color.TS.surface)
                .frame(height: 240)
                .overlay {
                    Text(verbatim: PageHeaderStickyStrings.string("pageHeaderSticky.sample.hero", "Overview"))
                        .font(Font.TS.title)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .pageHeaderStickyTarget()
        }
    }

    /// The DEBUG inspector: the live scroll demo plus every direct branch and the hidden note.
    struct PageHeaderStickyInspector: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(PageHeaderStickyScenario.allCases) { scenario in
                    PageHeaderStickyScenarioRow(scenario: scenario)
                }
                PageHeaderStickyHiddenRow()
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }
#endif
