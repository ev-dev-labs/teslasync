//
//  SortControl.Previews.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  Xcode previews for every branch of the list sort control: the default multi-field control with a live
//  readout (ascending), the descending direction, the field-not-in-options edge (the trigger falls back to
//  the raw key), a custom direction accessible name, and the degenerate empty-options chip. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A small stateful harness so the previews are interactive — the controlled `field` + `direction`
    /// update on every pick / flip, exactly as a hosting page would own them.
    @MainActor
    private struct SortControlPreviewHarness: View {
        let title: String
        let options: [SortOption]
        let directionAriaLabel: String?
        @State private var field: String
        @State private var direction: SortDirection

        init(
            title: String,
            field: String,
            direction: SortDirection,
            options: [SortOption],
            directionAriaLabel: String? = nil
        ) {
            self.title = title
            self.options = options
            self.directionAriaLabel = directionAriaLabel
            _field = State(initialValue: field)
            _direction = State(initialValue: direction)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                SortControl(
                    field: field,
                    direction: direction,
                    options: options,
                    onFieldChange: { field = $0 },
                    onDirectionChange: { direction = $0 },
                    directionAriaLabel: directionAriaLabel
                )
                Text(verbatim: "Sort: \(field) · \(direction.rawValue)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: 420, alignment: .leading)
            .background(Color.TS.bg)
        }
    }

    private let driveOptions: [SortOption] = [
        SortOption(value: "date", label: "Date"),
        SortOption(value: "distance", label: "Distance"),
        SortOption(value: "score", label: "Score")
    ]

    #Preview("Default · ascending") {
        SortControlPreviewHarness(
            title: "Date / Distance / Score",
            field: "distance",
            direction: .asc,
            options: driveOptions
        )
    }

    #Preview("Descending") {
        SortControlPreviewHarness(
            title: "Descending direction",
            field: "date",
            direction: .desc,
            options: driveOptions
        )
    }

    #Preview("Field not in options") {
        SortControlPreviewHarness(
            title: "Unknown field → raw key on trigger",
            field: "energy",
            direction: .desc,
            options: driveOptions
        )
    }

    #Preview("Custom direction label") {
        SortControlPreviewHarness(
            title: "Custom accessible name",
            field: "score",
            direction: .asc,
            options: driveOptions,
            directionAriaLabel: "Toggle ranking order"
        )
    }

    #Preview("Empty options · empty chip") {
        SortControlPreviewHarness(
            title: "No fields → friendly empty chip + direction toggle",
            field: "date",
            direction: .asc,
            options: []
        )
    }
#endif
