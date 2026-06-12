using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RangePicker"/> view — the native port of the web
/// component body (web/src/components/forms/RangePicker.tsx L112-L317). It mirrors the web prop set
/// (<see cref="Value"/>, <see cref="PresetIds"/>, <see cref="MinDate"/>, <see cref="MaxDate"/>,
/// <see cref="EnableCompare"/>, <see cref="Compare"/>, <see cref="PresetsOnly"/>) and reproduces the component's
/// behaviour: the committed <see cref="Value"/> drives the trigger's active-preset <see cref="TriggerLabel"/>
/// (web <c>activeLabel</c>), formatted <see cref="TriggerSubLabel"/> (web <c>triggerSubLabel</c>) and
/// <see cref="DayCountLabel"/> (web <c>dayCount</c>); the preset list is projected through
/// <see cref="Presets"/> + <see cref="ActivePresetId"/>; the calendar stages a range through
/// <see cref="StageDay"/> (web <c>setStaged</c>) which only commits on <see cref="Apply"/> (web
/// <c>handleApply</c>); <see cref="SelectPreset"/> commits immediately (web <c>handlePreset</c>);
/// <see cref="Cancel"/> / <see cref="NotifyClosed"/> discard the staged range (web <c>handleCancel</c> +
/// click-outside/Esc); and <see cref="SetCompare"/> announces the comparison toggle (web <c>onCompareChange</c>).
/// Every commit flows out through the change seam, never mutating <see cref="Value"/> itself — the web component
/// is fully controlled, so the host echoes the new range back through <see cref="Value"/>. The view binds the
/// projected labels and never performs I/O.
///
/// <para>
/// State coverage: the web source is presentational — its only data source is <c>useTranslation</c> and it
/// performs no fetch, so (like the peer presentational surfaces PlaybackSpeedMenu / ChartExportMenu) it has no
/// loading / error / stale / offline chrome to reproduce. The branches it actually has are reproduced in full:
/// the closed trigger (active-preset label vs the "Custom range" fallback when no preset matches), the open
/// popover, the preset list with active highlight, the calendar's staging (start-only vs a completed range),
/// the Apply-enabled (dirty) vs disabled (pristine) footer, the comparison toggle vs the day-count summary, and
/// the presets-only layout that hides the calendar + footer. Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </para>
/// </summary>
public sealed class RangePickerViewModel : INotifyPropertyChanged
{
    private readonly IRangePickerSink _sink;
    private readonly ILocalizer _localizer;
    private readonly CultureInfo _culture;

    private DateRange _value;
    private IReadOnlyList<string> _presetIds;
    private DateOnly? _minDate;
    private DateOnly? _maxDate;
    private bool _enableCompare;
    private bool _compare;
    private bool _presetsOnly;
    private DateOnly _today;

    private bool _isOpen;
    private DateOnly? _stagedFrom;
    private DateOnly? _stagedTo;

    private IReadOnlyList<RangePickerPreset> _presets;

