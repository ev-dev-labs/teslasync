import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/SystemPage.tsx`
/// ("System budgets", `SYSTEM_PAGE_PATH = /admin/system`). Reproduces the web page
/// chrome (web `PageContainer`: title + subtitle) and the `FadeIn`'d vertical `Stack`
/// (web `gap-6`) of the two infrastructure-budget panels, in the same order as the
/// web source: `RateLimitStatusPanel` then `QueueStatusPanel`.
///
/// Both panels are the already-shipped native feature views (each its own P4 parity
/// unit); this page composes them exactly as the web page composes the two React
/// components — no panel logic is duplicated here. Adaptive (ADR-002/006): a single
/// scrolling column that the panels lay out responsively for macOS / iPad / iPhone.
/// All copy resolves from `Localizable.xcstrings` with the web key names; the two
/// panel models bind through the `@Observable` `SystemPageModel` (no networking in
/// the view, ADR-004).
public struct SystemPage: View {
    @State private var model: SystemPageModel

    public init(model: SystemPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                TSFadeIn {
                    VStack(alignment: .leading, spacing: TSSpacing.lg) {
                        RateLimitStatusPanel(model: model.rateLimit)
                        QueueStatusPanel(model: model.queue)
                    }
                    .accessibilityIdentifier("system-page-stack")
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("system.page.title")
            Text("system.page.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
    #Preview("System") {
        SystemPage(model: SystemPageModel())
            .teslaSyncTheme()
    }
#endif
