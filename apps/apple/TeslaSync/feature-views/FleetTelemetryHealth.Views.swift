//
//  FleetTelemetryHealth.Views.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  The presentational chrome composed by `FleetTelemetryHealth`: the freshness chip,
//  the stale/offline connectivity banner, the ToolCard-equivalent section card, the
//  per-section action row (affected badge / filter badge / Tesla-refresh button), and
//  the shared empty + loading states. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports. The
//  two data tables live in `FleetTelemetryHealth.Tables.swift`.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct FleetHealthFreshnessChip: View {
    let connection: FleetHealthConnection

    /// The chip's tone + localized label for a given connection.
    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FleetHealthStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FleetHealthStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: FleetHealthConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "devtools.health.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "devtools.health.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "devtools.health.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the sections when the bound source is not live,
/// so cached rows are clearly labeled (web `DataFreshness` indicator intent).
struct FleetHealthConnectivityBanner: View {
    let connection: FleetHealthConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "devtools.health.offlineBanner" : "devtools.health.staleBanner"
        let fallback = offline
            ? "Offline — showing last known telemetry health"
            : "Reconnecting — telemetry health may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FleetHealthStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section card (web `ToolCard` → native glass card)

/// The ToolCard-equivalent section shell: a tinted SF Symbol icon box + title +
/// description above the section content, on a glass card surface (web `GlassPanel`).
struct FleetHealthSectionCard<Content: View>: View {
    let systemImage: String
    let tone: TSTone
    let titleKey: String
    let titleFallback: String
    let descriptionKey: String
    let descriptionFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: systemImage, tone: tone)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    FleetHealthStrings.text(titleKey, titleFallback)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    FleetHealthStrings.text(descriptionKey, descriptionFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Spacer(minLength: 0)
            }
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Action-row chips + button

/// The "{n} affected" count badge (web danger/success badge with the affected word).
struct FleetHealthCountBadge: View {
    let count: Int

    var body: some View {
        let tone = FleetHealthProjection.vinBadgeTone(count: count).color
        let word = FleetHealthStrings.string("devtools.health.affectedVehicles", "affected")
        let text = "\(count) \(word)"
        return Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

/// The active-filter badge "Filtered: {vin}" with a clear (×) affordance.
struct FleetHealthFilterBadge: View {
    let vin: String
    let onClear: () -> Void

    var body: some View {
        let tone = TSTone.info.color
        let label = FleetHealthStrings.string("devtools.health.filteredBy", "Filtered")
        return HStack(spacing: 4) {
            Text(verbatim: "\(label): \(vin)")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone)
            Button(action: onClear) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(tone)
            .accessibilityLabel(FleetHealthStrings.text("devtools.health.clearVinFilter", "Clear VIN filter"))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
    }
}

/// The secondary "Refresh from Tesla" button (web `Button variant="secondary"`), with a
/// spinner while its mutation is in flight.
struct FleetHealthRefreshButton: View {
    let labelKey: String
    let labelFallback: String
    let isRefreshing: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if isRefreshing {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
                }
                FleetHealthStrings.text(labelKey, labelFallback)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(isRefreshing)
        .accessibilityLabel(FleetHealthStrings.text(labelKey, labelFallback))
    }
}

// MARK: - Shared empty + loading states

/// A centered, muted "No …" empty row (web `<p class="text-center text-muted">`).
struct FleetHealthEmptyRow: View {
    let key: String
    let fallback: String

    var body: some View {
        FleetHealthStrings.text(key, fallback)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.md)
            .accessibilityLabel(FleetHealthStrings.text(key, fallback))
    }
}

/// The initial-fetch skeleton chrome (web `<Skeleton>`), respecting Reduce Motion.
struct FleetHealthLoadingRows: View {
    let rows: Int

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 132, height: 12)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 64, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(FleetHealthStrings.text("devtools.health.loading", "Loading telemetry health"))
    }
}
