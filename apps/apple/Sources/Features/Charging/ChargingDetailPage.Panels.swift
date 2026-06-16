import SwiftUI

// The Charging detail secondary panels (web `ChargingDetailPage.tsx` More-Details panel,
// the Location panel, the live Advanced-Charging-Parameters panel, and the Timestamps
// footer) plus the loading skeleton. Live values format at the render boundary through
// `Units`; each panel always renders (never a blank region), resolving its own
// success/empty exactly as the web page does.

// MARK: - More details (web GlassPanel15 — inline metrics + charger/location/vehicle list)

/// The More-Details panel: the average-power / range-added / status / currency inline
/// metrics and the charger-type / location / vehicle key-value list.
struct ChargingMoreDetailsSection: View {
    let session: ChargingSessionDetail
    let vehicle: ChargingDetailVehicle?
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private var isDC: Bool { ChargingDetailDerivations.isDC(session) }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("charging.detail.moreDetails")
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    TSInlineMetric(label: "charging.detail.avgPower", value: avgPower)
                    TSInlineMetric(label: "charging.detail.milesAdded", value: milesAdded)
                    TSInlineMetric(label: "charging.detail.status", value: status)
                    TSInlineMetric(label: "charging.detail.currency", value: currency)
                }
                TSKVList(rows: rows)
            }
        }
    }

    private var avgPower: String {
        guard let watts = session.avgPowerW else { return ChargingDetailFormat.emptyValue }
        return "\(ChargingDetailFormat.number(watts / 1000, decimals: 1)) kW"
    }

    private var milesAdded: String {
        ChargingDetailDerivations.addedDistanceM(session)
            .map { Units.formatDistance($0, units) } ?? ChargingDetailFormat.emptyValue
    }

    private var status: String { session.endedStatus ?? ChargingDetailFormat.emptyValue }
    private var currency: String { session.costCurrency ?? ChargingDetailFormat.emptyValue }

    private var rows: [TSKVRow] {
        [
            TSKVRow(
                id: "charger-type",
                key: "charging.detail.chargerType",
                value: session.chargerType ?? (isDC ? "DC" : "AC")
            ),
            TSKVRow(
                id: "location",
                key: "charging.detail.location",
                value: session.startPlace ?? ChargingDetailFormat.emptyValue
            ),
            TSKVRow(
                id: "vehicle",
                key: "charging.detail.vehicle",
                value: vehicle?.displayName ?? "ID \(session.vehicleID)"
            )
        ]
    }
}

// MARK: - Location (web GlassPanel16 — the start-place callout)

