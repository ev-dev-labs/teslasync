using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The four analytics tabs the page switches between — the native union of the web
/// <c>AnalyticsPage</c> tab keys (<c>'overview' | 'driving' | 'charging' | 'battery'</c>, see
/// <c>web/src/features/analytics/components/analytics/constants.tsx</c>). Pure data so the active-tab
/// selection is asserted without a UI host.
/// </summary>
public enum AnalyticsTabKey
{
    /// <summary>The Overview tab (web <c>analytics.tabs.overview</c>) — the default selection.</summary>
    Overview,

    /// <summary>The Driving tab (web <c>analytics.tabs.driving</c>).</summary>
    Driving,

    /// <summary>The Charging tab (web <c>analytics.tabs.charging</c>).</summary>
    Charging,

    /// <summary>The Battery tab (web <c>analytics.tabs.battery</c>).</summary>
    Battery,
}

/// <summary>
/// The mutually-exclusive top-level data state the page renders for its single
/// <c>useFleetAnalytics</c> read. The web page hands the query lifecycle to <c>PageContainer</c> via its
/// <c>loading</c> / <c>error</c> props (the resolved branch renders the hero gauges and the tab body); the
/// native page reproduces those three branches as visible surfaces, never a blank page. The fleet endpoint
/// always returns a populated object, so a resolved-but-dataless read is <see cref="Success"/> (the hero
/// and each tab then render their own empty surface) rather than a page-level empty branch.
/// </summary>
public enum AnalyticsPageState
{
    /// <summary>The fleet read is in flight with nothing resolved — the loading shimmer.</summary>
    Loading,

    /// <summary>The fleet read failed with nothing resolved — the retriable error surface.</summary>
    Error,

    /// <summary>The fleet read resolved — the hero gauges, the tab strip and the active tab body.</summary>
    Success,
}

/// <summary>
/// Canonical registration metadata for the Analytics page. The diagnostics <see cref="Slug"/> is the stable
/// surface identifier emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract);
/// <see cref="RouteName"/> matches the shell <c>RouteTable</c> entry for <c>/analytics</c>; and
/// <see cref="DefaultDays"/> mirrors the trailing window the web analytics page requests for
/// <c>GET /analytics/fleet</c>.
/// </summary>
public static class AnalyticsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AnalyticsPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>'s <c>Analytics</c> entry).</summary>
    public const string RouteName = "Analytics";

    /// <summary>The generated operation id for the fleet analytics read (web <c>useFleetAnalytics</c>).</summary>
    public const string FleetOperation = TeslaSync.App.Core.Data.Net.Operations.Analytics.Fleet;

    /// <summary>The trailing window the page requests, mirroring the web analytics default preset.</summary>
    public const int DefaultDays = 30;

    /// <summary>The currency symbol passed to the hero / charging surfaces (web <c>formatCurrency</c> default).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent — chart (web <c>BarChart3</c>) for the Overview tab; also the page glyph.</summary>
    public const string OverviewGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — car (web <c>Car</c>) for the Driving tab.</summary>
    public const string DrivingGlyph = "\uE804";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>) for the Charging tab.</summary>
    public const string ChargingGlyph = "\uE945";

    /// <summary>Segoe Fluent — Battery (web <c>Battery</c>) for the Battery tab.</summary>
    public const string BatteryGlyph = "\uE83F";
}

/// <summary>
/// PII-safe diagnostics for the Analytics page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location — so a diagnostics
/// line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class AnalyticsPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public AnalyticsPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnalyticsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AnalyticsRegistration.Slug}");
    }
}

/// <summary>Tolerant JSON readers shared by the snapshot parsers — every accessor is null-safe.</summary>
internal static class AnalyticsJson
{
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object &&
            obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.String)
        {
            return v.GetString() ?? string.Empty;
        }

        return string.Empty;
    }

    public static JsonElement? Object(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object &&
            obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.Object)
        {
            return v;
        }

        return null;
    }

    public static JsonElement? Array(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object &&
            obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.Array)
        {
            return v;
        }

        return null;
    }
}

