//
//  TemplateGallery.Views.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  The presentational subviews that compose the TemplateGallery surface — the
//  native parity of the web `TemplateCard`, the "Blank" card, `TemplateDetail`,
//  `MiniGridPreview`, the category-icon row, and the loading / empty / error
//  states. They are pure functions of their projections (from
//  ``TemplateGalleryAdapter``) so the parent owns all state.
//

import SwiftUI

// MARK: - Gallery list (web `StaggerContainer` grid: Blank card + preset cards)

struct TemplateGalleryList: View {
    let templates: [TemplateGalleryTemplate]
    let onSelectBlank: () -> Void
    let onSelect: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStaggerItem(index: 0) {
                TemplateGalleryBlankCard(action: onSelectBlank)
            }
            ForEach(Array(templates.enumerated()), id: \.element.id) { index, template in
                TSStaggerItem(index: index + 1) {
                    TemplateGalleryCard(
                        projection: TemplateGalleryAdapter.card(for: template),
                        action: { onSelect(template.id) }
                    )
                }
            }
        }
    }
}

// MARK: - Blank card (web dashed "Blank Dashboard" option)

struct TemplateGalleryBlankCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "square.grid.2x2.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 44, height: 44)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TemplateGalleryStrings.text("templates.blank", "Blank Dashboard")
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    TemplateGalleryStrings
                        .text("templates.blank.desc", "Start from scratch and add widgets manually")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.lg)
            .modifier(TemplateGalleryCardSurface(dashed: true))
        }
        .buttonStyle(TemplateGalleryCardButtonStyle())
        .accessibilityLabel(Text(verbatim: TemplateGalleryAccessibility.blankLabel()))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Preset card (web `TemplateCard`)

struct TemplateGalleryCard: View {
    let projection: TemplateGalleryCardProjection
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TemplateGalleryMiniGrid(grid: projection.grid)
                infoRow
                if let key = projection.descriptionKey, let fallback = projection.descriptionFallback {
                    TemplateGalleryStrings.text(key, fallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
                TemplateGalleryCategoryRow(icons: projection.categoryIcons)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .modifier(TemplateGalleryCardSurface(dashed: false))
        }
        .buttonStyle(TemplateGalleryCardButtonStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: TemplateGalleryAccessibility.cardLabel(
                name: TemplateGalleryStrings.string(projection.nameKey, projection.nameFallback),
                widgetCount: projection.widgetCount
            ))
        )
        .accessibilityHint(
            TemplateGalleryStrings.text("templates.card.hint", "Opens a preview of this template")
        )
        .accessibilityAddTraits(.isButton)
    }

    private var infoRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            TemplateGalleryStrings.text(projection.nameKey, projection.nameFallback)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 0)
            TemplateGalleryCountBadge(count: projection.widgetCount)
        }
    }
}

// MARK: - Detail (web `TemplateDetail`)

struct TemplateGalleryDetail: View {
    let projection: TemplateGalleryDetailProjection
    let onApply: () -> Void
    let onBack: () -> Void

    private let widgetColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm)]

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TemplateGalleryMiniGrid(grid: projection.grid, fixedHeight: 180)
                heading
                widgetGrid
                actionBar
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TemplateGalleryStrings.text(projection.nameKey, projection.nameFallback)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let key = projection.descriptionKey, let fallback = projection.descriptionFallback {
                TemplateGalleryStrings.text(key, fallback)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text(verbatim: TemplateGalleryStrings.widgetCount(projection.widgetCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var widgetGrid: some View {
        LazyVGrid(columns: widgetColumns, spacing: TSSpacing.sm) {
            ForEach(projection.widgets) { widget in
                TemplateGalleryWidgetChip(widget: widget)
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: onBack) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.left").font(.system(size: 12, weight: .semibold))
                    TemplateGalleryStrings.text("common.back", "Back")
                }
            }
            .accessibilityLabel(TemplateGalleryStrings.text("common.back", "Back"))
            TSButton(variant: .primary, size: .small, action: onApply) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold))
                    TemplateGalleryStrings.text("templates.apply", "Use This Template")
                }
            }
            .accessibilityLabel(TemplateGalleryStrings.text("templates.apply", "Use This Template"))
        }
        .padding(.top, TSSpacing.xs)
    }
}

// MARK: - Widget chip (web detail widget cell: icon + name)

struct TemplateGalleryWidgetChip: View {
    let widget: TemplateGalleryWidget

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: widget.systemImage)
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: widget.name)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: widget.name))
    }
}

// MARK: - Category icon row (web `useCategoryIcons` chips)

struct TemplateGalleryCategoryRow: View {
    let icons: [TemplateGalleryCategoryIcon]

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(icons) { icon in
                Image(systemName: icon.systemImage)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 22, height: 22)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    )
                    .accessibilityLabel(Text(verbatim: TemplateGalleryAccessibility.categoryLabel(icon.category)))
            }
        }
    }
}

// MARK: - Widget-count badge (web `<Badge variant="neutral">`)

struct TemplateGalleryCountBadge: View {
    let count: Int

    var body: some View {
        Text(verbatim: "\(count)")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}
