using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The size variant a <c>FreshnessIndicator</c> renders at — the native analogue of the web
/// <c>size = 'sm' | 'md'</c> prop (web/src/components/data-display/FreshnessIndicator.tsx). It drives the dot
/// diameter and the relative-label font size; <see cref="Small"/> is the web default.
/// </summary>
public enum FreshnessIndicatorSize
{
    /// <summary>The compact variant (web <c>'sm'</c>): a 6px dot and a 10px label (web <c>h-1.5</c> / <c>text-[10px]</c>).</summary>
    Small,

    /// <summary>The roomier variant (web <c>'md'</c>): an 8px dot and a 12px label (web <c>h-2</c> / <c>text-xs</c>).</summary>
    Medium,
}

/// <summary>
/// One immutable freshness sample — the single datum the web <c>&lt;FreshnessIndicator&gt;</c> reads, namely the
/// timestamp of a SPECIFIC data point (web prop <c>timestamp</c>; e.g. the last battery_level reading or GPS
/// fix), or null when the caller has no reading yet (web <c>timestamp: string | null | undefined</c>). It is the
/// data the P1/S8 <see cref="IFreshnessIndicatorSource"/> exposes and the pure
/// <see cref="FreshnessIndicatorProjection.Project"/> consumes. <see cref="FromRepositoryResult{T}"/> derives the
/// sample from a cache-then-network <see cref="RepositoryResult{T}"/> by pulling the datum's own timestamp out of
/// the latest value, exactly as a web page passes a value's timestamp into the indicator. Pure data — no WinUI
/// types — so it is unit-tested without a UI host.
/// </summary>
/// <param name="Timestamp">When the underlying data point was last sampled, or null (web <c>timestamp</c>).</param>
public sealed record FreshnessIndicatorSnapshot(DateTimeOffset? Timestamp)
{
    /// <summary>The no-reading sample — a null timestamp, which projects to the unknown state (web <c>timestamp == null</c>).</summary>
    public static FreshnessIndicatorSnapshot Empty { get; } = new((DateTimeOffset?)null);

    /// <summary>Create a sample stamped at <paramref name="timestamp"/> (the web caller passing a concrete reading time).</summary>
    /// <param name="timestamp">When the underlying data point was sampled.</param>
    public static FreshnessIndicatorSnapshot At(DateTimeOffset timestamp) => new(timestamp);

    /// <summary>
    /// Derive a sample from a cache-then-network <see cref="RepositoryResult{T}"/> by selecting the data point's
    /// own timestamp out of the latest value — the native wiring for "age of a specific datum". When the result
    /// carries a value (cached, refreshing, loaded or offline-cached) the <paramref name="selectTimestamp"/>
    /// selector pulls the reading time out of it; when there is no value yet (initial load, or a hard failure
    /// with no cache) the sample is the no-reading <see cref="Empty"/> equivalent, which projects to the unknown
    /// state. The whole derivation is WinUI-free so it is unit-tested against an in-memory result.
    /// </summary>
    /// <typeparam name="T">The repository's domain read-model type whose datum carries the reading time.</typeparam>
    /// <param name="result">The repository emission to read the latest value from.</param>
    /// <param name="selectTimestamp">Selector that pulls the data point's own timestamp out of the value.</param>
    public static FreshnessIndicatorSnapshot FromRepositoryResult<T>(
        RepositoryResult<T> result,
        Func<T, DateTimeOffset?> selectTimestamp)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(selectTimestamp);

        // A reading exists only in the cache-then-network value-bearing states; Loading / Empty / Error carry
        // none. (RepositoryResult.HasValue keys off Value != null, which is unreliable for a value-type T, where
        // the default value is non-null.)
        var hasValue = result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
        var timestamp = hasValue ? selectTimestamp(result.Value!) : null;
        return new FreshnessIndicatorSnapshot(timestamp);
    }
}

