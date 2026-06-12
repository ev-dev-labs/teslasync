using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.ApplicationModel.DataTransfer;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>ApiLogsPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/ApiLogsPage.tsx</c> (route <c>/api-logs</c>, nav name <c>ApiLogs</c>). It binds
/// to an <see cref="ApiLogsPageViewModel"/> and renders every web region with Fluent components and design tokens:
/// the page header, the failure banner (web <c>anyError</c>), the four stat tiles (Total Calls / Error Rate /
/// Avg Duration / Last 24h), the by-service chip row, the filters card (service / method / status / endpoint), and
/// the log table whose body switches between the loading spinner, the empty state and the expandable log rows —
/// each row's expanded detail carrying the request-URL, error and request/response-body JSON viewers — plus the
/// pagination footer. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="ApiLogsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ApiLogsPage : UserControl, IDisposable
{
    private readonly ApiLogsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsStatCard _totalCallsCard = new();
    private readonly TsStatCard _errorRateCard = new();
    private readonly TsStatCard _avgDurationCard = new();
    private readonly TsStatCard _last24hCard = new();

    private readonly Caption _byServiceLabel = new();
    private readonly StackPanel _byServiceChips = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly StackPanel _byServiceRow;

    private readonly Caption _filtersLabel = new();
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE711" };
    private readonly TsSelect _serviceSelect = new();
    private readonly Caption _serviceCount = new();
    private readonly TsSelect _methodSelect = new();
    private readonly TsSelect _statusSelect = new();
    private readonly TsInput _endpointInput = new();

    private readonly Text _summaryText = new();
    private readonly TsButton _exportButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uEDE1" };

    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE9D9" };
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };

    private readonly StackPanel _paginationPanel;
    private readonly TsButton _previousButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uE76B" };
    private readonly TsButton _nextButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uE76C" };
    private readonly Caption _pageOfText = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _suppressEvents;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public ApiLogsPage()
        : this(EmptyApiLogsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The page-of-logs data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ApiLogsPage(IApiLogsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ApiLogsPageViewModel(feed, localizer);

        _byServiceRow = BuildByServiceRow();
        _loadingPanel = BuildLoadingPanel();
        _paginationPanel = BuildPaginationPanel();

        Content = BuildLayout();

        _clearButton.Click += OnClearClick;
        _exportButton.Click += OnExportClick;
        _previousButton.Click += OnPreviousClick;
        _nextButton.Click += OnNextClick;
        _serviceSelect.SelectionChanged += OnServiceChanged;
        _methodSelect.SelectionChanged += OnMethodChanged;
        _statusSelect.SelectionChanged += OnStatusChanged;
        _endpointInput.KeyDown += OnEndpointKeyDown;
        _endpointInput.LostFocus += OnEndpointCommitted;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        SeedStaticOptions();
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ApiLogsPage</c>).</summary>
    public static string Slug => ApiLogsRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(_errorBanner);

        stack.Children.Add(BuildStatsGrid());
        stack.Children.Add(_byServiceRow);
        stack.Children.Add(BuildFiltersPanel());
        stack.Children.Add(BuildTablePanel());

        var scroller = new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        return scroller;
    }

    private Grid BuildStatsGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var cards = new[] { _totalCallsCard, _errorRateCard, _avgDurationCard, _last24hCard };
        for (int i = 0; i < cards.Length; i++)
        {
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private StackPanel BuildByServiceRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_byServiceLabel);
        row.Children.Add(_byServiceChips);
        return row;
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(new FontIcon { Glyph = "\uE71C", FontSize = 14, Foreground = Brush("TsColorTextMutedBrush") });
        header.Children.Add(_filtersLabel);
        header.Children.Add(_clearButton);

        var serviceColumn = new StackPanel { Spacing = 4 };
        serviceColumn.Children.Add(_serviceSelect);
        serviceColumn.Children.Add(_serviceCount);

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });

        _serviceSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _methodSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _statusSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _endpointInput.HorizontalAlignment = HorizontalAlignment.Stretch;

        Grid.SetColumn(serviceColumn, 0);
        Grid.SetColumn(_methodSelect, 1);
        Grid.SetColumn(_statusSelect, 2);
        Grid.SetColumn(_endpointInput, 3);
        grid.Children.Add(serviceColumn);
        grid.Children.Add(_methodSelect);
        grid.Children.Add(_statusSelect);
        grid.Children.Add(_endpointInput);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(header);
        body.Children.Add(grid);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(16), Child = body } };
    }

    private TsGlassPanel BuildTablePanel()
    {
        var headerGrid = new Grid { Padding = new Thickness(16, 12, 16, 12) };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _summaryText.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_summaryText, 0);
        Grid.SetColumn(_exportButton, 1);
        headerGrid.Children.Add(_summaryText);
        headerGrid.Children.Add(_exportButton);

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(headerGrid);
        body.Children.Add(_loadingPanel);
        body.Children.Add(_emptyState);
        body.Children.Add(_rowsPanel);
        body.Children.Add(_paginationPanel);

        return new TsGlassPanel { Content = body };
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        panel.Children.Add(_loadingText);
        return panel;
    }

    private StackPanel BuildPaginationPanel()
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            Padding = new Thickness(16, 12, 16, 12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        panel.Children.Add(_previousButton);
        panel.Children.Add(_pageOfText);
        panel.Children.Add(_nextButton);
        return panel;
    }

    private void SeedStaticOptions()
    {
        var display = _viewModel.Display;
        _suppressEvents = true;

        _methodSelect.ItemsSource = display.MethodOptions;
        _methodSelect.DisplayMemberPath = nameof(ApiLogsSelectOption.Label);
        _methodSelect.SelectedValuePath = nameof(ApiLogsSelectOption.Value);
        _methodSelect.SelectedValue = display.SelectedMethod;

        _statusSelect.ItemsSource = display.StatusOptions;
        _statusSelect.DisplayMemberPath = nameof(ApiLogsSelectOption.Label);
        _statusSelect.SelectedValuePath = nameof(ApiLogsSelectOption.Value);
        _statusSelect.SelectedValue = display.SelectedStatus;

        _serviceSelect.DisplayMemberPath = nameof(ApiLogsSelectOption.Label);
        _serviceSelect.SelectedValuePath = nameof(ApiLogsSelectOption.Value);

        _endpointInput.Hint = display.EndpointHint;
        AutomationProperties.SetName(_serviceSelect, display.ServiceFilterAria);

        _suppressEvents = false;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the dashboard-widget views).</summary>
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

    private void Render(ApiLogsDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _errorBanner.IsOpen = display.HasError;
        _errorBanner.Message = display.ErrorBannerText;

        ApplyStatCard(_totalCallsCard, display.StatCards[0]);
        ApplyStatCard(_errorRateCard, display.StatCards[1]);
        ApplyStatCard(_avgDurationCard, display.StatCards[2]);
        ApplyStatCard(_last24hCard, display.StatCards[3]);

        _byServiceRow.Visibility = Show(display.HasByService);
        _byServiceLabel.Value = $"{display.ByServiceLabel}:";
        RebuildChips(display.ServiceChips);

        _filtersLabel.Value = display.FiltersLabel;
        _clearButton.Text = display.ClearLabel;
        _clearButton.Visibility = Show(display.HasFilters);

        _serviceSelect.ItemsSource = display.ServiceOptions;
        _serviceSelect.SelectedValue = display.SelectedService;
        _serviceCount.Value = display.ServiceCountText;
        _serviceCount.Visibility = Show(display.ShowServiceCount);
        _methodSelect.SelectedValue = display.SelectedMethod;
        _statusSelect.SelectedValue = display.SelectedStatus;

        if (_endpointInput.FocusState == FocusState.Unfocused && _endpointInput.Text != display.EndpointValue)
        {
            _endpointInput.Text = display.EndpointValue;
        }

        _summaryText.Value = display.TableSummaryText;
        _exportButton.Text = display.ExportLabel;
        _exportButton.IsEnabled = display.CanExport;

        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyText;
        _emptyState.Message = display.ShowEmptyHint ? display.EmptyHintText : string.Empty;

        _rowsPanel.Visibility = Show(display.ShowRows);
        RebuildRows(display);

        _paginationPanel.Visibility = Show(display.ShowPagination);
        _previousButton.Text = display.PreviousLabel;
        _nextButton.Text = display.NextLabel;
        _pageOfText.Value = display.PageOfText;
        _previousButton.IsEnabled = display.CanGoPrevious;
        _nextButton.IsEnabled = display.CanGoNext;

        _suppressEvents = false;
    }

    private static void ApplyStatCard(TsStatCard card, ApiLogStatCardDisplay model)
    {
        card.Label = model.Label;
        card.Value = model.Value;
        card.Glyph = model.Glyph;
        card.Sublabel = model.Sublabel ?? string.Empty;
        AutomationProperties.SetName(card, model.AutomationName);
    }

    private void RebuildChips(IReadOnlyList<ApiLogServiceChipDisplay> chips)
    {
        _byServiceChips.Children.Clear();
        foreach (var chip in chips)
        {
            var badge = new TsBadge { Status = chip.Variant, Content = chip.Label };
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            content.Children.Add(badge);
            content.Children.Add(new Caption { Value = chip.CountText });

            var button = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Content = content };
            AutomationProperties.SetName(button, $"{chip.Label}: {chip.CountText}");
            string service = chip.Service;
            button.Click += (_, _) => InvokeAsync(() => _viewModel.SetServiceAsync(service));
            _byServiceChips.Children.Add(button);
        }
    }

    private void RebuildRows(ApiLogsDisplay display)
    {
        _rowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        var labels = _viewModel.DetailLabels;
        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row, labels));
        }
    }

    private static Expander BuildRow(ApiLogRowDisplay row, ApiLogDetailLabels labels)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(new TextBlock
        {
            Text = row.Timestamp,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Width = 168,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        header.Children.Add(new TsBadge { Status = row.ServiceVariant, Content = row.ServiceLabel });
        header.Children.Add(new TsBadge { Status = row.MethodVariant, Content = row.Method });
        header.Children.Add(new TextBlock
        {
            Text = row.Endpoint,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Width = 280,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        header.Children.Add(new TsBadge { Status = row.StatusVariant, Content = row.StatusText });
        header.Children.Add(new TextBlock
        {
            Text = row.DurationText,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (row.HasError)
        {
            header.Children.Add(new TextBlock
            {
                Text = row.ErrorSummary,
                FontSize = 12,
                Foreground = Brush("TsColorDangerBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var detail = new StackPanel { Spacing = 12, Padding = new Thickness(0, 8, 0, 8) };
        detail.Children.Add(BuildDetailBlock(labels.RequestUrl, row.RequestUrlText, isError: false));
        if (row.HasError)
        {
            detail.Children.Add(BuildDetailBlock(labels.Error, row.ErrorBody, isError: true));
        }

        detail.Children.Add(BuildJsonBlock(row.RequestBody));
        detail.Children.Add(BuildJsonBlock(row.ResponseBody));

        var expander = new Expander
        {
            Header = header,
            Content = detail,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            IsExpanded = row.IsExpanded,
            Margin = new Thickness(12, 4, 12, 4),
        };
        AutomationProperties.SetName(expander, row.AutomationName);
        return expander;
    }

    private static StackPanel BuildDetailBlock(string label, string body, bool isError)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Label { Value = label });
        var code = new TextBlock
        {
            Text = body,
            FontFamily = MonoFont,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            Foreground = Brush(isError ? "TsColorDangerBrush" : "TsColorTextPrimaryBrush"),
        };
        column.Children.Add(new TsGlassPanel { Content = new Border { Padding = new Thickness(12), Child = code } });
        return column;
    }

    private static StackPanel BuildJsonBlock(ApiLogJsonDisplay json)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Label { Value = json.Label });

        UIElement body;
        if (json.HasData)
        {
            body = new TextBlock
            {
                Text = json.Body,
                FontFamily = MonoFont,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                Foreground = Brush("TsColorTextPrimaryBrush"),
            };
        }
        else
        {
            body = new TextBlock
            {
                Text = json.Body,
                FontStyle = Windows.UI.Text.FontStyle.Italic,
                FontSize = 12,
                Foreground = Brush("TsColorTextMutedBrush"),
            };
        }

        column.Children.Add(new TsGlassPanel { Content = new Border { Padding = new Thickness(12), Child = body } });
        return column;
    }

    private void OnServiceChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_serviceSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetServiceAsync(value));
        }
    }

    private void OnMethodChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_methodSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetMethodAsync(value));
        }
    }

    private void OnStatusChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_statusSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetStatusAsync(value));
        }
    }

    private void OnEndpointKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            CommitEndpoint();
        }
    }

    private void OnEndpointCommitted(object sender, RoutedEventArgs e) => CommitEndpoint();

    private void CommitEndpoint()
    {
        if (_suppressEvents)
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetEndpointAsync(_endpointInput.Text ?? string.Empty));
    }

    private void OnClearClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.ClearFiltersAsync());

    private void OnPreviousClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.PreviousPageAsync());

    private void OnNextClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.NextPageAsync());

    private void OnExportClick(object sender, RoutedEventArgs e)
    {
        var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
        package.SetText(_viewModel.ExportJson());
        Clipboard.SetContent(package);
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    private static FontFamily? MonoFont =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var value) && value is FontFamily family ? family : null;
}
