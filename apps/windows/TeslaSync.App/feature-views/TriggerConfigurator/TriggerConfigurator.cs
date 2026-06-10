using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 TriggerConfigurator feature surface — a parity port of
/// web/src/features/automations/pages/TriggerConfigurator.tsx. It reproduces the web component's controlled
/// trigger form: a kind selector (the exported <c>TRIGGER_TYPES</c> / <c>createDefaultTrigger</c>) above the
/// kind-specific body, which switches between the four web branches — a schedule (a time picker + weekday
/// toggles in simple mode, or a cron expression field in advanced mode, plus a timezone select), a vehicle
/// event select, a geofence select (the <c>useGeofences</c> read) with a transition select and conditional
/// dwell-minutes field, and a signal-threshold form (signal + operator selects, a boolean/text/number value
/// editor, and a "fire on any change" toggle). Every edit raises <see cref="TriggerChanged"/> (the web
/// <c>onChange</c>). Beyond the web's bare form this surface fills the geofence region in every
/// cache-then-network state (loading skeleton, friendly empty, retry-able error, and stale / offline chips).
/// All data and projection flow through the shared <see cref="TriggerConfiguratorViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade, every interactive element carries a Narrator
/// name, and the only motion is the entrance fade, which honours the reduced-motion preference by
/// construction.
/// </summary>
public sealed partial class TriggerConfigurator : ContentControl, IDisposable
{
    private const string InfoGlyph = "\uE946";       // Segoe Fluent — Info (empty surface)
    private const string ErrorGlyph = "\uEA39";      // Segoe Fluent — ErrorBadge
    private const string OfflineGlyph = "\uEB5E";    // Segoe Fluent — cloud-off / offline
    private const string MapPinGlyph = "\uE707";     // Segoe Fluent — Location (geofence)

    private const double PanelPadding = 24;          // web p-6 host card
    private const double RootSpacing = 16;           // web space-y-4
    private const double FieldSpacing = 4;
    private const double DayButtonSize = 40;         // web h-10 w-10

    /// <summary>The web surface root automation id.</summary>
    public const string RootAutomationId = "trigger-configurator";

