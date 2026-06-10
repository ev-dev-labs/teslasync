//
//  VehicleHeader.Views.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  The presentational subviews composed by `VehicleHeader`: the leading back button
//  (web `<Link to="/vehicles">`), the status badge with its state dot (web `Badge`
//  variant + dot, size lg), the neutral model/trim badge (web `Badge` neutral, size
//  sm), the monospaced VIN line, the "Wake Up" button (web `Button` + Power icon), and
//  the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the
//  shared P1/S9 tokens + components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `BadgeVariant` tints map to
//  the brand `TSTone` (success/warning/danger/info/neutral); the status dot is the
//  web `bg-current` dot rendered in the same tone; the VIN's `text-[var(--text-muted)]`
//  maps to `textMuted`, so the surface adapts to both light and dark themes.
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

// MARK: - Shared panel surface (web `GlassPanel className="p-6"`)

extension View {
    /// The header's frosted panel container — the shared padding + material applied by
    /// every state so the surface keeps a consistent shape (web `GlassPanel` p-6).
    func vehicleHeaderSurface() -> some View {
        padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
    }
}

// MARK: - Tinted badge (web `Badge`)

/// A tinted, capsule badge carrying dynamic text — the native mirror of the web `Badge`.
/// `showDot` reproduces the status badge's leading `bg-current` dot; `prominent` is the
/// web `size="lg"` (status) vs `size="sm"` (model/trim) split.
struct VehicleHeaderTintedBadge: View {
    let text: String
    let tone: TSTone
    var showDot: Bool = false
    var prominent: Bool = false

    private var horizontalPadding: CGFloat {
        prominent ? TSSpacing.md : TSSpacing.sm
    }

    private var verticalPadding: CGFloat {
        prominent ? TSSpacing.xs : 2
    }

    private var font: Font {
        prominent ? Font.TS.label : Font.TS.caption
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if showDot {
                Circle()
                    .fill(tone.color)
                    .frame(width: prominent ? 8 : 6, height: prominent ? 8 : 6)
            }
            Text(verbatim: text)
                .font(font)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
                .lineLimit(1)
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
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

// MARK: - VIN line (web monospaced, muted, truncated)

/// The vehicle VIN — the web `text-sm text-[var(--text-muted)] font-mono truncate`. Uses
/// a monospaced digit font, middle truncation, and the muted token.
struct VehicleHeaderVINLine: View {
    let vin: String

    private var vinLabel: String {
        VehicleHeaderStrings.string("vehicleHeader.vinLabel", "VIN")
    }

    var body: some View {
        Text(verbatim: vin)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
            .accessibilityLabel(Text(verbatim: "\(vinLabel) \(vin)"))
    }
}

// MARK: - Data row (web non-chrome render)

/// The resolved header row — the back button, the status + model badges, the VIN, and
/// the wake button, composed in the web's leading-aligned row. Wrapped in the shared
/// fade-in (web `FadeIn`).
struct VehicleHeaderDataRow: View {
    let resolved: VehicleHeaderResolved
    let onWake: () -> Void
    let onBack: () -> Void

    private var statusLabel: String {
        VehicleHeaderStrings.string(
            VehicleHeaderStatusMap.labelKey(resolved.status),
            VehicleHeaderStatusMap.labelFallback(resolved.status)
        )
    }

    private var accessibilitySummary: String {
        VehicleHeaderAccessibility.headerLabel(
            statusLabel: statusLabel,
            modelLine: resolved.modelLine,
            vinLabel: VehicleHeaderStrings.string("vehicleHeader.vinLabel", "VIN"),
            vin: resolved.vin
        )
    }

    var body: some View {
        TSFadeIn {
            HStack(spacing: TSSpacing.lg) {
                VehicleHeaderBackButton(action: onBack)
                identity
                Spacer(minLength: TSSpacing.md)
                VehicleHeaderWakeButton(waking: resolved.waking, enabled: true, action: onWake)
            }
            .accessibilityElement(children: .contain)
        }
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                VehicleHeaderTintedBadge(
                    text: statusLabel,
                    tone: resolved.variant.tone,
                    showDot: true,
                    prominent: true
                )
                if !resolved.modelLine.isEmpty {
                    VehicleHeaderTintedBadge(text: resolved.modelLine, tone: .neutral)
                }
            }
            if !resolved.vin.isEmpty {
                VehicleHeaderVINLine(vin: resolved.vin)
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
