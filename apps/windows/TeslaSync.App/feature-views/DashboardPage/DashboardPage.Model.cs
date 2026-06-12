using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>DashboardPage</c> surface — the native mirror of the three
/// data states the web page renders (web/src/features/dashboard/pages/DashboardPage.tsx). The web page gates its
/// body on <c>vehiclesLoading ? Skeleton : …</c> and surfaces a failure banner (web <c>anyError</c>) above the
/// content; the canonical "success" rendering for this parity unit is the welcome / sync onboarding hero (the two
/// <c>GlassPanel</c> regions the manifest enumerates). This enum is the top-level summary the ledger / Narrator key
/// off; per-region visibility is still driven by the projected flags so the failure banner and the
/// account-not-connected warning compose above the body exactly as the web does.
/// </summary>
public enum DashboardState
{
    /// <summary>The auth-status read is in flight with nothing yet to show (web <c>vehiclesLoading</c>).</summary>
    Loading,

    /// <summary>The auth-status read failed with no value (web <c>anyError</c>) — the retry surface is shown.</summary>
    Error,

    /// <summary>The auth-status read resolved — the onboarding hero renders (web onboarding / grid branch).</summary>
    Success,
}

/// <summary>
/// The connected-account status the dashboard reads through <c>GET /auth/status</c> — the native mirror of the web
/// <c>useAuthStatus</c> payload (web/src/api/hooks/useSettings.ts). Only the <c>authenticated</c> flag drives this
/// parity unit; <see cref="Resolved"/> distinguishes "not connected" from "not yet loaded" so the page never shows
/// the account warning before the first read completes. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record DashboardAuthStatus(bool Authenticated, bool Resolved)
{
    /// <summary>The pre-load state: not resolved, so neither the warning nor the synced onboarding branch shows.</summary>
    public static DashboardAuthStatus Unknown { get; } = new(false, false);

    /// <summary>Read the connected-account flag from the <c>/auth/status</c> JSON, tolerating missing fields.</summary>
    public static DashboardAuthStatus FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DashboardAuthStatus(false, true);
        }

        var authenticated = element.TryGetProperty("authenticated", out var value)
            && value.ValueKind is JsonValueKind.True;
        return new DashboardAuthStatus(authenticated, true);
    }
}

/// <summary>
/// The accent applied to a feature-highlight card — a Core-only mirror of the component glow palette (the view
/// maps it to the shared glass-panel glow). Kept free of any UI type so the projection is unit-tested headless.
/// </summary>
public enum DashboardCardAccent
{
    /// <summary>No accent glow.</summary>
    None,

    /// <summary>Cyan accent (web tracking card).</summary>
    Cyan,

    /// <summary>Green accent (web charging card).</summary>
    Green,

    /// <summary>Purple accent (web drives card).</summary>
    Purple,
}

/// <summary>
/// One feature-highlight card in the onboarding hero's footer grid — the native mirror of the four cards the web
/// <c>EmptyOnboarding</c> renders (web DashboardPage.tsx, the <c>tracking / drives / charging / control</c> grid).
/// Carries the localized label, the leading Segoe Fluent glyph and the accent glow applied to the card (web
/// per-card accent colour). Pure data — no UI type — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DashboardFeatureCard(string Label, string Glyph, DashboardCardAccent Accent);

/// <summary>
/// The immutable inputs the <see cref="DashboardProjection"/> reads — the auth-status snapshot, the load / failure
/// flags derived from the auth read, an optional additive error message (a sync failure or a refresh failure that
/// still has a cached value, surfaced as the web error banner above the body), and the local edit / sync UI state
/// (web <c>editMode</c> / <c>syncVehicles.isPending</c>). Pure data so the whole projection is unit-tested headless.
/// </summary>
public sealed record DashboardModel(
    DashboardAuthStatus Auth,
    bool Loading,
    bool LoadFailed,
    string? ErrorDetail,
    bool EditMode,
    bool Syncing);