    private readonly TriggerConfiguratorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TriggerConfiguratorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RootSpacing };

    private string? _renderedKey;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its geofence source, localizer, diagnostics and (optional) initial trigger.</summary>
    /// <param name="source">The cache-then-network geofence source backing the geofence dropdown.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="initialTrigger">The trigger to edit; defaults to a fresh schedule trigger when null.</param>
    public TriggerConfigurator(
        ITriggerGeofenceSource source,
        ILocalizer localizer,
        TriggerConfiguratorDiagnostics? diagnostics = null,
        AutomationTrigger? initialTrigger = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TriggerConfiguratorDiagnostics();
        _viewModel = new TriggerConfiguratorViewModel(source, localizer, initialTrigger);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, RootAutomationId);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = _root,
        };
        Content = new TsFadeIn { DelayMs = 40, Content = panel };

        _viewModel.TriggerChanged += OnViewModelTriggerChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised whenever the trigger is edited (the web <c>onChange</c>).</summary>
    public event EventHandler<AutomationTrigger>? TriggerChanged;

    /// <summary>The canonical surface id (<c>trigger-configurator</c>).</summary>
    public static string SurfaceId => TriggerConfiguratorRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public TriggerConfiguratorViewModel ViewModel => _viewModel;

    /// <summary>The trigger currently being edited.</summary>
    public AutomationTrigger Trigger => _viewModel.Trigger;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TriggerGeofenceSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static TriggerConfigurator Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TriggerConfiguratorDiagnostics? diagnostics = null,
        AutomationTrigger? initialTrigger = null)
    {
        var source = new TriggerGeofenceSource(api, engine, options);
        return new TriggerConfigurator(source, localizer, diagnostics, initialTrigger);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.TriggerChanged -= OnViewModelTriggerChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelTriggerChanged(object? sender, AutomationTrigger trigger) =>
        TriggerChanged?.Invoke(this, trigger);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    // The view rebuilds only when the structural signature changes, so editing a text field keeps its focus
    // while a structural change (a schedule mode flip, a kind switch, a geofence load) re-renders.
    private void Render()
    {
        string key = _viewModel.StructureKey;
        if (string.Equals(key, _renderedKey, StringComparison.Ordinal))
        {
            return;
        }

        _renderedKey = key;
        _root.Children.Clear();
        _root.Children.Add(BuildKindSelector());
        _root.Children.Add(BuildBody());
    }

    private StackPanel BuildBody() => _viewModel.Kind switch
    {
        AutomationTriggerKind.Schedule => BuildScheduleForm(),
        AutomationTriggerKind.Event => BuildEventForm(),
        AutomationTriggerKind.Geofence => BuildGeofenceForm(),
        AutomationTriggerKind.Signal => BuildSignalForm(),
        _ => new StackPanel(),
    };

    // ── Kind selector (web TRIGGER_TYPES picker, owned by this surface's exports) ─────────────────────────

    private Grid BuildKindSelector()
    {
        var options = _viewModel.TriggerTypeOptions;
        var grid = new Grid { ColumnSpacing = 8 };
        for (int i = 0; i < options.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var types = TriggerEventCatalog.TriggerTypes;
        for (int i = 0; i < options.Count; i++)
        {
            var option = options[i];
            var kind = types[i].Value;
            bool active = kind == _viewModel.Kind;
            var button = new ToggleButton
            {
                Content = option.Label,
                IsChecked = active,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                MinHeight = DayButtonSize,
                Padding = new Thickness(8, 6, 8, 6),
            };
            StyleSegment(button, active);
            AutomationProperties.SetName(button, option.Label);
            button.Click += (_, _) => _viewModel.SelectKind(kind);
            Grid.SetColumn(button, i);
            grid.Children.Add(button);
        }

        AutomationProperties.SetName(grid, _localizer.GetString("automations.builder.triggerType", "Trigger type"));
        return grid;
    }

    // ── Schedule form (web trigger_schedule branch) ──────────────────────────────────────────────────────

    private StackPanel BuildScheduleForm()
    {
        var column = new StackPanel { Spacing = RootSpacing };

        if (_viewModel.IsSimpleSchedule)
        {
            column.Children.Add(BuildTimeField());
            column.Children.Add(BuildDaysField());
        }
        else
        {
            column.Children.Add(BuildCronField());
        }

        column.Children.Add(BuildModeToggle());
        column.Children.Add(BuildSelect(
            _viewModel.TimezoneLabel,
            _viewModel.TimezoneOptions,
            _viewModel.ScheduleTimezone,
            _viewModel.SetTimezone));
        return column;
    }

    private TimePicker BuildTimeField()
    {
        var picker = new TimePicker
        {
            Header = _viewModel.TimeLabel,
            ClockIdentifier = "24HourClock",
            MinuteIncrement = 1,
            SelectedTime = new TimeSpan(_viewModel.ScheduleHour, _viewModel.ScheduleMinute, 0),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(picker, _viewModel.TimeLabel);
        picker.SelectedTimeChanged += (_, args) =>
        {
            if (args.NewTime is { } time)
            {
                _viewModel.SetScheduleTime(time.Hours, time.Minutes);
            }
        };
        return picker;
    }

    private StackPanel BuildDaysField()
    {
        var column = new StackPanel { Spacing = FieldSpacing };
        column.Children.Add(new Label { Value = _viewModel.DaysLabel });

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        for (int index = 0; index < TriggerScheduleCatalog.Days.Count; index++)
        {
            int day = index;
            bool active = _viewModel.IsDayActive(index);
            var button = new ToggleButton
            {
                Content = new TextBlock { Text = _viewModel.DayLabel(index), FontSize = 12 },
                IsChecked = active,
                Width = DayButtonSize,
                Height = DayButtonSize,
                Padding = new Thickness(0),
                MinWidth = DayButtonSize,
            };
            StyleSegment(button, active);
            AutomationProperties.SetName(button, _viewModel.DayLabel(index));
            button.Click += (_, _) => _viewModel.ToggleScheduleDay(day);
            row.Children.Add(button);
        }

        column.Children.Add(row);
        AutomationProperties.SetName(column, _viewModel.DaysLabel);
        return column;
    }

    private StackPanel BuildCronField()
    {
        var input = new TsInput
        {
            Hint = _viewModel.CronExample,
            Text = _viewModel.ScheduleCronExpr,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(input, _viewModel.CronExprLabel);
        input.TextChanged += (_, _) => _viewModel.SetCronExpr(input.Text);

        var column = new StackPanel { Spacing = FieldSpacing };
        column.Children.Add(BuildFieldHeader(_viewModel.CronExprLabel, _viewModel.CronHelp));
        column.Children.Add(input);
        column.Children.Add(new Caption { Value = _viewModel.CronHint });
        return column;
    }

    private TsButton BuildModeToggle()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.ScheduleModeToggleLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, _viewModel.ScheduleModeToggleLabel);
        button.Click += (_, _) => _viewModel.ToggleScheduleMode();
        return button;
    }

    // ── Event form (web trigger_event branch) ────────────────────────────────────────────────────────────

    private StackPanel BuildEventForm()
    {
        var column = new StackPanel { Spacing = RootSpacing };
        column.Children.Add(BuildSelect(
            _viewModel.EventLabel,
            _viewModel.EventOptions,
            _viewModel.EventTypeWire,
            _viewModel.SetEventType));
        return column;
    }

    // ── Geofence form (web trigger_geofence branch) ──────────────────────────────────────────────────────

    private StackPanel BuildGeofenceForm()
    {
        var column = new StackPanel { Spacing = RootSpacing };
        column.Children.Add(BuildGeofenceField());

        column.Children.Add(BuildSelect(
            _viewModel.GeofenceEventLabel,
            _viewModel.GeofenceEventOptions,
            _viewModel.GeofenceEventWire,
            _viewModel.SetGeofenceEvent));

        if (_viewModel.ShowDwellMinutes)
        {
            column.Children.Add(BuildDwellField());
        }

        return column;
    }

    private FrameworkElement BuildGeofenceField() => _viewModel.GeofenceState switch
    {
        TriggerGeofenceLoadState.Loading => BuildGeofenceLoading(),
        TriggerGeofenceLoadState.Error => BuildGeofenceError(),
        TriggerGeofenceLoadState.Empty => BuildGeofenceEmpty(),
        _ => BuildGeofenceSelect(),
    };

    private StackPanel BuildGeofenceLoading()
    {
        var column = new StackPanel { Spacing = FieldSpacing };
        column.Children.Add(new Label { Value = _viewModel.GeofenceLabel });
        column.Children.Add(new TsSkeleton { BlockHeight = 36, Radius = 8 });
        AutomationProperties.SetName(column, _viewModel.GeofenceLoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildGeofenceError()
    {
        var error = new TsQueryError
        {
            IconGlyph = ErrorGlyph,
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("automations.builder.geofenceError", "Couldn't load geofences"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnGeofenceRetry;
        return error;
    }

    private void OnGeofenceRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private StackPanel BuildGeofenceEmpty()
    {
        var column = new StackPanel { Spacing = FieldSpacing };
        column.Children.Add(new Label { Value = _viewModel.GeofenceLabel });
        column.Children.Add(BuildSelectControl(_viewModel.GeofenceOptions, _viewModel.GeofencePlaceValue, _viewModel.SetGeofencePlace, _viewModel.GeofenceLabel));
        column.Children.Add(new TsEmptyState
        {
            IconGlyph = MapPinGlyph,
            Message = _viewModel.GeofenceEmptyMessage,
        });
        return column;
    }

    private StackPanel BuildGeofenceSelect()
    {
        var column = new StackPanel { Spacing = FieldSpacing };

        var header = new Grid { ColumnSpacing = 8 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new Label { Value = _viewModel.GeofenceLabel, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);
        header.Children.Add(label);

        var chip = BuildFreshnessChip();
        if (chip is not null)
        {
            Grid.SetColumn(chip, 1);
            header.Children.Add(chip);
        }

        column.Children.Add(header);
        column.Children.Add(BuildSelectControl(_viewModel.GeofenceOptions, _viewModel.GeofencePlaceValue, _viewModel.SetGeofencePlace, _viewModel.GeofenceLabel));
        return column;
    }

    private FrameworkElement? BuildFreshnessChip()
    {
        if (_viewModel.GeofenceState == TriggerGeofenceLoadState.Offline)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(new FontIcon
            {
                Glyph = OfflineGlyph,
                FontSize = 14,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new Caption { Value = _viewModel.OfflineLabel, VerticalAlignment = VerticalAlignment.Center });
            AutomationProperties.SetName(row, _viewModel.OfflineLabel);
            return row;
        }

        if (_viewModel.IsFetching || _viewModel.GeofenceState == TriggerGeofenceLoadState.Stale)
        {
            return new TsDataFreshness
            {
                UpdatedAt = _viewModel.UpdatedAt,
                IsFetching = _viewModel.IsFetching,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        return null;
    }

    private StackPanel BuildDwellField()
    {
        var box = new NumberBox
        {
            Value = _viewModel.DwellMinutes,
            Minimum = 1,
            Maximum = 60,
            SmallChange = 1,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
            HorizontalAlignment = HorizontalAlignment.Left,
            MinWidth = 140,
        };
        AutomationProperties.SetName(box, _viewModel.DwellMinutesLabel);
        box.ValueChanged += (_, args) =>
        {
            if (!double.IsNaN(args.NewValue))
            {
                _viewModel.SetDwellMinutes((int)args.NewValue);
            }
        };

        var column = new StackPanel { Spacing = FieldSpacing };
        column.Children.Add(BuildFieldHeader(_viewModel.DwellMinutesLabel, _viewModel.DwellHelp));
        column.Children.Add(box);
        column.Children.Add(new Caption { Value = _viewModel.DwellHint });
        return column;
    }

    // ── Signal form (web trigger_signal branch) ──────────────────────────────────────────────────────────

    private StackPanel BuildSignalForm()
    {
        var column = new StackPanel { Spacing = RootSpacing };

        column.Children.Add(BuildSelect(
            _viewModel.SignalLabel,
            _viewModel.SignalFieldOptions,
            _viewModel.SignalKey,
            _viewModel.SetSignal));

        column.Children.Add(BuildSelect(
            _viewModel.OperatorLabel,
            _viewModel.OperatorOptions,
            _viewModel.SignalOpWire,
            _viewModel.SetSignalOp));

        if (_viewModel.SignalShowValue)
        {
            column.Children.Add(BuildSignalValueField());
        }

        column.Children.Add(BuildChangedOnlyToggle());
        return column;
    }

    private FrameworkElement BuildSignalValueField()
    {
        if (_viewModel.SignalIsBool)
        {
            return BuildSelect(
                _viewModel.ValueLabel,
                _viewModel.BoolValueOptions,
                _viewModel.SignalValueString,
                _viewModel.SetSignalValue);
        }

        if (_viewModel.SignalIsState)
        {
            var input = new TsInput
            {
                Header = _viewModel.ValueLabel,
                Hint = _viewModel.StateExample,
                Text = _viewModel.SignalValueString,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(input, _viewModel.ValueLabel);
            input.TextChanged += (_, _) => _viewModel.SetSignalValue(input.Text);
            return input;
        }

        var box = new NumberBox
        {
            Header = _viewModel.ValueLabel,
            Value = TriggerSignalCatalog.ParseFloat(_viewModel.SignalValueString),
            SmallChange = 1,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
            HorizontalAlignment = HorizontalAlignment.Left,
            MinWidth = 160,
        };
        AutomationProperties.SetName(box, _viewModel.ValueLabel);
        box.ValueChanged += (_, args) =>
        {
            if (!double.IsNaN(args.NewValue))
            {
                _viewModel.SetSignalValue(args.NewValue.ToString(CultureInfo.InvariantCulture));
            }
        };
        return box;
    }

    private TsToggle BuildChangedOnlyToggle()
    {
        var toggle = new TsToggle
        {
            Header = _viewModel.ChangedOnlyLabel,
            IsOn = _viewModel.SignalChangedOnly,
        };
        AutomationProperties.SetName(toggle, _viewModel.ChangedOnlyLabel);
        toggle.Toggled += (_, _) => _viewModel.SetChangedOnly(toggle.IsOn);
        return toggle;
    }

    // ── Shared builders ──────────────────────────────────────────────────────────────────────────────────

    private static TsSelect BuildSelect(string header, IReadOnlyList<TriggerOption> options, string selectedValue, Action<string> onChanged)
    {
        var select = BuildSelectControl(options, selectedValue, onChanged, header);
        select.Header = header;
        return select;
    }

    private static TsSelect BuildSelectControl(IReadOnlyList<TriggerOption> options, string selectedValue, Action<string> onChanged, string automationName)
    {
        var select = new TsSelect { HorizontalAlignment = HorizontalAlignment.Stretch };
        int selectedIndex = -1;
        for (int i = 0; i < options.Count; i++)
        {
            var option = options[i];
            select.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
            if (string.Equals(option.Value, selectedValue, StringComparison.Ordinal))
            {
                selectedIndex = i;
            }
        }

        select.SelectedIndex = selectedIndex >= 0 ? selectedIndex : options.Count > 0 ? 0 : -1;
        AutomationProperties.SetName(select, automationName);
        select.SelectionChanged += (_, _) =>
        {
            if (select.SelectedItem is ComboBoxItem { Tag: string value })
            {
                onChanged(value);
            }
        };
        return select;
    }

    private static StackPanel BuildFieldHeader(string label, string help)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new Label { Value = label, VerticalAlignment = VerticalAlignment.Center });
        var tip = new TsHelpTooltip { Hint = help, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(tip, help);
        row.Children.Add(tip);
        return row;
    }

    private static void StyleSegment(ToggleButton button, bool active)
    {
        var accent = AccentColor();
        if (active)
        {
            button.Background = new SolidColorBrush(Color.FromArgb(0x33, accent.R, accent.G, accent.B));
            button.BorderBrush = new SolidColorBrush(Color.FromArgb(0x80, accent.R, accent.G, accent.B));
            button.BorderThickness = new Thickness(1);
            button.Foreground = new SolidColorBrush(accent);
        }
        else
        {
            button.Background = DisplayTokens.Surface;
            button.BorderBrush = DisplayTokens.Border;
            button.BorderThickness = new Thickness(1);
            button.Foreground = DisplayTokens.TextSecondary;
        }
    }

    private static Color AccentColor()
    {
        var brush = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));
        return brush is SolidColorBrush solid ? solid.Color : Color.FromArgb(0xFF, 0x4F, 0x8C, 0xFF);
    }
}
