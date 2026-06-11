using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state of <c>SignalSelector</c>. The web component
/// (web/src/features/telemetry/components/SignalSelector.tsx) is a <b>controlled</b> wrapper over the shared
/// <c>ComboboxMulti</c>: the parent owns <c>options</c> / <c>value</c> / <c>onChange</c> and there is no data
/// fetch of any kind (its only hook is <c>useTranslation</c>). So — exactly like the sibling
/// <see cref="SettingsSearchState"/> client-only surface — there is deliberately <b>no</b> loading / error /
/// stale / offline branch: there is nothing to fetch, fail, go stale or fall offline. The only render branches
/// the source has are "there are signals to pick" and "there are none", each mapped to a state below and each
/// rendered explicitly so no surface is ever hidden (engineering rule #6).
/// </summary>
public enum SignalSelectorState
{
    /// <summary>No signals were supplied (web <c>options=[]</c>) — the field shows a friendly "no results" hint.</summary>
    Empty,

    /// <summary>At least one signal is available to pick (web <c>options.length &gt; 0</c>).</summary>
    Ready,
}

/// <summary>
/// Canonical registry metadata for the <c>SignalSelector</c> surface — the native mirror of the web component
/// (web/src/features/telemetry/components/SignalSelector.tsx). Centralises the stable id, the diagnostics slug,
/// the default chip cap (web <c>max = 5</c>), the Segoe Fluent search glyph standing in for the web Lucide
/// <c>Search</c> icon, and the component-level i18n keys. The keys are resolved through the P1/S10 facade
/// verbatim from the web source — the natural-language <c>Signals</c> / <c>Search signals…</c> keys, the
/// <c>help.signal.layers</c> tooltip key and its <c>.aria</c> companion, plus the three user-facing strings the
/// wrapped <c>ComboboxMulti</c> contributes (<c>combobox.removeChip</c> / <c>combobox.noResults</c> /
/// <c>combobox.maxReached</c>); each English fallback is the web source's literal default and doubles as the
/// headless / unit-test value. UI-free so the metadata is asserted in tests.
/// </summary>
public static class SignalSelectorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "signal-selector";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SignalSelector";

    /// <summary>Default chip cap (web <c>max = 5</c>) — keeps the chart legible. <c>null</c> means uncapped.</summary>
    public const int DefaultMax = 5;

    /// <summary>Segoe Fluent "Search" glyph — the native stand-in for the web Lucide <c>Search</c> icon.</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>Remove-chip glyph (Segoe Fluent "Cancel") — the native stand-in for the web Lucide <c>X</c>.</summary>
    public const string RemoveGlyph = "\uE711";

    /// <summary>i18n key for the "Signals" label word (web <c>t('Signals')</c>, a natural-language key).</summary>
    public const string SignalsKey = "Signals";

    /// <summary>English fallback for the label word — verbatim from the web source.</summary>
    public const string SignalsFallback = "Signals";

    /// <summary>i18n key for the field prompt (web <c>t('Search signals…')</c>, a natural-language key).</summary>
    public const string SearchPromptKey = "Search signals\u2026";

    /// <summary>English fallback for the field prompt — verbatim from the web source.</summary>
    public const string SearchPromptFallback = "Search signals\u2026";

    /// <summary>i18n key for the layer-help tooltip body (web <c>HelpTooltip i18nKey="help.signal.layers"</c>).</summary>
    public const string LayerHelpKey = "help.signal.layers";

    /// <summary>English fallback for the layer-help tooltip — verbatim from the web source <c>defaultValue</c>.</summary>
    public const string LayerHelpFallback =
        "TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), " +
        "and log (TimescaleDB history).";

    /// <summary>i18n key for the layer-help accessible name (web <c>help.signal.layers.aria</c>).</summary>
    public const string LayerHelpAriaKey = "help.signal.layers.aria";

    /// <summary>English fallback for the layer-help accessible name — verbatim from the web source.</summary>
    public const string LayerHelpAriaFallback = "More info about signal layers (L1, L2, log)";

    /// <summary>i18n key for a chip's remove-button accessible name (wrapped web <c>combobox.removeChip</c>).</summary>
    public const string RemoveChipKey = "combobox.removeChip";

    /// <summary>English fallback for the remove-chip name — verbatim from the web source ("Remove {{label}}").</summary>
    public const string RemoveChipFallback = "Remove {{label}}";

    /// <summary>The <c>{{label}}</c> interpolation token in <see cref="RemoveChipFallback"/>.</summary>
    public const string LabelToken = "{{label}}";

    /// <summary>i18n key for the empty-dropdown note (wrapped web <c>combobox.noResults</c>).</summary>
    public const string NoResultsKey = "combobox.noResults";

    /// <summary>English fallback for the empty-dropdown note — verbatim from the web source.</summary>
    public const string NoResultsFallback = "No results";

    /// <summary>i18n key for the cap-reached note (wrapped web <c>combobox.maxReached</c>).</summary>
    public const string MaxReachedKey = "combobox.maxReached";

    /// <summary>English fallback for the cap-reached note — verbatim from the web source.</summary>
    public const string MaxReachedFallback = "Maximum reached";

    /// <summary>The localized "Signals" label word (web <c>t('Signals')</c>).</summary>
    public static string Signals(ILocalizer localizer) =>
        Require(localizer).GetString(SignalsKey, SignalsFallback);

    /// <summary>The localized empty-field prompt (web <c>t('Search signals…')</c>).</summary>
    public static string SearchPrompt(ILocalizer localizer) =>
        Require(localizer).GetString(SearchPromptKey, SearchPromptFallback);

    /// <summary>The localized layer-help tooltip body (web <c>help.signal.layers</c>).</summary>
    public static string LayerHelp(ILocalizer localizer) =>
        Require(localizer).GetString(LayerHelpKey, LayerHelpFallback);

    /// <summary>The localized layer-help accessible name (web <c>help.signal.layers.aria</c>).</summary>
    public static string LayerHelpAria(ILocalizer localizer) =>
        Require(localizer).GetString(LayerHelpAriaKey, LayerHelpAriaFallback);

    /// <summary>The localized empty-dropdown note (web <c>combobox.noResults</c>).</summary>
    public static string NoResults(ILocalizer localizer) =>
        Require(localizer).GetString(NoResultsKey, NoResultsFallback);

    /// <summary>The localized cap-reached note (web <c>combobox.maxReached</c>).</summary>
    public static string MaxReached(ILocalizer localizer) =>
        Require(localizer).GetString(MaxReachedKey, MaxReachedFallback);

    /// <summary>
    /// The localized remove-button accessible name for a chip (web <c>t('combobox.removeChip', 'Remove
    /// {{label}}', { label })</c>): resolves the template through the facade then substitutes the signal name.
    /// </summary>
    public static string RemoveChipLabel(ILocalizer localizer, string signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        string template = Require(localizer).GetString(RemoveChipKey, RemoveChipFallback);
        return template.Replace(LabelToken, signal, StringComparison.Ordinal);
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projection helpers for the <c>SignalSelector</c> surface — the native port of the web component's
/// <c>ComboboxMulti</c> wiring (the visible <c>Signals (N / max)</c> label, the <c>getOptionLabel</c> /
/// <c>getOptionKey</c> identity mapping over raw signal-name strings, the <c>maxItems</c> cap that slices
/// <c>onChange</c>, and the dropdown's "hide already-selected rows" rule). No WinUI types — unit-tested without
/// a UI host.
/// </summary>
public static class SignalSelectorProjection
{
    /// <summary>
    /// The visible field label (web: <c>labelOverride ?? (max != null ? `${Signals} (${value.length} / ${max})`
    /// : `${Signals} (${value.length})`)</c>). A non-empty <paramref name="labelOverride"/> wins; otherwise the
    /// count is shown, with the cap appended only when <paramref name="max"/> is set.
    /// </summary>
    public static string ComposeLabel(string? labelOverride, string signalsWord, int selectedCount, int? max)
    {
        ArgumentNullException.ThrowIfNull(signalsWord);
        if (!string.IsNullOrEmpty(labelOverride))
        {
            return labelOverride;
        }

        int count = Math.Max(0, selectedCount);
        return max.HasValue
            ? string.Create(CultureInfo.InvariantCulture, $"{signalsWord} ({count} / {max.Value})")
            : string.Create(CultureInfo.InvariantCulture, $"{signalsWord} ({count})");
    }

    /// <summary>
    /// Project raw signal names into combobox options (web <c>getOptionLabel</c> / <c>getOptionKey</c> are both
    /// the identity over the signal string). Null / blank names are dropped and duplicate names collapse to their
    /// first occurrence, preserving the supplied order, so a malformed list never yields a blank or doubled row.
    /// </summary>
    public static IReadOnlyList<ComboOption> ToOptions(IReadOnlyList<string>? signals)
    {
        if (signals is null || signals.Count == 0)
        {
            return Array.Empty<ComboOption>();
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var options = new List<ComboOption>(signals.Count);
        foreach (string? signal in signals)
        {
            if (string.IsNullOrWhiteSpace(signal) || !seen.Add(signal))
            {
                continue;
            }

            options.Add(new ComboOption(signal, signal));
        }

        return options;
    }

    /// <summary>
    /// Enforce the chip cap (web <c>onChange(Number.isFinite(cap) ? next.slice(0, cap) : next)</c>): a
    /// <c>null</c> <paramref name="max"/> means uncapped; otherwise the first <paramref name="max"/> values are
    /// kept (blank / duplicate values dropped first so the cap counts real selections).
    /// </summary>
    public static IReadOnlyList<string> Cap(IReadOnlyList<string>? next, int? max)
    {
        if (next is null || next.Count == 0)
        {
            return Array.Empty<string>();
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<string>(next.Count);
        foreach (string? value in next)
        {
            if (string.IsNullOrWhiteSpace(value) || !seen.Add(value))
            {
                continue;
            }

            kept.Add(value);
            if (max.HasValue && kept.Count >= max.Value)
            {
                break;
            }
        }

        return kept;
    }

    /// <summary>True once the selection has reached the cap (web <c>atMax = max !== undefined &amp;&amp; value.length &gt;= max</c>).</summary>
    public static bool IsAtMax(int selectedCount, int? max) =>
        max.HasValue && selectedCount >= max.Value;

    /// <summary>
    /// The options offered in the dropdown — the supplied options with the already-selected ones removed (web
    /// <c>filteredOptions = base.filter(o =&gt; !selectedKeys.has(getOptionKey(o)))</c>), so a signal never
    /// appears twice. Order is preserved.
    /// </summary>
    public static IReadOnlyList<ComboOption> Available(
        IReadOnlyList<ComboOption> options, IReadOnlyCollection<string> selected)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(selected);
        if (options.Count == 0)
        {
            return Array.Empty<ComboOption>();
        }

        var chosen = new HashSet<string>(selected, StringComparer.Ordinal);
        if (chosen.Count == 0)
        {
            return options;
        }

        var available = new List<ComboOption>(options.Count);
        foreach (ComboOption option in options)
        {
            if (!chosen.Contains(option.Value))
            {
                available.Add(option);
            }
        }

        return available;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalSelector</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name or the chosen selection — so
/// a diagnostics line can never leak which signals a user inspected. Thread-safe.
/// </summary>
public sealed class SignalSelectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public SignalSelectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalSelector</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalSelectorRegistration.Slug}");
    }
}