    /// <summary>Creates the holder over its change seam (P1/S8), the i18n facade, the controlled props and the display culture.</summary>
    /// <param name="sink">The commit/compare seam (web <c>onChange</c> / <c>onCompareChange</c>); pass <see cref="NoOpRangePickerSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="value">The committed range (web <c>value</c>).</param>
    /// <param name="presetIds">The subset of preset ids to render (web <c>presetIds</c>); defaults to <see cref="DatePresets.DefaultIds"/>.</param>
    /// <param name="minDate">The floor for "All time" and selectable dates (web <c>minDate</c>).</param>
    /// <param name="maxDate">The inclusive upper bound for selectable dates (web <c>maxDate</c>); the view defaults it to today.</param>
    /// <param name="enableCompare">Whether the comparison toggle shows (web <c>enableCompare</c>).</param>
    /// <param name="compare">The current comparison flag (web <c>compare</c>).</param>
    /// <param name="presetsOnly">Whether the calendar + footer are hidden (web <c>presetsOnly</c>).</param>
    /// <param name="today">The anchor used to resolve/match relative presets (web <c>new Date()</c>); defaults to the local calendar day.</param>
    /// <param name="culture">The culture the trigger range string formats with (web <c>i18n.language</c>); defaults to <see cref="CultureInfo.CurrentCulture"/>.</param>
    public RangePickerViewModel(
        IRangePickerSink sink,
        ILocalizer localizer,
        DateRange value = default,
        IReadOnlyList<string>? presetIds = null,
        DateOnly? minDate = null,
        DateOnly? maxDate = null,
        bool enableCompare = false,
        bool compare = false,
        bool presetsOnly = false,
        DateOnly? today = null,
        CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _sink = sink;
        _localizer = localizer;
        _culture = culture ?? CultureInfo.CurrentCulture;
        _value = value;
        _presetIds = presetIds ?? DatePresets.DefaultIds;
        _minDate = minDate;
        _maxDate = maxDate;
        _enableCompare = enableCompare;
        _compare = compare;
        _presetsOnly = presetsOnly;
        _today = today ?? DateOnly.FromDateTime(DateTime.Today);
        _presets = BuildPresets();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The committed inclusive range (web <c>value</c>). Assigning it is the controlled-prop echo a host performs after a commit.</summary>
    public DateRange Value
    {
        get => _value;
        set
        {
            if (_value == value)
            {
                return;
            }

            _value = value;
            Raise(
                nameof(Value),
                nameof(ActivePresetId),
                nameof(TriggerLabel),
                nameof(TriggerSubLabel),
                nameof(DayCountLabel),
                nameof(TriggerTooltip),
                nameof(IsApplyEnabled));
        }
    }

    /// <summary>The subset of preset ids to render (web <c>presetIds</c>); rebuilds the projected <see cref="Presets"/>.</summary>
    public IReadOnlyList<string> PresetIds
    {
        get => _presetIds;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _presetIds = value;
            _presets = BuildPresets();
            Raise(nameof(PresetIds), nameof(Presets), nameof(ActivePresetId), nameof(TriggerLabel));
        }
    }

    /// <summary>The floor for the "All time" preset and selectable dates (web <c>minDate</c>).</summary>
    public DateOnly? MinDate
    {
        get => _minDate;
        set
        {
            if (Nullable.Equals(_minDate, value))
            {
                return;
            }

            _minDate = value;
            Raise(nameof(MinDate));
        }
    }

    /// <summary>The inclusive upper bound for selectable dates (web <c>maxDate</c>).</summary>
    public DateOnly? MaxDate
    {
        get => _maxDate;
        set
        {
            if (Nullable.Equals(_maxDate, value))
            {
                return;
            }

            _maxDate = value;
            Raise(nameof(MaxDate));
        }
    }

    /// <summary>Whether the comparison toggle shows in the footer (web <c>enableCompare</c>).</summary>
    public bool EnableCompare
    {
        get => _enableCompare;
        set
        {
            if (_enableCompare == value)
            {
                return;
            }

            _enableCompare = value;
            Raise(nameof(EnableCompare), nameof(ShowCompare));
        }
    }

    /// <summary>The current comparison flag (web <c>compare</c>); controlled by the host.</summary>
    public bool Compare
    {
        get => _compare;
        set
        {
            if (_compare == value)
            {
                return;
            }

            _compare = value;
            Raise(nameof(Compare));
        }
    }

    /// <summary>Whether the calendar + footer are hidden, leaving only the preset list (web <c>presetsOnly</c>).</summary>
    public bool PresetsOnly
    {
        get => _presetsOnly;
        set
        {
            if (_presetsOnly == value)
            {
                return;
            }

            _presetsOnly = value;
            Raise(nameof(PresetsOnly), nameof(ShowCalendar));
        }
    }

