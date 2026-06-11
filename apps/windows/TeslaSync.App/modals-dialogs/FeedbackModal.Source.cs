using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The mutation port the <see cref="FeedbackModalViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useSubmitFeedback</c> hook (web/src/api/hooks/useFeedback.ts). It drives the single
/// <c>POST /feedback</c> write the modal performs. The view never performs HTTP itself; the concrete
/// <see cref="FeedbackSubmitSource"/> (or a test fake) drives this.
/// </summary>
public interface IFeedbackSubmitSource
{
    /// <summary>
    /// Submit feedback (web <c>submit.mutateAsync(payload)</c>): <c>POST /feedback</c> with the assembled body.
    /// Returns success or a classified error — it never throws for an HTTP fault so the caller surfaces a toast
    /// rather than an unhandled rejection (web parity).
    /// </summary>
    Task<FeedbackSubmitOutcome> SubmitAsync(FeedbackSubmitRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The contract-client-backed <see cref="IFeedbackSubmitSource"/> — the native data adapter for the feedback modal.
/// It POSTs the assembled body to the generated <c>post_api_v1_feedback</c> endpoint through the shared
/// <see cref="IApiClient"/> (the same auth + resilience pipeline the rest of the app shares) and classifies any
/// fault through the shared <see cref="ApiErrorMapper"/> rather than throwing. The created feedback row in the
/// response is discarded — the modal only needs success/failure, exactly like the web mutation, whose
/// <c>onSuccess</c> simply raises a toast and closes the modal. No HTTP touches the view.
/// </summary>
public sealed class FeedbackSubmitSource : IFeedbackSubmitSource
{
    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/feedback</c>.</summary>
    public const string SubmitOperation = "post_api_v1_feedback";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for the submit POST.</param>
    public FeedbackSubmitSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FeedbackSubmitOutcome> SubmitAsync(
        FeedbackSubmitRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var apiRequest = new ApiRequest(SubmitOperation, Body: request);
        try
        {
            _ = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
            return FeedbackSubmitOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return FeedbackSubmitOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return FeedbackSubmitOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}

/// <summary>
/// The auto-collected-context port the <see cref="FeedbackModalViewModel"/> binds to (P1/S8 state-holder seam) —
/// the native analogue of the web modal's synchronous reads of <c>useLocation()</c>, <c>navigator.userAgent</c>,
/// <c>import.meta.env.VITE_APP_VERSION</c> and <c>getRecentReportsForFeedback()</c>. The view never reaches for
/// these globals itself; the concrete <see cref="FeedbackContextSource"/> (or a <see cref="StaticFeedbackContextSource"/>
/// in tests) supplies a snapshot when the modal opens.
/// </summary>
public interface IFeedbackContextSource
{
    /// <summary>Capture the current auto-attached context (route, app version, runtime, recent errors, console tail).</summary>
    FeedbackContext Capture();
}

/// <summary>
/// A fixed <see cref="IFeedbackContextSource"/> for the headless tests (and any caller that already has a snapshot).
/// The Windows app registers the <see cref="FeedbackContextSource"/> that composes the live context.
/// </summary>
public sealed class StaticFeedbackContextSource : IFeedbackContextSource
{
    private readonly FeedbackContext _context;

    /// <summary>Creates the source over a fixed <paramref name="context"/> (defaults to <see cref="FeedbackContext.Empty"/>).</summary>
    public StaticFeedbackContextSource(FeedbackContext? context = null) => _context = context ?? FeedbackContext.Empty;

    /// <inheritdoc />
    public FeedbackContext Capture() => _context;
}

/// <summary>
/// The live <see cref="IFeedbackContextSource"/> — composes the auto-attached context from the shared
/// <see cref="IPushEnvironment"/> (app version + the platform / locale runtime descriptor — the native analogue of
/// the browser user-agent), a current-route provider (the native analogue of <c>useLocation().pathname</c>, wired
/// to the shell's <c>NavigationHistory.Current</c>) and the <see cref="IFeedbackDiagnosticsLog"/> ring (the native
/// analogue of the <c>errorReporter</c> feedback ring + the console tail buffer). WinUI-free so the composition is
/// unit-tested without a UI host.
/// </summary>
public sealed class FeedbackContextSource : IFeedbackContextSource
{
    private readonly IPushEnvironment _environment;
    private readonly Func<string?> _currentRoute;
    private readonly IFeedbackDiagnosticsLog _diagnostics;

    /// <summary>Creates the source over the environment, current-route provider and diagnostics ring.</summary>
    /// <param name="environment">The ambient app facts (app version, platform, locale).</param>
    /// <param name="currentRoute">Returns the current route path (the shell's <c>NavigationHistory.Current</c>).</param>
    /// <param name="diagnostics">The recent-errors + console-tail diagnostics ring.</param>
    public FeedbackContextSource(
        IPushEnvironment environment,
        Func<string?> currentRoute,
        IFeedbackDiagnosticsLog diagnostics)
    {
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(currentRoute);
        ArgumentNullException.ThrowIfNull(diagnostics);
        _environment = environment;
        _currentRoute = currentRoute;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public FeedbackContext Capture() => new(
        NormalizeRoute(_currentRoute()),
        _environment.AppVersion ?? string.Empty,
        BuildRuntimeDescriptor(_environment),
        _diagnostics.RecentErrors(),
        _diagnostics.ConsoleTail());

    /// <summary>
    /// Compose the runtime descriptor shown in the context panel (the native analogue of the browser user-agent
    /// line): the platform token and the user locale, e.g. <c>windows \u00B7 en-US</c>. The app version is shown on
    /// its own row, so it is intentionally excluded here.
    /// </summary>
    internal static string BuildRuntimeDescriptor(IPushEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);
        string platform = string.IsNullOrWhiteSpace(environment.Platform) ? string.Empty : environment.Platform;
        string locale = string.IsNullOrWhiteSpace(environment.Locale) ? string.Empty : environment.Locale;
        if (platform.Length == 0)
        {
            return locale;
        }

        return locale.Length == 0 ? platform : string.Create(
            CultureInfo.InvariantCulture, $"{platform} \u00B7 {locale}");
    }

    // The web defaults the route to '/' when there is no window location; an empty navigation history maps the same.
    private static string NormalizeRoute(string? route) =>
        string.IsNullOrWhiteSpace(route) ? "/" : route;
}

/// <summary>
/// The recent-errors + console-tail diagnostics ring the feedback modal attaches — the native analogue of the web
/// <c>errorReporter</c> feedback ring (<c>getRecentReportsForFeedback()</c>) and the in-memory console-tail buffer.
/// The app installs one process-wide instance that its global exception / log hooks feed; headless callers and unit
/// tests use <see cref="InMemoryFeedbackDiagnosticsLog"/> directly. Implementations must be best-effort and
/// thread-safe — capturing diagnostics must never throw into its caller.
/// </summary>
public interface IFeedbackDiagnosticsLog
{
    /// <summary>The most-recent captured error reports, oldest-first, capped at the ring size (a fresh copy).</summary>
    IReadOnlyList<FeedbackErrorReport> RecentErrors();

    /// <summary>The captured console / log tail joined newest-last (un-truncated; the projection slices it).</summary>
    string ConsoleTail();
}

/// <summary>
/// A thread-safe, in-memory <see cref="IFeedbackDiagnosticsLog"/> — the native analogue of the web
/// <c>errorReporter</c> ring buffers. It retains the most-recent <see cref="RingSize"/> error reports and the most
/// recent <see cref="ConsoleLineMax"/> log lines, dropping the oldest beyond those bounds (web parity). The app
/// feeds it from its global exception and log hooks; unit tests seed it directly. Recording never throws.
/// </summary>
public sealed class InMemoryFeedbackDiagnosticsLog : IFeedbackDiagnosticsLog
{
    /// <summary>Maximum retained error reports (web <c>FEEDBACK_RING_SIZE</c>).</summary>
    public const int RingSize = 10;

    /// <summary>Maximum retained console / log lines (web <c>CONSOLE_TAIL_BUFFER_MAX</c>).</summary>
    public const int ConsoleLineMax = 50;

    private readonly object _gate = new();
    private readonly List<FeedbackErrorReport> _errors = [];
    private readonly List<string> _console = [];

    /// <summary>Capture an already-built error report into the ring (drops the oldest beyond <see cref="RingSize"/>).</summary>
    public void RecordError(FeedbackErrorReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        lock (_gate)
        {
            _errors.Add(report);
            TrimFront(_errors, RingSize);
        }
    }

    /// <summary>
    /// Capture an error from its parts, stamping <c>occurred_at</c> as the current UTC ISO-8601 instant — the native
    /// analogue of the web <c>pushFeedbackReport</c> call inside <c>reportFrontendError</c>.
    /// </summary>
    public void RecordError(string name, string message, string route, string source, string? stack = null) =>
        RecordError(new FeedbackErrorReport(
            string.IsNullOrEmpty(name) ? "Error" : name,
            message ?? string.Empty,
            string.IsNullOrEmpty(route) ? "/" : route,
            DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            string.IsNullOrEmpty(source) ? "app" : source,
            string.IsNullOrEmpty(stack) ? null : stack));

    /// <summary>Append a console / log line (drops the oldest beyond <see cref="ConsoleLineMax"/>).</summary>
    public void RecordConsoleLine(string line)
    {
        lock (_gate)
        {
            _console.Add(line ?? string.Empty);
            TrimFront(_console, ConsoleLineMax);
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<FeedbackErrorReport> RecentErrors()
    {
        lock (_gate)
        {
            return _errors.Count == 0 ? Array.Empty<FeedbackErrorReport>() : _errors.ToArray();
        }
    }

    /// <inheritdoc />
    public string ConsoleTail()
    {
        lock (_gate)
        {
            return _console.Count == 0 ? string.Empty : string.Join("\n", _console);
        }
    }

    private static void TrimFront<T>(List<T> list, int max)
    {
        if (list.Count > max)
        {
            list.RemoveRange(0, list.Count - max);
        }
    }
}
