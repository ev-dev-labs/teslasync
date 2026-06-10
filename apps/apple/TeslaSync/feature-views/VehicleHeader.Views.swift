//
//  VehicleHeader.Views.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  The presentational subviews composed by `VehicleHeader`: the leading back button
//  (web `<Link to="/vehicles">`), the `h1` display-name title, the status badge (web
//  shared `StatusBadge`, size md), the muted `model · trim · VIN` subtitle (web `<p>`
//  with the monospaced VIN), the "Wake Up" button (web `Button` + Power icon), and the
//  freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the shared
//  P1/S9 tokens + components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `StatusBadge` dot derives from
//  the FSM `badgeDot`; native maps each state through its `BadgeVariant` to the brand
//  `TSTone` (success/warning/danger/info/neutral) so the dot adapts to light/dark + high
//  contrast; the pill itself is the neutral `surface` + `border` tokens and the label is
//  `textSecondary`, exactly like the web `bg-gray-50 dark:bg-gray-800` pill.
//

import SwiftUI

// MARK: - Variant → tone bridge (web `BadgeVariant` → brand `TSTone`)

extension VehicleHeaderBadgeVariant {
    /// The brand tone for the badge variant — the single mapping point from the web
    /// `BadgeVariant` union to the shared `TSTone` used by the tinted chrome.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        case .neutral: .neutral
        }
    }
}

// MARK: - Status badge (web `StatusBadge` size `md`)

/// The status pill — the native mirror of the web
/// `@/components/data-display/StatusBadge` (shared peer `TSStatusPill`). A neutral
/// surface capsule with a leading state-tinted dot and the capitalized, localized status
/// label, sized to the web `md` variant (`text-sm`, `h-2 w-2` dot). The dot tone is the
/// semantic state → variant tone (ADR-006); the label resolves through the i18n facade.
struct VehicleHeaderStatusBadge: View {
    let label: String
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

// MARK: - Title (web `h1` display name)

/// The header title — the web `h1` (`text-3xl font-bold tracking-tight`) carrying
/// `display_name || vin || t('common.vehicle')`. The fallback resolution happens at the
/// call site; this renders the resolved string in the display token with tight tracking.
struct VehicleHeaderTitle: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.display)
            .tracking(TSTypeMetrics.displayTracking)
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

// MARK: - Subtitle (web `{model} {trim_badging} · {vin}`, monospaced VIN)

/// The muted subtitle — the web `<p class="text-sm text-muted">{model} {trim} ·
/// <span class="font-mono">{vin}</span></p>`. Composes the model/trim run in the sans
/// body font and the VIN in the monospaced body font, joined by a middle dot. Each part
/// is dropped when empty so a partial vehicle never shows a dangling separator.
struct VehicleHeaderSubtitle: View {
    let modelLine: String
    let vin: String

    private var hasModel: Bool {
        !modelLine.isEmpty
    }

    private var hasVin: Bool {
        !vin.isEmpty
    }

    var body: some View {
        composed
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private var composed: Text {
        let lead = Text(verbatim: hasModel ? modelLine : "").font(Font.TS.body)
        let separator = Text(verbatim: hasModel && hasVin ? " · " : "").font(Font.TS.body)
        let vinText = Text(verbatim: hasVin ? vin : "").font(Font.TS.body.monospaced())
        return lead + separator + vinText
    }
}

// MARK: - Back button (web `<Link to="/vehicles">`)

/// The leading back affordance — an arrow glyph in a rounded, tappable square that pops
/// to the vehicle list (web `<Link to="/vehicles">`). 44pt minimum target on iOS.
struct VehicleHeaderBackButton: View {
    let action: () -> Void

    private var label: String {
        VehicleHeaderStrings.string("vehicleHeader.back", "Back to vehicles")
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.left")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 40, height: 40)
                .background(Color.TS.textPrimary.opacity(0.04), in: RoundedRectangle(
                    cornerRadius: TSRadius.md,
                    style: .continuous
                ))
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Wake button (web `Button` + Power icon)

/// The "Wake Up" command button (web `<Button onClick={onWake} loading={waking}
/// icon={<Power/>}>`). Shows the shared button's loading spinner while a wake is in
/// flight and is disabled in that window.
struct VehicleHeaderWakeButton: View {
    let waking: Bool
    let enabled: Bool
    let action: () -> Void

    private var title: String {
        VehicleHeaderStrings.string("common.wakeUp", "Wake Up")
    }

    private var wakingLabel: String {
        VehicleHeaderStrings.string("vehicleHeader.wakingA11y", "Waking up")
    }

    var body: some View {
        TSButton(variant: .primary, isLoading: waking, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "power")
                    .font(.system(size: 14, weight: .semibold))
                Text(verbatim: title)
            }
        }
        .disabled(!enabled)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: waking ? wakingLabel : ""))
    }
}

// MARK: - Data row (web non-chrome render)

/// The resolved header row — the back button, the identity column (the title + status
/// pill, then the model/trim · VIN subtitle), and the wake button, composed in the web's
/// leading-aligned row. The root surface applies the shared fade-in (web `FadeIn`).
struct VehicleHeaderDataRow: View {
    let resolved: VehicleHeaderResolved
    let onWake: () -> Void
    let onBack: () -> Void

    private var fallbackTitle: String {
        VehicleHeaderStrings.string("common.vehicle", "Vehicle")
    }

    private var displayedTitle: String {
        resolved.title.isEmpty ? fallbackTitle : resolved.title
    }

    private var statusLabel: String {
        VehicleHeaderStrings.string(
            VehicleHeaderStatusMap.labelKey(resolved.status),
            VehicleHeaderStatusMap.labelFallback(resolved.status)
        )
    }

    private var accessibilitySummary: String {
        VehicleHeaderAccessibility.headerLabel(
            title: displayedTitle,
            statusLabel: statusLabel,
            modelLine: resolved.modelLine,
            vinLabel: VehicleHeaderStrings.string("vehicleHeader.vinLabel", "VIN"),
            vin: resolved.vin
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VehicleHeaderBackButton(action: onBack)
            identity
            Spacer(minLength: TSSpacing.md)
            VehicleHeaderWakeButton(waking: resolved.waking, enabled: true, action: onWake)
        }
        .accessibilityElement(children: .contain)
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.md) {
                VehicleHeaderTitle(text: displayedTitle)
                VehicleHeaderStatusBadge(label: statusLabel, tone: resolved.variant.tone)
            }
            if !resolved.modelLine.isEmpty || !resolved.vin.isEmpty {
                VehicleHeaderSubtitle(modelLine: resolved.modelLine, vin: resolved.vin)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the feed is not live — a coloured dot + label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request
/// the snapshot (the web parent's re-fetch), with an explicit label.
struct VehicleHeaderFreshnessChip: View {
    let connection: VehicleHeaderConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: VehicleHeaderStrings.string("vehicleHeader.live", "Live")
        case .stale: VehicleHeaderStrings.string("vehicleHeader.stale", "Stale")
        case .offline: VehicleHeaderStrings.string("vehicleHeader.offlineChip", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            VehicleHeaderStrings.string("vehicleHeader.staleA11y", "Stale — tap to refresh")
        case .offline:
            VehicleHeaderStrings.string("vehicleHeader.offlineA11y", "Offline — showing last known data")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
