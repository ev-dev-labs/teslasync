//
//  ConnectionSegment.Previews.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  Xcode previews for each surface state (online / degraded / offline / connecting / icon-only / stale).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The previews
//  drive the in-memory source so every branch renders without a network or real time. The stale preview
//  seeds a healthy reading with an aged `lastCheckedAt` and a fixed clock so the dimmed "· Stale" chip
//  renders deterministically.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ snapshot: ConnectionSegmentSnapshot,
        now: Date = Date()
    ) -> ConnectionSegmentModel {
        let source = InMemoryConnectionSegmentSource(initial: snapshot)
        let model = ConnectionSegmentModel(
            source: source,
            strings: { _, fallback in fallback },
            clock: { now }
        )
        model.start()
        return model
    }

    private let previewNow = Date(timeIntervalSince1970: 1_700_000_000)

    #Preview("Online — fast") {
        ConnectionSegment(model: previewModel(ConnectionSegmentSnapshot(
            status: .online, latencyMs: 42, lastCheckedAt: previewNow
        ), now: previewNow), onOpen: {})
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Degraded — slow") {
        ConnectionSegment(model: previewModel(ConnectionSegmentSnapshot(
            status: .degraded, latencyMs: 820, lastCheckedAt: previewNow
        ), now: previewNow), onOpen: {})
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline — probe failed") {
        ConnectionSegment(model: previewModel(ConnectionSegmentSnapshot(
            status: .offline, latencyMs: 5000, lastCheckedAt: previewNow
        ), now: previewNow), onOpen: {})
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Connecting — first probe") {
        ConnectionSegment(model: previewModel(.initial, now: previewNow), onOpen: {})
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Icon only") {
        ConnectionSegment(
            iconOnly: true,
            model: previewModel(ConnectionSegmentSnapshot(
                status: .online, latencyMs: 42, lastCheckedAt: previewNow
            ), now: previewNow),
            onOpen: {}
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale — aged reading") {
        ConnectionSegment(model: previewModel(ConnectionSegmentSnapshot(
            status: .online, latencyMs: 42, lastCheckedAt: previewNow.addingTimeInterval(-120)
        ), now: previewNow), onOpen: {})
            .padding()
            .background(Color.TS.bg)
    }
#endif
