using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The four freshness states a <c>DataFreshness</c> chip can be in — the native analogue of the web
/// <c>FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error'</c> union
/// (web/src/components/data-display/DataFreshness.tsx). Mapped from a query result with the web precedence
/// <c>error &gt; fetching &gt; stale &gt; fresh</c>. Deliberately a distinct type from the per-datum
/// <see cref="TeslaSync.App.Core.DataDisplay.FreshnessStatus"/> (which backs <c>FreshnessIndicator</c> and has
/// a different fresh/stale/offline/unknown vocabulary).
/// </summary>
public enum DataFreshnessStatus
{
    /// <summary>Data is current — solid dot, Wifi glyph, relative "updated" age (web <c>'fresh'</c>).</summary>
    Fresh,

    /// <summary>A (re)fetch is in flight — spinning refresh glyph, "updating…" (web <c>'fetching'</c>).</summary>
    Fetching,

    /// <summary>Data is past its freshness window — amber Wifi glyph, relative age (web <c>'stale'</c>).</summary>
    Stale,

    /// <summary>The last fetch failed — WifiOff glyph, "error" (or the cached age when offline) (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// One immutable freshness snapshot — the four inputs the web <c>&lt;DataFreshness&gt;</c> reads from a query
/// result (web/src/components/data-display/DataFreshness.tsx props <c>updatedAt</c> / <c>isFetching</c> /
/// <c>isStale</c> / <c>isError</c>). It is the data the P1/S8 <see cref="IDataFreshnessSource"/> exposes and the
/// pure <see cref="DataFreshnessProjection.Project"/> consumes. <see cref="FromRepositoryResult{T}"/> derives a
/// snapshot from the native cache-then-network <see cref="RepositoryResult{T}"/> exactly as the web
/// <c>&lt;DataFreshnessAuto&gt;</c> derives the props from a TanStack Query result (including its
/// <c>forceStaleAfterMs</c> override). Pure data — no WinUI types — so it is unit-tested without a UI host.
/// </summary>
/// <param name="UpdatedAt">When the data was last successfully fetched, or null (web <c>updatedAt</c>).</param>
/// <param name="IsFetching">Whether a (re)fetch is currently in flight (web <c>isFetching</c>).</param>
/// <param name="IsStale">Whether the data is past its freshness window (web <c>isStale</c>).</param>
/// <param name="IsError">Whether the last fetch failed (web <c>isError</c>).</param>
public sealed record DataFreshnessSnapshot(
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    bool IsStale,
    bool IsError)
{
    /// <summary>The data-resolved-but-never-updated snapshot — fresh status with no timestamp (web "Never updated").</summary>
    public static DataFreshnessSnapshot Empty { get; } = new(null, IsFetching: false, IsStale: false, IsError: false);

    /// <summary>The initial-load snapshot — fetching with no cached value yet (web <c>isFetching</c>, <c>updatedAt</c> null).</summary>
    public static DataFreshnessSnapshot Loading { get; } = new(null, IsFetching: true, IsStale: false, IsError: false);

    /// <summary>
    /// Derive a snapshot from a cache-then-network <see cref="RepositoryResult{T}"/> — the native port of the web
    /// <c>&lt;DataFreshnessAuto&gt;</c> prop derivation (web/src/components/data-display/DataFreshness.tsx L280-301).
    /// <list type="bullet">
    ///   <item><see cref="DataFreshnessSnapshot.UpdatedAt"/> ← <see cref="RepositoryResult{T}.FetchedAt"/>
    ///         (the web <c>dataUpdatedAt &gt; 0 ? dataUpdatedAt : null</c>).</item>
    ///   <item><see cref="DataFreshnessSnapshot.IsFetching"/> ← <see cref="RepositoryResult{T}.IsLoading"/>
    ///         (the transient <see cref="LoadStatus.Loading"/> / <see cref="LoadStatus.Refreshing"/> states).</item>
    ///   <item><see cref="DataFreshnessSnapshot.IsError"/> ← <see cref="LoadStatus.Error"/> OR
    ///         <see cref="LoadStatus.Offline"/>. The offline-cached case keeps its cached
    ///         <see cref="DataFreshnessSnapshot.UpdatedAt"/>, so the chip shows the WifiOff glyph beside the cached
    ///         age — the web behaviour when a TanStack query is <c>isError</c> yet still holds the last
    ///         <c>dataUpdatedAt</c>.</item>
    ///   <item><see cref="DataFreshnessSnapshot.IsStale"/> ← <see cref="RepositoryResult{T}.IsStale"/> OR the
    ///         <paramref name="forceStaleAfterMs"/> override (web <c>forceStaleAfterMs</c>): once the value's age
    ///         exceeds the window it is forced stale even when the engine has not flagged it.</item>
    /// </list>
    /// </summary>
    /// <typeparam name="T">The repository's domain read-model type.</typeparam>
    /// <param name="result">The repository emission to project.</param>
    /// <param name="now">The clock the <paramref name="forceStaleAfterMs"/> window is measured against.</param>
    /// <param name="forceStaleAfterMs">
    /// Optional staleness window in milliseconds (web <c>forceStaleAfterMs</c>); when set, a value older than this
    /// is forced stale. Null disables the override.
    /// </param>
    public static DataFreshnessSnapshot FromRepositoryResult<T>(
        RepositoryResult<T> result,
        DateTimeOffset now,
        double? forceStaleAfterMs = null)
    {
        ArgumentNullException.ThrowIfNull(result);

        var updatedAt = result.FetchedAt;
        var isFetching = result.IsLoading;
        var isError = result.Status is LoadStatus.Error or LoadStatus.Offline;
        var isStale = result.IsStale || ForcedStale(updatedAt, now, forceStaleAfterMs);

        return new DataFreshnessSnapshot(updatedAt, isFetching, isStale, isError);
    }

    private static bool ForcedStale(DateTimeOffset? updatedAt, DateTimeOffset now, double? forceStaleAfterMs) =>
        forceStaleAfterMs is { } ms && updatedAt is { } ts && (now - ts).TotalMilliseconds > ms;
}

/// <summary>
/// Canonical metadata for the DataFreshness surface — the native analogue of the module-level constants,
/// <c>FRESHNESS_COLORS</c>/<c>STATUS_CONFIG</c> tables and default <c>t()</c> calls in
/// web/src/components/data-display/DataFreshness.tsx. Carries the diagnostics slug, the automation id, the i18n
/// keys (each with the English fallback the web source renders verbatim), the lowercase status tokens the web
/// <c>aria-label</c> interpolates, the generated design-token brush keys the four states tint from, the Segoe
/// Fluent glyphs standing in for the web Lucide icons, and the ARIA role/live contract. UI-free so it is asserted
/// in tests.
/// </summary>
public static class DataFreshnessRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DataFreshness";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "data-freshness";

