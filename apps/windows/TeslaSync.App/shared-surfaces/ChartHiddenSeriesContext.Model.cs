namespace TeslaSync.App.SharedSurfaces.ChartHiddenSeriesContextSurface;

/// <summary>
/// Canonical metadata for the <c>ChartHiddenSeriesContext</c> shared surface — the native mirror of the
/// module-level constants in <c>web/src/components/charts/ChartHiddenSeriesContext.tsx</c> and its backing hook
/// <c>web/src/hooks/useHiddenSeries.ts</c>. The web source is an anonymous context bridge: it renders no titles,
/// labels or static copy, so there are no i18n keys to resolve and no interactive elements — only the diagnostics
/// slug, the URL parameter naming convention (<c>hidden_{chartKey}</c>) and the delimiter the comma-joined series
/// list uses. UI-free so the metadata is asserted headlessly.
/// </summary>
public static class ChartHiddenSeriesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChartHiddenSeriesContext";

    /// <summary>
    /// The query-parameter name prefix (web <c>HIDDEN_PARAM_PREFIX = 'hidden_'</c> in
    /// <c>useHiddenSeries.ts</c>). The hidden-series list for a chart lives under <c>hidden_{chartKey}</c>.
    /// </summary>
    public const string ParamPrefix = "hidden_";

    /// <summary>
    /// The list delimiter (web <c>useUrlArray</c> default <c>','</c>): the hidden <c>dataKey</c>s are stored as a
    /// single comma-joined value, so <c>?hidden_battery-degradation-trend=health,projected</c> is one bookmarkable
    /// view with two series toggled off.
    /// </summary>
    public const char Delimiter = ',';

    /// <summary>
    /// Compose the query-parameter name for a chart (web <c>`${HIDDEN_PARAM_PREFIX}${chartKey}`</c>).
    /// </summary>
    /// <param name="chartKey">The chart identifier passed to <c>useHiddenSeries</c> / the provider's <c>chartKey</c>.</param>
    public static string ParamName(string chartKey)
    {
        ArgumentNullException.ThrowIfNull(chartKey);
        return ParamPrefix + chartKey;
    }
}

/// <summary>
/// Pure parse / serialize for the comma-joined hidden-series list — the native port of the web
/// <c>useUrlArray</c> codec used by <c>useHiddenSeries</c> (<c>parse: raw === '' ? [] : raw.split(',')</c>,
/// <c>serialize: v.join(',')</c>) together with the toggle step's canonicalisation
/// (<c>Array.from(set).sort()</c>). Kept static and side-effect-free so the canonical round-trip is unit-testable
/// without a query store. The serialized form is always the de-duplicated, ordinal-sorted join so two links that
/// toggled the same series in a different order compare equal as plain strings (the web rationale: "toggling A
/// then B yields the same URL as toggling B then A").
/// </summary>
public static class HiddenSeriesSerialization
{
    /// <summary>
    /// Read the raw parameter value into the list of hidden <c>dataKey</c>s (web
    /// <c>raw === '' ? [] : raw.split(',')</c>). A <c>null</c> or empty value (the param is absent or blank)
    /// resolves to an empty list; otherwise the value is split on the delimiter. Segments are not otherwise
    /// altered, mirroring the web <c>String.prototype.split</c>; de-duplication happens when the caller builds the
    /// membership set.
    /// </summary>
    /// <param name="raw">The raw query-parameter value (web <c>searchParams.get(paramName)</c>); may be null.</param>
    public static IReadOnlyList<string> Parse(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return Array.Empty<string>();
        }

        return raw.Split(ChartHiddenSeriesRegistration.Delimiter);
    }

    /// <summary>
    /// Serialize the hidden <c>dataKey</c>s into the canonical comma-joined value (web toggle's
    /// <c>Array.from(set).sort()</c> followed by <c>useUrlArray</c>'s <c>v.join(',')</c>): de-duplicated, ordinal
    /// sorted (so the order matches JavaScript's default <c>Array.sort</c> over UTF-16 code units) and joined.
    /// An empty input yields the empty string, which the query store treats as "delete the parameter" — exactly
    /// like <c>useUrlArray</c>'s <c>omitDefault</c> dropping an empty array from the URL.
    /// </summary>
    /// <param name="keys">The hidden series keys (the membership set, in any order).</param>
    public static string Serialize(IEnumerable<string> keys)
    {
        ArgumentNullException.ThrowIfNull(keys);
        IEnumerable<string> canonical = keys
            .Distinct(StringComparer.Ordinal)
            .OrderBy(static key => key, StringComparer.Ordinal);
        return string.Join(ChartHiddenSeriesRegistration.Delimiter, canonical);
    }
}

/// <summary>
/// The accessibility contract for the <c>ChartHiddenSeriesProvider</c> view — the native expression of the web
/// source rendering a bare fragment (<c>&lt;&gt;{children(...)}&lt;/&gt;</c>). A context bridge has no visible
/// chrome and no interactive affordance of its own: the legend that consumes the state owns every label and
/// toggle. So the provider contributes no accessible node — the WinUI view maps this to
/// <c>AccessibilityView.Raw</c> so Narrator traverses straight through to the hosted chart. Exposed as a constant
/// so the (headless) accessibility test can assert the contract the WinUI view consumes.
/// </summary>
public static class ChartHiddenSeriesAccessibility
{
    /// <summary>
    /// Whether the provider contributes an accessible node of its own. Always <c>false</c>: the web source is a
    /// transparent fragment, so the native provider is an accessibility-raw structural wrapper.
    /// </summary>
    public const bool ProviderContributesAccessibleNode = false;
}

/// <summary>
/// PII-safe diagnostics for the <c>ChartHiddenSeriesContext</c> surface (P1/S11 diagnostics contract). Records
/// only operational counters with the surface slug — never the chart key or a series <c>dataKey</c>, since a chart
/// key can carry a feature path (e.g. <c>battery-degradation-trend</c>) and a series key can carry a metric label.
/// So a diagnostics line can never leak which chart a user is viewing or which series they hid. Thread-safe.
/// </summary>
public sealed class ChartHiddenSeriesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _toggled;
    private long _resets;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no chart key or series key is ever passed).</param>
    public ChartHiddenSeriesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of series-visibility toggles made (count only, never the key).</summary>
    public long Toggled => Interlocked.Read(ref _toggled);

    /// <summary>Number of times the hidden-series state was reset (count only).</summary>
    public long Resets => Interlocked.Read(ref _resets);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartHiddenSeriesContext</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChartHiddenSeriesRegistration.Slug}");
    }

    /// <summary>Record a series toggle, emitting <c>series.toggled slug=ChartHiddenSeriesContext</c> (no key).</summary>
    public void RecordToggled()
    {
        Interlocked.Increment(ref _toggled);
        _sink?.Invoke($"series.toggled slug={ChartHiddenSeriesRegistration.Slug}");
    }

    /// <summary>Record a reset, emitting <c>series.reset slug=ChartHiddenSeriesContext</c>.</summary>
    public void RecordReset()
    {
        Interlocked.Increment(ref _resets);
        _sink?.Invoke($"series.reset slug={ChartHiddenSeriesRegistration.Slug}");
    }
}
