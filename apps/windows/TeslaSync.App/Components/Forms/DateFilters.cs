using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Quick date-preset chip row (mirrors the web <c>DatePresetChips</c>). Renders a
/// selectable chip per id in <see cref="PresetIds"/> using the catalogue in
/// <see cref="DatePresets"/>; localized labels come from <see cref="Labels"/>
/// (falling back to the catalogue's English text). Selecting a chip raises
/// <see cref="PresetSelected"/> with the preset id.
/// </summary>
public partial class TsDatePresetChips : ContentControl
{
    private readonly StackPanel _row = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly Dictionary<string, ToggleButton> _buttons = new(StringComparer.Ordinal);
    private bool _suppress;

    public static readonly DependencyProperty PresetIdsProperty = DependencyProperty.Register(
        nameof(PresetIds), typeof(IReadOnlyList<string>), typeof(TsDatePresetChips),
        new PropertyMetadata(null, OnPresetsChanged));

    public static readonly DependencyProperty LabelsProperty = DependencyProperty.Register(
        nameof(Labels), typeof(IReadOnlyDictionary<string, string>), typeof(TsDatePresetChips),
        new PropertyMetadata(null, OnPresetsChanged));

    public static readonly DependencyProperty SelectedIdProperty = DependencyProperty.Register(
        nameof(SelectedId), typeof(string), typeof(TsDatePresetChips),
        new PropertyMetadata(null, OnSelectedChanged));

    public TsDatePresetChips()
    {
        IsTabStop = false;
        Content = new ScrollViewer
        {
            Content = _row,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Rebuild();
    }

    /// <summary>Raised when a preset chip is selected.</summary>
    public event EventHandler<string>? PresetSelected;

    /// <summary>The preset ids to render (defaults to <see cref="DatePresets.DefaultIds"/>).</summary>
    public IReadOnlyList<string>? PresetIds
    {
        get => (IReadOnlyList<string>?)GetValue(PresetIdsProperty);
        set => SetValue(PresetIdsProperty, value);
    }

    /// <summary>Optional localized preset id → label map.</summary>
    public IReadOnlyDictionary<string, string>? Labels
    {
        get => (IReadOnlyDictionary<string, string>?)GetValue(LabelsProperty);
        set => SetValue(LabelsProperty, value);
    }

    /// <summary>The currently selected preset id, or null.</summary>
    public string? SelectedId
    {
        get => (string?)GetValue(SelectedIdProperty);
        set => SetValue(SelectedIdProperty, value);
    }

    private static void OnPresetsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDatePresetChips)d).Rebuild();

    private static void OnSelectedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDatePresetChips)d).SyncSelection();

    private void Rebuild()
    {
        _row.Children.Clear();
        _buttons.Clear();
        var ids = PresetIds ?? DatePresets.DefaultIds;
        foreach (var preset in DatePresets.ForIds(ids))
        {
            var id = preset.Id;
            var label = Labels is not null && Labels.TryGetValue(id, out var localized) ? localized : preset.Fallback;
            var chip = new ToggleButton { Content = label, IsChecked = id == SelectedId };
            AutomationProperties.SetName(chip, label);
            chip.Click += (_, _) =>
            {
                if (_suppress)
                {
                    return;
                }

                SelectedId = id;
                PresetSelected?.Invoke(this, id);
            };
            _buttons[id] = chip;
            _row.Children.Add(chip);
        }

        SyncSelection();
    }

    private void SyncSelection()
    {
        _suppress = true;
        foreach (var (id, chip) in _buttons)
        {
            chip.IsChecked = id == SelectedId;
        }

        _suppress = false;
    }
}

/// <summary>
/// Inclusive start/end date range picker (mirrors the web <c>RangePicker</c>).
/// Two native <see cref="CalendarDatePicker"/>s produce a normalized
/// <see cref="DateRange"/>; <see cref="RangeChanged"/> fires on every committed
/// change.
/// </summary>
public partial class TsRangePicker : ContentControl
{
    private readonly CalendarDatePicker _start = new();
    private readonly CalendarDatePicker _end = new();
    private bool _suppress;

    public static readonly DependencyProperty RangeProperty = DependencyProperty.Register(
        nameof(Range), typeof(DateRange), typeof(TsRangePicker),
        new PropertyMetadata(default(DateRange), OnRangeChanged));

    public static readonly DependencyProperty StartLabelProperty = DependencyProperty.Register(
        nameof(StartLabel), typeof(string), typeof(TsRangePicker),
        new PropertyMetadata("Start", OnLabelsChanged));

    public static readonly DependencyProperty EndLabelProperty = DependencyProperty.Register(
        nameof(EndLabel), typeof(string), typeof(TsRangePicker),
        new PropertyMetadata("End", OnLabelsChanged));