    /// <summary>ARIA role the surface exposes when it is refreshable (web <c>role="button"</c>).</summary>
    public const string ButtonRole = "button";

    /// <summary>ARIA role the surface exposes when it is read-only (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface always declares (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Generated design-token brush key for the fresh state (web emerald).</summary>
    public const string FreshBrushKey = "TsColorSuccessBrush";

    /// <summary>Generated design-token brush key for the fetching state (web sky).</summary>
    public const string FetchingBrushKey = "TsColorInfoBrush";

    /// <summary>Generated design-token brush key for the stale state (web amber).</summary>
    public const string StaleBrushKey = "TsColorWarningBrush";

    /// <summary>Generated design-token brush key for the error state (web red).</summary>
    public const string ErrorBrushKey = "TsColorDangerBrush";

    /// <summary>Segoe Fluent "Wifi" glyph — the web Lucide <c>Wifi</c> icon (fresh / stale).</summary>
    public const string WifiGlyph = "\uE701";

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon (error).</summary>
    public const string WifiOffGlyph = "\uEB5E";

    /// <summary>Segoe Fluent "Refresh" glyph — the web Lucide <c>RefreshCw</c> icon (fetching, spins).</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>i18n key for the "just now" tier (web <c>t('freshness.justNow', 'just now')</c>).</summary>
    public const string JustNowKey = "translation.freshness.justNow";

    /// <summary>English fallback for <see cref="JustNowKey"/> — the web literal.</summary>
    public const string JustNowFallback = "just now";

