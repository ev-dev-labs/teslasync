//
//  AlertMessageEditor.Presets.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The preset gallery (web `PresetGalleryModal`): the intro copy, the "All" + tag filter chips, and
//  the phase-switched preset cards (loading / empty / error / grid). Presented as a sheet from the
//  surface. Choosing a card applies its template through the model and dismisses. Copy via the
//  P1/S10 facade; chrome token-driven (P1/S9).
//

import SwiftUI

/// The preset gallery sheet content — switched over the model's preset phase so every branch renders.
struct PresetGallerySheet: View {
    @Bindable var model: AlertMessageEditorModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    AlertMessageEditorStrings.text(
                        "alertEditor.presetModalIntro",
                        "Curated templates for common alert shapes. Tap one to apply it; you can edit it after."
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    if !model.galleryProjection.tags.isEmpty { tagChips }
                    phaseBody
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(Text(verbatim: AlertMessageEditorStrings.string(
                "alertEditor.presetModalTitle",
                "Message Presets"
            )))
            .toolbar { doneButton }
            .accessibilityLabel(Text(verbatim: model.presetAccessibilitySummary))
        }
    }

    private var tagChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                PresetTagChip(
                    title: AlertMessageEditorStrings.string("alertEditor.presetAllTag", "All"),
                    isActive: model.activeTag == nil
                ) { model.setActiveTag(nil) }
                ForEach(model.galleryProjection.tags, id: \.self) { tag in
                    PresetTagChip(title: tag, isActive: model.activeTag == tag) { model.setActiveTag(tag) }
                }
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.presetPhase {
        case .loading:
            PresetGalleryLoadingState()
        case .empty:
            PresetGalleryEmptyState()
        case let .error(message):
            PresetGalleryErrorState(message: message) { model.refresh() }
        case .content:
            cards
        }
    }

    private var cards: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: TSSpacing.sm)], spacing: TSSpacing.sm) {
            ForEach(model.galleryProjection.cards) { card in
                PresetCardView(card: card) { model.applyPreset(card) }
            }
        }
    }

    private var doneButton: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button { model.closePresetGallery() } label: {
                AlertMessageEditorStrings.text("alertEditor.presetDone", "Done")
            }
            .accessibilityLabel(AlertMessageEditorStrings.text("alertEditor.presetDone", "Done"))
        }
    }
}

/// One filter chip (web rounded tag button): accent-tinted when active.
struct PresetTagChip: View {
    let title: String
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textMuted)
                .background(
                    isActive ? Color.TS.accent.opacity(0.12) : Color.TS.surface,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        isActive ? Color.TS.accent.opacity(0.5) : Color.TS.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}

/// One preset card (web gallery item): the name, optional description, the template in a code chip,
/// and the tag chips. Tapping it applies the template.
struct PresetCardView: View {
    let card: PresetCardModel
    let onApply: () -> Void

    var body: some View {
        Button(action: onApply) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: card.name)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if let summary = card.summary, !summary.isEmpty {
                    Text(verbatim: summary)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.leading)
                }
                templateChip
                if !card.tags.isEmpty { tagRow }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: card.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }

    private var templateChip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: card.template)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
                .lineLimit(1)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
        }
        .background(Color.TS.bg.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }

    private var tagRow: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(card.tags, id: \.self) { tag in
                Text(verbatim: tag)
                    .font(.system(size: 10, weight: .medium))
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, 2)
                    .background(Color.TS.bg.opacity(0.4), in: Capsule())
            }
        }
    }
}
