using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DriveScoreGaugeViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DriveScoreGaugeWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{score ? gauge : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle / no usable score in the response) — the "No score yet" surface.
/// </summary>
public enum DriveScoreGaugeState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a score to render the gauge for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no score — render the "No score yet" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The weekly driving score the gauge reads from <c>GET /drives/score?vehicle_id={id}</c> — the native mirror
/// of the web <c>DriveScore</c> slice the widget consumes (<c>overall</c>, <c>efficiency</c>,
/// <c>smoothness</c>, <c>speed_discipline</c>, <c>grade</c>; web/src/types/driving.ts). Every numeric field is
/// a 0–100 score (already unit-free) and <see cref="Grade"/> is the backend-computed letter (A+ … F). A
/// <see langword="null"/> parse result models the web <c>score</c> being undefined (no score in the response →
/// the empty surface). Parsing is null-tolerant so a partial body never throws.
/// </summary>
public sealed record DriveScore(
    double Overall,
    double Efficiency,
    double Smoothness,
    double SpeedDiscipline,
    string Grade)
{
    /// <summary>
    /// Project a <c>GET /drives/score</c> response into the score slice. The backend always returns a JSON
    /// object (even with zero completed drives it returns <c>overall:0, grade:"F"</c>), so any object yields a
    /// usable score; a non-object body returns <see langword="null"/> — the native analogue of the web
    /// <c>score</c> being undefined. Reads the snake_case wire shape (<c>speed_discipline</c>) so the camelCase
    /// transform the web client layers on is irrelevant to the parse.
    /// </summary>
    public static DriveScore? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DriveScore(
            Overall: ReadDouble(root, "overall") ?? 0,
            Efficiency: ReadDouble(root, "efficiency") ?? 0,
            Smoothness: ReadDouble(root, "smoothness") ?? 0,
            SpeedDiscipline: ReadDouble(root, "speed_discipline") ?? 0,
            Grade: ReadString(root, "grade") ?? string.Empty);
    }

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static string? ReadString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> flags and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx.
/// </summary>
public readonly record struct DriveScoreGaugeSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static DriveScoreGaugeSize Default => new(1, 2);

    /// <summary>True at exactly one column and one row (web <c>isCompact = cols === 1 &amp;&amp; rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True at two or more rows (web <c>isTall = rows &gt;= 2</c>); gates the per-metric bars.</summary>
    public bool IsTall => Rows >= 2;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// One sub-score (efficiency / smoothness / speed discipline) projected for display — its localized label, its
/// clamped 0–100 value, the formatted value text and the threshold status it colours by. The native analogue
/// of one entry in the web <c>stats</c> array and one <c>MetricBar</c> in the <c>subScores</c> map.
/// </summary>
public sealed record DriveScoreMetric(string Label, double Value, string ValueText, StatusKind Status);

/// <summary>
/// The fully projected, render-ready view of the gauge for one footprint — the native analogue of everything
/// the web component computes before returning JSX (the clamped overall, the threshold colour, the grade
/// caption, the formatted value, the three sub-scores, and the compact/tall layout gates). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record DriveScoreGaugeDisplay(
    double Value,
    double Max,
    string ValueText,
    string Unit,
    string GradeLabel,
    StatusKind Status,
    IReadOnlyList<DriveScoreMetric> Metrics,
    bool IsCompact,
    bool IsTall,
    bool ShowStats,
    bool ShowBars,
    double GaugeDiameter,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="DriveScore"/> to the display model — the native port of the
/// <c>scoreColor</c> helper and the <c>WidgetGaugeHero</c> + <c>MetricBar</c> composition in
/// web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx. Every score is already unit-free (0–100), so
/// this only clamps, formats and colours; every label resolves through the i18n facade.
/// </summary>
public static class DriveScoreGaugeProjection
{
    /// <summary>Segoe Fluent "Speed" glyph for the title row + empty state (web <c>Gauge</c> icon).</summary>
    public const string HeaderGlyph = "\uEC4A";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxScore = 100;

    /// <summary>At or above this overall the score is excellent/green (web <c>scoreColor &gt;= 80</c>).</summary>
    public const double ExcellentThreshold = 80;

    /// <summary>At or above this overall the score is good/cyan (web <c>scoreColor &gt;= 60</c>).</summary>
    public const double GoodThreshold = 60;

