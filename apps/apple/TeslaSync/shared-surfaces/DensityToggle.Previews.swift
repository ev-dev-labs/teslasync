//
//  DensityToggle.Previews.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  Xcode previews for every branch of the list-density selector: the default three-way control (with a
//  live selection readout), a constrained two-option list, a custom group label, the icon-only compact
//  width (web `hidden sm:inline`), and the degenerate empty-options empty state. DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A small stateful harness so the previews are interactive — the controlled `value` updates on every
    /// selection (tap or arrow), exactly as a hosting page would own it.
    @MainActor
    private struct DensityTogglePreviewHarness: View {
        let title: String
        let options: [Density]
        let ariaLabel: String?
        @State private var value: Density

        init(
            title: String,
            value: Density,
            options: [Density] = Density.defaultOptions,
            ariaLabel: String? = nil
        ) {
            self.title = title
            self.options = options
            self.ariaLabel = ariaLabel
            _value = State(initialValue: value)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                DensityToggle(value: value, onChange: { value = $0 }, options: options, ariaLabel: ariaLabel)
                Text(verbatim: "Selected: \(value.rawValue)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: 420, alignment: .leading)
            .background(Color.TS.bg)
        }
    }

    #Preview("Default · 3 options") {
        DensityTogglePreviewHarness(title: "Table / Compact / Comfortable", value: .comfortable)
    }

    #Preview("Constrained options") {
        DensityTogglePreviewHarness(
            title: "Compact / Comfortable only",
            value: .compact,
            options: [.compact, .comfortable]
        )
    }

    #Preview("Custom group label") {
        DensityTogglePreviewHarness(title: "Custom accessible name", value: .table, ariaLabel: "Row spacing")
    }

    #if os(iOS)
        #Preview("Compact width · icon-only") {
            DensityTogglePreviewHarness(title: "hidden sm:inline → icon-only", value: .table)
                .environment(\.horizontalSizeClass, .compact)
        }
    #endif

    #Preview("Empty options · empty state") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: "No options → friendly empty state")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            DensityToggle(value: .table, onChange: { _ in }, options: [])
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }
#endif
