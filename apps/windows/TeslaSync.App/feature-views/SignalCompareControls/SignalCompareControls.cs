using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SignalDiff;

/// <summary>
/// The native WinUI 3 <c>SignalCompareControls</c> feature surface — a parity port of
/// <c>web/src/features/telemetry/components/SignalCompareControls.tsx</c>. It is a purely controlled presentational
/// bar for the signal-diff workflow: assign a <see cref="Model"/> (the web <c>atA</c> / <c>atB</c> /
/// <c>search</c> / <c>category</c> props) and it renders, inside a <see cref="TsFadeIn"/> + <see cref="TsGlassPanel"/>,
/// the two <c>datetime-local</c> window pickers (Window A / Window B, each with an inline <see cref="TsHelpTooltip"/>
/// explaining snapshots / diffs), the five quick-preset buttons, the signal-name filter field, and the eight
/// category filter chips with a contextual "Clear" affordance. It performs no fetching and never mutates its own
/// model: editing a window raises <see cref="WindowAChanged"/> / <see cref="WindowBChanged"/>, a preset applies a
/// relative-time pair and raises both, typing raises <see cref="SearchChanged"/>, and toggling a chip raises
/// <see cref="CategoryChanged"/> — the web <c>onChangeA</c> / <c>onChangeB</c> / <c>onSearchChange</c> /
/// <c>onCategoryChange</c> callbacks. The optional <see cref="TopSlot"/> mirrors the web <c>topSlot</c>. All branch
/// selection, option building and label resolution happen in the WinUI-free
/// <see cref="SignalCompareControlsProjection"/>; every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class SignalCompareControls : ContentControl
{
    private const double SearchMaxWidth = 360; // web max-w-sm

    private readonly ILocalizer _localizer;
    private readonly SignalCompareControlsDiagnostics _diagnostics;
    private readonly Func<DateTime> _now;

    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly ContentControl _topSlotHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        Visibility = Visibility.Collapsed,
        IsTabStop = false,
    };

    private readonly Caption _windowALabel = new();
    private readonly Caption _windowBLabel = new();
    private readonly TsHelpTooltip _snapshotHelp = new();
    private readonly TsHelpTooltip _diffHelp = new();
    private readonly SignalCompareWindowInput _inputA = new();
    private readonly SignalCompareWindowInput _inputB = new();

    private readonly Caption _presetsLabel = new();
    private readonly StackPanel _presetsRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsInput _searchInput = new() { MaxWidth = SearchMaxWidth, MinWidth = 200 };
    private readonly StackPanel _chipsRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly Dictionary<string, ToggleButton> _chips = new(StringComparer.Ordinal);
    private readonly TsButton _clearButton = new();

    private SignalCompareControlsModel _model;
    private bool _opened;
    private bool _suppress;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics + clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SignalCompareControlsModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock the presets resolve against; defaults to <see cref="DateTime.Now"/>.</param>
    public SignalCompareControls(
        ILocalizer localizer,
        SignalCompareControlsModel? model = null,
        SignalCompareControlsDiagnostics? diagnostics = null,
        Func<DateTime>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SignalCompareControlsModel.Empty;
        _diagnostics = diagnostics ?? new SignalCompareControlsDiagnostics();
        _now = clock ?? (() => DateTime.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _inputA.ValueChanged += OnWindowAValueChanged;
        _inputB.ValueChanged += OnWindowBValueChanged;
        _searchInput.TextChanged += OnSearchTextChanged;
        _clearButton.Click += OnClearClicked;
        Loaded += OnLoaded;

        Render();
    }

    /// <summary>Raised when the operator edits or presets the Window A timestamp (web <c>onChangeA</c>).</summary>
    public event EventHandler<string>? WindowAChanged;

    /// <summary>Raised when the operator edits or presets the Window B timestamp (web <c>onChangeB</c>).</summary>
    public event EventHandler<string>? WindowBChanged;

    /// <summary>Raised when the operator edits the signal-name filter (web <c>onSearchChange</c>).</summary>
    public event EventHandler<string>? SearchChanged;

    /// <summary>Raised when the operator toggles a category chip or clears it (web <c>onCategoryChange</c>).</summary>
    public event EventHandler<string?>? CategoryChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SignalCompareControls</c>).</summary>
    public static string Slug => SignalCompareControlsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SignalCompareControlsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>Optional element rendered on the row above the windows (web <c>topSlot</c> — e.g. a vehicle picker).</summary>
    public UIElement? TopSlot
    {
        get => _topSlotHost.Content as UIElement;
        set
        {
            _topSlotHost.Content = value;
            _topSlotHost.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    private void BuildChrome()
    {
        var display = SignalCompareControlsProjection.Project(_model, _localizer);

        var windows = BuildWindowsRow(display);
        BuildPresetsRow(display);
        BuildFilterRow(display);

        _root.Children.Add(_topSlotHost);
        _root.Children.Add(windows);
        _root.Children.Add(WrapHorizontal(_presetsRow));
        _root.Children.Add(Divider());
        _root.Children.Add(BuildFilterLayout());

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = _root,
        };

        Content = new TsFadeIn { Content = panel };
    }

    private Grid BuildWindowsRow(SignalCompareControlsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var columnA = BuildWindowColumn(_windowALabel, _snapshotHelp, _inputA, display.WindowALabel);
        var columnB = BuildWindowColumn(_windowBLabel, _diffHelp, _inputB, display.WindowBLabel);

        Grid.SetColumn(columnA, 0);
        Grid.SetColumn(columnB, 1);
        grid.Children.Add(columnA);
        grid.Children.Add(columnB);
        return grid;
    }

    private static StackPanel BuildWindowColumn(
        Caption label,
        TsHelpTooltip help,
        SignalCompareWindowInput input,
        string accessibleName)
    {
        var labelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        labelRow.Children.Add(label);
        labelRow.Children.Add(help);

        input.SetAccessibleName(accessibleName);

        var column = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(labelRow);
        column.Children.Add(input);
        return column;
    }

    private void BuildPresetsRow(SignalCompareControlsDisplay display)
    {
        _presetsRow.Children.Clear();
        _presetsRow.Children.Add(_presetsLabel);

        foreach (var preset in display.Presets)
        {
            var id = preset.Id;
            var button = new TsButton
            {
                Variant = ButtonVariant.Secondary,
                Size = ControlSize.Small,
                Text = preset.Label,
            };
            AutomationProperties.SetName(button, preset.Label);
            button.Click += (_, _) => ApplyPreset(id);
            _presetsRow.Children.Add(button);
        }
    }

    private void BuildFilterRow(SignalCompareControlsDisplay display)
    {
        _chips.Clear();
        _chipsRow.Children.Clear();

        foreach (var chip in display.Categories)
        {
            var id = chip.Id;
            var toggle = new ToggleButton
            {
                Content = chip.Label,
                IsChecked = chip.Active,
            };
            AutomationProperties.SetName(toggle, chip.Label);
            toggle.Click += (_, _) => OnChipClicked(id);
            _chips[id] = toggle;
            _chipsRow.Children.Add(toggle);
        }

        _clearButton.Variant = ButtonVariant.Subtle;
        _clearButton.Size = ControlSize.Small;
        _clearButton.Text = display.ClearLabel;
        AutomationProperties.SetName(_clearButton, display.ClearLabel);
        _chipsRow.Children.Add(_clearButton);
    }

    private Grid BuildFilterLayout()
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        _searchInput.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_searchInput, 0);

        var chipsScroller = WrapHorizontal(_chipsRow);
        chipsScroller.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(chipsScroller, 1);

        grid.Children.Add(_searchInput);
        grid.Children.Add(chipsScroller);
        return grid;
    }

    private static ScrollViewer WrapHorizontal(UIElement content) => new()
    {
        Content = content,
        HorizontalScrollMode = ScrollMode.Auto,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
        VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        IsTabStop = false,
    };

    private static Border Divider()
    {
        var border = new Border
        {
            Height = 1,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        if (Application.Current.Resources.TryGetValue("TsColorBorderBrush", out var brush) && brush is Brush b)
        {
            border.Background = b;
        }

        return border;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = SignalCompareControlsProjection.Project(_model, _localizer);

        _suppress = true;

        _windowALabel.Value = display.WindowALabel;
        _windowBLabel.Value = display.WindowBLabel;
        _presetsLabel.Value = display.PresetsLabel;

        _snapshotHelp.Hint = display.SnapshotHelp;
        AutomationProperties.SetName(_snapshotHelp, display.SnapshotHelpAria);
        _diffHelp.Hint = display.DiffHelp;
        AutomationProperties.SetName(_diffHelp, display.DiffHelpAria);

        _inputA.SetAccessibleName(display.WindowALabel);
        _inputB.SetAccessibleName(display.WindowBLabel);
        _inputA.Bind(display.AtA);
        _inputB.Bind(display.AtB);

        _searchInput.Text = display.Search;
        _searchInput.Hint = display.FilterHint;
        AutomationProperties.SetName(_searchInput, display.FilterHint);

        SyncCategories(display);

        _suppress = false;

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void SyncCategories(SignalCompareControlsDisplay display)
    {
        foreach (var chip in display.Categories)
        {
            if (_chips.TryGetValue(chip.Id, out var toggle))
            {
                toggle.IsChecked = chip.Active;
            }
        }

        _clearButton.Visibility = display.ShowClear ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyPreset(DiffPresetId id)
    {
        var (atA, atB) = SignalCompareControlsPresets.Get(id).Compute(_now());
        string aLocal = SignalCompareControlsTime.ToLocalDatetimeInput(atA);
        string bLocal = SignalCompareControlsTime.ToLocalDatetimeInput(atB);

        _suppress = true;
        _inputA.Bind(aLocal);
        _inputB.Bind(bLocal);
        _suppress = false;

        WindowAChanged?.Invoke(this, aLocal);
        WindowBChanged?.Invoke(this, bLocal);
    }

    private void OnChipClicked(string id)
    {
        string? next = SignalCompareControlsProjection.ToggleCategory(_model.Category, id);
        CategoryChanged?.Invoke(this, next);
        SyncCategories(SignalCompareControlsProjection.Project(_model, _localizer));
    }

    private void OnClearClicked(object sender, RoutedEventArgs e) => CategoryChanged?.Invoke(this, null);

    private void OnWindowAValueChanged(object? sender, string value)
    {
        if (!_suppress)
        {
            WindowAChanged?.Invoke(this, value);
        }
    }

    private void OnWindowBValueChanged(object? sender, string value)
    {
        if (!_suppress)
        {
            WindowBChanged?.Invoke(this, value);
        }
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppress)
        {
            SearchChanged?.Invoke(this, _searchInput.Text);
        }
    }
}

/// <summary>
/// The native equivalent of the web <c>&lt;Input type="datetime-local"&gt;</c> control: a Fluent
/// <see cref="CalendarDatePicker"/> + <see cref="TimePicker"/> pair that reads and writes the same
/// <c>yyyy-MM-ddTHH:mm</c> local value string the web component exchanges. Editing either picker raises
/// <see cref="ValueChanged"/> with the combined value (or the empty string when either part is unset, matching an
/// incomplete HTML <c>datetime-local</c>); <see cref="Bind"/> sets both parts from a value string without echoing
/// an event. All parsing/formatting delegates to the unit-tested <see cref="SignalCompareControlsTime"/>.
/// </summary>
internal sealed partial class SignalCompareWindowInput : ContentControl
{
    private readonly CalendarDatePicker _date = new();
    private readonly TimePicker _time = new()
    {
        ClockIdentifier = "24HourClock",
        MinuteIncrement = 1,
    };

    private bool _suppress;

    public SignalCompareWindowInput()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(_date);
        row.Children.Add(_time);
        Content = row;

        _date.DateChanged += (_, _) => Emit();
        _time.SelectedTimeChanged += (_, _) => Emit();
    }

    /// <summary>Raised when the user edits the date or time, carrying the combined <c>datetime-local</c> value.</summary>
    public event EventHandler<string>? ValueChanged;

    /// <summary>Set both pickers from a <c>datetime-local</c> value string without raising <see cref="ValueChanged"/>.</summary>
    public void Bind(string? value)
    {
        _suppress = true;
        if (SignalCompareControlsTime.TryParseLocalInput(value, out var dt))
        {
            _date.Date = new DateTimeOffset(dt.Date);
            _time.SelectedTime = dt.TimeOfDay;
        }
        else
        {
            _date.Date = null;
            _time.SelectedTime = null;
        }

        _suppress = false;
    }

    /// <summary>Set the Narrator name on both pickers (e.g. the window's localized label).</summary>
    public void SetAccessibleName(string name)
    {
        AutomationProperties.SetName(_date, name);
        AutomationProperties.SetName(_time, name);
    }

    private void Emit()
    {
        if (_suppress)
        {
            return;
        }

        string value = _date.Date is { } date && _time.SelectedTime is { } time
            ? SignalCompareControlsTime.ToLocalDatetimeInput(date.Date.Add(time))
            : string.Empty;

        ValueChanged?.Invoke(this, value);
    }
}
