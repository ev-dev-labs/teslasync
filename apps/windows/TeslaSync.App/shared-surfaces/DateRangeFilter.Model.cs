using System.Globalization;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the date-range-filter surface — the native mirror of the web
/// <c>DateRangeFilter</c> (web/src/components/forms/DateRangeFilter.tsx). The web component is a presentational
/// date-range picker: a pill holding two native date inputs (start "→" end), an optional Apply button and a
/// quick-select preset chip row (web <c>DatePresetChips</c>, web/src/components/forms/DatePresetChips.tsx),
/// driven entirely by injected callbacks (<c>onStartDateChange</c> / <c>onEndDateChange</c> /
/// <c>onRangeChange</c> / <c>onApply</c>). This metadata carries the diagnostics slug the surface registers
/// under and every render-contract i18n key/fallback the web source passes to <c>t()</c> — the filter's own
/// <c>date.range.*</c> keys plus the chip row's <c>date.preset.*</c> keys — so the native surface reproduces
/// the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge
/// expects and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class DateRangeFilterRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DateRangeFilter";

    /// <summary>The <c>translation.</c> catalog prefix every native resource key carries.</summary>
    public const string KeyPrefix = "translation.";

    /// <summary>i18n key for the start-date input accessible name (web <c>date.range.start</c>).</summary>
    public const string StartLabelKey = "translation.date.range.start";

    /// <summary>English fallback for <see cref="StartLabelKey"/> (web second arg, verbatim).</summary>
    public const string StartLabelFallback = "Start date";

    /// <summary>i18n key for the end-date input accessible name (web <c>date.range.end</c>).</summary>
    public const string EndLabelKey = "translation.date.range.end";

    /// <summary>English fallback for <see cref="EndLabelKey"/> (web second arg, verbatim).</summary>
    public const string EndLabelFallback = "End date";

    /// <summary>i18n key for the Apply button label (web <c>date.range.apply</c>).</summary>
    public const string ApplyKey = "translation.date.range.apply";

    /// <summary>English fallback for <see cref="ApplyKey"/> (web second arg, verbatim).</summary>
    public const string ApplyFallback = "Apply";

    /// <summary>i18n key for the preset chip group's accessible name (web <c>date.preset.label</c>).</summary>
    public const string PresetGroupLabelKey = "translation.date.preset.label";

    /// <summary>English fallback for <see cref="PresetGroupLabelKey"/> (web <c>DatePresetChips</c> default, verbatim).</summary>
    public const string PresetGroupLabelFallback = "Quick date range";

    /// <summary>
    /// The translation-catalog key for a preset chip's label — the web chip renders <c>t(p.i18nKey, p.fallback)</c>
    /// (web/src/components/forms/DatePresetChips.tsx L68) where <c>p.i18nKey</c> is the un-prefixed catalogue key
    /// (e.g. <c>date.preset.today</c>). The native resource bridge expects the <c>translation.</c> prefix, so this
    /// prepends it; the <see cref="DatePreset.Fallback"/> is used as the English fallback.
    /// </summary>
    public static string PresetLabelKey(DatePreset preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        return PresetLabelKey(preset.I18nKey);
    }

    /// <summary>The translation-catalog key for a preset's un-prefixed <paramref name="i18nKey"/> (web <c>p.i18nKey</c>).</summary>
    public static string PresetLabelKey(string i18nKey)
    {
        ArgumentNullException.ThrowIfNull(i18nKey);
        return i18nKey.StartsWith(KeyPrefix, StringComparison.Ordinal) ? i18nKey : KeyPrefix + i18nKey;
    }
}

/// <summary>
/// A resolved start/end pair — the native port of the web <c>onRangeChange</c> argument
/// (web/src/components/forms/DateRangeFilter.tsx L30: <c>{ start: string; end: string }</c>). Both values are
/// ISO <c>yyyy-MM-dd</c> calendar-day strings, matching the web <c>&lt;input type="date"&gt;</c> value shape.
/// Emitted by the atomic-update path so a host can wire it to a batched URL writer (web <c>useUrlBatch</c>).
/// </summary>
/// <param name="Start">The inclusive start day, ISO <c>yyyy-MM-dd</c> (web <c>range.start</c>).</param>
/// <param name="End">The inclusive end day, ISO <c>yyyy-MM-dd</c> (web <c>range.end</c>).</param>
public sealed record DateRangeSelection(string Start, string End);

/// <summary>
/// A single projected preset chip — the native port of one rendered web <c>DatePresetChips</c> button
/// (web/src/components/forms/DatePresetChips.tsx L54-L70). Carries the stable preset <see cref="Id"/> (web
/// <c>p.id</c> / chip key), the already-localized <see cref="Label"/> (web <c>t(p.i18nKey, p.fallback)</c>) and
/// the <see cref="IsActive"/> highlight flag (web <c>p.id === activeId</c>, which drives the web
/// <c>variant={active ? 'primary' : 'ghost'}</c> + <c>aria-pressed={active}</c>).
/// </summary>
/// <param name="Id">Stable preset id (web <c>p.id</c>); the chip key and the value passed to selection.</param>
/// <param name="Label">Already-localized chip label (web <c>t(p.i18nKey, p.fallback)</c>).</param>
/// <param name="IsActive">Whether this chip is the active preset (web <c>active = p.id === activeId</c>).</param>
public sealed record DatePresetChip(string Id, string Label, bool IsActive);

/// <summary>
/// PII-safe diagnostics for the date-range-filter surface (P1/S11 diagnostics contract). The filter's value is
/// a user-chosen date window, so the collector records ONLY the operational <see cref="RecordViewOpened"/>
/// signal with the surface slug — never the selected dates, the active preset, or any query content.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class DateRangeFilterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DateRangeFilterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DateRangeFilter</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={DateRangeFilterRegistration.Slug}"));
    }
}
