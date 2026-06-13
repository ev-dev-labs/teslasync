//
//  MarkerCluster.States.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The loading / empty / error state overlays the `MarkerCluster` surface renders over the MapKit
//  clustering layer — the "every state renders, never a blank box" contract the prompt requires. The
//  web `MarkerCluster` returns `null` and has no states of its own; these are the P4 leaf states the
//  native surface adds so an in-flight, empty, or failed feed always reads clearly over the map. All
//  copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - State overlays (loading / empty / error — never a blank box)

/// The centred loading overlay shown over the map while the feed is in flight with no cached markers.
struct MarkerClusterLoadingOverlay: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            Text(verbatim: MarkerClusterStrings.string("markerCluster.loading", "Loading map…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string("markerCluster.loading", "Loading map…")))
    }
}

/// The empty-state overlay shown when the feed resolved with no renderable markers — a friendly
/// message over the map, never a blank box.
struct MarkerClusterEmptyOverlay: View {
    var body: some View {
        MarkerClusterMessageOverlay(
            systemImage: "mappin.slash",
            tone: Color.TS.textMuted,
            title: MarkerClusterStrings.string("markerCluster.empty", "No markers to show"),
            detail: MarkerClusterStrings.string("markerCluster.emptyDetail", "There are no points in this view yet.")
        )
    }
}

/// The error overlay shown when the feed fails — an icon, a message, and a Retry affordance over the
/// map (which keeps any last-known markers beneath).
struct MarkerClusterErrorOverlay: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            MarkerClusterMessageOverlay(
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.statusDanger,
                title: MarkerClusterStrings.string("markerCluster.error", "Couldn't load markers"),
                detail: MarkerClusterStrings.string("markerCluster.errorDetail", "Showing the last known markers.")
            )
            Button(action: onRetry) {
                Text(verbatim: MarkerClusterStrings.string("action.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string("action.retry", "Retry")))
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A shared icon + title + detail card used by the empty / error overlays.
struct MarkerClusterMessageOverlay: View {
    let systemImage: String
    let tone: Color
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: detail)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(detail)"))
    }
}
