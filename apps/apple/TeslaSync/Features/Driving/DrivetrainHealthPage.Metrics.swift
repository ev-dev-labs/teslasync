import SwiftUI

// Drivetrain Health panels — part 2 (web sections 4–6): the six temperature metric tiles
// (`TemperatureMetricCards`), the thermal-load indicators (`ThermalLoadPanel`), and the live motor
// status (`LiveMotorStatus`). Every value formats from raw SI via `DrivetrainHealthPageFormat`; the live
// panel renders its own empty state when no `/motor/latest` row exists (never a blank region).

// MARK: - Section 4 — Temperature metric tiles (web `TemperatureMetricCards`)

/// Six tiles: one per thermal sensor (reading + share-of-ceiling subtitle), the health score, and the
/// peak motor power.
struct DrivetrainTemperatureMetricsSection: View {
    let sensors: [DrivetrainTempSensor]
    let grade: DrivetrainHealthGrade
    let score: Int
    let peakPowerKw: Double
    let units: UnitPreferences

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        LazyVGrid(columns: DrivetrainGrid.columns(columnCount, spacing: TSSpacing.md), spacing: TSSpacing.md) {
            ForEach(Array(sensors.enumerated()), id: \.element.id) { index, sensor in
                TSStaggerItem(index: index) {
                    DrivetrainMetricTile(
                        titleKey: sensor.labelKey,
                        value: DrivetrainHealthPageFormat.temperature(sensor.valueC, units),
                        systemImage: sensor.systemImage,
                        tone: sensor.severity,
                        subtitle: subtitle(for: sensor)
                    )
                }
            }
            TSStaggerItem(index: sensors.count) {
                DrivetrainMetricTile(
                    titleKey: "drivetrain.healthScore",
                    value: "\(score)%",
                    systemImage: "heart.fill",
                    tone: grade.tone,
                    subtitle: nil
                )
            }
            TSStaggerItem(index: sensors.count + 1) {
                DrivetrainMetricTile(
                    titleKey: "drivetrain.peakPower",
                    value: DrivetrainHealthPageFormat.powerInt(peakPowerKw),
                    systemImage: "bolt.fill",
                    tone: .info,
                    subtitle: nil
                )
            }
        }
    }

    private func subtitle(for sensor: DrivetrainTempSensor) -> String {
        guard let valueC = sensor.valueC else {
            return DrivetrainHealthPageStrings.text("drivetrain.noData", "No data")
        }
        let pct = DrivetrainHealthPageFormat.percentOfMax(valueC, sensor.maxTempC)
        let ofMax = DrivetrainHealthPageStrings.text("drivetrain.ofMax", "of max")
        return "\(pct) \(ofMax)"
    }

    private var columnCount: Int {
        #if os(iOS)
            horizontalSizeClass == .compact ? 2 : 3
        #else
            6
        #endif
    }
}

// MARK: - Section 5 — Thermal-load indicators (web `ThermalLoadPanel`)

