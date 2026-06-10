using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 <c>ConditionBuilder</c> feature surface — a parity port of
/// web/src/features/automations/pages/ConditionBuilder.tsx. It reproduces the web's controlled list editor:
/// a stack of <see cref="TsGlassPanel"/> condition cards, each with a "Condition Type" dropdown, the
/// kind-specific fields (a signal comparison with signal/operator/value editors including the boolean
/// True/False and the <c>between</c> Min/Max range; a time window with Start/End/Timezone plus the seven
/// weekday toggles; a geofence place + state; or another automation's id + state), and a remove affordance —
/// plus an "Add Condition" button. Editing any control raises <see cref="ConditionsChanged"/> with the new
/// immutable list (the web <c>onChange</c>). The geofence dropdown binds the shared
/// <see cref="ConditionBuilderViewModel"/> (the web <c>useGeofences</c> read) and reflects its full
/// cache-then-network lifecycle — loading / empty / stale / offline / error — via a status chip, hint and
/// retry, while every other field stays interactive. The view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name; the surface adds no custom
/// motion, so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class ConditionBuilder : ContentControl, IDisposable
{
    private const string AddGlyph = "\uE710";     // Segoe Fluent — Add
    private const string RemoveGlyph = "\uE74D";  // Segoe Fluent — Delete
    private const string RetryGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string AutomationIdRoot = "condition-builder";

    private readonly ConditionBuilderViewModel _viewModel;
    private readonly ConditionBuilderDiagnostics _diagnostics;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _cards = new() { Spacing = 12 };
    private readonly TsButton _addButton = new();
    private readonly List<Action<ConditionGeofencePickerDisplay>> _geofenceUpdaters = new();

    private bool _building;
    private bool _suppressRebuild;
    private bool _rebuildQueued;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its geofence source, the i18n facade, an optional seed list and diagnostics.</summary>
    /// <param name="source">The cache-then-network geofence source (the web <c>useGeofences</c> read).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="initialConditions">The conditions to seed the builder with (defaults to empty).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ConditionBuilder(
        IConditionBuilderSource source,
        ILocalizer localizer,
        IEnumerable<AutomationCondition>? initialConditions = null,
        ConditionBuilderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ConditionBuilderDiagnostics();
        _viewModel = new ConditionBuilderViewModel(source, localizer, initialConditions);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, AutomationIdRoot);
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ConditionsChanged += OnViewModelConditionsChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        RebuildList();
    }

    /// <summary>Raised when the condition list changes (the web <c>onChange</c> callback) with the new value.</summary>
    public event EventHandler<IReadOnlyList<AutomationCondition>>? ConditionsChanged;

    /// <summary>The current, immutable condition list (the web <c>conditions</c> value).</summary>
    public IReadOnlyList<AutomationCondition> Conditions => _viewModel.Conditions;

    /// <summary>
    /// Convenience factory wiring the shared <see cref="ILocationRepository"/> into a
    /// <see cref="ConditionBuilderSource"/> over the host's localizer — the surface a host binds by default.
    /// </summary>
    /// <param name="locations">The shared location/geofence repository.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="initialConditions">The conditions to seed the builder with (defaults to empty).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public static ConditionBuilder Create(
        ILocationRepository locations,
        ILocalizer localizer,
        IEnumerable<AutomationCondition>? initialConditions = null,
        ConditionBuilderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(locations);
        return new ConditionBuilder(new ConditionBuilderSource(locations), localizer, initialConditions, diagnostics);
    }

    private void BuildChrome()
    {
        _addButton.Variant = ButtonVariant.Subtle;
        _addButton.Size = ControlSize.Small;
        _addButton.IconGlyph = AddGlyph;
        _addButton.Text = _localizer.GetString("automations.builder.addCondition", "Add Condition");
        _addButton.HorizontalAlignment = HorizontalAlignment.Left;
        AutomationProperties.SetName(_addButton, _addButton.Text);
        _addButton.Click += OnAddClick;

        _root.Children.Add(_cards);
        _root.Children.Add(_addButton);
        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadGeofencesAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnAddClick(object sender, RoutedEventArgs e) => _viewModel.AddCondition();

    private void OnViewModelConditionsChanged(object? sender, IReadOnlyList<AutomationCondition> conditions) =>
        ConditionsChanged?.Invoke(this, conditions);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(ConditionBuilderViewModel.Conditions):
                if (_suppressRebuild)
                {
                    _suppressRebuild = false;
                    return;
                }

                ScheduleRebuild();
                break;

            case nameof(ConditionBuilderViewModel.GeofenceDisplay):
                ApplyGeofenceDisplay();
                break;

            default:
                break;
        }
    }

    private void ScheduleRebuild()
    {
        if (_rebuildQueued)
        {
            return;
        }

        _rebuildQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RebuildCoalesced);
        }
        else
        {
            RebuildCoalesced();
        }
    }

    private void RebuildCoalesced()
    {
        _rebuildQueued = false;
        RebuildList();
    }

    private void ApplyGeofenceDisplay()
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(ApplyGeofenceDisplayCore);
        }
        else
        {
            ApplyGeofenceDisplayCore();
        }
    }

    private void ApplyGeofenceDisplayCore()
    {
        var display = _viewModel.GeofenceDisplay;
        foreach (var updater in _geofenceUpdaters)
        {
            updater(display);
        }
    }

    private void RebuildList()
    {
        _geofenceUpdaters.Clear();
        _cards.Children.Clear();

        var conditions = _viewModel.Conditions;
        for (int i = 0; i < conditions.Count; i++)
        {
            _cards.Children.Add(BuildCard(i, conditions[i]));
        }

        AutomationProperties.SetName(this, _viewModel.Title);
    }

    private TsGlassPanel BuildCard(int index, AutomationCondition condition)
    {
        _building = true;

        var fieldsRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        fieldsRow.Children.Add(BuildTypeField(index, condition.Kind));
        foreach (var field in BuildKindFields(index, condition))
        {
            fieldsRow.Children.Add(field);
        }

        var fieldsScroll = new ScrollViewer
        {
            Content = fieldsRow,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var remove = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RemoveGlyph,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 24, 0, 0),
        };
        string removeLabel = _localizer.GetString("automations.builder.removeCondition", "Remove condition");
        AutomationProperties.SetName(remove, removeLabel);
        ToolTipService.SetToolTip(remove, new ToolTip { Content = removeLabel });
        int captured = index;
        remove.Click += (_, _) => _viewModel.RemoveCondition(captured);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(fieldsScroll, 0);
        Grid.SetColumn(remove, 1);
        grid.Children.Add(fieldsScroll);
        grid.Children.Add(remove);

        var panel = new TsGlassPanel { Padding = new Thickness(16) };
        panel.Content = grid;

        _building = false;
        return panel;
    }

    private StackPanel BuildTypeField(int index, AutomationConditionKind kind)
    {
        var select = NewSelect(
            ConditionBuilderProjection.ConditionTypeOptions(_localizer),
            ConditionCatalog.KindWire(kind),
            256);
        string label = _localizer.GetString("automations.builder.conditionType", "Condition Type");
        AutomationProperties.SetName(select, label);
        int captured = index;
        select.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (select.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _viewModel.ChangeConditionKind(captured, ConditionCatalog.KindFromWire(wire));
            }
        };

        // Web parity: the visible "Condition Type" caption renders only on the first row to align the rest.
        return LabeledField(index == 0 ? label : null, select);
    }

    private IReadOnlyList<FrameworkElement> BuildKindFields(int index, AutomationCondition condition) => condition switch
    {
        AutomationCondition.SignalCondition signal => BuildSignalFields(index, signal),
        AutomationCondition.TimeWindowCondition window => BuildTimeWindowFields(index, window),
        AutomationCondition.GeofenceCondition geofence => BuildGeofenceFields(index, geofence),
        AutomationCondition.OtherAutomationCondition other => BuildOtherAutomationFields(index, other),
        _ => Array.Empty<FrameworkElement>(),
    };

    private List<FrameworkElement> BuildSignalFields(int index, AutomationCondition.SignalCondition condition)
    {
        var fields = new List<FrameworkElement>();
        int captured = index;

        var signalSelect = NewSelect(ConditionBuilderProjection.SignalOptions(_localizer), condition.Signal, 176);
        string signalLabel = _localizer.GetString("automations.builder.signal", "Signal");
        AutomationProperties.SetName(signalSelect, signalLabel);
        signalSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (signalSelect.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _viewModel.ReplaceCondition(captured, ConditionBuilderLogic.ChangeSignal(wire));
            }
        };
        fields.Add(LabeledField(
            signalLabel,
            signalSelect,
            _localizer.GetString(
                "help.fields.automations.signal",
                "The vehicle telemetry signal this condition reads. Booleans use true/false, \"state\" uses keywords like online/asleep, all others compare numeric values.")));

        var operatorSelect = NewSelect(
            ConditionBuilderProjection.OperatorOptions(condition.Signal, _localizer),
            ConditionCatalog.OperatorWire(condition.Op),
            144);
        string operatorLabel = _localizer.GetString("automations.builder.operator", "Operator");
        AutomationProperties.SetName(operatorSelect, operatorLabel);
        operatorSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (operatorSelect.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _viewModel.ReplaceCondition(
                    captured,
                    ConditionBuilderLogic.ChangeOperator(condition, ConditionCatalog.OperatorFromWire(wire)));
            }
        };
        fields.Add(LabeledField(
            operatorLabel,
            operatorSelect,
            _localizer.GetString(
                "help.fields.automations.operator",
                "How the live signal value is compared to your typed value. \"between\" expects a Min and Max; \"in\" expects a comma-separated list.")));

        var plan = ConditionBuilderLogic.PlanSignal(condition);
        switch (plan.Editor)
        {
            case SignalValueEditor.Range:
                fields.Add(BuildNumberField(
                    _localizer.GetString("automations.builder.minValue", "Min"),
                    ConditionBuilderLogic.NumberString(plan.Min),
                    112,
                    raw => _viewModel.ReplaceCondition(captured, ConditionBuilderLogic.WithMin(condition, raw))));
                fields.Add(BuildNumberField(
                    _localizer.GetString("automations.builder.maxValue", "Max"),
                    ConditionBuilderLogic.NumberString(plan.Max),
                    112,
                    raw => _viewModel.ReplaceCondition(captured, ConditionBuilderLogic.WithMax(condition, raw))));
                break;

            case SignalValueEditor.Boolean:
                var boolSelect = NewSelect(
                    ConditionBuilderProjection.BooleanValueOptions(_localizer),
                    plan.ValueString,
                    112);
                string boolLabel = _localizer.GetString("automations.builder.value", "Value");
                AutomationProperties.SetName(boolSelect, boolLabel);
                boolSelect.SelectionChanged += (_, _) =>
                {
                    if (_building)
                    {
                        return;
                    }

                    if (boolSelect.SelectedItem is ComboBoxItem { Tag: string raw })
                    {
                        _suppressRebuild = true;
                        _viewModel.ReplaceCondition(captured, ConditionBuilderLogic.WithValue(condition, raw));
                    }
                };
                fields.Add(LabeledField(boolLabel, boolSelect));
                break;

            default:
                var valueInput = NewInput(plan.ValueString, plan.IsText ? 160 : 144, numeric: !plan.IsText);
                string valueLabel = _localizer.GetString("automations.builder.value", "Value");
                AutomationProperties.SetName(valueInput, valueLabel);
                if (string.Equals(condition.Signal, ConditionCatalog.StateSignalKey, StringComparison.Ordinal))
                {
                    valueInput.Hint = _localizer.GetString("automations.builder.statePlaceholder", "online"); // parity:allow web i18n key mirrored verbatim
                }

                valueInput.TextChanged += (_, _) =>
                {
                    if (_building)
                    {
                        return;
                    }

                    _suppressRebuild = true;
                    _viewModel.ReplaceCondition(captured, ConditionBuilderLogic.WithValue(condition, valueInput.Text));
                };
                fields.Add(LabeledField(valueLabel, valueInput));
                break;
        }

        return fields;
    }

    private List<FrameworkElement> BuildTimeWindowFields(int index, AutomationCondition.TimeWindowCondition condition)
    {
        var fields = new List<FrameworkElement>();
        int captured = index;

        fields.Add(BuildTimeField(
            _localizer.GetString("automations.builder.startTime", "Start"),
            condition.StartTime,
            value => _viewModel.ReplaceCondition(captured, condition with { StartTime = value })));

        fields.Add(BuildTimeField(
            _localizer.GetString("automations.builder.endTime", "End"),
            condition.EndTime,
            value => _viewModel.ReplaceCondition(captured, condition with { EndTime = value })));

        var timezoneSelect = NewSelect(
            ConditionBuilderProjection.TimezoneOptions(_localizer),
            condition.Timezone,
            176);
        string timezoneLabel = _localizer.GetString("automations.builder.timezone", "Timezone");
        AutomationProperties.SetName(timezoneSelect, timezoneLabel);
        timezoneSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (timezoneSelect.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _suppressRebuild = true;
                _viewModel.ReplaceCondition(captured, condition with { Timezone = wire });
            }
        };
        fields.Add(LabeledField(
            timezoneLabel,
            timezoneSelect,
            _localizer.GetString(
                "help.fields.automations.timezone",
                "IANA time zone used to interpret the start/end window. Defaults to your browser zone if left blank.")));

        fields.Add(BuildDaysField(index, condition));
        return fields;
    }

    private StackPanel BuildDaysField(int index, AutomationCondition.TimeWindowCondition condition)
    {
        int captured = index;
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        for (int day = 0; day < ConditionCatalog.DayFallbacks.Count; day++)
        {
            int currentDay = day;
            bool active = condition.DaysOfWeek.Contains(day);
            string dayLabel = ConditionBuilderProjection.DayLabel(day, _localizer);
            var toggle = new ToggleButton
            {
                Content = dayLabel,
                IsChecked = active,
                MinWidth = 40,
                Padding = new Thickness(0, 4, 0, 4),
                FontSize = 12,
            };
            AutomationProperties.SetName(toggle, dayLabel);
            toggle.Click += (_, _) =>
            {
                if (_building)
                {
                    return;
                }

                var days = new List<int>(condition.DaysOfWeek);
                if (toggle.IsChecked == true)
                {
                    if (!days.Contains(currentDay))
                    {
                        days.Add(currentDay);
                    }
                }
                else
                {
                    days.RemoveAll(d => d == currentDay);
                }

                days.Sort();
                _suppressRebuild = true;
                _viewModel.ReplaceCondition(captured, condition with { DaysOfWeek = days });
            };
            row.Children.Add(toggle);
        }

        string label = _localizer.GetString("automations.builder.days", "Days");
        AutomationProperties.SetName(row, label);
        return LabeledField(label, row);
    }

    private List<FrameworkElement> BuildGeofenceFields(int index, AutomationCondition.GeofenceCondition condition)
    {
        var fields = new List<FrameworkElement>();
        int captured = index;

        var display = _viewModel.GeofenceDisplay;
        string selectedPlace = condition.PlaceId > 0
            ? condition.PlaceId.ToString(CultureInfo.InvariantCulture)
            : string.Empty;

        var geofenceSelect = NewSelect(display.Options, selectedPlace, 208);
        AutomationProperties.SetName(geofenceSelect, display.Label);
        geofenceSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (geofenceSelect.SelectedItem is ComboBoxItem { Tag: string raw })
            {
                _suppressRebuild = true;
                _viewModel.ReplaceCondition(captured, condition with { PlaceId = ConditionBuilderLogic.ParseId(raw) });
            }
        };

        var statusChip = new TsBadge
        {
            Status = display.StatusChipKind,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        var statusText = new TextBlock { FontSize = 12 };
        statusChip.Content = statusText;

        var retryButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RetryGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        retryButton.Click += (_, _) => _ = _viewModel.RetryGeofencesAsync();

        var hint = new Caption { Visibility = Visibility.Collapsed };
        LiveRegion.Configure(hint);

        var selectRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        selectRow.Children.Add(geofenceSelect);
        selectRow.Children.Add(statusChip);
        selectRow.Children.Add(retryButton);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(selectRow);
        column.Children.Add(hint);

        void Update(ConditionGeofencePickerDisplay current)
        {
            string keep = geofenceSelect.SelectedItem is ComboBoxItem { Tag: string tag }
                ? tag
                : selectedPlace;
            FillSelect(geofenceSelect, current.Options, keep);

            if (current.StatusChip is { } chip)
            {
                statusText.Text = chip;
                statusChip.Status = current.StatusChipKind;
                AutomationProperties.SetName(statusChip, chip);
                statusChip.Visibility = Visibility.Visible;
            }
            else
            {
                statusChip.Visibility = Visibility.Collapsed;
            }

            if (current.RetryLabel is { } retryLabel)
            {
                retryButton.Text = retryLabel;
                AutomationProperties.SetName(retryButton, retryLabel);
                retryButton.Visibility = Visibility.Visible;
            }
            else
            {
                retryButton.Visibility = Visibility.Collapsed;
            }

            if (current.Hint is { } hintText)
            {
                hint.Value = hintText;
                AutomationProperties.SetName(hint, hintText);
                hint.Visibility = Visibility.Visible;
                LiveRegion.Announce(hint);
            }
            else
            {
                hint.Visibility = Visibility.Collapsed;
            }
        }

        Update(display);
        _geofenceUpdaters.Add(Update);

        fields.Add(LabeledField(
            display.Label,
            column,
            display.HelpText));

        var stateSelect = NewSelect(
            ConditionBuilderProjection.GeofenceStateOptions(_localizer),
            ConditionCatalog.GeofenceStateWire(condition.State),
            136);
        string stateLabel = _localizer.GetString("automations.builder.state", "State");
        AutomationProperties.SetName(stateSelect, stateLabel);
        stateSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (stateSelect.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _suppressRebuild = true;
                _viewModel.ReplaceCondition(
                    captured,
                    condition with { State = ConditionCatalog.GeofenceStateFromWire(wire) });
            }
        };
        fields.Add(LabeledField(stateLabel, stateSelect));

        return fields;
    }

    private List<FrameworkElement> BuildOtherAutomationFields(
        int index,
        AutomationCondition.OtherAutomationCondition condition)
    {
        var fields = new List<FrameworkElement>();
        int captured = index;

        string idValue = condition.OtherAutomationId > 0
            ? condition.OtherAutomationId.ToString(CultureInfo.InvariantCulture)
            : string.Empty;
        var idInput = NewInput(idValue, 160, numeric: true);
        string idLabel = _localizer.GetString("automations.builder.otherAutomationId", "Automation ID");
        AutomationProperties.SetName(idInput, idLabel);
        idInput.TextChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            _suppressRebuild = true;
            _viewModel.ReplaceCondition(
                captured,
                condition with { OtherAutomationId = ConditionBuilderLogic.ParseId(idInput.Text) });
        };
        fields.Add(LabeledField(
            idLabel,
            idInput,
            _localizer.GetString(
                "help.fields.automations.otherAutomation",
                "Numeric ID of another automation whose state this condition tracks. Useful for chaining or guarding rules.")));

        var stateSelect = NewSelect(
            ConditionBuilderProjection.OtherAutomationStateOptions(_localizer),
            ConditionCatalog.OtherAutomationStateWire(condition.State),
            192);
        string stateLabel = _localizer.GetString("automations.builder.state", "State");
        AutomationProperties.SetName(stateSelect, stateLabel);
        stateSelect.SelectionChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            if (stateSelect.SelectedItem is ComboBoxItem { Tag: string wire })
            {
                _suppressRebuild = true;
                _viewModel.ReplaceCondition(
                    captured,
                    condition with { State = ConditionCatalog.OtherAutomationStateFromWire(wire) });
            }
        };
        fields.Add(LabeledField(stateLabel, stateSelect));

        return fields;
    }

    private StackPanel BuildNumberField(string label, string value, double width, Action<string> onChange)
    {
        var input = NewInput(value, width, numeric: true);
        AutomationProperties.SetName(input, label);
        input.TextChanged += (_, _) =>
        {
            if (_building)
            {
                return;
            }

            _suppressRebuild = true;
            onChange(input.Text);
        };
        return LabeledField(label, input);
    }

    private StackPanel BuildTimeField(string label, string value, Action<string> onChange)
    {
        var picker = new TimePicker
        {
            ClockIdentifier = "24HourClock",
            MinuteIncrement = 1,
            Time = ParseTime(value),
            MinWidth = 128,
        };
        AutomationProperties.SetName(picker, label);
        picker.TimeChanged += (_, args) =>
        {
            if (_building)
            {
                return;
            }

            _suppressRebuild = true;
            onChange(FormatTime(args.NewTime));
        };
        return LabeledField(label, picker);
    }

    private static StackPanel LabeledField(string? visibleLabel, FrameworkElement control, string? helpText = null)
    {
        var column = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Top };

        if (!string.IsNullOrEmpty(visibleLabel))
        {
            var labelRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                VerticalAlignment = VerticalAlignment.Center,
            };
            labelRow.Children.Add(new Label { Value = visibleLabel, VerticalAlignment = VerticalAlignment.Center });
            if (!string.IsNullOrEmpty(helpText))
            {
                labelRow.Children.Add(new TsHelpTooltip { Hint = helpText, VerticalAlignment = VerticalAlignment.Center });
            }

            column.Children.Add(labelRow);
        }

        column.Children.Add(control);
        return column;
    }

    private TsSelect NewSelect(IReadOnlyList<ComboOption> options, string selectedValue, double width)
    {
        var select = new TsSelect { Width = width, VerticalAlignment = VerticalAlignment.Top };
        FillSelect(select, options, selectedValue);
        return select;
    }

    private static TsInput NewInput(string value, double width, bool numeric)
    {
        var input = new TsInput
        {
            Text = value,
            Width = width,
            VerticalAlignment = VerticalAlignment.Top,
        };
        if (numeric)
        {
            input.InputScope = new InputScope
            {
                Names = { new InputScopeName(InputScopeNameValue.Number) },
            };
        }

        return input;
    }

    private void FillSelect(ComboBox combo, IReadOnlyList<ComboOption> options, string selectedValue)
    {
        bool previous = _building;
        _building = true;

        combo.Items.Clear();
        ComboBoxItem? selected = null;
        foreach (var option in options)
        {
            var item = new ComboBoxItem
            {
                Content = option.Label,
                Tag = option.Value,
                IsEnabled = !option.Disabled,
            };
            AutomationProperties.SetName(item, option.Label);
            combo.Items.Add(item);
            if (string.Equals(option.Value, selectedValue, StringComparison.Ordinal))
            {
                selected = item;
            }
        }

        combo.SelectedItem = selected;
        _building = previous;
    }

    private static TimeSpan ParseTime(string? value)
    {
        if (!string.IsNullOrWhiteSpace(value) &&
            (TimeSpan.TryParseExact(value, "hh\\:mm", CultureInfo.InvariantCulture, out var exact) ||
             TimeSpan.TryParseExact(value, "h\\:mm", CultureInfo.InvariantCulture, out exact)))
        {
            return exact;
        }

        return TimeSpan.Zero;
    }

    private static string FormatTime(TimeSpan value)
    {
        var clamped = value < TimeSpan.Zero ? TimeSpan.Zero : value;
        return new TimeSpan(clamped.Hours, clamped.Minutes, 0).ToString("hh\\:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ConditionsChanged -= OnViewModelConditionsChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }
}
