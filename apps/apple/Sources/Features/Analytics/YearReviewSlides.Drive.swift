import SwiftUI

// The drive-highlight slides (web `DriveHighlightSlide` for the longest + most-efficient drives)
// and the charging-mix slide (web `ChargingBreakdownSlide`). SI values convert at the boundary.

// MARK: - Drive highlight (web `DriveHighlightSlide`)

/// A highlighted drive: the emoji + uppercase label, then the route/stat card — or, when the source
/// has no such drive, the "no drive data" line (web `if (!drive)` branch). Never a blank region.
struct YearReviewDriveHighlightSlide: View {
    let drive: YearReviewDriveHighlight?
    let label: LocalizedStringKey
    let emoji: String
    let units: UnitPreferences

    var body: some View {
        YearReviewSlideContainer {
            if let drive {
                YearReviewEmoji(value: emoji, size: 56)
                Text(label)
                    .font(Font.TS.section)
                    .textCase(.uppercase)
                    .foregroundStyle(.white.opacity(0.7))
                YearReviewDriveCard(drive: drive, units: units)
            } else {
                YearReviewEmoji(value: emoji, size: 64)
                Text("yearReview.noDriveData")
                    .font(Font.TS.title)
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
    }
}

/// The glass card for a highlighted drive: the route, a three-up stat grid (distance / duration /
/// efficiency), and the date (web inner card).
struct YearReviewDriveCard: View {
    let drive: YearReviewDriveHighlight
    let units: UnitPreferences

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            route
            stats
            Text(verbatim: drive.date)
                .font(Font.TS.caption)
                .foregroundStyle(.white.opacity(0.5))
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 360)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(.white.opacity(0.1), lineWidth: 1)
        )
    }

    private var route: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 11))
            Text(verbatim: startLabel).lineLimit(1)
            Image(systemName: "arrow.right").font(.system(size: 9))
            Text(verbatim: endLabel).lineLimit(1)
        }
        .font(Font.TS.caption)
        .foregroundStyle(.white.opacity(0.7))
    }

    private var startLabel: String {
        drive.startAddress.isEmpty ? YearReviewStoryFormat.emptyValue : drive.startAddress
    }

    private var endLabel: String {
        drive.endAddress.isEmpty ? YearReviewStoryFormat.emptyValue : drive.endAddress
    }

    private var stats: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            stat(YearReviewStoryFormat.distanceInt(drive.distanceM, units), Text(verbatim: units.distance), icon: nil)
            stat(YearReviewStoryFormat.durationShort(drive.durationS), Text("yearReview.duration"), icon: "clock")
            stat(efficiency, Text(verbatim: YearReviewStoryFormat.efficiencyUnit(units)), icon: "bolt")
        }
    }

    /// Web `efficiency_wh_km > 0 ? round(effDisplay) : '—'`.
    private var efficiency: String {
        drive.efficiencyWhKm > 0
            ? YearReviewStoryFormat.integer(YearReviewStoryFormat.efficiencyValue(drive.efficiencyWhKm, units))
            : YearReviewStoryFormat.emptyValue
    }

    private func stat(_ value: String, _ label: Text, icon: String?) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
                }
                Text(verbatim: value)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            label.font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Charging mix (web `ChargingBreakdownSlide`)

/// Charging breakdown: 🔌, the session count, the average plug-in SoC, the connector-mix donut on
/// the P3 `TSPieChart` wrapper, and a legend (web pie + legend). Zero-share connectors are dropped.
struct YearReviewChargingSlide: View {
    let review: YearReview

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "🔌", size: 48)
            sessionsHeadline
            Text(verbatim: avgSoc)
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
            TSPieChart(slices: slices, showsLegend: false)
                .frame(width: 200, height: 200)
                .accessibilityLabel(Text("yearReview.chargeSessions"))
            legend
        }
    }

    private var sessionsHeadline: some View {
        (Text(verbatim: "\(review.totalChargeSessions) ") + Text("yearReview.chargeSessions"))
            .font(Font.TS.title)
            .fontWeight(.bold)
            .foregroundStyle(.white)
    }

    /// Web `t('yearReview.avgStartSOC', { soc })` → "Average plug-in at {{soc}}% battery".
    private var avgSoc: String {
        String(
            format: String(localized: "yearReview.avgStartSOC"),
            YearReviewStoryFormat.percentInt(review.avgChargeStartSoc)
        )
    }

    private var slices: [TSChartSlice] {
        let connectors = [
            YearReviewConnector(key: "yearReview.supercharger", pct: review.superchargerPct, colorIndex: 1),
            YearReviewConnector(key: "yearReview.dcFast", pct: review.dcFastPct, colorIndex: 4),
            YearReviewConnector(key: "yearReview.acOther", pct: review.acOtherPct, colorIndex: 7)
        ]
        return connectors.filter { $0.pct > 0 }.map { connector in
            TSChartSlice(
                id: connector.key,
                name: LocalizedStringKey(connector.key),
                nameText: YearReviewStoryFormat.localized(connector.key),
                value: connector.pct,
                colorIndex: connector.colorIndex
            )
        }
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(slices) { slice in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(slice.color).frame(width: 8, height: 8)
                    Text(verbatim: "\(slice.nameText) (\(YearReviewStoryFormat.percentInt(slice.value))%)")
                        .font(Font.TS.caption)
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
        }
    }
}

/// One connector type's share (web pie data), extracted so the slice builder avoids a large tuple.
private struct YearReviewConnector {
    let key: String
    let pct: Double
    let colorIndex: Int
}
