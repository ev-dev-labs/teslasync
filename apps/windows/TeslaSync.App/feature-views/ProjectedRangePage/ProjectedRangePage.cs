using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>ProjectedRangePage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/ProjectedRangePage.tsx</c> (route <c>/analytics/range</c>; visible nav
/// item <c>/projected-range</c>; nav name <c>ProjectedRange</c>). It binds to a
/// <see cref="ProjectedRangePageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header with a data-freshness chip; the failure banner; the five hero metric panels (Your /
/// Tesla estimate, Battery, Usable Capacity, Health Factor); the efficiency radial gauge with its accuracy
/// note; the rated-vs-projected projection-curve area chart with the current-SoC reference line; the range
/// scenario cards; the personal efficiency heatmap; the interactive "what if" calculator (two sliders + a live
/// projected readout); the range-factor cards; the tips list; and the page-level empty state. The view is a
/// thin renderer: all branch selection, formatting, i18n and the what-if interpolation happen in the
/// view-model's <see cref="RangeProjectionDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ProjectedRangePage : UserControl, IDisposable
{
    private readonly ProjectedRangePageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly ProjectedRangePageDiagnostics _diagnostics;
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly StackPanel _loadingPanel;
    private readonly Caption _loadingCaption = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private readonly StackPanel _contentPanel = new() { Spacing = 16 };

    // Hero (GlassPanel1..5 → MetricCard). Glow + accent brush are a per-tile view concern.
    private readonly HeroTile _yourTile = new(GlassGlow.Green, "TsChartBatteryBrush");
    private readonly HeroTile _teslaTile = new(GlassGlow.Cyan, "TsChartSpeedBrush");
    private readonly HeroTile _batteryTile = new(GlassGlow.Purple, "TsChartPowerBrush");
    private readonly HeroTile _capacityTile = new(GlassGlow.None, "TsChartTemperatureBrush");
    private readonly HeroTile _healthTile = new(GlassGlow.Green, "TsChartBatteryBrush");

    // Efficiency gauge (GlassPanel6 + RadialGauge).
    private readonly TsGlassPanel _gaugePanel = new() { Padding = new Thickness(24) };
    private readonly TsRadialGauge _gauge = new() { Diameter = 160, Unit = "%", Decimals = 0 };
    private readonly Caption _accuracyNote = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    // Projection curve (GlassPanel7 + AreaChart in a ChartContainer).
    private readonly TsChartContainer _curveContainer = new();
    private readonly TsAreaChart _curveChart = new() { Height = 260, IncludeZero = true };

    // Scenarios (GlassPanel8 outer + GlassPanel9 repeated cards).
    private readonly TsGlassPanel _scenariosPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _scenariosTitle = new();
    private readonly Grid _scenariosHost = new() { ColumnSpacing = 12, RowSpacing = 12 };
    private readonly TsEmptyState _scenariosEmpty = new() { IconGlyph = "\uE804", Visibility = Visibility.Collapsed };

    // Efficiency matrix (GlassPanel10).
    private readonly TsGlassPanel _matrixPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _matrixTitle = new();
    private readonly Grid _matrixHost = new() { ColumnSpacing = 6, RowSpacing = 6 };
    private readonly TsEmptyState _matrixEmpty = new() { IconGlyph = "\uE9D2", Visibility = Visibility.Collapsed };

    // What-if calculator (GlassPanel11).
    private readonly TsGlassPanel _whatIfPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _whatIfTitle = new();
    private readonly TsSlider _speedSlider = new() { Minimum = 30, Maximum = 150, StepFrequency = 5, Value = RangeProjectionProjection.DefaultWhatIfSpeedKmh };
    private readonly TsSlider _tempSlider = new() { Minimum = -20, Maximum = 40, StepFrequency = 1, Value = RangeProjectionProjection.DefaultWhatIfTempC };
    private readonly Caption _speedLabel = new();
    private readonly Caption _speedValue = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Caption _tempLabel = new();
    private readonly Caption _tempValue = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly MetricValue _whatIfRange = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _whatIfEff = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _whatIfConditions = new() { HorizontalAlignment = HorizontalAlignment.Center };

    // Range factors (GlassPanel12 outer + GlassPanel13 repeated cards).
    private readonly TsGlassPanel _factorsPanel = new() { Padding = new Thickness(20) };
    private readonly PanelTitle _factorsTitle = new();
    private readonly Grid _factorsHost = new() { ColumnSpacing = 12, RowSpacing = 12 };

    // Tips (GlassPanel14).
    private readonly TsGlassPanel _tipsPanel = new() { Padding = new Thickness(20) };
    private readonly PanelTitle _tipsTitle = new();
    private readonly StackPanel _tipsHost = new() { Spacing = 8 };

    // Page-level empty state.
    private readonly TsGlassPanel _emptyPanel = new() { Padding = new Thickness(32) };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE9A9" };

    /// <summary>Creates the page over the default empty projection feed and the shell resource localizer.</summary>
    public ProjectedRangePage()
        : this(EmptyRangeProjectionSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data source and localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The cache-then-network range-projection port (native <c>useQuery</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ProjectedRangePage(IRangeProjectionSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ProjectedRangePageViewModel(source, localizer);
        _diagnostics = new ProjectedRangePageDiagnostics();

        _loadingPanel = BuildLoadingPanel(localizer);

        Content = BuildLayout();

        _speedSlider.ValueChanged += OnSpeedChanged;
        _tempSlider.ValueChanged += OnTempChanged;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>ProjectedRange</c>).</summary>
    public static string RouteName => ProjectedRangePageRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ProjectedRangePageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(_freshness);
        header.Children.Add(titleRow);

        BuildContentPanel();
        BuildEmptyPanel();

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_contentPanel);
        stack.Children.Add(_emptyPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private static StackPanel BuildLoadingPanel(ILocalizer localizer)
    {
        var panel = new StackPanel
        {
            Spacing = 12,
            MinHeight = 200,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 32, Height = 32 });
        var caption = new Caption { HorizontalAlignment = HorizontalAlignment.Center, Value = localizer.GetString("common.loading", "Loading\u2026") };
        panel.Children.Add(caption);
        return panel;
    }

    private void BuildContentPanel()
    {
        // Hero metric panels (GlassPanel1..5).
        _contentPanel.Children.Add(UniformGrid(5, 12,
            _yourTile.Panel, _teslaTile.Panel, _batteryTile.Panel, _capacityTile.Panel, _healthTile.Panel));

        // Efficiency gauge + projection curve (web md:grid-cols-3 → gauge span 1, curve span 2).
        var gaugeColumn = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        gaugeColumn.Children.Add(_gauge);
        gaugeColumn.Children.Add(_accuracyNote);
        _gaugePanel.Content = gaugeColumn;

        _curveChart.ShowLegend = true;
        _curveContainer.Body = _curveChart;

        var gaugeCurveRow = new Grid { ColumnSpacing = 16 };
        gaugeCurveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        gaugeCurveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        Grid.SetColumn(_gaugePanel, 0);
        Grid.SetColumn(_curveContainer, 1);
        gaugeCurveRow.Children.Add(_gaugePanel);
        gaugeCurveRow.Children.Add(_curveContainer);
        _contentPanel.Children.Add(gaugeCurveRow);

        // Scenarios.
        var scenariosColumn = new StackPanel { Spacing = 16 };
        scenariosColumn.Children.Add(_scenariosTitle);
        scenariosColumn.Children.Add(_scenariosHost);
        scenariosColumn.Children.Add(_scenariosEmpty);
        _scenariosPanel.Content = scenariosColumn;
        _contentPanel.Children.Add(_scenariosPanel);

        // Efficiency matrix.
        var matrixColumn = new StackPanel { Spacing = 16 };
        matrixColumn.Children.Add(_matrixTitle);
        matrixColumn.Children.Add(_matrixHost);
        matrixColumn.Children.Add(_matrixEmpty);
        _matrixPanel.Content = matrixColumn;
        _contentPanel.Children.Add(_matrixPanel);

        // What-if calculator.
        _contentPanel.Children.Add(BuildWhatIfPanel());

        // Range factors.
        var factorsColumn = new StackPanel { Spacing = 12 };
        factorsColumn.Children.Add(_factorsTitle);
        factorsColumn.Children.Add(_factorsHost);
        _factorsPanel.Content = factorsColumn;
        _contentPanel.Children.Add(_factorsPanel);

        // Tips.
        var tipsColumn = new StackPanel { Spacing = 12 };
        tipsColumn.Children.Add(_tipsTitle);
        tipsColumn.Children.Add(_tipsHost);
        _tipsPanel.Content = tipsColumn;
        _contentPanel.Children.Add(_tipsPanel);

        _contentPanel.Visibility = Visibility.Collapsed;
    }

    private TsGlassPanel BuildWhatIfPanel()
    {
        var speedHeader = new Grid();
        speedHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        speedHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_speedLabel, 0);
        Grid.SetColumn(_speedValue, 1);
        speedHeader.Children.Add(_speedLabel);
        speedHeader.Children.Add(_speedValue);

        var tempHeader = new Grid();
        tempHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        tempHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_tempLabel, 0);
        Grid.SetColumn(_tempValue, 1);
        tempHeader.Children.Add(_tempLabel);
        tempHeader.Children.Add(_tempValue);

        var sliders = new StackPanel { Spacing = 16 };
        var speedBlock = new StackPanel { Spacing = 2 };
        speedBlock.Children.Add(speedHeader);
        speedBlock.Children.Add(_speedSlider);
        var tempBlock = new StackPanel { Spacing = 2 };
        tempBlock.Children.Add(tempHeader);
        tempBlock.Children.Add(_tempSlider);
        sliders.Children.Add(speedBlock);
        sliders.Children.Add(tempBlock);

        var result = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        result.Children.Add(_whatIfRange);
        result.Children.Add(_whatIfEff);
        result.Children.Add(_whatIfConditions);

        var body = new Grid { ColumnSpacing = 24 };
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        Grid.SetColumn(sliders, 0);
        Grid.SetColumn(result, 1);
        body.Children.Add(sliders);
        body.Children.Add(result);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_whatIfTitle);
        column.Children.Add(body);
        _whatIfPanel.Content = column;
        return _whatIfPanel;
    }

    private void BuildEmptyPanel()
    {
        _emptyPanel.Content = _emptyState;
        _emptyPanel.Visibility = Visibility.Collapsed;
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

    private void OnSpeedChanged(object sender, RangeBaseValueChangedEventArgs e) =>
        _viewModel.WhatIfSpeedKmh = e.NewValue;

    private void OnTempChanged(object sender, RangeBaseValueChangedEventArgs e) =>
        _viewModel.WhatIfTempC = e.NewValue;

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
        var state = _viewModel.State;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;

        // Hero panels.
        _yourTile.Apply(d.YourEstimate);
        _teslaTile.Apply(d.TeslaEstimate);
        _batteryTile.Apply(d.Battery);
        _capacityTile.Apply(d.UsableCapacity);
        _healthTile.Apply(d.HealthFactor);

        // Efficiency gauge.
        _gauge.Label = d.EfficiencyLabel;
        _gauge.Value = d.EfficiencyValue;
        _gauge.Max = 100;
        _gauge.ColorIndex = d.EfficiencyColorIndex;
        _accuracyNote.Value = d.AccuracyNote;
        _accuracyNote.Visibility = string.IsNullOrEmpty(d.AccuracyNote) ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties.SetName(_gaugePanel, $"{d.EfficiencyLabel} {d.EfficiencyValue:0}%");

        // Projection curve.
        _curveContainer.Title = d.CurveTitle;
        _curveContainer.AccessibleSummary = d.CurveAria;
        _curveContainer.EmptyMessage = d.NoDataMessage;
        _curveChart.Series = d.CurveSeries;
        _curveChart.Annotations = d.CurveAnnotations;
        _curveContainer.State = d.HasCurve ? ChartState.Ready : ChartState.Empty;

        // Scenarios.
        _scenariosTitle.Value = d.ScenariosTitle;
        RebuildScenarios(d.Scenarios);
        _scenariosHost.Visibility = d.HasScenarios ? Visibility.Visible : Visibility.Collapsed;
        _scenariosEmpty.Message = d.NoScenariosMessage;
        _scenariosEmpty.Visibility = d.HasScenarios ? Visibility.Collapsed : Visibility.Visible;

        // Efficiency matrix.
        _matrixTitle.Value = d.MatrixTitle;
        RebuildMatrix(d);
        _matrixHost.Visibility = d.HasMatrix ? Visibility.Visible : Visibility.Collapsed;
        _matrixEmpty.Message = d.NoMatrixMessage;
        _matrixEmpty.Visibility = d.HasMatrix ? Visibility.Collapsed : Visibility.Visible;

        // What-if.
        _whatIfTitle.Value = d.WhatIfTitle;
        _speedLabel.Value = d.SpeedLabel;
        _tempLabel.Value = d.TemperatureLabel;
        _speedValue.Value = FormatSpeedLabel(_speedSlider.Value);
        _tempValue.Value = FormatTempLabel(_tempSlider.Value);
        _whatIfRange.Value = d.WhatIfRangeValue;
        _whatIfEff.Value = d.WhatIfEfficiencyValue;
        _whatIfConditions.Value = d.WhatIfConditions;

        // Range factors.
        _factorsTitle.Value = d.FactorsTitle;
        RebuildFactors(d.Factors);

        // Tips.
        _tipsTitle.Value = d.TipsTitle;
        RebuildTips(d.Tips);

        // Page-level empty state.
        _emptyState.Message = d.NoDataMessage;

        // Freshness chip.
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == RangeProjectionState.Offline;

        // State machine: loading / empty / error / success (loaded|stale|offline).
        bool content = state is RangeProjectionState.Loaded or RangeProjectionState.Stale or RangeProjectionState.Offline;
        _loadingPanel.Visibility = state == RangeProjectionState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _emptyPanel.Visibility = state == RangeProjectionState.Empty ? Visibility.Visible : Visibility.Collapsed;

        _errorBanner.IsOpen = state == RangeProjectionState.Error;
        _errorBanner.Message = _viewModel.ErrorMessage ?? string.Empty;

        AutomationProperties.SetName(this, d.Title);
    }

    private void RebuildScenarios(IReadOnlyList<RangeScenarioCard> scenarios)
    {
        _scenariosHost.Children.Clear();
        _scenariosHost.ColumnDefinitions.Clear();
        _scenariosHost.RowDefinitions.Clear();
        if (scenarios.Count == 0)
        {
            return;
        }

        const int columns = 4;
        for (int i = 0; i < columns; i++)
        {
            _scenariosHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < scenarios.Count; i++)
        {
            var card = BuildScenarioCard(scenarios[i]);
            int col = i % columns;
            int row = i / columns;
            while (_scenariosHost.RowDefinitions.Count <= row)
            {
                _scenariosHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            Grid.SetColumn(card, col);
            Grid.SetRow(card, row);
            _scenariosHost.Children.Add(card);
        }
    }

    private static Border BuildScenarioCard(RangeScenarioCard card)
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon { Glyph = card.Glyph, FontSize = 16, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        header.Children.Add(new Caption { Value = card.Name, VerticalAlignment = VerticalAlignment.Center });

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(header, 0);
        headerRow.Children.Add(header);
        if (card.IsCurrent)
        {
            var badge = new TsBadge { Status = StatusKind.Success, Content = card.CurrentLabel };
            Grid.SetColumn(badge, 1);
            headerRow.Children.Add(badge);
        }

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        chips.Children.Add(new Caption { Value = card.SpeedValue });
        chips.Children.Add(new Caption { Value = card.TempValue });
        chips.Children.Add(new Caption { Value = card.EfficiencyValue });
        if (!string.IsNullOrEmpty(card.SamplesValue))
        {
            chips.Children.Add(new Caption { Value = card.SamplesValue });
        }

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(headerRow);
        column.Children.Add(new MetricValue { Value = card.RangeValue });
        column.Children.Add(chips);
        if (card.Extras.Count > 0)
        {
            var extras = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            foreach (var x in card.Extras)
            {
                extras.Children.Add(new TsBadge { Status = StatusKind.Neutral, Content = x });
            }

            column.Children.Add(extras);
        }

        var border = new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(16),
            BorderThickness = new Thickness(1),
            BorderBrush = card.IsCurrent ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.Border,
            Child = column,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        return border;
    }

    private void RebuildMatrix(RangeProjectionDisplay d)
    {
        _matrixHost.Children.Clear();
        _matrixHost.ColumnDefinitions.Clear();
        _matrixHost.RowDefinitions.Clear();
        if (!d.HasMatrix)
        {
            return;
        }

        int columns = d.MatrixSpeedHeaders.Count + 1;
        for (int i = 0; i < columns; i++)
        {
            _matrixHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        _matrixHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (int r = 0; r < d.MatrixRows.Count; r++)
        {
            _matrixHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        // Header row: blank corner + speed-bucket labels.
        for (int c = 0; c < d.MatrixSpeedHeaders.Count; c++)
        {
            var headerCell = new Caption { Value = d.MatrixSpeedHeaders[c], HorizontalAlignment = HorizontalAlignment.Center };
            Grid.SetColumn(headerCell, c + 1);
            Grid.SetRow(headerCell, 0);
            _matrixHost.Children.Add(headerCell);
        }

        for (int r = 0; r < d.MatrixRows.Count; r++)
        {
            var rowData = d.MatrixRows[r];
            var rowLabel = new Caption { Value = rowData.TempLabel, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(rowLabel, 0);
            Grid.SetRow(rowLabel, r + 1);
            _matrixHost.Children.Add(rowLabel);

            for (int c = 0; c < rowData.Cells.Count; c++)
            {
                var cell = BuildMatrixCell(rowData.Cells[c]);
                Grid.SetColumn(cell, c + 1);
                Grid.SetRow(cell, r + 1);
                _matrixHost.Children.Add(cell);
            }
        }
    }

    private static Border BuildMatrixCell(RangeMatrixCell cell)
    {
        var accent = DisplayTokens.Brush(SeverityBrushKey(cell.Severity));
        var column = new StackPanel { Spacing = 0, HorizontalAlignment = HorizontalAlignment.Center };
        var value = new TextBlock
        {
            Text = cell.Value,
            HorizontalAlignment = HorizontalAlignment.Center,
            Foreground = cell.HasData ? accent : DisplayTokens.TextMuted,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 13),
        };
        column.Children.Add(value);
        if (!string.IsNullOrEmpty(cell.Samples))
        {
            column.Children.Add(new Caption { Value = cell.Samples, HorizontalAlignment = HorizontalAlignment.Center });
        }

        var border = new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(8),
            BorderThickness = new Thickness(1),
            BorderBrush = cell.HasData ? accent : DisplayTokens.Border,
            Child = column,
        };
        if (cell.HasData)
        {
            AutomationProperties.SetName(border, cell.AutomationName);
        }

        return border;
    }

    private void RebuildFactors(IReadOnlyList<RangeFactorCard> factors)
    {
        _factorsHost.Children.Clear();
        _factorsHost.ColumnDefinitions.Clear();
        _factorsHost.RowDefinitions.Clear();
        if (factors.Count == 0)
        {
            return;
        }

        const int columns = 3;
        for (int i = 0; i < columns; i++)
        {
            _factorsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < factors.Count; i++)
        {
            var card = BuildFactorCard(factors[i]);
            int col = i % columns;
            int row = i / columns;
            while (_factorsHost.RowDefinitions.Count <= row)
            {
                _factorsHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            Grid.SetColumn(card, col);
            Grid.SetRow(card, row);
            _factorsHost.Children.Add(card);
        }
    }

    private static Border BuildFactorCard(RangeFactorCard card)
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new Text { Value = card.Name, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new TsBadge { Status = card.IsPositive ? StatusKind.Success : StatusKind.Danger, Content = card.ImpactText });

        var iconAndBody = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        iconAndBody.Children.Add(new FontIcon { Glyph = card.Glyph, FontSize = 16, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Top });
        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(titleRow);
        body.Children.Add(new Caption { Value = card.Description });
        iconAndBody.Children.Add(body);

        var border = new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(16),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Child = iconAndBody,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        return border;
    }

    private void RebuildTips(IReadOnlyList<RangeTipItem> tips)
    {
        _tipsHost.Children.Clear();
        foreach (var tip in tips)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(new FontIcon { Glyph = tip.Glyph, FontSize = 16, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Top });
            row.Children.Add(new Text { Value = tip.Text });
            _tipsHost.Children.Add(row);
        }
    }

    private static string FormatSpeedLabel(double kmh) => string.Format(System.Globalization.CultureInfo.CurrentCulture, "{0:0} km/h", kmh);

    private static string FormatTempLabel(double celsius) => string.Format(System.Globalization.CultureInfo.CurrentCulture, "{0:0}\u00B0C", celsius);

    private static string SeverityBrushKey(int severity) => severity switch
    {
        0 or 1 => "TsColorSuccessBrush",
        2 => "TsColorWarningBrush",
        3 => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _speedSlider.ValueChanged -= OnSpeedChanged;
        _tempSlider.ValueChanged -= OnTempChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
    }

    private static Grid UniformGrid(int columns, double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < children.Length; i++)
        {
            int col = i % columns;
            int row = i / columns;
            while (grid.RowDefinitions.Count <= row)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            Grid.SetColumn(children[i], col);
            Grid.SetRow(children[i], row);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    /// <summary>A hero metric panel — a tokenized glass panel with an accent icon, label and value.</summary>
    private sealed class HeroTile
    {
        private readonly FontIcon _icon = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
        private readonly Caption _label = new();
        private readonly MetricValue _value = new();

        public HeroTile(GlassGlow glow, string iconBrushKey)
        {
            _icon.Foreground = DisplayTokens.Brush(iconBrushKey);

            var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            headerRow.Children.Add(_icon);
            headerRow.Children.Add(_label);

            var column = new StackPanel { Spacing = 6 };
            column.Children.Add(headerRow);
            column.Children.Add(_value);

            Panel = new TsGlassPanel { Glow = glow, Padding = new Thickness(20), Content = column };
        }

        public TsGlassPanel Panel { get; }

        public void Apply(RangeHeroStat stat)
        {
            _icon.Glyph = stat.Glyph;
            _label.Value = stat.Label;
            _value.Value = stat.Value;
            AutomationProperties.SetName(Panel, stat.AutomationName);
        }
    }
}
