using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>SmartChargePage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/SmartChargePage.tsx</c> (routes <c>/charging/schedule</c> and
/// <c>/smart-charge</c>, nav name <c>SmartCharge</c>). It binds to a <see cref="SmartChargePageViewModel"/> and
/// renders every web region with Fluent components and design tokens: the page header with a data-freshness
/// chip; the Charge Settings panel (rate-plan select, target-SOC slider, departure date/time, max amps, battery
/// capacity, and the Optimize action with its error text); the 24-Hour Rate Timeline panel (legend, bars or the
/// empty state, and the optimal-window summary); the three cost tiles (Charge Now, Optimized Cost, Savings); the
/// Recommended Schedule panel (the four detail fields, the Apply action / applied chip, the apply error and the
/// alternative windows); and the Plan History panel (skeleton / retry / table / empty state). The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="SmartChargeDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SmartChargePage : UserControl, IDisposable
{
    private const double TimelineHeight = 96;

    private readonly SmartChargePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _suppressRatePlan;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    // GlassPanel1 — Charge Settings.
    private readonly TsGlassPanel _settingsPanel = new() { Padding = new Thickness(20), Glow = GlassGlow.Cyan };
    private readonly SectionTitle _settingsTitle = new();
    private readonly Label _ratePlanLabel = new();
    private readonly TsSelect _ratePlanSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _targetSocLabel = new();
    private readonly TsSlider _targetSocSlider = new() { Minimum = 20, Maximum = 100, StepFrequency = 5, SmallChange = 5 };
    private readonly Caption _targetSocValue = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Label _departByLabel = new();
    private readonly DatePicker _departDate = new();
    private readonly TimePicker _departTime = new() { ClockIdentifier = "12HourClock" };
    private readonly Label _maxAmpsLabel = new();
    private readonly NumberBox _maxAmpsBox = new() { Minimum = 8, Maximum = 80, SmallChange = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
    private readonly Label _batteryLabel = new();
    private readonly NumberBox _batteryBox = new() { Minimum = 10, Maximum = 200, SmallChange = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
    private readonly TsButton _optimizeButton = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE787", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly ErrorText _optimizeError = new() { Visibility = Visibility.Collapsed };

    // GlassPanel2 — 24-Hour Rate Timeline.
    private readonly TsGlassPanel _timelinePanel = new() { Padding = new Thickness(20) };
    private readonly SectionTitle _timelineTitle = new();
    private readonly StackPanel _timelineLegend = new() { Orientation = Orientation.Horizontal, Spacing = 16 };
    private readonly ContentControl _timelineHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly Grid _timelineBars = new() { Height = TimelineHeight, ColumnSpacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
    private readonly TsEmptyState _timelineEmpty = new() { IconGlyph = "\uE9D9" };
    private readonly Caption _windowInfo = new();

    // Cost tiles — Charge-Now / Optimized-Cost / Savings.
    private readonly TsStatCard _chargeNowCard = new();
    private readonly TsStatCard _optimizedCard = new();
    private readonly TsStatCard _savingsCard = new();

    // GlassPanel6 — Recommended Schedule.
    private readonly TsGlassPanel _schedulePanel = new() { Padding = new Thickness(20), Glow = GlassGlow.Green };
    private readonly SectionTitle _scheduleTitle = new();
    private readonly TsButton _applyButton = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE945" };
    private readonly StackPanel _appliedChip = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
    private readonly Text _appliedText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ErrorText _applyError = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _scheduleDetails = new() { ColumnSpacing = 16, RowSpacing = 12 };
    private readonly Subhead _alternativesTitle = new();
    private readonly StackPanel _alternativesHost = new() { Spacing = 8 };

    // GlassPanel7 — Plan History.
    private readonly TsGlassPanel _historyPanel = new() { Padding = new Thickness(20) };
    private readonly SectionTitle _historyTitle = new();
    private readonly ContentControl _historyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _historyTable = new() { Selectable = false, PageSize = 20 };
    private readonly TsEmptyState _historyEmpty = new() { IconGlyph = "\uE81C" };
    private readonly TsQueryError _historyError = new();
    private readonly TsTableSkeleton _historyLoading = new(6);

    /// <summary>Creates the page over the default empty feeds and the shell resource localizer.</summary>
    public SmartChargePage()
        : this(
            EmptyRatePlansSource.Instance,
            EmptyChargePlansSource.Instance,
            NoopOptimizeChargeClient.Instance,
            NoopApplyScheduleClient.Instance,
            NoVehicleSource.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / DI hosts).</summary>
    /// <param name="ratePlansSource">The cache-then-network rate-plans port (native <c>useRatePlans</c>).</param>
    /// <param name="plansSource">The cache-then-network plan-history port (native <c>useChargePlans</c>).</param>
    /// <param name="optimizeClient">The optimize mutation port (native <c>useOptimizeCharge</c>).</param>
    /// <param name="applyClient">The apply mutation port (native <c>useApplySchedule</c>).</param>
    /// <param name="vehicles">The selected/primary vehicle source (native <c>useSelectedVehicle</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SmartChargePage(
        IRatePlansSource ratePlansSource,
        IChargePlansSource plansSource,
        IOptimizeChargeClient optimizeClient,
        IApplyScheduleClient applyClient,
        TeslaSync.App.Core.Widgets.IWidgetVehicleSource vehicles,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(ratePlansSource);
        ArgumentNullException.ThrowIfNull(plansSource);
        ArgumentNullException.ThrowIfNull(optimizeClient);
        ArgumentNullException.ThrowIfNull(applyClient);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SmartChargePageViewModel(ratePlansSource, plansSource, optimizeClient, applyClient, vehicles, localizer);

        _historyError.ActionText = localizer.GetString("error.retry", "Retry");
        _historyTable.EmptyMessage = localizer.GetString("chargePlanner.noHistory", "No charge plans yet. Optimize a schedule above to get started.");

        InitialiseFormControls();
        Content = BuildLayout();

        _historyError.ActionInvoked += OnRetryInvoked;
        _optimizeButton.Click += OnOptimizeClicked;
        _applyButton.Click += OnApplyClicked;
        _ratePlanSelect.SelectionChanged += OnRatePlanChanged;
        _targetSocSlider.ValueChanged += OnTargetSocChanged;
        _departDate.SelectedDateChanged += OnDepartChanged;
        _departTime.SelectedTimeChanged += OnDepartTimeChanged;
        _maxAmpsBox.ValueChanged += OnMaxAmpsChanged;
        _batteryBox.ValueChanged += OnBatteryChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>SmartCharge</c>).</summary>
    public static string RouteName => SmartChargeRegistration.RouteName;

    private void InitialiseFormControls()
    {
        _targetSocSlider.Value = _viewModel.TargetSoc;
        _targetSocValue.Value = FormatPercent(_viewModel.TargetSoc);
        _departDate.SelectedDate = _viewModel.DepartBy;
        _departTime.SelectedTime = _viewModel.DepartBy.TimeOfDay;
        _maxAmpsBox.Value = _viewModel.MaxAmps;
        _batteryBox.Value = _viewModel.BatteryCapacityKwh;
        _ratePlanSelect.DisplayMemberPath = nameof(RatePlanOption.DisplayLabel);
        _historyTable.Columns = BuildColumns(_viewModel.Display.HistoryColumns);
    }

    private ScrollViewer BuildLayout()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        Grid.SetColumn(_freshness, 1);
        header.Children.Add(titleStack);
        header.Children.Add(_freshness);

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(BuildSettingsPanel());
        stack.Children.Add(BuildTimelinePanel());
        stack.Children.Add(BuildCostRow());
        stack.Children.Add(BuildSchedulePanel());
        stack.Children.Add(BuildHistoryPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private TsGlassPanel BuildSettingsPanel()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var socRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        _targetSocSlider.MinWidth = 160;
        socRow.Children.Add(_targetSocSlider);
        socRow.Children.Add(_targetSocValue);

        var departRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        departRow.Children.Add(_departDate);
        departRow.Children.Add(_departTime);

        AddField(grid, 0, 0, _ratePlanLabel, _ratePlanSelect);
        AddField(grid, 0, 1, _targetSocLabel, socRow);
        AddField(grid, 1, 0, _departByLabel, departRow);
        AddField(grid, 1, 1, _maxAmpsLabel, _maxAmpsBox);
        AddField(grid, 2, 0, _batteryLabel, _batteryBox);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_settingsTitle);
        column.Children.Add(grid);
        column.Children.Add(_optimizeButton);
        column.Children.Add(_optimizeError);
        _settingsPanel.Content = column;
        AutomationProperties.SetName(_settingsPanel, _viewModel.Display.SettingsTitle);
        return _settingsPanel;
    }

    private static void AddField(Grid grid, int row, int col, Label label, FrameworkElement control)
    {
        var field = new StackPanel { Spacing = 6 };
        field.Children.Add(label);
        field.Children.Add(control);
        Grid.SetRow(field, row);
        Grid.SetColumn(field, col);
        grid.Children.Add(field);
    }

    private TsGlassPanel BuildTimelinePanel()
    {
        _timelineEmpty.Visibility = Visibility.Collapsed;
        var hostStack = new StackPanel { Spacing = 8 };
        hostStack.Children.Add(_timelineBars);
        _timelineHost.Content = hostStack;

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_timelineTitle);
        column.Children.Add(_timelineLegend);
        column.Children.Add(_timelineHost);
        column.Children.Add(_timelineEmpty);
        column.Children.Add(_windowInfo);
        _timelinePanel.Content = column;
        return _timelinePanel;
    }

    private Grid BuildCostRow()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Grid.SetColumn(_chargeNowCard, 0);
        Grid.SetColumn(_optimizedCard, 1);
        Grid.SetColumn(_savingsCard, 2);
        grid.Children.Add(_chargeNowCard);
        grid.Children.Add(_optimizedCard);
        grid.Children.Add(_savingsCard);
        return grid;
    }

    private TsGlassPanel BuildSchedulePanel()
    {
        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_scheduleTitle, 0);
        _scheduleTitle.VerticalAlignment = VerticalAlignment.Center;

        var actionHost = new Grid();
        _appliedChip.Children.Add(new FontIcon { Glyph = "\uE73E", FontSize = 14, Foreground = BrushFor("TsColorSuccessBrush") });
        _appliedChip.Children.Add(_appliedText);
        actionHost.Children.Add(_applyButton);
        actionHost.Children.Add(_appliedChip);
        Grid.SetColumn(actionHost, 1);
        headerRow.Children.Add(_scheduleTitle);
        headerRow.Children.Add(actionHost);

        _scheduleDetails.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _scheduleDetails.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _scheduleDetails.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _scheduleDetails.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _scheduleDetails.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var alternatives = new StackPanel { Spacing = 8 };
        alternatives.Children.Add(_alternativesTitle);
        alternatives.Children.Add(_alternativesHost);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(headerRow);
        column.Children.Add(_applyError);
        column.Children.Add(_scheduleDetails);
        column.Children.Add(alternatives);
        _schedulePanel.Content = column;
        return _schedulePanel;
    }

    private TsGlassPanel BuildHistoryPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_historyTitle);
        column.Children.Add(_historyHost);
        _historyPanel.Content = column;
        return _historyPanel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnOptimizeClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.OptimizeAsync());

    private void OnApplyClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.ApplyAsync());

    private void OnRatePlanChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressRatePlan)
        {
            return;
        }

        if (_ratePlanSelect.SelectedItem is RatePlanOption option)
        {
            _viewModel.RatePlanId = option.Id;
        }
    }

    private void OnTargetSocChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        int value = (int)Math.Round(e.NewValue, MidpointRounding.AwayFromZero);
        _viewModel.TargetSoc = value;
        _targetSocValue.Value = FormatPercent(_viewModel.TargetSoc);
    }

    private void OnDepartChanged(DatePicker sender, DatePickerSelectedValueChangedEventArgs args) => UpdateDepartBy();

    private void OnDepartTimeChanged(TimePicker sender, TimePickerSelectedValueChangedEventArgs args) => UpdateDepartBy();

    private void UpdateDepartBy()
    {
        DateTimeOffset date = _departDate.SelectedDate ?? _viewModel.DepartBy;
        TimeSpan time = _departTime.SelectedTime ?? _viewModel.DepartBy.TimeOfDay;
        _viewModel.DepartBy = new DateTimeOffset(date.Year, date.Month, date.Day, time.Hours, time.Minutes, 0, date.Offset);
    }

    private void OnMaxAmpsChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!double.IsNaN(args.NewValue))
        {
            _viewModel.MaxAmps = (int)Math.Round(args.NewValue, MidpointRounding.AwayFromZero);
        }
    }

    private void OnBatteryChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!double.IsNaN(args.NewValue))
        {
            _viewModel.BatteryCapacityKwh = args.NewValue;
        }
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var d = _viewModel.Display;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.DocumentTitle);

        RenderSettings(d);
        RenderTimeline(d);
        RenderCostCards(d);
        RenderSchedule(d);
        RenderHistory(d);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private void RenderSettings(SmartChargeDisplay d)
    {
        _settingsTitle.Value = d.SettingsTitle;
        _ratePlanLabel.Value = d.RatePlanLabel;
        _targetSocLabel.Value = d.TargetSocLabel;
        _departByLabel.Value = d.DepartByLabel;
        _maxAmpsLabel.Value = d.MaxAmpsLabel;
        _batteryLabel.Value = d.BatteryCapacityLabel;
        _optimizeButton.Text = d.OptimizeText;
        _optimizeButton.IsLoading = _viewModel.IsOptimizing;
        _optimizeButton.IsEnabled = _viewModel.CanOptimize;
        AutomationProperties.SetName(_optimizeButton, d.OptimizeText);

        SyncRatePlanOptions();

        _optimizeError.Value = _viewModel.OptimizeErrorMessage ?? string.Empty;
        _optimizeError.Visibility = string.IsNullOrEmpty(_viewModel.OptimizeErrorMessage) ? Visibility.Collapsed : Visibility.Visible;
    }

    private void SyncRatePlanOptions()
    {
        var options = _viewModel.RatePlanOptions;
        if (ReferenceEquals(_ratePlanSelect.ItemsSource, options))
        {
            return;
        }

        _suppressRatePlan = true;
        _ratePlanSelect.ItemsSource = options;
        RatePlanOption? selected = null;
        foreach (var option in options)
        {
            if (string.Equals(option.Id, _viewModel.RatePlanId, StringComparison.Ordinal))
            {
                selected = option;
                break;
            }
        }

        _ratePlanSelect.SelectedItem = selected ?? (options.Count > 0 ? options[0] : null);
        if (_ratePlanSelect.SelectedItem is RatePlanOption chosen)
        {
            _viewModel.RatePlanId = chosen.Id;
        }

        _suppressRatePlan = false;
    }

    private void RenderTimeline(SmartChargeDisplay d)
    {
        _timelineTitle.Value = d.RateTimelineTitle;
        BuildLegend(d);

        if (d.HasRateBars)
        {
            _timelineHost.Visibility = Visibility.Visible;
            _timelineEmpty.Visibility = Visibility.Collapsed;
            BuildTimelineBars(d);
            _windowInfo.Value = d.WindowInfoText;
            _windowInfo.Visibility = string.IsNullOrEmpty(d.WindowInfoText) ? Visibility.Collapsed : Visibility.Visible;
        }
        else
        {
            _timelineHost.Visibility = Visibility.Collapsed;
            _timelineEmpty.Message = d.NoRateDataMessage;
            _timelineEmpty.Visibility = Visibility.Visible;
            _windowInfo.Visibility = Visibility.Collapsed;
            AutomationProperties.SetName(_timelineEmpty, d.NoRateDataMessage);
        }

        AutomationProperties.SetName(_timelinePanel, d.RateTimelineTitle);
    }

    private void BuildLegend(SmartChargeDisplay d)
    {
        _timelineLegend.Children.Clear();
        _timelineLegend.Children.Add(LegendSwatch(BrushFor("TsColorSuccessBrush"), d.OffPeakLabel));
        _timelineLegend.Children.Add(LegendSwatch(BrushFor("TsColorWarningBrush"), d.MidPeakLabel));
        _timelineLegend.Children.Add(LegendSwatch(BrushFor("TsColorDangerBrush"), d.OnPeakLabel));
        if (d.HasResult)
        {
            _timelineLegend.Children.Add(LegendSwatch(BrushFor("TsChartSpeedBrush"), d.ChargeWindowLabel));
        }
    }

    private void BuildTimelineBars(SmartChargeDisplay d)
    {
        _timelineBars.Children.Clear();
        _timelineBars.ColumnDefinitions.Clear();
        var labelRow = new Grid { ColumnSpacing = 2 };

        for (int i = 0; i < d.RateBars.Count; i++)
        {
            _timelineBars.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var bar = d.RateBars[i];
            var rect = new Border
            {
                Height = Math.Max(bar.HeightFraction * TimelineHeight, 4),
                VerticalAlignment = VerticalAlignment.Bottom,
                CornerRadius = new CornerRadius(2, 2, 0, 0),
                Background = bar.InWindow ? BrushFor("TsChartSpeedBrush") : BrushFor(StatusResources.AccentBrushKey(bar.Status)),
            };
            ToolTipService.SetToolTip(rect, bar.Tooltip);
            AutomationProperties.SetName(rect, bar.Tooltip);
            Grid.SetColumn(rect, i);
            _timelineBars.Children.Add(rect);

            var label = new Caption { Value = bar.ShowLabel ? bar.HourLabel : string.Empty, HorizontalAlignment = HorizontalAlignment.Center };
            Grid.SetColumn(label, i);
            labelRow.Children.Add(label);
        }

        if (_timelineHost.Content is StackPanel host)
        {
            if (host.Children.Count > 1)
            {
                host.Children.RemoveAt(host.Children.Count - 1);
            }

            host.Children.Add(labelRow);
        }
    }

    private void RenderCostCards(SmartChargeDisplay d)
    {
        ApplyCostStat(_chargeNowCard, d.CostStats, 0);
        ApplyCostStat(_optimizedCard, d.CostStats, 1);
        ApplyCostStat(_savingsCard, d.CostStats, 2);
    }

    private static void ApplyCostStat(TsStatCard card, IReadOnlyList<CostStat> stats, int index)
    {
        if (index >= stats.Count)
        {
            return;
        }

        var stat = stats[index];
        card.Label = stat.Label;
        card.Value = stat.Value;
        card.Sublabel = stat.Sublabel;
        card.Glyph = stat.Glyph;
    }

    private void RenderSchedule(SmartChargeDisplay d)
    {
        _scheduleTitle.Value = d.ScheduleTitle;
        _applyButton.Text = d.ApplyText;
        _appliedText.Value = d.AppliedText;
        _appliedText.Foreground = BrushFor("TsColorSuccessBrush");
        AutomationProperties.SetName(_applyButton, d.ApplyText);
        AutomationProperties.SetName(_schedulePanel, d.ScheduleTitle);

        bool applied = _viewModel.Applied;
        _appliedChip.Visibility = applied ? Visibility.Visible : Visibility.Collapsed;
        _applyButton.Visibility = applied ? Visibility.Collapsed : Visibility.Visible;
        _applyButton.IsLoading = _viewModel.IsApplying;
        _applyButton.IsEnabled = _viewModel.CanApply;

        _applyError.Value = _viewModel.ApplyErrorMessage ?? string.Empty;
        _applyError.Visibility = string.IsNullOrEmpty(_viewModel.ApplyErrorMessage) ? Visibility.Collapsed : Visibility.Visible;

        BuildScheduleDetails(d);
        BuildAlternatives(d);
    }

    private void BuildScheduleDetails(SmartChargeDisplay d)
    {
        _scheduleDetails.Children.Clear();
        for (int i = 0; i < d.ScheduleDetails.Count && i < 4; i++)
        {
            var detail = d.ScheduleDetails[i];
            var cell = new StackPanel { Spacing = 4 };
            cell.Children.Add(new Caption { Value = detail.Label });
            cell.Children.Add(new Text { Value = detail.Value });
            Grid.SetColumn(cell, i);
            Grid.SetRow(cell, 0);
            _scheduleDetails.Children.Add(cell);
            AutomationProperties.SetName(cell, string.Create(CultureInfo.InvariantCulture, $"{detail.Label}: {detail.Value}"));
        }
    }

    private void BuildAlternatives(SmartChargeDisplay d)
    {
        _alternativesTitle.Value = d.AlternativesTitle;
        _alternativesTitle.Visibility = d.HasAlternatives ? Visibility.Visible : Visibility.Collapsed;
        _alternativesHost.Children.Clear();
        _alternativesHost.Visibility = d.HasAlternatives ? Visibility.Visible : Visibility.Collapsed;

        foreach (var alt in d.AlternativeWindows)
        {
            var row = new Grid { Padding = new Thickness(12, 8, 12, 8) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var windowText = new Text { Value = alt.Window, VerticalAlignment = VerticalAlignment.Center };
            var tierText = new Caption { Value = alt.Tier, Margin = new Thickness(12, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
            var costText = new Text { Value = alt.Cost, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(windowText, 0);
            Grid.SetColumn(tierText, 1);
            Grid.SetColumn(costText, 2);
            row.Children.Add(windowText);
            row.Children.Add(tierText);
            row.Children.Add(costText);
            AutomationProperties.SetName(row, string.Create(CultureInfo.InvariantCulture, $"{alt.Window}, {alt.Tier}, {alt.Cost}"));
            _alternativesHost.Children.Add(row);
        }
    }

    private void RenderHistory(SmartChargeDisplay d)
    {
        _historyTitle.Value = d.HistoryTitle;
        _historyEmpty.Message = d.HistoryEmptyMessage;
        _historyTable.EmptyMessage = d.HistoryEmptyMessage;
        AutomationProperties.SetName(_historyEmpty, d.HistoryEmptyMessage);
        AutomationProperties.SetName(_historyPanel, d.HistoryTitle);

        switch (_viewModel.State)
        {
            case SmartChargeState.Loading:
                _historyHost.Content = _historyLoading;
                break;

            case SmartChargeState.Error:
                _historyError.Title = _viewModel.ErrorMessage ?? string.Empty;
                AutomationProperties.SetName(_historyError, _viewModel.ErrorMessage ?? d.HistoryTitle);
                _historyHost.Content = _historyError;
                break;

            case SmartChargeState.Empty:
                _historyHost.Content = _historyEmpty;
                break;

            default:
                _historyTable.Columns = BuildColumns(d.HistoryColumns);
                _historyTable.Rows = BuildRows(d.HistoryRows);
                AutomationProperties.SetName(_historyTable, d.HistoryTitle);
                _historyHost.Content = _historyTable;
                break;
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<SmartChargeColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn { Key = column.Key, Header = column.Header, IsNumeric = column.IsNumeric });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<SmartChargeHistoryRow> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["window"] = row.Window,
                ["plan"] = row.Plan,
                ["cost"] = row.Cost,
                ["saved"] = row.Saved,
                ["status"] = row.Status,
            };
            built.Add(new TsDataRow(row.Id, values));
        }

        return built;
    }

    private static StackPanel LegendSwatch(Brush brush, string label)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new Rectangle { Width = 12, Height = 12, RadiusX = 2, RadiusY = 2, Fill = brush, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private static string FormatPercent(int value) =>
        string.Create(CultureInfo.InvariantCulture, $"{value}%");

    private static Brush BrushFor(string key) =>
        Application.Current.Resources.TryGetValue(key, out var v) && v is Brush b
            ? b
            : new SolidColorBrush(Microsoft.UI.Colors.Gray);

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _historyError.ActionInvoked -= OnRetryInvoked;
        _optimizeButton.Click -= OnOptimizeClicked;
        _applyButton.Click -= OnApplyClicked;
        _ratePlanSelect.SelectionChanged -= OnRatePlanChanged;
        _targetSocSlider.ValueChanged -= OnTargetSocChanged;
        _departDate.SelectedDateChanged -= OnDepartChanged;
        _departTime.SelectedTimeChanged -= OnDepartTimeChanged;
        _maxAmpsBox.ValueChanged -= OnMaxAmpsChanged;
        _batteryBox.ValueChanged -= OnBatteryChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }
}
