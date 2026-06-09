//
//  PresetGallery.Views.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The populated content orchestrator + the single preset card composed by
//  `PresetGallery`. The web page renders `FadeIn` > `StaggerContainer` over a responsive
//  card grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`); the native
//  parity is a `LazyVGrid` of adaptive columns with each card staggered in via
//  `TSStaggerItem`. Each `PresetCard` maps the web `GlassPanel` card — icon chip, name,
//  trigger subtitle, action-count badge, description, and the Install button. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking
//  and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Grid layout (web responsive `grid-cols-*`)

/// The responsive column track shared by the loading skeletons and the content grid. The
/// adaptive minimum lets the grid widen from one column on a phone to four on a Mac /
/// iPad, the native parity of the web `sm/lg/xl` breakpoints.
enum AutomationPresetGalleryLayout {
    static let columns: [GridItem] = [
        GridItem(.adaptive(minimum: 240, maximum: .infinity), spacing: TSSpacing.lg, alignment: .top)
    ]
}

// MARK: - Content (web `FadeIn` > `StaggerContainer` of `PresetCard`)

/// The populated grid: the inline list-error (when a reload failed while items remain)
/// followed by the staggered preset cards (web `StaggerContainer` of `PresetCard`s).
struct AutomationPresetGalleryContent: View {
    @Bindable var model: AutomationPresetGalleryModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                AutomationPresetGalleryInlineError(message: message)
            }
            LazyVGrid(columns: AutomationPresetGalleryLayout.columns, spacing: TSSpacing.lg) {
                ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                    TSStaggerItem(index: index) {
                        AutomationPresetCard(model: model, item: item)
                    }
                }
            }
        }
    }
}

// MARK: - Preset card (web `PresetCard` inside a `GlassPanel`)

/// One preset template card (web `PresetCard`): the tinted icon chip, the name + trigger
/// subtitle, the action-count badge, the description, and the Install button that opens
/// the builder seeded with the preset (web `navigate('/automations/new?preset={id}')`).
struct AutomationPresetCard: View {
    @Bindable var model: AutomationPresetGalleryModel
    let item: AutomationPresetItem

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                Text(verbatim: item.summary)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                installButton
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: item.symbolName, tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: model.triggerLabel(for: item))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: TSSpacing.sm)
            TSBadge(LocalizedStringKey(model.actionCountLabel(for: item)), tone: .neutral)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel(for: item)))
    }

    private var installButton: some View {
        TSButton(variant: .secondary, size: .small, action: install) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                AutomationPresetGalleryStrings.text("automations.presets.install", "Install")
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(Text(verbatim: model.installAccessibilityLabel(for: item)))
    }

    private func install() {
        model.install(item)
    }
}