/// The Location panel: the session's start place, or an empty state when unknown. Always
/// rendered (never hidden when the place is absent) per ADR-011.
struct ChargingLocationSection: View {
    let session: ChargingSessionDetail

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.detail.location")
                if let place = session.startPlace, !place.isEmpty {
                    Text(verbatim: place)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    TSEmptyState(title: "common.noData", systemImage: "mappin.slash")
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

// MARK: - Advanced parameters (web GlassPanel21 — live charging KV list / no-live-data)

/// The Advanced-Charging-Parameters panel: the latest live values keyed by parameter, or
/// the no-live-data state when no live telemetry is available.
struct ChargingAdvancedSection: View {
    let live: ChargingTelemetryLatest?
    @Environment(\.tsUnits) private var units

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSPanelTitle("charging.detail.advanced")
                TSCaption("charging.detail.advancedHint")
                if let live {
                    TSKVList(rows: rows(live)).padding(.top, TSSpacing.sm)
                } else {
                    Text("charging.detail.noLiveData")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.top, TSSpacing.sm)
                }
            }
        }
    }

    private func rows(_ live: ChargingTelemetryLatest) -> [TSKVRow] {
        [
            TSKVRow(id: "state", key: "charging.detail.chargingState", value: stateText(live.chargingState)),
            TSKVRow(id: "voltage", key: "charging.detail.chargerVoltage", value: volts(live.chargerVoltageV)),
            TSKVRow(id: "actual", key: "charging.detail.chargerActualCurrent", value: amps(live.chargerActualCurrentA)),
            TSKVRow(id: "pilot", key: "charging.detail.chargerPilotCurrent", value: amps(live.chargerPilotCurrentA)),
            TSKVRow(id: "power", key: "charging.detail.chargerPowerKw", value: kilowatts(live.chargerPowerW)),
            TSKVRow(id: "phases", key: "charging.detail.chargerPhases", value: phases(live.chargerPhases)),
            TSKVRow(id: "range", key: "charging.detail.batteryRange", value: distance(live.batteryRangeM)),
            TSKVRow(id: "rate", key: "charging.detail.chargeRate", value: ratePerHour(live.rangeAddedMetersPerHour)),
            TSKVRow(id: "energy", key: "charging.detail.chargeEnergyAdded", value: energy(live.chargeEnergyAddedWh)),
            TSKVRow(id: "added", key: "charging.detail.chargeMilesAdded", value: distance(live.rangeAddedMetersPerHour))
        ]
    }

    private func stateText(_ value: String?) -> String {
        let resolved = value ?? ""
        return resolved.isEmpty ? ChargingDetailFormat.emptyValue : resolved
    }

    private func volts(_ value: Double?) -> String {
        value.map { "\(ChargingDetailFormat.number($0, decimals: 0)) V" } ?? ChargingDetailFormat.emptyValue
    }

    private func amps(_ value: Double?) -> String {
        value.map { "\(ChargingDetailFormat.number($0, decimals: 1)) A" } ?? ChargingDetailFormat.emptyValue
    }

    private func kilowatts(_ watts: Double?) -> String {
        watts.map { "\(ChargingDetailFormat.number($0 / 1000, decimals: 1)) kW" } ?? ChargingDetailFormat.emptyValue
    }

    private func phases(_ value: Int?) -> String {
        value.map { String($0) } ?? ChargingDetailFormat.emptyValue
    }

    private func distance(_ meters: Double?) -> String {
        meters.map { Units.formatDistance($0, units) } ?? ChargingDetailFormat.emptyValue
    }

    private func energy(_ wattHours: Double?) -> String {
        wattHours.map { Units.formatEnergy($0, units) } ?? ChargingDetailFormat.emptyValue
    }

    private func ratePerHour(_ metersPerHour: Double?) -> String {
        guard let metersPerHour else { return ChargingDetailFormat.emptyValue }
        let display = Units.convertDistance(metersPerHour, units)
        return "\(ChargingDetailFormat.number(display, decimals: 0)) \(units.distance)/h"
    }
}

// MARK: - Timestamps (web GlassPanel22 — started / ended footer)

/// The Timestamps footer: the session's start and end times in the user's locale.
struct ChargingTimestampsSection: View {
    let session: ChargingSessionDetail

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                stamp("charging.detail.started", date: session.startedAt)
                stamp("charging.detail.ended", date: session.endedAt)
            }
        }
    }

    private func stamp(_ label: LocalizedStringKey, date: Date?) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            TSDateTime(date)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading skeleton (web `LoadingSkeleton`)

/// Mirrors the page layout while the session loads (web `LoadingSkeleton`): the header,
/// five gauges, the progress meter, eight stat tiles, and two charts under SwiftUI
/// redaction (the manifest's `loading → redacted(reason:)`).
struct ChargingDetailPageSkeleton: View {
    private let gaugeColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]
    private let statColumns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            block(height: 48)
            LazyVGrid(columns: gaugeColumns, spacing: TSSpacing.lg) {
                ForEach(0 ..< 5, id: \.self) { _ in block(height: 150) }
            }
            block(height: 170)
            LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 8, id: \.self) { _ in block(height: 96) }
            }
            block(height: 260)
            block(height: 300)
        }
        .chargingDetailRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("charging.detail.title"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web loading state (the
    /// manifest's `loading → redacted(reason:)` requirement).
    func chargingDetailRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
