using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the bulk-actions toolbar surface — the native mirror of the web
/// <c>BulkActionsToolbar</c> (web/src/components/data-display/BulkActionsToolbar.tsx). The web component is a
/// presentational sticky bar shown above a list when one or more rows are selected: a polite count chip
/// (<c>"{{count}} selected"</c>), an optional item-noun + <c>"of {{total}}"</c> caption, a row of per-page
/// action buttons (each optionally routed through a confirm dialog) and a clear-selection button. This
/// metadata carries the diagnostics slug the surface registers under and every render-contract i18n
/// key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the web copy verbatim.
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves
/// against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class BulkActionsToolbarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "BulkActionsToolbar";

    /// <summary>i18n key for the region accessible name (web <c>bulk.toolbarLabel</c>).</summary>
    public const string ToolbarLabelKey = "translation.bulk.toolbarLabel";

    /// <summary>English fallback for <see cref="ToolbarLabelKey"/> (web second arg, verbatim).</summary>
    public const string ToolbarLabelFallback = "Bulk actions for selected items";

    /// <summary>i18n key for the polite selection-count chip (web <c>bulk.selected</c>).</summary>
    public const string SelectedKey = "translation.bulk.selected";

    /// <summary>
    /// English fallback for <see cref="SelectedKey"/> (web second arg, verbatim — the <c>{{count}}</c> token
    /// is interpolated by <see cref="FormatSelected"/>).
    /// </summary>
    public const string SelectedFallback = "{{count}} selected";

    /// <summary>i18n key for the "of {{total}}" caption (web <c>bulk.ofTotal</c>).</summary>
    public const string OfTotalKey = "translation.bulk.ofTotal";

    /// <summary>
    /// English fallback for <see cref="OfTotalKey"/> (web second arg, verbatim — the <c>{{total}}</c> token is
    /// interpolated by <see cref="FormatOfTotal"/>).
    /// </summary>
    public const string OfTotalFallback = "of {{total}}";

    /// <summary>i18n key for the clear-selection button (web <c>bulk.clear</c>).</summary>
    public const string ClearKey = "translation.bulk.clear";

    /// <summary>English fallback for <see cref="ClearKey"/> (web second arg, verbatim).</summary>
    public const string ClearFallback = "Clear selection";

    /// <summary>i18n key for the default item noun used when no <c>itemNoun</c> is supplied (web <c>bulk.itemDefault</c>).</summary>
    public const string ItemDefaultKey = "translation.bulk.itemDefault";

    /// <summary>English fallback for <see cref="ItemDefaultKey"/> (web second arg, verbatim).</summary>
    public const string ItemDefaultFallback = "item";

    /// <summary>
    /// Interpolate the selection count into a localized template — substitutes the web i18next token
    /// (<c>{{count}}</c>) and the native positional token (<c>{0}</c>) so the same projection works whether the
    /// string came from the resw catalog or the English fallback. Uses a literal replace (never
    /// <see cref="string.Format(IFormatProvider, string, object?)"/>) so a localized value carrying a stray
    /// brace can never throw a <see cref="System.FormatException"/>.
    /// </summary>
    public static string FormatSelected(string template, int count) => Interpolate(template, "count", count);

    /// <summary>Interpolate the visible-row total into a localized template (web <c>{{total}}</c> token).</summary>
    public static string FormatOfTotal(string template, int total) => Interpolate(template, "total", total);

    private static string Interpolate(string template, string token, int value)
    {
        ArgumentNullException.ThrowIfNull(template);
        string rendered = value.ToString(CultureInfo.CurrentCulture);
        return template
            .Replace("{{" + token + "}}", rendered, StringComparison.Ordinal)
            .Replace("{0}", rendered, StringComparison.Ordinal);
    }
}

