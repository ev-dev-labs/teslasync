import SwiftUI

/// Native SwiftUI parity of `web/src/features/power-user/pages/DashboardsPage.tsx`
/// (route `/power/dashboards`). The web page is a manual Grafana dashboard-JSON composer: a page
/// header (title + intro), the opt-in `<AINLDashboardComposer>` Helix drafter, a deterministic
/// manual JSON editor (textarea + Copy/Clear + a status message — the page never pushes to
/// Grafana), and an install-static curated panel catalog. This page reproduces every region: the
/// header, the already-shipped `AINLDashboardComposer` surface (hosted, not re-implemented — DRY —
/// with its `onApply` wired to copy a draft's pretty-printed JSON into the editor), and the two
/// `GlassPanel`s (editor + catalog), all bound through the `@Observable` `DashboardsPageModel`
/// (ADR-004 — no networking in the view). Adaptive across macOS/iPad (regular) + iPhone (compact)
/// via the shared P2 tokens + P3 components (ADR-002/006).
public struct DashboardsPage: View {
    @State private var model: DashboardsPageModel

    public init(model: DashboardsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                AINLDashboardComposer(model: model.drafter)
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

    // MARK: - GlassPanel 1 — Manual dashboard JSON editor

    private var editorPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle(model.editorTitleKey)
                DashboardJSONEditorField(
                    text: jsonBinding,
                    label: model.editorLabelKey,
                    prompt: model.editorPromptKey
                )
                editorActions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var editorActions: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                TSButton(model.copyKey, variant: .primary, action: model.copy)
                    .disabled(!model.canCopy)
                TSButton(model.clearKey, variant: .secondary, action: model.clear)
                    .disabled(!model.canCopy)
                Spacer(minLength: 0)
            }
            if let copyMessage = model.copyMessage {
                Text(copyMessage.key)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.statusWarning)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - GlassPanel 2 — Curated panel catalog

    private var catalogPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle(model.panelsTitleKey)
                Text(model.panelsIntroKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 280), alignment: .top)],
                    alignment: .leading,
                    spacing: TSSpacing.sm
                ) {
                    ForEach(model.panels) { panel in
                        DashboardPanelCard(panel: panel)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var jsonBinding: Binding<String> {
        Binding(get: { model.dashboardJSON }, set: { model.dashboardJSON = $0 })
    }
}

// MARK: - Dashboard JSON editor field (web `Textarea`)

/// The manual JSON editor — the native parity of the web `Textarea` (rows=12, spellCheck off). An
/// empty editor shows the localized prompt text (web textarea hint, decorative + a11y-hidden); the
/// field carries the web `aria-label` (web `powerDashboards.editor.label`) for VoiceOver.
/// Monospaced for JSON, tokenised chrome (no raw hex).
private struct DashboardJSONEditorField: View {
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
                .frame(minHeight: 240)
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

// MARK: - Curated panel card (web catalog `<li>`)

/// One curated panel card — the native port of each web catalog `<li>`: the panel name (mono, cyan
/// accent) above its description (secondary), in a subtly bordered tile. The enclosing
/// `LazyVGrid` is adaptive (web `grid-cols-1 sm:grid-cols-2`): one column when narrow (iPhone),
/// two+ when wide (iPad/macOS).
private struct DashboardPanelCard: View {
    let panel: CuratedDashboardPanel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: panel.name)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: panel.summary)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(panel.name), \(panel.summary)"))
    }
}

#if DEBUG
    #Preview("Empty editor") {
        DashboardsPage(model: DashboardsPageModel(draftStore: InMemoryDashboardDraftStore()))
            .teslaSyncTheme()
    }

    #Preview("With persisted draft") {
        DashboardsPage(
            model: DashboardsPageModel(
                draftStore: InMemoryDashboardDraftStore(
                    seed: """
                    {
                      "title": "Fleet overview",
                      "slots": [
                        {
                          "panel_name": "drives_per_day_timeseries",
                          "grid_pos": { "x": 0, "y": 0, "w": 24, "h": 8 }
                        }
                      ]
                    }
                    """
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
