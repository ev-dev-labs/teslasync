using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state the <see cref="QuickMetricsViewModel"/> can be in — the native superset of the web
/// <c>QuickMetrics</c> (web/src/features/charging/components/charging-list/QuickMetrics.tsx). The web component
/// is presentational: its parent <c>ChargingListPage</c> owns the charging-sessions query and passes the
/// computed <c>ChargingStats | null</c> down, rendering the six-metric grid when stats are present and an
/// <c>EmptyState</c> when they are not. This self-contained surface additionally renders that query's lifecycle
/// as explicit loading / ready / empty / stale / offline / error branches so no surface is ever hidden.
/// <see cref="Empty"/> mirrors the web's <c>stats ? … : &lt;EmptyState/&gt;</c> gate (no charging sessions, so
/// <c>computeStats</c> returns null).
/// </summary>
public enum QuickMetricsState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) stats snapshot with at least one session.</summary>
    Ready,

    /// <summary>No vehicle resolved, or no charging sessions — render the empty state.</summary>
    Empty,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,
}

/// <summary>
/// The coarse charger category — the native analogue of the web <c>ChargerCategory</c>
/// (web/src/lib/chargingAggregation.ts). <see cref="QuickMetricsCompute.Categorize"/> ports
/// <c>getChargerCategory</c> exactly so the home / supercharger / DC counts match the web grid cell-for-cell.
/// </summary>
public enum QuickMetricsChargerCategory
{
    /// <summary>Home / AC charging (a null charger type historically means home AC).</summary>
    Home,

    /// <summary>A Tesla Supercharger (charger type contains "super" or "tpc").</summary>
    Supercharger,

    /// <summary>Third-party DC fast charging (charger type contains dc / ccs / chademo / fast).</summary>
    Dc,

    /// <summary>A charger type that matches none of the known buckets.</summary>
    Unknown,
}

/// <summary>
/// One charging session reduced to exactly the fields the web <c>computeStats</c> reads
/// (web/src/features/charging/components/charging-list/helpers.ts). Field names mirror the Go API's snake_case
/// JSON tags; parsing is null-tolerant so a partial row never throws. <see cref="EnergyWh"/> is the SI energy
/// added in watt-hours (web <c>total_energy_added_wh</c>) and <see cref="PeakPowerW"/> the SI peak power in
/// watts (web <c>peak_power_w</c>).
/// </summary>
public sealed record QuickMetricsSession(
    double EnergyWh,
    double? Cost,
    string? ChargerType,
    double? PeakPowerW,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<QuickMetricsSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<QuickMetricsSession>();
        }

        var list = new List<QuickMetricsSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static QuickMetricsSession FromJson(JsonElement obj) =>
        new(
            EnergyWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
            Cost: GetDouble(obj, "cost_decimal"),
            ChargerType: GetString(obj, "charger_type"),
            PeakPowerW: GetDouble(obj, "peak_power_w"),
            StartedAt: GetDate(obj, "started_at"),
            EndedAt: GetDate(obj, "ended_at"));

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return v.TryGetDateTimeOffset(out var dto) ? dto : null;
    }
}