    /// <summary>i18n key for the minutes tier (web <c>t('freshness.minutes', '{{m}}m ago')</c>; <c>{0}</c>=minutes).</summary>
    public const string MinutesKey = "translation.freshness.minutes";

    /// <summary>English fallback for <see cref="MinutesKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string MinutesFallback = "{0}m ago";

    /// <summary>i18n key for the hours tier (web <c>t('freshness.hours', '{{h}}h ago')</c>; <c>{0}</c>=hours).</summary>
    public const string HoursKey = "translation.freshness.hours";

    /// <summary>English fallback for <see cref="HoursKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string HoursFallback = "{0}h ago";

    /// <summary>i18n key for the days tier (web <c>t('freshness.days', '{{d}}d ago')</c>; <c>{0}</c>=days).</summary>
    public const string DaysKey = "translation.freshness.days";

    /// <summary>English fallback for <see cref="DaysKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string DaysFallback = "{0}d ago";

    /// <summary>i18n key for the weeks tier (web <c>t('freshness.weeks', '{{w}}w ago')</c>; <c>{0}</c>=weeks).</summary>
    public const string WeeksKey = "translation.freshness.weeks";

    /// <summary>English fallback for <see cref="WeeksKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string WeeksFallback = "{0}w ago";

    /// <summary>i18n key for the in-flight relative label (web <c>t('freshness.updating', 'updating…')</c>).</summary>
    public const string UpdatingKey = "translation.freshness.updating";

    /// <summary>English fallback for <see cref="UpdatingKey"/> — the web literal (lowercase, trailing ellipsis).</summary>
    public const string UpdatingFallback = "updating\u2026";

    /// <summary>i18n key for the error relative label (web <c>t('freshness.error', 'error')</c>).</summary>
    public const string ErrorKey = "translation.freshness.error";

    /// <summary>English fallback for <see cref="ErrorKey"/> — the web literal.</summary>
    public const string ErrorFallback = "error";

    /// <summary>i18n key for the reduced-motion in-flight tooltip (web <c>t('freshness.updatingTooltip', 'Updating…')</c>).</summary>
    public const string UpdatingTooltipKey = "translation.freshness.updatingTooltip";

    /// <summary>English fallback for <see cref="UpdatingTooltipKey"/> — the web literal (capitalised, trailing ellipsis).</summary>
    public const string UpdatingTooltipFallback = "Updating\u2026";

    /// <summary>i18n key for the last-updated tooltip (web <c>t('freshness.lastUpdated', 'Last updated: {{time}}')</c>; <c>{0}</c>=time).</summary>
    public const string LastUpdatedKey = "translation.freshness.lastUpdated";

    /// <summary>English fallback for <see cref="LastUpdatedKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string LastUpdatedFallback = "Last updated: {0}";

    /// <summary>i18n key for the never-updated tooltip (web <c>t('freshness.neverUpdated', 'Never updated')</c>).</summary>
    public const string NeverUpdatedKey = "translation.freshness.neverUpdated";

    /// <summary>English fallback for <see cref="NeverUpdatedKey"/> — the web literal.</summary>
    public const string NeverUpdatedFallback = "Never updated";

    /// <summary>i18n key for the refreshable accessible name (web <c>t('freshness.refresh', 'Refresh')</c>).</summary>
    public const string RefreshKey = "translation.freshness.refresh";

    /// <summary>English fallback for <see cref="RefreshKey"/> — the web literal.</summary>
    public const string RefreshFallback = "Refresh";

    /// <summary>i18n key for the read-only accessible name (web <c>t('a11y.dataFreshness', 'Data freshness: {{state}}')</c>; <c>{0}</c>=status token).</summary>
    public const string DataFreshnessAriaKey = "translation.a11y.dataFreshness";

    /// <summary>English fallback for <see cref="DataFreshnessAriaKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string DataFreshnessAriaFallback = "Data freshness: {0}";

    /// <summary>The lowercase status token the web <c>aria-label</c> interpolates (fresh / fetching / stale / error).</summary>
    public static string StatusToken(DataFreshnessStatus status) => status switch
    {
        DataFreshnessStatus.Fresh => "fresh",
        DataFreshnessStatus.Fetching => "fetching",
        DataFreshnessStatus.Stale => "stale",
        _ => "error",
    };

