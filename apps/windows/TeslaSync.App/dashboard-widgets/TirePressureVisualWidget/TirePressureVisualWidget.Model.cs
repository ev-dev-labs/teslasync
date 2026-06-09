using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="TirePressureVisualViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>TirePressureVisualWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx). Every branch
/// maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{tireData ? … : &lt;EmptyState&gt;}</c> gate — the response carried no tire-pressure object — the
/// "No tire pressure data" surface.
/// </summary>
public enum TirePressureVisualState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a tire-pressure object to render the diagram for.</summary>
    Loaded,

    /// <summary>No tire-pressure object in the response — render the "No tire pressure data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the diagram plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the diagram plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The colour band a single tire's pressure falls into — the native union of the web
/// <c>'green' | 'amber' | 'red'</c> returned by <c>getPressureStatus</c>
/// (web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx). <see cref="Green"/> is the normal band,
/// <see cref="Amber"/> the soft warning band, <see cref="Red"/> the danger band (and the band a missing reading
/// collapses to, mirroring the web <c>if (bar == null) return 'red'</c>).
/// </summary>
public enum TirePressureLevel
{
    /// <summary>Normal pressure (web <c>'green'</c>).</summary>
    Green,

    /// <summary>Soft warning — outside the comfortable band but not dangerous (web <c>'amber'</c>).</summary>
    Amber,

    /// <summary>Danger — outside the safe band, or no reading at all (web <c>'red'</c>).</summary>
    Red,
}

/// <summary>
/// The fields the tire diagram reads from <c>GET /tire-pressure/latest?vehicle_id={id}</c> — the native mirror
/// of the exact <c>TirePressureSnapshot</c> slice the web widget consumes (web/src/api/types.ts): the four raw
/// corner pressures (<c>front_left</c> / <c>front_right</c> / <c>rear_left</c> / <c>rear_right</c>) and the four
/// per-corner last-seen timestamps (<c>last_seen_time_fl</c> / <c>_fr</c> / <c>_rl</c> / <c>_rr</c>). Those exact
/// wire names are read here verbatim so the native surface reproduces the web's observable output. A
/// <see langword="null"/> parse result models the web <c>tireData</c> being null/undefined (no tire object → the
/// empty surface); a missing or null numeric corner parses to <see langword="null"/> so the corner renders the
/// em-dash value and the danger colour, exactly like the web <c>?? null</c> guards.
/// </summary>
/// <param name="FrontLeft">Front-left raw pressure, or null (web <c>front_left</c>).</param>
/// <param name="FrontRight">Front-right raw pressure, or null (web <c>front_right</c>).</param>
/// <param name="RearLeft">Rear-left raw pressure, or null (web <c>rear_left</c>).</param>
/// <param name="RearRight">Rear-right raw pressure, or null (web <c>rear_right</c>).</param>
/// <param name="LastSeenFrontLeft">Front-left last-seen ISO timestamp, or null (web <c>last_seen_time_fl</c>).</param>
/// <param name="LastSeenFrontRight">Front-right last-seen ISO timestamp, or null (web <c>last_seen_time_fr</c>).</param>
/// <param name="LastSeenRearLeft">Rear-left last-seen ISO timestamp, or null (web <c>last_seen_time_rl</c>).</param>
/// <param name="LastSeenRearRight">Rear-right last-seen ISO timestamp, or null (web <c>last_seen_time_rr</c>).</param>
public sealed record TirePressureReading(
    double? FrontLeft,
    double? FrontRight,
    double? RearLeft,
    double? RearRight,
    string? LastSeenFrontLeft,
    string? LastSeenFrontRight,
    string? LastSeenRearLeft,
    string? LastSeenRearRight)
{
    /// <summary>
    /// Project a <c>GET /tire-pressure/latest</c> response into the tire slice. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>tireData</c> being null
    /// (the empty surface). Any object yields a reading (matching the web's truthy <c>tireData ?</c> gate);
    /// individual absent/null corners parse to <see langword="null"/> so a partial body never throws and each
    /// corner independently renders the em dash plus the danger colour, exactly like the web's per-corner
    /// <c>?? null</c> handling.
    /// </summary>
    public static TirePressureReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TirePressureReading(
            FrontLeft: ReadDouble(root, "front_left"),
            FrontRight: ReadDouble(root, "front_right"),
            RearLeft: ReadDouble(root, "rear_left"),
            RearRight: ReadDouble(root, "rear_right"),
            LastSeenFrontLeft: ReadString(root, "last_seen_time_fl"),
            LastSeenFrontRight: ReadString(root, "last_seen_time_fr"),
            LastSeenRearLeft: ReadString(root, "last_seen_time_rl"),
            LastSeenRearRight: ReadString(root, "last_seen_time_rr"));
    }

    private static double? ReadDouble(JsonElement obj, string name)
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

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>TirePressureVisualWidget</c> drops its title when <c>size.cols &lt;= 1</c> (the <c>isCompact</c> branch);
/// the registry's 2×4 minimum means that branch never triggers in practice, but <see cref="IsCompact"/>
/// reproduces the rule faithfully.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct TirePressureVisualSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static TirePressureVisualSize Default => new(2, 4);

    /// <summary>True when the title is dropped (web <c>const isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One fully projected corner of the tire diagram — the native analogue of a web <c>TireInfo</c> plus its
