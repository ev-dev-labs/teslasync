//
//  SafetyPage.swift
//  TeslaSync — P4 page · P7 · settings/Safety (Apple) — View
//
//  Native SwiftUI / HIG parity of web/src/features/settings/pages/SafetyPage.tsx
//  (route `/settings/safety`), adaptive across macOS + iOS (ADR-002, ADR-006).
//
//  The web page hosts the deterministic, AI-OFF-safe explainer listing of every
//  safety-related TeslaSync setting (quiet hours, alert digest mode, critical-flash
//  signalling, tab-badge signalling, the API kill-switch). It works fully in
//  `ai_mode='off'`; the opt-in `<AISafetySettingExplainer>` panel is ABSENT from the
//  DOM by default — it is a separate, gated component parity unit and is therefore
//  out of this page's scope. This screen reproduces the page chrome (web
//  `PageContainer` title + subtitle) and the single `GlassPanel` listing in full:
//  the header (title + subtitle), the seven setting rows (title + current-value badge
//  + plain-English explanation + "Docs" link), and the read-only change hint footer.
//
//  Adaptive (ADR-002/006): macOS/iPad regular width lays each row's main block and its
//  "Docs" link side by side; compact iPhone stacks them (web `sm:grid-cols-[1fr_auto]`).
//  Data binds through the `@Observable` `SafetyPageModel` (no networking in the view,
//  ADR-004). Every visible string resolves from `Localizable.xcstrings`.
//

import SwiftUI

struct SafetyPage: View {
    @State private var model: SafetyPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Caps the reading column on wide macOS/iPad windows (web `PageContainer` max-width).
    private static let columnMaxWidth: CGFloat = 900

    init(model: SafetyPageModel = SafetyPageModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: Self.columnMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("translation.safetySettings.pageTitle"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task {
                if case .loading = model.state { await model.load() }
            }
            .refreshable { await model.refresh() }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.safetySettings.pageTitle")
            Text("translation.safetySettings.pageSubtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web `useSettings()` phases)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            loadingPanel
        case let .success(settings):
            listingPanel(settings: settings)
        }
    }

    // MARK: - Loading (skeleton header + spinner)

    private var loadingPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                listingHeader
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.lg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityLabel(Text("translation.common.loading"))
    }

    // MARK: - Listing (web GlassPanel1: header + rows + change hint)

    private func listingPanel(settings: SafetySettingsSnapshot) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                listingHeader
                rowList(settings: settings)
                Text("translation.safetySettings.listing.changeHint")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, TSSpacing.xs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var listingHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSectionTitle("translation.safetySettings.listing.title")
            Text("translation.safetySettings.listing.subtitle")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func rowList(settings: SafetySettingsSnapshot) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, kind in
                if index > 0 {
                    Divider().overlay(Color.TS.border.opacity(0.5))
                }
                row(kind, settings: settings)
                    .padding(.vertical, TSSpacing.md)
            }
        }
    }

    // MARK: - Row (adaptive: main block + Docs link)

    @ViewBuilder
    private func row(_ kind: SafetySettingKind, settings: SafetySettingsSnapshot) -> some View {
        let value = kind.value(in: settings)
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                rowMain(kind, value: value)
                docsLink(kind).frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .contain)
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                rowMain(kind, value: value)
                Spacer(minLength: TSSpacing.sm)
                docsLink(kind).padding(.top, 2)
            }
            .accessibilityElement(children: .contain)
        }
    }

    private func rowMain(_ kind: SafetySettingKind, value: SafetyValue) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(kind.titleKey)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                SafetyValueBadge(value: value)
            }
            Text(kind.detailKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func docsLink(_ kind: SafetySettingKind) -> some View {
        Link(destination: kind.docsURL) {
            Text("translation.safetySettings.listing.docsLink")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.accent)
        }
        .accessibilityLabel(
            Text(kind.titleKey)
                + Text(verbatim: " — ")
                + Text("translation.safetySettings.listing.docsLink")
        )
    }
}

// MARK: - Value badge (web `Badge variant="info"`)

/// The row's current-value chip. A feature-local view rather than the shared `TSBadge`
/// because the value is dynamic (a localized token OR verbatim `HH:MM`/em-dash data),
/// while `TSBadge` accepts only a static `LocalizedStringKey`. The `.info` visual
/// treatment mirrors `TSBadge`'s exactly via the shared `Color.TS.statusInfo` token.
private struct SafetyValueBadge: View {
    let value: SafetyValue

    var body: some View {
        valueText
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusInfo)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusInfo.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1))
    }

    @ViewBuilder private var valueText: some View {
        switch value {
        case let .localized(key): Text(key)
        case let .text(string): Text(verbatim: string)
        }
    }
}

#if DEBUG
    #Preview("Listing") {
        NavigationStack {
            SafetyPage(model: SafetyPageModel())
        }
        .teslaSyncTheme()
    }

    #Preview("Quiet hours on / API suspended") {
        NavigationStack {
            SafetyPage(model: SafetyPageModel(dataSource: PreviewSafetySource()))
        }
        .teslaSyncTheme()
    }

    /// Preview seam flipping several toggles so every value variant renders.
    private struct PreviewSafetySource: SafetySettingsDataSource {
        func load() async throws -> SafetySettingsSnapshot {
            var snapshot = SafetySettingsSnapshot.defaults
            snapshot.quietHoursEnabled = true
            snapshot.alertDigestMode = "daily"
            snapshot.apiSuspended = true
            snapshot.quietHoursEnd = nil
            return snapshot
        }
    }
#endif
