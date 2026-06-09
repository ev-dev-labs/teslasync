using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>DriveTimeline</c> surface — the native union of the states the
/// web component can show (web/src/features/driving/components/drive-detail/DriveTimeline.tsx). The web source is
/// a pure presentational component: it takes a single resolved <c>drive</c> prop and performs no fetching, so —
/// exactly like the sibling <c>DriveHighlightSlide</c> port — the parent Drive-detail page owns the query
/// lifecycle (it renders the page-level skeleton / <c>QueryError</c> / empty state once before mounting this
/// strip with an already-resolved drive). There is therefore no fetch-driven loading / error / stale / offline
/// branch to reproduce inside this surface; the only branches are the in-strip <see cref="Ready"/> render (whose
/// completed-vs-in-progress split mirrors the web <c>drive.endTs ? … : t('driveDetail.inProgress')</c> ternary)
/// and the defensive <see cref="Empty"/> stand-in a parent drives directly when no drive is bound. Both branches
/// map onto a visible surface; neither is ever hidden.
/// </summary>
public enum DriveTimelineState
{
    /// <summary>A drive is bound (the web render): the start / duration / end legend and the progress bar.</summary>
    Ready,

    /// <summary>No drive bound — the panel chrome over a friendly stand-in, never a blank box.</summary>
    Empty,
}

/// <summary>
/// The render-time projection of the single drive the timeline reads — the native, WinUI-free mirror of the three
/// <c>DriveDetail</c> fields the web component touches (<c>startTs</c>, <c>endTs</c>, <c>durationS</c> in
/// web/src/types/driving.ts). Field names mirror the Go API's snake_case JSON tags
/// (<c>start_ts</c> / <c>end_ts</c> / <c>duration_s</c> on the <c>/drives/{id}</c> payload) and
/// <see cref="DurationS"/> is SI seconds exactly as the API and the web source keep it, so the strip converts to a
/// "{h}h {m}m" label only at its own display boundary. Parsing is null-tolerant so a partial cached row never
/// throws. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="StartTs">When the drive began (web <c>startTs</c>, API <c>start_ts</c>).</param>
/// <param name="EndTs">When the drive ended (web <c>endTs</c>, API <c>end_ts</c>), or null while in progress.</param>
/// <param name="DurationS">Drive duration in seconds (web <c>durationS</c>, API <c>duration_s</c>, SI).</param>
public sealed record DriveTimelineSnapshot(
    DateTimeOffset StartTs,
    DateTimeOffset? EndTs,
    double DurationS)
{
    /// <summary>
    /// Project a cached drive payload into a snapshot, mirroring the web prop's <c>DriveDetail | null</c> shape: a
    /// JSON <c>null</c> (or any non-object) maps to <see langword="null"/> (the empty strip), otherwise the object
    /// is parsed tolerantly via <see cref="FromJson"/>.
    /// </summary>
    public static DriveTimelineSnapshot? ParseNullable(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? FromJson(element) : null;

    /// <summary>Project a single drive JSON object into a tolerant snapshot.</summary>
    public static DriveTimelineSnapshot FromJson(JsonElement obj) => new(
        GetDateTime(obj, "start_ts") ?? DateTimeOffset.UnixEpoch,
        GetDateTime(obj, "end_ts"),
        GetDouble(obj, "duration_s") ?? 0);

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String when DateTimeOffset.TryParse(
                v.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var dto) => dto,
            JsonValueKind.Number when v.TryGetInt64(out var epoch) => DateTimeOffset.FromUnixTimeSeconds(epoch),
            _ => null,
        };
    }

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
}

/// <summary>
/// The render-time data model the <c>DriveTimeline</c> view binds to — the native analogue of the web
/// <c>Props</c> (<c>{ drive }</c> in web/src/features/driving/components/drive-detail/DriveTimeline.tsx). The
/// component is presentational, so this model carries only the optional <see cref="Drive"/> snapshot: a non-null
/// drive renders the timeline, a null drive renders the defensive empty branch. Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Drive">The drive to render, or null for the empty branch (web <c>drive</c>).</param>
public sealed record DriveTimelineModel(DriveTimelineSnapshot? Drive)
{
    /// <summary>The initial model — no drive bound (the empty branch).</summary>
    public static DriveTimelineModel Empty { get; } = new((DriveTimelineSnapshot?)null);
}

/// <summary>
/// The fully projected, render-ready view of the drive timeline — the native analogue of everything the web
/// component computes before returning JSX. Holds the resolved <see cref="State"/>, the formatted start time, the
/// "{h}h {m}m" duration, the end label (the formatted end time or the localized "In progress" copy), the
/// <see cref="InProgress"/> flag (the web <c>endTs</c> truthiness), the empty copy and the composed Narrator name.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="StartText">The formatted drive start time (content branch).</param>
/// <param name="DurationText">The formatted drive duration, e.g. "1h 35m" (content branch).</param>
/// <param name="EndText">The formatted end time, or the localized "In progress" copy (content branch).</param>
/// <param name="InProgress">True when the drive is still in progress (web <c>!drive.endTs</c>).</param>
/// <param name="EmptyMessage">The localized "No data available" copy (empty branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record DriveTimelineDisplay(
    DriveTimelineState State,
    string StartText,
    string DurationText,
    string EndText,
    bool InProgress,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from the input <see cref="DriveTimelineModel"/> to the render-ready
