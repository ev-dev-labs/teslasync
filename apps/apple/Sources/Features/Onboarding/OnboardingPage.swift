import SwiftUI

/// Native SwiftUI / HIG parity of `web/src/features/onboarding/pages/OnboardingPage.tsx`
/// (route `/onboarding`). The dedicated first-run experience: a single `GlassPanel` hosting the
/// setup-intro header, the three-step checklist (Connect Tesla account → wait for vehicles → wait
/// for telemetry, web `Stepper`), the auto-refresh / skip / continue footer, and the help links.
/// Every data state the source produces is implemented — the first-fetch loading skeleton and the
/// resolved checklist (a failed load degrades to the pessimistic checklist, never a blank region,
/// mirroring the web query's pessimistic default). The page polls the status every 30s until setup
/// completes (web `refetchInterval`).
///
/// Adaptive (ADR-002/006): the content column caps its width and centres on macOS / iPad regular
/// width and fills the compact iPhone width; the footer reflows from a row to a stack when compact.
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `OnboardingPageModel` (no networking in the view). The Tesla-account step + the
/// "Tesla account page" help link route to Settings (web `/tesla-account`); the doc links open the
/// install's documentation in the system browser (web same-origin `/docs/…`).
public struct OnboardingPage: View {
    @State private var model: OnboardingPageModel

    /// Navigates the app shell to a route (web `navigate()` / `<Link>`). Injected by the route
    /// registration; a no-op default keeps previews / tests self-contained.
    private let onNavigate: (AppRoute) -> Void

    @Environment(\.openURL) private var openURL

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: OnboardingPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                TSFadeIn {
                    TSGlassPanel { panel }
                }
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("onboarding.pageTitle"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
            await model.load()
        }
        .task(id: model.isPolling) { await runPoll() }
    }

    // MARK: - Header (web `PageContainer` title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("onboarding.welcome")
            Text("onboarding.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Panel (web single `GlassPanel`)

    private var panel: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            intro
            if model.phase == .loading {
                OnboardingStepperSkeleton()
            } else {
                OnboardingChecklistStepper(steps: model.steps, onAction: handle)
                footer
                helpFooter
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web intro header: a tinted Sparkles glyph beside the "Setup checklist" title + description.
    private var intro: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .fill(Color.TS.accent.opacity(0.1))
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
            }
            .frame(width: 40, height: 40)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text("onboarding.intro.title")
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("onboarding.intro.desc")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Footer (web status + actions row)

    private var footer: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    statusText
                    footerButtons
                }
            } else {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    statusText
                    Spacer(minLength: TSSpacing.md)
                    footerButtons
                }
            }
        }
    }

    /// Web `isComplete ? onboarding.ready : onboarding.polling`.
    private var statusText: some View {
        Group {
            if model.isComplete {
                Text("onboarding.ready")
            } else {
                Text("onboarding.polling")
            }
        }
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var footerButtons: some View {
        HStack(spacing: TSSpacing.sm) {
            checkAgainButton
            if model.isComplete {
                continueButton
            } else {
                skipButton
            }
        }
    }

    /// Web "Check again" ghost button (spins + disables while a refetch is in flight).
    private var checkAgainButton: some View {
        TSButton(variant: .ghost, size: .small, action: { Task { await model.refresh() } }, label: {
            HStack(spacing: TSSpacing.xs) {
                if model.isFetching {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
                }
                Text("onboarding.checkAgain")
            }
        })
        .disabled(model.isFetching)
    }

    /// Web "Skip for now" outline button — persists the local skip choice, then navigates home.
    private var skipButton: some View {
        TSButton(variant: .secondary, size: .small, action: {
            model.skip()
            onNavigate(.dashboard)
        }, label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "forward.end.alt").font(.system(size: 12, weight: .semibold))
                Text("onboarding.skip")
            }
        })
        .help(Text("onboarding.skipHint"))
        .accessibilityHint(Text("onboarding.skipHint"))
    }

    /// Web "Continue to dashboard" primary button (shown once setup is complete).
    private var continueButton: some View {
        TSButton(variant: .primary, size: .small, action: { onNavigate(.dashboard) }, label: {
            HStack(spacing: TSSpacing.xs) {
                Text("onboarding.continue")
                Image(systemName: "arrow.forward").font(.system(size: 12, weight: .semibold))
            }
        })
    }

    // MARK: - Help footer (web `Need help? See the … or the …`)

    /// The footer help sentence with two inline links: an in-app route to the Tesla account page
    /// (Settings) and an external link to the documentation, composed from the four `footer.*` keys.
    private var helpFooter: some View {
        Text(helpAttributed)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .tint(Color.TS.accent)
            .environment(\.openURL, OpenURLAction { url in
                if url.scheme == "teslasync" {
                    onNavigate(.settings)
                    return .handled
                }
                return .systemAction
            })
    }

    private var helpAttributed: AttributedString {
        var result = AttributedString(OnboardingText.localized(OnboardingStrings.footerHelp))
        result.append(AttributedString(" "))

        var account = AttributedString(OnboardingText.localized(OnboardingStrings.footerAccount))
        account.link = URL(string: "teslasync://onboarding/account")
        account.foregroundColor = Color.TS.accent
        result.append(account)

        result.append(AttributedString(OnboardingText.localized(OnboardingStrings.footerOr)))

        var docs = AttributedString(OnboardingText.localized(OnboardingStrings.footerDocs))
        docs.link = model.docURL(.documentation)
        docs.foregroundColor = Color.TS.accent
        result.append(docs)

        result.append(AttributedString("."))
        return result
    }

    // MARK: - Actions

    /// Dispatches a checklist step's call-to-action (web `renderCta`): an in-app route push, a
    /// status refetch, or an external doc link opened in the system browser.
    private func handle(_ cta: OnboardingStepCTA) {
        switch cta {
        case let .navigate(route, _):
            onNavigate(route)
        case .refresh:
            Task { await model.refresh() }
        case let .externalDoc(link, _):
            openURL(model.docURL(link))
        }
    }

    /// Web `refetchInterval` (30s) auto-poll: refreshes the status while setup is incomplete, then
    /// stops once complete (the `task(id:)` cancels when `isPolling` flips to false).
    private func runPoll() async {
        while !Task.isCancelled, model.isPolling {
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, model.isPolling else { return }
            await model.refresh()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }
}

#if DEBUG
    #Preview("Onboarding · in progress") {
        NavigationStack {
            OnboardingPage(model: OnboardingPageModel())
                .teslaSyncTheme()
        }
    }

    #Preview("Onboarding · fresh install") {
        NavigationStack {
            OnboardingPage(model: OnboardingPageModel(dataSource: FreshInstallOnboardingDataSource()))
                .teslaSyncTheme()
        }
    }

    #Preview("Onboarding · complete") {
        NavigationStack {
            OnboardingPage(model: OnboardingPageModel(dataSource: CompleteOnboardingDataSource()))
                .teslaSyncTheme()
        }
    }

    #Preview("Onboarding · load failed (pessimistic)") {
        NavigationStack {
            OnboardingPage(model: OnboardingPageModel(dataSource: FailingOnboardingDataSource()))
                .teslaSyncTheme()
        }
    }
#endif
