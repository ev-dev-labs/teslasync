//
//  LiveIndicator.Previews.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  Xcode previews for the forms the web source supports — the four connection states
//  (connected / reconnecting / disconnected / unknown) across the three variants (pill / dot /
//  compact), plus the pill freshness stamp at several ages and a Reduce-Motion rendering of the
//  reconnecting spinner. Each preview seeds an in-memory source with a fixed snapshot and a fixed
//  clock so the freshness stamp is deterministic. DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        status: LiveConnectionStatus,
        lastMessageAt: Date? = nil,
        now: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> LiveIndicatorModel {
        let snapshot = LiveConnectionSnapshot(status: status, lastMessageAt: lastMessageAt)
        return LiveIndicatorModel(
            source: InMemoryLiveIndicatorSource(initial: snapshot),
            locale: Locale(identifier: "en_US"),
            clock: { now }
        )
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

    #Preview("Pill — connected, just now") {
        staged(LiveIndicator(
            variant: .pill,
            model: previewModel(status: .connected, lastMessageAt: fixedNow, now: fixedNow)
        ))
    }

    #Preview("Pill — connected, 5m ago") {
        staged(LiveIndicator(
            variant: .pill,
            model: previewModel(
                status: .connected,
                lastMessageAt: fixedNow.addingTimeInterval(-300),
                now: fixedNow
            )
        ))
    }

    #Preview("Pill — reconnecting") {
        staged(LiveIndicator(variant: .pill, model: previewModel(status: .reconnecting)))
    }

    #Preview("Pill — disconnected") {
        staged(LiveIndicator(variant: .pill, model: previewModel(status: .disconnected)))
    }

    #Preview("Pill — unknown") {
        staged(LiveIndicator(variant: .pill, model: previewModel(status: .unknown)))
    }

    #Preview("Compact — all states") {
        staged(VStack(alignment: .leading, spacing: TSSpacing.sm) {
            LiveIndicator(
                variant: .compact,
                model: previewModel(status: .connected, lastMessageAt: fixedNow, now: fixedNow)
            )
            LiveIndicator(variant: .compact, model: previewModel(status: .reconnecting))
            LiveIndicator(variant: .compact, model: previewModel(status: .disconnected))
            LiveIndicator(variant: .compact, model: previewModel(status: .unknown))
        })
    }

    #Preview("Dot — all states") {
        staged(HStack(spacing: TSSpacing.lg) {
            LiveIndicator(variant: .dot, model: previewModel(status: .connected))
            LiveIndicator(variant: .dot, model: previewModel(status: .reconnecting))
            LiveIndicator(variant: .dot, model: previewModel(status: .disconnected))
            LiveIndicator(variant: .dot, model: previewModel(status: .unknown))
        })
    }

    #Preview("Reconnecting icon — motion vs. Reduce Motion") {
        staged(HStack(spacing: TSSpacing.lg) {
            LiveIndicatorStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: false)
            LiveIndicatorStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: true)
        }
        .font(Font.TS.title)
        .foregroundStyle(Color.TS.statusWarning))
    }
#endif
