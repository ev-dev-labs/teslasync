//
//  LiveTelemetry.MorePanels.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The tyre-pressure / media / navigation telemetry panels — the remaining three of
//  the six GlassPanel surfaces composed by LiveTelemetryGrid (the first three live in
//  LiveTelemetry.Panels.swift; shared primitives in LiveTelemetry.Views.swift).
//

import SwiftUI

// MARK: - Tyre-pressure panel (web `TirePressurePanel`)

/// The tyre-pressure panel — the 2×2 corner grid (toned values) and the all-normal
/// badge.
struct LiveTirePressurePanel: View {
    let projection: TireProjection?

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        LiveTelemetryPanel(
            icon: "smallcircle.filled.circle",
            tint: Color.TS.accent,
            title: LiveTelemetryStrings.string("telemetry.tirePressure", "Tire Pressure"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(spacing: TSSpacing.md) {
                    LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                        ForEach(projection.corners) { corner in
                            cornerTile(corner, unit: projection.unitLabel)
                        }
                    }
                    statusBadge(projection)
                }
            }
        }
    }

    private func cornerTile(_ corner: TireProjection.Corner, unit: String) -> some View {
        VStack(spacing: 2) {
            Text(verbatim: corner.id)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: corner.valueText)
                .font(Font.TS.bodySm.weight(.bold))
                .foregroundStyle(corner.tone.color)
                .monospacedDigit()
            Text(verbatim: unit)
                .font(.system(size: 9))
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.tire(
            corner: corner.id, value: corner.valueText, unit: unit
        )))
    }

    private func statusBadge(_ projection: TireProjection) -> some View {
        let label = projection.allNormal
            ? LiveTelemetryStrings.string("telemetry.allNormal", "All Normal")
            : LiveTelemetryStrings.string("telemetry.warning", "Warning")
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle((projection.allNormal ? LiveTelemetryTone.success : .warning).color)
                .accessibilityHidden(true)
            TSBadge("\(label)", tone: projection.allNormal ? .success : .warning)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Media panel (web `MediaPanel`)

/// The media panel — now-playing title / artist, the playback-status badge, and the
/// volume bar.
struct LiveMediaPanel: View {
    let projection: MediaProjection?

    var body: some View {
        LiveTelemetryPanel(
            icon: "headphones",
            tint: Color.TS.chartSeriesPower,
            title: LiveTelemetryStrings.string("telemetry.media", "Media"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    nowPlaying(projection)
                    statusRow(projection)
                    volumeRow(projection)
                }
            }
        }
    }

    private func nowPlaying(_ projection: MediaProjection) -> some View {
        let artist = projection.artist
            ?? LiveTelemetryStrings.string("telemetry.unknownArtist", "Unknown artist")
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: projection.title)
                .font(Font.TS.bodySm.weight(.bold))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: artist)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.title), \(artist)"))
    }

    private func statusRow(_ projection: MediaProjection) -> some View {
        HStack {
            Text(verbatim: LiveTelemetryStrings.string("telemetry.status", "Status"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            TSBadge("\(projection.status)", tone: projection.statusTone.badgeTone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(
            label: LiveTelemetryStrings.string("telemetry.status", "Status"),
            value: projection.status
        )))
    }

    private func volumeRow(_ projection: MediaProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: LiveTelemetryStrings.string("telemetry.volume", "Volume"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: projection.volumeText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
            LiveTelemetryBar(
                fraction: projection.volumeFraction,
                gradient: [Color.TS.chartSeriesPower, Color.TS.accent]
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(
            label: LiveTelemetryStrings.string("telemetry.volume", "Volume"),
            value: projection.volumeText
        )))
    }
}

// MARK: - Navigation panel (web `NavigationPanel`)

/// The navigation panel — destination, distance, ETA, and the saved-location chips.
struct LiveNavigationPanel: View {
    let projection: NavigationProjection?

    var body: some View {
        LiveTelemetryPanel(
            icon: "location.north.fill",
            tint: Color.TS.accent,
            title: LiveTelemetryStrings.string("telemetry.navigation", "Navigation"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.destination", "Destination"),
                        value: projection.destination
                    )
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.distance", "Distance"),
                        value: projection.distanceText
                    )
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.eta", "ETA"),
                        value: projection.etaText
                    )
                    locationChips(projection)
                }
            }
        }
    }

    private func locationChips(_ projection: NavigationProjection) -> some View {
        HStack(spacing: TSSpacing.sm) {
            if projection.showHome {
                LiveTelemetryChip(
                    icon: "house.fill",
                    text: LiveTelemetryStrings.string("telemetry.home", "Home"),
                    tone: .success
                )
            }
            if projection.showWork {
                LiveTelemetryChip(
                    icon: "building.2.fill",
                    text: LiveTelemetryStrings.string("telemetry.work", "Work"),
                    tone: .info
                )
            }
            if projection.showFavorite {
                LiveTelemetryChip(
                    icon: "star.fill",
                    text: LiveTelemetryStrings.string("telemetry.favorite", "Favorite"),
                    tone: .neutral
                )
            }
            if projection.showNoLocation {
                LiveTelemetryMutedNote(
                    text: LiveTelemetryStrings.string("telemetry.noSavedLocation", "No saved location")
                )
            }
        }
    }
}
