import SwiftUI

// MARK: - GlassPanel9 list (web `StaggerContainer` of vehicle cards)

/// The "All Vehicles" list — the staggered column of per-vehicle cards (web `StaggerContainer` →
/// `StaggerItem` → `VehicleCard`). Rows render in the model's pinned-first order; each binds its
/// resolved state, pin status, and the open / pin / delete callbacks.
struct VehicleListCardList: View {
    let model: VehicleListPageModel
    let units: UnitPreferences
    let onOpenVehicle: (Int64) -> Void

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(model.sortedVehicles.enumerated()), id: \.element.id) { index, vehicle in
                TSStaggerItem(index: index) {
                    VehicleListRow(
                        vehicle: vehicle,
                        state: model.state(for: vehicle),
                        isPinned: model.isPinned(vehicle),
                        units: units,
                        onOpen: { onOpenVehicle(vehicle.id) },
                        onTogglePin: { Task { await model.togglePin(vehicle) } },
                        onDelete: { model.requestDelete(vehicle) }
                    )
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(VehicleListStrings.allVehicles))
    }
}

// MARK: - GlassPanel9 — Vehicle card (web `VehicleCard`)

/// One vehicle in the "All Vehicles" list (web card, itself a `GlassPanel`). Shows the accent rail,
/// the name (open link) + status chip, the model / trim / VIN sub-line, a battery bar + percent, the
/// SI-converted range / odometer / charge-power metrics, the lock + sentry glyphs, and the
/// pin / open / delete actions. Stacks the metrics on narrow widths.
struct VehicleListRow: View {
    let vehicle: VehicleListItem
    let state: VehicleStateSnapshot?
    let isPinned: Bool
    let units: UnitPreferences
    let onOpen: () -> Void
    let onTogglePin: () -> Void
    let onDelete: () -> Void

    private var status: VehicleStatus { VehicleListFormat.status(for: state) }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                accentRail
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    info
                    Spacer(minLength: TSSpacing.sm)
                    actions
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var accentRail: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [Color.TS.accent, Color.TS.chartSeriesPower, Color.TS.statusSuccess],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 3)
            .opacity(0.6)
            .accessibilityHidden(true)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Button(action: onOpen) {
                    Text(verbatim: vehicle.title)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
                VehicleStatusChip(status: status)
            }
            descriptor
            metrics
        }
    }

    private var descriptor: some View {
        (
            Text(verbatim: "\(vehicle.model) \(vehicle.trimBadging) · ").font(Font.TS.caption)
                + Text(verbatim: vehicle.vin).font(.system(.caption, design: .monospaced))
        )
        .foregroundStyle(Color.TS.textSecondary)
        .lineLimit(1)
    }

    @ViewBuilder
    private var metrics: some View {
        let level = state?.batteryLevel ?? 0
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                VehicleBatteryBar(
                    level: level,
                    tone: VehicleListFormat.batteryTone(level),
                    height: 8,
                    width: 80
                )
                Text(verbatim: "\(level)%")
                    .font(Font.TS.bodySm)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                statusGlyphs
            }
            if let state {
                detailMetrics(state)
            }
        }
    }

    private func detailMetrics(_ state: VehicleStateSnapshot) -> some View {
        HStack(spacing: TSSpacing.md) {
            metric(VehicleListFormat.distanceText(meters: state.ratedRangeM, units: units),
                   tint: Color.TS.textSecondary)
            metric(VehicleListFormat.distanceText(meters: state.odometerM, units: units),
                   tint: Color.TS.textSecondary)
            if state.isCharging {
                metric(VehicleListFormat.chargePowerText(watts: state.chargerPowerW, units: units),
                       tint: Color.TS.statusSuccess)
            }
        }
    }

    private func metric(_ value: String, tint: Color) -> some View {
        Text(verbatim: value)
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(tint)
    }

    @ViewBuilder
    private var statusGlyphs: some View {
        HStack(spacing: TSSpacing.sm) {
            if state?.isLocked == true {
                Image(systemName: "lock.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityLabel(Text("vehicles.locked"))
            }
            if state?.sentryMode == true {
                Image(systemName: "shield.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityLabel(Text("vehicles.sentry"))
            }
        }
    }

    private var actions: some View {
        VStack(spacing: TSSpacing.xs) {
            actionButton(systemName: isPinned ? "pin.fill" : "pin",
                         tint: isPinned ? Color.TS.accent : Color.TS.textMuted,
                         label: Text(isPinned ? "pin.unpin" : "pin.pin"),
                         action: onTogglePin)
            actionButton(systemName: "arrow.up.right.square",
                         tint: Color.TS.textSecondary,
                         label: Text("vehicles.open"),
                         action: onOpen)
            Button(role: .destructive, action: onDelete) {
                glyph("trash", tint: Color.TS.statusDanger)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(VehicleListStrings.commonDelete))
        }
    }

    private func actionButton(systemName: String, tint: Color, label: Text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            glyph(systemName, tint: tint)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func glyph(_ systemName: String, tint: Color) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 14))
            .foregroundStyle(tint)
            .frame(width: 32, height: 32)
    }
}

// MARK: - Status chip (web `Badge variant={statusVariant(status)} dot`)

/// The vehicle's status pill — a state dot + the raw FSM status word, tinted by the shared status
/// tone (web `<Badge variant dot>{status}</Badge>`, which renders the lowercase status verbatim).
struct VehicleStatusChip: View {
    let status: VehicleStatus

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(status.tone.color).frame(width: 7, height: 7)
            Text(verbatim: status.rawValue)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(status.tone.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(status.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(status.tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: status.rawValue))
    }
}

// MARK: - Battery bar (web gradient progress bar)

/// A horizontal state-of-charge bar: a muted track with a tone-gradient fill whose width is the
/// SI-derived percentage. Decorative — the surrounding row carries the accessible reading.
struct VehicleBatteryBar: View {
    let level: Int
    let tone: TSTone
    var height: CGFloat = 8
    var width: CGFloat?

    private var fraction: Double { max(0, min(1, Double(level) / 100)) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.4))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [tone.color.opacity(0.55), tone.color],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geo.size.width * fraction)
            }
        }
        .frame(width: width, height: height)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .accessibilityHidden(true)
    }
}
