using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The chip size — the native port of the web <c>size</c> prop (web/src/components/forms/DatePresetChips.tsx
/// L28, <c>'sm' | 'md'</c>, default <c>'sm'</c>). Maps to the shared <c>ControlSize</c> scale at the view
/// boundary (<see cref="Sm"/> → Small, <see cref="Md"/> → Medium).
/// </summary>
public enum DatePresetChipSize
{
    /// <summary>Small chips — the web default (<c>'sm'</c>).</summary>
    Sm = 0,

    /// <summary>Medium chips (web <c>'md'</c>).</summary>
    Md,
}

/// <summary>
/// The mutually-exclusive render branches the surface shows — a faithful reproduction of the web
/// <c>DatePresetChips</c> (web/src/components/forms/DatePresetChips.tsx). The web component is presentational:
/// it calls only <c>useTranslation</c> and maps the static <c>DATE_PRESETS</c> table filtered by the supplied
/// <c>presetIds</c>, so it has no fetch lifecycle — no loading / error / stale / offline branch (exactly like
/// the other presentational shared surfaces such as <c>Delta</c> and the chip-strip <c>SuggestedPrompts</c>;
/// inventing those states would be drift). The honest union is therefore the populated chip row
/// (<see cref="Populated"/>) and, when the supplied ids resolve to no presets (the web renders an empty group),
/// a friendly empty surface (<see cref="Empty"/>) rather than a blank box.
/// </summary>
public enum DatePresetChipsState
{
    /// <summary>At least one preset resolved — render the chip row (web populated <c>role="group"</c>).</summary>
    Populated = 0,

    /// <summary>No preset resolved — render the friendly empty surface (never a blank box).</summary>
    Empty,
}

/// <summary>
/// The resolved selection a chip emits when picked — the native port of the web <c>DatePresetSelection</c>
/// interface (web/src/components/forms/DatePresetChips.tsx L15-L19): the preset <see cref="Id"/> and the
/// inclusive ISO date range (<see cref="Start"/> / <see cref="End"/>, <c>YYYY-MM-DD</c>) the web hands to
/// <c>onSelect</c>. Pure data.
/// </summary>
/// <param name="Id">The preset id (web <c>p.id</c>).</param>
/// <param name="Start">The inclusive range start as an ISO calendar day (web <c>r.start</c>, <c>YYYY-MM-DD</c>).</param>
/// <param name="End">The inclusive range end as an ISO calendar day (web <c>r.end</c>, <c>YYYY-MM-DD</c>).</param>
public sealed record DatePresetSelection(string Id, string Start, string End);

/// <summary>
/// One render-ready preset chip — the native projection of a single mapped <c>DATE_PRESETS</c> entry
/// (web/src/components/forms/DatePresetChips.tsx L54-L70). Carries the preset <see cref="Id"/> (the value handed
/// back through <c>onSelect</c>), the localized <see cref="Label"/> (the chip text and its Narrator name, the
/// web <c>t(p.i18nKey, p.fallback)</c>), and the <see cref="IsActive"/> highlight flag (web
/// <c>p.id === activeId</c>, which drives the primary-vs-ghost variant and <c>aria-pressed</c>). Immutable so
/// the view is a thin renderer.
/// </summary>
/// <param name="Id">The preset id (web <c>p.id</c>); the value emitted through the selection callback.</param>
/// <param name="Label">The localized chip label and Narrator name (web <c>t(p.i18nKey, p.fallback)</c>).</param>
/// <param name="IsActive">Whether this is the active preset (web <c>p.id === activeId</c> → primary + pressed).</param>
public sealed record DatePresetChipItem(string Id, string Label, bool IsActive);

/// <summary>
/// The render-ready view of the whole surface — the output of <see cref="DatePresetChipsProjection"/>. Carries
/// the resolved <see cref="State"/>, the localized group accessible name (web <c>role="group"</c>
/// <c>aria-label</c>), the chip <see cref="Size"/>, the projected <see cref="Items"/>, and the friendly
/// <see cref="EmptyMessage"/> shown when no preset resolves. Pure data — no WinUI types — so the projection is
/// unit-tested headlessly.
/// </summary>
/// <param name="State">Which render branch is showing (<see cref="DatePresetChipsState.Populated"/> / Empty).</param>
/// <param name="GroupName">The localized accessible name for the chip group (web <c>aria-label</c>).</param>
/// <param name="Size">The chip size to render at (web <c>size</c>).</param>
/// <param name="Items">The projected, localized chips (empty in the <see cref="DatePresetChipsState.Empty"/> state).</param>
/// <param name="EmptyMessage">The localized friendly empty-state message (no presets available).</param>
public sealed record DatePresetChipsDisplay(
    DatePresetChipsState State,
    string GroupName,
    DatePresetChipSize Size,
    IReadOnlyList<DatePresetChipItem> Items,
    string EmptyMessage)
{
    /// <summary>True when no preset resolved and the friendly empty surface is showing.</summary>
    public bool IsEmpty => State == DatePresetChipsState.Empty;

    /// <summary>True when at least one chip is showing (web populated branch).</summary>
    public bool HasItems => Items.Count > 0;
}

/// <summary>
/// Canonical metadata + localized strings for the date-preset-chips surface — the native analogue of the
/// module-level identity, the single <c>t('date.preset.label', 'Quick date range')</c> call (web
/// L52) and the per-chip <c>t(p.i18nKey, p.fallback)</c> calls (web L68). The i18n keys resolve through the
/// shared facade (P1/S10) and exist in the catalog (<c>apps/shared/i18n/catalog/en.json</c> +
/// <c>apps/windows/Strings/*/Resources.resw</c>) under the <c>translation.date.preset.*</c> and
/// <c>translation.common.noData</c> names. The per-preset key is the web key from
/// <see cref="DatePreset.I18nKey"/> (e.g. <c>date.preset.today</c>) under the catalog's <c>translation.</c>
/// namespace, exactly as react-i18next's default namespace resolves it.
/// </summary>
public static class DatePresetChipsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DatePresetChips";

    /// <summary>i18n key for the group's accessible name (web <c>date.preset.label</c>).</summary>
    public const string GroupLabelKey = "translation.date.preset.label";

    /// <summary>i18n key for the friendly empty-state message (the shared generic "no data" copy).</summary>
    public const string EmptyKey = "translation.common.noData";

    /// <summary>The catalog namespace prefix prepended to a preset's web i18n key (react-i18next default ns).</summary>
    public const string PresetKeyPrefix = "translation.";

    /// <summary>
    /// The localized group accessible name. Mirrors the web <c>aria-label={ariaLabel ?? t('date.preset.label',
    /// 'Quick date range')}</c> (web L52): an explicit <paramref name="ariaLabelOverride"/> wins, otherwise the
    /// localized default is used.
    /// </summary>
    public static string GroupName(ILocalizer localizer, string? ariaLabelOverride = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrEmpty(ariaLabelOverride)
            ? localizer.GetString(GroupLabelKey, "Quick date range")
            : ariaLabelOverride;
    }

    /// <summary>The localized friendly empty-state message (no presets available).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No data available");
    }

    /// <summary>
    /// The localized label for one preset — the native port of <c>t(p.i18nKey, p.fallback)</c> (web L68). The
    /// preset's web key (<see cref="DatePreset.I18nKey"/>, e.g. <c>date.preset.today</c>) is resolved under the
    /// catalog's <c>translation.</c> namespace; the preset's <see cref="DatePreset.Fallback"/> is the English
    /// default returned when the key is absent.
    /// </summary>
    public static string PresetLabel(ILocalizer localizer, DatePreset preset)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(preset);
        return localizer.GetString(PresetKeyPrefix + preset.I18nKey, preset.Fallback);
    }

    /// <summary>
    /// Format a calendar day as an ISO <c>YYYY-MM-DD</c> string — the native port of the web <c>iso(d)</c>
    /// helper (web/src/lib/datePresets.ts L23-L28), using invariant zero-padded calendar fields so the wire
    /// shape matches the web's <c>onSelect</c> payload byte-for-byte.
    /// </summary>
    public static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}

