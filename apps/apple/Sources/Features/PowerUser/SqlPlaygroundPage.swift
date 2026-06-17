import SwiftUI

/// Native SwiftUI parity of `web/src/features/power-user/pages/SqlPlaygroundPage.tsx`
/// (route `/power/sql`). The web page is a manual read-only SQL surface: a page header
/// (title + intro), the opt-in `<AINLSqlPlayground>` Helix drafter, a deterministic manual SQL
/// editor (textarea + Run/Clear + a help message — the page exposes NO execution endpoint), and
/// an install-static curated schema catalog. This page reproduces every region: the header, the
/// already-shipped `AINLSqlPlayground` surface (hosted, not re-implemented — DRY — with its
/// `onApply` wired to copy a draft into the editor), and the two `GlassPanel`s (editor + catalog),
/// all bound through the `@Observable` `SqlPlaygroundPageModel` (ADR-004 — no networking in the
/// view). Adaptive across macOS/iPad (regular) + iPhone (compact) via the shared P2 tokens + P3
/// components (ADR-002/006).
public struct SqlPlaygroundPage: View {
    @State private var model: SqlPlaygroundPageModel

    public init(model: SqlPlaygroundPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                AINLSqlPlayground(model: model.drafter)
                editorPanel
                catalogPanel
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: 1024, alignment: .leading) // web centered column
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageTitle + intro paragraph)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSPageTitle(model.titleKey)
            Text(model.introKey)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    // MARK: - GlassPanel 1 — Manual SQL editor

    private var editorPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle(model.editorTitleKey)
                SqlEditorField(text: sqlBinding, label: model.editorLabelKey, prompt: model.editorPromptKey)
                editorActions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var editorActions: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                TSButton(model.runKey, variant: .primary, action: model.run)
                    .disabled(!model.canRun)
                TSButton(model.clearKey, variant: .secondary, action: model.clear)
                    .disabled(!model.canRun)
                Spacer(minLength: 0)
            }
            if let runMessage = model.runMessage {
                Text(runMessage.key)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.statusWarning)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - GlassPanel 2 — Curated schema catalog

    private var catalogPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle(model.catalogTitleKey)
                Text(model.catalogIntroKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: TSSpacing.md) {
                    ForEach(model.tables) { table in
                        SqlCatalogTableCard(table: table)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var sqlBinding: Binding<String> {
        Binding(get: { model.sql }, set: { model.sql = $0 })
    }
}

// MARK: - SQL editor field (web `Textarea`)

/// The manual SQL editor — the native parity of the web `Textarea` (rows=10, spellCheck off). An
/// empty editor shows the localized prompt text (web textarea hint, decorative + a11y-hidden); the
/// field carries the web `aria-label` (web `powerSql.editor.label`) for VoiceOver. Monospaced for
/// SQL, tokenised chrome (no raw hex).
private struct SqlEditorField: View {
    @Binding var text: String
    let label: LocalizedStringKey
    let prompt: LocalizedStringKey

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(prompt)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm + 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 200)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .autocorrectionDisabled(true)
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: text))
    }
}

// MARK: - Curated catalog table card (web catalog `<li>`)

/// One curated table card — the native port of each web catalog `<li>`: the table name (mono,
/// cyan accent) + its description, then the wrapping column list (each: name in green + type +
/// description). The column grid is adaptive (web `grid-cols-1 sm:grid-cols-2`): one column when
/// narrow (iPhone), two+ when wide (iPad/macOS).
private struct SqlCatalogTableCard: View {
    let table: SqlCatalogTable

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: table.name)
                    .font(.system(size: 15, design: .monospaced))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: table.summary)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 260), alignment: .leading)],
                alignment: .leading,
                spacing: TSSpacing.xs
            ) {
                ForEach(table.columns) { column in
                    Text(Self.columnLine(column))
                        .font(Font.TS.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel(Text(verbatim: "\(column.name), \(column.type), \(column.detail)"))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    /// Composes one column's `name · type — description` line with per-run colors (web: green
    /// name, muted separators, secondary type/description), wrapping naturally as a single `Text`.
    private static func columnLine(_ column: SqlCatalogColumn) -> AttributedString {
        var name = AttributedString(column.name)
        name.foregroundColor = Color.TS.statusSuccess
        name.font = .system(size: 11, design: .monospaced)
        var separator1 = AttributedString(" · ")
        separator1.foregroundColor = Color.TS.textMuted
        var type = AttributedString(column.type)
        type.foregroundColor = Color.TS.textSecondary
        var separator2 = AttributedString(" — ")
        separator2.foregroundColor = Color.TS.textMuted
        var detail = AttributedString(column.detail)
        detail.foregroundColor = Color.TS.textSecondary
        return name + separator1 + type + separator2 + detail
    }
}

#if DEBUG
    #Preview("Empty editor") {
        SqlPlaygroundPage(model: SqlPlaygroundPageModel(draftStore: InMemorySqlDraftStore()))
            .teslaSyncTheme()
    }

    #Preview("With persisted draft") {
        SqlPlaygroundPage(
            model: SqlPlaygroundPageModel(
                draftStore: InMemorySqlDraftStore(
                    seed: "SELECT count(*) FROM drives WHERE started_at >= now() - interval '7 days';"
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