/// <summary>
/// Canonical metadata for the FreshnessIndicator surface — the native analogue of the module-level
/// <c>DOT_COLOR</c> / <c>DOT_SIZE</c> / <c>LABEL_SIZE</c> tables, the threshold defaults and the
/// <c>formatAge</c> phrasing in web/src/components/data-display/FreshnessIndicator.tsx. Carries the diagnostics
/// slug, the automation id, the relative-time i18n keys (each with the English fallback the web source renders
/// verbatim, shared with the sibling DataFreshness catalog entries), the accessible-name keys, the lowercase
/// status tokens, the generated design-token brush keys the four states tint from, the per-size dot / font
/// metrics and the web threshold defaults. UI-free so it is asserted in tests.
/// </summary>
public static class FreshnessIndicatorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FreshnessIndicator";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "freshness-indicator";

    /// <summary>ARIA role the surface exposes — a read-only status indicator (the web span carries no role; this is the native idiom).</summary>
    public const string StatusRole = "status";

    /// <summary>Seconds before a data point is considered stale — the web <c>staleThreshold</c> default.</summary>
    public const int DefaultStaleThresholdSeconds = FreshnessLogic.DefaultStaleSeconds;

    /// <summary>Seconds before a data point is considered offline — the web <c>offlineThreshold</c> default.</summary>
    public const int DefaultOfflineThresholdSeconds = FreshnessLogic.DefaultOfflineSeconds;

    /// <summary>Generated design-token brush key for the fresh state (web <c>bg-neon-green</c>).</summary>
    public const string FreshBrushKey = "TsColorSuccessBrush";

    /// <summary>Generated design-token brush key for the stale state (web <c>bg-neon-amber</c>).</summary>
    public const string StaleBrushKey = "TsColorWarningBrush";

    /// <summary>Generated design-token brush key for the offline state (web <c>bg-neon-red</c>).</summary>
    public const string OfflineBrushKey = "TsColorDangerBrush";

    /// <summary>Generated design-token brush key for the unknown state (web <c>bg-[var(--surface-2)]</c> → muted text token).</summary>
    public const string UnknownBrushKey = "TsColorTextMutedBrush";

    /// <summary>Dot diameter for the small variant in DIPs (web <c>h-1.5 w-1.5</c>).</summary>
    public const double SmallDotDiameter = 6;

    /// <summary>Dot diameter for the medium variant in DIPs (web <c>h-2 w-2</c>).</summary>
    public const double MediumDotDiameter = 8;

    /// <summary>Relative-label font size for the small variant (web <c>text-[10px]</c>).</summary>
    public const double SmallLabelFontSize = 10;

    /// <summary>Relative-label font size for the medium variant (web <c>text-xs</c>).</summary>
    public const double MediumLabelFontSize = 12;

    /// <summary>i18n key for the "just now" tier (web <c>'just now'</c>; shared with the DataFreshness catalog).</summary>
    public const string JustNowKey = "translation.freshness.justNow";

    /// <summary>English fallback for <see cref="JustNowKey"/> — the web literal.</summary>
    public const string JustNowFallback = "just now";

    /// <summary>i18n key for the seconds tier (web <c>`${age}s ago`</c>; <c>{0}</c>=seconds).</summary>
    public const string SecondsKey = "translation.freshness.seconds";

    /// <summary>English fallback for <see cref="SecondsKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string SecondsFallback = "{0}s ago";

    /// <summary>i18n key for the minutes tier (web <c>`${m}m ago`</c>; <c>{0}</c>=minutes).</summary>
    public const string MinutesKey = "translation.freshness.minutes";

    /// <summary>English fallback for <see cref="MinutesKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string MinutesFallback = "{0}m ago";

    /// <summary>i18n key for the hours tier (web <c>`${h}h ago`</c>; <c>{0}</c>=hours).</summary>
    public const string HoursKey = "translation.freshness.hours";

    /// <summary>English fallback for <see cref="HoursKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string HoursFallback = "{0}h ago";

    /// <summary>i18n key for the no-reading label (web <c>formatAge(null)</c> → the em dash).</summary>
    public const string UnknownKey = "translation.freshness.unknown";

    /// <summary>Fallback for <see cref="UnknownKey"/> — the web em-dash literal.</summary>
    public const string UnknownFallback = "\u2014";

    /// <summary>i18n key for the read-only accessible name when a reading exists (<c>{0}</c>=status token, <c>{1}</c>=relative age).</summary>
    public const string DetailedAriaKey = "translation.a11y.freshnessIndicator";

    /// <summary>English fallback for <see cref="DetailedAriaKey"/> with the .NET positional format arguments.</summary>
    public const string DetailedAriaFallback = "Data freshness: {0}, {1}";

    /// <summary>i18n key for the read-only accessible name with no reading — shared with the DataFreshness catalog (<c>{0}</c>=status token).</summary>
    public const string StatusAriaKey = "translation.a11y.dataFreshness";

    /// <summary>English fallback for <see cref="StatusAriaKey"/> with the .NET positional format argument.</summary>
    public const string StatusAriaFallback = "Data freshness: {0}";

    /// <summary>The lowercase status token the accessible name interpolates (fresh / stale / offline / unknown).</summary>
    public static string StatusToken(FreshnessStatus status) => status switch
    {
        FreshnessStatus.Fresh => "fresh",
        FreshnessStatus.Stale => "stale",
        FreshnessStatus.Offline => "offline",
        _ => "unknown",
    };

    /// <summary>The generated design-token brush key the <paramref name="status"/> tints from (delegates to the shared <see cref="FreshnessLogic"/>).</summary>
    public static string AccentBrushKey(FreshnessStatus status) => FreshnessLogic.AccentBrushKey(status);

    /// <summary>The dot diameter (DIPs) for a size variant (web <c>DOT_SIZE</c>).</summary>
    public static double DotDiameter(FreshnessIndicatorSize size) =>
        size == FreshnessIndicatorSize.Medium ? MediumDotDiameter : SmallDotDiameter;

    /// <summary>The relative-label font size for a size variant (web <c>LABEL_SIZE</c>).</summary>
    public static double LabelFontSize(FreshnessIndicatorSize size) =>
        size == FreshnessIndicatorSize.Medium ? MediumLabelFontSize : SmallLabelFontSize;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="FreshnessIndicatorSnapshot"/> — everything the web