/// <see cref="DriveTimelineDisplay"/> — the native port of the branch selection, the time formatting and the
/// duration formatting in web/src/features/driving/components/drive-detail/DriveTimeline.tsx. Times render through
/// the shared <see cref="DateTimeFormatting"/> "Time" variant (the web <c>formatTime</c> seam) and the duration
/// reproduces the web <c>formatDuration(durationS / 60)</c> helper (whole hours, JavaScript <c>Math.round</c>ed
/// minutes). UI-free so the whole contract is unit-tested without a XAML runtime.
/// </summary>
public static class DriveTimelineProjection
{
    /// <summary>i18n key for the in-progress end label (web <c>t('driveDetail.inProgress', …)</c>).</summary>
    public const string InProgressKey = "driveDetail.inProgress";

    /// <summary>English fallback for <see cref="InProgressKey"/> (matches the web default).</summary>
    public const string InProgressFallback = "In progress";

    /// <summary>i18n key for the defensive empty-branch copy (no source key exists; the web prop is required).</summary>
    public const string NoDataKey = "common.noData";

    /// <summary>English fallback for <see cref="NoDataKey"/> (matches the resource catalog value).</summary>
    public const string NoDataFallback = "No data available";

    private const string EmDash = "\u2014";
    private const string RouteArrow = "\u2192";
    private const double SecondsPerMinute = 60.0;
    private const double MinutesPerHour = 60.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the <paramref name="localizer"/> facade.</summary>
    /// <param name="model">The render-time data model (the web <c>drive</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    public static DriveTimelineDisplay Project(DriveTimelineModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        if (model.Drive is not { } drive)
        {
            string emptyMessage = localizer.GetString(NoDataKey, NoDataFallback);
            return new DriveTimelineDisplay(
                DriveTimelineState.Empty,
                StartText: string.Empty,
                DurationText: string.Empty,
                EndText: string.Empty,
                InProgress: false,
                EmptyMessage: emptyMessage,
                AutomationName: emptyMessage);
        }

        // Web parity: formatTime(drive.startTs) — the shared "Time" variant renders the local "hh:mm tt".
        string startText = DateTimeFormatting.Format(drive.StartTs, DateTimeVariant.Time, drive.StartTs);

        // Web parity: formatDuration(drive.durationS / 60).
        string durationText = FormatDurationFromSeconds(drive.DurationS);

        // Web parity: drive.endTs ? formatTime(drive.endTs) : t('driveDetail.inProgress', 'In progress').
        bool inProgress = drive.EndTs is null;
        string endText = inProgress
            ? localizer.GetString(InProgressKey, InProgressFallback)
            : DateTimeFormatting.Format(drive.EndTs, DateTimeVariant.Time, drive.StartTs);

        string automationName = string.Concat(startText, " ", RouteArrow, " ", endText, ", ", durationText);

        return new DriveTimelineDisplay(
            DriveTimelineState.Ready,
            startText,
            durationText,
            endText,
            inProgress,
            EmptyMessage: string.Empty,
            automationName);
    }

    /// <summary>
    /// Format an SI-seconds drive duration exactly as the web does (web
    /// <c>formatDuration(min): h = floor(min / 60); m = round(min % 60); h &gt; 0 ? `${h}h ${m}m` : `${m}m`</c>,
    /// called with <c>min = durationS / 60</c>): whole hours plus the JavaScript <c>Math.round</c>ed (round-half-up)
    /// minute remainder. A non-finite input yields an em dash.
    /// </summary>
    public static string FormatDurationFromSeconds(double seconds)
    {
        if (double.IsNaN(seconds) || double.IsInfinity(seconds))
        {
            return EmDash;
        }

        double minutes = seconds / SecondsPerMinute;
        long hours = (long)Math.Floor(minutes / MinutesPerHour);
        double remainder = minutes - (hours * MinutesPerHour);
        long mins = (long)Math.Floor(remainder + 0.5);

        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {mins}m")
            : string.Create(CultureInfo.InvariantCulture, $"{mins}m");
    }
}

/// <summary>
/// Canonical diagnostics metadata for the Drive Timeline surface — the stable slug emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract) and the Segoe Fluent Icons glyph that stands in for the
/// web Lucide <c>Flag</c> icon (the green start flag and red end flag share the glyph, differing only in tint).
/// UI-free so the metadata is asserted in tests.
/// </summary>
public static class DriveTimelineRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveTimeline";

    /// <summary>Segoe Fluent "Flag" glyph for the start / end markers (web <c>Flag</c>).</summary>
    public const string FlagGlyph = "\uE7C1";
}

/// <summary>
/// PII-safe diagnostics for the Drive Timeline surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a timestamp, duration or drive id — so a diagnostics line
/// can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveTimelineDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveTimelineDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveTimeline</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveTimelineRegistration.Slug}");
    }
}
