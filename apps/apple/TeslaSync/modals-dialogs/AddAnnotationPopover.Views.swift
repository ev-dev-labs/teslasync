//
//  AddAnnotationPopover.Views.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The populated content for `AddAnnotationPopover`: the modal header (tag glyph + "Add Annotation"
//  title + freshness chip + close), and the form — an editable date or a read-only timestamp, the
//  required label field, the six category pills (glyph + `ANNOTATION_COLORS` tint), the optional
//  description field, and the Cancel / Add-Annotation footer. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the tag glyph, the "Add Annotation" title + freshness chip, and the trailing
/// close button (web `Modal` title bar with its `onClose` "×").
struct AddAnnotationHeader: View {
    let connection: AddAnnotationConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                AddAnnotationStrings.text("annotation.addTitle", "Add Annotation")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                AddAnnotationFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "bookmark.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AddAnnotationStrings.text("addAnnotation.closeAria", "Close"))
    }
}

// MARK: - Form (web populated `<form>`)

/// The populated form shown for `.content`: the inline reload error (when a refresh failed while a
/// cached context remains), the date / timestamp, the label, the category pills, the description,
/// and the footer actions.
struct AddAnnotationForm: View {
    @Bindable var model: AddAnnotationModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                AddAnnotationInlineError(message: message)
            }
            dateSection
            AddAnnotationTextField(
                text: $model.label,
                label: AddAnnotationStrings.string("annotation.label", "Label"),
                prompt: AddAnnotationStrings.string(
                    "annotation.labelPlaceholder", // parity:allow web i18n key from AddAnnotationPopover.tsx
                    "e.g., Battery replaced"
                ),
                maxLength: 50
            )
            AddAnnotationCategoryPills(model: model)
            AddAnnotationTextField(
                text: $model.annotationDescription,
                label: AddAnnotationStrings.string("annotation.description", "Description"),
                prompt: AddAnnotationStrings.string(
                    "annotation.descPlaceholder", // parity:allow web i18n key from AddAnnotationPopover.tsx
                    "Optional description..."
                ),
                maxLength: 200
            )
            AddAnnotationFooter(canSubmit: model.canSubmit, onCancel: onCancel, onSubmit: onSubmit)
        }
    }

    @ViewBuilder
    private var dateSection: some View {
        if model.editableDate {
            AddAnnotationDateField(editedDate: $model.editedDate)
        } else {
            AddAnnotationTimestampRow(
                timestamp: model.fixedTimestamp,
                day: AddAnnotationDateValue.inputValue(fromTimestamp: model.fixedTimestamp),
                localize: model.localize
            )
        }
    }
}

// MARK: - Date field (web `<input type="date">`) / read-only timestamp

/// The editable date field (web `editableDate` → `<Input type="date" max={today} required>`), bound
/// through a `String` ⇄ `Date` bridge so the model keeps the web `YYYY-MM-DD` shape.
struct AddAnnotationDateField: View {
    @Binding var editedDate: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            AddAnnotationFieldLabel(text: AddAnnotationStrings.string("annotation.date", "Date"))
            DatePicker(
                selection: dateBinding,
                in: ...Date(),
                displayedComponents: .date
            ) {
                AddAnnotationStrings.text("annotation.date", "Date")
            }
            .labelsHidden()
            .datePickerStyle(.compact)
            .accessibilityLabel(AddAnnotationStrings.text("annotation.date", "Date"))
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { AddAnnotationDateValue.date(fromInputValue: editedDate) ?? Date() },
            set: { editedDate = AddAnnotationDateValue.inputValue(fromDate: $0) }
        )
    }
}

/// The read-only timestamp shown when the date is not editable (web fixed-date `<div>` text).
struct AddAnnotationTimestampRow: View {
    let timestamp: String
    let day: String
    let localize: (String, String) -> String

    var body: some View {
        Text(verbatim: day.isEmpty ? timestamp : day)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: AddAnnotationAccessibility.timestampLabel(
                day.isEmpty ? timestamp : day,
                localize: localize
            )))
    }
}

// MARK: - Text field (web `<Input>`)

