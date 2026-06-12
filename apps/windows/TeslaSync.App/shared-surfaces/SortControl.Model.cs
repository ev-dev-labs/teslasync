using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A single sort-field choice — the native mirror of the web <c>SortOption&lt;F&gt;</c>
/// (web/src/components/forms/SortControl.tsx L8-L13): a stable field <see cref="Value"/> (also used in URL
/// state) and the localized, user-visible <see cref="Label"/>. The web component is generic over a
/// string-literal field union; the native surface uses the string field key directly.
/// </summary>
/// <param name="Value">Stable field key the list is sorted by.</param>
/// <param name="Label">Localized, user-visible label shown in the field dropdown.</param>
public sealed record SortControlOption(string Value, string Label);

/// <summary>
/// Canonical metadata + i18n keys for the SortControl surface — the native mirror of the web
/// <c>SortControl</c> (web/src/components/forms/SortControl.tsx). The web component is the shared sort
/// control: a field dropdown (the <c>@/components/ui/Select</c>) plus a direction toggle that flips
/// ascending / descending and shows an arrow so the current state is readable at a glance. This metadata
/// carries the diagnostics slug the surface registers under and every render-contract i18n key / fallback the
/// web source passes to <c>t()</c> (the four <c>sortControl.*</c> keys), so the native surface reproduces the
/// web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge
/// expects (the keys exist in <c>Strings/{en,ar,he}/Resources.resw</c>) and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class SortControlRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SortControl";

    /// <summary>i18n key for the ascending direction label (web <c>sortControl.ascending</c>).</summary>
    public const string AscendingKey = "translation.sortControl.ascending";

    /// <summary>English fallback for <see cref="AscendingKey"/> (web second arg, verbatim).</summary>
    public const string AscendingFallback = "Ascending";

    /// <summary>i18n key for the descending direction label (web <c>sortControl.descending</c>).</summary>
    public const string DescendingKey = "translation.sortControl.descending";

    /// <summary>English fallback for <see cref="DescendingKey"/> (web second arg, verbatim).</summary>
    public const string DescendingFallback = "Descending";

    /// <summary>i18n key for the field dropdown's accessible name (web <c>sortControl.fieldLabel</c>).</summary>
    public const string FieldLabelKey = "translation.sortControl.fieldLabel";

    /// <summary>English fallback for <see cref="FieldLabelKey"/> (web second arg, verbatim).</summary>
    public const string FieldLabelFallback = "Sort by";

    /// <summary>i18n key for the direction toggle's accessible-name prefix (web <c>sortControl.direction</c>).</summary>
    public const string DirectionKey = "translation.sortControl.direction";

    /// <summary>English fallback for <see cref="DirectionKey"/> (web second arg, verbatim).</summary>
    public const string DirectionFallback = "Sort direction";

    /// <summary>Localized ascending label (web <c>t('sortControl.ascending', 'Ascending')</c>).</summary>
    public static string Ascending(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(AscendingKey, AscendingFallback);
    }

    /// <summary>Localized descending label (web <c>t('sortControl.descending', 'Descending')</c>).</summary>
    public static string Descending(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DescendingKey, DescendingFallback);
    }

    /// <summary>Localized field-dropdown accessible name (web <c>t('sortControl.fieldLabel', 'Sort by')</c>).</summary>
    public static string FieldLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(FieldLabelKey, FieldLabelFallback);
    }

    /// <summary>Localized direction accessible-name prefix (web <c>t('sortControl.direction', 'Sort direction')</c>).</summary>
    public static string DirectionName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DirectionKey, DirectionFallback);
    }

    /// <summary>
    /// The localized direction label shown in the toggle's tooltip + title — the native port of the web
    /// <c>dirLabel</c> ternary (web L52-L55): ascending resolves to the ascending copy, everything else to the
    /// descending copy (the surface normalizes the direction to ascending / descending before projecting).
    /// </summary>
    public static string DirectionLabel(ILocalizer localizer, SortDirection direction)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return direction == SortDirection.Descending ? Descending(localizer) : Ascending(localizer);
    }

    /// <summary>
    /// The Narrator name for the direction toggle — the native port of the web
    /// <c>directionAriaLabel ?? `${t('sortControl.direction')}: ${dirLabel}`</c> (web L73). An explicit
    /// override is returned verbatim; otherwise the prefix and the localized direction label are joined.
    /// </summary>
    public static string DirectionAccessibleName(ILocalizer localizer, SortDirection direction, string? explicitLabel = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (!string.IsNullOrEmpty(explicitLabel))
        {
            return explicitLabel;
        }

        return $"{DirectionName(localizer)}: {DirectionLabel(localizer, direction)}";
    }
}

/// <summary>
/// The render-ready projection of the SortControl inputs — the native analogue of what the web
/// <c>SortControl</c> renders for a given <c>field</c> / <c>direction</c> / <c>options</c> set
/// (web/src/components/forms/SortControl.tsx L57-L88). The WinUI view consumes this and never recomputes; the
/// headless tests assert it directly. The web primitive is a controlled, presentational form control with no
/// query-freshness or connectivity concept, so it has no loading / error / stale / offline chrome to
/// reproduce; the only data-driven branch is the empty option set (<see cref="IsEmpty"/>), which the native
/// surface renders as a labeled, disabled picker rather than a blank box.
/// </summary>
public sealed class SortControlDisplay
{
    /// <summary>Segoe Fluent <c>ChevronUp</c> glyph for the ascending toggle (web <c>ArrowUp</c>).</summary>
    public const string AscendingGlyph = "\uE70E";

