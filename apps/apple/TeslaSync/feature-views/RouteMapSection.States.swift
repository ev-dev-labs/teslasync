//
//  RouteMapSection.States.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  The non-map chrome composed by `RouteMapSection`: the stationary-GPS banner, the start/legend/end
//  footer, the loading skeleton, the inline "No route data" empty body, the error/retry body, and the
//  Live/Stale/Offline/Updating freshness chip. All consume pre-localized strings from the P1/S10 facade
//  and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Stationary banner (web `AlertBanner` overlay)

/// The "Route can't be plotted" overlay shown when only one GPS coordinate was recorded (web
/// `!hasRoute` `AlertBanner`). Built inline so its copy resolves from this surface's P1/S10 table.
struct RouteMapStationaryBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "location.slash")
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                RouteMapSectionStrings.text("driveDetail.stationaryRouteTitle", "Route can't be plotted")
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                RouteMapSectionStrings.text(
                    "driveDetail.stationaryRouteBody",
                    "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. "
                        + "The drive's distance, duration, and other stats below are unaffected."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Footer (web start/legend/end row)

/// The footer row: "Start: …", the speed legend (when there is a route), and "End: …" — the parity of
/// the web flex footer. Stacks on a compact width via `ViewThatFits`.
struct RouteMapFooter: View {
    let projection: RouteMapProjection

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                startStamp
                if projection.showLegend {
                    Spacer(minLength: TSSpacing.sm)
                    RouteMapLegend(projection: projection)
                    Spacer(minLength: TSSpacing.sm)
                }
                endStamp
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.md) {
                    startStamp
                    Spacer(minLength: TSSpacing.sm)
                    endStamp
                }
                if projection.showLegend {
                    RouteMapLegend(projection: projection)
                }
            }
        }
    }

    private var startStamp: some View {
        RouteMapTimeStamp(
            label: RouteMapSectionStrings.string("driveDetail.start", "Start"),
            time: projection.startTimeText,
            tone: Color.TS.statusSuccess
        )
    }

    @ViewBuilder
    private var endStamp: some View {
        if let endTimeText = projection.endTimeText {
            RouteMapTimeStamp(
                label: RouteMapSectionStrings.string("driveDetail.end", "End"),
                time: endTimeText,
                tone: Color.TS.statusDanger
            )
        }
    }
}

/// One "Label: time" footer stamp with a leading flag glyph (web `Flag` + label).
struct RouteMapTimeStamp: View {
    let label: String
    let time: String
    let tone: Color

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "flag.fill")
                .font(.system(size: 10))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: "\(label): \(time)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(time)"))
    }
}

/// The speed legend: a swatch + threshold per band, then the unit (web footer legend).
struct RouteMapLegend: View {
    let projection: RouteMapProjection

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(projection.legend) { entry in
                HStack(spacing: 4) {
                    Capsule()
                        .fill(entry.band.legendColor)
                        .frame(width: 12, height: 4)
                    Text(verbatim: entry.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
                .accessibilityHidden(true)
            }
            Text(verbatim: projection.speedUnitLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(RouteMapSectionStrings.text("routeMap.legendLabel", "Speed legend"))
        .accessibilityValue(Text(verbatim: legendValue))
    }

    private var legendValue: String {
        projection.legend.map(\.label).joined(separator: ", ") + " \(projection.speedUnitLabel)"
    }
}

// MARK: - No-data body (web empty `trail.length === 0` branch)

/// The "No route data available for this drive" body — a muted pin glyph over the localized copy, never
/// a blank box (web empty branch + the native `empty` phase).
struct RouteMapNoData: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "mappin.slash")
                .font(.system(size: 40))
                .foregroundStyle(Color.TS.textMuted.opacity(0.4))
                .accessibilityHidden(true)
            RouteMapSectionStrings.text("driveDetail.noRouteData", "No route data available for this drive")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 256)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web shell skeleton chrome)

/// The initial-fetch skeleton: a map-area silhouette + a footer bar. Reduce-Motion safe via the shared
/// `TSSkeleton`.
struct RouteMapSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: nil, height: 320, cornerRadius: TSRadius.md)
            HStack {
                TSSkeleton(width: 120, height: 12)
                Spacer()
                TSSkeleton(width: 120, height: 12)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(RouteMapSectionStrings.text("routeMap.loading", "Loading route map"))
    }
}

// MARK: - Error (web `QueryError` equivalent with retry)

/// The error body: a danger glyph, the failure copy + the underlying message, and a Retry control wired
/// to `model.refresh()` — the route-map parity of the web `QueryError`.
struct RouteMapErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            RouteMapSectionStrings.text("routeMap.errorTitle", "Couldn't load route map")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            retryButton
        }
        .frame(maxWidth: .infinity)
        .frame(height: 256)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        let title = RouteMapSectionStrings.string("routeMap.retry", "Retry")
        return TSButton(variant: .secondary, size: .small, action: onRetry) {
            Text(verbatim: title).lineLimit(1)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a localized
/// label, and an optional relative "updated" stamp. Shown only while fetching or when not live.
struct RouteMapFreshnessChip: View {
    let connection: RouteMapConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return RouteMapSectionStrings.string("routeMap.updating", "Updating")
        }
        switch connection {
        case .live: return RouteMapSectionStrings.string("routeMap.live", "Live")
        case .stale: return RouteMapSectionStrings.string("routeMap.stale", "Stale")
        case .offline: return RouteMapSectionStrings.string("routeMap.offline", "Offline")
        }
    }
}
