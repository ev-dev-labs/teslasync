using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Onboarding;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>OnboardingPage</c> surface — the native mirror of the data states
/// the web first-run page renders (web/src/features/onboarding/pages/OnboardingPage.tsx). The web page gates the page
/// chrome on <c>isLoading</c> (the <c>PageContainer loading</c> spinner) and then renders the setup checklist for
/// every resolved value. The gate is deliberately pessimistic (web <c>useOnboardingStatus</c> <c>retry: 2</c>, and an
/// undefined result falls back to "nothing connected"), so a failed read degrades to the checklist with every step
/// outstanding rather than a dedicated failure region — which is why this surface declares exactly the two manifest
/// states. Per-region visibility is still driven by the projected flags so the GlassPanel never collapses to a blank
/// region.
/// </summary>
public enum OnboardingState
{
    /// <summary>The first status read is in flight with nothing yet to show (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The status read resolved (or degraded to the pessimistic default) — the checklist renders.</summary>
    Success,
}

/// <summary>
/// The affordance a checklist step exposes while it is the current actionable step — the native mirror of the three
/// CTA shapes the web <c>Stepper</c> renders: an internal route link (<c>to</c>), an in-page action (<c>onClick</c>)
/// and an external documentation link (<c>href</c> + <c>target="_blank"</c>). Kept UI-free so the projection is
/// unit-tested headless.
/// </summary>
public enum OnboardingStepAction
{
    /// <summary>Navigate to an internal app route (web <c>cta.to</c>).</summary>
    Navigate,

    /// <summary>Re-run the status read in place (web <c>cta.onClick</c> → <c>refetch</c>).</summary>
    Refresh,

    /// <summary>Open an external documentation link (web <c>cta.href</c>).</summary>
    DocumentationLink,
}

