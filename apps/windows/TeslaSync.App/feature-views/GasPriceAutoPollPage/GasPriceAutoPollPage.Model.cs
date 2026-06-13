using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The four data states the gas-price-status feed resolves to, mirroring the web
/// <c>useGasPriceStatus</c> query lifecycle. The web <c>GasPriceSettings</c> always renders the panel and
/// null-safe-defaults every field, so <see cref="Empty"/> is the panel showing its em-dash defaults
/// (no EIA data yet) rather than a hidden region — the panel is never blank.
/// </summary>
public enum GasPriceState
{
    /// <summary>The status query is in flight (web query <c>isLoading</c>) — the metric values shimmer.</summary>
    Loading,

    /// <summary>The status resolved with no EIA data (no price, never polled) — the panel shows its defaults.</summary>
    Empty,

    /// <summary>The status query failed — the failure banner sits above the (still-rendered) panel.</summary>
    Error,

    /// <summary>The status resolved with data (a current price and/or a last-poll time).</summary>
    Success,
}

/// <summary>
/// The EIA gas-price auto-poll status — the native mirror of the web <c>GasPriceStatus</c>
/// (web/src/api/types.ts, <c>GET /gas-price/status</c>). Field names mirror the Go API's snake_case JSON tags.
/// Pure data (no Microsoft.UI types) so the projection is unit-tested without a UI host.
/// </summary>
public sealed record GasPriceStatus(
    bool Enabled,
    string PollInterval,
    string? LastPollTime,
    double CurrentPrice,
    double CurrentPriceKwhEq)
{
    /// <summary>The web select fallback when no interval is set (<c>poll_interval || '7d'</c>).</summary>
    public const string DefaultInterval = "7d";

    /// <summary>The resolved-but-empty status: disabled, weekly cadence, no price, never polled.</summary>
    public static GasPriceStatus Default { get; } = new(false, DefaultInterval, null, 0, 0);
}

/// <summary>
/// The data port the <see cref="GasPriceAutoPollPageViewModel"/> reads and mutates the EIA gas-price status
/// through. The manifest models this page as rendering from local state (the generated C# client exposes no
/// <c>/gas-price</c> endpoint), so the view-model is driven by an injected feed: the default
/// <see cref="EmptyGasPriceFeed"/> has no backend and returns <c>null</c> from every call, which lets the
/// view-model apply the optimistic local edit and render the panel with its defaults. A host can supply a
/// feed that answers from the contract endpoints (<c>GET /gas-price/status</c>, <c>POST /gas-price/toggle</c>,
/// <c>PUT /gas-price/config</c>, <c>POST /gas-price/poll</c>) without touching the view.
/// </summary>
public interface IGasPriceFeed
{
    /// <summary>Resolve the current status (web <c>useGasPriceStatus</c>), or <c>null</c> when unavailable.</summary>
    Task<GasPriceStatus?> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Persist the auto-poll toggle (web <c>useToggleGasPrice</c>); returns the authoritative status.</summary>
    Task<GasPriceStatus?> SetEnabledAsync(bool enabled, CancellationToken cancellationToken);

    /// <summary>Persist the poll interval (web <c>useUpdateGasPriceConfig</c>); returns the authoritative status.</summary>
    Task<GasPriceStatus?> SetIntervalAsync(string interval, CancellationToken cancellationToken);

    /// <summary>Trigger an immediate poll (web <c>usePollGasPrice</c>); returns the refreshed status.</summary>
    Task<GasPriceStatus?> PollNowAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default feed — no backend is wired, so every call resolves to <c>null</c>. The view-model treats a
/// <c>null</c> result as "not persisted" and keeps its optimistic local edit, so the panel stays interactive
/// (the toggle flips, the interval changes) and renders its defaults for price / last-poll until a real feed
/// is injected.
/// </summary>
public sealed class EmptyGasPriceFeed : IGasPriceFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGasPriceFeed Instance { get; } = new();

    private EmptyGasPriceFeed()
    {
    }

    /// <inheritdoc />
    public Task<GasPriceStatus?> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GasPriceStatus?>(null);
    }

    /// <inheritdoc />
    public Task<GasPriceStatus?> SetEnabledAsync(bool enabled, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GasPriceStatus?>(null);
    }

    /// <inheritdoc />
    public Task<GasPriceStatus?> SetIntervalAsync(string interval, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GasPriceStatus?>(null);
    }

    /// <inheritdoc />
    public Task<GasPriceStatus?> PollNowAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<GasPriceStatus?>(null);
    }
}

