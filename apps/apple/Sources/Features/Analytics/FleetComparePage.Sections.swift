import SwiftUI

// Per-vehicle live status card (web `VehicleStatusCard` — GlassPanel1/2/3) and the shared
// chart legend (web recharts `<Legend />`). Copy resolves from `Localizable.xcstrings`; SI
// values are formatted via `FleetCompareFormat` at this display boundary.

// MARK: - Vehicle status card (web `VehicleStatusCard` — GlassPanel1/2/3)

/// One vehicle's live status card. Reproduces the web component's three render branches:
/// loading (redacted skeleton), no vehicle selected (EmptyState), and the populated card with
/// battery / range / temperature / security / status rows.
struct FleetCompareStatusCard: View {
    let vehicle: FleetCompareVehicle?
    let state: FleetCompareVehicleState?
    let isLoading: Bool
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            loadingCard
        } else if let vehicle {
            populated(vehicle)
        } else {
            TSEmptyState(title: "comparison.selectVehicle", systemImage: "car")
        }
    }

    /// Web Skeleton lines=5 — a redacted skeleton of the populated layout.
    private var loadingCard: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 14)
            }
        }
        .fleetCompareRedacted(while: true)
        .accessibilityLabel(Text("loading"))
    }

    private func populated(_ vehicle: FleetCompareVehicle) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header(vehicle)
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                batteryRow
                infoRow(
                    icon: "gauge.with.dots.needle.bottom.50percent",
                    tint: Color.TS.accent,
                    label: "comparison.range",
                    value: FleetCompareFormat.range(state?.ratedRangeM, units)
                )
                infoRow(
                    icon: "thermometer.medium",
                    tint: Color.TS.statusWarning,
                    label: "comparison.temp",
                    value: FleetCompareFormat.temperature(
                        inside: state?.insideTempC,
                        outside: state?.outsideTempC,
                        units
                    )
                )
                securityRow
                statusRow(vehicle)
            }
        }
    }

    private func header(_ vehicle: FleetCompareVehicle) -> some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "car.fill")
                .foregroundStyle(vehicle.isOnline ? Color.TS.statusSuccess : Color.TS.textMuted)
                .frame(width: 40, height: 40)
                .background(
                    (vehicle.isOnline ? Color.TS.statusSuccess : Color.TS.textMuted).opacity(0.1),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: vehicle.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: subtitle(vehicle))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func subtitle(_ vehicle: FleetCompareVehicle) -> String {
        let model = vehicle.model ?? ""
        guard let trim = vehicle.trimBadging, !trim.isEmpty else { return model }
        return model.isEmpty ? trim : "\(model) · \(trim)"
    }

    private var batteryRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            infoRow(
                icon: "battery.100",
                tint: Color.TS.statusSuccess,
                label: "comparison.battery",
                value: FleetCompareFormat.battery(state?.batteryLevel)
            )
            if let level = state?.batteryLevel {
                ProgressView(value: Double(min(level, 100)), total: 100)
                    .progressViewStyle(.linear)
                    .tint(batteryTint(level))
                    .accessibilityHidden(true)
            }
        }
    }

    private func batteryTint(_ level: Int) -> Color {
        if level > 50 { return Color.TS.statusSuccess }
        if level > 20 { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }

    private var securityRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Label("comparison.security", systemImage: "lock.fill")
                .labelStyle(FleetCompareRowLabelStyle(tint: Color.TS.accent))
            Spacer(minLength: TSSpacing.sm)
            securityValue
        }
    }

    @ViewBuilder
    private var securityValue: some View {
        if let state {
            HStack(spacing: TSSpacing.sm) {
                Text(state.isLocked == true ? "comparison.locked" : "comparison.unlocked")
                    .font(Font.TS.caption)
                    .foregroundStyle(state.isLocked == true ? Color.TS.statusSuccess : Color.TS.statusDanger)
                if state.sentryMode == true {
                    Label("comparison.sentry", systemImage: "shield.fill")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.accent)
                        .labelStyle(.titleAndIcon)
                }
            }
        } else {
            Text(verbatim: FleetCompareFormat.emptyValue)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func statusRow(_ vehicle: FleetCompareVehicle) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Label("comparison.status", systemImage: "wifi")
                .labelStyle(FleetCompareRowLabelStyle(tint: Color.TS.statusInfo))
            Spacer(minLength: TSSpacing.sm)
            statusPill(vehicle)
        }
    }

    @ViewBuilder
    private func statusPill(_ vehicle: FleetCompareVehicle) -> some View {
        let online = vehicle.isOnline
        Group {
            if let stateText = vehicle.onlineState, !stateText.isEmpty {
                Text(verbatim: stateText)
            } else {
                Text("comparison.unknown")
            }
        }
        .font(Font.TS.caption)
        .fontWeight(.medium)
        .foregroundStyle(online ? Color.TS.statusSuccess : Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(
            (online ? Color.TS.statusSuccess : Color.TS.textMuted).opacity(0.12),
            in: Capsule()
        )
    }

    private func infoRow(icon: String, tint: Color, label: LocalizedStringKey, value: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Label(label, systemImage: icon)
                .labelStyle(FleetCompareRowLabelStyle(tint: tint))
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
        }
    }
}

/// Row label style: tinted icon + secondary-colored small text (web row left cell).
private struct FleetCompareRowLabelStyle: LabelStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: TSSpacing.xs) {
            configuration.icon
                .foregroundStyle(tint)
                .font(Font.TS.bodySm)
            configuration.title
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Chart legend (web recharts `<Legend />`)

/// Two-series legend showing each vehicle's color + name (web chart `<Legend />`).
struct FleetCompareChartLegend: View {
    let nameA: String
    let nameB: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(color: TSChartPalette.color(at: 0), name: nameA)
            legendItem(color: TSChartPalette.color(at: 1), name: nameB)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func legendItem(color: Color, name: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(verbatim: name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}

// MARK: - Loading redaction (web Skeleton loading state)

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func fleetCompareRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