/// <summary>
/// The connected-setup status the page reads through <c>GET /onboarding/status</c> — the native mirror of the web
/// <c>OnboardingStatus</c> payload (web/src/api/hooks/useOnboarding.ts). The backend reports three independent setup
/// anchors plus their pre-computed conjunction; <see cref="IsComplete"/> is preferred over recomputing the gate.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record OnboardingStatusSnapshot(
    bool TeslaConnected,
    int VehicleCount,
    bool DataFlowing,
    bool IsComplete)
{
    /// <summary>The pessimistic default (nothing connected) — the pre-read value and the degraded-read fallback.</summary>
    public static OnboardingStatusSnapshot Pending { get; } = new(false, 0, false, false);

    /// <summary>
    /// Read the status from the <c>/onboarding/status</c> JSON, tolerating the platform <c>{data:…}</c> envelope and
    /// missing fields (each absent anchor reads as not-yet-satisfied, matching the web optional-chaining defaults).
    /// </summary>
    public static OnboardingStatusSnapshot FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Pending;
        }

        return new OnboardingStatusSnapshot(
            TeslaConnected: ReadBool(o, "tesla_connected"),
            VehicleCount: ReadInt(o, "vehicle_count"),
            DataFlowing: ReadBool(o, "data_flowing"),
            IsComplete: ReadBool(o, "is_complete"));
    }

    private static bool ReadBool(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static int ReadInt(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
}

/// <summary>
/// The immutable inputs the <see cref="OnboardingProjection"/> reads — the parsed status snapshot, whether the first
/// read has resolved (so the page never shows the checklist before the spinner clears), whether a first read is still
/// in flight (the loading state) and whether any read is currently fetching (web <c>isFetching</c>, which swaps the
/// vehicle-step CTA to "Checking…" and disables the refresh affordances). Pure data so the whole projection is
/// unit-tested headless.
/// </summary>
public sealed record OnboardingModel(
    OnboardingStatusSnapshot Status,
    bool Resolved,
    bool Loading,
    bool IsFetching);

/// <summary>
/// One render-ready checklist step — the native mirror of a single web <c>OnboardingStep</c> row. Carries the
/// localized title / description, the satisfied flag, the step state (done / current / pending, mirroring the web
/// indicator), the 1-based ordinal shown in the pending indicator, and the CTA the row renders while it is the
/// current step (label + action + target + enabled). Pure data.
/// </summary>
public sealed record OnboardingStepDisplay(
    string Key,
    string Title,
    string Description,
    bool Done,
    bool IsCurrent,
    int StepNumber,
    string CtaLabel,
    OnboardingStepAction CtaAction,
    string CtaTarget,
    bool CtaEnabled);

/// <summary>
/// The render-ready projection the <c>OnboardingPage</c> view binds to. Every visible literal is resolved here through
/// the <see cref="ILocalizer"/> (web key names preserved verbatim) so the view stays a thin renderer with zero
/// hardcoded text. The boolean flags drive the footer's complete-vs-polling copy and the skip / continue affordances.
/// </summary>
public sealed record OnboardingDisplay(
    OnboardingState State,
    string Title,
    string Subtitle,
    string DocumentTitle,
    string IntroTitle,
    string IntroDescription,
    IReadOnlyList<OnboardingStepDisplay> Steps,
    bool IsComplete,
    string StatusLine,
    string CheckAgainLabel,
    bool CheckAgainEnabled,
    bool ShowSkip,
    string SkipLabel,
    string SkipHint,
    bool ShowContinue,
    string ContinueLabel,
    string FooterHelp,
    string FooterAccountLabel,
    string FooterOr,
    string FooterDocsLabel);

/// <summary>
/// Projects an <see cref="OnboardingModel"/> into the render-ready <see cref="OnboardingDisplay"/>. This is the single
/// place the web page's branch selection and i18n live: it derives the two-state matrix (loading / success), resolves
/// all 25 manifest strings through the localizer with the web English defaults, builds the three checklist steps with
/// their satisfied / current / pending state and per-step CTA, and selects the footer's complete-vs-polling copy and
/// the skip-vs-continue affordance. UI-free so it is unit-tested without a XAML runtime.
/// </summary>
public static class OnboardingProjection
{
    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static OnboardingDisplay Project(OnboardingModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = !model.Resolved && model.Loading ? OnboardingState.Loading : OnboardingState.Success;
        var status = model.Status;

        // Resolve every literal unconditionally (both branches of each web ternary) so a single projection run
        // references all 25 manifest keys regardless of the model branch, then select which copy renders.
        var title = localizer.GetString("onboarding.welcome", "Welcome to TeslaSync");
        var subtitle = localizer.GetString("onboarding.subtitle", "Three quick steps before your dashboard is ready.");
        var documentTitle = localizer.GetString("onboarding.pageTitle", "Welcome to TeslaSync");
        var introTitle = localizer.GetString("onboarding.intro.title", "Setup checklist");
        var introDescription = localizer.GetString(
            "onboarding.intro.desc",
            "TeslaSync runs entirely on your hardware. No data leaves your install, and you can revisit this page from Settings any time.");

        var teslaTitle = localizer.GetString("onboarding.tesla.title", "Connect your Tesla account");
        var teslaDescription = localizer.GetString(
            "onboarding.tesla.desc",
            "TeslaSync needs Fleet API access to read vehicle data. Sign in with your Tesla account to authorize the connection.");
        var teslaCta = localizer.GetString("onboarding.tesla.cta", "Connect Tesla account");

        var vehicleTitle = localizer.GetString("onboarding.vehicle.title", "Wait for vehicles to appear");
        var vehicleDescription = localizer.GetString(
            "onboarding.vehicle.desc",
            "Vehicles linked to your Tesla account will sync automatically. This usually takes less than a minute after connecting.");
        var vehicleCta = localizer.GetString("onboarding.vehicle.cta", "Refresh");
        var vehicleChecking = localizer.GetString("onboarding.vehicle.checking", "Checking…");

        var telemetryTitle = localizer.GetString("onboarding.telemetry.title", "Wait for telemetry data");
        var telemetryDescription = localizer.GetString(
            "onboarding.telemetry.desc",
            "Once your vehicle uploads its first signal batch (usually within 5 minutes of driving), live data will appear across the app. See the Fleet Telemetry setup guide if it does not arrive.");
        var telemetryDocs = localizer.GetString("onboarding.telemetry.docs", "Setup guide");

        var readyLine = localizer.GetString("onboarding.ready", "You are all set — your dashboard is ready.");
        var pollingLine = localizer.GetString("onboarding.polling", "This page refreshes automatically every 30 seconds.");
        var checkAgain = localizer.GetString("onboarding.checkAgain", "Check again");
        var skipLabel = localizer.GetString("onboarding.skip", "Skip for now");
        var skipHint = localizer.GetString("onboarding.skipHint", "Explore the app — you can finish setup later from this page.");
        var continueLabel = localizer.GetString("onboarding.continue", "Continue to dashboard");
        var footerHelp = localizer.GetString("onboarding.footer.help", "Need help? See the");
        var footerAccount = localizer.GetString("onboarding.footer.account", "Tesla account page");
        var footerOr = localizer.GetString("onboarding.footer.or", " or the ");
        var footerDocs = localizer.GetString("onboarding.footer.docs", "documentation");

        var teslaDone = status.TeslaConnected;
        var vehicleDone = status.VehicleCount > 0;
        var telemetryDone = status.DataFlowing;
        var doneFlags = new[] { teslaDone, vehicleDone, telemetryDone };

        // The "current" step is the first not-yet-satisfied step; later not-done steps stay pending so the user
        // follows the flow (web Stepper.stateOf). When every step is done there is no current step.
        var firstPending = Array.IndexOf(doneFlags, false);

        var steps = new[]
        {
            new OnboardingStepDisplay(
                Key: "tesla",
                Title: teslaTitle,
                Description: teslaDescription,
                Done: teslaDone,
                IsCurrent: firstPending == 0,
                StepNumber: 1,
                CtaLabel: teslaCta,
                CtaAction: OnboardingStepAction.Navigate,
                CtaTarget: OnboardingRegistration.TeslaAccountRoute,
                CtaEnabled: true),
            new OnboardingStepDisplay(
                Key: "vehicle",
                Title: vehicleTitle,
                Description: vehicleDescription,
                Done: vehicleDone,
                IsCurrent: firstPending == 1,
                StepNumber: 2,
                CtaLabel: model.IsFetching ? vehicleChecking : vehicleCta,
                CtaAction: OnboardingStepAction.Refresh,
                CtaTarget: string.Empty,
                CtaEnabled: !model.IsFetching),
            new OnboardingStepDisplay(
                Key: "telemetry",
                Title: telemetryTitle,
                Description: telemetryDescription,
                Done: telemetryDone,
                IsCurrent: firstPending == 2,
                StepNumber: 3,
                CtaLabel: telemetryDocs,
                CtaAction: OnboardingStepAction.DocumentationLink,
                CtaTarget: OnboardingRegistration.TelemetryDocsPath,
                CtaEnabled: true),
        };

        var isComplete = status.IsComplete;

        return new OnboardingDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            DocumentTitle: documentTitle,
            IntroTitle: introTitle,
            IntroDescription: introDescription,
            Steps: steps,
            IsComplete: isComplete,
            StatusLine: isComplete ? readyLine : pollingLine,
            CheckAgainLabel: checkAgain,
            CheckAgainEnabled: !model.IsFetching,
            ShowSkip: !isComplete,
            SkipLabel: skipLabel,
            SkipHint: skipHint,
            ShowContinue: isComplete,
            ContinueLabel: continueLabel,
            FooterHelp: footerHelp,
            FooterAccountLabel: footerAccount,
            FooterOr: footerOr,
            FooterDocsLabel: footerDocs);
    }
}