/// rendered value string. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">Localized corner label ("FL" / "FR" / "RL" / "RR").</param>
/// <param name="Level">The colour band the corner's pressure falls into (web <c>getPressureStatus</c>).</param>
/// <param name="ValueText">Pre-formatted display pressure (e.g. "2.4") or the em dash for a missing reading.</param>
/// <param name="Status">The semantic status the <see cref="Level"/> maps to (drives the corner tint).</param>
public sealed record TirePressureCorner(
    string Label,
    TirePressureLevel Level,
    string ValueText,
    StatusKind Status);

/// <summary>
/// The fully projected, render-ready view of the tire surface for one unit preference — the native analogue of
/// everything the web component computes before returning JSX (the four colour-coded corner values, the overall
/// status badge, the unit suffix and the most-recent-reading time). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="FrontLeft">Front-left corner (top-left of the diagram).</param>
/// <param name="FrontRight">Front-right corner (top-right of the diagram).</param>
/// <param name="RearLeft">Rear-left corner (bottom-left of the diagram).</param>
/// <param name="RearRight">Rear-right corner (bottom-right of the diagram).</param>
/// <param name="AllNormal">Whether every corner is in the green band (web <c>allNormal</c>).</param>
/// <param name="BadgeStatus">The badge's semantic status (web <c>allNormal ? 'success' : hasWarning ? 'warning' : 'danger'</c>).</param>
/// <param name="BadgeText">Localized badge label ("All Normal" or "Check Pressure").</param>
/// <param name="UnitLabel">The user's pressure unit suffix (web <c>pressureUnit</c>): "kPa" / "psi" / "bar".</param>
/// <param name="ReadingText">The most-recent reading time, e.g. "5m ago" / "Just now" / "No reading".</param>
/// <param name="FooterText">The footer line: the unit suffix, a middle dot, then the reading time.</param>
/// <param name="AutomationName">Narrator name summarising the four corners, the unit and the badge.</param>
public sealed record TirePressureDisplay(
    TirePressureCorner FrontLeft,
    TirePressureCorner FrontRight,
    TirePressureCorner RearLeft,
    TirePressureCorner RearRight,
    bool AllNormal,
    StatusKind BadgeStatus,
    string BadgeText,
    string UnitLabel,
    string ReadingText,
    string FooterText,
    string AutomationName)
{
    /// <summary>The four corners in diagram order (front-left, front-right, rear-left, rear-right).</summary>
    public IReadOnlyList<TirePressureCorner> Corners => new[] { FrontLeft, FrontRight, RearLeft, RearRight };
}

/// <summary>
/// Pure projection from a raw <see cref="TirePressureReading"/> to the display model — the native port of the
/// web component's inline logic in web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx.
/// </summary>
/// <remarks>
/// Web-parity note on the two readings of each raw corner value: the web feeds the SAME raw
/// <c>tireData.front_left</c> (etc.) into <c>getPressureStatus</c>, whose thresholds are expressed in bar
/// (<c>2.068 … 3.103</c>), AND into <c>toPressureValue</c> = <c>convertPressureFromSI(value, pressureUnit)</c>,
/// whose input contract is SI kilopascals. This surface reproduces both readings on the same raw value verbatim —
/// the colour band via <see cref="Level"/> against the bar thresholds and the display string via
/// <see cref="FormatPressure"/> through the SI→preference converter — so the native output matches the web's
/// observable output exactly. It deliberately does not reconcile the two; doing so would diverge from the source
/// of truth.
/// </remarks>
public static class TirePressureVisualProjection
{
    /// <summary>Lower danger bound in bar (web <c>THRESHOLD.dangerLow</c>).</summary>
    public const double DangerLow = 2.068;

