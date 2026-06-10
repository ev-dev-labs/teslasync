using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 BrowserPushChannelCard surface — a parity port of
/// web/src/features/notifications/components/BrowserPushChannelCard.tsx. It composes the web component's single
/// glass card: the header (bell icon, title, subtitle and the status badge — active / not subscribed /
/// unavailable), the body (either the amber unsupported reason or the enable / disable affordance with the
/// platform note), and the registered-devices section (one row per browser that has ever subscribed, each with a
/// this-device marker, a last-used line and a remove affordance). The device list flows through the
/// cache-then-network <see cref="BrowserPushChannelViewModel"/>, so the section renders every state the P2
/// contract requires — a skeleton while loading, a retry surface on a hard failure, a friendly empty state when
/// no devices are registered, and a freshness chip (stale / offline) otherwise — while the channel chrome (local
/// capability) always renders. The view never performs HTTP; every string resolves through the i18n facade and
/// every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BrowserPushChannelCard : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double PanelPadding = 24;        // web p-6

    private readonly BrowserPushChannelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BrowserPushChannelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    // Header.
    private readonly FontIcon _icon = new() { FontSize = 20, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly PanelTitle _title = new();
    private readonly Caption _subtitle = new();
    private readonly TsBadge _statusBadge = new() { VerticalAlignment = VerticalAlignment.Top };
    private readonly TextBlock _statusBadgeText = new() { FontSize = 12 };

    // Body — unsupported reason vs the enable/disable affordance.
    private readonly Border _unsupported = new() { CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), Padding = new Thickness(12) };
    private readonly FontIcon _unsupportedIcon = new() { Glyph = BrowserPushChannelProjection.WarningGlyph, FontSize = 16, VerticalAlignment = VerticalAlignment.Top };
    private readonly Caption _unsupportedText = new();
    private readonly StackPanel _actionRow = new() { Spacing = 8 };
    private readonly TsButton _enableButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = BrowserPushChannelProjection.BellGlyph, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly TsButton _disableButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = BrowserPushChannelProjection.BellOffGlyph, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly Caption _platformNote = new();

    // Registered-devices section.
    private readonly StackPanel _devicesSection = new() { Spacing = 8 };
    private readonly Label _devicesHeading = new();
    private readonly StackPanel _devicesHeaderActions = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _devicesBody = new() { Spacing = 8 };
    private readonly StackPanel _devicesLoading = new() { Spacing = 8 };
    private readonly TsQueryError _devicesError = new();
    private readonly TsEmptyState _devicesEmpty = new();
    private readonly StackPanel _devicesList = new() { Spacing = 8 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the two shared seams, the i18n facade and optional diagnostics.</summary>
    /// <param name="deviceSource">The registered-devices cache-then-network source.</param>
    /// <param name="gateway">The browser/OS push-capability gateway.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public BrowserPushChannelCard(
        IBrowserPushDeviceSource deviceSource,
        IBrowserPushGateway gateway,
        ILocalizer localizer,
        BrowserPushChannelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(deviceSource);
        ArgumentNullException.ThrowIfNull(gateway);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BrowserPushChannelDiagnostics();
        _viewModel = new BrowserPushChannelViewModel(deviceSource, gateway, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>BrowserPushChannelCard</c>).</summary>
    public static string Slug => BrowserPushChannelRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public BrowserPushChannelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BrowserPushDeviceSource"/> from the shared
    /// data layer plus a default in-memory capability gateway. The Windows host passes a real Windows-push-backed
    /// <see cref="IBrowserPushGateway"/>; the headless default keeps the surface fully renderable without one.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <param name="gateway">Optional push-capability gateway (defaults to the in-memory gateway).</param>
    public static BrowserPushChannelCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BrowserPushChannelDiagnostics? diagnostics = null,
        IBrowserPushGateway? gateway = null)
    {
        var source = new BrowserPushDeviceSource(api, engine, options);
        return new BrowserPushChannelCard(
            source,
            gateway ?? new InMemoryBrowserPushGateway(),
            localizer,
            diagnostics);
    }

    private void BuildChrome()
    {
        _icon.Foreground = DisplayTokens.Brush("TsColorInfoBrush");
        var iconBox = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = _icon,
        };

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);

        var headerLeft = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        headerLeft.Children.Add(iconBox);
        headerLeft.Children.Add(titleStack);

        _statusBadge.Content = _statusBadgeText;
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headerLeft, 0);
        Grid.SetColumn(_statusBadge, 1);
        header.Children.Add(headerLeft);
        header.Children.Add(_statusBadge);

        _unsupported.BorderBrush = DisplayTokens.Brush("TsColorWarningBrush");
        _unsupported.Background = DisplayTokens.Surface;
        _unsupportedIcon.Foreground = DisplayTokens.Brush("TsColorWarningBrush");
        var unsupportedRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        unsupportedRow.Children.Add(_unsupportedIcon);
        unsupportedRow.Children.Add(_unsupportedText);
        _unsupported.Child = unsupportedRow;

        _enableButton.Click += (_, _) => _ = _viewModel.EnableAsync();
        _disableButton.Click += (_, _) => _ = _viewModel.DisableAsync();
        _actionRow.Children.Add(_enableButton);
        _actionRow.Children.Add(_disableButton);
        _actionRow.Children.Add(_platformNote);

        BuildDevicesSection();

        _root.Children.Add(header);
        _root.Children.Add(_unsupported);
        _root.Children.Add(_actionRow);
        _root.Children.Add(_devicesSection);

        Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _root };
    }

    private void BuildDevicesSection()
    {
        _freshnessChip.Content = _freshnessChipText;
        _refreshButton.Click += OnRefreshClick;
        _devicesHeaderActions.Children.Add(_freshnessChip);
        _devicesHeaderActions.Children.Add(_freshness);
        _devicesHeaderActions.Children.Add(_refreshButton);

        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _devicesHeading.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_devicesHeading, 0);
        Grid.SetColumn(_devicesHeaderActions, 1);
        headerGrid.Children.Add(_devicesHeading);
        headerGrid.Children.Add(_devicesHeaderActions);

        for (int i = 0; i < 2; i++)
        {
            _devicesLoading.Children.Add(new TsSkeleton { BlockHeight = 52 });
        }

        _devicesError.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _devicesBody.Children.Add(_devicesLoading);
        _devicesBody.Children.Add(_devicesError);
        _devicesBody.Children.Add(_devicesEmpty);
        _devicesBody.Children.Add(_devicesList);
        LiveRegion.Configure(_devicesBody);

        _devicesSection.Children.Add(headerGrid);
        _devicesSection.Children.Add(_devicesBody);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

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

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        AutomationProperties.SetName(this, display.AutomationName);

        RenderChrome(display);
        RenderDevices(display, state);
    }

    private void RenderChrome(BrowserPushChannelDisplay display)
    {
        _icon.Glyph = display.IconGlyph;
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;

        _statusBadgeText.Text = display.StatusText;
        _statusBadge.Status = display.StatusStatus;
        AutomationProperties.SetName(_statusBadge, display.StatusAutomationName);

        _unsupported.Visibility = display.IsUnsupported ? Visibility.Visible : Visibility.Collapsed;
        _unsupportedText.Value = display.DisabledReason;

        _actionRow.Visibility = display.IsUnsupported ? Visibility.Collapsed : Visibility.Visible;
        _enableButton.Visibility = display.ShowEnable ? Visibility.Visible : Visibility.Collapsed;
        _enableButton.Text = display.EnableText;
        AutomationProperties.SetName(_enableButton, display.EnableText);
        _disableButton.Visibility = display.ShowDisable ? Visibility.Visible : Visibility.Collapsed;
        _disableButton.Text = display.DisableText;
        AutomationProperties.SetName(_disableButton, display.DisableText);
        _platformNote.Value = display.PlatformNote;
    }

    private void RenderDevices(BrowserPushChannelDisplay display, BrowserPushChannelState state)
    {
        _devicesHeading.Value = display.DevicesHeading;

        bool loading = state == BrowserPushChannelState.Loading;
        bool error = state == BrowserPushChannelState.Error;
        bool empty = state == BrowserPushChannelState.Empty;
        bool hasList = state is BrowserPushChannelState.Loaded or BrowserPushChannelState.Stale or BrowserPushChannelState.Offline;

        _devicesLoading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _devicesError.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _devicesEmpty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        _devicesList.Visibility = hasList ? Visibility.Visible : Visibility.Collapsed;
        _devicesHeaderActions.Visibility = loading || error ? Visibility.Collapsed : Visibility.Visible;

        if (error)
        {
            _devicesError.Title = _localizer.GetString(BrowserPushChannelStrings.ErrorTitle, "Couldn't load registered devices");
            _devicesError.Message = _viewModel.ErrorMessage
                ?? _localizer.GetString(BrowserPushChannelStrings.ErrorLoad, "Couldn't load registered devices");
            _devicesError.ActionText = _localizer.GetString(BrowserPushChannelStrings.Retry, "Retry");
            _devicesError.AttemptCount = _viewModel.Attempts;
            return;
        }

        if (empty)
        {
            _devicesEmpty.Title = display.DevicesHeading;
            _devicesEmpty.Message = display.DevicesEmptyText;
            return;
        }

        RenderFreshness(state);

        if (hasList)
        {
            RenderDeviceRows(display.Devices);
        }
    }

    private void RenderFreshness(BrowserPushChannelState state)
    {
        bool stale = state == BrowserPushChannelState.Stale;
        bool offline = state == BrowserPushChannelState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString(BrowserPushChannelStrings.OfflineChip, "Offline")
                : _localizer.GetString(BrowserPushChannelStrings.StaleChip, "Stale");
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = text;
            AutomationProperties.SetName(_freshnessChip, text);
            _freshnessChip.Visibility = Visibility.Visible;
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(
            _refreshButton,
            _localizer.GetString(BrowserPushChannelStrings.Refresh, "Refresh registered devices"));
    }

    private void RenderDeviceRows(IReadOnlyList<BrowserPushDeviceRow> rows)
    {
        _devicesList.Children.Clear();
        foreach (var row in rows)
        {
            _devicesList.Children.Add(BuildDeviceRow(row));
        }
    }

    private Border BuildDeviceRow(BrowserPushDeviceRow row)
    {
        var glyph = new FontIcon
        {
            Glyph = BrowserPushChannelProjection.DeviceGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        label.Children.Add(new TextBlock
        {
            Text = row.UserAgentText,
            FontSize = 12,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Foreground = DisplayTokens.TextPrimary,
        });
        if (row.IsThisDevice)
        {
            label.Children.Add(new TextBlock
            {
                Text = row.ThisDeviceMarker,
                FontSize = 12,
                Foreground = DisplayTokens.Accent,
            });
        }

        var info = new StackPanel { Spacing = 2 };
        info.Children.Add(label);
        info.Children.Add(new Caption { Value = row.LastUsedText });

        var infoRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        infoRow.Children.Add(glyph);
        infoRow.Children.Add(info);

        var remove = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = BrowserPushChannelProjection.RemoveGlyph,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(remove, $"{row.RemoveLabel}: {row.UserAgentText}");
        ToolTipService.SetToolTip(remove, row.RemoveLabel);
        string endpoint = row.Endpoint;
        remove.Click += (_, _) => _ = _viewModel.RemoveDeviceAsync(endpoint);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(infoRow, 0);
        Grid.SetColumn(remove, 1);
        grid.Children.Add(infoRow);
        grid.Children.Add(remove);

        var border = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Padding = new Thickness(10),
            Child = grid,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }
}
