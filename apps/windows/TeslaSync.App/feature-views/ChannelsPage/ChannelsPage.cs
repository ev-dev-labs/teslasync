using System;
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>ChannelsPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/ChannelsPage.tsx</c> (route <c>/notifications/channels</c>, nav name
/// <c>Channels</c>). The web page is a thin shell: a <c>PageContainer</c> carrying the page title + subtitle and
/// the <c>copyLink</c> affordance, hosting the <c>NotificationChannelsView</c> (the delivery-channel CRUD surface
/// for Discord, Slack, Telegram, email, ntfy, Pushover and custom webhooks). This view reproduces that exactly: it
/// binds a <see cref="ChannelsPageViewModel"/> for the two manifest strings and mounts the native
/// <see cref="PageContainer"/> shared surface (the parity port of the web <c>PageContainer</c>) with
/// <see cref="PageContainer.CopyLink"/> enabled, whose page content is the native <c>NotificationChannelsView</c>.
/// The view is a thin host — the hosted surface owns its own loading / empty / error / freshness states; this page
/// owns no data source. Chrome updates from the view-model are marshalled onto the UI thread.
/// </summary>
public sealed partial class ChannelsPage : UserControl, IDisposable
{
    private readonly ChannelsPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly NotificationChannelsView _channels;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    /// <summary>Creates the page over the empty no-backend channels feed and the shell resource localizer.</summary>
    public ChannelsPage()
        : this(EmptyNotificationChannelsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit channels source and localizer (used by tests / dependency injection).</summary>
    /// <param name="channelsSource">The channels data port the hosted <c>NotificationChannelsView</c> binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ChannelsPage(INotificationChannelsSource channelsSource, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(channelsSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ChannelsPageViewModel(localizer);
        _channels = new NotificationChannelsView(channelsSource, localizer);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            PageContent = _channels,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>NotificationsChannels</c>).</summary>
    public static string RouteName => ChannelsPageRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>ChannelsPage</c>).</summary>
    public static string Slug => ChannelsPageRegistration.Slug;

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
            ApplyChrome();
        }
        else
        {
            _dispatcher.TryEnqueue(ApplyChrome);
        }
    }

    private void ApplyChrome()
    {
        _container.Title = _viewModel.Title;
        _container.Subtitle = _viewModel.Subtitle;
        AutomationProperties.SetName(this, _viewModel.Title);
    }

    /// <summary>Unsubscribe from the view-model and dispose the hosted surfaces (idempotent; CA1001).</summary>
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
        _channels.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }
}