/// <summary>
/// The render-ready projection the <c>DashboardPage</c> view binds to. Every visible literal is resolved here
/// through the <see cref="ILocalizer"/> (web key names preserved verbatim) so the view stays a thin renderer with
/// zero hardcoded text. The boolean flags drive per-region visibility (the theme prompt, the customize hint, the
/// failure banner, the account warning and the authenticated vs unauthenticated onboarding branch).
/// </summary>
public sealed record DashboardDisplay(
    DashboardState State,
    string Title,
    string Subtitle,
    string DocumentTitle,
    string UndoLabel,
    string RedoLabel,
    string AddWidgetLabel,
    string AutoArrangeLabel,
    string TemplatesLabel,
    string ResetLabel,
    string DoneLabel,
    string KioskLabel,
    string CustomizeLabel,
    string PrintSnapshotLabel,
    bool EditMode,
    string EditHint,
    string ThemeFirstRunTitle,
    string ThemeFirstRunBody,
    string ThemeFirstRunOpen,
    string ThemeFirstRunLater,
    string CustomizeHint,
    string CustomizeHintCta,
    string NewDashboardLabel,
    string ResetMessage,
    bool HasError,
    string ErrorText,
    bool ShowAuthWarning,
    string AuthNotConnected,
    string AuthConnectPrompt,
    string AuthSettings,
    string AuthToStart,
    bool Authenticated,
    string OnboardingHeading,
    string OnboardingDescription,
    string OnboardingActionLabel,
    IReadOnlyList<DashboardFeatureCard> FeatureCards);

/// <summary>
/// Projects a <see cref="DashboardModel"/> into the render-ready <see cref="DashboardDisplay"/>. This is the single
/// place the web page's branch selection and i18n live: it derives the three-state matrix (loading / error /
/// success), resolves all 36 manifest strings through the localizer with the web English defaults, and builds the
/// authenticated vs unauthenticated onboarding copy and the four feature cards. UI-free so it is unit-tested
/// without a XAML runtime.
/// </summary>
public static class DashboardProjection
{
    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static DashboardDisplay Project(DashboardModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = model.LoadFailed
            ? DashboardState.Error
            : model.Loading
                ? DashboardState.Loading
                : DashboardState.Success;

        var authenticated = model.Auth.Authenticated;

        // Resolve every onboarding literal unconditionally (both branches of each web ternary) so the projection
        // references all 36 manifest keys on every run, then select which copy the current branch renders.
        var syncTitle = localizer.GetString("onboarding.syncTitle", "Sync Your Vehicles");
        var welcomeTitle = localizer.GetString("onboarding.title", "Welcome to TeslaSync");
        var syncDescription = localizer.GetString("onboarding.syncDesc", "Your Tesla account is connected. Sync your vehicles to start tracking.");
        var welcomeDescription = localizer.GetString("onboarding.desc", "The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.");
        var syncAction = localizer.GetString("onboarding.sync", "Sync Vehicles");
        var connectAction = localizer.GetString("onboarding.connect", "Connect Tesla Account");

        var heading = authenticated ? syncTitle : welcomeTitle;
        var description = authenticated ? syncDescription : welcomeDescription;
        var actionLabel = authenticated ? syncAction : connectAction;

        var cards = new[]
        {
            new DashboardFeatureCard(localizer.GetString("onboarding.tracking", "Real-time Tracking"), "\uE9D9", DashboardCardAccent.Cyan),
            new DashboardFeatureCard(localizer.GetString("onboarding.drives", "Drive History"), "\uE804", DashboardCardAccent.Purple),
            new DashboardFeatureCard(localizer.GetString("onboarding.charging", "Charge Analytics"), "\uE945", DashboardCardAccent.Green),
            new DashboardFeatureCard(localizer.GetString("onboarding.control", "Vehicle Control"), "\uE72E", DashboardCardAccent.None),
        };

        var hasError = model.LoadFailed || !string.IsNullOrWhiteSpace(model.ErrorDetail);
        var loadFailedLabel = localizer.GetString("error.loadFailed", "Failed to load data");
        var errorText = hasError ? Compose(loadFailedLabel, model.ErrorDetail) : string.Empty;

        return new DashboardDisplay(
            State: state,
            Title: localizer.GetString("title", "Command Center"),
            Subtitle: localizer.GetString("subtitle", "Real-time fleet intelligence and control"),
            DocumentTitle: localizer.GetString("title", "Command Center"),
            UndoLabel: localizer.GetString("dashboard.undo", "Undo"),
            RedoLabel: localizer.GetString("dashboard.redo", "Redo"),
            AddWidgetLabel: localizer.GetString("dashboard.addWidget", "Add Widget"),
            AutoArrangeLabel: localizer.GetString("dashboard.autoArrange", "Auto Arrange"),
            TemplatesLabel: localizer.GetString("dashboard.templates", "Templates"),
            ResetLabel: localizer.GetString("dashboard.reset", "Reset"),
            DoneLabel: localizer.GetString("dashboard.done", "Done"),
            KioskLabel: localizer.GetString("dashboard.kiosk", "Kiosk"),
            CustomizeLabel: localizer.GetString("dashboard.customize", "Customize"),
            PrintSnapshotLabel: localizer.GetString("dashboard.printSnapshot", "Print snapshot"),
            EditMode: model.EditMode,
            EditHint: localizer.GetString("dashboard.editHint", "Drag widgets to reorder, resize from edges. Click the gear icon for widget settings."),
            ThemeFirstRunTitle: localizer.GetString("theme.firstRunTitle", "Personalize TeslaSync"),
            ThemeFirstRunBody: localizer.GetString("theme.firstRunBody", "Pick a color theme that fits your style."),
            ThemeFirstRunOpen: localizer.GetString("theme.firstRunOpen", "Open theme picker"),
            ThemeFirstRunLater: localizer.GetString("theme.firstRunLater", "Maybe later"),
            CustomizeHint: localizer.GetString("dashboard.customizeHint", "You can customize this dashboard. Tap the + to add widgets."),
            CustomizeHintCta: localizer.GetString("dashboard.customizeHintCta", "Add widgets"),
            NewDashboardLabel: localizer.GetString("dashboard.newDashboard", "New Dashboard"),
            ResetMessage: localizer.GetString("layout.resetMessage", "This removes all customizations and restores the shipped default dashboard. Your other saved layouts are not affected."),
            HasError: hasError,
            ErrorText: errorText,
            ShowAuthWarning: model.Auth.Resolved && !authenticated,
            AuthNotConnected: localizer.GetString("auth.notConnected", "Tesla account not connected"),
            AuthConnectPrompt: localizer.GetString("auth.connectPrompt", "Connect your account in"),
            AuthSettings: localizer.GetString("auth.settings", "Settings"),
            AuthToStart: localizer.GetString("auth.toStart", "to start tracking."),
            Authenticated: authenticated,
            OnboardingHeading: heading,
            OnboardingDescription: description,
            OnboardingActionLabel: actionLabel,
            FeatureCards: cards);
    }