/// <summary>
/// Pure, UI-thread-free projection of an <see cref="IDatePresetChipsSource"/> into a render-ready
/// <see cref="DatePresetChipsDisplay"/>, plus the click-time range <see cref="Resolve"/> — the native port of
/// the web <c>DatePresetChips</c> body (web/src/components/forms/DatePresetChips.tsx L44-L72). It reuses the
/// shared <see cref="DatePresets"/> catalogue (the canonical native port of the web <c>DATE_PRESETS</c> table)
/// for the id filtering and the range maths, so the WinUI view and the unit tests share one source of truth. It
/// touches no view framework.
/// </summary>
public static class DatePresetChipsProjection
{
    /// <summary>
    /// Project <paramref name="source"/> into the localized, render-ready display. Reproduces the web map
    /// exactly: the supplied ids are filtered to the known presets in id order (web
    /// <c>DATE_PRESETS.filter(p =&gt; ids.has(p.id))</c>), each is localized and marked active when it matches
    /// the source's active id, and an id set that resolves to no presets yields the friendly empty state.
    /// </summary>
    public static DatePresetChipsDisplay Project(IDatePresetChipsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        string group = DatePresetChipsRegistration.GroupName(localizer, source.AriaLabel);
        IReadOnlyList<DatePreset> presets = DatePresets.ForIds(source.PresetIds ?? Array.Empty<string>());

        var items = new List<DatePresetChipItem>(presets.Count);
        foreach (DatePreset preset in presets)
        {
            bool active = string.Equals(preset.Id, source.ActiveId, StringComparison.Ordinal);
            items.Add(new DatePresetChipItem(
                preset.Id,
                DatePresetChipsRegistration.PresetLabel(localizer, preset),
                active));
        }

        DatePresetChipsState state = items.Count > 0
            ? DatePresetChipsState.Populated
            : DatePresetChipsState.Empty;

        return new DatePresetChipsDisplay(
            state,
            group,
            source.Size,
            items,
            DatePresetChipsRegistration.EmptyMessage(localizer));
    }