    public TsRangePicker()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _start.DateChanged += (_, _) => Commit();
        _end.DateChanged += (_, _) => Commit();

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(_start);
        row.Children.Add(new Text { Value = "\u2013", VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(_end);
        Content = row;
        ApplyLabels();
        ApplyRange();
    }

    /// <summary>Raised when the committed range changes.</summary>
    public event EventHandler<DateRange>? RangeChanged;

    /// <summary>The selected inclusive range.</summary>
    public DateRange Range
    {
        get => (DateRange)GetValue(RangeProperty);
        set => SetValue(RangeProperty, value);
    }

    /// <summary>Localized "start" picker header.</summary>
    public string StartLabel
    {
        get => (string)GetValue(StartLabelProperty);
        set => SetValue(StartLabelProperty, value);
    }

    /// <summary>Localized "end" picker header.</summary>
    public string EndLabel
    {
        get => (string)GetValue(EndLabelProperty);
        set => SetValue(EndLabelProperty, value);
    }

    internal static DateTimeOffset? ToOffset(DateOnly date) =>
        date == default ? null : new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified));

    internal static DateOnly FromOffset(DateTimeOffset? offset) =>
        offset is { } value ? DateOnly.FromDateTime(value.DateTime) : default;

    private static void OnRangeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var picker = (TsRangePicker)d;
        if (picker._suppress)
        {
            return;
        }

        picker.ApplyRange();
    }

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRangePicker)d).ApplyLabels();

    private void Commit()
    {
        if (_suppress)
        {
            return;
        }

        var range = new DateRange(FromOffset(_start.Date), FromOffset(_end.Date)).Normalized();
        _suppress = true;
        Range = range;
        _suppress = false;
        RangeChanged?.Invoke(this, range);
    }

    private void ApplyLabels()
    {
        _start.Header = StartLabel;
        _end.Header = EndLabel;
    }

    private void ApplyRange()
    {
        _suppress = true;
        _start.Date = ToOffset(Range.Start);
        _end.Date = ToOffset(Range.End);
        _suppress = false;
    }
}

/// <summary>
/// Combined date-range filter (mirrors the web <c>DateRangeFilter</c>): preset
/// chips plus a custom <see cref="TsRangePicker"/>. Choosing a preset resolves a
/// concrete range relative to <see cref="Today"/>; editing the range clears the
/// preset selection unless it still matches a known preset. <see cref="RangeChanged"/>
/// fires on every change.
/// </summary>
public partial class TsDateRangeFilter : ContentControl
{
    private readonly TsDatePresetChips _chips = new();
    private readonly TsRangePicker _picker = new();
    private bool _suppress;

    public static readonly DependencyProperty SelectedRangeProperty = DependencyProperty.Register(
        nameof(SelectedRange), typeof(DateRange), typeof(TsDateRangeFilter),
        new PropertyMetadata(default(DateRange), OnSelectedRangeChanged));

    public TsDateRangeFilter()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Today = DateOnly.FromDateTime(DateTime.Today);

        _chips.PresetSelected += (_, id) => ApplyPreset(id);
        _picker.RangeChanged += (_, range) => OnPickerRange(range);

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_chips);
        column.Children.Add(_picker);
        Content = column;
        ApplySelectedRange();
    }

    /// <summary>Raised when the resolved range changes.</summary>
    public event EventHandler<DateRange>? RangeChanged;

    /// <summary>The currently selected inclusive range.</summary>
    public DateRange SelectedRange
    {
        get => (DateRange)GetValue(SelectedRangeProperty);
        set => SetValue(SelectedRangeProperty, value);
    }

    /// <summary>The "today" anchor used to resolve relative presets.</summary>
    public DateOnly Today { get; set; }

    /// <summary>Optional localized preset id → label map (forwarded to the chips).</summary>
    public IReadOnlyDictionary<string, string>? PresetLabels
    {
        get => _chips.Labels;
        set => _chips.Labels = value;
    }

    private static void OnSelectedRangeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var filter = (TsDateRangeFilter)d;
        if (filter._suppress)
        {
            return;
        }

        filter.ApplySelectedRange();
    }

    private void ApplyPreset(string id)
    {
        if (DatePresets.Get(id) is not { } preset)
        {
            return;
        }

        var range = preset.Resolve(Today);
        _suppress = true;
        SelectedRange = range;
        _picker.Range = range;
        _chips.SelectedId = id;
        _suppress = false;
        RangeChanged?.Invoke(this, range);
    }

    private void OnPickerRange(DateRange range)
    {
        _suppress = true;
        SelectedRange = range;
        _chips.SelectedId = DatePresets.Match(range, Today);
        _suppress = false;
        RangeChanged?.Invoke(this, range);
    }

    private void ApplySelectedRange()
    {
        _suppress = true;
        _picker.Range = SelectedRange;
        _chips.SelectedId = DatePresets.Match(SelectedRange, Today);
        _suppress = false;
    }
}