    private static string Compose(string prefix, string? detail) =>
        string.IsNullOrWhiteSpace(detail) ? prefix : $"{prefix}: {detail}";
}

/// <summary>
/// Canonical metadata for the <c>DashboardPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/dashboard/pages/DashboardPage.tsx</c> (route <c>/</c>, nav name <c>Dashboard</c>). The page
/// header title / subtitle resolve here so the registration and the projection share one key.
/// </summary>
public static class DashboardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DashboardPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Dashboard</c>, path <c>/</c>).</summary>
    public const string RouteName = "Dashboard";

    /// <summary>The localized page title (web <c>title</c> = "Command Center").</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("title", "Command Center");
    }

    /// <summary>The localized page subtitle (web <c>subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("subtitle", "Real-time fleet intelligence and control");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DashboardPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an endpoint, error, token or vehicle id — so
/// a diagnostics line can never leak API traffic. Thread-safe.
/// </summary>
public sealed class DashboardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DashboardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DashboardPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DashboardRegistration.Slug}");
    }
}

/// <summary>
/// The connected-account data port (P1/S8) — the native analogue of the web <c>useAuthStatus</c> hook. It yields
/// the cache-then-network sequence of parsed <see cref="DashboardAuthStatus"/> snapshots for <c>GET /auth/status</c>.
/// </summary>
public interface IAuthStatusSource
{
    /// <summary>Stream the cache-then-network auth-status snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DashboardAuthStatus>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The vehicle-sync command port (P1/S8) — the native analogue of the web <c>useSyncVehicles</c> mutation. It runs
/// one <c>POST /vehicles/sync</c> and reports success or a classified failure (web <c>syncVehicles.mutate()</c>).
/// </summary>
public interface IVehicleSyncGateway
{
    /// <summary>Trigger a one-shot vehicle sync; the result carries success or the classified failure.</summary>
    Task<RepositoryResult<bool>> SyncAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default auth-status feed — yields a single resolved "not connected" snapshot (the parameterless page's
/// feed). It keeps the headless / unpackaged page on the unauthenticated onboarding branch without any network
/// access, so the surface is fully renderable in tests and design-time hosts.
/// </summary>
public sealed class EmptyAuthStatusSource : IAuthStatusSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAuthStatusSource Instance { get; } = new();

    private EmptyAuthStatusSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DashboardAuthStatus>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<DashboardAuthStatus>.Loaded(new DashboardAuthStatus(false, true), DateTimeOffset.UtcNow);
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// The default vehicle-sync gateway — resolves every sync to a benign success without any network access (the
/// parameterless page's gateway). A host wires the generated-client gateway for the real <c>POST /vehicles/sync</c>.
/// </summary>
public sealed class NoopVehicleSyncGateway : IVehicleSyncGateway
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopVehicleSyncGateway Instance { get; } = new();

    private NoopVehicleSyncGateway()
    {
    }

    /// <inheritdoc />
    public Task<RepositoryResult<bool>> SyncAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(RepositoryResult<bool>.Loaded(true, DateTimeOffset.UtcNow));
    }
}
