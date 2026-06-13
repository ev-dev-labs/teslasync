// Notifications / Webhooks page — WinUI 3 view.
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>WebhooksPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/WebhooksPage.tsx</c> (route <c>/notifications/webhooks</c>, nav name
/// <c>Webhooks</c>). It binds to a <see cref="WebhooksPageViewModel"/> and reproduces the web page's thin
/// <c>PageContainer</c> chrome with Fluent components and design tokens — the page header (localized
/// <see cref="PageTitle"/> + <see cref="Subhead"/> subtitle) and the <c>copyLink</c> action (the shared
/// <see cref="CopyLinkButton"/>, wired to the route's <c>teslasync://</c> deep-link) — and then embeds the shared
/// <see cref="WebhookChannelsSection"/> exactly as the web page wraps <c>&lt;WebhookChannelsSection /&gt;</c>. The
/// list itself, with its loading / empty / error states, belongs to that section's own port; the view is a thin
/// renderer whose i18n + projection happen in the view-model's <see cref="WebhooksDisplay"/>. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class WebhooksPage : UserControl, IDisposable
{
    private readonly WebhooksPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly CopyLinkButton _copyLink;
    private readonly WebhookChannelsSection _section;

    /// <summary>Creates the page over the inert default webhook source and the shell resource localizer.</summary>
    public WebhooksPage()
        : this(EmptyWebhookChannelsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit webhook source and a localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The webhook data port handed to the embedded <see cref="WebhookChannelsSection"/>.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public WebhooksPage(IWebhookChannelsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new WebhooksPageViewModel(localizer);
        _section = new WebhookChannelsSection(source, localizer);
        _copyLink = new CopyLinkButton(
            new DelegateCurrentLinkProvider(static () => DeepLink.BuildUri(WebhooksPageRegistration.RoutePath).ToString()),
            SystemClipboardWriter.Instance,
            new ToastController(),
            localizer);

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>NotificationsWebhooks</c>).</summary>
    public static string RouteName => WebhooksPageRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>WebhooksPage</c>).</summary>
    public static string Slug => WebhooksPageRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_section);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);

        _copyLink.HorizontalAlignment = HorizontalAlignment.Right;
        _copyLink.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(_copyLink, 1);

        header.Children.Add(titles);
        header.Children.Add(_copyLink);
        return header;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model's embedded surfaces (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _section.Dispose();
        _copyLink.Dispose();
        GC.SuppressFinalize(this);
    }

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

    private void Render(WebhooksDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);
    }
}
