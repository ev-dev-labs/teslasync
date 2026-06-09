namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="ByteSizeConverterViewModel"/> can be in — the native union of the
/// surfaces the web <c>ByteSizeConverterTool</c> renders
/// (web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx). The web surface is a pure
/// client-side calculator: its only "data source" is <c>useTranslation</c> and a synchronous
/// <c>useMemo</c> over the typed value + chosen unit — there is no query, no cache and no network. Its
/// single conditional render branch is <c>{conversions &amp;&amp; (&lt;grid/&gt;)}</c>, where
/// <c>conversions</c> is <c>null</c> for empty / non-numeric input and a five-cell projection otherwise.
/// So this surface has exactly the two states below, not the freshness chrome of a cache-then-network
/// read widget:
/// <list type="bullet">
///   <item><see cref="Empty"/> — the web <c>conversions === null</c> branch: no valid number yet, so the
///   inputs render with no conversion grid. The native view fills that region with a friendly empty hint
///   so it is never a blank box.</item>
///   <item><see cref="Populated"/> — the web truthy-<c>conversions</c> branch: a valid number, so the
///   five-unit conversion grid renders with the chosen unit highlighted.</item>
/// </list>
/// The data-widget freshness states do not exist here and are intentionally absent: <b>loading</b> (the
/// projection is synchronous and instant — there is nothing to await), <b>error</b> (the only failure is
/// non-numeric input, which the web folds into <see cref="Empty"/> exactly like an empty field; the view
/// adds a non-blocking validity affordance for screen readers), and <b>stale</b> / <b>offline</b> (there
/// is no fetched or cached value and no connectivity dependency, so a freshness window is meaningless).
/// This mirrors the way the sibling <c>BackendTool</c> documents why a fire-on-demand surface has a
/// different state union than a read surface.
/// </summary>
public enum ByteSizeConverterState
{
    /// <summary>No valid numeric input — render the inputs and a friendly empty hint, no conversion grid.</summary>
    Empty,

    /// <summary>A valid number was entered — render the five-cell conversion grid, the chosen unit highlighted.</summary>
    Populated,
}

/// <summary>
/// The ordered binary byte units the converter ladders through — the native mirror of the web
/// <c>BYTE_UNITS</c> constant (web/src/features/admin/components/devtools/constants.ts:
/// <c>['B', 'KB', 'MB', 'GB', 'TB']</c>). The list order is load-bearing: a unit's index is its power of
/// 1024, so element <c>i</c> equals <c>1024^i</c> bytes, exactly as the web computes
/// <c>Math.pow(1024, i)</c>. The symbols are dimensionless data labels (not translated in the web source),
/// so they are kept verbatim rather than routed through the i18n facade.
/// </summary>
public static class ByteSizeUnits
{
    /// <summary>The byte units in ascending magnitude (index = power of 1024). Mirrors web <c>BYTE_UNITS</c>.</summary>
    public static IReadOnlyList<string> All { get; } = new[] { "B", "KB", "MB", "GB", "TB" };

    /// <summary>The initial unit the converter selects (web <c>useState('B')</c>).</summary>
    public const string Default = "B";

    /// <summary>
    /// The index of <paramref name="unit"/> in <see cref="All"/>, or <c>-1</c> when it is not a known unit
    /// — the native mirror of the web <c>BYTE_UNITS.indexOf(unit)</c> guard (an unknown unit yields a
    /// <c>null</c> projection / <see cref="ByteSizeConverterState.Empty"/>). Uses ordinal comparison so the
    /// match is culture-invariant.
    /// </summary>
    public static int IndexOf(string? unit)
    {
        if (unit is null)
        {
            return -1;
        }

        for (int i = 0; i < All.Count; i++)
        {
            if (string.Equals(All[i], unit, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }
}

/// <summary>
/// One cell of the byte-size conversion grid — the native mirror of a single web projection entry
/// <c>{ unit, value }</c> (web <c>BYTE_UNITS.map(...)</c>), with the highlight flag the web computes inline
/// as <c>c.unit === unit</c>. <see cref="Value"/> is the already-formatted, locale-aware display string
/// (web <c>fmtNumber(bytes / 1024^i, i === 0 ? 0 : 4)</c>) so the view binds it verbatim and the projection
/// stays unit-testable without a render host.
/// </summary>
/// <param name="Unit">The byte unit symbol for this cell (web <c>u</c>).</param>
/// <param name="Value">The formatted converted magnitude in this unit (web <c>fmtNumber(...)</c>).</param>
/// <param name="IsActive">Whether this cell is the currently chosen unit (web <c>c.unit === unit</c>).</param>
public sealed record ByteConversion(string Unit, string Value, bool IsActive);

/// <summary>
/// Canonical metadata for the ByteSizeConverter surface — the native anchor for the web component at
/// web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx. The diagnostics slug is the
/// stable surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class ByteSizeConverterRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ByteSizeConverter";
}

/// <summary>
/// PII-safe diagnostics for the ByteSizeConverter surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the typed value, the chosen unit or
/// any computed conversion — so a diagnostics line can never leak operator input. Thread-safe.
/// </summary>
public sealed class ByteSizeConverterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ByteSizeConverterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ByteSizeConverter</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ByteSizeConverterRegistration.Slug}");
    }
}