    /// <summary>Segoe Fluent <c>ChevronDown</c> glyph for the descending toggle (web <c>ArrowDown</c>).</summary>
    public const string DescendingGlyph = "\uE70D";

    internal SortControlDisplay(
        SortDirection direction,
        bool isAscending,
        string directionGlyph,
        string directionLabel,
        string directionAccessibleName,
        string fieldLabel,
        string selectedValue,
        string selectedLabel,
        bool hasSelection,
        bool isEmpty,
        IReadOnlyList<SortControlOption> options)
    {
        Direction = direction;
        IsAscending = isAscending;
        DirectionGlyph = directionGlyph;
        DirectionLabel = directionLabel;
        DirectionAccessibleName = directionAccessibleName;
        FieldLabel = fieldLabel;
        SelectedValue = selectedValue;
        SelectedLabel = selectedLabel;
        HasSelection = hasSelection;
        IsEmpty = isEmpty;
        Options = options;
    }

    /// <summary>The normalized sort direction (only ascending or descending).</summary>
    public SortDirection Direction { get; }

    /// <summary>True when the direction is ascending (web <c>direction === 'asc'</c>).</summary>
    public bool IsAscending { get; }

    /// <summary>The toggle's arrow glyph for the current direction.</summary>
    public string DirectionGlyph { get; }

    /// <summary>The localized direction label (the toggle's tooltip / title).</summary>
    public string DirectionLabel { get; }

    /// <summary>The Narrator name for the direction toggle button.</summary>
    public string DirectionAccessibleName { get; }

    /// <summary>The Narrator name for the field dropdown (web <c>aria-label</c> "Sort by").</summary>
    public string FieldLabel { get; }

    /// <summary>The currently selected field key (web <c>field</c>).</summary>
    public string SelectedValue { get; }

    /// <summary>The label of the selected option, or empty when the field matches no option.</summary>
    public string SelectedLabel { get; }

    /// <summary>True when <see cref="SelectedValue"/> resolves to one of the options.</summary>
    public bool HasSelection { get; }

    /// <summary>True when there are no options — the field picker renders disabled (never a blank box).</summary>
    public bool IsEmpty { get; }

    /// <summary>The field options to choose from (never null).</summary>
    public IReadOnlyList<SortControlOption> Options { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of the SortControl inputs into a render-ready <see cref="SortControlDisplay"/>
/// — the native port of the web <c>SortControl</c> component body (web/src/components/forms/SortControl.tsx
/// L40-L89). It normalizes the direction to ascending / descending, resolves the arrow glyph + every localized
/// string through the <see cref="ILocalizer"/>, and resolves the selected option's label. It touches no view
/// framework, so both the WinUI view and the unit tests share one source of truth.
/// </summary>
public static class SortControlProjection
{
    /// <summary>
    /// Project the inputs against <paramref name="localizer"/>. A null option set is treated as empty and a
    /// null field as the empty selection; any direction other than descending renders as ascending (web's
    /// <c>direction === 'asc'</c> default), so the toggle is always in a well-defined two-state.
    /// </summary>
    public static SortControlDisplay Project(
        IReadOnlyList<SortControlOption>? options,
        string? field,
        SortDirection direction,
        string? directionAccessibleLabel,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<SortControlOption> safeOptions = options ?? Array.Empty<SortControlOption>();
        bool isAscending = direction != SortDirection.Descending;
        SortDirection canonical = isAscending ? SortDirection.Ascending : SortDirection.Descending;
        string glyph = isAscending ? SortControlDisplay.AscendingGlyph : SortControlDisplay.DescendingGlyph;

        string directionLabel = SortControlRegistration.DirectionLabel(localizer, canonical);
        string directionName = SortControlRegistration.DirectionAccessibleName(localizer, canonical, directionAccessibleLabel);
        string fieldLabel = SortControlRegistration.FieldLabel(localizer);

        string selectedValue = field ?? string.Empty;
        SortControlOption? selected = FindOption(safeOptions, selectedValue);

        return new SortControlDisplay(
            canonical,
            isAscending,
            glyph,
            directionLabel,
            directionName,
            fieldLabel,
            selectedValue,
            selected?.Label ?? string.Empty,
            selected is not null,
            safeOptions.Count == 0,
            safeOptions);
    }

    private static SortControlOption? FindOption(IReadOnlyList<SortControlOption> options, string value)
    {
        for (int i = 0; i < options.Count; i++)
        {
            if (string.Equals(options[i].Value, value, StringComparison.Ordinal))
            {
                return options[i];
            }
        }

        return null;
    }
}

/// <summary>
/// PII-safe diagnostics for the SortControl surface (P1/S11 diagnostics contract). The control's field keys
/// and labels can carry user-facing content, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the selected field, the direction or
/// the option labels. Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class SortControlDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SortControlDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SortControl</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SortControlRegistration.Slug}");
    }
}
