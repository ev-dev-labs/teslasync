//
//  LiveTelemetrySegment.Previews.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  Xcode previews for the forms the web source supports — the four connection states
//  (connected / reconnecting / disconnected / unknown→"Idle"), the connected chip at several ages (just
//  now / 5m / 2h), the dense `iconOnly` variant, and a Reduce-Motion rendering of the reconnecting
//  spinner. Each preview seeds an in-memory source with a fixed snapshot and a fixed clock so the
//  freshness stamp is deterministic, and injects a no-op tap handler so no navigation broadcast fires.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewSegment(
        status: LiveConnectionStatus,
        lastMessageAt: Date? = nil,
        iconOnly: Bool = false,
        now: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> LiveTelemetrySegment {
        let snapshot = LiveConnectionSnapshot(status: status, lastMessageAt: lastMessageAt)
        let model = LiveTelemetrySegmentModel(
            source: InMemoryLiveTelemetrySegmentSource(initial: snapshot),
            locale: Locale(identifier: "en_US"),
            clock: { now }
        )
        return LiveTelemetrySegment(iconOnly: iconOnly, model: model, onOpen: {})
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

    #Preview("Connected — just now") {
        staged(previewSegment(status: .connected, lastMessageAt: fixedNow, now: fixedNow))
    }

    #Preview("Connected — 5m ago") {
        staged(previewSegment(
            status: .connected,
            lastMessageAt: fixedNow.addingTimeInterval(-300),
            now: fixedNow
        ))
    }

    #Preview("Connected — 2h ago (stale)") {
        staged(previewSegment(
            status: .connected,
            lastMessageAt: fixedNow.addingTimeInterval(-7200),
            now: fixedNow
        ))
    }

    #Preview("All states — expanded") {
        staged(VStack(alignment: .leading, spacing: TSSpacing.sm) {
            previewSegment(status: .connected, lastMessageAt: fixedNow.addingTimeInterval(-12), now: fixedNow)
            previewSegment(status: .reconnecting)
            previewSegment(status: .disconnected)
            previewSegment(status: .unknown)
        })
    }

    #Preview("Icon-only — all states") {
        staged(HStack(spacing: TSSpacing.lg) {
            previewSegment(status: .connected, lastMessageAt: fixedNow, iconOnly: true, now: fixedNow)
            previewSegment(status: .reconnecting, iconOnly: true)
            previewSegment(status: .disconnected, iconOnly: true)
            previewSegment(status: .unknown, iconOnly: true)
        })
    }

    #Preview("Reconnecting icon — motion vs. Reduce Motion") {
        staged(HStack(spacing: TSSpacing.lg) {
            LiveTelemetrySegmentStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: false)
            LiveTelemetrySegmentStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: true)
        }
        .font(Font.TS.title)
        .foregroundStyle(Color.TS.statusWarning))
    }
#endif