/// <summary>
/// The raw observable state behind the WinUI <c>GasPriceAutoPollPage</c> — the native port of the web data flow
/// (the page wrapper web/src/features/admin/pages/GasPriceAutoPollPage.tsx + the embedded
/// web/src/features/settings/components/GasPriceSettings.tsx). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record GasPriceModel(
    GasPriceStatus? Status,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    string? Notice,
    bool Polling)
{
    /// <summary>The initial model — the first load, no status yet.</summary>
    public static GasPriceModel Initial { get; } = new(
        Status: null,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Notice: null,
        Polling: false);
}

/// <summary>One projected poll-interval option (web <c>Select</c> option: daily / weekly / bi-weekly / monthly).</summary>
public sealed record GasPriceIntervalOption(string Value, string Label);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds the page header (title / subtitle), the auto-poll toggle, the poll-interval select, the
/// current-price and last-polled metric cards, the poll-now action and source note, plus the four data-state
/// flags and the transient action notice. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record GasPriceDisplay(
    GasPriceState State,
    string Title,
    string Subtitle,
    string AutoPollLabel,
    bool IsEnabled,
    string ToggleStateLabel,
    string PollIntervalLabel,
    string SelectedInterval,
    IReadOnlyList<GasPriceIntervalOption> IntervalOptions,
    string CurrentPriceLabel,
    string CurrentPriceValue,
    string LastPolledLabel,
    string LastPolledValue,
    string PollNowLabel,
    string SourceText,
    bool IsPolling,
    bool ShowLoading,
    bool HasError,
    string ErrorBannerText,
    string RetryLabel,
    bool HasNotice,
    string NoticeText);

/// <summary>
/// The Microsoft.UI-free projector that turns a <see cref="GasPriceModel"/> into the render-ready
/// <see cref="GasPriceDisplay"/>. A faithful port of the web <c>GasPriceSettings</c> render: every literal flows
/// through the <see cref="ILocalizer"/> with the web key names, the price is formatted with the shared currency
/// formatter and the last-poll time with the shared datetime formatter (the web <c>formatCurrency</c> /
/// <c>formatDateTime</c> display boundary), and the never-polled sentinel is reproduced verbatim.
/// </summary>
public static class GasPriceProjection
{
    // The web zero-time sentinel guarded in GasPriceSettings (last_poll_time !== '0001-01-01T00:00:00Z').
    private const string ZeroPollTime = "0001-01-01T00:00:00Z";

    // The web price readout is "$x.xx/<unit>"; the unit label follows settings.gas_unit (default 'gal').
    private const string DefaultUnitLabel = "gal";

