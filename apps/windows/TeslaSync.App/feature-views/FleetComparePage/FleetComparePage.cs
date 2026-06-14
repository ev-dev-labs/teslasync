using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>FleetComparePage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/FleetComparePage.tsx</c> (route <c>/vehicle-comparison</c>, nav name
/// <c>FleetCompare</c>). It binds a <see cref="FleetComparePageViewModel"/> over the roster + per-vehicle
/// fan-out and reproduces the web layout: the disambiguation banner, the two vehicle selectors, the
/// side-by-side current-status cards, the overlaid monthly-distance line chart, the drives-per-month bar
/// chart, the lifetime comparison table (winner-highlighted) and the key-highlights stat grid — plus the
/// page-level loading skeleton, the focused single-vehicle empty state and the error/offline freshness chips.
/// The view is a thin renderer: all state selection, formatting and i18n happen in the view-model / projection;
/// state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class FleetComparePage : UserControl, IDisposable
{
    private const string CarGlyph = "\uE804";       // Segoe Fluent — Car
    private const string BatteryGlyph = "\uE83F";   // Segoe Fluent — Battery
    private const string RangeGlyph = "\uE9D9";     // Segoe Fluent — Speed/range
    private const string TempGlyph = "\uE9CA";      // Segoe Fluent — Temperature
    private const string SecurityGlyph = "\uE72E";  // Segoe Fluent — Lock
    private const string SentryGlyph = "\uEA18";    // Segoe Fluent — Shield
    private const string StatusGlyph = "\uE701";    // Segoe Fluent — Wifi
    private const string SwapGlyph = "\uE8AB";      // Segoe Fluent — Switch
    private const string InfoGlyph = "\uE946";      // Segoe Fluent — Info
    private const string WinnerMark = " \u2713";    // check mark appended to the winning value

    private readonly FleetComparePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    private readonly TsAlertBanner _disambiguationBanner = new()
    {
        Variant = CalloutVariant.Info,
        IsOpen = true,
        Dismissible = true,
    };

    private readonly StackPanel _loadingPanel;
    private readonly StackPanel _contentPanel = new() { Spacing = 24, Visibility = Visibility.Collapsed };
    private readonly Border _singleVehiclePanel;
    private readonly TsEmptyState _singleVehicleState = new() { IconGlyph = CarGlyph };

    private readonly TsSelect _selectA = new() { MinWidth = 208 };
    private readonly TsSelect _selectB = new() { MinWidth = 208 };
    private readonly Border _statusHostA = new();
    private readonly Border _statusHostB = new();
    private readonly TsChartContainer _monthlyContainer = new();
    private readonly TsLineChart _monthlyChart = new() { MinHeight = 280, ShowLegend = true };
    private readonly TsChartContainer _drivesContainer = new();
    private readonly TsBarChart _drivesChart = new() { MinHeight = 260, ShowLegend = true, IncludeZero = true };
    private readonly StackPanel _tableHost = new() { Spacing = 0 };
    private readonly Grid _highlightsHost = new() { ColumnSpacing = 16, RowSpacing = 16 };

    private string _optionSignatureA = string.Empty;
    private string _optionSignatureB = string.Empty;
    private bool _suppressSelection;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public FleetComparePage()
        : this(EmptyFleetCompareSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit data source, localizer, units and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network fleet-comparison port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference (display boundary).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetComparePage(
        IFleetCompareSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetCompareDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new FleetComparePageViewModel(source, localizer, units, diagnostics);

        _loadingPanel = BuildLoadingSkeleton();
        _singleVehiclePanel = BuildSingleVehiclePanel();

        Content = BuildLayout();
        WireEvents();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when an in-page call-to-action requests navigation to another route (path without a slash).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell registers this page under (<c>FleetCompare</c>).</summary>
    public static string RouteName => FleetCompareRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public FleetComparePageViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects every panel in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    private ScrollViewer BuildLayout()
    {
        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        Grid.SetColumn(_freshness, 1);
        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(_freshness);

        BuildContentPanel();

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(titleRow);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_contentPanel);
        stack.Children.Add(_singleVehiclePanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private void BuildContentPanel()
    {
        _contentPanel.Children.Add(_disambiguationBanner);
        _contentPanel.Children.Add(BuildSelectorsPanel());
        _contentPanel.Children.Add(BuildStatusSection());
        _contentPanel.Children.Add(BuildChart(_monthlyContainer, _monthlyChart));
        _contentPanel.Children.Add(BuildChart(_drivesContainer, _drivesChart));
        _contentPanel.Children.Add(BuildTablePanel());
        _contentPanel.Children.Add(BuildHighlightsSection());
    }

    private TsGlassPanel BuildSelectorsPanel()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        AutomationProperties.SetName(_selectA, _localizer.GetString("comparison.vehicleA", "Vehicle A"));
        AutomationProperties.SetName(_selectB, _localizer.GetString("comparison.vehicleB", "Vehicle B"));

        row.Children.Add(BuildLabeledSelect(_localizer.GetString("comparison.vehicleA", "Vehicle A"), _selectA));
        row.Children.Add(new FontIcon
        {
            Glyph = SwapGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, 8),
        });
        row.Children.Add(BuildLabeledSelect(_localizer.GetString("comparison.vehicleB", "Vehicle B"), _selectB));

        return new TsGlassPanel { Content = row, Padding = new Thickness(16) };
    }

    private static StackPanel BuildLabeledSelect(string label, TsSelect select)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = label });
        stack.Children.Add(select);
        return stack;
    }

    private StackPanel BuildStatusSection()
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new Caption { Value = _localizer.GetString("comparison.currentStatus", "Current Status") });

        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_statusHostA, 0);
        Grid.SetColumn(_statusHostB, 1);
        grid.Children.Add(_statusHostA);
        grid.Children.Add(_statusHostB);

        section.Children.Add(grid);
        return section;
    }

    private static TsChartContainer BuildChart(TsChartContainer container, FrameworkElement chart)
    {
        container.Body = chart;
        return container;
    }

    private TsGlassPanel BuildTablePanel()
    {
        var stack = new StackPanel { Spacing = 12 };

        var note = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        note.Children.Add(new FontIcon { Glyph = InfoGlyph, FontSize = 12, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
        note.Children.Add(new Caption { Value = _localizer.GetString("comparison.lifetimeNote", "Statistics shown are lifetime totals across all tracked data.") });
        stack.Children.Add(note);
        stack.Children.Add(_tableHost);

        return new TsGlassPanel { Content = stack, Padding = new Thickness(16) };
    }

    private StackPanel BuildHighlightsSection()
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new Caption { Value = _localizer.GetString("comparison.highlights", "Key Highlights") });
        for (int c = 0; c < 4; c++)
        {
            _highlightsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        section.Children.Add(_highlightsHost);
        return section;
    }

    private StackPanel BuildLoadingSkeleton()
    {
        // Native mirror of the web loading layout: a selectors bar, two status cards, two charts and a table.
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };
        panel.Children.Add(SkeletonPanel(64));
        panel.Children.Add(SkeletonGrid(2, 2, 200));
        panel.Children.Add(SkeletonPanel(280));
        panel.Children.Add(SkeletonPanel(260));

        var table = new TsGlassPanel { Padding = new Thickness(16) };
        var tableStack = new StackPanel { Spacing = 8 };
        for (int i = 0; i < 6; i++)
        {
            tableStack.Children.Add(new TsSkeleton { BlockHeight = 28 });
        }

        table.Content = tableStack;
        panel.Children.Add(table);

        AutomationProperties.SetName(panel, _localizer.GetString("comparison.title", "Fleet Comparison"));
        return panel;
    }

    private static TsGlassPanel SkeletonPanel(double height) => new()
    {
        Padding = new Thickness(16),
        Content = new TsSkeleton { BlockHeight = height },
    };

    private static Grid SkeletonGrid(int columns, int tiles, double blockHeight)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < tiles; i++)
        {
            var panel = SkeletonPanel(blockHeight);
            Grid.SetColumn(panel, i % columns);
            grid.Children.Add(panel);
        }

        return grid;
    }

    private Border BuildSingleVehiclePanel()
    {
        _singleVehicleState.HorizontalAlignment = HorizontalAlignment.Center;
        _singleVehicleState.VerticalAlignment = VerticalAlignment.Center;
        _singleVehicleState.ActionInvoked += (_, _) => RaiseNavigation(FleetCompareRegistration.VehiclesRoute);
        return new Border
        {
            MinHeight = 360,
            Visibility = Visibility.Collapsed,
            Padding = new Thickness(24),
            Child = _singleVehicleState,
        };
    }

    private void WireEvents()
    {
        _selectA.SelectionChanged += (_, _) => OnSelectionChanged(_selectA, isA: true);
        _selectB.SelectionChanged += (_, _) => OnSelectionChanged(_selectB, isA: false);

        _disambiguationBanner.Message = _localizer.GetString("comparison.banner.toPeriodPrefix", "Looking to compare time periods instead?");
        _disambiguationBanner.ActionText = _localizer.GetString("comparison.banner.toPeriodCta", "Open Period comparison \u2192");
        _disambiguationBanner.ActionInvoked += (_, _) => RaiseNavigation(FleetCompareRegistration.PeriodCompareRoute);
        _disambiguationBanner.Dismissed += (_, _) => _disambiguationBanner.Visibility = Visibility.Collapsed;

        _monthlyContainer.EmptyMessage = _localizer.GetString("comparison.noMonthlyData", "No monthly data available yet");
        _drivesContainer.EmptyMessage = _localizer.GetString("comparison.noDrivesData", "No drive data available yet");
    }

    private void OnSelectionChanged(TsSelect select, bool isA)
    {
        if (_suppressSelection)
        {
            return;
        }

        if (select.SelectedItem is ComboBoxItem { Tag: long id })
        {
            if (isA)
            {
                _viewModel.SelectA(id);
            }
            else
            {
                _viewModel.SelectB(id);
            }
        }
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

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            RenderCoalesced();
        }
        else
        {
            _dispatcher.TryEnqueue(RenderCoalesced);
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var state = _viewModel.State;
        var display = _viewModel.Display;

        _title.Value = _viewModel.Title;
        _subtitle.Value = _viewModel.Subtitle;

        _singleVehicleState.Title = FleetCompareRegistration.SingleVehicleTitle(_localizer);
        _singleVehicleState.Message = FleetCompareRegistration.SingleVehicleBody(_localizer);
        _singleVehicleState.ActionText = FleetCompareRegistration.SingleVehicleCta(_localizer);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == FleetCompareState.Offline;

        bool content = _viewModel.HasContent;
        if (content)
        {
            UpdateContent(display);
        }

        _loadingPanel.Visibility = state == FleetCompareState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _singleVehiclePanel.Visibility = state == FleetCompareState.SingleVehicle ? Visibility.Visible : Visibility.Collapsed;

        _errorBanner.IsOpen = state == FleetCompareState.Error;
        _errorBanner.Message = _viewModel.ErrorMessage ?? string.Empty;

        AutomationProperties.SetName(this, _viewModel.Title);
    }

    private void UpdateContent(FleetCompareDisplay display)
    {
        UpdateSelect(_selectA, display.OptionsA, display.SelectedA, ref _optionSignatureA);
        UpdateSelect(_selectB, display.OptionsB, display.SelectedB, ref _optionSignatureB);

        _statusHostA.Child = BuildStatusCard(display.CardA);
        _statusHostB.Child = BuildStatusCard(display.CardB);

        UpdateChart(_monthlyContainer, _monthlyChart, display.MonthlyHasData, display.MonthlySeries,
            _localizer.GetString("comparison.monthlyDistance", "Monthly Distance"),
            _localizer.GetString("comparison.monthlyDistance.aria", "Monthly distance comparison line chart between two vehicles"));

        UpdateChart(_drivesContainer, _drivesChart, display.DrivesHasData, display.DrivesSeries,
            _localizer.GetString("comparison.drivesPerMonth", "Drives per Month"),
            _localizer.GetString("comparison.drivesPerMonth.aria", "Drives per month bar chart comparing two vehicles"));

        BuildTable(display);
        BuildHighlights(display.Highlights);
    }

    private void UpdateSelect(TsSelect select, IReadOnlyList<FleetCompareOption> options, long? selected, ref string signature)
    {
        _suppressSelection = true;
        try
        {
            string next = SignatureOf(options);
            if (!string.Equals(next, signature, StringComparison.Ordinal))
            {
                signature = next;
                select.Items.Clear();
                foreach (var option in options)
                {
                    select.Items.Add(new ComboBoxItem
                    {
                        Content = option.Label,
                        Tag = option.Id,
                        IsEnabled = !option.Disabled,
                    });
                }
            }
            else
            {
                foreach (var item in select.Items)
                {
                    if (item is ComboBoxItem { Tag: long id } box)
                    {
                        box.IsEnabled = !IsDisabled(options, id);
                    }
                }
            }

            select.SelectedItem = FindItem(select, selected);
        }
        finally
        {
            _suppressSelection = false;
        }
    }

    private static string SignatureOf(IReadOnlyList<FleetCompareOption> options)
    {
        var parts = new string[options.Count];
        for (int i = 0; i < options.Count; i++)
        {
            parts[i] = options[i].Id.ToString(CultureInfo.InvariantCulture) + ':' + options[i].Label;
        }

        return string.Join('|', parts);
    }

    private static bool IsDisabled(IReadOnlyList<FleetCompareOption> options, long id)
    {
        foreach (var option in options)
        {
            if (option.Id == id)
            {
                return option.Disabled;
            }
        }

        return false;
    }

    private static ComboBoxItem? FindItem(TsSelect select, long? selected)
    {
        if (selected is not { } id)
        {
            return null;
        }

        foreach (var item in select.Items)
        {
            if (item is ComboBoxItem { Tag: long boxId } box && boxId == id)
            {
                return box;
            }
        }

        return null;
    }

    private static void UpdateChart(
        TsChartContainer container,
        TsCartesianChart chart,
        bool hasData,
        IReadOnlyList<ChartSeries> series,
        string title,
        string accessibleSummary)
    {
        container.Title = title;
        container.AccessibleSummary = accessibleSummary;
        if (hasData)
        {
            chart.Series = series;
            container.State = ChartState.Ready;
        }
        else
        {
            chart.Series = System.Array.Empty<ChartSeries>();
            container.State = ChartState.Empty;
        }
    }

    private TsGlassPanel BuildStatusCard(FleetCompareStatusCard card)
    {
        if (!card.HasVehicle)
        {
            return new TsGlassPanel
            {
                Padding = new Thickness(20),
                Content = new TsEmptyState
                {
                    IconGlyph = CarGlyph,
                    Message = card.EmptyMessage,
                    HorizontalAlignment = HorizontalAlignment.Center,
                },
            };
        }

        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(BuildStatusHeader(card));

        var rows = new StackPanel { Spacing = 10 };
        rows.Children.Add(BuildBatteryRow(card));
        rows.Children.Add(MetricRow(RangeGlyph, _localizer.GetString("comparison.range", "Range"), card.RangeText));
        rows.Children.Add(MetricRow(TempGlyph, _localizer.GetString("comparison.temp", "Temperature"), card.TemperatureText));
        rows.Children.Add(BuildSecurityRow(card));
        rows.Children.Add(BuildStatusRow(card));
        stack.Children.Add(rows);

        var panel = new TsGlassPanel { Padding = new Thickness(20), Content = stack };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    private static StackPanel BuildStatusHeader(FleetCompareStatusCard card)
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };

        var iconChip = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(12),
            Background = DisplayTokens.Surface,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = CarGlyph,
                FontSize = 18,
                Foreground = card.IsOnline
                    ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success))
                    : DisplayTokens.TextMuted,
            },
        };
        header.Children.Add(iconChip);

        var titles = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new TextBlock
        {
            Text = card.Name,
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        if (!string.IsNullOrEmpty(card.SubLabel))
        {
            titles.Children.Add(new Caption { Value = card.SubLabel });
        }

        header.Children.Add(titles);
        return header;
    }

    private StackPanel BuildBatteryRow(FleetCompareStatusCard card)
    {
        var stack = new StackPanel { Spacing = 6 };
        stack.Children.Add(MetricRow(BatteryGlyph, _localizer.GetString("comparison.battery", "Battery"), card.BatteryText));

        if (card.HasBattery)
        {
            stack.Children.Add(BuildBar(card.BatteryFraction, card.BatteryTier));
        }

        return stack;
    }

    private static Grid BuildBar(double fraction, StatusKind tier)
    {
        double clamped = System.Math.Clamp(fraction, 0, 1);
        var track = new Grid { Height = 8 };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(System.Math.Max(0, clamped), GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(System.Math.Max(0, 1 - clamped), GridUnitType.Star) });

        var background = new Border
        {
            Background = DisplayTokens.Brush("TsColorBorderBrush"),
            CornerRadius = new CornerRadius(4),
            Opacity = 0.6,
        };
        Grid.SetColumnSpan(background, 2);
        track.Children.Add(background);

        var fill = new Border
        {
            Background = DisplayTokens.Brush(StatusResources.AccentBrushKey(tier)),
            CornerRadius = new CornerRadius(4),
        };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);
        return track;
    }

    private Grid BuildSecurityRow(FleetCompareStatusCard card)
    {
        var grid = LabeledRow(SecurityGlyph, _localizer.GetString("comparison.security", "Security"), out var valueHost);

        var values = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        values.Children.Add(Body(
            card.SecurityText,
            card.HasState ? DisplayTokens.Brush(StatusResources.AccentBrushKey(card.SecurityTier)) : DisplayTokens.TextMuted,
            FontWeights.Normal));

        if (card.SentryOn)
        {
            var sentry = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            sentry.Children.Add(new FontIcon { Glyph = SentryGlyph, FontSize = 12, Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info)), VerticalAlignment = VerticalAlignment.Center });
            sentry.Children.Add(new Caption { Value = _localizer.GetString("comparison.sentry", "Sentry") });
            values.Children.Add(sentry);
        }

        valueHost.Child = values;
        return grid;
    }

    private Grid BuildStatusRow(FleetCompareStatusCard card)
    {
        var grid = LabeledRow(StatusGlyph, _localizer.GetString("comparison.status", "Status"), out var valueHost);

        var pill = new Border
        {
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(8, 2, 8, 2),
            HorizontalAlignment = HorizontalAlignment.Right,
            Background = DisplayTokens.Surface,
            Child = Body(
                card.StatusText,
                card.IsOnline ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)) : DisplayTokens.TextMuted,
                FontWeights.Medium,
                size: 12),
        };

        valueHost.Child = pill;
        return grid;
    }

    private static Grid MetricRow(string glyph, string label, string value)
    {
        var grid = LabeledRow(glyph, label, out var valueHost);
        valueHost.Child = Body(value, DisplayTokens.TextPrimary, FontWeights.Normal, HorizontalAlignment.Right);
        return grid;
    }

    private static Grid LabeledRow(string glyph, string label, out Border valueHost)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelStack = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        labelStack.Children.Add(new FontIcon { Glyph = glyph, FontSize = 14, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        labelStack.Children.Add(Body(label, DisplayTokens.TextSecondary, FontWeights.Normal));

        valueHost = new Border { VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(labelStack, 0);
        Grid.SetColumn(valueHost, 1);
        grid.Children.Add(labelStack);
        grid.Children.Add(valueHost);
        return grid;
    }

    private static TextBlock Body(
        string text,
        Brush foreground,
        Windows.UI.Text.FontWeight weight,
        HorizontalAlignment align = HorizontalAlignment.Left,
        double size = 14) => new()
        {
            Text = text,
            FontSize = size,
            FontWeight = weight,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = align,
            TextWrapping = TextWrapping.Wrap,
        };

    private void BuildTable(FleetCompareDisplay display)
    {
        _tableHost.Children.Clear();
        _tableHost.Children.Add(BuildTableRow(
            _localizer.GetString("comparison.metric", "Metric"),
            display.NameA,
            display.NameB,
            isHeader: true,
            winnerA: false,
            winnerB: false));

        foreach (var row in display.Rows)
        {
            _tableHost.Children.Add(BuildTableRow(row.Metric, row.ValueA, row.ValueB, isHeader: false, row.IsWinnerA, row.IsWinnerB));
        }
    }

    private static Grid BuildTableRow(string metric, string valueA, string valueB, bool isHeader, bool winnerA, bool winnerB)
    {
        var grid = new Grid { Padding = new Thickness(0, 8, 0, 8) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var metricCell = Body(
            metric,
            isHeader ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary,
            isHeader ? FontWeights.SemiBold : FontWeights.Normal);
        Grid.SetColumn(metricCell, 0);
        grid.Children.Add(metricCell);

        var cellA = BuildValueCell(valueA, isHeader, winnerA);
        var cellB = BuildValueCell(valueB, isHeader, winnerB);
        Grid.SetColumn(cellA, 1);
        Grid.SetColumn(cellB, 2);
        grid.Children.Add(cellA);
        grid.Children.Add(cellB);

        if (!isHeader)
        {
            grid.BorderThickness = new Thickness(0, 0, 0, 1);
            grid.BorderBrush = DisplayTokens.Border;
        }

        return grid;
    }

    private static TextBlock BuildValueCell(string value, bool isHeader, bool isWinner)
    {
        if (isHeader)
        {
            return Body(value, DisplayTokens.TextMuted, FontWeights.SemiBold);
        }

        Brush brush = isWinner
            ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success))
            : DisplayTokens.TextPrimary;
        return Body(isWinner ? value + WinnerMark : value, brush, isWinner ? FontWeights.SemiBold : FontWeights.Normal);
    }

    private void BuildHighlights(IReadOnlyList<FleetCompareHighlight> highlights)
    {
        _highlightsHost.Children.Clear();
        _highlightsHost.RowDefinitions.Clear();
        _highlightsHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        for (int i = 0; i < highlights.Count; i++)
        {
            var highlight = highlights[i];
            string value = string.IsNullOrEmpty(highlight.Unit)
                ? highlight.Value
                : string.Format(CultureInfo.CurrentCulture, "{0} {1}", highlight.Value, highlight.Unit);

            var card = new TsStatCard
            {
                Label = highlight.Label,
                Value = value,
                Glyph = highlight.Glyph,
            };
            AutomationProperties.SetName(card, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", highlight.Label, value));
            Grid.SetColumn(card, i % 4);
            _highlightsHost.Children.Add(card);
        }
    }

    private void RaiseNavigation(string route) => NavigationRequested?.Invoke(this, route);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
    }
}
