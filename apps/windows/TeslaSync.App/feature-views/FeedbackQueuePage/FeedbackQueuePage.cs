using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>FeedbackQueuePage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/FeedbackQueuePage.tsx</c> (route <c>/admin/feedback</c>, nav name
/// <c>FeedbackQueue</c>). It binds to a <see cref="FeedbackQueuePageViewModel"/> and renders every web region with
/// Fluent components and design tokens inside a single glass panel: the page title, the filters row (status /
/// category selects + Refresh + the bridge-disabled note), the body that switches between the loading spinner, the
/// query-error surface (web <c>QueryError</c>), the empty state and the data table, and the pagination footer. Each
/// table row is an expander whose detail carries the report body, the submitter context grid, the masked reporter
/// email, the recent-errors / console-tail viewers and the inline status / GitHub-issue actions. The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="FeedbackQueueDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class FeedbackQueuePage : UserControl, IDisposable
{
    private readonly FeedbackQueuePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();

    private readonly TsSelect _statusSelect = new() { MinWidth = 180, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsSelect _categorySelect = new() { MinWidth = 180, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE72C" };
    private readonly HelperText _bridgeNote = new();

    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uEBE8" };

    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 8, 12, 8) };
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };

    private readonly StackPanel _paginationPanel;
    private readonly TsButton _previousButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly TsButton _nextButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly Caption _pageOfText = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _suppressEvents;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public FeedbackQueuePage()
        : this(EmptyFeedbackQueueFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The page-of-feedback data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public FeedbackQueuePage(IFeedbackQueueFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FeedbackQueuePageViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();
        _paginationPanel = BuildPaginationPanel();

        Content = BuildLayout();

        _statusSelect.SelectionChanged += OnStatusFilterChanged;
        _categorySelect.SelectionChanged += OnCategoryFilterChanged;
        _refreshButton.Click += OnRefreshClick;
        _errorState.ActionInvoked += OnRetryInvoked;
        _previousButton.Click += OnPreviousClick;
        _nextButton.Click += OnNextClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>FeedbackQueuePage</c>).</summary>
    public static string Slug => FeedbackQueueRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(_title);
        stack.Children.Add(BuildPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildPanel()
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        body.Children.Add(BuildFiltersRow());
        body.Children.Add(_bridgeNote);

        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_emptyState);

        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(_tableHeader);
        table.Children.Add(_rowsPanel);
        table.Children.Add(_paginationPanel);
        body.Children.Add(table);

        return new TsGlassPanel { Content = body };
    }

    private StackPanel BuildFiltersRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        _statusSelect.DisplayMemberPath = nameof(FeedbackSelectOption.Label);
        _statusSelect.SelectedValuePath = nameof(FeedbackSelectOption.Value);
        _categorySelect.DisplayMemberPath = nameof(FeedbackSelectOption.Label);
        _categorySelect.SelectedValuePath = nameof(FeedbackSelectOption.Value);

        row.Children.Add(_statusSelect);
        row.Children.Add(_categorySelect);
        row.Children.Add(_refreshButton);
        return row;
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
            Padding = new Thickness(12, 12, 12, 4),
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(_pageOfText);
        panel.Children.Add(_previousButton);
        panel.Children.Add(_nextButton);
        return panel;
    }

    private static void ApplyColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });             // Created
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                 // Category
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Title
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });             // Page route
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(200) });             // Reporter
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                 // Status
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });             // GitHub
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

    private void Render(FeedbackQueueDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _statusSelect.Header = display.StatusFilterLabel;
        _statusSelect.ItemsSource = display.StatusFilterOptions;
        _statusSelect.SelectedValue = display.SelectedStatus;
        AutomationProperties.SetName(_statusSelect, display.StatusFilterLabel);

        _categorySelect.Header = display.CategoryFilterLabel;
        _categorySelect.ItemsSource = display.CategoryFilterOptions;
        _categorySelect.SelectedValue = display.SelectedCategory;
        AutomationProperties.SetName(_categorySelect, display.CategoryFilterLabel);

        _refreshButton.Text = display.RefreshLabel;
        _refreshButton.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_refreshButton, display.RefreshLabel);

        _bridgeNote.Value = display.BridgeDisabledText;
        _bridgeNote.Visibility = Show(display.ShowBridgeDisabled);

        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorState.Visibility = Show(display.HasError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _tableHeader.Visibility = Show(display.ShowRows);
        _rowsPanel.Visibility = Show(display.ShowRows);
        RebuildHeader(display.ColumnLabels);
        RebuildRows(display);

        _paginationPanel.Visibility = Show(display.ShowPagination);
        _pageOfText.Value = display.PageOfText;
        _previousButton.Text = display.PreviousLabel;
        _nextButton.Text = display.NextLabel;
        _previousButton.IsEnabled = display.CanGoPrevious && !_viewModel.IsFetching;
        _nextButton.IsEnabled = display.CanGoNext && !_viewModel.IsFetching;

        _suppressEvents = false;
    }

    private void RebuildHeader(FeedbackColumnLabels labels)
    {
        _tableHeader.Children.Clear();
        ApplyColumns(_tableHeader);

        AddHeaderCell(labels.Created, 0);
        AddHeaderCell(labels.Category, 1);
        AddHeaderCell(labels.Title, 2);
        AddHeaderCell(labels.PageRoute, 3);
        AddHeaderCell(labels.Reporter, 4);
        AddHeaderCell(labels.Status, 5);
        AddHeaderCell(labels.Github, 6);
    }

    private void AddHeaderCell(string text, int column)
    {
        var label = new Label { Value = text, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, column);
        _tableHeader.Children.Add(label);
    }

    private void RebuildRows(FeedbackQueueDisplay display)
    {
        _rowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row, display.DetailLabels));
        }
    }

    private Expander BuildRow(FeedbackRowDisplay row, FeedbackDetailLabels labels)
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        ApplyColumns(header);

        AddCell(header, new TextBlock
        {
            Text = row.Created,
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Foreground = Brush("TsColorTextSecondaryBrush"),
        }, 0);

        AddCell(header, new TsBadge { Status = row.CategoryVariant, Content = row.CategoryLabel, VerticalAlignment = VerticalAlignment.Center }, 1);

        AddCell(header, new TextBlock
        {
            Text = row.Title,
            FontSize = 13,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Foreground = Brush("TsColorTextPrimaryBrush"),
        }, 2);

        FrameworkElement pageCell = row.HasPageRoute
            ? new Code { Value = row.PageRoute, VerticalAlignment = VerticalAlignment.Center }
            : MutedDash();
        AddCell(header, pageCell, 3);

        AddCell(header, new TsUserCell { DisplayName = row.ReporterName, Secondary = row.ReporterSecondary, VerticalAlignment = VerticalAlignment.Center }, 4);

        AddCell(header, new TsBadge { Status = row.StatusVariant, Content = row.StatusLabel, VerticalAlignment = VerticalAlignment.Center }, 5);

        FrameworkElement githubCell = row.HasGithubUrl
            ? BuildGithubLink(row)
            : MutedDash();
        AddCell(header, githubCell, 6);

        var expander = new Expander
        {
            Header = header,
            Content = BuildExpandedDetail(row, labels),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            IsExpanded = row.IsExpanded,
            Margin = new Thickness(0, 2, 0, 2),
        };
        AutomationProperties.SetName(expander, row.AutomationName);
        return expander;
    }

    private StackPanel BuildExpandedDetail(FeedbackRowDisplay row, FeedbackDetailLabels labels)
    {
        var detail = new StackPanel { Spacing = 12, Padding = new Thickness(8, 8, 8, 8) };

        // Report body.
        var bodyBlock = new StackPanel { Spacing = 4 };
        bodyBlock.Children.Add(new Label { Value = labels.Body });
        bodyBlock.Children.Add(new Text { Value = row.Body });
        detail.Children.Add(bodyBlock);

        // Submitter context grid (web 2-col grid).
        var contextGrid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        contextGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        contextGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        contextGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        contextGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddGridChild(contextGrid, BuildKvCell(labels.AppVersion, new Code { Value = row.AppVersion }), 0, 0);
        AddGridChild(contextGrid, BuildKvCell(labels.UserAgent, new Text { Value = row.UserAgent }), 0, 1);
        AddGridChild(contextGrid, BuildKvCell(labels.Submitter, new Code { Value = row.Submitter }), 1, 0);

        UIElement emailValue = row.HasUserEmail
            ? new TsMaskedValue { Value = row.UserEmail, Variant = MaskVariant.Email, AllowCopy = true, RevealLabel = labels.MaskedEmail }
            : new Text { Value = FeedbackQueueProjection.EmDash };
        AddGridChild(contextGrid, BuildKvCell(labels.UserEmail, emailValue), 1, 1);
        detail.Children.Add(contextGrid);

        // Recent frontend errors (web <details>).
        if (row.HasRecentErrors)
        {
            detail.Children.Add(new Expander
            {
                Header = new Caption { Value = labels.RecentErrors },
                Content = BuildCodeViewer(row.RecentErrorsJson),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            });
        }

        // Console tail (web <details>).
        if (row.HasConsoleTail)
        {
            detail.Children.Add(new Expander
            {
                Header = new Caption { Value = labels.ConsoleTail },
                Content = BuildCodeViewer(row.ConsoleTail),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            });
        }

        detail.Children.Add(BuildActionsRow(row, labels));
        return detail;
    }

    private StackPanel BuildActionsRow(FeedbackRowDisplay row, FeedbackDetailLabels labels)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        long id = row.Id;

        var statusSelect = new TsSelect
        {
            Header = labels.ChangeStatus,
            MinWidth = 160,
            ItemsSource = labels.StatusOptions,
            DisplayMemberPath = nameof(FeedbackSelectOption.Label),
            SelectedValuePath = nameof(FeedbackSelectOption.Value),
            SelectedValue = row.CurrentStatus,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(statusSelect, labels.ChangeStatus);
        statusSelect.SelectionChanged += (_, _) =>
        {
            if (_suppressEvents)
            {
                return;
            }

            if (statusSelect.SelectedValue is string value && value != row.CurrentStatus)
            {
                InvokeAsync(() => _viewModel.UpdateStatusAsync(id, value));
            }
        };
        actions.Children.Add(statusSelect);

        var urlInput = new TsInput
        {
            Header = labels.GithubUrl,
            Hint = labels.GithubUrlHint,
            Text = row.GithubUrl,
            MinWidth = 280,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(urlInput, labels.GithubUrl);
        actions.Children.Add(urlInput);

        var saveButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = labels.SaveUrl,
            VerticalAlignment = VerticalAlignment.Bottom,
            IsEnabled = !_viewModel.IsFetching,
        };
        saveButton.Click += (_, _) => InvokeAsync(() => _viewModel.SaveGithubUrlAsync(id, urlInput.Text ?? string.Empty));
        actions.Children.Add(saveButton);

        if (row.ShowForward)
        {
            var forwardButton = new TsButton
            {
                Variant = ButtonVariant.Primary,
                Size = ControlSize.Small,
                IconGlyph = "\uE8A7",
                Text = labels.Forward,
                VerticalAlignment = VerticalAlignment.Bottom,
                IsEnabled = !_viewModel.IsFetching,
            };
            forwardButton.Click += (_, _) => InvokeAsync(() => _viewModel.ForwardToGithubAsync(id));
            actions.Children.Add(forwardButton);
        }

        return actions;
    }

    private static StackPanel BuildKvCell(string label, UIElement value)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new Label { Value = label });
        column.Children.Add(value);
        return column;
    }

    private static TsGlassPanel BuildCodeViewer(string text)
    {
        var code = new TextBlock
        {
            Text = text,
            FontFamily = MonoFont,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            Foreground = Brush("TsColorTextPrimaryBrush"),
        };
        return new TsGlassPanel
        {
            Content = new ScrollViewer
            {
                Content = new Border { Padding = new Thickness(12), Child = code },
                MaxHeight = 256,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            },
        };
    }

    private static HyperlinkButton BuildGithubLink(FeedbackRowDisplay row)
    {
        var link = new HyperlinkButton
        {
            Content = row.OpenIssueLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (Uri.TryCreate(row.GithubUrl, UriKind.Absolute, out var uri))
        {
            link.NavigateUri = uri;
        }

        AutomationProperties.SetName(link, $"{row.OpenIssueLabel}: {row.GithubUrl}");
        return link;
    }

    private static TextBlock MutedDash() => new()
    {
        Text = FeedbackQueueProjection.EmDash,
        FontSize = 12,
        VerticalAlignment = VerticalAlignment.Center,
        Foreground = Brush("TsColorTextMutedBrush"),
    };

    private static void AddCell(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static void AddGridChild(Grid grid, FrameworkElement element, int row, int column)
    {
        Grid.SetRow(element, row);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void OnStatusFilterChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_statusSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetStatusFilterAsync(value));
        }
    }

    private void OnCategoryFilterChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_categorySelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetCategoryFilterAsync(value));
        }
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnPreviousClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.PreviousPageAsync());

    private void OnNextClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.NextPageAsync());

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