/// <summary>
/// The parsed <c>GET /analytics/fleet</c> snapshot the page owns once and feeds to every tab — the native
/// analogue of the single web <c>useFleetAnalytics({ start, end })</c> result the web
/// <c>AnalyticsPage</c> passes down to <c>HeroGauges</c> and each tab as its <c>data</c> prop. It keeps the
/// raw (detached) fleet JSON so the self-fetching tab surfaces (Hero / Overview / Charging) can be replayed
/// through their own result mappers, and pre-parses the two slices the presentational tabs need:
/// <see cref="Driving"/> (web <c>data.drive_analytics</c>) and <see cref="BatteryTrend"/>
/// (web <c>data.battery_trend</c>). Pure data — no WinUI types — so the parsing is unit-tested headlessly.
/// </summary>
/// <param name="RawFleet">The detached fleet JSON object, or <see langword="null"/> when none resolved.</param>
/// <param name="HasFleet">True when the read resolved a fleet object (drives the success branch).</param>
/// <param name="Driving">The parsed driving analytics slice, or <see langword="null"/> when absent.</param>
/// <param name="BatteryTrend">The parsed battery-health trend rows (empty when absent).</param>
public sealed record AnalyticsFleetSnapshot(
    JsonElement? RawFleet,
    bool HasFleet,
    DriveAnalytics? Driving,
    IReadOnlyList<BatteryTrendPoint> BatteryTrend)
{
    /// <summary>The empty snapshot — the read resolved no fleet object (or has not run yet).</summary>
    public static AnalyticsFleetSnapshot Empty { get; } =
        new(null, false, null, System.Array.Empty<BatteryTrendPoint>());

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant snapshot.</summary>
    /// <param name="element">The parsed JSON body.</param>
    /// <returns>A snapshot whose every absent slice degrades to its own empty surface.</returns>
    public static AnalyticsFleetSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new AnalyticsFleetSnapshot(
            RawFleet: element.Clone(),
            HasFleet: true,
            Driving: ParseDriveAnalytics(element),
            BatteryTrend: ParseBatteryTrend(element));
    }

    private static DriveAnalytics? ParseDriveAnalytics(JsonElement fleet)
    {
        if (AnalyticsJson.Object(fleet, "drive_analytics") is not { } da)
        {
            return null;
        }

        return new DriveAnalytics(
            SpeedDistribution: ParseBuckets(da, "speed_distribution"),
            DistanceDistribution: ParseBuckets(da, "distance_distribution"),
            DurationDistribution: ParseBuckets(da, "duration_distribution"),
            HourlyPattern: ParseHours(da),
            TempVsEfficiency: ParseTempEfficiency(da),
            DailyTrend: ParseDailyTrend(da),
            SpeedStats: ParseStat(da, "speed_stats"),
            PowerStats: ParseStat(da, "power_stats"),
            RegenStats: ParseStat(da, "regen_stats"),
            DistanceStats: ParseStat(da, "distance_stats"),
            Temperature: ParseTemperature(da));
    }

    private static IReadOnlyList<DriveBucket> ParseBuckets(JsonElement parent, string name)
    {
        if (AnalyticsJson.Array(parent, name) is not { } array)
        {
            return System.Array.Empty<DriveBucket>();
        }

        var list = new List<DriveBucket>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new DriveBucket(AnalyticsJson.String(item, "range"), AnalyticsJson.Double(item, "count") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<DriveHourPoint> ParseHours(JsonElement da)
    {
        if (AnalyticsJson.Array(da, "hourly_pattern") is not { } array)
        {
            return System.Array.Empty<DriveHourPoint>();
        }

        var list = new List<DriveHourPoint>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new DriveHourPoint(
                AnalyticsJson.Double(item, "hour") ?? 0,
                AnalyticsJson.Double(item, "drives") ?? 0,
                AnalyticsJson.Double(item, "distance") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<DriveTempEffPoint> ParseTempEfficiency(JsonElement da)
    {
        if (AnalyticsJson.Array(da, "temp_vs_efficiency") is not { } array)
        {
            return System.Array.Empty<DriveTempEffPoint>();
        }

        var list = new List<DriveTempEffPoint>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new DriveTempEffPoint(
                AnalyticsJson.Double(item, "temp") ?? 0,
                AnalyticsJson.Double(item, "efficiency") ?? 0,
                AnalyticsJson.Double(item, "distance") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<DriveDailyPoint> ParseDailyTrend(JsonElement da)
    {
        if (AnalyticsJson.Array(da, "daily_trend") is not { } array)
        {
            return System.Array.Empty<DriveDailyPoint>();
        }

        var list = new List<DriveDailyPoint>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new DriveDailyPoint(
                AnalyticsJson.String(item, "date"),
                AnalyticsJson.Double(item, "distance") ?? 0,
                AnalyticsJson.Double(item, "drives") ?? 0,
                AnalyticsJson.Double(item, "efficiency") ?? 0));
        }

        return list;
    }

    private static DriveStat? ParseStat(JsonElement parent, string name)
    {
        if (AnalyticsJson.Object(parent, name) is not { } stat)
        {
            return null;
        }

        return new DriveStat(
            AnalyticsJson.Double(stat, "min") ?? 0,
            AnalyticsJson.Double(stat, "avg") ?? 0,
            AnalyticsJson.Double(stat, "max") ?? 0);
    }

    private static DriveTemperature? ParseTemperature(JsonElement da)
    {
        if (AnalyticsJson.Object(da, "temperature") is not { } temp)
        {
            return null;
        }

        return new DriveTemperature(ParseStat(temp, "inside"), ParseStat(temp, "outside"));
    }

    private static IReadOnlyList<BatteryTrendPoint> ParseBatteryTrend(JsonElement fleet)
    {
        if (AnalyticsJson.Array(fleet, "battery_trend") is not { } array)
        {
            return System.Array.Empty<BatteryTrendPoint>();
        }

        var list = new List<BatteryTrendPoint>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new BatteryTrendPoint(
                Date: AnalyticsJson.String(item, "date"),
                HealthScore: AnalyticsJson.Double(item, "health_score") ?? 0,
                CapacityWh: AnalyticsJson.Double(item, "capacity_wh") ?? 0,
                DegradationPct: AnalyticsJson.Double(item, "degradation_pct") ?? 0,
                RangeKm: AnalyticsJson.Double(item, "range_km") ?? 0,
                CycleCount: AnalyticsJson.Double(item, "cycle_count") ?? 0));
        }

        return list;
    }
}

/// <summary>
/// The fleet-analytics data port the page binds to (the native P1/S8 seam). The view never performs HTTP;
/// the concrete <see cref="AnalyticsFleetClientFeed"/> (or a test fake) drives this. It is the native
/// analogue of the web <c>useFleetAnalytics({ start, end })</c> query feeding <c>AnalyticsPage</c>.
/// </summary>
public interface IAnalyticsFleetFeed
{
    /// <summary>Fetch the fleet analytics rollup for the active trailing window.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The parsed snapshot, or <see cref="AnalyticsFleetSnapshot.Empty"/> when none resolved.</returns>
    Task<AnalyticsFleetSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyAnalyticsFleetFeed : IAnalyticsFleetFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAnalyticsFleetFeed Instance { get; } = new();

    private EmptyAnalyticsFleetFeed()
    {
    }

    /// <inheritdoc />
    public Task<AnalyticsFleetSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(AnalyticsFleetSnapshot.Empty);
}

/// <summary>
/// Builds the single-emission <c>RepositoryResult&lt;JsonElement&gt;</c> the replay sources hand to each
/// self-fetching tab's own result mapper, so all three derive from the page's one fleet read (true web
/// parity — one query, shared data) instead of re-fetching. A present fleet replays as a loaded result; an
/// absent one replays as empty so the tab renders its own empty surface.
/// </summary>
internal static class AnalyticsFleetReplay
{
    public static RepositoryResult<JsonElement> Raw(JsonElement? fleet) =>
        fleet is { } element
            ? RepositoryResult<JsonElement>.Loaded(element, DateTimeOffset.UtcNow)
            : RepositoryResult<JsonElement>.Empty(DateTimeOffset.UtcNow);
}

/// <summary>
/// Replays the page's fleet snapshot to the <c>HeroGauges</c> surface through its own
/// <see cref="HeroGaugesResultMapper"/>, so the hero tiles derive from the page's single read.
/// </summary>
internal sealed class ReplayHeroGaugesSource : IHeroGaugesSource
{
    private readonly JsonElement? _fleet;

    public ReplayHeroGaugesSource(JsonElement? fleet) => _fleet = fleet;

    public async IAsyncEnumerable<RepositoryResult<HeroFleetAnalytics>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return HeroGaugesResultMapper.Map(AnalyticsFleetReplay.Raw(_fleet));
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Replays the page's fleet snapshot to the <c>OverviewTab</c> surface through its own
/// <see cref="OverviewTabResultMapper"/>, so the overview panels derive from the page's single read.
/// </summary>
internal sealed class ReplayOverviewTabSource : IOverviewTabSource
{
    private readonly JsonElement? _fleet;

    public ReplayOverviewTabSource(JsonElement? fleet) => _fleet = fleet;

    public async IAsyncEnumerable<RepositoryResult<OverviewData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return OverviewTabResultMapper.Map(AnalyticsFleetReplay.Raw(_fleet));
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Replays the page's fleet snapshot to the <c>ChargingTab</c> surface through its own
/// <see cref="ChargingTabResultMapper"/>, so the charging panels derive from the page's single read.
/// </summary>
internal sealed class ReplayChargingTabSource : IChargingTabSource
{
    private readonly JsonElement? _fleet;

    public ReplayChargingTabSource(JsonElement? fleet) => _fleet = fleet;

    public async IAsyncEnumerable<RepositoryResult<ChargingTabData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return ChargingTabResultMapper.Map(AnalyticsFleetReplay.Raw(_fleet));
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// One projected tab header — the localized label, the Fluent glyph and the Narrator name for one of the
/// four <c>TabNav</c> entries the web <c>AnalyticsPage</c> renders. Pure data so the tab strip is asserted
/// headlessly.
/// </summary>
/// <param name="Key">The tab this header selects.</param>
/// <param name="Label">The localized tab label (web <c>analytics.tabs.*</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the tab icon (web lucide icon).</param>
/// <param name="AutomationName">The composed Narrator name for the tab.</param>
public sealed record AnalyticsTabItem(AnalyticsTabKey Key, string Label, string Glyph, string AutomationName);

/// <summary>
/// The render-ready projection the view binds to — the page header (title + subtitle), the three data-state
/// flags, the retriable error text, and the four-entry tab strip plus the active selection. The hero gauges
/// and the per-tab bodies are composed by the view from the bound snapshot; their own parity units own their
/// internal projections. Pure data — no WinUI types.
/// </summary>
public sealed record AnalyticsDisplay(
    AnalyticsPageState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    IReadOnlyList<AnalyticsTabItem> Tabs,
    AnalyticsTabKey ActiveTab,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed fleet <see cref="Snapshot"/>, the page
/// lifecycle (<see cref="Loading"/> / <see cref="ErrorDetail"/>) and the selected <see cref="ActiveTab"/>.
/// The view-model fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record AnalyticsPageModel(
    AnalyticsFleetSnapshot Snapshot,
    bool Loading,
    string? ErrorDetail,
    AnalyticsTabKey ActiveTab)
{
    /// <summary>The initial model: the fleet read is in flight on the Overview tab.</summary>
    public static AnalyticsPageModel Initial { get; } =
        new(AnalyticsFleetSnapshot.Empty, true, null, AnalyticsTabKey.Overview);
}

/// <summary>
/// Pure projection from <see cref="AnalyticsPageModel"/> to <see cref="AnalyticsDisplay"/> — the native port
/// of the web <c>AnalyticsPage</c> shell (title, subtitle, the three query states and the four tab labels).
/// Every visible string resolves through the injected localizer (web key names verbatim). No WinUI / HTTP /
/// IO so the full state matrix and every label are asserted without a UI host.
/// </summary>
public static class AnalyticsProjection
{
    /// <summary>Project <paramref name="model"/> into the render-ready page display.</summary>
    /// <param name="model">The parsed fleet snapshot plus the page lifecycle flags and active tab.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready header, state flags and tab strip.</returns>
    public static AnalyticsDisplay Project(AnalyticsPageModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        AnalyticsPageState state =
            model.Loading && !model.Snapshot.HasFleet ? AnalyticsPageState.Loading
            : model.ErrorDetail is not null ? AnalyticsPageState.Error
            : AnalyticsPageState.Success;

        string title = localizer.GetString("analytics.title", "Fleet Analytics");
        string subtitle = localizer.GetString("analytics.subtitle", "Comprehensive fleet performance insights");
        string retryLabel = localizer.GetString("error.retry", "Retry");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? localizer.GetString("analytics.error", "Couldn't load analytics")
            : $"{title}: {model.ErrorDetail}";

        return new AnalyticsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == AnalyticsPageState.Loading,
            ShowError: state == AnalyticsPageState.Error,
            ShowContent: state == AnalyticsPageState.Success,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            Tabs: BuildTabs(localizer),
            ActiveTab: model.ActiveTab,
            AutomationName: title);
    }

    /// <summary>Build the four localized tab headers in the web order (overview → driving → charging → battery).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The four tab headers.</returns>
    public static IReadOnlyList<AnalyticsTabItem> BuildTabs(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new[]
        {
            Tab(AnalyticsTabKey.Overview, localizer.GetString("analytics.tabs.overview", "Overview"), AnalyticsRegistration.OverviewGlyph),
            Tab(AnalyticsTabKey.Driving, localizer.GetString("analytics.tabs.driving", "Driving"), AnalyticsRegistration.DrivingGlyph),
            Tab(AnalyticsTabKey.Charging, localizer.GetString("analytics.tabs.charging", "Charging"), AnalyticsRegistration.ChargingGlyph),
            Tab(AnalyticsTabKey.Battery, localizer.GetString("analytics.tabs.battery", "Battery"), AnalyticsRegistration.BatteryGlyph),
        };
    }

    /// <summary>Build the presentational <c>DrivingTab</c> model from a resolved snapshot (web <c>data.drive_analytics</c>).</summary>
    /// <param name="snapshot">The parsed fleet snapshot.</param>
    /// <returns>A ready model with the driving analytics, or the empty model when absent.</returns>
    public static DrivingTabModel BuildDrivingModel(AnalyticsFleetSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return snapshot.Driving is { } analytics ? DrivingTabModel.Ready(analytics) : DrivingTabModel.Empty;
    }

    /// <summary>Build the presentational <c>BatteryTab</c> model from a resolved snapshot (web <c>data.battery_trend</c>).</summary>
    /// <param name="snapshot">The parsed fleet snapshot.</param>
    /// <returns>A resolved (non-loading) model carrying the battery trend rows.</returns>
    public static BatteryTabModel BuildBatteryModel(AnalyticsFleetSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return new BatteryTabModel(false, snapshot.BatteryTrend);
    }

    private static AnalyticsTabItem Tab(AnalyticsTabKey key, string label, string glyph) =>
        new(key, label, glyph, label);
}