/// Per-sensor thermal-load bars plus the peak/avg power, drive count, and regen-ratio inline metrics.
struct DrivetrainThermalLoadSection: View {
    let sensors: [DrivetrainTempSensor]
    let peakPowerKw: Double
    let avgPowerKw: Double
    let stats: DrivetrainDrivingStats?
    let units: UnitPreferences
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivetrainSectionHeader(
                    systemImage: "waveform.path.ecg.rectangle",
                    titleKey: "drivetrain.thermalMetrics"
                )
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(sensors) { sensor in
                        DrivetrainThermalBar(
                            labelKey: sensor.labelKey,
                            fraction: sensor.loadFraction,
                            tone: sensor.severity,
                            reading: DrivetrainHealthPageFormat.temperature(sensor.valueC, units)
                        )
                    }
                }
                LazyVGrid(columns: DrivetrainGrid.columns(isCompact ? 2 : 4), spacing: TSSpacing.md) {
                    ForEach(inlineMetrics) { metric in
                        DrivetrainInlineMetric(
                            systemImage: metric.systemImage, tone: metric.tone,
                            labelKey: metric.labelKey, value: metric.value
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var inlineMetrics: [DrivetrainLiveMetric] {
        [
            DrivetrainLiveMetric(
                id: "peak", systemImage: "bolt.fill", tone: .info,
                labelKey: "drivetrain.peakPower", value: DrivetrainHealthPageFormat.powerInt(peakPowerKw)
            ),
            DrivetrainLiveMetric(
                id: "avg", systemImage: "chart.line.uptrend.xyaxis", tone: .accent,
                labelKey: "drivetrain.avgPower", value: DrivetrainHealthPageFormat.powerDecimal(avgPowerKw)
            ),
            DrivetrainLiveMetric(
                id: "drives", systemImage: "car.fill", tone: .success,
                labelKey: "drivetrain.drivesLabel", value: drivesValue
            ),
            DrivetrainLiveMetric(
                id: "regen", systemImage: "arrow.triangle.2.circlepath", tone: .warning,
                labelKey: "drivetrain.regenRatio", value: regenValue
            )
        ]
    }

    private var drivesValue: String {
        guard let stats else { return DrivetrainHealthPageFormat.emptyValue }
        return DrivetrainHealthPageFormat.integer(Double(stats.totalDrives))
    }

    private var regenValue: String {
        guard let stats else { return DrivetrainHealthPageFormat.emptyValue }
        return DrivetrainHealthPageFormat.percent(stats.regenRatio)
    }
}

// MARK: - Section 6 — Live motor status (web `LiveMotorStatus`)

/// A small data model for a tinted-icon inline metric row.
struct DrivetrainLiveMetric: Identifiable {
    let id: String
    let systemImage: String
    let tone: TSTone
    let labelKey: String
    let value: String
}

/// The live motor panel: four headline tiles (shift state / power / regen / source) and nine inline
/// metrics (front+rear rpm, front+rear torque, four temperatures, and HV isolation). Shows its own
/// empty state when no live `/motor/latest` row exists.
struct DrivetrainLiveMotorSection: View {
    let snapshot: DrivetrainMotorSnapshot?
    let isolationResistance: Double?
    let units: UnitPreferences
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivetrainSectionHeader(systemImage: "gearshape.2.fill", titleKey: "drivetrain.liveMotor")
                if let snapshot {
                    LazyVGrid(columns: DrivetrainGrid.columns(isCompact ? 2 : 4), spacing: TSSpacing.md) {
                        ForEach(statTiles(snapshot)) { tile in
                            DrivetrainStatTile(labelKey: tile.labelKey, value: tile.value, tone: tile.tone)
                        }
                    }
                    LazyVGrid(columns: DrivetrainGrid.columns(isCompact ? 2 : 3), spacing: TSSpacing.md) {
                        ForEach(inlineMetrics(snapshot)) { metric in
                            DrivetrainInlineMetric(
                                systemImage: metric.systemImage, tone: metric.tone,
                                labelKey: metric.labelKey, value: metric.value
                            )
                        }
                    }
                } else {
                    TSEmptyState(
                        title: DrivetrainHealthPageStrings.key("drivetrain.liveMotor"),
                        message: DrivetrainHealthPageStrings.key("drivetrain.noLiveMotor"),
                        systemImage: "bolt.slash"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func statTiles(_ snapshot: DrivetrainMotorSnapshot) -> [DrivetrainLiveMetric] {
        [
            DrivetrainLiveMetric(
                id: "shift", systemImage: "", tone: .info,
                labelKey: "drivetrain.shiftState", value: snapshot.shiftState ?? DrivetrainHealthPageFormat.emptyValue
            ),
            DrivetrainLiveMetric(
                id: "power", systemImage: "", tone: .accent,
                labelKey: "drivetrain.power", value: DrivetrainHealthPageFormat.powerLive(snapshot.powerKw, units)
            ),
            DrivetrainLiveMetric(
                id: "regen", systemImage: "", tone: .success,
                labelKey: "drivetrain.regen", value: DrivetrainHealthPageFormat.powerLive(snapshot.regenKw, units)
            ),
            DrivetrainLiveMetric(
                id: "source", systemImage: "", tone: .neutral,
                labelKey: "drivetrain.source", value: snapshot.source ?? DrivetrainHealthPageFormat.emptyValue
            )
        ]
    }

    private func inlineMetrics(_ snapshot: DrivetrainMotorSnapshot) -> [DrivetrainLiveMetric] {
        let rpmFront = DrivetrainHealthPageFormat.rpm(snapshot.motorRpmFront)
        let rpmRear = DrivetrainHealthPageFormat.rpm(snapshot.motorRpmRear)
        let tqFront = DrivetrainHealthPageFormat.torque(snapshot.torqueNmFront, units)
        let tqRear = DrivetrainHealthPageFormat.torque(snapshot.torqueNmRear, units)
        return [
            metric("rpmF", "waveform.path.ecg", .info, "drivetrain.rpmFront", rpmFront),
            metric("rpmR", "waveform.path.ecg", .accent, "drivetrain.rpmRear", rpmRear),
            metric("tqF", "bolt.fill", .info, "drivetrain.torqueFront", tqFront),
            metric("tqR", "bolt.fill", .accent, "drivetrain.torqueRear", tqRear),
            metric("tF", "thermometer.high", .danger, "drivetrain.motorTempFront", temp(snapshot.motorTempCFront)),
            metric("tR", "thermometer.high", .danger, "drivetrain.motorTempRear", temp(snapshot.motorTempCRear)),
            metric("inv", "thermometer.medium", .warning, "drivetrain.inverterTemp", temp(snapshot.inverterTempC)),
            metric("bat", "thermometer.low", .success, "drivetrain.batteryTemp", temp(snapshot.batteryTempC)),
            metric("iso", "shield.lefthalf.filled", isolationTone, "drivetrain.isolationResistance", isolationValue)
        ]
    }

    private func metric(
        _ id: String, _ image: String, _ tone: TSTone, _ key: String, _ value: String
    ) -> DrivetrainLiveMetric {
        DrivetrainLiveMetric(id: id, systemImage: image, tone: tone, labelKey: key, value: value)
    }

    private func temp(_ celsius: Double?) -> String {
        guard let celsius else { return DrivetrainHealthPageFormat.emptyValue }
        return DrivetrainHealthPageFormat.temperatureWithUnit(celsius, units)
    }

    private var isolationValue: String {
        DrivetrainHealthPageFormat.isolation(isolationResistance, units)
    }

    /// Web Shield tint: ≥500 healthy, ≥100 caution, >0 critical, else muted.
    private var isolationTone: TSTone {
        guard let value = isolationResistance, value > 0 else { return .neutral }
        if value >= 500 { return .success }
        if value >= 100 { return .warning }
        return .danger
    }
}
