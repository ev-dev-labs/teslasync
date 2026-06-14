//
//  VehicleHeroCard.Views.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The atomic presentational pieces of the vehicle hero card — the native peers of the web identity row: the
//  brand accent palette (the exact `RadialGauge` + FSM `badgeDot` hex from the web source / `types/fsm`), the
//  optional hero photo (web `<img>` → `AsyncImage`), the status badge (web `StatusBadge`, a colored dot + the
//  capitalized status), the model chip (web neutral `Badge`), and the identity header (web title + VIN +
//  model). All chrome is token-driven (P1/S9); every meaningful element carries a VoiceOver label. No
//  networking — purely a function of the projection.
//

import SwiftUI

// MARK: - Palette (web RadialGauge hex + FSM badgeDot hex)

/// The surface's brand accents — the verbatim hex from the web source (the four gauge colors, battery turning
/// red at ≤ 20 %) and from `types/fsm/vehicle.ts` + `theme.ts` (the per-status badge dot). Kept here, in the
/// view layer, so the pure adapter stays SwiftUI-free.
enum VehicleHeroCardPalette {
    /// The gauge accent (web `color={…}`): battery is cyan above 20 %, red at / below; the rest are fixed.
    static func gaugeColor(_ gauge: VehicleHeroCardGauge) -> Color {
        switch gauge.kind {
        case .battery: batteryColor(gauge.value)
        case .range: rgb(74, 222, 128)
        case .inside: rgb(245, 158, 11)
        case .outside: rgb(167, 139, 250)
        }
    }

    /// Battery turns red at / below 20 % (web `value > 20 ? '#22d3ee' : '#ef4444'`).
    private static func batteryColor(_ value: Double) -> Color {
        if value > 20 { rgb(34, 211, 238) } else { rgb(239, 68, 68) }
    }

    /// The status badge dot (web `getStateDefinition('vehicle', status).badgeDot`).
    static func statusDot(_ status: VehicleHeroCardStatus) -> Color {
        switch status {
        case .online: rgb(74, 222, 128) // success default → green-400
        case .driving: rgb(59, 130, 246) // override → blue-500
        case .charging: rgb(250, 204, 21) // override → yellow-400
        case .parked: rgb(6, 182, 212) // override → cyan-500
        case .updating: rgb(99, 102, 241) // override → indigo-500
        case .asleep: rgb(168, 85, 247) // override → purple-500
        case .offline: rgb(248, 113, 113) // danger default → red-400
        }
    }

    private static func rgb(_ red: Double, _ green: Double, _ blue: Double) -> Color {
        Color(.sRGB, red: red / 255, green: green / 255, blue: blue / 255, opacity: 1)
    }
}

// MARK: - Photo (web `<img>` → AsyncImage)

/// The optional user-uploaded hero photo — the native peer of the web `<img>` (lazy, object-cover, capped
/// height, rounded + bordered). Absent photo renders nothing, preserving the gauges-only layout.
struct VehicleHeroCardPhoto: View {
    let url: URL
    let alt: String

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(image):
                image.resizable().scaledToFill()
            case .failure:
                placeholder(systemImage: "car.fill")
            case .empty:
                placeholder(systemImage: "photo")
            @unknown default:
                placeholder(systemImage: "photo")
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 220)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: alt))
        .accessibilityAddTraits(.isImage)
    }

    private func placeholder(systemImage: String) -> some View {
        ZStack {
            Color.TS.surface
            Image(systemName: systemImage)
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Status badge (web `StatusBadge`)

/// The vehicle status badge — a colored FSM dot + the capitalized status (web `StatusBadge`). VoiceOver reads
/// "Status: {label}".
struct VehicleHeroCardStatusBadge: View {
    let status: VehicleHeroCardStatus

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(VehicleHeroCardPalette.statusDot(status))
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(verbatim: status.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(VehicleHeroCardStrings.statusLabel): \(status.label)"))
    }
}

// MARK: - Model chip (web neutral `Badge`)

/// The model badge after the title (web neutral `Badge`, e.g. "Model 3"). Decorative — the header combines
/// it into the identity element's accessibility.
struct VehicleHeroCardModelBadge: View {
    let model: String

    var body: some View {
        Text(verbatim: model)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

// MARK: - Identity header (web title + status + VIN + model)

/// The identity row — the display-name title with the status badge, the mono VIN beneath, and the model chip
/// pinned trailing (web header `<div>`).
struct VehicleHeroCardHeader: View {
    let identity: VehicleHeroCardIdentity

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: identity.title)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .foregroundStyle(Color.TS.textPrimary)
                    VehicleHeroCardStatusBadge(status: identity.status)
                }
                if !identity.vin.isEmpty {
                    Text(verbatim: identity.vin)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityLabel(Text(verbatim: "\(VehicleHeroCardStrings.vinLabel): \(identity.vin)"))
                }
            }
            Spacer(minLength: TSSpacing.sm)
            if !identity.model.isEmpty {
                VehicleHeroCardModelBadge(model: identity.model)
            }
        }
    }
}