    /// <summary>At or above this overall the score is fair/amber (web <c>scoreColor &gt;= 40</c>).</summary>
    public const double FairThreshold = 40;

    /// <summary>The grade caption shown when the backend has no grade yet (web <c>grade ?? '—'</c>).</summary>
    public const string NoGrade = "\u2014";

    /// <summary>
    /// Map a 0–100 score to the semantic status its arc/bar is tinted with (web <c>scoreColor</c>):
    /// &gt;=80 → <see cref="StatusKind.Success"/> (#10B981), &gt;=60 → <see cref="StatusKind.Info"/> (brand
    /// cyan ≈ web #22d3ee), &gt;=40 → <see cref="StatusKind.Warning"/> (#F59E0B), otherwise
    /// <see cref="StatusKind.Danger"/> (#EF4444). The native tokens carry the exact web hexes for the
    /// success/warning/danger bands and the brand cyan for the good band.
    /// </summary>
    public static StatusKind StatusFor(double score)
    {
        double safe = SafeNumber(score);
        if (safe >= ExcellentThreshold)
        {
            return StatusKind.Success;
        }

        if (safe >= GoodThreshold)
        {
            return StatusKind.Info;
        }

        return safe >= FairThreshold ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Project <paramref name="score"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static DriveScoreGaugeDisplay Project(DriveScore score, DriveScoreGaugeSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(score);
        ArgumentNullException.ThrowIfNull(localizer);

        double overall = Math.Clamp(SafeNumber(score.Overall), 0, MaxScore);
        string valueText = FormatValue(overall);
        string unit = localizer.GetString("widget.driveScoreGauge.weekly", "Weekly score");
        string gradeLabel = string.IsNullOrWhiteSpace(score.Grade) ? NoGrade : score.Grade;

        var metrics = new List<DriveScoreMetric>(3)
        {
            Metric("widget.driveScoreGauge.efficiency", "Efficiency", score.Efficiency, localizer),
            Metric("widget.driveScoreGauge.smoothness", "Smoothness", score.Smoothness, localizer),
            Metric("widget.driveScoreGauge.speed", "Speed Discipline", score.SpeedDiscipline, localizer),
        };

        // Web parity: stats render when !compact; the per-metric bars render when isTall (which implies
        // !compact, since compact is exactly 1×1). The grade caption + gauge always render.
        bool showStats = !size.IsCompact;
        bool showBars = size.IsTall && !size.IsCompact;

        string scoreLabel = localizer.GetString("widget.driveScoreGauge.title", "Drive Score");

        return new DriveScoreGaugeDisplay(
            Value: overall,
            Max: MaxScore,
            ValueText: valueText,
            Unit: unit,
            GradeLabel: gradeLabel,
            Status: StatusFor(overall),
            Metrics: metrics,
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            ShowStats: showStats,
            ShowBars: showBars,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: $"{scoreLabel} {valueText}, {gradeLabel}");
    }

    /// <summary>
    /// Format a score value exactly as the web <c>RadialGauge</c>/<c>MetricBar</c> do: integers render with no
    /// fraction digits and non-integers with the global precision (2), using en-US grouping (web
    /// <c>fmtNumber</c>).
    /// </summary>
    public static string FormatValue(double value)
    {
        double safe = SafeNumber(value);
        int decimals = safe == Math.Floor(safe) ? 0 : 2;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }

    private static DriveScoreMetric Metric(string key, string fallback, double value, ILocalizer localizer)
    {
        double clamped = Math.Clamp(SafeNumber(value), 0, MaxScore);
        return new DriveScoreMetric(
            Label: localizer.GetString(key, fallback),
            Value: clamped,
            ValueText: FormatValue(clamped),
            Status: StatusFor(clamped));
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DriveScore&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline). A successful emission whose body carries no usable score collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{score ? gauge : empty}</c>
/// gate. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DriveScoreGaugeResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<DriveScore> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DriveScore? Parse() => raw.HasValue ? DriveScore.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DriveScore>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<DriveScore>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DriveScore>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<DriveScore>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DriveScore>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<DriveScore>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<DriveScore>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<DriveScore>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<DriveScore>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<DriveScore>.Empty(raw.FetchedAt),
            _ => RepositoryResult<DriveScore>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