    /// <summary>The generated design-token brush key the <paramref name="status"/> tints from.</summary>
    public static string AccentBrushKey(DataFreshnessStatus status) => status switch
    {
        DataFreshnessStatus.Fresh => FreshBrushKey,
        DataFreshnessStatus.Fetching => FetchingBrushKey,
        DataFreshnessStatus.Stale => StaleBrushKey,
        _ => ErrorBrushKey,
    };

    /// <summary>The Segoe Fluent glyph the <paramref name="status"/> shows (web Lucide Wifi / RefreshCw / WifiOff).</summary>
    public static string Glyph(DataFreshnessStatus status) => status switch
    {
        DataFreshnessStatus.Fetching => RefreshGlyph,
        DataFreshnessStatus.Error => WifiOffGlyph,
        _ => WifiGlyph,
    };
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="DataFreshnessSnapshot"/> — everything the web
/// component derives before returning JSX (web/src/components/data-display/DataFreshness.tsx): the resolved
/// <see cref="Status"/> (web <c>error &gt; fetching &gt; stale &gt; fresh</c> precedence) and its
/// <see cref="StatusToken"/>, the token <see cref="AccentBrushKey"/> and Segoe Fluent <see cref="IconGlyph"/>,
/// the localized <see cref="RelativeText"/> (web <c>relativeTime</c>), whether the text is shown
/// (<see cref="ShowText"/> — hidden in <c>compact</c>), the hover/Narrator <see cref="Title"/> (web
/// <c>title</c>) and accessible <see cref="AutomationName"/> (web <c>aria-label</c>), the ARIA
/// <see cref="Role"/> (button when refreshable, else status), and the three reduced-motion-gated animation flags
/// <see cref="Spin"/> (web RefreshCw <c>animate-spin</c>), <see cref="Ping"/> (web dot <c>animate-ping</c>) and
/// <see cref="PulseDot"/> (web background-refetch <c>animate-pulse</c>). Pure value type so every field is asserted
/// headlessly.
/// </summary>
public readonly record struct DataFreshnessProjection
{
    private DataFreshnessProjection(
        DataFreshnessStatus status,
        string accentBrushKey,
        string iconGlyph,
        string relativeText,
        bool showText,
        bool compact,
        string title,
        string automationName,
        string role,
        bool interactive,
        bool spin,
        bool ping,
        bool pulseDot)
    {
        Status = status;
        AccentBrushKey = accentBrushKey;
        IconGlyph = iconGlyph;
        RelativeText = relativeText;
        ShowText = showText;
        Compact = compact;
        Title = title;
        AutomationName = automationName;
        Role = role;
        Interactive = interactive;
        Spin = spin;
        Ping = ping;
        PulseDot = pulseDot;
        StatusToken = DataFreshnessRegistration.StatusToken(status);
        LiveSetting = DataFreshnessRegistration.LiveSetting;
    }

    /// <summary>The resolved freshness status (web <c>status</c>).</summary>
    public DataFreshnessStatus Status { get; }

    /// <summary>The lowercase status token (web <c>aria-label</c> interpolation): fresh / fetching / stale / error.</summary>
    public string StatusToken { get; }

    /// <summary>The generated design-token brush key the dot, icon and text tint from.</summary>
    public string AccentBrushKey { get; }

    /// <summary>The Segoe Fluent glyph (web Lucide Wifi / RefreshCw / WifiOff).</summary>
    public string IconGlyph { get; }

    /// <summary>The localized relative-time / status label (web <c>relativeTime</c>); empty when never updated.</summary>
    public string RelativeText { get; }

    /// <summary>Whether the relative-time text is shown — false in <c>compact</c> mode (web <c>!compact</c>).</summary>
    public bool ShowText { get; }

    /// <summary>Whether the chip is in the icon-only compact mode (web <c>compact</c>).</summary>
    public bool Compact { get; }

    /// <summary>The hover / Narrator tooltip (web <c>title</c>): updating, last-updated or never-updated.</summary>
    public string Title { get; }

    /// <summary>The accessible name (web <c>aria-label</c>): "Refresh" when interactive, else "Data freshness: {state}".</summary>
    public string AutomationName { get; }

    /// <summary>The ARIA role (web <c>role</c>): button when refreshable, otherwise status.</summary>
    public string Role { get; }

    /// <summary>Whether the chip is an interactive refresh affordance (web <c>onRefresh</c> present).</summary>
    public bool Interactive { get; }

    /// <summary>Whether the refresh glyph spins (web RefreshCw <c>animate-spin</c>): fetching and motion allowed.</summary>
    public bool Spin { get; }

    /// <summary>Whether the dot shows the expanding ping ring (web dot <c>animate-ping</c>): fetching and motion allowed.</summary>
    public bool Ping { get; }

    /// <summary>Whether the dot pulses (web background-refetch <c>animate-pulse</c>): refetch over existing data, motion allowed.</summary>
    public bool PulseDot { get; }

    /// <summary>The ARIA live urgency the surface declares (always <see cref="DataFreshnessRegistration.LiveSetting"/>).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a snapshot into a render-ready value, reproducing the web component body exactly
    /// (web/src/components/data-display/DataFreshness.tsx L110-233): the <c>error &gt; fetching &gt; stale &gt;
    /// fresh</c> status precedence, the <c>relativeTime</c> derivation (timestamped-and-idle → relative age,
    /// else fetching → "updating…", else error → "error", else empty), the <c>title</c> derivation
    /// (fetching-under-reduced-motion → "Updating…", else timestamped → "Last updated: {time}", else "Never
    /// updated"), the <c>aria-label</c> ("Refresh" when refreshable, else "Data freshness: {state}"), the
    /// button/status <c>role</c>, and the three motion-gated animation flags.
    /// </summary>
    /// <param name="snapshot">The freshness inputs (web props).</param>
    /// <param name="compact">Icon-only compact mode (web <c>compact</c>).</param>
    /// <param name="canRefresh">Whether the chip is a refresh affordance (web <c>onRefresh</c> present).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="now">The clock the relative-time age is measured against (web <c>Date.now()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="formatTime">The locale-aware time formatter for the last-updated tooltip (web <c>formatTime</c>).</param>
    public static DataFreshnessProjection Project(
        DataFreshnessSnapshot snapshot,
        bool compact,
        bool canRefresh,
        bool reduceMotion,
        DateTimeOffset now,
        ILocalizer localizer,
        Func<DateTimeOffset, string> formatTime)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(formatTime);

        // web: isError ? 'error' : isFetching ? 'fetching' : isStale ? 'stale' : 'fresh'.
        var status = snapshot.IsError
            ? DataFreshnessStatus.Error
            : snapshot.IsFetching
                ? DataFreshnessStatus.Fetching
                : snapshot.IsStale
                    ? DataFreshnessStatus.Stale
                    : DataFreshnessStatus.Fresh;

        // web: isBackgroundRefetch = isFetching && updatedAt != null.
        var isBackgroundRefetch = snapshot.IsFetching && snapshot.UpdatedAt is not null;

        var relativeText = ResolveRelativeText(snapshot, now, localizer);
        var title = ResolveTitle(snapshot, reduceMotion, localizer, formatTime);
        var automationName = canRefresh
            ? localizer.GetString(DataFreshnessRegistration.RefreshKey, DataFreshnessRegistration.RefreshFallback)
            : string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(DataFreshnessRegistration.DataFreshnessAriaKey, DataFreshnessRegistration.DataFreshnessAriaFallback),
                DataFreshnessRegistration.StatusToken(status));

