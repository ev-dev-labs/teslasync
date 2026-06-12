using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>ChargingDetailPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/ChargingDetailPage.tsx</c> (route <c>/charging/:id</c>, nav name
/// <c>ChargeDetail</c>). It binds to a <see cref="ChargingDetailPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + freshness chip), the loading shimmer, the
/// retriable error surface, the page-level empty surface, and — in the success state — the in-content header
/// chips, the five hero gauges, the battery-progress meter, the eight stat cards, the more-details panel, the
/// location panel, the charge-curve area chart, the three time-axis composed charts (SoC/energy/range,
/// temperature, voltage/current), the advanced live-parameters panel and the timestamps footer. The view is a
/// thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="ChargingDetailDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ChargingDetailPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const string ChevronLeftGlyph = "\uE76B";
    private const string MapPinGlyph = "\uE707";
    private const string ActivityGlyph = "\uE9D2";

    private readonly ChargingDetailPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = ChargingDetailPageRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer (no session bound).</summary>
    public ChargingDetailPage()
        : this(0)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied session id.</summary>
    /// <param name="sessionId">The charging session id from the <c>/charging/:id</c> route param.</param>
    public ChargingDetailPage(long sessionId)
        : this(EmptyChargingDetailPageFeed.Instance, ShellLocalizer.Instance, sessionId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and session id (used by tests / dependency injection).</summary>
    /// <param name="feed">The four-source charging data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="sessionId">The charging session id from the route.</param>
    public ChargingDetailPage(IChargingDetailPageFeed feed, ILocalizer localizer, long sessionId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ChargingDetailPageViewModel(feed, localizer, sessionId);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the in-content back affordance is invoked (web back link to <c>/charging</c>).</summary>
    public event EventHandler? BackRequested;

    /// <summary>The diagnostics surface slug (<c>ChargingDetailPage</c>).</summary>
    public static string Slug => ChargingDetailPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ChargingDetailPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_contentHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _title.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_title, 0);
        grid.Children.Add(_title);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 36 });
        _loadingSkeleton.Children.Add(UniformGrid(5, 16, BuildSkeletonBlocks(5, 150)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 96 });
        _loadingSkeleton.Children.Add(UniformGrid(4, 16, BuildSkeletonBlocks(8, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 256 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 288 });
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Render(ChargingDetailDisplay display)
    {
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private StackPanel BuildContent(ChargingDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHeaderChips(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildGauges(display.Gauges) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildBatteryProgress(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildStatCards(display.StatCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildMoreDetails(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 220, Content = BuildLocation(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildChartPanel(display.ChargeCurve, composed: false, height: 280) });
        stack.Children.Add(new TsFadeIn { DelayMs = 280, Content = BuildChartPanel(display.SocOverTime, composed: true, height: 320) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildChartPanel(display.Temperature, composed: true, height: 240) });
        stack.Children.Add(new TsFadeIn { DelayMs = 320, Content = BuildChartPanel(display.VoltageCurrent, composed: true, height: 240) });
        stack.Children.Add(new TsFadeIn { DelayMs = 350, Content = BuildAdvanced(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 380, Content = BuildTimestamps(display) });
        return stack;
    }

    // ── In-content header chips (date + vehicle + AC/DC / state / charger / location badges) ───────────────
    private StackPanel BuildHeaderChips(ChargingDetailDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };

        var back = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = ChevronLeftGlyph, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(back, display.Title);
        back.Click += (_, _) => BackRequested?.Invoke(this, EventArgs.Empty);
        row.Children.Add(back);

        row.Children.Add(new Heading { Value = display.HeaderDate, VerticalAlignment = VerticalAlignment.Center });

        if (!string.IsNullOrEmpty(display.VehicleName))
        {
            row.Children.Add(new Caption { Value = display.VehicleName, VerticalAlignment = VerticalAlignment.Center });
        }

        row.Children.Add(Chip(display.AcDcBadge));
        if (display.StateBadge is { } state)
        {
            row.Children.Add(Chip(state));
        }

        if (display.ChargerTypeBadge is { } charger)
        {
            row.Children.Add(Chip(charger));
        }

        if (display.LocationBadge is { } location)
        {
            row.Children.Add(Chip(location, MapPinGlyph));
        }

        return row;
    }

    // ── Hero gauges (5) ────────────────────────────────────────────────────────────────────────────────────
    private static Grid BuildGauges(IReadOnlyList<ChargingGaugeDisplay> gauges)
    {
        var cells = new List<FrameworkElement>(gauges.Count);
        foreach (var g in gauges)
        {
            var gauge = new TsRadialGauge
            {
                Value = g.Value,
                Max = g.Max,
                Label = g.Label,
                Unit = g.Unit,
                Diameter = 140,
            };
            if (g.Role != ChartRole.None)
            {
                gauge.Role = g.Role;
            }
            else
            {
                gauge.ColorIndex = g.ColorIndex;
            }

            var panel = new TsGlassPanel
            {
                Padding = new Thickness(PanelPadding),
                Content = new Grid { HorizontalAlignment = HorizontalAlignment.Center, Children = { gauge } },
            };
            AutomationProperties.SetName(panel, $"{g.Label}: {g.Value}");
            cells.Add(panel);
        }

        return UniformGrid(5, 16, cells);
    }

    // ── Battery progress meter ─────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildBatteryProgress(ChargingDetailDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = display.BatteryProgressTitle });
        column.Children.Add(Bar(display.StartSocBar));
        column.Children.Add(Bar(display.EndSocBar));

        var summary = new List<FrameworkElement>
        {
            CenteredStat(display.SocGainedLabel, display.SocGainedValue),
            CenteredStat(display.RangeGainedLabel, display.RangeGainedValue),
            CenteredStat(display.EnergyAddedLabel, display.EnergyAddedValue),
        };
        column.Children.Add(UniformGrid(3, 16, summary));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.BatteryProgressTitle);
        return panel;
    }

    // ── Eight stat cards ───────────────────────────────────────────────────────────────────────────────────
    private static Grid BuildStatCards(IReadOnlyList<ChargingStatCardDisplay> cards)
    {
        var cells = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var control = new TsStatCard
            {
                Label = card.Label,
                Value = card.Value,
                Glyph = card.Glyph,
            };
            if (!string.IsNullOrEmpty(card.Sublabel))
            {
                control.Sublabel = card.Sublabel;
            }

            AutomationProperties.SetName(control, $"{card.Label}: {card.Value}");
            cells.Add(control);
        }

        return UniformGrid(4, 16, cells);
    }

    // ── More details (inline metrics + KV list) ────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildMoreDetails(ChargingDetailDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = display.MoreDetailsTitle });

        var inline = new List<FrameworkElement>(display.MoreDetailsInline.Count);
        foreach (var metric in display.MoreDetailsInline)
        {
            var control = new TsInlineMetric { Label = metric.Label, Value = metric.Value };
            AutomationProperties.SetName(control, $"{metric.Label}: {metric.Value}");
            inline.Add(control);
        }

        column.Children.Add(UniformGrid(4, 12, inline));
        column.Children.Add(new TsKVList { Items = ToKeyValues(display.MoreDetailsRows) });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.MoreDetailsTitle);
        return panel;
    }

    // ── Location ───────────────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLocation(ChargingDetailDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.LocationTitle });
        if (display.HasLocation)
        {
            column.Children.Add(new Text { Value = display.LocationText });
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = MapPinGlyph, Message = display.EmptyMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.LocationTitle);
        return panel;
    }

    // ── Chart panels (charge curve + three time-axis charts) ───────────────────────────────────────────────
    private static TsGlassPanel BuildChartPanel(ChargingChartDisplay chart, bool composed, double height)
    {
        var column = new StackPanel { Spacing = 12 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new SectionTitle { Value = chart.Title });
        if (!string.IsNullOrEmpty(chart.EstimatedNote))
        {
            titleRow.Children.Add(new Caption { Value = $"({chart.EstimatedNote})", VerticalAlignment = VerticalAlignment.Center });
        }

        column.Children.Add(titleRow);

        if (chart.HasData)
        {
            TsCartesianChart control = composed ? new TsComposedChart() : new TsAreaChart();
            control.Series = chart.Series;
            control.Title = chart.Title;
            control.Height = height;
            control.IncludeZero = true;
            AutomationProperties.SetName(control, chart.AccessibleSummary);
            column.Children.Add(control);
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ActivityGlyph, Message = chart.EmptyMessage });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, chart.AccessibleSummary);
        return panel;
    }

    // ── Advanced live parameters ───────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildAdvanced(ChargingDetailDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new SectionTitle { Value = display.AdvancedTitle });
        column.Children.Add(new Caption { Value = display.AdvancedHint });

        if (display.HasLive)
        {
            column.Children.Add(new TsKVList { Items = ToKeyValues(display.AdvancedRows), Margin = new Thickness(0, 8, 0, 0) });
        }
        else
        {
            column.Children.Add(new Text { Value = display.NoLiveDataText, Margin = new Thickness(0, 8, 0, 0) });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.AdvancedTitle);
        return panel;
    }

    // ── Timestamps footer ──────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTimestamps(ChargingDetailDisplay display)
    {
        var started = new StackPanel { Spacing = 4 };
        started.Children.Add(new Caption { Value = display.StartedLabel });
        started.Children.Add(new Text { Value = display.StartedValue });

        var ended = new StackPanel { Spacing = 4 };
        ended.Children.Add(new Caption { Value = display.EndedLabel });
        ended.Children.Add(new Text { Value = display.EndedValue });

        var grid = UniformGrid(2, 24, new List<FrameworkElement> { started, ended });
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
        AutomationProperties.SetName(panel, $"{display.StartedLabel}, {display.EndedLabel}");
        return panel;
    }

    // ── Shared primitives ──────────────────────────────────────────────────────────────────────────────────
    private static TsBadge Chip(ChargingBadgeDisplay badge, string? glyph = null)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        if (!string.IsNullOrEmpty(glyph))
        {
            content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12 });
        }

        content.Children.Add(new TextBlock { Text = badge.Text, FontSize = 12 });

        var chip = new TsBadge { Status = badge.Status, Dot = badge.Dot, Content = content, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(chip, badge.Text);
        return chip;
    }

    private static TsMetricBar Bar(ChargingBarDisplay bar)
    {
        var control = new TsMetricBar
        {
            Label = bar.Label,
            Value = bar.Value,
            Max = bar.Max,
            ValueText = bar.ValueText,
            AccentBrushKey = bar.AccentBrushKey,
        };
        AutomationProperties.SetName(control, $"{bar.Label}: {bar.ValueText}");
        return control;
    }

    private static StackPanel CenteredStat(string label, string value)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new Caption { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new MetricValue { Value = value, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(column, $"{label}: {value}");
        return column;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<ChargingKvRow> rows)
    {
        var list = new List<TsKeyValue>(rows.Count);
        foreach (var row in rows)
        {
            list.Add(new TsKeyValue(row.Key, row.Value));
        }

        return list;
    }

    private static Grid UniformGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = children.Count == 0 ? 0 : ((children.Count + columns - 1) / columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var element = children[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ChargingDetailPageAutomationPeer(this);

    private sealed class ChargingDetailPageAutomationPeer(ChargingDetailPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(ChargingDetailPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