/// A labelled single-line text field with a length cap (web `<Input maxLength=…>`), resolved copy,
/// and token chrome. The visible label sits above; the control's accessibility name is the field
/// label so VoiceOver announces it.
struct AddAnnotationTextField: View {
    @Binding var text: String
    let label: String
    let prompt: String
    let maxLength: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            AddAnnotationFieldLabel(text: label)
            TextField(text: $text, prompt: Text(verbatim: prompt)) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: label))
            .onChange(of: text) { _, newValue in
                if newValue.count > maxLength { text = String(newValue.prefix(maxLength)) }
            }
        }
    }
}

// MARK: - Category pills (web pill row)

/// The category selector: the "Category" label above a wrapping row of six pills (web
/// `CATEGORY_OPTIONS.map`). The selected pill is tinted with its `ANNOTATION_COLORS` value.
struct AddAnnotationCategoryPills: View {
    @Bindable var model: AddAnnotationModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            AddAnnotationFieldLabel(text: AddAnnotationStrings.string("annotation.category", "Category"))
            AddAnnotationFlowLayout(spacing: TSSpacing.xs) {
                ForEach(model.categoryOptions) { option in
                    AddAnnotationCategoryPill(
                        option: option,
                        selected: option.category == model.category,
                        accessibilityLabel: model.accessibilityCategoryLabel(for: option)
                    ) {
                        model.category = option.category
                    }
                }
            }
        }
    }
}

/// One category pill: the category glyph + label, tinted with the category color when selected (web
/// `style={{ color: ANNOTATION_COLORS[value] }}` + `border-current`).
struct AddAnnotationCategoryPill: View {
    let option: AddAnnotationCategoryOption
    let selected: Bool
    let accessibilityLabel: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Image(systemName: option.systemImage).font(.system(size: 11, weight: .semibold))
                AddAnnotationStrings.text(option.labelKey, option.labelFallback).font(Font.TS.label)
            }
            .foregroundStyle(selected ? tint : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(selected ? Color.TS.surfaceGlass : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? tint.opacity(0.55) : Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private var tint: Color {
        addAnnotationColor(option.colorHex)
    }
}

// MARK: - Flow layout (web `flex-wrap`)

/// A leading-aligned wrapping layout — the native analog of the web `flex flex-wrap gap-1.5` pill
/// row. Places pills left-to-right, wrapping to a new line when the next pill would overflow.
struct AddAnnotationFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        arrange(subviews: subviews, maxWidth: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let arrangement = arrange(subviews: subviews, maxWidth: bounds.width)
        for index in subviews.indices {
            let frame = arrangement.frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(subviews: Subviews, maxWidth: CGFloat) -> (size: CGSize, frames: [CGRect]) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
            widest = max(widest, min(cursorX - spacing, maxWidth.isFinite ? maxWidth : cursorX))
        }
        let width = maxWidth.isFinite ? maxWidth : widest
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}

// MARK: - Footer (web Cancel + Add)

/// The form footer: the ghost Cancel and the primary Add-Annotation action (web footer row). Add is
/// disabled until the label is non-empty (web `disabled={!label.trim()}`).
struct AddAnnotationFooter: View {
    let canSubmit: Bool
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: AddAnnotationStrings.string("common.cancel", "Cancel"))
            }
            .accessibilityLabel(AddAnnotationStrings.text("common.cancel", "Cancel"))
            TSButton(variant: .primary, size: .small, action: onSubmit) {
                Text(verbatim: AddAnnotationStrings.string("annotation.add", "Add Annotation"))
            }
            .disabled(!canSubmit)
            .accessibilityLabel(AddAnnotationStrings.text("annotation.add", "Add Annotation"))
        }
    }
}

// MARK: - Field label + helpers

/// A form field's visible label (web `<Input label>` / category heading), styled as a token label.
struct AddAnnotationFieldLabel: View { let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Parses a `#RRGGBB` hex (the `ANNOTATION_COLORS` shape) into a `Color`. A malformed value falls
/// back to the accent so a pill never renders invisibly.
func addAnnotationColor(_ hex: String) -> Color {
    var trimmed = hex.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("#") { trimmed.removeFirst() }
    guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else { return Color.TS.accent }
    let red = Double((value >> 16) & 0xFF) / 255
    let green = Double((value >> 8) & 0xFF) / 255
    let blue = Double(value & 0xFF) / 255
    return Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
}

// MARK: - Localization Text helper

extension AddAnnotationStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
