//
//  HelpTooltip.Previews.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  Xcode previews for every branch of the help "?" tooltip: the body standalone (copy only), the body with a
//  "Learn more" link, the interactive default trigger across the three glyph sizes, a custom-glyph trigger
//  (the web `children` escape hatch), the four placements, and the no-content branch (the web `return null`)
//  shown collapsed next to a sibling label so its zero footprint is visible. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    @MainActor
    private func sampleController(
        text: String = "Energy lost while parked — the battery self-discharge plus standby electronics.",
        learnMore: HelpTooltipLearnMore? = nil,
        placement: HelpTooltipPlacement = .top,
        size: HelpTooltipSize = .sm
    ) -> HelpTooltipController {
        HelpTooltipController(text: text, learnMore: learnMore, placement: placement, size: size)
    }

    /// A labelled metric title with its help affordance trailing — the canonical web call site (a "?" next to
    /// a non-obvious metric name).
    @MainActor
    private struct LabeledHelpRow<Icon: View>: View {
        let title: String
        let tooltip: HelpTooltip<Icon>

        var body: some View {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                tooltip
            }
        }
    }

    #Preview("Body · copy only") {
        staged("the revealed tooltip body — explanatory copy") {
            HelpTooltipBody(
                content: HelpTooltipContent(
                    text: "Energy lost while parked — the battery self-discharge plus standby electronics."
                ),
                learnMoreLabel: HelpTooltipStrings.learnMoreDefault
            )
            .tsGlassPanel(cornerRadius: TSRadius.md)
        }
    }

    #Preview("Body · with Learn more") {
        staged("body + external 'Learn more' link (opens in the browser)") {
            HelpTooltipBody(
                content: HelpTooltipContent(
                    text: "Vampire drain is the slow battery loss while the car sits idle.",
                    learnMore: HelpTooltipLearnMore(url: "https://teslasync.io/docs/vampire-drain")
                ),
                learnMoreLabel: HelpTooltipStrings.learnMoreDefault
            )
            .tsGlassPanel(cornerRadius: TSRadius.md)
        }
    }

    #Preview("Trigger · sizes") {
        staged("tap the ? to reveal — xs · sm · md") {
            HStack(spacing: TSSpacing.lg) {
                HelpTooltip(controller: sampleController(size: .xs))
                HelpTooltip(controller: sampleController(size: .sm))
                HelpTooltip(controller: sampleController(size: .md))
            }
            .tsGlassPanel()
            .padding(TSSpacing.md)
        }
    }

    #Preview("Trigger · beside a metric title") {
        staged("the canonical call site — a ? beside a non-obvious label") {
            LabeledHelpRow(
                title: "Vampire Drain",
                tooltip: HelpTooltip(controller: sampleController(
                    text: "Energy lost while parked — battery self-discharge plus standby electronics.",
                    learnMore: HelpTooltipLearnMore(url: "https://teslasync.io/docs/vampire-drain")
                ))
            )
            .tsGlassPanel()
            .padding(TSSpacing.md)
        }
    }

    #Preview("Trigger · custom glyph") {
        staged("the web `children` escape hatch — a custom glyph in the same button") {
            HelpTooltip(controller: sampleController()) {
                Image(systemName: "info.circle")
                    .font(.system(size: 16, weight: .regular))
                    .accessibilityHidden(true)
            }
            .tsGlassPanel()
            .padding(TSSpacing.md)
        }
    }

    #Preview("Trigger · placements") {
        staged("top · bottom · leading · trailing") {
            HStack(spacing: TSSpacing.lg) {
                HelpTooltip(controller: sampleController(placement: .top))
                HelpTooltip(controller: sampleController(placement: .bottom))
                HelpTooltip(controller: sampleController(placement: .leading))
                HelpTooltip(controller: sampleController(placement: .trailing))
            }
            .tsGlassPanel()
            .padding(TSSpacing.md)
        }
    }

    #Preview("No content · collapses") {
        staged("empty props resolve to nothing (web `return null`) — the row stays tight") {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: "Range")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                HelpTooltip(controller: HelpTooltipController())
            }
            .tsGlassPanel()
            .padding(TSSpacing.md)
        }
    }
#endif