    /// <summary>
    /// Resolve the inclusive ISO range a chip emits when picked — the native port of the web onClick body
    /// (web L62-L65: <c>const r = p.resolve(); onSelect({ id: p.id, start: r.start, end: r.end })</c>). The
    /// range is derived from <paramref name="today"/> (the local calendar day, supplied by the source's clock)
    /// so the result is deterministic and testable. Returns <see langword="null"/> for an unknown id.
    /// </summary>
    public static DatePresetSelection? Resolve(string id, DateOnly today)
    {
        if (DatePresets.Get(id) is not { } preset)
        {
            return null;
        }

        DateRange range = preset.Resolve(today);
        return new DatePresetSelection(
            preset.Id,
            DatePresetChipsRegistration.Iso(range.Start),
            DatePresetChipsRegistration.Iso(range.End));
    }
}

/// <summary>
/// PII-safe diagnostics for the date-preset-chips surface (P1/S11 diagnostics contract). Records the
/// operational <see cref="RecordViewOpened"/> signal (the required <c>view.opened</c> event) and the
/// <see cref="RecordPresetSelected"/> signal carrying only the fixed, non-user-derived preset id token
/// (<c>today</c> / <c>7d</c> / <c>mtd</c> …) — never a resolved date, which could narrow a user's activity
/// window. Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class DatePresetChipsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _presetsSelected;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DatePresetChipsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a preset chip has been picked.</summary>
    public long PresetsSelected => Interlocked.Read(ref _presetsSelected);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DatePresetChips</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DatePresetChipsRegistration.Slug}");
    }

    /// <summary>
    /// Record that a preset chip was picked, emitting
    /// <c>preset.selected slug=DatePresetChips id={presetId}</c>. The id is a fixed UI token, never PII.
    /// </summary>
    public void RecordPresetSelected(string presetId)
    {
        Interlocked.Increment(ref _presetsSelected);
        _sink?.Invoke($"preset.selected slug={DatePresetChipsRegistration.Slug} id={presetId}");
    }
}
