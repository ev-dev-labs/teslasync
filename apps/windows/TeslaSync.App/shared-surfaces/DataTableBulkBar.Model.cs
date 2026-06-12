using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the data-table bulk bar surface — the native mirror of the web
/// <c>DataTableBulkBar</c> (web/src/components/ui/DataTableBulkBar.tsx). The web component is a presentational
/// selection toolbar shown above a table once at least one row is selected: a polite count caption
/// (<c>"{{count}} selected"</c>), a consumer-supplied bulk-actions slot (web <c>children</c>) and a
/// clear-selection button with a leading close glyph. This metadata carries the diagnostics slug the surface
/// registers under and every render-contract i18n key/fallback the web source passes to <c>t()</c>, so the
/// native surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix
/// the WinUI resource bridge expects and already resolves in Strings/{en,he,ar}/Resources.resw. UI-free so it
/// is asserted without a XAML host.
/// </summary>
public static class DataTableBulkBarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DataTableBulkBar";

    /// <summary>i18n key for the region accessible name (web <c>table.bulkActions.region</c>).</summary>
    public const string RegionKey = "translation.table.bulkActions.region";

    /// <summary>English fallback for <see cref="RegionKey"/> (web second arg, verbatim).</summary>
    public const string RegionFallback = "Bulk actions";

    /// <summary>i18n key for the polite selection-count caption (web <c>table.bulkActions.selected</c>).</summary>
    public const string SelectedKey = "translation.table.bulkActions.selected";

    /// <summary>
    /// English fallback for <see cref="SelectedKey"/> (web second arg, verbatim — the <c>{{count}}</c> token is
    /// interpolated by <see cref="FormatSelected"/>). The shipped resw catalog stores the equivalent positional
    /// form (<c>{0} selected</c>), which <see cref="FormatSelected"/> also fills.
    /// </summary>
    public const string SelectedFallback = "{{count}} selected";

    /// <summary>i18n key for the clear-selection button (web <c>table.bulkActions.clear</c>).</summary>
    public const string ClearKey = "translation.table.bulkActions.clear";

    /// <summary>English fallback for <see cref="ClearKey"/> (web second arg, verbatim).</summary>
    public const string ClearFallback = "Clear selection";

    /// <summary>
    /// Interpolate the selection count into a localized template — substitutes the web i18next token
    /// (<c>{{count}}</c>) and the native positional token (<c>{0}</c>) so the same projection works whether the
    /// string came from the resw catalog (<c>{0} selected</c>) or the English fallback (<c>{{count}} selected</c>).
    /// Uses a literal replace (never <see cref="string.Format(IFormatProvider, string, object?)"/>) so a localized
    /// value carrying a stray brace can never throw a <see cref="System.FormatException"/>.
    /// </summary>
    public static string FormatSelected(string template, int count)
    {
        ArgumentNullException.ThrowIfNull(template);
        string rendered = count.ToString(CultureInfo.CurrentCulture);
        return template
            .Replace("{{count}}", rendered, StringComparison.Ordinal)
            .Replace("{0}", rendered, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the data-table bulk bar (P1/S11 diagnostics contract). The bar operates over
/// user-selected records, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never the selection count, the row ids, or any record content. Thread-safe; mirrors
/// the shipped surfaces' collectors.
/// </summary>
public sealed class DataTableBulkBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DataTableBulkBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DataTableBulkBar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={DataTableBulkBarRegistration.Slug}"));
    }
}
