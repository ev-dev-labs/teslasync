//
//  WidgetShell.Previews.swift
//  TeslaSync — P4 widget primitive · 0013 · WidgetShell (Apple)
//
//  Xcode previews for every render branch of the primitive: loading skeleton, error state, the titled
//  content surface (plain / with the full chrome of help + freshness + pin + actions), each of the four
//  freshness states (fresh / fetching / stale / error), the title-less overlay variant, and the
//  no-padding variant. DEBUG-only. The content slot is a small metric block so composition is visible.
//

import Foundation
import SwiftUI

#if DEBUG
    private struct WidgetShellSampleContent: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: "82%")
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: "State of health")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func widgetShellMillis(minutesAgo: Double) -> Double {
        Date().addingTimeInterval(-minutesAgo * 60).timeIntervalSince1970 * 1000
    }

    /// Sample "Learn more" destination (built with a `??` fallback — no force-unwrap).
    private let widgetShellPreviewURL = URL(string: "https://example.com") ?? URL(fileURLWithPath: "/")

    private func widgetShellCard(
        _ view: some View,
        width: CGFloat = 280,
        height: CGFloat = 150
    ) -> some View {
        view
            .frame(width: width, height: height)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        widgetShellCard(
            WidgetShell(title: "Battery", loading: true) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Error — no retry") {
        widgetShellCard(
            WidgetShell(title: "Battery", error: "network down") {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Error — with retry") {
        widgetShellCard(
            WidgetShell(
                title: "Battery",
                error: "network down",
                freshness: WidgetShellFreshness(isError: true, onRefresh: {})
            ) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Titled — plain") {
        widgetShellCard(
            WidgetShell(title: "Battery health") {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Titled — full chrome") {
        widgetShellCard(
            WidgetShell(
                title: "Battery health",
                freshness: WidgetShellFreshness(updatedAtMillis: widgetShellMillis(minutesAgo: 5), onRefresh: {}),
                help: WidgetHelp(
                    text: "State of health is the usable capacity relative to a new pack.",
                    learnMore: WidgetHelpLink(url: widgetShellPreviewURL, label: "Learn more")
                ),
                pin: WidgetShellPin(isPinned: false, onToggle: {}),
                icon: { Image(systemName: "battery.100") },
                actions: { Image(systemName: "ellipsis") },
                content: { WidgetShellSampleContent() }
            ),
            width: 340,
            height: 160
        )
    }

    #Preview("Freshness — fresh") {
        widgetShellCard(
            WidgetShell(
                title: "Live signal",
                freshness: WidgetShellFreshness(updatedAtMillis: widgetShellMillis(minutesAgo: 0.2), onRefresh: {})
            ) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Freshness — fetching") {
        widgetShellCard(
            WidgetShell(
                title: "Live signal",
                freshness: WidgetShellFreshness(
                    updatedAtMillis: widgetShellMillis(minutesAgo: 3),
                    isFetching: true,
                    onRefresh: {}
                )
            ) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Freshness — stale") {
        widgetShellCard(
            WidgetShell(
                title: "Daily summary",
                freshness: WidgetShellFreshness(
                    updatedAtMillis: widgetShellMillis(minutesAgo: 90),
                    isStale: true,
                    onRefresh: {}
                )
            ) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Freshness — error") {
        widgetShellCard(
            WidgetShell(
                title: "Daily summary",
                freshness: WidgetShellFreshness(isError: true, onRefresh: {})
            ) {
                WidgetShellSampleContent()
            }
        )
    }

    #Preview("Title-less — overlay freshness") {
        widgetShellCard(
            WidgetShell(
                freshness: WidgetShellFreshness(updatedAtMillis: widgetShellMillis(minutesAgo: 2), onRefresh: {})
            ) {
                ZStack {
                    Text(verbatim: "1,204")
                        .font(Font.TS.display)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            },
            width: 150,
            height: 150
        )
    }

    #Preview("No padding") {
        widgetShellCard(
            WidgetShell(title: "Map", noPadding: true) {
                Color.TS.accent.opacity(0.25)
            }
        )
    }
#endif
