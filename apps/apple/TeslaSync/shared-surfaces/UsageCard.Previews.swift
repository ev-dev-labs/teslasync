//
//  UsageCard.Previews.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  Xcode previews for every real branch of the usage card: the full card (budget + bands + details +
//  top-lists + banner + footer), the warn / danger intents, the over-budget overflow (pct > 100 → clamped
//  bar, unclamped spoken value), the footer link variants (primary / secondary, internal / external), and
//  the empty leaf. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .padding(TSSpacing.md)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleBands(over: Bool) -> [UsageCardBand] {
        [
            UsageCardBand(
                id: "calls", iconSystemName: "arrow.left.arrow.right",
                label: "API calls", value: "4,182", sub: "today"
            ),
            UsageCardBand(
                id: "tokens", iconSystemName: "number",
                label: "Tokens", value: "1.2M", sub: "in + out"
            ),
            UsageCardBand(
                id: "cost", iconSystemName: "creditcard",
                label: "Spend", value: over ? "$5.40" : "$0.42",
                sub: over ? "over credit" : "this cycle", intent: over ? .danger : .normal
            )
        ]
    }

    private func sampleDetails() -> [UsageCardDetail] {
        [
            UsageCardDetail(id: "useful", label: "Useful requests", value: "3,901"),
            UsageCardDetail(id: "skipped", label: "Skipped polls", value: "281"),
            UsageCardDetail(id: "latency", label: "Avg latency", value: "412 ms"),
            UsageCardDetail(id: "errors", label: "Error rate", value: "2.4%", intent: .warn)
        ]
    }

    private func sampleTopLists() -> [UsageCardTopList] {
        [
            UsageCardTopList(
                id: "models", iconSystemName: "cpu", title: "Top models",
                items: [
                    UsageCardTopListItem(id: "m1", label: "claude-opus-4.8", value: "2,104"),
                    UsageCardTopListItem(id: "m2", label: "gpt-5.5", value: "1,488")
                ]
            ),
            UsageCardTopList(
                id: "routes", iconSystemName: "point.topleft.down.curvedto.point.bottomright.up",
                title: "Top endpoints",
                items: [
                    UsageCardTopListItem(id: "r1", label: "/v1/messages", value: "3,210"),
                    UsageCardTopListItem(id: "r2", label: "/v1/embeddings", value: "972")
                ]
            )
        ]
    }

    private func sampleFooter() -> [UsageCardFooterLink] {
        [
            UsageCardFooterLink(
                id: "usage", destination: "/settings/usage", label: "Usage history", primary: true
            ),
            UsageCardFooterLink(
                id: "docs", destination: "https://example.com/docs", label: "Provider docs", external: true
            )
        ]
    }

    private func budget(pct: Double, over: Bool) -> UsageCardBudget {
        UsageCardBudget(
            headline: over ? "$5.40 of $5.00" : "$0.42 of $5.00",
            rightLabel: over ? "108% of credit" : "8% of credit",
            caption: "Day 5 of 30 · resets in 25 days",
            pct: pct,
            intent: over ? .danger : .normal,
            accessibilityLabel: "Monthly AI credit usage"
        )
    }

    #Preview("Full card — normal") {
        staged("budget + bands + details + top-lists + footer") {
            UsageCard(
                budget: budget(pct: 8, over: false),
                bands: sampleBands(over: false),
                details: sampleDetails(),
                topLists: sampleTopLists(),
                footer: sampleFooter(),
                onNavigate: { _ in }
            )
        }
    }

    #Preview("Over budget — danger + banner") {
        staged("pct > 100 · clamped bar, unclamped spoken value · danger banner") {
            UsageCard(
                budget: budget(pct: 108, over: true),
                bands: sampleBands(over: true),
                banner: UsageCardBanner(
                    title: "Over monthly credit",
                    description: "Calls now bill at the on-demand rate until the cycle resets."
                ),
                footer: sampleFooter(),
                onNavigate: { _ in }
            )
        }
    }

    #Preview("Warn intent") {
        staged("warn budget + warn band") {
            UsageCard(
                budget: budget(pct: 82, over: false),
                bands: [
                    UsageCardBand(
                        id: "cost", iconSystemName: "creditcard", label: "Spend",
                        value: "$4.10", sub: "82% of credit", intent: .warn
                    )
                ]
            )
        }
    }

    #Preview("Empty") {
        staged("no section present · never a blank panel") {
            UsageCard()
        }
    }
#endif
