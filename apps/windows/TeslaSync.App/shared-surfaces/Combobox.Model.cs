using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the combobox surface — the native mirror of the web
/// <c>Combobox</c> (web/src/components/forms/Combobox.tsx). The web component is the shared WAI-ARIA
/// "type to filter then pick" autocomplete primitive: an editable input carrying the combobox role, a
/// trailing loading spinner / clear (×) / chevron-toggle cluster, and a listbox popup of options capped at
/// <c>maxVisibleOptions</c> with a "more — refine search" overflow row, a "No results" empty row and a
/// "Loading" busy row. As the user types it announces the live result count through the shared announcer.
/// This metadata carries the diagnostics slug the surface registers under and every render-contract i18n
/// key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the web copy verbatim.
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the keys
/// already exist in <c>Strings/en/Resources.resw</c>) and resolves against the English fallback headlessly.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class ComboboxRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Combobox";

    /// <summary>The default cap on the number of options rendered in the listbox (web <c>maxVisibleOptions = 50</c>).</summary>
    public const int DefaultMaxVisibleOptions = 50;

    /// <summary>The default async fetch debounce in milliseconds (web <c>asyncDebounceMs = 200</c>).</summary>
    public const int DefaultAsyncDebounceMs = 200;

    /// <summary>i18n key for the empty / no-matches row + announcement (web <c>combobox.noResults</c>).</summary>
    public const string NoResultsKey = "translation.combobox.noResults";

    /// <summary>English fallback for <see cref="NoResultsKey"/> (web second arg, verbatim).</summary>
    public const string NoResultsFallback = "No results";

    /// <summary>i18n key for the single-result announcement (web <c>combobox.resultsCountOne</c>).</summary>
    public const string ResultsCountOneKey = "translation.combobox.resultsCountOne";

    /// <summary>English fallback for <see cref="ResultsCountOneKey"/> (web second arg, verbatim).</summary>
    public const string ResultsCountOneFallback = "1 result";

    /// <summary>i18n key for the multi-result announcement (web <c>combobox.resultsCount</c>).</summary>
    public const string ResultsCountKey = "translation.combobox.resultsCount";

    /// <summary>
    /// English fallback for <see cref="ResultsCountKey"/> (web second arg, verbatim — the <c>{{count}}</c>
    /// token is interpolated by <see cref="FormatResultsCount"/>).
    /// </summary>
    public const string ResultsCountFallback = "{{count}} results";

    /// <summary>i18n key for the busy spinner / loading row (web <c>combobox.loading</c>).</summary>
    public const string LoadingKey = "translation.combobox.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/> (web second arg, verbatim).</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the clear (×) button accessible name (web <c>combobox.clearAria</c>).</summary>
    public const string ClearAriaKey = "translation.combobox.clearAria";

    /// <summary>English fallback for <see cref="ClearAriaKey"/> (web second arg, verbatim).</summary>
    public const string ClearAriaFallback = "Clear selection";

    /// <summary>i18n key for the chevron toggle's accessible name while the listbox is open (web <c>combobox.closeListAria</c>).</summary>
    public const string CloseListAriaKey = "translation.combobox.closeListAria";

    /// <summary>English fallback for <see cref="CloseListAriaKey"/> (web second arg, verbatim).</summary>
    public const string CloseListAriaFallback = "Hide options";

    /// <summary>i18n key for the chevron toggle's accessible name while the listbox is closed (web <c>combobox.openListAria</c>).</summary>
    public const string OpenListAriaKey = "translation.combobox.openListAria";

    /// <summary>English fallback for <see cref="OpenListAriaKey"/> (web second arg, verbatim).</summary>
    public const string OpenListAriaFallback = "Show options";

    /// <summary>i18n key for the capped-list overflow row (web <c>combobox.moreHidden</c>).</summary>
    public const string MoreHiddenKey = "translation.combobox.moreHidden";

    /// <summary>
    /// English fallback for <see cref="MoreHiddenKey"/> (web second arg, verbatim — em dash included; the
    /// <c>{{count}}</c> token is interpolated by <see cref="FormatMoreHidden"/>).
    /// </summary>
    public const string MoreHiddenFallback = "{{count}} more \u2014 refine search";

    /// <summary>Interpolate the result count into the localized "{{count}} results" template (web i18next <c>{{count}}</c>).</summary>
    public static string FormatResultsCount(string template, int count) => Interpolate(template, "count", count);

    /// <summary>Interpolate the hidden-option count into the localized "more — refine search" template (web i18next <c>{{count}}</c>).</summary>
    public static string FormatMoreHidden(string template, int count) => Interpolate(template, "count", count);

    /// <summary>
    /// Choose + interpolate the localized result-count announcement (web L289-L294): the no-results copy at
    /// zero, the singular copy at one, and the interpolated plural copy otherwise. Mirrors the web ternary so
    /// the announcer voices the same string the web source builds.
    /// </summary>
    public static string ResultsAnnouncement(
        int count,
        string noResultsTemplate,
        string oneTemplate,
        string manyTemplate) => count switch
        {
            0 => noResultsTemplate,
            1 => oneTemplate,
            _ => FormatResultsCount(manyTemplate, count),
        };

    private static string Interpolate(string template, string token, int value)
    {
        ArgumentNullException.ThrowIfNull(template);
        string rendered = value.ToString(CultureInfo.CurrentCulture);

        // Substitute both the web i18next token ({{count}}) and the native positional token ({0}) so the
        // same projection works whether the string came from the resw catalog (which uses {0}) or the
        // English fallback (which uses {{count}}). A literal replace (never string.Format) means a localized
        // value carrying a stray brace can never throw a FormatException.
        return template
            .Replace("{{" + token + "}}", rendered, StringComparison.Ordinal)
            .Replace("{0}", rendered, StringComparison.Ordinal);
    }
}

/// <summary>
/// The mutually-exclusive content state the listbox renders — the native projection of the web source's
/// dropdown branches (web/src/components/forms/Combobox.tsx L623-L688). The web component shows exactly one of
/// these at the head of the open listbox: the busy row while a fetch is in flight and no options have arrived
/// yet (<see cref="Loading"/>, web L640), the friendly empty row when the resolved query matched nothing
/// (<see cref="Empty"/>, web L630 — the async loader's error path also lands here because its <c>catch</c>
/// resolves to an empty list, web L258), or the option rows themselves (<see cref="Results"/>). The web
/// primitive is a controlled type-ahead with no query-freshness or connectivity concept, so it has no
/// stale / offline chrome to reproduce; the three states below are the complete set the source renders.
/// </summary>
public enum ComboboxResultStatus
{
    /// <summary>A fetch is in flight and no options are shown yet — the busy row (web <c>loading</c> with empty options).</summary>
    Loading,

    /// <summary>The query resolved to no options — the "No results" row (web <c>visibleOptions.length === 0 &amp;&amp; !loading</c>).</summary>
    Empty,

    /// <summary>One or more options are shown — the option rows (web <c>visibleOptions.map(...)</c>).</summary>
    Results,
}

/// <summary>
/// PII-safe diagnostics for the combobox surface (P1/S11 diagnostics contract). A combobox's query text and
/// option labels can carry arbitrary user-facing content (addresses, vehicle names, signal names), so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug —
/// never the query, the options, or the committed value. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class ComboboxDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ComboboxDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Combobox</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={ComboboxRegistration.Slug}"));
    }
}
