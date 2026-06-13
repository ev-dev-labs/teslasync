using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>GasPriceAutoPollPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/GasPriceAutoPollPage.tsx</c> (route <c>/gas-price</c>, nav name
/// <c>GasPriceAutoPoll</c>), which wraps the shared <c>GasPriceSettings</c> surface in a
/// <c>PageContainer</c> (title / subtitle). It binds to a <see cref="GasPriceAutoPollPageViewModel"/> and
/// renders every web region with Fluent components and design tokens: the page header, the failure banner
/// (web query <c>onError</c> as an InfoBar + Retry), the action notice (the web success toasts), and the
/// glass panel reproducing the web card — its fuel-chip header, the auto-poll toggle (Play/Pause + Running/
/// Stopped), the poll-interval select (Daily / Weekly / Bi-weekly / Monthly), the Current Price and Last
/// Polled metric tiles (whose values shimmer while the status loads) and the Poll Now action with the EIA
/// source note. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="GasPriceDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class GasPriceAutoPollPage : UserControl, IDisposable
{
    private const string FuelGlyph = "\uE950";   // Segoe Fluent — Gauge (web lucide Fuel)
    private const string PlayGlyph = "\uE768";   // Segoe Fluent — Play (web lucide Play, running)
    private const string PauseGlyph = "\uE769";  // Segoe Fluent — Pause (web lucide Pause, stopped)
    private const string ZapGlyph = "\uE945";    // Segoe Fluent — LightningBolt (web lucide Zap, Poll Now)

    private readonly GasPriceAutoPollPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsAlertBanner _noticeBanner = new() { Variant = CalloutVariant.Success, IsOpen = false, Dismissible = true };

    private readonly FontIcon _headerIcon = new() { Glyph = FuelGlyph, FontSize = 18 };
    private readonly PanelTitle _cardTitle = new();
    private readonly Caption _cardSubtitle = new();

    private readonly Label _autoPollLabel = new();
    private readonly TsButton _toggleButton = new() { Variant = ButtonVariant.Outline, HorizontalAlignment = HorizontalAlignment.Stretch };

    private readonly Label _intervalLabel = new();
    private readonly TsSelect _intervalSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };

    private readonly Label _priceLabel = new();
    private readonly MetricValue _priceValue = new();
    private readonly TsSkeleton _priceSkeleton = new() { BlockWidth = 96, BlockHeight = 24 };

    private readonly Label _lastPolledLabel = new();
    private readonly Text _lastPolledValue = new();
    private readonly TsSkeleton _lastPolledSkeleton = new() { BlockWidth = 140, BlockHeight = 20 };

    private readonly TsButton _pollButton = new() { Variant = ButtonVariant.Primary, IconGlyph = ZapGlyph };
    private readonly Caption _sourceText = new();

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public GasPriceAutoPollPage()
        : this(EmptyGasPriceFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The gas-price status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public GasPriceAutoPollPage(IGasPriceFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new GasPriceAutoPollPageViewModel(feed, localizer);

        Content = BuildLayout();

        _toggleButton.Click += OnToggleClick;
        _intervalSelect.SelectionChanged += OnIntervalChanged;
        _pollButton.Click += OnPollClick;
        _errorBanner.ActionInvoked += OnRetry;
        _noticeBanner.Dismissed += OnNoticeDismissed;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        SeedStaticOptions();
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>GasPriceAutoPollPage</c>).</summary>
    public static string Slug => GasPriceAutoPollRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(_errorBanner);
        stack.Children.Add(_noticeBanner);
        stack.Children.Add(BuildCard());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildCard()
    {
        var body = new StackPanel { Spacing = 20 };
        body.Children.Add(BuildCardHeader());
        body.Children.Add(BuildControlsRow());
        body.Children.Add(BuildMetricsRow());
        body.Children.Add(BuildActionRow());

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
    }

    private StackPanel BuildCardHeader()
    {
        var iconChip = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(12),
            Background = Brush("TsColorSurfaceBrush"),
            BorderBrush = Brush("TsColorWarningBrush"),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
        };
        _headerIcon.Foreground = Brush("TsColorWarningBrush");
        _headerIcon.HorizontalAlignment = HorizontalAlignment.Center;
        _headerIcon.VerticalAlignment = VerticalAlignment.Center;
        iconChip.Child = _headerIcon;
        AutomationProperties.SetAccessibilityView(_headerIcon, AccessibilityView.Raw);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_cardTitle);
        text.Children.Add(_cardSubtitle);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(iconChip);
        row.Children.Add(text);
        return row;
    }

    private Grid BuildControlsRow()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var autoPoll = new StackPanel { Spacing = 6 };
        autoPoll.Children.Add(_autoPollLabel);
        autoPoll.Children.Add(_toggleButton);
        Grid.SetColumn(autoPoll, 0);

        var interval = new StackPanel { Spacing = 6 };
        interval.Children.Add(_intervalLabel);
        interval.Children.Add(_intervalSelect);
        Grid.SetColumn(interval, 1);

        grid.Children.Add(autoPoll);
        grid.Children.Add(interval);
        return grid;
    }

    private Grid BuildMetricsRow()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var price = BuildMetricTile(_priceLabel, _priceValue, _priceSkeleton);
        Grid.SetColumn(price, 0);

        var lastPolled = BuildMetricTile(_lastPolledLabel, _lastPolledValue, _lastPolledSkeleton);
        Grid.SetColumn(lastPolled, 1);

        grid.Children.Add(price);
        grid.Children.Add(lastPolled);
        return grid;
    }

    private static Border BuildMetricTile(Label label, UIElement value, TsSkeleton skeleton)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(label);
        column.Children.Add(value);
        column.Children.Add(skeleton);

        return new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = Brush("TsColorSurfaceBrush"),
            BorderBrush = Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(14),
            Child = column,
        };
    }

    private StackPanel BuildActionRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _sourceText.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_pollButton);
        row.Children.Add(_sourceText);
        return row;
    }

    private void SeedStaticOptions()
    {
        _suppressEvents = true;
        _intervalSelect.ItemsSource = _viewModel.Display.IntervalOptions;
        _intervalSelect.DisplayMemberPath = nameof(GasPriceIntervalOption.Label);
        _intervalSelect.SelectedValuePath = nameof(GasPriceIntervalOption.Value);
        _intervalSelect.SelectedValue = _viewModel.Display.SelectedInterval;
        _suppressEvents = false;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the feature-view convention).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
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

    private void Render(GasPriceDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        _errorBanner.Message = display.ErrorBannerText;
        _errorBanner.ActionText = display.RetryLabel;
        _errorBanner.IsOpen = display.HasError;

        _noticeBanner.Message = display.NoticeText;
        _noticeBanner.IsOpen = display.HasNotice;

        _cardTitle.Value = display.Title;
        _cardSubtitle.Value = display.Subtitle;

        _autoPollLabel.Value = display.AutoPollLabel;
        _toggleButton.IconGlyph = display.IsEnabled ? PlayGlyph : PauseGlyph;
        _toggleButton.Text = display.ToggleStateLabel;
        AutomationProperties.SetName(_toggleButton, $"{display.AutoPollLabel}: {display.ToggleStateLabel}");

        _intervalLabel.Value = display.PollIntervalLabel;
        _intervalSelect.SelectedValue = display.SelectedInterval;
        AutomationProperties.SetName(_intervalSelect, display.PollIntervalLabel);

        _priceLabel.Value = display.CurrentPriceLabel;
        _priceValue.Value = display.CurrentPriceValue;
        _priceValue.Visibility = Show(!display.ShowLoading);
        _priceSkeleton.Visibility = Show(display.ShowLoading);
        AutomationProperties.SetName(_priceValue, $"{display.CurrentPriceLabel}: {display.CurrentPriceValue}");

        _lastPolledLabel.Value = display.LastPolledLabel;
        _lastPolledValue.Value = display.LastPolledValue;
        _lastPolledValue.Visibility = Show(!display.ShowLoading);
        _lastPolledSkeleton.Visibility = Show(display.ShowLoading);
        AutomationProperties.SetName(_lastPolledValue, $"{display.LastPolledLabel}: {display.LastPolledValue}");

        _pollButton.Text = display.PollNowLabel;
        _pollButton.IsLoading = display.IsPolling;
        _sourceText.Value = display.SourceText;

        _suppressEvents = false;
    }

    private void OnToggleClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        InvokeAsync(() => _viewModel.ToggleAsync());
    }

    private void OnIntervalChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_intervalSelect.SelectedValue is string interval)
        {
            InvokeAsync(() => _viewModel.SetIntervalAsync(interval));
        }
    }

    private void OnPollClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        InvokeAsync(() => _viewModel.PollNowAsync());
    }

    private void OnRetry(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnNoticeDismissed(object? sender, EventArgs e) => _noticeBanner.IsOpen = false;

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