    /// <summary>Lower warning bound in bar (web <c>THRESHOLD.warnLow</c>).</summary>
    public const double WarnLow = 2.275;

    /// <summary>Upper warning bound in bar (web <c>THRESHOLD.warnHigh</c>).</summary>
    public const double WarnHigh = 2.896;

    /// <summary>Upper danger bound in bar (web <c>THRESHOLD.dangerHigh</c>).</summary>
    public const double DangerHigh = 3.103;

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Per-corner display fraction digits (web <c>fmtNumber(v, 1)</c>).</summary>
    public const int PressurePrecision = 1;

    /// <summary>The middle-dot separator the web footer renders between the unit and the time (web <c>·</c>).</summary>
    public const string FooterSeparator = " \u00B7 ";

    /// <summary>Segoe Fluent "CircleRing" glyph — the web <c>CircleDot</c> header / empty-surface icon.</summary>
    public const string CircleGlyph = "\uEA3A";

    /// <summary>Minutes-per-hour, for the relative-time roll-up (web <c>diffMin / 60</c>).</summary>
    private const double MinutesPerHour = 60.0;

    /// <summary>Hours-per-day, for the relative-time roll-up (web <c>diffHrs / 24</c>).</summary>
    private const double HoursPerDay = 24.0;

    /// <summary>
    /// Classify a raw corner pressure into its colour band — the native port of the web <c>getPressureStatus</c>.
    /// A missing reading is <see cref="TirePressureLevel.Red"/> (web <c>if (bar == null) return 'red'</c>); a value
    /// below <see cref="DangerLow"/> or above <see cref="DangerHigh"/> is red; below <see cref="WarnLow"/> or above
    /// <see cref="WarnHigh"/> is amber; otherwise green. The thresholds are compared against the raw value exactly
    /// as the web does (see the class remarks on the two readings of the raw value).
    /// </summary>
    public static TirePressureLevel Level(double? raw)
    {
        if (raw is not { } bar || double.IsNaN(bar))
        {
            return TirePressureLevel.Red;
        }

        if (bar < DangerLow || bar > DangerHigh)
        {
            return TirePressureLevel.Red;
        }

        if (bar < WarnLow || bar > WarnHigh)
        {
            return TirePressureLevel.Amber;
        }

        return TirePressureLevel.Green;
    }

