//
//  VehicleHero.States.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The stat grid + card, the quick-action button row, and the asleep / loading / error
//  chrome (the P4 leaf states). All strings resolve through the P1/S10 facade and all
//  colours through the P1/S9 tokens; no hex, no Tailwind ports, no networking.
//

import SwiftUI

// MARK: - Stat grid (web `buildStatCards`)

/// The context-aware stat grid — the leading driving / charging / idle cards plus the
/// always-visible status / sentry / firmware / power cards.
struct VehicleHeroPanelStatGrid: View {
    let cards: [VehicleHeroPanelStatCard]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(cards) { card in
                VehicleHeroPanelStatCardView(card: card)
            }
        }
    }
}

/// One stat card — an accent icon plus the uppercase label and the value.
struct VehicleHeroPanelStatCardView: View {
    let card: VehicleHeroPanelStatCard

    var body: some View {
        let label = VehicleHeroPanelStrings.string(card.labelKey, card.labelFallback)
        let value = valueText
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: card.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(VehicleHeroPanelPalette.color(card.accent))
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: label.uppercased())
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: value)
                    .font(Font.TS.bodySm.weight(.semibold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleHeroPanelAccessibility.statLabel(label: label, value: value)))
    }

    private var valueText: String {
        switch card.value {
        case let .text(text): text
        case let .localized(key, fallback): VehicleHeroPanelStrings.string(key, fallback)
        }
    }
}

// MARK: - Quick actions (web `<Link>` buttons)

/// The quick-action button row — Details / Commands / Live Map / Digital Twin — each
/// emitting its route through the navigation seam.
struct VehicleHeroPanelActionRow: View {
    let actions: [VehicleHeroPanelAction]
    let vehicleID: Int64
    let onNavigate: (VehicleHeroPanelRoute) -> Void

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            ForEach(actions) { action in
                actionButton(action)
            }
        }
    }

    private func actionButton(_ action: VehicleHeroPanelAction) -> some View {
        let label = VehicleHeroPanelStrings.string(action.labelKey, action.labelFallback)
        return TSButton(
            variant: .secondary,
            size: .small,
            action: { onNavigate(action.route(vehicleID: vehicleID)) },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: action.icon).font(.system(size: 12, weight: .semibold))
                    Text(verbatim: label)
                }
                .frame(maxWidth: .infinity)
            }
        )
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Asleep / loading / error chrome (P4 leaf states)

/// The asleep state (web `state == null` branch) — this surface's friendly empty
/// state: a soft skeleton bar, the asleep message, and a Wake Up affordance.
struct VehicleHeroPanelAsleepView: View {
    let onWake: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSSkeleton(height: 28, cornerRadius: TSRadius.md)
                .frame(maxWidth: 220)
            Image(systemName: "moon.zzz.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: VehicleHeroPanelStrings.string("hero.asleep", "Vehicle asleep — wake to see live data"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            TSButton(VehicleHeroPanelWakeLabel.key, variant: .primary, size: .small, action: onWake)
                .accessibilityLabel(Text(verbatim: VehicleHeroPanelStrings.string("hero.wakeUp", "Wake Up")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}

/// The Wake Up button title, resolved through the facade as a `LocalizedStringKey`.
enum VehicleHeroPanelWakeLabel {
    static var key: LocalizedStringKey {
        LocalizedStringKey(VehicleHeroPanelStrings.string("hero.wakeUp", "Wake Up"))
    }
}

/// The initial-fetch chrome — a skeleton gauge row over a skeleton stat grid, so the
/// hero keeps its shape while the parent query resolves.
struct VehicleHeroPanelLoadingView: View {
    private let gaugeColumns = [GridItem(.adaptive(minimum: 86), spacing: TSSpacing.md)]
    private let cardColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LazyVGrid(columns: gaugeColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(spacing: TSSpacing.xs) {
                        TSSkeleton(width: 78, height: 78, cornerRadius: 39)
                        TSSkeleton(width: 48, height: 10)
                    }
                }
            }
            LazyVGrid(columns: cardColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleHeroPanelStrings.string("hero.loadingA11y", "Loading vehicle")))
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct VehicleHeroPanelErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: VehicleHeroPanelStrings.string("hero.errorTitle", "Couldn't load vehicle"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(VehicleHeroPanelRetryLabel.key, variant: .secondary, size: .small, action: onRetry)
                .accessibilityLabel(Text(verbatim: VehicleHeroPanelStrings.string("hero.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}

/// The Retry button title, resolved through the facade as a `LocalizedStringKey`.
enum VehicleHeroPanelRetryLabel {
    static var key: LocalizedStringKey {
        LocalizedStringKey(VehicleHeroPanelStrings.string("hero.retry", "Retry"))
    }
}