        var spin = status == DataFreshnessStatus.Fetching && !reduceMotion;

        return new DataFreshnessProjection(
            status: status,
            accentBrushKey: DataFreshnessRegistration.AccentBrushKey(status),
            iconGlyph: DataFreshnessRegistration.Glyph(status),
            relativeText: relativeText,
            showText: !compact,
            compact: compact,
            title: title,
            automationName: automationName,
            role: canRefresh ? DataFreshnessRegistration.ButtonRole : DataFreshnessRegistration.StatusRole,
            interactive: canRefresh,
            spin: spin,
            ping: spin,
            pulseDot: isBackgroundRefetch && !reduceMotion);
    }

    private static string ResolveRelativeText(DataFreshnessSnapshot snapshot, DateTimeOffset now, ILocalizer localizer)
    {
        // web: updatedAt && !isFetching ? rel : isFetching ? 'updating…' : isError ? 'error' : ''.
        if (snapshot.UpdatedAt is { } ts && !snapshot.IsFetching)
        {
            return FormatRelativeTime(now - ts, localizer);
        }

        if (snapshot.IsFetching)
        {
            return localizer.GetString(DataFreshnessRegistration.UpdatingKey, DataFreshnessRegistration.UpdatingFallback);
        }

        return snapshot.IsError
            ? localizer.GetString(DataFreshnessRegistration.ErrorKey, DataFreshnessRegistration.ErrorFallback)
            : string.Empty;
    }

    private static string ResolveTitle(
        DataFreshnessSnapshot snapshot,
        bool reduceMotion,
        ILocalizer localizer,
        Func<DateTimeOffset, string> formatTime)
    {
        // web: isFetching && reduce ? 'Updating…' : updatedAt ? 'Last updated: {time}' : 'Never updated'.
        if (snapshot.IsFetching && reduceMotion)
        {
            return localizer.GetString(DataFreshnessRegistration.UpdatingTooltipKey, DataFreshnessRegistration.UpdatingTooltipFallback);
        }

        if (snapshot.UpdatedAt is { } ts)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(DataFreshnessRegistration.LastUpdatedKey, DataFreshnessRegistration.LastUpdatedFallback),
                formatTime(ts));
        }

        return localizer.GetString(DataFreshnessRegistration.NeverUpdatedKey, DataFreshnessRegistration.NeverUpdatedFallback);
    }

    /// <summary>
    /// The relative-age label for a value whose age is <paramref name="age"/> — the native port of the web
    /// <c>formatRelativeTime</c> tiers (web/src/components/data-display/DataFreshness.tsx L85-108): "just now"
    /// holds for the whole first minute (web avoids per-second ticking), then "{m}m ago" (&lt; 1 h), "{h}h ago"
    /// (&lt; 1 d), "{d}d ago" (&lt; 1 w) and "{w}w ago". The age is floored at zero whole seconds (web
    /// <c>Math.floor(…/1000)</c>). The phrases resolve through the localizer; the numeric value is substituted
    /// with the .NET positional <c>{0}</c> argument (the web i18next <c>{{m}}</c>).
    /// </summary>
    /// <param name="age">The elapsed time since the value was fetched.</param>
    /// <param name="localizer">The i18n facade the tier phrases resolve through.</param>
    public static string FormatRelativeTime(TimeSpan age, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var seconds = (long)Math.Max(0, Math.Floor(age.TotalSeconds));

        if (seconds < 60)
        {
            return localizer.GetString(DataFreshnessRegistration.JustNowKey, DataFreshnessRegistration.JustNowFallback);
        }

        if (seconds < 3600)
        {
            return Tier(DataFreshnessRegistration.MinutesKey, DataFreshnessRegistration.MinutesFallback, seconds / 60, localizer);
        }

        if (seconds < 86_400)
        {
            return Tier(DataFreshnessRegistration.HoursKey, DataFreshnessRegistration.HoursFallback, seconds / 3600, localizer);
        }

        if (seconds < 604_800)
        {
            return Tier(DataFreshnessRegistration.DaysKey, DataFreshnessRegistration.DaysFallback, seconds / 86_400, localizer);
        }

        return Tier(DataFreshnessRegistration.WeeksKey, DataFreshnessRegistration.WeeksFallback, seconds / 604_800, localizer);
    }

    private static string Tier(string key, string fallback, long value, ILocalizer localizer) =>
        string.Format(CultureInfo.CurrentCulture, localizer.GetString(key, fallback), value);
}

/// <summary>
/// PII-safe diagnostics for the DataFreshness surface (P1/S11 diagnostics contract). A freshness chip carries no
/// user content (only a status and a relative time), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the timestamp or status. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class DataFreshnessDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public DataFreshnessDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DataFreshness</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DataFreshnessRegistration.Slug}");
    }
}