    /// <summary>Map a colour band to its semantic status (green→success, amber→warning, red→danger).</summary>
    public static StatusKind LevelToStatus(TirePressureLevel level) => level switch
    {
        TirePressureLevel.Green => StatusKind.Success,
        TirePressureLevel.Amber => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>
    /// Format a raw corner pressure for display the way the web does — null / non-finite → em dash, otherwise
    /// <c>fmtNumber(convertPressureFromSI(value, pressureUnit), 1)</c> with no unit suffix (the suffix lives in the
    /// footer). The converter's input contract is SI kilopascals (see the class remarks).
    /// </summary>
    public static string FormatPressure(double? raw, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (raw is not { } value || double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        double display = UnitConverters.PressureFromSi(value, units.Pressure);
        return ScalarFormatters.FormatNumber(display, PressurePrecision);
    }

    /// <summary>
    /// Format the most-recent reading time relative to <paramref name="now"/> — the native port of the web
    /// <c>formatTimestamp</c>: no timestamp → "No reading"; unparseable → em dash; under a minute → "Just now";
    /// under an hour → "Nm ago"; under a day → "Nh ago"; otherwise "Nd ago". Every label resolves through the
    /// i18n facade.
    /// </summary>
    public static string FormatReadingTime(string? iso, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (string.IsNullOrEmpty(iso))
        {
            return localizer.GetString("widget.tireNoReading", "No reading");
        }

        if (!DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date))
        {
            return EmDash;
        }

        // Web parity: diffMin = Math.round((now - date) / 60_000). For the positive ranges that reach the
        // branches below, away-from-zero matches ECMAScript's round-half-up; a future timestamp yields a
        // sub-1 result and so resolves to "Just now", exactly like the web.
        long diffMin = (long)Math.Round((now - date).TotalMinutes, MidpointRounding.AwayFromZero);
        if (diffMin < 1)
        {
            return localizer.GetString("widget.tireJustNow", "Just now");
        }

        string ago = localizer.GetString("widget.ago", "ago");
        if (diffMin < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{diffMin}m {ago}");
        }

        long diffHrs = (long)Math.Round(diffMin / MinutesPerHour, MidpointRounding.AwayFromZero);
        if (diffHrs < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{diffHrs}h {ago}");
        }

        long diffDays = (long)Math.Round(diffHrs / HoursPerDay, MidpointRounding.AwayFromZero);
        return string.Create(CultureInfo.InvariantCulture, $"{diffDays}d {ago}");
    }

    /// <summary>
    /// The most-recent of the four corner last-seen timestamps — the native port of the web
    /// <c>[fl, fr, rl, rr].filter(Boolean).sort().pop()</c>: drop empties, order ordinally (ISO-8601 sorts
    /// chronologically), take the largest. Returns <see langword="null"/> when no corner carries a timestamp.
    /// </summary>
    public static string? LatestReadingTime(TirePressureReading reading)
    {
        ArgumentNullException.ThrowIfNull(reading);
        string? latest = null;
        foreach (var candidate in new[]
                 {
                     reading.LastSeenFrontLeft,
                     reading.LastSeenFrontRight,
                     reading.LastSeenRearLeft,
                     reading.LastSeenRearRight,
                 })
        {
            if (string.IsNullOrEmpty(candidate))
            {
                continue;
            }

            if (latest is null || string.CompareOrdinal(candidate, latest) > 0)
            {
                latest = candidate;
            }
        }

        return latest;
    }

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> at <paramref name="now"/> using the localizer for every label.</summary>
    public static TirePressureDisplay Project(
        TirePressureReading reading,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var frontLeft = Corner(localizer.GetString("widget.tireFL", "FL"), reading.FrontLeft, units);
        var frontRight = Corner(localizer.GetString("widget.tireFR", "FR"), reading.FrontRight, units);
        var rearLeft = Corner(localizer.GetString("widget.tireRL", "RL"), reading.RearLeft, units);
        var rearRight = Corner(localizer.GetString("widget.tireRR", "RR"), reading.RearRight, units);

        var corners = new[] { frontLeft, frontRight, rearLeft, rearRight };
        bool allNormal = corners.All(c => c.Level == TirePressureLevel.Green);
        bool hasWarning = corners.Any(c => c.Level != TirePressureLevel.Green);

        // Web parity: variant={allNormal ? 'success' : hasWarning ? 'warning' : 'danger'}.
        StatusKind badgeStatus = allNormal
            ? StatusKind.Success
            : hasWarning ? StatusKind.Warning : StatusKind.Danger;
        string badgeText = allNormal
            ? localizer.GetString("widget.tireAllNormal", "All Normal")
            : localizer.GetString("widget.tireWarning", "Check Pressure");

        string unitLabel = UnitLabels.Label(units.Pressure);
        string readingText = FormatReadingTime(LatestReadingTime(reading), now, localizer);
        string footer = unitLabel + FooterSeparator + readingText;
        string automation = BuildAutomationName(corners, unitLabel, badgeText);

        return new TirePressureDisplay(
            FrontLeft: frontLeft,
            FrontRight: frontRight,
            RearLeft: rearLeft,
            RearRight: rearRight,
            AllNormal: allNormal,
            BadgeStatus: badgeStatus,
            BadgeText: badgeText,
            UnitLabel: unitLabel,
            ReadingText: readingText,
            FooterText: footer,
            AutomationName: automation);
    }

    private static TirePressureCorner Corner(string label, double? raw, UnitPref units)
    {
        var level = Level(raw);
        return new TirePressureCorner(label, level, FormatPressure(raw, units), LevelToStatus(level));
    }

    private static string BuildAutomationName(TirePressureCorner[] corners, string unitLabel, string badgeText)
    {
        var parts = new List<string>(corners.Length + 1);
        foreach (var corner in corners)
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{corner.Label} {corner.ValueText} {unitLabel}"));
        }

        parts.Add(badgeText);
        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TirePressureReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no tire-pressure object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{tireData ? … : empty}</c> gate.
/// Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TirePressureVisualResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s tire payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<TirePressureReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        TirePressureReading? Parse() =>
            raw.HasValue ? TirePressureReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TirePressureReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<TirePressureReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<TirePressureReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<TirePressureReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<TirePressureReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<TirePressureReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<TirePressureReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
