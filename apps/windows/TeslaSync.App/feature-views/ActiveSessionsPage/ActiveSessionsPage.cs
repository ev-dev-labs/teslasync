using System;
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>ActiveSessionsPage</c> — a parity port of the web page
/// web/src/features/settings/pages/ActiveSessionsPage.tsx (route <c>/account/sessions</c>, nav name
/// <c>Active Sessions</c>). The web page wraps the <c>ActiveSessionsSection</c> in a <c>PageContainer</c> carrying the
/// page title + subtitle and the <c>copyLink</c> affordance; this view reproduces the whole tree natively: it mounts
/// the shared <see cref="PageContainer"/> (CopyLink enabled) whose page content is a Fluent <see cref="TsGlassPanel"/>
/// whose body switches between the four web render branches — the loading notice (spinner + caption), the open-mode
/// notice (web AUTH_MODE_OPEN), the failure surface (<see cref="TsErrorDisplay"/> + Retry) and the forward-auth panel
/// (the header with the all-others revoke action, the sessions table with a "this device" chip + a per-row Sign out,
/// or the empty message). The two destructive revokes confirm through a <see cref="TsConfirmDialog"/> (never
/// silenceable). The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="ActiveSessionsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ActiveSessionsPage : UserControl, IDisposable
{
    private const double DeviceColumnWidth = 1.6;
    private const double IpColumnWidth = 1.0;
    private const double TimeColumnWidth = 1.2;
    private const double ActionsColumnWidth = 132;

    private readonly ActiveSessionsPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None };
    private readonly Grid _stateHost = new();

    private readonly StackPanel _loadingHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
        Padding = new Thickness(24),
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Spinner _spinner = new();
    private readonly Text _loadingText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _openModeHost = new() { Spacing = 12, Padding = new Thickness(24), Visibility = Visibility.Collapsed };
    private readonly FontIcon _openModeIcon = new() { Glyph = ActiveSessionsRegistration.WarningGlyph, FontSize = 20 };
    private readonly PanelTitle _openModeTitle = new();
    private readonly HelperText _openModeMessage = new();

    private readonly TsErrorDisplay _errorState = new() { Visibility = Visibility.Collapsed };

    private readonly StackPanel _forwardAuthHost = new() { Spacing = 16, Padding = new Thickness(24), Visibility = Visibility.Collapsed };
    private readonly Grid _headerRow = new() { ColumnSpacing = 12 };
    private readonly FontIcon _headerIcon = new() { Glyph = ActiveSessionsRegistration.DeviceGlyph, FontSize = 20, VerticalAlignment = VerticalAlignment.Top };
    private readonly PanelTitle _panelTitle = new();
    private readonly HelperText _panelSubtitle = new();
    private readonly TsButton _allOthersButton = new()
    {
        Variant = ButtonVariant.Secondary,
        Size = ControlSize.Medium,
        IconGlyph = ActiveSessionsRegistration.AllOthersGlyph,
        VerticalAlignment = VerticalAlignment.Top,
        Visibility = Visibility.Collapsed,
    };

    private readonly ErrorText _inlineError = new() { Visibility = Visibility.Collapsed };

    private readonly StackPanel _tableRoot = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 10, 12, 10) };
    private readonly StackPanel _tableBody = new();
    private readonly Label _deviceHeader = new();
    private readonly Label _ipHeader = new();
    private readonly Label _signedInHeader = new();
    private readonly Label _lastSeenHeader = new();

    private readonly Text _emptyText = new() { Padding = new Thickness(12, 16, 12, 16), Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default no-backend sessions feed and the shell resource localizer.</summary>
    public ActiveSessionsPage()
        : this(EmptyActiveSessionsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ActiveSessionsPage(IActiveSessionsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ActiveSessionsPageViewModel(feed, localizer);

        BuildOpenMode();
        BuildLoading();
        BuildForwardAuth();
        BuildPanel();

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            PageContent = _panel,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        _errorState.ActionInvoked += OnRetryInvoked;
        _allOthersButton.Click += OnAllOthersClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>ActiveSessions</c>).</summary>
    public static string RouteName => ActiveSessionsRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>ActiveSessionsPage</c>).</summary>
    public static string Slug => ActiveSessionsRegistration.Slug;

    private void BuildLoading()
    {
        _loadingHost.Children.Add(_spinner);
        _loadingHost.Children.Add(_loadingText);
    }

    private void BuildOpenMode()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        _openModeIcon.Foreground = TokenBrush("TsColorWarningBrush");
        titleRow.Children.Add(_openModeIcon);
        titleRow.Children.Add(_openModeTitle);
        _openModeHost.Children.Add(titleRow);
        _openModeHost.Children.Add(_openModeMessage);
    }

    private void BuildForwardAuth()
    {
        _headerIcon.Foreground = TokenBrush("TsColorAccentBrush");

        var titleColumn = new StackPanel { Spacing = 4 };
        titleColumn.Children.Add(_panelTitle);
        titleColumn.Children.Add(_panelSubtitle);

        var headerLeft = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        headerLeft.Children.Add(_headerIcon);
        headerLeft.Children.Add(titleColumn);

        _headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headerLeft, 0);
        Grid.SetColumn(_allOthersButton, 1);
        _allOthersButton.HorizontalAlignment = HorizontalAlignment.Right;
        _headerRow.Children.Add(headerLeft);
        _headerRow.Children.Add(_allOthersButton);

        AddColumns(_tableHeader);
        PlaceCell(_deviceHeader, 0);
        PlaceCell(_ipHeader, 1);
        PlaceCell(_signedInHeader, 2);
        PlaceCell(_lastSeenHeader, 3);
        _tableHeader.Children.Add(_deviceHeader);
        _tableHeader.Children.Add(_ipHeader);
        _tableHeader.Children.Add(_signedInHeader);
        _tableHeader.Children.Add(_lastSeenHeader);
        _tableHeader.BorderBrush = TokenBrush("TsColorBorderBrush");
        _tableHeader.BorderThickness = new Thickness(0, 0, 0, 1);

        _tableRoot.Children.Add(_tableHeader);
        _tableRoot.Children.Add(_tableBody);

        _forwardAuthHost.Children.Add(_headerRow);
        _forwardAuthHost.Children.Add(_inlineError);
        _forwardAuthHost.Children.Add(_tableRoot);
        _forwardAuthHost.Children.Add(_emptyText);
    }

    private void BuildPanel()
    {
        _stateHost.Children.Add(_loadingHost);
        _stateHost.Children.Add(_openModeHost);
        _stateHost.Children.Add(_errorState);
        _stateHost.Children.Add(_forwardAuthHost);

        _panel.Content = _stateHost;
        AutomationProperties.SetName(_panel, Slug);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
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

    private void Render(ActiveSessionsDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // The GlassPanel is always visible; its body switches between the four web render branches.
        _loadingHost.Visibility = Show(display.ShowLoading);
        _openModeHost.Visibility = Show(display.ShowOpenMode);
        _errorState.Visibility = Show(display.ShowError);
        _forwardAuthHost.Visibility = Show(display.ShowForwardAuth);

        _loadingText.Value = display.LoadingText;

        _openModeTitle.Value = display.OpenModeTitle;
        _openModeMessage.Value = display.OpenModeMessage;

        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _panelTitle.Value = display.PanelTitle;
        _panelSubtitle.Value = display.PanelSubtitle;

        _inlineError.Value = display.InlineErrorText;
        _inlineError.Visibility = Show(display.ShowInlineError);

        _allOthersButton.Visibility = Show(display.ShowAllOthers);
        _allOthersButton.Text = display.AllOthersLabel;
        _allOthersButton.IsEnabled = !display.AllOthersBusy;
        _allOthersButton.IsLoading = display.AllOthersBusy;

        _deviceHeader.Value = display.DeviceHeader;
        _ipHeader.Value = display.IpHeader;
        _signedInHeader.Value = display.SignedInHeader;
        _lastSeenHeader.Value = display.LastSeenHeader;

        _tableRoot.Visibility = Show(display.ShowTable);
        _emptyText.Value = display.EmptyMessage;
        _emptyText.Visibility = Show(display.ShowEmpty);
        AutomationProperties.SetName(_emptyText, display.EmptyMessage);

        RenderRows(display);
    }

    private void RenderRows(ActiveSessionsDisplay display)
    {
        _tableBody.Children.Clear();
        foreach (var row in display.Rows)
        {
            _tableBody.Children.Add(BuildRow(row, display));
        }
    }

    private Border BuildRow(ActiveSessionRowDisplay row, ActiveSessionsDisplay display)
    {
        var grid = new Grid { Padding = new Thickness(12, 8, 12, 8) };
        AddColumns(grid);

        var deviceCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        deviceCell.Children.Add(new Text { Value = row.Device, VerticalAlignment = VerticalAlignment.Center });
        if (row.Current)
        {
            deviceCell.Children.Add(new TsBadge
            {
                Status = StatusKind.Success,
                Content = row.CurrentLabel,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        PlaceCell(deviceCell, 0);

        var ip = new Text { Value = row.Ip, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(ip, 1);

        var signedIn = new Text { Value = row.SignedIn, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(signedIn, 2);

        var lastSeen = new Text { Value = row.LastSeen, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(lastSeen, 3);

        grid.Children.Add(deviceCell);
        grid.Children.Add(ip);
        grid.Children.Add(signedIn);
        grid.Children.Add(lastSeen);

        var action = BuildRowAction(row, display);
        PlaceCell(action, 4);
        grid.Children.Add(action);

        var rowBorder = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        rowBorder.BorderBrush = TokenBrush("TsColorBorderBrush");
        return rowBorder;
    }

    private FrameworkElement BuildRowAction(ActiveSessionRowDisplay row, ActiveSessionsDisplay display)
    {
        if (!row.CanRevoke)
        {
            // The current row reserves the column so the table stays aligned (web renders an empty cell).
            var empty = new Border();
            AutomationProperties.SetAccessibilityView(empty, AccessibilityView.Raw);
            return empty;
        }

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = ActiveSessionsRegistration.RevokeGlyph,
            Text = row.RevokeLabel,
            IsEnabled = !row.RevokeBusy,
            IsLoading = row.RevokeBusy,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, row.RevokeAria);
        ToolTipService.SetToolTip(button, row.RevokeAria);

        string id = row.Id;
        string device = row.Device;
        button.Click += (_, _) => InvokeAsync(() => ConfirmRevokeAsync(id, device, display));
        return button;
    }

    private async System.Threading.Tasks.Task ConfirmRevokeAsync(string id, string device, ActiveSessionsDisplay display)
    {
        string message = display.RevokeConfirmMessageTemplate.Replace(
            ActiveSessionsProjection.DeviceToken, device, StringComparison.Ordinal);

        var dialog = new TsConfirmDialog
        {
            Title = display.RevokeConfirmTitle,
            Content = message,
            PrimaryButtonText = display.RevokeConfirmLabel,
            CloseButtonText = display.RevokeCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _viewModel.RevokeAsync(id).ConfigureAwait(true);
        }
    }

    private async void OnAllOthersClick(object sender, RoutedEventArgs e)
    {
        var display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.AllOthersConfirmTitle,
            Content = display.AllOthersConfirmMessage,
            PrimaryButtonText = display.AllOthersConfirmLabel,
            CloseButtonText = display.AllOthersCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _viewModel.RevokeAllOthersAsync().ConfigureAwait(true);
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    /// <summary>Unsubscribe from and dispose the view-model and hosted surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _allOthersButton.Click -= OnAllOthersClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private static void AddColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(DeviceColumnWidth, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(IpColumnWidth, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TimeColumnWidth, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TimeColumnWidth, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ActionsColumnWidth) });
    }

    private static void PlaceCell(FrameworkElement element, int column)
    {
        element.Margin = new Thickness(8, 0, 8, 0);
        Grid.SetColumn(element, column);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static async void InvokeAsync(Func<System.Threading.Tasks.Task> action) =>
        await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new ActiveSessionsPageAutomationPeer(this);

    private sealed class ActiveSessionsPageAutomationPeer(ActiveSessionsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