/// <summary>
/// Visual intent of a bulk action — the native port of the web <c>BulkAction.variant</c> union
/// (web/src/components/data-display/BulkActionsToolbar.tsx L33: <c>'default' | 'danger'</c>). Drives the
/// button variant (<see cref="BulkActionConfirmIntent"/> for the confirm dialog and the secondary-vs-destructive
/// button style).
/// </summary>
public enum BulkActionVariant
{
    /// <summary>web <c>'default'</c> — a neutral secondary action.</summary>
    Default,

    /// <summary>web <c>'danger'</c> — a destructive action; confirms as danger and renders destructive.</summary>
    Danger,
}

/// <summary>
/// The urgency a confirm prompt is presented with — the native port of the web <c>variant</c> the toolbar
/// passes to <c>confirm()</c> (web L95: <c>action.variant === 'danger' ? 'danger' : 'warning'</c>).
/// </summary>
public enum BulkActionConfirmIntent
{
    /// <summary>web <c>'warning'</c> — a cautionary, non-destructive confirmation.</summary>
    Warning,

    /// <summary>web <c>'danger'</c> — a destructive confirmation (primary action de-emphasised).</summary>
    Danger,
}

/// <summary>
/// The confirm payload an action may declare — the native port of the web <c>BulkAction.confirm</c> object
/// (web L36-L40: <c>{ title; description; confirmLabel? }</c>). When present the toolbar routes the action
/// through the shared confirm dialog before invoking it.
/// </summary>
/// <param name="Title">The dialog title (web <c>confirm.title</c>).</param>
/// <param name="Description">The dialog body (web <c>confirm.description</c>, passed as the dialog message).</param>
/// <param name="ConfirmLabel">Optional confirm-button label (web <c>confirm.confirmLabel</c>).</param>
public sealed record BulkActionConfirmation(string Title, string Description, string? ConfirmLabel = null);

/// <summary>
/// The singular/plural noun used by the count caption — the native port of the web <c>itemNoun</c> prop
/// (web L61: <c>{ one: string; other: string }</c>). When supplied the toolbar shows the noun (and, when a
/// total is known, the "of {{total}}" caption); when absent the noun caption is not rendered.
/// </summary>
/// <param name="One">The noun used when exactly one item is selected (web <c>itemNoun.one</c>).</param>
/// <param name="Other">The noun used for any other count (web <c>itemNoun.other</c>).</param>
public sealed record BulkItemNoun(string One, string Other);

/// <summary>
/// A selected row identifier — the native port of the web selection element type
/// (web L53: <c>Array&lt;string | number&gt;</c>). Holds either a string id or a numeric id and renders both
/// through <see cref="ToString"/>, so a host can model whichever key its rows use. Construct with
/// <see cref="Text(string)"/> or <see cref="Number(long)"/>.
/// </summary>
public readonly record struct BulkSelectionId
{
    private readonly string? _text;
    private readonly long _number;
    private readonly bool _isNumber;

    private BulkSelectionId(string? text, long number, bool isNumber)
    {
        _text = text;
        _number = number;
        _isNumber = isNumber;
    }

    /// <summary>True when this id is the numeric variant (web <c>number</c>); otherwise it is a string id.</summary>
    public bool IsNumber => _isNumber;

    /// <summary>Create a string identifier (web <c>string</c> selection element).</summary>
    public static BulkSelectionId Text(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new BulkSelectionId(value, 0, false);
    }

    /// <summary>Create a numeric identifier (web <c>number</c> selection element).</summary>
    public static BulkSelectionId Number(long value) => new(null, value, true);

    /// <inheritdoc />
    public override string ToString() =>
        _isNumber ? _number.ToString(CultureInfo.InvariantCulture) : _text ?? string.Empty;
}

/// <summary>
/// PII-safe diagnostics for the bulk-actions toolbar (P1/S11 diagnostics contract). Bulk actions operate on
/// user-selected records, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never the selected ids, the action ids, or any record content. Thread-safe;
/// mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class BulkActionsToolbarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BulkActionsToolbarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BulkActionsToolbar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={BulkActionsToolbarRegistration.Slug}"));
    }
}