    /// <summary>Project <paramref name="model"/> into the render-ready display relative to <paramref name="now"/>.</summary>
    public static GasPriceDisplay Project(GasPriceModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        GasPriceStatus status = model.Status ?? GasPriceStatus.Default;

        string title = localizer.GetString("gas.title", "Gas Price Auto-Poll");
        string subtitle = localizer.GetString("gas.subtitle", "Automatically fetch US average gas prices from EIA");
        string autoPollLabel = localizer.GetString("gas.autoPoll", "Auto-Poll");
        string toggleLabel = status.Enabled
            ? localizer.GetString("gas.running", "Running")
            : localizer.GetString("gas.stopped", "Stopped");
        string pollIntervalLabel = localizer.GetString("gas.pollInterval", "Poll Interval");
        string currentPriceLabel = localizer.GetString("gas.currentPrice", "Current Price");
        string lastPolledLabel = localizer.GetString("gas.lastPolled", "Last Polled");
        string pollNowLabel = localizer.GetString("gas.pollNow", "Poll Now");
        string sourceText = localizer.GetString("gas.source", "Source: U.S. Energy Information Administration");

        string selectedInterval = string.IsNullOrEmpty(status.PollInterval) ? GasPriceStatus.DefaultInterval : status.PollInterval;
        IReadOnlyList<GasPriceIntervalOption> intervalOptions = GasPriceAutoPollRegistration.IntervalOptions(localizer);

        bool hasPrice = status.CurrentPrice > 0;
        string priceValue = hasPrice
            ? $"{ScalarFormatters.FormatCurrency(status.CurrentPrice)}/{DefaultUnitLabel}"
            : UnitFormatters.DefaultEmptyDisplay;

        bool hasPoll = HasPolled(status.LastPollTime, out DateTimeOffset polledAt);
        string lastPolledValue = hasPoll
            ? DateTimeFormatting.Format(polledAt, DateTimeVariant.Full, now)
            : localizer.GetString("gas.never", "Never");

        GasPriceState state = SelectState(model, hasPrice, hasPoll);

        string errorText = model.HasError
            ? FormatError(localizer, model.ErrorDetail)
            : string.Empty;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        bool hasNotice = !string.IsNullOrEmpty(model.Notice);

        return new GasPriceDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutoPollLabel: autoPollLabel,
            IsEnabled: status.Enabled,
            ToggleStateLabel: toggleLabel,
            PollIntervalLabel: pollIntervalLabel,
            SelectedInterval: selectedInterval,
            IntervalOptions: intervalOptions,
            CurrentPriceLabel: currentPriceLabel,
            CurrentPriceValue: priceValue,
            LastPolledLabel: lastPolledLabel,
            LastPolledValue: lastPolledValue,
            PollNowLabel: pollNowLabel,
            SourceText: sourceText,
            IsPolling: model.Polling,
            ShowLoading: state == GasPriceState.Loading,
            HasError: model.HasError,
            ErrorBannerText: errorText,
            RetryLabel: retryLabel,
            HasNotice: hasNotice,
            NoticeText: model.Notice ?? string.Empty);
    }

    /// <summary>The localized toast-equivalent notice for an auto-poll toggle (web <c>gas.enabled</c> / <c>gas.disabled</c>).</summary>
    public static string ToggleNotice(ILocalizer localizer, bool enabled)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return enabled
            ? localizer.GetString("gas.enabled", "Auto-poll enabled")
            : localizer.GetString("gas.disabled", "Auto-poll disabled");
    }

    /// <summary>The localized notice for a poll-interval change (web <c>gas.intervalUpdated</c>).</summary>
    public static string IntervalNotice(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("gas.intervalUpdated", "Poll interval updated");
    }

    /// <summary>The localized notice for a manual poll (web <c>gas.pollTriggered</c>).</summary>
    public static string PollNotice(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("gas.pollTriggered", "Gas price poll triggered");
    }

    private static GasPriceState SelectState(GasPriceModel model, bool hasPrice, bool hasPoll)
    {
        if (model.HasError)
        {
            return GasPriceState.Error;
        }

        if (model.Loading && model.Status is null)
        {
            return GasPriceState.Loading;
        }

        return hasPrice || hasPoll ? GasPriceState.Success : GasPriceState.Empty;
    }

    private static bool HasPolled(string? lastPollTime, out DateTimeOffset polledAt)
    {
        polledAt = default;
        if (string.IsNullOrWhiteSpace(lastPollTime) || string.Equals(lastPollTime, ZeroPollTime, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!DateTimeOffset.TryParse(lastPollTime, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out polledAt))
        {
            return false;
        }

        return polledAt.Year > 1;
    }

    private static string FormatError(ILocalizer localizer, string? detail)
    {
        string prefix = localizer.GetString("error.loadFailed", "Failed to load data");
        return string.IsNullOrWhiteSpace(detail) ? prefix : $"{prefix}: {detail}";
    }
}

/// <summary>
/// Canonical metadata for the <c>GasPriceAutoPollPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/GasPriceAutoPollPage.tsx</c> (route <c>/gas-price</c>, nav name
/// <c>GasPriceAutoPoll</c>).
/// </summary>
public static class GasPriceAutoPollRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GasPriceAutoPollPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>GasPriceAutoPoll</c>).</summary>
    public const string RouteName = "GasPriceAutoPoll";

    /// <summary>The localized page title (web <c>gas.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("gas.title", "Gas Price Auto-Poll");
    }

    /// <summary>The localized page subtitle (web <c>gas.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("gas.subtitle", "Automatically fetch US average gas prices from EIA");
    }

    /// <summary>The poll-interval options (web <c>Select</c>: Daily / Weekly / Bi-weekly / Monthly).</summary>
    public static IReadOnlyList<GasPriceIntervalOption> IntervalOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            new GasPriceIntervalOption("daily", localizer.GetString("gas.daily", "Daily")),
            new GasPriceIntervalOption("7d", localizer.GetString("gas.weekly", "Weekly")),
            new GasPriceIntervalOption("15d", localizer.GetString("gas.biweekly", "Bi-weekly")),
            new GasPriceIntervalOption("30d", localizer.GetString("gas.monthly", "Monthly")),
        ];
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>GasPriceAutoPollPage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a price, timestamp or error — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class GasPriceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GasPriceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GasPriceAutoPollPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GasPriceAutoPollRegistration.Slug}");
    }
}
