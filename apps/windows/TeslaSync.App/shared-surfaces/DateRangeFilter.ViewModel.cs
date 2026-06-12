using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DateRangeFilter"/> view — the native port of the
/// web component body (web/src/components/forms/DateRangeFilter.tsx) and the embedded chip row
/// (web/src/components/forms/DatePresetChips.tsx). It mirrors the web source exactly: the two controlled date
/// values (<see cref="StartDate"/> / <see cref="EndDate"/>, ISO <c>yyyy-MM-dd</c> like the web
/// <c>&lt;input type="date"&gt;</c>); the optional Apply affordance (<see cref="HasApply"/> = web
/// <c>onApply</c> presence); the optional preset chip row (<see cref="ShowPresets"/> = web <c>presets</c>) over
/// the configured <see cref="PresetIds"/> (web <c>presetIds</c>, default <see cref="DatePresets.DefaultIds"/>);
/// the active-preset highlight (<see cref="ActiveId"/> = web <c>matchPresetId(startDate, endDate)</c>, matched
/// against the WHOLE catalogue so a window matching a non-visible preset highlights no chip); the projected
/// chips (<see cref="Chips"/>, catalogue order filtered to the visible ids exactly as web
/// <c>DATE_PRESETS.filter(...)</c>); and the <c>handlePreset</c> routing that either writes the range
/// atomically (<see cref="UsesAtomicRangeUpdate"/> = web <c>onRangeChange</c> present → <c>useUrlBatch</c>) or
/// fires the two granular setters, then requests Apply (web <c>onApply?.()</c>). The view binds the projected
/// labels + flags and never performs I/O. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
///
/// <para>
/// State coverage: the web source is a presentational picker driven by injected callbacks — its only data
/// sources are <c>useTranslation</c> (the i18n facade) and <c>useUrlBatch</c> (the atomic range writer seam),
/// neither of which is a data fetch, so it has no loading / error / stale / offline chrome to reproduce. The
/// branches it actually has are reproduced in full: the preset row shown vs hidden (web <c>{presets &amp;&amp; ...}</c>),
/// the Apply button shown vs hidden (web <c>{onApply &amp;&amp; ...}</c>), a chip active vs none
/// (web <c>activeId</c>), the atomic-range vs two-granular-setter selection path (web
/// <c>onRangeChange ? ... : ...</c>), a custom preset subset (web <c>presetIds</c>) and an empty / malformed
/// date window (web inputs unset → no active preset).
/// </para>
/// </summary>
public sealed class DateRangeFilterViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ILocalizer _localizer;
    private readonly IDateRangeUrlWriter _urlWriter;
    private readonly IReadOnlyList<string> _presetIds;
    private readonly bool _atomicRangeUpdate;

    private string _startDate;
    private string _endDate;
    private DateOnly _today;

    /// <summary>Creates the holder over the i18n facade and the surface's configuration.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="startDate">The initial inclusive start day, ISO <c>yyyy-MM-dd</c> (web <c>startDate</c>); empty when unset.</param>
    /// <param name="endDate">The initial inclusive end day, ISO <c>yyyy-MM-dd</c> (web <c>endDate</c>); empty when unset.</param>
    /// <param name="presetIds">The chip ids to surface (web <c>presetIds</c>); null defaults to <see cref="DatePresets.DefaultIds"/>.</param>
    /// <param name="showPresets">Whether the preset chip row is shown (web <c>presets</c>, default true).</param>
    /// <param name="hasApply">Whether an Apply handler is wired (web <c>onApply</c> presence); drives the Apply button + the post-select apply.</param>
    /// <param name="atomicRangeUpdate">Force the atomic single-write selection path (web <c>onRangeChange</c> present); implied when a non-inert <paramref name="urlWriter"/> is supplied.</param>
    /// <param name="urlWriter">The atomic range-writer seam (web <c>useUrlBatch</c>); null defaults to <see cref="InertDateRangeUrlWriter.Instance"/>.</param>
    /// <param name="today">The "today" anchor relative presets resolve against (web <c>new Date()</c>); null defaults to the local wall-clock day.</param>
    public DateRangeFilterViewModel(
        ILocalizer localizer,
        string startDate = "",
        string endDate = "",
        IReadOnlyList<string>? presetIds = null,
        bool showPresets = true,
        bool hasApply = false,
        bool atomicRangeUpdate = false,
        IDateRangeUrlWriter? urlWriter = null,
        DateOnly? today = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _startDate = startDate ?? string.Empty;
        _endDate = endDate ?? string.Empty;
        _presetIds = presetIds ?? DatePresets.DefaultIds;
        ShowPresets = showPresets;
        HasApply = hasApply;
        _urlWriter = urlWriter ?? InertDateRangeUrlWriter.Instance;
        _atomicRangeUpdate = atomicRangeUpdate || !ReferenceEquals(_urlWriter, InertDateRangeUrlWriter.Instance);
        _today = today ?? DateOnly.FromDateTime(DateTime.Today);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the new ISO value when the start day changes (web <c>onStartDateChange</c>).</summary>
    public event EventHandler<string>? StartDateChanged;

    /// <summary>Raised with the new ISO value when the end day changes (web <c>onEndDateChange</c>).</summary>
    public event EventHandler<string>? EndDateChanged;

    /// <summary>Raised with the resolved window when a preset is chosen on the atomic path (web <c>onRangeChange</c>).</summary>
    public event EventHandler<DateRangeSelection>? RangeChanged;

    /// <summary>Raised when Apply is requested — after a preset selection (web <c>onApply?.()</c>) or the Apply button.</summary>
    public event EventHandler? ApplyRequested;

    /// <summary>The inclusive start day, ISO <c>yyyy-MM-dd</c> (web <c>startDate</c>); empty when unset.</summary>
    public string StartDate => _startDate;

    /// <summary>The inclusive end day, ISO <c>yyyy-MM-dd</c> (web <c>endDate</c>); empty when unset.</summary>
    public string EndDate => _endDate;

    /// <summary>Whether the preset chip row is shown (web <c>presets</c>).</summary>
    public bool ShowPresets { get; }

    /// <summary>Whether the Apply button is shown and Apply is requested after a preset selection (web <c>onApply</c> presence).</summary>
    public bool HasApply { get; }

    /// <summary>Whether a preset selection writes the range in one atomic call (web <c>onRangeChange</c> present → <c>useUrlBatch</c>).</summary>
    public bool UsesAtomicRangeUpdate => _atomicRangeUpdate;

    /// <summary>The chip ids surfaced in the preset row, in the order supplied (web <c>presetIds</c>).</summary>
    public IReadOnlyList<string> PresetIds => _presetIds;

    /// <summary>The "today" anchor relative presets resolve against (web <c>new Date()</c>); setting it re-projects the chips.</summary>
    public DateOnly Today
    {
        get => _today;
        set
        {
            if (_today == value)
            {
                return;
            }

            _today = value;
            RaiseAll();
        }
    }

    /// <summary>The start-date input accessible name (web <c>t('date.range.start', 'Start date')</c>).</summary>
    public string StartLabel =>
        _localizer.GetString(DateRangeFilterRegistration.StartLabelKey, DateRangeFilterRegistration.StartLabelFallback);

    /// <summary>The end-date input accessible name (web <c>t('date.range.end', 'End date')</c>).</summary>
    public string EndLabel =>
        _localizer.GetString(DateRangeFilterRegistration.EndLabelKey, DateRangeFilterRegistration.EndLabelFallback);

    /// <summary>The Apply button label (web <c>t('date.range.apply', 'Apply')</c>).</summary>
    public string ApplyLabel =>
        _localizer.GetString(DateRangeFilterRegistration.ApplyKey, DateRangeFilterRegistration.ApplyFallback);

    /// <summary>The preset chip group's accessible name (web <c>t('date.preset.label', 'Quick date range')</c>).</summary>
    public string PresetGroupLabel =>
        _localizer.GetString(DateRangeFilterRegistration.PresetGroupLabelKey, DateRangeFilterRegistration.PresetGroupLabelFallback);

    /// <summary>
    /// The id of the preset whose resolved range matches the current window, or null when none does (web
    /// <c>activeId = matchPresetId(startDate, endDate)</c>). Matched against the WHOLE catalogue, so a window
    /// that matches a preset not in <see cref="PresetIds"/> highlights no chip — exactly as the web source.
    /// An empty or malformed start/end (web unset input) yields no active preset.
    /// </summary>
    public string? ActiveId
    {
        get
        {
            if (IsoDate.TryParse(_startDate, out DateOnly start) && IsoDate.TryParse(_endDate, out DateOnly end))
            {
                return DatePresets.Match(new DateRange(start, end), _today);
            }

            return null;
        }
    }

    /// <summary>
    /// The projected preset chips, in catalogue order filtered to <see cref="PresetIds"/> (web
    /// <c>DATE_PRESETS.filter(p =&gt; ids.has(p.id))</c>), each carrying its localized label and active flag.
    /// </summary>
    public IReadOnlyList<DatePresetChip> Chips
    {
        get
        {
            string? active = ActiveId;
            var ids = new HashSet<string>(_presetIds, StringComparer.Ordinal);
            var chips = new List<DatePresetChip>();
            foreach (DatePreset preset in DatePresets.All.Where(p => ids.Contains(p.Id)))
            {
                chips.Add(new DatePresetChip(
                    preset.Id,
                    _localizer.GetString(DateRangeFilterRegistration.PresetLabelKey(preset), preset.Fallback),
                    string.Equals(preset.Id, active, StringComparison.Ordinal)));
            }

            return chips;
        }
    }

    /// <summary>The button variant for a chip (web <c>variant={active ? 'primary' : 'ghost'}</c>; ghost → subtle).</summary>
    public static ButtonVariant ChipVariantFor(bool isActive) =>
        isActive ? ButtonVariant.Primary : ButtonVariant.Subtle;

    /// <summary>
    /// Set the start day and notify (web <c>onChange =&gt; onStartDateChange(value)</c>). Always raises
    /// <see cref="StartDateChanged"/> + re-projects (the web controlled input always forwards the change),
    /// so the host can mirror it to its own URL/query state.
    /// </summary>
    public void SetStartDate(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        _startDate = value;
        StartDateChanged?.Invoke(this, value);
        RaiseAll();
    }

    /// <summary>Set the end day and notify (web <c>onChange =&gt; onEndDateChange(value)</c>).</summary>
    public void SetEndDate(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        _endDate = value;
        EndDateChanged?.Invoke(this, value);
        RaiseAll();
    }

    /// <summary>
    /// Choose a quick-select preset — the native port of web <c>handlePreset</c>
    /// (web/src/components/forms/DateRangeFilter.tsx L70-L78). Resolves the preset's range relative to
    /// <see cref="Today"/>, then either writes it atomically (<see cref="UsesAtomicRangeUpdate"/> → web
    /// <c>onRangeChange({ start, end })</c>) or fires the two granular setters (web
    /// <c>onStartDateChange(start)</c> + <c>onEndDateChange(end)</c>), and finally requests Apply when an Apply
    /// handler is wired (web <c>onApply?.()</c>). An unknown id is a no-op (web filters to known presets).
    /// </summary>
    public void SelectPreset(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        if (DatePresets.Get(id) is not { } preset)
        {
            return;
        }

        DateRange range = preset.Resolve(_today);
        string start = IsoDate.ToIso(range.Start);
        string end = IsoDate.ToIso(range.End);

        if (_atomicRangeUpdate)
        {
            _startDate = start;
            _endDate = end;
            _urlWriter.WriteRange(start, end);
            RangeChanged?.Invoke(this, new DateRangeSelection(start, end));
            RaiseAll();
        }
        else
        {
            SetStartDate(start);
            SetEndDate(end);
        }

        if (HasApply)
        {
            ApplyRequested?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>Request Apply directly (web Apply button <c>onClick={onApply}</c>); raises <see cref="ApplyRequested"/>.</summary>
    public void RequestApply() => ApplyRequested?.Invoke(this, EventArgs.Empty);

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
