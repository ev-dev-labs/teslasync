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
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>PowersharePage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/PowersharePage.tsx</c> (route <c>/powershare</c>, nav name
/// <c>Powershare</c>). It binds to a <see cref="PowersharePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header; a loading shimmer; a retryable failure surface; and
/// the two always-visible glass panels — the Powershare status panel (a status badge plus the Type / Output
/// Power / Hours Remaining stat tiles, or a "no Powershare data" empty surface) and the stop-reason panel (the
/// stop-reason chip + help text, or a "no stop reason" empty surface). The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="PowershareDisplay"/> projection. State
/// changes are marshalled onto the UI thread. Every panel carries a Narrator automation name.
/// </summary>
public sealed partial class PowersharePage : UserControl, IDisposable
{
    private const double PanelPadding = 24;
    private const double CardSpacing = 16;
    private const double SkeletonHeight = 120;

    private readonly PowersharePageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _loadingPanel;
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _contentPanel = new() { Spacing = 24 };

    // GlassPanel1 — Powershare status.
    private readonly TsGlassPanel _statusPanel = new();
    private readonly FontIcon _statusIcon = new() { Glyph = PowershareProjection.StatusGlyph, FontSize = 18 };
    private readonly PanelTitle _statusTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _statusBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _statusBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly Grid _statusGrid;
    private readonly TsStatCard _typeCard = new();
    private readonly TsStatCard _powerCard = new();
    private readonly TsStatCard _hoursCard = new();
    private readonly TsEmptyState _statusEmpty = new() { IconGlyph = PowershareProjection.StatusGlyph };

    // GlassPanel5 — stop reason.
    private readonly TsGlassPanel _stopPanel = new();
    private readonly FontIcon _stopIcon = new() { Glyph = PowershareProjection.StopReasonGlyph, FontSize = 18 };
    private readonly PanelTitle _stopTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _stopBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _stopRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 12,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _stopBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Text _stopHelp = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsEmptyState _stopEmpty = new() { IconGlyph = PowershareProjection.StopReasonGlyph };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public PowersharePage()
        : this(EmptyPowershareFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The Powershare data port (web's five observation reads).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id; null renders the empty state.</param>
    public PowersharePage(IPowershareFeed feed, Core.Notifications.ILocalizer localizer, string? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new PowersharePageViewModel(feed, localizer, vehicleId);
        _statusGrid = BuildEqualColumns(CardSpacing, _typeCard, _powerCard, _hoursCard);
        _loadingPanel = BuildLoadingPanel();

        TintIcons();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Powershare</c>).</summary>
    public static string RouteName => PowershareRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public PowersharePageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);

        BuildContent();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(header);
        stack.Children.Add(_errorState);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_contentPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(3));
        panel.Children.Add(new TsSkeleton { BlockHeight = SkeletonHeight, HorizontalAlignment = HorizontalAlignment.Stretch });
        return panel;
    }

    private void BuildContent()
    {
        BuildStatusSection();
        BuildStopSection();

        _contentPanel.Children.Add(_statusPanel);
        _contentPanel.Children.Add(_stopPanel);
        _contentPanel.Visibility = Visibility.Collapsed;
    }

    private void BuildStatusSection()
    {
        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleGroup = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleGroup.Children.Add(_statusIcon);
        titleGroup.Children.Add(_statusTitle);

        _statusBadge.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(titleGroup, 0);
        Grid.SetColumn(_statusBadge, 1);
        headerRow.Children.Add(titleGroup);
        headerRow.Children.Add(_statusBadge);

        var body = new StackPanel { Spacing = CardSpacing };
        body.Children.Add(headerRow);
        body.Children.Add(_statusBody);

        _statusPanel.Padding = new Thickness(PanelPadding);
        _statusPanel.Content = body;
    }

    private void BuildStopSection()
    {
        var titleGroup = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleGroup.Children.Add(_stopIcon);
        titleGroup.Children.Add(_stopTitle);

        _stopRow.Children.Add(_stopBadge);
        _stopRow.Children.Add(_stopHelp);

        var body = new StackPanel { Spacing = CardSpacing };
        body.Children.Add(titleGroup);
        body.Children.Add(_stopBody);

        _stopPanel.Padding = new Thickness(PanelPadding);
        _stopPanel.Content = body;
    }

    private void TintIcons()
    {
        if (StatusBrush(StatusKind.Warning) is { } warn)
        {
            _statusIcon.Foreground = warn;
        }

        if (StatusBrush(StatusKind.Danger) is { } danger)
        {
            _stopIcon.Foreground = danger;
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(PowershareDisplay d)
    {
        if (_disposed)
        {
            return;
        }

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.AutomationName);

        _loadingPanel.Visibility = Show(d.ShowLoading);

        _errorState.Visibility = Show(d.ShowError);
        _errorState.Title = d.ErrorText;
        _errorState.ActionText = d.RetryLabel;
        AutomationProperties.SetName(_errorState, d.ErrorText);

        _contentPanel.Visibility = Show(d.ShowContent);

        RenderStatusSection(d);
        RenderStopSection(d);
    }

    private void RenderStatusSection(PowershareDisplay d)
    {
        _statusTitle.Value = d.StatusSectionTitle;
        AutomationProperties.SetName(_statusPanel, d.StatusSectionTitle);

        _statusBadge.Content = d.StatusBadgeText;
        _statusBadge.Status = d.StatusBadgeStatus;
        AutomationProperties.SetName(_statusBadge, $"{d.StatusSectionTitle}: {d.StatusBadgeText}");

        ApplyCard(_typeCard, d.TypeCard);
        ApplyCard(_powerCard, d.PowerCard);
        ApplyCard(_hoursCard, d.HoursCard);

        _statusEmpty.Message = d.NoDataMessage;
        AutomationProperties.SetName(_statusEmpty, d.NoDataMessage);
        _statusBody.Content = d.HasData ? _statusGrid : _statusEmpty;
    }

    private void RenderStopSection(PowershareDisplay d)
    {
        _stopTitle.Value = d.StopReasonSectionTitle;
        AutomationProperties.SetName(_stopPanel, d.StopReasonSectionTitle);

        if (d.StopReasonPresent)
        {
            _stopBadge.Content = d.StopReasonText;
            _stopBadge.Status = d.StopReasonStatus;
            _stopHelp.Value = d.StopReasonHelp;
            AutomationProperties.SetName(_stopBadge, d.StopReasonText);
            _stopBody.Content = _stopRow;
        }
        else
        {
            _stopEmpty.Message = d.NoStopReasonMessage;
            AutomationProperties.SetName(_stopEmpty, d.NoStopReasonMessage);
            _stopBody.Content = _stopEmpty;
        }
    }

    private static void ApplyCard(TsStatCard card, PowershareStat stat)
    {
        card.Label = stat.Label;
        card.Value = stat.Value;
        card.Sublabel = stat.Sublabel;
        card.Glyph = stat.Glyph;
        AutomationProperties.SetName(card, stat.AutomationName);
    }

    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private static Brush? StatusBrush(StatusKind status)
    {
        string key = StatusResources.AccentBrushKey(status);
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(key, out var value)
            && value is Brush brush)
        {
            return brush;
        }

        return null;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PowersharePageAutomationPeer(this);

    private sealed class PowersharePageAutomationPeer(PowersharePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((PowersharePage)Owner).ViewModel.Title : name;
        }
    }
}
