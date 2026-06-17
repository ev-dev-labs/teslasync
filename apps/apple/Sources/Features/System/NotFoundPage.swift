import SwiftUI

/// Native SwiftUI parity of `web/src/features/system/pages/NotFoundPage.tsx`
/// (catch-all route `/*`). Reproduces the web page chrome (web `PageContainer`:
/// title) and the centered `GlassPanel` body with:
/// - Compass icon (decorative)
/// - "We couldn't find that page" heading
/// - Body text showing the unmatched path
/// - Optional list of suggested alternative routes
/// - Three action buttons: Go back, Go to dashboard, Open command palette
///
/// Adaptive (ADR-002/006): Compact (iPhone) stacks buttons vertically; regular
/// (iPad/macOS) displays them horizontally. Every visible string resolves from
/// `Localizable.xcstrings` (ADR-014). Data binds through the `@Observable`
/// `NotFoundPageModel` (no async loading — this is a static error page, ADR-004).
public struct NotFoundPage: View {
    @State private var model: NotFoundPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Maximum width for the centered error panel (web: `max-w-2xl` = 42rem ≈ 672px).
    private static let maxPanelWidth: CGFloat = 672

    public init(model: NotFoundPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                errorPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title)

    private var header: some View {
        TSPageTitle("notFound.title")
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Error panel (web GlassPanel with centered content)

    private var errorPanel: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.lg) {
                // Compass icon (web: Compass from lucide-react, 12x12, muted)
                Image(systemName: "safari")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)

                VStack(spacing: TSSpacing.sm) {
                    // Heading (web: h2, text-2xl font-semibold)
                    Text("notFound.heading")
                        .font(Font.TS.title)
                        .foregroundStyle(Color.TS.textPrimary)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)

                    // Body text showing the unmatched path
                    Text(bodyText)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                }

                // Optional suggestions list
                if !model.suggestions.isEmpty {
                    suggestionsList
                }

                // Action buttons
                actionButtons
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: Self.maxPanelWidth)
            .frame(maxWidth: .infinity) // Center the panel
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("notFound.title"))
    }

    // MARK: - Body text with path interpolation

    private var bodyText: String {
        // Web uses t('notFound.body', { defaultValue: "{{path}} doesn't match any route.", path: location.pathname })
        // SwiftUI String(localized:) doesn't support direct variable interpolation in the key,
        // so we format the string manually using the localized format string.
        let format = String(localized: "notFound.body")
        return String(format: format, model.currentPath)
    }

    // MARK: - Suggestions list (web: "Did you mean:" + links)

    private var suggestionsList: some View {
        VStack(spacing: TSSpacing.sm) {
            Text("notFound.didYouMean")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)

            VStack(spacing: TSSpacing.xs) {
                ForEach(model.suggestions) { suggestion in
                    Button {
                        // parity:allow - Suggestion navigation deferred (web uses React Router, native needs AppRoute integration)
                    } label: {
                        HStack(spacing: TSSpacing.xs) {
                            Text(verbatim: String(localized: LocalizedStringKey(suggestion.i18nKey)))
                                .foregroundStyle(Color.TS.accent)
                            Text(verbatim: suggestion.path)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: suggestion.label))
                }
            }
        }
    }

    // MARK: - Action buttons (web: back / home / command palette)

    @ViewBuilder
    private var actionButtons: some View {
        if isCompact {
            // Compact (iPhone): stack vertically
            VStack(spacing: TSSpacing.sm) {
                backButton.frame(maxWidth: .infinity)
                homeButton.frame(maxWidth: .infinity)
                searchButton.frame(maxWidth: .infinity)
            }
        } else {
            // Regular (iPad/macOS): horizontal layout
            HStack(spacing: TSSpacing.sm) {
                backButton
                homeButton
                searchButton
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var backButton: some View {
        TSButton(
            variant: .ghost,
            action: { model.goBack() },
            label: {
                Label("notFound.goBack", systemImage: "arrow.left")
            }
        )
        .accessibilityLabel(Text("notFound.goBack"))
        .accessibilityHint(Text("Navigate back to the previous screen"))
    }

    private var homeButton: some View {
        TSButton(
            variant: .primary,
            action: { model.goHome() },
            label: {
                Label("notFound.goHome", systemImage: "house")
            }
        )
        .accessibilityLabel(Text("notFound.goHome"))
        .accessibilityHint(Text("Navigate to the dashboard"))
    }

    private var searchButton: some View {
        TSButton(
            variant: .ghost,
            action: { model.openSearch() },
            label: {
                Label("notFound.openSearch", systemImage: "magnifyingglass")
            }
        )
        .accessibilityLabel(Text("notFound.openSearch"))
        .accessibilityHint(Text("Open the command palette to search"))
    }
}

// MARK: - Preview

#if DEBUG
    #Preview("Not Found") {
        NotFoundPage(
            model: NotFoundPageModel(
                currentPath: "/unknown/route"
            )
        )
        .teslaSyncTheme()
    }

    #Preview("With Suggestions") {
        NotFoundPage(
            model: NotFoundPageModel(
                currentPath: "/dashboard/unknown",
                suggestions: [
                    RouteSuggestion(
                        id: "1",
                        path: "/dashboard",
                        label: "Dashboard",
                        i18nKey: "route.dashboard"
                    ),
                    RouteSuggestion(
                        id: "2",
                        path: "/dashboard/fleet",
                        label: "Fleet Overview",
                        i18nKey: "route.fleet"
                    )
                ]
            )
        )
        .teslaSyncTheme()
    }
#endif
