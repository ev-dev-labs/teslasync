//
//  WidgetEventFeed.Previews.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  Xcode previews for each surface state (the full + compact timeline feeds with mixed tones /
//  severities / drill-through, plus empty / custom-empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum WidgetEventFeedPreviewData {
        static func sample() -> [WidgetEventFeedItem] {
            let now = Date()
            return [
                WidgetEventFeedItem(
                    id: "1",
                    iconSymbol: "bolt.fill",
                    title: "Charging started",
                    subtitle: "Home · 11 kW",
                    timestamp: now.addingTimeInterval(-30),
                    tone: .success,
                    severity: .info,
                    href: "/charging/42"
                ),
                WidgetEventFeedItem(
                    id: "2",
                    iconSymbol: "car.fill",
                    title: "Drive completed",
                    subtitle: "42.6 km · 38 min",
                    timestamp: now.addingTimeInterval(-25 * 60),
                    tone: .accent,
                    href: "/drives/108"
                ),
                WidgetEventFeedItem(
                    id: "3",
                    iconSymbol: "thermometer.snowflake",
                    title: "Cabin overheat protection on",
                    subtitle: "Interior reached 41°C",
                    timestamp: now.addingTimeInterval(-3 * 3600),
                    tone: .warning,
                    severity: .warning
                ),
                WidgetEventFeedItem(
                    id: "4",
                    iconSymbol: "exclamationmark.triangle.fill",
                    title: "Tire pressure low",
                    subtitle: "Front-left · 2.1 bar",
                    timestamp: now.addingTimeInterval(-30 * 3600),
                    tone: .danger,
                    severity: .critical,
                    href: "/alerts/7"
                )
            ]
        }
    }

    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation for
    /// `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewSelectHandler(_ enabled: Bool) -> (@MainActor (WidgetEventFeedItem) -> Void)? {
        guard enabled else { return nil }
        return { _ in }
    }

    @MainActor
    private func previewModel(_ input: WidgetEventFeedInput, select: Bool = true) -> WidgetEventFeedModel {
        let source = InMemoryWidgetEventFeedSource(initial: input)
        let model = WidgetEventFeedModel(source: source, onSelect: previewSelectHandler(select))
        model.start()
        return model
    }

    #Preview("Feed — full") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(items: WidgetEventFeedPreviewData.sample())))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Feed — compact") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(
            items: WidgetEventFeedPreviewData.sample(),
            compact: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — default") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — custom") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(
            emptyMessage: "No alerts in the last 24 hours.",
            emptyIconSymbol: "checkmark.seal"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(
            errorMessage: "The events request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(
            items: WidgetEventFeedPreviewData.sample(),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        WidgetEventFeed(model: previewModel(WidgetEventFeedInput(
            items: WidgetEventFeedPreviewData.sample(),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
