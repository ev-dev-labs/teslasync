//
//  AlertStudioPage.Views.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The left-column presentational pieces of the AlertStudioPage surface: the shared
//  severity visual + freshness chip, the editor-state binding helper, the templates
//  browser (web `showTemplates` panel: header count, search, category chips, the card
//  grid, the no-matches empty state), and the rules list (web left column: title +
//  count + freshness, the rule search, the bulk-actions toolbar, the rule rows with
//  their once/snooze badges + snooze/toggle/delete actions, and the empty / no-matches
//  states). All strings resolve through the injected localizer; all colors + spacing
//  come from the P1/S9 tokens — no Tailwind ported.
//

import SwiftUI

// MARK: - Shared visuals

/// A responsive two-pane row (web `grid grid-cols-1 sm:grid-cols-2`): side-by-side on
/// regular width, stacked on compact (iPhone / narrow split).
struct ASResponsivePair<Leading: View, Trailing: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let leading: () -> Leading
    private let trailing: () -> Trailing

    init(
        @ViewBuilder leading: @escaping () -> Leading,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.leading = leading
        self.trailing = trailing
    }

    var body: some View {
        if horizontalSizeClass == .compact {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                leading()
                trailing()
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                leading().frame(maxWidth: .infinity, alignment: .leading)
                trailing().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// Maps a rule severity onto the shared status tone + an SF Symbol (web `SeverityIcon`
/// + `severityTokens`).
enum ASSeverityVisual {
    static func tone(_ severity: ASSeverity) -> TSTone {
        switch severity {
        case .info: .info
        case .warn: .warning
        case .critical: .danger
        }
    }

    static func systemImage(_ severity: ASSeverity) -> String {
        switch severity {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

/// The live-stream freshness chip (web SSE freshness): `stale` / `offline` surface a
/// static chip so the page never implies fresher data than the stream can prove.
/// `live` renders nothing.
struct ASFreshnessChip: View {
    let connection: ASConnection
    let localize: ASLocalizer

    var body: some View {
        switch connection {
        case .live:
            EmptyView()
        case .stale:
            chip(ASCopy.freshnessStale, tone: .warning, systemImage: "clock.arrow.circlepath")
        case .offline:
            chip(ASCopy.freshnessOffline, tone: .neutral, systemImage: "wifi.slash")
        }
    }

    private func chip(_ text: ASText, tone: TSTone, systemImage: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.system(size: 10, weight: .semibold))
            Text(localize.key(text)).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Editor binding helper

extension AlertStudioViewModel {
    /// A two-way binding into a plain editor field that routes writes through
    /// `updateEditor` (so the draft autosave runs). Special fields (signal / operator /
    /// severity / trigger mode / escalation) use their dedicated handlers instead.
    func editorBinding<Value>(_ keyPath: WritableKeyPath<EditorState, Value>) -> Binding<Value> {
        Binding(
            get: { self.editor[keyPath: keyPath] },
            set: { newValue in self.updateEditor { $0[keyPath: keyPath] = newValue } }
        )
    }
}

// MARK: - Templates browser (web `showTemplates` panel)

struct ASTemplatesPanel: View {
    @Bindable var viewModel: AlertStudioViewModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                headerRow
                categoryChips
                grid
            }
        }
    }

    private var headerRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(localize.key(ASCopy.templatesHeader, "count", String(AlertStudioTemplates.all.count)))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            TSSearchInput(text: $viewModel.templateSearch, prompt: localize.key(ASCopy.templatesSearchPrompt))
        }
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                categoryChip(
                    title: "\(localize.string(ASCopy.templatesAll)) (\(AlertStudioTemplates.all.count))",
                    isSelected: viewModel.templateCategory == nil,
                    action: { viewModel.templateCategory = nil }
                )
                ForEach(AlertStudioTemplates.categories, id: \.self) { category in
                    let count = AlertStudioTemplates.all.count(where: { $0.category == category })
                    categoryChip(
                        title: "\(viewModel.templateCategoryLabel(category)) (\(count))",
                        isSelected: viewModel.templateCategory == category,
                        action: {
                            viewModel.templateCategory = viewModel.templateCategory == category ? nil : category
                        }
                    )
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func categoryChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(
                    isSelected ? Color.TS.accent.opacity(0.12) : Color.TS.surface,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        isSelected ? Color.TS.accent.opacity(0.3) : Color.TS.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    @ViewBuilder
    private var grid: some View {
        let templates = viewModel.filteredTemplates
        if templates.isEmpty {
            TSEmptyState(
                title: localize.key(ASCopy.templatesNoMatchesTitle),
                message: localize.key(ASCopy.templatesNoMatches),
                systemImage: "sparkles"
            )
            .frame(maxWidth: .infinity)
        } else {
            LazyVGrid(columns: gridColumns, spacing: TSSpacing.md) {
                ForEach(templates) { template in
                    ASTemplateCard(viewModel: viewModel, template: template)
                }
            }
        }
    }

    private var gridColumns: [GridItem] {
        let count = horizontalSizeClass == .compact ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }
}

/// One template card (web template `GlassPanel` button).
struct ASTemplateCard: View {
    let viewModel: AlertStudioViewModel
    let template: RuleTemplate

    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        Button {
            viewModel.requestCloneTemplate(template)
        } label: {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSIconBox(systemName: template.systemImage, tone: ASSeverityVisual.tone(template.severity))
                    Text(verbatim: viewModel.templateName(template))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                }
                Text(verbatim: viewModel.templateMessage(template))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                HStack {
                    TSBadge(
                        localize.key(ASCopy.severityLabel(template.severity)),
                        tone: ASSeverityVisual.tone(template.severity)
                    )
                    Spacer(minLength: 0)
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "doc.on.doc").font(.system(size: 10))
                        Text(localize.key(ASCopy.templatesUse)).font(Font.TS.caption)
                    }
                    .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: viewModel.templateName(template)))
        .accessibilityHint(Text(localize.key(ASCopy.templatesUse)))
    }
}
