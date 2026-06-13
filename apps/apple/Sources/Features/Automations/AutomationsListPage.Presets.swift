import SwiftUI

// The collapsible preset gallery panel (web GlassPanel6 — the `<details>` wrapping
// `<PresetGallery/>`). This page owns the disclosure container + summary (chevron, sparkles,
// title, hint, expand/collapse affordance); the expanded body embeds the built-in quick-start
// templates. The full data-driven gallery is the dedicated `page:automations/PresetGallery`
// parity unit; here it renders the fixed product quick-start catalog so the panel is never blank.

/// One built-in quick-start template (the product's fixed quick-start catalog — not per-user
/// data). Installing one opens the typed builder pre-filled (web preset install navigation).
struct AutomationPresetTemplate: Identifiable, Equatable {
    let id: String
    let name: String
    let summary: String
    let systemImage: String
    let actionCount: Int

    /// The product's built-in quick-start templates.
    static let builtIns: [AutomationPresetTemplate] = [
        AutomationPresetTemplate(
            id: "departure-precondition",
            name: "Departure Preconditioning",
            summary: "Warm or cool the cabin before your scheduled departure",
            systemImage: "thermometer.sun.fill",
            actionCount: 2
        ),
        AutomationPresetTemplate(
            id: "smart-charge-limit",
            name: "Smart Charge Limit",
            summary: "Cap charging at 80% on weeknights for battery longevity",
            systemImage: "bolt.badge.checkmark",
            actionCount: 1
        ),
        AutomationPresetTemplate(
            id: "arrive-home-security",
            name: "Arrive Home Security",
            summary: "Disable Sentry and unlock the doors when you reach home",
            systemImage: "house.fill",
            actionCount: 2
        ),
        AutomationPresetTemplate(
            id: "low-battery-alert",
            name: "Low Battery Alert",
            summary: "Send a notification when the charge drops below 20%",
            systemImage: "battery.25",
            actionCount: 1
        )
    ]
}

struct AutomationsListPresetsPanel: View {
    let isCompact: Bool
    let onInstall: (AutomationPresetTemplate) -> Void

    @State private var isExpanded = false

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                summary
                if isExpanded { gallery }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Summary (web <summary>)

    private var summary: some View {
        Button {
            withAnimation(TSAnimation.standard(reduceMotion: false)) { isExpanded.toggle() }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .accessibilityHidden(true)
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text("automations.presets.title")
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !isCompact {
                    Text("automations.presets.hint")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: TSSpacing.sm)
                Text(isExpanded ? "automations.presets.collapse" : "automations.presets.expand")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("automations.presets.toggleAria"))
        .accessibilityAddTraits(isExpanded ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: Gallery body

    private var gallery: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(AutomationPresetTemplate.builtIns) { template in
                AutomationPresetTile(template: template) { onInstall(template) }
            }
        }
        .padding(.top, TSSpacing.xs)
    }

    private var columns: [GridItem] {
        let count = isCompact ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }
}

/// One quick-start template tile (icon + name + summary + action-count + Install).
struct AutomationPresetTile: View {
    let template: AutomationPresetTemplate
    let onInstall: () -> Void

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSIconBox(systemName: template.systemImage, tone: .accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: template.name)
                            .font(Font.TS.bodySm)
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(1)
                        Text(verbatim: actionCountText)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    Spacer(minLength: 0)
                }
                Text(verbatim: template.summary)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer(minLength: 0)
                    TSButton("automations.presets.install", variant: .secondary, size: .small, action: onInstall)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: template.name))
    }

    private var actionCountText: String {
        String(format: String(localized: "automations.presets.actionCount"), template.actionCount)
    }
}
