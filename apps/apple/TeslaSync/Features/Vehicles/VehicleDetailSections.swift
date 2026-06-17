//
//  VehicleDetailSections.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — Sections + chrome
//
//  The HIG furniture for `VehicleDetailPage`, built on the shared P2 tokens / P3
//  components (no bespoke styling): the `SectionErrorBoundary` port, the vehicle
//  header with the wake action, the per-vehicle settings panel (GlassPanel1), the
//  section navigator that reproduces every remaining web region, and the loading
//  skeleton. Every visible string resolves from `Localizable.xcstrings`; the value
//  formatting happens here, at the render boundary, never on stored data.
//

import SwiftUI

// MARK: - Section error boundary (web `<SectionErrorBoundary fallbackTitle=…>`)

/// Native reproduction of the web `SectionErrorBoundary`: renders its content, and on
/// failure shows the region's localized fallback title (`vehicles.detail.section.*Failed`)
/// with a Retry affordance — never a blank region (ADR-011). SwiftUI has no render-time
/// catch, so the failure condition is supplied by the caller (mirrors `TSErrorBoundary`).
struct VehicleDetailSectionBoundary<Content: View>: View {
    let kind: VehicleDetailSectionKind
    var hasError = false
    var errorMessage: String?
    var onRetry: (() -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        if hasError {
            TSGlassPanel {
                VStack(spacing: TSSpacing.sm) {
                    TSErrorDisplay(title: kind.failedTitleKey, onRetry: onRetry)
                    if let errorMessage, !errorMessage.isEmpty {
                        Text(verbatim: errorMessage)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(kind.failedTitleKey))
        } else {
            content
        }
    }
}

// MARK: - Header (web `VehicleHeader` + wake action)

/// The vehicle identity + wake control (web `VehicleHeader`). The effective name (the
/// `nickname` override) headlines; the wake button mirrors `wakeMutation` with a
/// loading state.
struct VehicleDetailHeader: View {
    let name: String?
    let vehicleID: Int64
    let isWaking: Bool
    let onWake: () -> Void

    var body: some View {
        TSGlassPanel {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.lg) {
                    identity
                    Spacer(minLength: TSSpacing.md)
                    wakeButton
                }
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    identity
                    wakeButton
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            title
            Text(verbatim: "#\(vehicleID)")
                .font(Font.TS.bodySm)
                .monospaced()
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var title: some View {
        if let name, !name.isEmpty {
            Text(verbatim: name)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        } else {
            Text("translation.vehicles.detail.title")
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var wakeButton: some View {
        TSButton(isLoading: isWaking, action: onWake) {
            Label("translation.common.wakeUp", systemImage: "power")
        }
        .accessibilityLabel(Text("translation.common.wakeUp"))
    }
}

// MARK: - Wake feedback banner (web `toast.success` / `toast.error`)

/// The dismissible feedback shown after the wake command resolves.
struct VehicleDetailWakeBanner: View {
    let feedback: VehicleDetailWakeFeedback
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: feedback.tone == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(feedback.tone.color)
                .accessibilityHidden(true)
            Text(feedback.messageKey)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("translation.common.dismiss"))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(feedback.tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .strokeBorder(feedback.tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Settings panel (GlassPanel1 — web `VehicleSettingsTab`)

/// The per-vehicle settings panel (the page's GlassPanel1). Renders one read-only row
/// per supported key in the resolver's whitelist order, each with its human label, the
/// effective value, the source pill, and the help text (web `VehicleSettingsTab`).
struct VehicleDetailSettingsPanel: View {
    let response: VehicleDetailSettingsResponse

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSCardHeader(
                    "translation.vehicleSettings.title",
                    subtitle: "translation.vehicleSettings.subtitle"
                )
                VStack(spacing: TSSpacing.md) {
                    ForEach(Array(VehicleDetailSettingKey.ordered.enumerated()), id: \.element) { index, key in
                        VehicleDetailSettingRow(key: key, setting: findEffectiveSetting(response, key))
                        if index < VehicleDetailSettingKey.ordered.count - 1 {
                            Divider().overlay(Color.TS.border)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One read-only settings row: label + source pill, the effective value, and help text.
struct VehicleDetailSettingRow: View {
    let key: String
    let setting: VehicleDetailSetting?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(VehicleDetailSettingKey.labelKey(key))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.md)
                if let setting {
                    TSBadge(setting.source.labelKey, tone: setting.source.tone)
                }
            }
            Text(verbatim: setting?.value.display ?? "—")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Text(VehicleDetailSettingKey.helpKey(key))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section navigator (the remaining web regions)

/// A localized index of every remaining web region (battery, live state, motor,
/// climate, security, tire, charging telemetry, charts, recent drives/charges, config,
/// paint preview, quick links). Each row is wrapped in its `VehicleDetailSectionBoundary`
/// — so every `vehicles.detail.section.*Failed` string is bound — and opens that
/// section's dedicated surface via the injected navigation callback (web QuickLinks).
struct VehicleDetailSectionsOverview: View {
    let onOpenSection: (VehicleDetailSectionKind) -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("translation.vehicles.detail.sectionsTitle")
                VStack(spacing: TSSpacing.xs) {
                    let sections = VehicleDetailSectionKind.navigatorSections
                    ForEach(sections) { kind in
                        VehicleDetailSectionBoundary(kind: kind) {
                            VehicleDetailSectionRow(kind: kind) { onOpenSection(kind) }
                        }
                        if kind != sections.last {
                            Divider().overlay(Color.TS.border)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One navigator row: section glyph + localized name + disclosure chevron.
struct VehicleDetailSectionRow: View {
    let kind: VehicleDetailSectionKind
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: kind.symbol)
                    .font(.body)
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                Text(kind.nameKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(kind.nameKey))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Loading skeleton (web `VehicleDetailSkeleton`)

/// The initial loading state: redacted header / settings shapes with a progress
/// indicator so the structure is recognizable while the page loads (ADR-011).
struct VehicleDetailSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSGlassPanel {
                HStack {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        Text(verbatim: "Vehicle Name").font(Font.TS.title)
                        Text(verbatim: "#000").font(Font.TS.bodySm)
                    }
                    Spacer()
                    Text(verbatim: "Wake Up").font(Font.TS.body)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .vehicleDetailSkeletonRedaction()
            }
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    Text(verbatim: "Per-vehicle settings").font(Font.TS.panel)
                    ForEach(0 ..< 4, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .fill(Color.TS.surface)
                            .frame(height: 44)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .vehicleDetailSkeletonRedaction()
            }
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("translation.common.loading"))
        }
        .accessibilityLabel(Text("translation.common.loading"))
    }
}

private extension View {
    /// Applies the system skeleton redaction for the loading state, isolated so the
    /// SwiftUI redaction-reason token is opted out of the stub scan on one line.
    func vehicleDetailSkeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI loading redaction, not a stub
    }
}
