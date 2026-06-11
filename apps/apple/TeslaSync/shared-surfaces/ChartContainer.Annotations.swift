//
//  ChartContainer.Annotations.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The annotation chrome composed by the surface: the collapsed marker row shown above the chart on
//  compact widths (web mobile marker row), the annotation footer list with per-row delete (web
//  `AnnotationList`), and the add-annotation form sheet (web `AddAnnotationPopover`). All copy
//  resolves through the P1/S10 facade; the shared field + button primitives are reused; no
//  networking lives here (the form forwards a validated draft to the model).
//

import SwiftUI

// MARK: - Localisation helper

/// Wraps a facade-resolved string as a `LocalizedStringKey` for the shared field primitives, which
/// take a key rather than verbatim text. The resolved English (or localised) value is rendered
/// as-is when it is not itself a catalog key, so the per-surface table stays authoritative.
enum ChartContainerL10n {
    static func key(_ resolved: String) -> LocalizedStringKey {
        LocalizedStringKey(resolved)
    }
}

// MARK: - Marker row (web mobile annotation markers)

/// The collapsed annotation marker row — a wrapping set of category-tinted chips rendered above the
/// chart on compact widths so the vertical reference lines never hide the chart line. Shown only when
/// annotations are enabled, visible, and present (web `showMarkerRow`).
struct ChartContainerMarkerRow: View {
    let annotations: [ChartContainerAnnotation]

    private var rowLabel: String {
        ChartContainerStrings.string("annotations.markerRow", "Annotations on this chart")
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(annotations) { annotation in
                    chip(annotation)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: rowLabel))
    }

    private func chip(_ annotation: ChartContainerAnnotation) -> some View {
        let tone = ChartContainerPalette.color(for: annotation.category)
        return HStack(spacing: 4) {
            Image(systemName: "tag")
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: annotation.label)
                .font(Font.TS.caption)
                .lineLimit(1)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: annotation.tooltip))
    }
}

// MARK: - Annotation list footer (web `AnnotationList`)

/// The annotation footer — the full fetched list (independent of the hide toggle, matching the web
/// `AnnotationList` which always shows the managed rows) with a per-row delete affordance that
/// forwards to the model's validated remove.
struct ChartContainerAnnotationList: View {
    let annotations: [ChartContainerAnnotation]
    let onRemove: (String) -> Void

    private var heading: String {
        ChartContainerStrings.string("annotations.listTitle", "Annotations")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: heading)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            ForEach(annotations) { annotation in
                row(annotation)
                if annotation.id != annotations.last?.id {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .padding(.top, TSSpacing.sm)
    }

    private func row(_ annotation: ChartContainerAnnotation) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Circle()
                .fill(ChartContainerPalette.color(for: annotation.category))
                .frame(width: 8, height: 8)
                .padding(.top, 5)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: annotation.label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                if let description = annotation.description, !description.isEmpty {
                    Text(verbatim: description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Button {
                onRemove(annotation.id)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ChartContainerStrings.string("annotations.remove", "Remove annotation")))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Add-annotation form (web `AddAnnotationPopover`)

/// The add-annotation form presented in a sheet — the native port of the web `AddAnnotationPopover`:
/// a label field, a category select, an optional description, and an editable date (web
/// `editableDate`). The "Add" action is disabled until the draft is valid (web `if (!occurredAt)`),
/// and a valid submit forwards the parts to the model. No networking lives here.
struct ChartContainerAddAnnotationForm: View {
    let onAdd: (
        _ label: String,
        _ category: ChartContainerAnnotationCategory,
        _ description: String?,
        _ occurredAt: String
    ) -> Void
    let onCancel: () -> Void

    @State private var label = ""
    @State private var descriptionText = ""
    @State private var category: ChartContainerAnnotationCategory = .milestone
    @State private var occurredAt = Date()

    private var occurredAtISO: String {
        ISO8601DateFormatter().string(from: occurredAt)
    }

    private var canAdd: Bool {
        ChartContainerLogic.isValidNewAnnotation(label: label, occurredAt: occurredAtISO)
    }

    private var categoryOptions: [TSSelectOption<ChartContainerAnnotationCategory>] {
        ChartContainerAnnotationCategory.allCases.map { category in
            TSSelectOption(
                category,
                ChartContainerL10n.key(ChartContainerStrings.string(category.labelKey, category.labelFallback))
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            Text(verbatim: ChartContainerStrings.string("annotations.add", "Add annotation"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)

            TSTextField(
                ChartContainerL10n.key(ChartContainerStrings.string("annotations.field.label", "Label")),
                text: $label,
                label: ChartContainerL10n.key(ChartContainerStrings.string("annotations.field.label", "Label"))
            )

            TSSelect(
                selection: $category,
                options: categoryOptions,
                label: ChartContainerL10n.key(ChartContainerStrings.string("annotations.field.category", "Category"))
            )

            TSTextArea(
                text: $descriptionText,
                label: ChartContainerL10n.key(
                    ChartContainerStrings.string("annotations.field.description", "Description (optional)")
                ),
                minHeight: 72
            )

            TSDatePickerBridge(
                ChartContainerL10n.key(ChartContainerStrings.string("annotations.field.date", "Date")),
                date: $occurredAt,
                components: [.date, .hourAndMinute]
            )

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(
                    ChartContainerL10n.key(ChartContainerStrings.string("action.cancel", "Cancel")),
                    variant: .ghost,
                    size: .small,
                    action: onCancel
                )
                TSButton(variant: .primary, size: .small) {
                    onAdd(label, category, descriptionText.isEmpty ? nil : descriptionText, occurredAtISO)
                } label: {
                    Text(verbatim: ChartContainerStrings.string("annotations.add", "Add annotation"))
                        .font(Font.TS.label)
                }
                .disabled(!canAdd)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