    /// <summary>The anchor used to resolve/match relative presets (web <c>new Date()</c>).</summary>
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
            Raise(nameof(Today), nameof(ActivePresetId), nameof(TriggerLabel));
        }
    }

    /// <summary>True when the popover is open (web <c>open</c>).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            Raise(nameof(IsOpen));
        }
    }

    /// <summary>The staged range start, or null when nothing is staged (web <c>staged.from</c>).</summary>
    public DateOnly? StagedFrom => _stagedFrom;

    /// <summary>The staged range end, or null when only a start has been picked (web <c>staged.to</c>).</summary>
    public DateOnly? StagedTo => _stagedTo;

    /// <summary>The staged endpoints as a complete range, or null when staging is incomplete.</summary>
    public DateRange? StagedRange => RangePickerLogic.StagedRange((_stagedFrom, _stagedTo));

    /// <summary>The id of the preset whose resolved range matches <see cref="Value"/>, or null for a custom range (web <c>activePresetId</c>).</summary>
    public string? ActivePresetId => DatePresets.Match(_value, _today);

    /// <summary>The trigger's visible label: the active preset's localized label, or the "Custom range" fallback (web <c>activeLabel</c>).</summary>
    public string TriggerLabel
    {
        get
        {
            string? activeId = ActivePresetId;
            if (activeId is not null && DatePresets.Get(activeId) is { } preset)
            {
                return _localizer.GetString(RangePickerRegistration.PresetLabelKey(preset), preset.Fallback);
            }

            return _localizer.GetString(RangePickerRegistration.PickRangeKey, RangePickerRegistration.PickRangeFallback);
        }
    }

    /// <summary>The trigger's formatted range sublabel (web <c>triggerSubLabel</c>).</summary>
    public string TriggerSubLabel => RangePickerLogic.FormatRange(_value, _culture);

    /// <summary>The inclusive day-count summary for the committed range (web <c>dayCount</c>).</summary>
    public string DayCountLabel => RangePickerRegistration.FormatDayCount(_localizer, _value.Days);

    /// <summary>The trigger's accessible name (web <c>aria-label={t('date.range.trigger', 'Date range')}</c>).</summary>
    public string TriggerAccessibleName =>
        _localizer.GetString(RangePickerRegistration.TriggerKey, RangePickerRegistration.TriggerFallback);

    /// <summary>The trigger's hover/title text — the formatted range and day count (web <c>title={`${triggerSubLabel} · ${dayCount}`}</c>).</summary>
    public string TriggerTooltip => TriggerSubLabel + " \u00b7 " + DayCountLabel;

    /// <summary>The popover's accessible name (web <c>ariaLabel={t('date.range.popoverLabel', 'Date range picker')}</c>).</summary>
    public string PopoverLabel =>
        _localizer.GetString(RangePickerRegistration.PopoverLabelKey, RangePickerRegistration.PopoverLabelFallback);

    /// <summary>The preset list's accessible name (web <c>aria-label={t('date.preset.label', 'Quick date range')}</c>).</summary>
    public string PresetListLabel =>
        _localizer.GetString(RangePickerRegistration.PresetListKey, RangePickerRegistration.PresetListFallback);

    /// <summary>The comparison toggle label (web <c>t('date.range.compare', 'Compare to previous period')</c>).</summary>
    public string CompareLabel =>
        _localizer.GetString(RangePickerRegistration.CompareKey, RangePickerRegistration.CompareFallback);

    /// <summary>The cancel button label (web <c>t('date.range.cancel', 'Cancel')</c>).</summary>
    public string CancelLabel =>
        _localizer.GetString(RangePickerRegistration.CancelKey, RangePickerRegistration.CancelFallback);

    /// <summary>The apply button label (web <c>t('date.range.apply', 'Apply')</c>).</summary>
    public string ApplyLabel =>
        _localizer.GetString(RangePickerRegistration.ApplyKey, RangePickerRegistration.ApplyFallback);

    /// <summary>The localized preset entries to render, in canonical order (web <c>presets.map(...)</c>).</summary>
    public IReadOnlyList<RangePickerPreset> Presets => _presets;

    /// <summary>Whether the calendar + footer render (web <c>!presetsOnly</c>).</summary>
    public bool ShowCalendar => !_presetsOnly;

    /// <summary>Whether the comparison toggle renders instead of the day-count summary (web <c>enableCompare</c>).</summary>
    public bool ShowCompare => _enableCompare;

    /// <summary>True when the staged range is complete and differs from <see cref="Value"/> — enables Apply (web <c>stagedDirty</c>).</summary>
    public bool IsApplyEnabled => RangePickerLogic.IsStagedDirty((_stagedFrom, _stagedTo), _value);

    /// <summary>The day-count summary for the staged range, or empty when staging is incomplete (web <c>stagedDays ? t(...) : ''</c>).</summary>
    public string StagedDaysLabel =>
        StagedRange is { } staged ? RangePickerRegistration.FormatDayCount(_localizer, staged.Days) : string.Empty;

    /// <summary>
    /// Open the popover and reset the staged range to the committed value (web <c>useEffect</c> on <c>open</c> →
    /// <c>setStaged({ from: value.start, to: value.end })</c>).
    /// </summary>
    public void Open()
    {
        _stagedFrom = _value.Start;
        _stagedTo = _value.End;
        IsOpen = true;
        RaiseStagedProjections();
    }

    /// <summary>Commit a clicked preset immediately and close (web <c>handlePreset</c>): resolve its range and announce it through the seam.</summary>
    public void SelectPreset(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        if (DatePresets.Get(id) is not { } preset)
        {
            return;
        }

        DateRange range = RangePickerLogic.ResolvePreset(preset, _today, _minDate);
        _sink.OnChange(range, preset.Id);
        DiscardAndClose();
    }

    /// <summary>
    /// Apply a calendar day tap to the staged range (web <c>onSelect={setStaged}</c>). Stages internally and never
    /// announces — only <see cref="Apply"/> commits.
    /// </summary>
    public void StageDay(DateOnly day)
    {
        (_stagedFrom, _stagedTo) = RangePickerLogic.StageDay((_stagedFrom, _stagedTo), day);
        RaiseStagedProjections();
    }

    /// <summary>Commit the staged range and close (web <c>handleApply</c>): announces the range through the seam when it is complete and dirty.</summary>
    public void Apply()
    {
        if (!IsApplyEnabled || StagedRange is not { } range)
        {
            return;
        }

        _sink.OnChange(range, null);
        DiscardAndClose();
    }

    /// <summary>Discard the staged range and close (web <c>handleCancel</c>).</summary>
    public void Cancel() => DiscardAndClose();

    /// <summary>Handle a light-dismiss / Escape close of the popover (web click-outside / Esc): discard the staged range.</summary>
    public void NotifyClosed() => DiscardAndClose();

    /// <summary>Announce the comparison toggle flip through the seam (web <c>onCompareChange</c>); the flag stays controlled by the host.</summary>
    public void SetCompare(bool next) => _sink.OnCompareChange(next);

    private void DiscardAndClose()
    {
        _stagedFrom = null;
        _stagedTo = null;
        IsOpen = false;
        RaiseStagedProjections();
    }

    private void RaiseStagedProjections() =>
        Raise(nameof(StagedFrom), nameof(StagedTo), nameof(StagedRange), nameof(StagedDaysLabel), nameof(IsApplyEnabled));

    private List<RangePickerPreset> BuildPresets()
    {
        var selected = new HashSet<string>(_presetIds, StringComparer.Ordinal);
        var list = new List<RangePickerPreset>();

        // Mirror the web filter: iterate the canonical DATE_PRESETS order and keep those in the requested set, so
        // a host that passes ids in a different order still renders them in the catalogue's order.
        foreach (DatePreset preset in DatePresets.All)
        {
            if (selected.Contains(preset.Id))
            {
                list.Add(new RangePickerPreset(
                    preset.Id,
                    _localizer.GetString(RangePickerRegistration.PresetLabelKey(preset), preset.Fallback)));
            }
        }

        return list;
    }

    private void Raise(params string[] names)
    {
        if (PropertyChanged is not { } handler)
        {
            return;
        }

        foreach (string name in names)
        {
            handler(this, new PropertyChangedEventArgs(name));
        }
    }
}