/// component derives before returning JSX (web/src/components/data-display/FreshnessIndicator.tsx): the resolved
/// <see cref="Status"/> and its <see cref="StatusToken"/>, the token <see cref="AccentBrushKey"/> the dot tints
/// from, the localized relative-age <see cref="Label"/> (web <c>formatAge</c>) and whether it is shown
/// (<see cref="ShowLabel"/>), the size-driven <see cref="DotDiameter"/> / <see cref="LabelFontSize"/>, the
/// reduced-motion-gated <see cref="Pulse"/> flag (web fresh-dot <c>animate-pulse</c>), the hover/Narrator
/// <see cref="Title"/> (web <c>title={timestamp}</c>) and accessible <see cref="AutomationName"/>, and the
/// <see cref="IsStale"/> / <see cref="IsOffline"/> booleans the web <c>useIsStale</c> hook exposes. Pure value
/// type so every field is asserted headlessly.
/// </summary>
public readonly record struct FreshnessIndicatorProjection
{
    private FreshnessIndicatorProjection(
        FreshnessStatus status,
        string accentBrushKey,
        string label,
        bool showLabel,
        FreshnessIndicatorSize size,
        double dotDiameter,
        double labelFontSize,
        bool pulse,
        bool isStale,
        bool isOffline,
        int? ageSeconds,
        string title,
        string automationName)
    {
        Status = status;
        AccentBrushKey = accentBrushKey;
        Label = label;
        ShowLabel = showLabel;
        Size = size;
        DotDiameter = dotDiameter;
        LabelFontSize = labelFontSize;
        Pulse = pulse;
        IsStale = isStale;
        IsOffline = isOffline;
        AgeSeconds = ageSeconds;
        Title = title;
        AutomationName = automationName;
        StatusToken = FreshnessIndicatorRegistration.StatusToken(status);
    }

    /// <summary>The resolved freshness status (web <c>status</c>).</summary>
    public FreshnessStatus Status { get; }

    /// <summary>The lowercase status token interpolated into the accessible name: fresh / stale / offline / unknown.</summary>
    public string StatusToken { get; }

    /// <summary>The generated design-token brush key the dot tints from.</summary>
    public string AccentBrushKey { get; }

    /// <summary>The localized relative-age label (web <c>formatAge</c>): em dash, "just now", "{s}s ago", "{m}m ago" or "{h}h ago".</summary>
    public string Label { get; }

    /// <summary>Whether the relative-age label is shown (web <c>showLabel</c>).</summary>
    public bool ShowLabel { get; }

    /// <summary>The resolved size variant (web <c>size</c>).</summary>
    public FreshnessIndicatorSize Size { get; }

    /// <summary>The dot diameter in DIPs (web <c>DOT_SIZE</c>).</summary>
    public double DotDiameter { get; }

    /// <summary>The relative-label font size (web <c>LABEL_SIZE</c>).</summary>
    public double LabelFontSize { get; }

    /// <summary>Whether the dot pulses (web fresh-dot <c>animate-pulse</c>): fresh and motion allowed.</summary>
    public bool Pulse { get; }

    /// <summary>Whether the data point is at or past the stale threshold (web <c>useIsStale().isStale</c>).</summary>
    public bool IsStale { get; }

    /// <summary>Whether the data point is at or past the offline threshold (web <c>useIsStale().isOffline</c>).</summary>
    public bool IsOffline { get; }

    /// <summary>The data point's age in whole seconds, or null when there is no reading (web <c>computeAge</c>).</summary>
    public int? AgeSeconds { get; }

    /// <summary>The hover / Narrator tooltip — the formatted reading time, or empty when there is no reading (web <c>title={timestamp}</c>).</summary>
    public string Title { get; }

    /// <summary>The accessible name the automation peer reports (native a11y for the colour-only dot + relative age).</summary>
    public string AutomationName { get; }

    /// <summary>
    /// Project a sample into a render-ready value, reproducing the web component body exactly
    /// (web/src/components/data-display/FreshnessIndicator.tsx L85-103): the age computation
    /// (<see cref="FreshnessLogic.ComputeAge"/>), the fresh / stale / offline / unknown classification
    /// (<see cref="FreshnessLogic.GetStatus"/> against the two thresholds), the <c>formatAge</c> relative label,
    /// the fresh-dot pulse gated on reduce-motion, the <c>useIsStale</c> <see cref="IsStale"/> /
    /// <see cref="IsOffline"/> booleans, the timestamp tooltip and the composed accessible name.
    /// </summary>
    /// <param name="snapshot">The freshness sample (web <c>timestamp</c> prop).</param>
    /// <param name="size">The size variant (web <c>size</c>).</param>
    /// <param name="showLabel">Whether the relative label is shown (web <c>showLabel</c>).</param>
    /// <param name="staleThreshold">Seconds before the data point is stale (web <c>staleThreshold</c>).</param>
    /// <param name="offlineThreshold">Seconds before the data point is offline (web <c>offlineThreshold</c>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="now">The clock the relative age is measured against (web <c>Date.now()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="formatTimestamp">The locale-aware formatter for the reading-time tooltip (web <c>title={timestamp}</c>).</param>
    public static FreshnessIndicatorProjection Project(
        FreshnessIndicatorSnapshot snapshot,
        FreshnessIndicatorSize size,
        bool showLabel,
        int staleThreshold,
        int offlineThreshold,
        bool reduceMotion,
        DateTimeOffset now,
        ILocalizer localizer,
        Func<DateTimeOffset, string> formatTimestamp)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(formatTimestamp);

        var age = FreshnessLogic.ComputeAge(snapshot.Timestamp, now);
        var status = FreshnessLogic.GetStatus(age, staleThreshold, offlineThreshold);
        var label = FormatAgeLabel(age, localizer);
        var isStale = age is { } stale && stale >= staleThreshold;
        var isOffline = age is { } offline && offline >= offlineThreshold;

        // web: status === 'fresh' && 'animate-pulse' — only the fresh dot pulses, and only when motion is allowed.
        var pulse = status == FreshnessStatus.Fresh && !reduceMotion;

        var title = snapshot.Timestamp is { } timestamp ? formatTimestamp(timestamp) : string.Empty;
        var automationName = ResolveAutomationName(status, label, age is not null, localizer);

        return new FreshnessIndicatorProjection(
            status: status,
            accentBrushKey: FreshnessIndicatorRegistration.AccentBrushKey(status),
            label: label,
            showLabel: showLabel,
            size: size,
            dotDiameter: FreshnessIndicatorRegistration.DotDiameter(size),
            labelFontSize: FreshnessIndicatorRegistration.LabelFontSize(size),
            pulse: pulse,
            isStale: isStale,
            isOffline: isOffline,
            ageSeconds: age,
            title: title,
            automationName: automationName);
    }

    /// <summary>
    /// The relative-age label for a data point whose age is <paramref name="age"/> whole seconds — the native
    /// port of the web <c>formatAge</c> tiers (web/src/components/data-display/FreshnessIndicator.tsx L48-54):
    /// null → em dash, &lt; 10s → "just now", &lt; 60s → "{s}s ago", &lt; 1h → "{m}m ago", else "{h}h ago". The
    /// phrases resolve through the localizer; the numeric value is substituted with the .NET positional
    /// <c>{0}</c> argument.
    /// </summary>
    /// <param name="age">The data point's age in whole seconds, or null for no reading.</param>
    /// <param name="localizer">The i18n facade the tier phrases resolve through.</param>
    public static string FormatAgeLabel(int? age, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (age is not { } seconds)
        {
            return localizer.GetString(FreshnessIndicatorRegistration.UnknownKey, FreshnessIndicatorRegistration.UnknownFallback);
        }

        if (seconds < 10)
        {
            return localizer.GetString(FreshnessIndicatorRegistration.JustNowKey, FreshnessIndicatorRegistration.JustNowFallback);
        }

        if (seconds < 60)
        {
            return Tier(FreshnessIndicatorRegistration.SecondsKey, FreshnessIndicatorRegistration.SecondsFallback, seconds, localizer);
        }

        if (seconds < 3600)
        {
            return Tier(FreshnessIndicatorRegistration.MinutesKey, FreshnessIndicatorRegistration.MinutesFallback, seconds / 60, localizer);
        }

        return Tier(FreshnessIndicatorRegistration.HoursKey, FreshnessIndicatorRegistration.HoursFallback, seconds / 3600, localizer);
    }

    private static string ResolveAutomationName(FreshnessStatus status, string label, bool hasReading, ILocalizer localizer)
    {
        var token = FreshnessIndicatorRegistration.StatusToken(status);

        // With a reading the name announces both the status (the colour-only semantic) and the relative age; with
        // no reading the age portion is meaningless, so it falls back to the shared status-only phrasing.
        if (hasReading)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(FreshnessIndicatorRegistration.DetailedAriaKey, FreshnessIndicatorRegistration.DetailedAriaFallback),
                token,
                label);
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(FreshnessIndicatorRegistration.StatusAriaKey, FreshnessIndicatorRegistration.StatusAriaFallback),
            token);
    }

    private static string Tier(string key, string fallback, int value, ILocalizer localizer) =>
        string.Format(CultureInfo.CurrentCulture, localizer.GetString(key, fallback), value);
}

/// <summary>
/// PII-safe diagnostics for the FreshnessIndicator surface (P1/S11 diagnostics contract). A freshness dot carries
/// no user content (only a status and a relative time), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the timestamp or status. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class FreshnessIndicatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public FreshnessIndicatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FreshnessIndicator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FreshnessIndicatorRegistration.Slug}");
    }
}
