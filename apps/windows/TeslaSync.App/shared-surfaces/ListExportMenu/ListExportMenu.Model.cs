using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the list export-menu surface — the native mirror of the web
/// <c>ListExportMenu</c> (web/src/components/forms/ListExportMenu.tsx). The web component is a presentational
/// CSV / JSON export control for tabular row data (distinct from <c>ChartExportMenu</c>, which deals with chart
/// images): a Download-icon trigger labelled "Export" that opens a menu with an optional scope chooser
/// (Visible / Selected radios, shown only when rows are selected) followed by "Download as CSV" and
/// "Download as JSON" items, each handing the chosen scope back to the caller. This metadata carries the
/// diagnostics slug the surface registers under and every render-contract i18n key/fallback the web source
/// passes to <c>t()</c>, so the native surface reproduces the web copy verbatim. Every key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses) and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class ListExportMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ListExportMenu";

    /// <summary>The i18next interpolation token the web count strings carry (<c>{{count}}</c>).</summary>
    public const string CountToken = "{{count}}";

    /// <summary>i18n key for the trigger label while disabled (web <c>listExport.disabledTooltip</c>).</summary>
    public const string DisabledTooltipKey = "translation.listExport.disabledTooltip";

    /// <summary>English fallback for <see cref="DisabledTooltipKey"/> (web second arg, verbatim).</summary>
    public const string DisabledTooltipFallback = "No data to export";

    /// <summary>i18n key for the trigger label / menu accessible name (web <c>listExport.menuLabel</c>).</summary>
    public const string MenuLabelKey = "translation.listExport.menuLabel";

    /// <summary>English fallback for <see cref="MenuLabelKey"/> (web second arg, verbatim).</summary>
    public const string MenuLabelFallback = "Export list";

    /// <summary>i18n key for the visible-scope radio with a count (web <c>listExport.visibleWithCount</c>).</summary>
    public const string VisibleWithCountKey = "translation.listExport.visibleWithCount";

    /// <summary>English fallback for <see cref="VisibleWithCountKey"/> (web second arg, verbatim — carries <c>{{count}}</c>).</summary>
    public const string VisibleWithCountFallback = "Visible ({{count}})";

    /// <summary>i18n key for the visible-scope radio without a count (web <c>listExport.visible</c>).</summary>
    public const string VisibleKey = "translation.listExport.visible";

    /// <summary>English fallback for <see cref="VisibleKey"/> (web second arg, verbatim).</summary>
    public const string VisibleFallback = "Visible";

    /// <summary>i18n key for the selected-scope radio (web <c>listExport.selectedWithCount</c>).</summary>
    public const string SelectedWithCountKey = "translation.listExport.selectedWithCount";

    /// <summary>English fallback for <see cref="SelectedWithCountKey"/> (web second arg, verbatim — carries <c>{{count}}</c>).</summary>
    public const string SelectedWithCountFallback = "Selected ({{count}})";

    /// <summary>i18n key for the trigger's visible text (web <c>listExport.button</c>).</summary>
    public const string ButtonKey = "translation.listExport.button";

    /// <summary>English fallback for <see cref="ButtonKey"/> (web second arg, verbatim).</summary>
    public const string ButtonFallback = "Export";

    /// <summary>i18n key for the scope group legend (web <c>listExport.scopeLegend</c>).</summary>
    public const string ScopeLegendKey = "translation.listExport.scopeLegend";

    /// <summary>English fallback for <see cref="ScopeLegendKey"/> (web second arg, verbatim).</summary>
    public const string ScopeLegendFallback = "Export scope";

    /// <summary>i18n key for the CSV item (web <c>listExport.csv</c>).</summary>
    public const string CsvKey = "translation.listExport.csv";

    /// <summary>English fallback for <see cref="CsvKey"/> (web second arg, verbatim).</summary>
    public const string CsvFallback = "Download as CSV";

    /// <summary>i18n key for the JSON item (web <c>listExport.json</c>).</summary>
    public const string JsonKey = "translation.listExport.json";

    /// <summary>English fallback for <see cref="JsonKey"/> (web second arg, verbatim).</summary>
    public const string JsonFallback = "Download as JSON";

    /// <summary>
    /// Substitute the web <c>{{count}}</c> interpolation token in a localized template — the native analogue of
    /// i18next's <c>t(key, { count })</c>. The number is rendered with <see cref="CultureInfo.InvariantCulture"/>
    /// so the projection is deterministic (matching i18next's default un-grouped numeric formatting).
    /// </summary>
    public static string FormatCount(string template, int count)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template.Replace(CountToken, count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }
}

/// <summary>
/// The export scope the menu hands back to the caller — the native port of the web <c>ExportScope</c> union
/// (web/src/components/forms/ListExportMenu.tsx L26: <c>'visible' | 'selected'</c>). Chosen through the scope
/// radios and passed to the CSV / JSON export action so the caller knows whether to serialise the visible
/// (filtered) result set or only the selected rows.
/// </summary>
public enum ListExportScope
{
    /// <summary>web <c>'visible'</c> — export the visible (filtered) result set; the default when nothing is selected.</summary>
    Visible,

    /// <summary>web <c>'selected'</c> — export only the selected rows; offered only when <c>selectedCount &gt; 0</c>.</summary>
    Selected,
}

/// <summary>
/// The export file formats the menu can fire, in the web render order (CSV then JSON). Used by the view to
/// build the items and by tests to assert composition without a XAML host.
/// </summary>
public enum ListExportFormat
{
    /// <summary>"Download as CSV" — first item (web <c>onExportCsv</c>).</summary>
    Csv,

    /// <summary>"Download as JSON" — second item (web <c>onExportJson</c>).</summary>
    Json,
}

/// <summary>
/// PII-safe diagnostics for the list export-menu surface (P1/S11 diagnostics contract). Export actions can
/// touch user files and row data, so the collector records ONLY the operational <see cref="RecordViewOpened"/>
/// signal with the surface slug — never a file path, the row payload, or the chosen scope. Thread-safe;
/// mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class ListExportMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ListExportMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ListExportMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={ListExportMenuRegistration.Slug}"));
    }
}
