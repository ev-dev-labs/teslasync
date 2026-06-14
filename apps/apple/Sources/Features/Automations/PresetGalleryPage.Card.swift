import SwiftUI

// The preset-template card + its loading skeleton (web `PresetCard` / `PresetCardSkeleton`).
// Both wrap the shared `TSGlassPanel` (web `GlassPanel`) — the two GlassPanel parity units of the
// `PresetGallery` surface. The card is the populated form (icon, name, trigger-label subtitle,
// action-count badge, description, full-width Install); the skeleton is its loading form.

// MARK: - GlassPanel1 — populated preset card (web `PresetCard`)

/// One automation-preset card (web `PresetCard`). Installing opens the typed builder pre-filled
/// (web `navigate('/automations/new?preset=' + id)`), surfaced here as the injected `onInstall`
/// shell hook so this surface stays free of cross-page navigation wiring.
struct PresetGalleryCard: View {
    let preset: PresetGalleryItem
    let onInstall: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                description
                installButton
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: preset.name))
    }

    // MARK: Header (icon + name + trigger label + action-count badge)

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            TSIconBox(systemName: preset.systemImage, tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: preset.name)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(LocalizedStringKey(preset.triggerLabelKey))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            TSBadge(LocalizedStringKey(actionCountText), tone: .neutral)
                .fixedSize()
        }
    }

    // MARK: Description (web `line-clamp-2`)

    private var description: some View {
        Text(verbatim: preset.description)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Install (web full-width secondary button)

    private var installButton: some View {
        TSButton(variant: .secondary, size: .small, action: onInstall) {
            Label("automations.presets.install", systemImage: "plus")
                .frame(maxWidth: .infinity)
        }
    }

    /// Web `t('automations.presets.actionCount', '{{count}} actions', { count })` — the catalog
    /// format (`%lld actions`) resolved with the preset's action count.
    private var actionCountText: String {
        String(format: String(localized: "automations.presets.actionCount"), preset.actionCount)
    }
}

// MARK: - GlassPanel2 — loading skeleton card (web `PresetCardSkeleton`)

/// The loading form of a preset card (web `PresetCardSkeleton`): a glass panel of shimmer blocks
/// matching the populated card's layout, so the grid reflows without a jump.
struct PresetGalleryCardSkeleton: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 128, height: 14)
                        TSSkeleton(width: 80, height: 12)
                    }
                    Spacer(minLength: 0)
                }
                TSSkeleton(height: 32)
                TSSkeleton(height: 28)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }
}

#if DEBUG
    #Preview("Preset card") {
        PresetGalleryCard(
            preset: PresetGalleryItem(
                id: "arrive-home-security",
                name: "Arrive Home Security",
                description: "Disable Sentry and unlock the doors when you reach the home geofence.",
                icon: "ShieldCheck",
                triggerKind: .geofence,
                actionCount: 2
            )
        ) {}
            .frame(width: 280)
            .padding()
            .teslaSyncTheme()
    }

    #Preview("Preset card skeleton") {
        PresetGalleryCardSkeleton()
            .frame(width: 280)
            .padding()
            .teslaSyncTheme()
    }
#endif