/// <summary>
/// The aggregate charging statistics — the native analogue of the web <c>ChargingStats</c>
/// (web/src/features/charging/components/charging-list/helpers.ts). <see cref="TotalEnergyKwh"/> and
/// <see cref="AvgPowerKw"/> are already converted out of SI (kWh / kW) to match the web's
/// <c>convertEnergyFromSI</c> / <c>convertPowerFromSI</c> calls. The web <c>computeStats</c> returns null for an
/// empty session list; the native compute returns a zeroed value whose <see cref="IsEmpty"/> flag carries that
/// same "nothing to show" meaning, so the mapper always has a value to flow through the cache-then-network
/// states. Pure data so the computation is unit-tested without a UI host.
/// </summary>
public sealed record QuickMetricsStats(
    double TotalEnergyKwh,
    double TotalCost,
    double TotalDurationMinutes,
    double AvgPowerKw,
    double AvgCostPerKwh,
    long HomeCount,
    long ScCount,
    long DcCount,
    long Count)
{
    /// <summary>The all-zero stats (the native analogue of the web's <c>computeStats</c> returning null).</summary>
    public static QuickMetricsStats Zero { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>True when there are no sessions (web parity for <c>computeStats</c> returning null).</summary>
    public bool IsEmpty => Count == 0;
}

/// <summary>
/// Pure computation from a charging-session list to its <see cref="QuickMetricsStats"/> — a faithful port of the
/// web <c>computeStats</c> + <c>getChargerCategory</c> + <c>durationMinutes</c> helpers
/// (web/src/features/charging/components/charging-list/helpers.ts, lib/chargingAggregation.ts and
/// charging-curve/helpers.ts). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QuickMetricsCompute
{
    /// <summary>Compute the aggregate stats over <paramref name="sessions"/> (web <c>computeStats</c>).</summary>
    public static QuickMetricsStats Compute(IReadOnlyList<QuickMetricsSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        if (sessions.Count == 0)
        {
            // Web parity: computeStats returns null for an empty list; we carry that as the zeroed value.
            return QuickMetricsStats.Zero;
        }

        double totalEnergyWh = 0;
        double totalCost = 0;
        double totalDuration = 0;
        double powerSumW = 0;
        long withPowerCount = 0;
        long homeCount = 0;
        long scCount = 0;
        long dcCount = 0;

        foreach (var s in sessions)
        {
            totalEnergyWh += s.EnergyWh;
            totalCost += s.Cost ?? 0;
            totalDuration += DurationMinutes(s.StartedAt, s.EndedAt);

            // Web parity: `sessions.filter(s => s.peak_power_w)` keeps truthy (non-null, non-zero) powers.
            if (s.PeakPowerW is { } power && power != 0)
            {
                powerSumW += power;
                withPowerCount++;
            }

            switch (Categorize(s.ChargerType))
            {
                case QuickMetricsChargerCategory.Home:
                    homeCount++;
                    break;
                case QuickMetricsChargerCategory.Supercharger:
                    scCount++;
                    break;
                case QuickMetricsChargerCategory.Dc:
                    dcCount++;
                    break;
                default:
                    break;
            }
        }

        double totalEnergyKwh = totalEnergyWh / 1000.0;                       // web convertEnergyFromSI(_, 'kWh')
        double avgPowerKw = powerSumW / Math.Max(withPowerCount, 1) / 1000.0; // web convertPowerFromSI(_, 'kW')
        double avgCostPerKwh = totalEnergyKwh > 0 ? totalCost / totalEnergyKwh : 0;

        return new QuickMetricsStats(
            TotalEnergyKwh: totalEnergyKwh,
            TotalCost: totalCost,
            TotalDurationMinutes: totalDuration,
            AvgPowerKw: avgPowerKw,
            AvgCostPerKwh: avgCostPerKwh,
            HomeCount: homeCount,
            ScCount: scCount,
            DcCount: dcCount,
            Count: sessions.Count);
    }

    /// <summary>
    /// Map a raw <c>charger_type</c> into a coarse category — a faithful port of the web
    /// <c>getChargerCategory</c> (lib/chargingAggregation.ts), including its lower-cased substring rules and the
    /// "a null type historically means home AC" default.
    /// </summary>
    public static QuickMetricsChargerCategory Categorize(string? chargerType)
    {
        if (string.IsNullOrEmpty(chargerType))
        {
            return QuickMetricsChargerCategory.Home;
        }

        string t = chargerType.ToLowerInvariant();

        if (t.Contains("super", StringComparison.Ordinal) || t.Contains("tpc", StringComparison.Ordinal))
        {
            return QuickMetricsChargerCategory.Supercharger;
        }

        if (t.Contains("dc", StringComparison.Ordinal)
            || t.Contains("ccs", StringComparison.Ordinal)
            || t.Contains("chademo", StringComparison.Ordinal)
            || t.Contains("fast", StringComparison.Ordinal))
        {
            return QuickMetricsChargerCategory.Dc;
        }

        if (t.Contains("home", StringComparison.Ordinal)
            || t.Contains("ac", StringComparison.Ordinal)
            || t.Contains("wall", StringComparison.Ordinal))
        {
            return QuickMetricsChargerCategory.Home;
        }

        return QuickMetricsChargerCategory.Unknown;
    }

    /// <summary>
    /// Duration between the two timestamps in whole minutes — port of the web <c>durationMinutes</c>
    /// (charging-curve/helpers.ts): 0 when the session has no end, the timestamps are unparseable, or the end is
    /// not after the start; otherwise the elapsed milliseconds rounded (half away from zero, matching JS
    /// <c>Math.round</c>) to minutes.
    /// </summary>
    public static double DurationMinutes(DateTimeOffset? started, DateTimeOffset? ended)
    {
        if (started is not { } start || ended is not { } end)
        {
            return 0;
        }

        double milliseconds = (end - start).TotalMilliseconds;
        if (milliseconds <= 0)
        {
            return 0;
        }

        return Math.Round(milliseconds / 60_000.0, MidpointRounding.AwayFromZero);
    }
}

/// <summary>
/// One projected metric cell — the native analogue of one of the web grid's six <c>&lt;div&gt;</c> cells (value
/// over label). <see cref="ValueText"/> is pre-formatted exactly as the web renders it. <see cref="Animated"/>
/// cells (the three session counts, web <c>&lt;AnimatedNumber/&gt;</c>) carry their <see cref="NumericValue"/>
/// so the view can count up to it; the rest render <see cref="ValueText"/> verbatim. <see cref="Accent"/> is the
/// semantic colour (null → primary text, web <c>--text-primary</c>) and <see cref="Glyph"/> the leading icon
/// (empty when none). Pure data.
/// </summary>
public sealed record QuickMetricsMetric(
    string Label,
    StatusKind? Accent,
    string Glyph,
    bool Animated,
    double NumericValue,
    string ValueText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the QuickMetrics grid — the native analogue of everything the web
/// component renders. Pure data so every branch is asserted headlessly. <see cref="HasData"/> is false for the
/// loading / empty / hard-error scaffold (web <c>EmptyState</c>).
/// </summary>
public sealed record QuickMetricsDisplay(bool HasData, IReadOnlyList<QuickMetricsMetric> Metrics)
{
    /// <summary>The all-empty display (loading / no-data scaffold).</summary>
    public static QuickMetricsDisplay Empty { get; } = new(false, Array.Empty<QuickMetricsMetric>());
}

/// <summary>
/// Pure projection from a <see cref="QuickMetricsStats"/> to its render-ready <see cref="QuickMetricsDisplay"/> —
/// the native port of web/src/features/charging/components/charging-list/QuickMetrics.tsx. The number formatting
/// mirrors the web helpers exactly:
/// <list type="bullet">
/// <item>the three counts use the web <c>&lt;AnimatedNumber/&gt;</c> (which renders <c>fmtNumber(value, 0)</c>);</item>
/// <item>Total Time uses the web <c>formatDuration</c> (<c>{h}h {m}m</c> / <c>{m}m</c>, em-dash when invalid);</item>
/// <item>Monthly Avg uses the web <c>&lt;Currency precision={0}/&gt;</c> over <c>totalCost / 12</c>
/// (<c>{symbol}{x,0dp}</c>, em-dash when non-finite);</item>
/// <item>Per Session uses the web <c>fmtWithUnit(totalEnergy / count, 'kWh')</c> (<c>{x,2dp} kWh</c>).</item>
/// </list>
/// Every label resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QuickMetricsProjection
{
    /// <summary>Em-dash shown for an absent value (web parity '—' / <c>FALLBACK</c>).</summary>
    public const string EmDash = "\u2014";

    private const string UnitKwh = "kWh";

    // The web's global number precision (numberFormat.ts `_globalPrecision`) used by fmtNumber / fmtWithUnit.
    private const int DefaultPrecision = 2;

    /// <summary>Web <c>safeNumber</c>: a finite number passes through, anything else becomes 0.</summary>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>Format a number with en-US grouping at <paramref name="decimals"/> places (web <c>fmtNumber</c>).</summary>
    public static string FormatNumber(double value, int decimals) =>
        NumberFormatting.Format(Safe(value), null, decimals);

    /// <summary>Render an integer count exactly as the web <c>&lt;AnimatedNumber/&gt;</c> does (<c>fmtNumber(n, 0)</c>).</summary>
    public static string FormatCount(long count) => FormatNumber(count, 0);

    /// <summary>Format a minutes duration as <c>{h}h {m}m</c> / <c>{m}m</c> (web <c>formatDurationMinutes</c>).</summary>
    public static string FormatDuration(double minutes)
    {
        if (!double.IsFinite(minutes) || minutes < 0)
        {
            return EmDash;
        }

        long h = (long)Math.Floor(minutes / 60.0);
        long m = (long)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);
        return h > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.InvariantCulture, $"{m}m");
    }

    /// <summary>
    /// Format a currency amount as <c>{symbol}{x,Ndp}</c>, or the em-dash when non-finite (web <c>Currency</c>,
    /// whose fallback for a null / NaN value is '—').
    /// </summary>
    public static string FormatCurrency(double value, string symbol, int precision) =>
        double.IsFinite(value) ? symbol + FormatNumber(value, precision) : EmDash;

    /// <summary>Format an energy figure in kWh (web <c>fmtWithUnit(value, 'kWh')</c> at the global 2-dp precision).</summary>
    public static string FormatEnergyKwh(double value) => $"{FormatNumber(value, DefaultPrecision)} {UnitKwh}";

    /// <summary>Project <paramref name="stats"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="stats">The computed stats, or null while loading / on a hard failure.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static QuickMetricsDisplay Project(QuickMetricsStats? stats, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: the grid renders only when computeStats produced stats (i.e. at least one session).
        if (stats is null || stats.IsEmpty)
        {
            return QuickMetricsDisplay.Empty;
        }

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? QuickMetricsRegistration.DefaultCurrencySymbol
            : currencySymbol;

        // Web: stats.totalCost / 12 (Monthly Avg) and stats.totalEnergy / stats.count (Per Session).
        double monthlyAvg = stats.TotalCost / 12.0;
        double perSession = stats.Count > 0 ? stats.TotalEnergyKwh / stats.Count : 0;

        var metrics = new List<QuickMetricsMetric>(6)
        {
            CountMetric(
                QuickMetricsRegistration.HomeLabel(localizer),
                StatusKind.Success,
                QuickMetricsRegistration.HomeGlyph,
                stats.HomeCount),
            CountMetric(
                QuickMetricsRegistration.SuperchargerLabel(localizer),
                StatusKind.Danger,
                QuickMetricsRegistration.BoltGlyph,
                stats.ScCount),
            CountMetric(
                QuickMetricsRegistration.DcFastLabel(localizer),
                StatusKind.Warning,
                QuickMetricsRegistration.ZapGlyph,
                stats.DcCount),
            TextMetric(
                QuickMetricsRegistration.TotalTimeLabel(localizer),
                FormatDuration(stats.TotalDurationMinutes)),
            TextMetric(
                QuickMetricsRegistration.MonthlyAvgLabel(localizer),
                FormatCurrency(monthlyAvg, symbol, 0)),
            TextMetric(
                QuickMetricsRegistration.PerSessionLabel(localizer),
                FormatEnergyKwh(perSession)),
        };

        return new QuickMetricsDisplay(HasData: true, Metrics: metrics);
    }

    private static QuickMetricsMetric CountMetric(string label, StatusKind accent, string glyph, long value)
    {
        string text = FormatCount(value);
        return new QuickMetricsMetric(
            Label: label,
            Accent: accent,
            Glyph: glyph,
            Animated: true,
            NumericValue: value,
            ValueText: text,
            AutomationName: $"{label}: {text}");
    }

    private static QuickMetricsMetric TextMetric(string label, string value) =>
        new(
            Label: label,
            Accent: null,
            Glyph: string.Empty,
            Animated: false,
            NumericValue: 0,
            ValueText: value,
            AutomationName: $"{label}: {value}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto computed
/// <c>RepositoryResult&lt;QuickMetricsStats&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Parsing the sessions and running
/// <see cref="QuickMetricsCompute.Compute"/> happens here so the view never sees raw JSON. Kept pure so the
/// parse-compute-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class QuickMetricsResultMapper
{
    /// <summary>Parse and compute <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<QuickMetricsStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        QuickMetricsStats Compute() =>
            QuickMetricsCompute.Compute(raw.HasValue ? QuickMetricsSession.ParseList(raw.Value) : Array.Empty<QuickMetricsSession>());

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<QuickMetricsStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<QuickMetricsStats>.Cached(Compute(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<QuickMetricsStats>.Refreshing(Compute(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<QuickMetricsStats>.Loaded(Compute(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<QuickMetricsStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<QuickMetricsStats>.OfflineCached(Compute(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<QuickMetricsStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The registry metadata, i18n keys and glyphs for the QuickMetrics surface. Every web <c>t()</c> call in
/// QuickMetrics.tsx maps to a <c>GetString</c> here (so the keys are asserted in tests and resolved for real in
/// the app); native-superset chrome (loading / stale / offline / retry) reuses the shared <c>common.*</c> and
/// <c>charging.*</c> catalog keys where they exist and falls back to English for the rest, exactly as the i18n
/// facade contract guarantees.
/// </summary>
public static class QuickMetricsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "QuickMetrics";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "Home" glyph — native stand-in for the web Lucide <c>Home</c> icon.</summary>
    public const string HomeGlyph = "\uE80F";

    /// <summary>Segoe Fluent "LightningBolt" glyph — native stand-in for the web Lucide <c>Bolt</c> icon.</summary>
    public const string BoltGlyph = "\uE945";

    /// <summary>Segoe Fluent "LightningBolt" glyph — native stand-in for the web Lucide <c>Zap</c> icon.</summary>
    public const string ZapGlyph = "\uE945";

    // ── Grid metric labels (web charging.metrics.* keys) ─────────────────────────────────────────────────

    /// <summary>"Home" metric label (web <c>charging.metrics.home</c>).</summary>
    public static string HomeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.home", "Home");

    /// <summary>"Supercharger" metric label (web <c>charging.metrics.supercharger</c>).</summary>
    public static string SuperchargerLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.supercharger", "Supercharger");

    /// <summary>"DC Fast" metric label (web <c>charging.metrics.dcFast</c>).</summary>
    public static string DcFastLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.dcFast", "DC Fast");

    /// <summary>"Total Time" metric label (web <c>charging.metrics.totalTime</c>).</summary>
    public static string TotalTimeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.totalTime", "Total Time");

    /// <summary>"Monthly Avg" metric label (web <c>charging.metrics.monthlyAvg</c>).</summary>
    public static string MonthlyAvgLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.monthlyAvg", "Monthly Avg");

    /// <summary>"Per Session" metric label (web <c>charging.metrics.perSession</c>).</summary>
    public static string PerSessionLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.perSession", "Per Session");

    // ── Surface title + empty (web charging.noMetrics key + native-superset chrome) ──────────────────────

    /// <summary>The accessible surface title (native superset; web reuses the page's "Quick Metrics" heading).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.title", "Quick Metrics");

    /// <summary>Whole-surface empty message (web <c>charging.noMetrics</c>).</summary>
    public static string EmptyText(ILocalizer localizer) =>
        Require(localizer).GetString("charging.noMetrics", "No charging metrics available yet");

    // ── Surface chrome (native superset; the web parent owns the query lifecycle) ────────────────────────

    /// <summary>Loading announcement label (native superset).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading\u2026");

    /// <summary>Stale freshness chip label (native superset).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.stats.stale", "Stale");

    /// <summary>Offline freshness chip label (native superset).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>Hard-error message (native superset; the web parent renders QueryError).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("charging.metrics.error", "Couldn't load charging metrics");

    /// <summary>Offline message shown alongside the cached content (native superset).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "charging.metrics.offlineMessage",
            "You're offline — showing the last cached charging metrics");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the QuickMetrics surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, energy figure or cost —
/// so a diagnostics line can never leak charging data. Thread-safe.
/// </summary>
public sealed class QuickMetricsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public QuickMetricsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickMetrics</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuickMetricsRegistration.Slug}");
    }
}
