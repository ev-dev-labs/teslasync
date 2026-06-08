//
//  UuidGenerator.swift
//  TeslaSync — P4 feature view · 0024 · UuidGenerator (Apple)
//
//  The UUID Generator devtools surface — SwiftUI parity of
//  features/admin/components/devtools/tools/UuidGenerator.tsx. Composes the web
//  `ToolCard` (icon + title + description over a glass panel) with a Generate
//  action and the most-recent-first list of copyable UUIDs. Binds through
//  `UuidGeneratorModel` (P1/S8); performs no I/O.
//

import SwiftUI

/// The UUID Generator feature view (web `UuidGeneratorTool`). Renders the two
/// states present in the source — empty (no UUIDs yet) and content (the list) —
/// inside the ToolCard shell.
public struct UuidGeneratorView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UuidGeneratorModel.surfaceSlug

    @State private var model: UuidGeneratorModel

    public init(model: UuidGeneratorModel = UuidGeneratorModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                generateAction
                results
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

extension UuidGeneratorView {
    // MARK: ToolCard header (web `ToolCard` icon + title + description)

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                UuidGeneratorStrings.text("Uuid Generator", "UUID Generator")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                UuidGeneratorStrings.text(
                    "Uuid Generator Desc",
                    "Generate random RFC 4122 version 4 UUIDs."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var iconChip: some View {
        Image(systemName: "touchid")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.chartSeriesPower)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.chartSeriesPower.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    // MARK: Generate action (web primary `Button` with RefreshCw)

    private var generateAction: some View {
        TSButton(
            variant: .primary,
            size: .small,
            action: { model.generate() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                    UuidGeneratorStrings.text("Generate", "Generate")
                }
            }
        )
        .accessibilityLabel(
            Text(verbatim: UuidGeneratorStrings.string("uuidGenerator.generate.a11y", "Generate a new UUID"))
        )
    }

    // MARK: Results — empty state or the UUID list (never a blank box)

    @ViewBuilder
    private var results: some View {
        switch model.phase {
        case .empty:
            emptyState
        case .content:
            uuidList
        }
    }

    private var emptyState: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
            VStack(alignment: .leading, spacing: 2) {
                UuidGeneratorStrings.text("uuidGenerator.empty.title", "No UUIDs yet")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                UuidGeneratorStrings.text("uuidGenerator.empty.message", "Tap Generate to create a UUID.")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var uuidList: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(Array(model.entries.enumerated()), id: \.element.id) { index, entry in
                row(for: entry, index: index)
            }
        }
    }

    private func row(for entry: UuidEntry, index: Int) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: entry.value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            TSCopyButton(value: entry.value)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(
                verbatim: UuidGeneratorAccessibility.rowLabel(
                    index: index + 1,
                    total: model.entries.count,
                    value: entry.value
                )
            )
        )
    }
}