/// <summary>
/// Canonical metadata for the <c>OnboardingPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/onboarding/pages/OnboardingPage.tsx</c> (route <c>/onboarding</c>, nav name <c>Onboarding</c>).
/// The page header title / subtitle resolve here so the registration and the projection share one key, and the route
/// targets the checklist CTAs navigate to live here so the view never hardcodes a path.
/// </summary>
public static class OnboardingRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OnboardingPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Onboarding</c>, path <c>onboarding</c>).</summary>
    public const string RouteName = "Onboarding";

    /// <summary>The generated OpenAPI operation id for the status read (web <c>useOnboardingStatus</c>).</summary>
    public const string StatusOperation = "get_api_v1_onboarding_status";

    /// <summary>The internal app route the Tesla-account step + footer link navigate to (web <c>/tesla-account</c>).</summary>
    public const string TeslaAccountRoute = "/tesla-account";

    /// <summary>The internal app route the skip / continue affordances navigate to (web <c>navigate('/')</c>).</summary>
    public const string DashboardRoute = "/";

    /// <summary>The documentation path the telemetry step opens (web <c>/docs/fleet-telemetry-setup</c>).</summary>
    public const string TelemetryDocsPath = "/docs/fleet-telemetry-setup";

    /// <summary>The documentation path the footer link opens (web <c>/docs/</c>).</summary>
    public const string DocsRootPath = "/docs/";

    /// <summary>The interval the page re-reads the status while setup is incomplete (web <c>refetchInterval</c> 30s).</summary>
    public const int PollIntervalSeconds = 30;

    /// <summary>The Segoe Fluent Icons glyph for the intro header (web <c>Sparkles</c>).</summary>
    public const string IntroGlyph = "\uE945";

    /// <summary>The localized page title (web <c>onboarding.welcome</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("onboarding.welcome", "Welcome to TeslaSync");
    }

    /// <summary>The localized page subtitle (web <c>onboarding.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("onboarding.subtitle", "Three quick steps before your dashboard is ready.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>OnboardingPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a setup anchor, vehicle count or token — so a
/// diagnostics line can never leak install state. Thread-safe.
/// </summary>
public sealed class OnboardingDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OnboardingDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OnboardingPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OnboardingRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="OnboardingPageViewModel"/> reads the setup status through — the native parity of the
/// web <c>useOnboardingStatus</c> hook (<c>GET /onboarding/status</c>). The view never performs HTTP itself; the
/// default <see cref="EmptyOnboardingStatusFeed"/> resolves to the pessimistic "nothing connected" snapshot, and the
/// generated-client-backed <see cref="OnboardingStatusClientFeed"/> binds to the generated OpenAPI contract client
/// (ADR-004).
/// </summary>
public interface IOnboardingStatusFeed
{
    /// <summary>Resolve the current setup status (web <c>useOnboardingStatus</c>).</summary>
    Task<OnboardingStatusSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default feed — resolves the status to the pessimistic <see cref="OnboardingStatusSnapshot.Pending"/> snapshot
/// without any network access (the parameterless page's feed). It keeps the headless / unpackaged page on the
/// every-step-outstanding checklist, so the surface is fully renderable in tests and design-time hosts.
/// </summary>
public sealed class EmptyOnboardingStatusFeed : IOnboardingStatusFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyOnboardingStatusFeed Instance { get; } = new();

    private EmptyOnboardingStatusFeed()
    {
    }

    /// <inheritdoc />
    public Task<OnboardingStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(OnboardingStatusSnapshot.Pending);
    }
}
