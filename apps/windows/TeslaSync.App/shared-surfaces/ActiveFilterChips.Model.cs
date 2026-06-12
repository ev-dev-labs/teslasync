using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Description of one active-filter chip — the native port of the web <c>FilterChipDescriptor</c> interface
/// (web/src/components/forms/ActiveFilterChips.tsx L36-L41: <c>{ key; label; value; onRemove }</c>). The
/// <see cref="Key"/> mirrors the URL search-param name so chips are stable and uniquely keyable; the
/// <see cref="Label"/> is the already-localized field name (e.g. "Vehicle"); the <see cref="Value"/> is the
/// user-facing value (e.g. "Model 3"); and <see cref="OnRemove"/> is the page-owned callback that deletes the
/// param (web <c>onRemove</c>, commonly <c>setFilter(undefined)</c>). URL state stays owned by the page — the
/// chip is a presentation surface that flows every removal back through this callback.
/// </summary>
public sealed class FilterChipDescriptor
{
    /// <summary>Creates a chip descriptor.</summary>
    /// <param name="key">Stable chip key, the URL search-param name (web <c>key</c>); must be non-empty.</param>
    /// <param name="label">Already-localized field name (web <c>label</c>).</param>
    /// <param name="value">User-facing value (web <c>value</c>).</param>
    /// <param name="onRemove">Page-owned removal callback (web <c>onRemove</c>).</param>
    public FilterChipDescriptor(string key, string label, string value, Action onRemove)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(label);
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(onRemove);

        Key = key;
        Label = label;
        Value = value;
        OnRemove = onRemove;
    }

    /// <summary>Stable chip key — the URL search-param name (web <c>key</c>).</summary>
    public string Key { get; }

    /// <summary>The already-localized field name shown before the value (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>The user-facing value shown after the label (web <c>value</c>).</summary>
    public string Value { get; }

    /// <summary>The page-owned removal callback (web <c>onRemove</c>).</summary>
    public Action OnRemove { get; }
}

/// <summary>
/// Canonical metadata + i18n keys for the active-filter-chips surface — the native mirror of the web
/// <c>ActiveFilterChips</c> (web/src/components/forms/ActiveFilterChips.tsx). The web component renders one
/// removable chip per active list-page filter ("Vehicle: Model 3 ×"), collapses chips past a visible cap into a
/// "+N more" popover, exposes an optional "Clear all" affordance and announces every removal through a polite
/// live region. This metadata carries the diagnostics slug the surface registers under and every render-contract
/// i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the web copy verbatim.
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves
/// against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class ActiveFilterChipsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ActiveFilterChips";

    /// <summary>i18n key for the chip-group accessible name (web <c>filters.activeLabel</c>).</summary>
    public const string ActiveLabelKey = "translation.filters.activeLabel";

    /// <summary>English fallback for <see cref="ActiveLabelKey"/> (web second arg, verbatim).</summary>
    public const string ActiveLabelFallback = "Active filters";

    /// <summary>i18n key for the polite removal announcement prefix (web <c>filters.removed</c>).</summary>
    public const string RemovedKey = "translation.filters.removed";

    /// <summary>English fallback for <see cref="RemovedKey"/> (web second arg, verbatim).</summary>
    public const string RemovedFallback = "Filter removed";

    /// <summary>i18n key for the clear-all announcement (web <c>filters.clearedAll</c>).</summary>
    public const string ClearedAllKey = "translation.filters.clearedAll";

    /// <summary>English fallback for <see cref="ClearedAllKey"/> (web second arg, verbatim).</summary>
    public const string ClearedAllFallback = "All filters cleared";

    /// <summary>i18n key for the overflow "+N more" trigger (web <c>filters.moreCount</c>).</summary>
    public const string MoreCountKey = "translation.filters.moreCount";

    /// <summary>
    /// English fallback for <see cref="MoreCountKey"/> (web second arg, verbatim — the <c>{{count}}</c> token is
    /// interpolated by <see cref="FormatMoreCount"/>).
    /// </summary>
    public const string MoreCountFallback = "+{{count}} more";

    /// <summary>i18n key for the overflow popover accessible name (web <c>filters.moreLabel</c>).</summary>
    public const string MoreLabelKey = "translation.filters.moreLabel";

    /// <summary>English fallback for <see cref="MoreLabelKey"/> (web second arg, verbatim).</summary>
    public const string MoreLabelFallback = "Additional active filters";

    /// <summary>i18n key for the clear-all button (web <c>filters.clearAll</c>).</summary>
    public const string ClearAllKey = "translation.filters.clearAll";

    /// <summary>English fallback for <see cref="ClearAllKey"/> (web second arg, verbatim).</summary>
    public const string ClearAllFallback = "Clear all";

    /// <summary>i18n key for the per-chip remove-button accessible name (web <c>filters.removeAria</c>).</summary>
    public const string RemoveAriaKey = "translation.filters.removeAria";

    /// <summary>
    /// English fallback for <see cref="RemoveAriaKey"/> (web second arg, verbatim — the <c>{{label}}</c> token is
    /// interpolated by <see cref="FormatRemoveAria"/>).
    /// </summary>
    public const string RemoveAriaFallback = "Remove filter {{label}}";

    /// <summary>Interpolate the overflow count into a localized template (web <c>{{count}}</c> token).</summary>
    public static string FormatMoreCount(string template, int count) =>
        Interpolate(template, "count", count.ToString(CultureInfo.CurrentCulture));

    /// <summary>Interpolate the field label into the remove-button accessible name (web <c>{{label}}</c> token).</summary>
    public static string FormatRemoveAria(string template, string label) => Interpolate(template, "label", label);

    /// <summary>
    /// Compose the polite removal announcement (web <c>`${t('filters.removed')}: ${descriptor.label}`</c>) from
    /// the localized prefix and the removed chip's label.
    /// </summary>
    public static string ComposeRemoval(string removedLabel, string filterLabel)
    {
        ArgumentNullException.ThrowIfNull(removedLabel);
        ArgumentNullException.ThrowIfNull(filterLabel);
        return string.Create(CultureInfo.CurrentCulture, $"{removedLabel}: {filterLabel}");
    }

    /// <summary>
    /// Substitute the web i18next token (<c>{{name}}</c>) and the native positional token (<c>{0}</c>) so the
    /// same projection works whether the string came from the resw catalog or the English fallback. Uses a literal
    /// replace (never <see cref="string.Format(IFormatProvider, string, object?)"/>) so a localized value carrying
    /// a stray brace can never throw a <see cref="System.FormatException"/>.
    /// </summary>
    private static string Interpolate(string template, string token, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(value);
        return template
            .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the active-filter-chips surface (P1/S11 diagnostics contract). Filter chips expose
/// user-chosen field values (which can be vehicle names, locations or other personal data), so the collector
/// records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the chip
/// keys, labels or values. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class ActiveFilterChipsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ActiveFilterChipsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActiveFilterChips</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={ActiveFilterChipsRegistration.Slug}"));
    }
}
