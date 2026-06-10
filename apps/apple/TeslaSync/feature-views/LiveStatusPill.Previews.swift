//
//  LiveStatusPill.Previews.swift
//  TeslaSync — P4 feature view · 0249 · LiveStatusPill (Apple)
//
//  Xcode previews covering every branch the web source carries: the three
//  `TONE` tones (`live` / `reconnecting` / `offline`), the pulsing `reconnecting`
//  dot, and the relative-time ladder (`nil → "—"`, `< 5s → "just now"`,
//  `< 60s`, `< 1h`, `≥ 1h`). DEBUG-only.
//

import SwiftUI

#if DEBUG
    private struct LiveStatusPillPreviewGallery: View {
        private struct Row: Identifiable {
            let id = UUID()
            let state: LiveStatusState
            let lastUpdateAt: Double?
        }

        /// A fixed "now" so the relative buckets are deterministic in previews.
        private let now: Double = 1_000_000_000_000

        /// Held on the (main-actor-isolated) view rather than as a top-level
        /// global so it stays concurrency-safe under Swift 6 strict concurrency.
        private var rows: [Row] {
            [
                Row(state: .live, lastUpdateAt: now - 2000), // "just now"
                Row(state: .live, lastUpdateAt: now - 18000), // "18s ago"
                Row(state: .reconnecting, lastUpdateAt: now - 45000), // "45s ago", pulsing
                Row(state: .reconnecting, lastUpdateAt: now - 240_000), // "4m ago", pulsing
                Row(state: .offline, lastUpdateAt: now - 7_200_000), // "2h ago"
                Row(state: .offline, lastUpdateAt: nil) // "—"
            ]
        }

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(rows) { row in
                        LiveStatusPill(state: row.state, lastUpdateAt: row.lastUpdateAt, now: now)
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 360, alignment: .leading)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Tones · Dark") {
        LiveStatusPillPreviewGallery()
            .preferredColorScheme(.dark)
    }

    #Preview("Tones · Light") {
        LiveStatusPillPreviewGallery()
            .preferredColorScheme(.light)
    }

    #Preview("Dynamic Type · XXL") {
        LiveStatusPillPreviewGallery()
            .preferredColorScheme(.dark)
            .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
