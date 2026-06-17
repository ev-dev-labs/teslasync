import SwiftUI

/// Native SwiftUI parity of `web/src/features/settings/pages/SettingsPage.tsx`
/// (route `/settings`). Reproduces the web page chrome (web `PageContainer`: title +
/// subtitle, with a centered spinner while `useSettings` loads), the edit-conflict banner
/// (web `EditConflictBanner` + `useEditLease`), and the page's three install-static action
/// panels: the Data Export link card (web `<a href="/data-export">`), the Onboarding Tour
/// card (web `dispatchTourLauncherOpen`), and the Setup Checklist card (web
/// `restartChecklist` + success toast). Data binds through the `@Observable`
/// `SettingsPageModel` (no networking here, ADR-004).
///
/// The web page's General / Appearance / Advanced / Reset sections + the settings search box
/// are separate already-shipped surfaces (each its own parity unit) whose controls are owned
/// natively by the platform `AppSettingsView`; re-hosting them here would duplicate native
/// settings, so this page is the manifest's three-panel action hub. Adaptive (ADR-002/006):
/// a centered reading column on macOS/iPad, full-width on iPhone; every panel is a simple
/// icon + copy + action row that reads well at both idioms. All copy resolves from
/// `Localizable.xcstrings`; SwiftUI-native materials/tokens only (no web cloning).
public struct SettingsPage: View {
    @State private var model: SettingsPageModel
    private let onNavigate: (AppRoute) -> Void

    /// Keeps the loading region tall enough to center the spinner (web `py-20`).
    private static let loadingMinHeight: CGFloat = 240
    /// The reading-column width on regular-width idioms (web centered page column).
    private static let columnMaxWidth: CGFloat = 768

    public init(model: SettingsPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                stateContent
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: Self.columnMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loading = model.state { await model.load() }
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle(model.titleKey)
            Text(model.subtitleKey)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading gate)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingView
        case .ready:
            readyContent
        }
    }

    /// Web `PageContainer` loading branch — a centered spinner while `useSettings` resolves.
    private var loadingView: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, minHeight: Self.loadingMinHeight)
            .accessibilityLabel(Text("loading"))
    }

    /// The settled page body: the edit-conflict banner (when a conflict is held) above the
    /// three action panels, each lifted in on appear (web `FadeIn` with staggered delays).
    private var readyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.hasEditConflict {
                editConflictBanner
            }
            TSFadeIn(delay: 0.16) { dataExportPanel }
            TSFadeIn(delay: 0.20) { tourPanel }
            TSFadeIn(delay: 0.22) { checklistPanel }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Edit-conflict banner (web EditConflictBanner)

    private var editConflictBanner: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.arrow.triangle.2.circlepath",
            title: model.editConflictResourceKey,
            onDismiss: { model.dismissEditConflict() }
        )
    }

    // MARK: - GlassPanel 1 — Data Export (web `<a href="/data-export">` card)

    private var dataExportPanel: some View {
        Button {
            onNavigate(model.dataExportRoute)
        } label: {
            TSGlassPanel {
                HStack(spacing: TSSpacing.lg) {
                    TSIconBox(systemName: "arrow.down.doc.fill", tone: .success)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSPanelTitle(model.exportTitleKey)
                        TSHelperText(model.exportSubtitleKey)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    Image(systemName: "chevron.right")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isLink)
        .accessibilityLabel(Text(model.exportTitleKey))
        .accessibilityHint(Text(model.exportSubtitleKey))
    }

    // MARK: - GlassPanel 2 — Onboarding Tour (web dispatchTourLauncherOpen)

    private var tourPanel: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.lg) {
                TSIconBox(systemName: "play.circle.fill", tone: .accent)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSPanelTitle(model.tourTitleKey)
                    TSHelperText(model.tourDescriptionKey)
                }
                Spacer(minLength: TSSpacing.sm)
                TSButton(
                    variant: .ghost,
                    action: { model.openTourLauncher() },
                    label: { Label(model.tourRestartKey, systemImage: "play.circle") }
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - GlassPanel 3 — Setup Checklist (web restartChecklist + toast)

    private var checklistPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.lg) {
                    TSIconBox(systemName: "checklist", tone: .accent)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSPanelTitle(model.checklistTitleKey)
                        TSHelperText(model.checklistDescriptionKey)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSButton(
                        variant: .ghost,
                        action: { model.restartChecklist() },
                        label: { Label(model.checklistRestartKey, systemImage: "arrow.clockwise") }
                    )
                }
                if model.checklistRestarted {
                    TSAlertBanner(
                        tone: .success,
                        systemImage: "checkmark.circle.fill",
                        title: model.checklistRestartedKey,
                        onDismiss: { model.dismissChecklistRestarted() }
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Ready") {
        SettingsPage(model: SettingsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Loading") {
        SettingsPage(model: SettingsPageModel(dataSource: PendingSettingsPageDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Edit conflict") {
        SettingsPage(model: SettingsPageModel(hasEditConflict: true))
            .teslaSyncTheme()
    }

    #Preview("Checklist restarted") {
        SettingsPage(
            model: {
                let model = SettingsPageModel()
                model.restartChecklist()
                return model
            }()
        )
        .teslaSyncTheme()
    }
#endif
