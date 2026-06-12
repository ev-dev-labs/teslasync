using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>SystemPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/SystemPage.tsx</c> (the unrouted <c>/admin/system</c> infrastructure-budget
/// dashboard). It binds to a <see cref="SystemPageViewModel"/> for the localized title/subtitle header and
/// composes the web page's vertical stack of two panels — the <see cref="RateLimitStatusPanel"/> then the
/// <see cref="QueueStatusPanel"/> (web <c>&lt;Stack className="gap-6"&gt;</c>) — inside a scrolling
/// <see cref="PageContainer"/>-equivalent layout. The page owns no query: each panel carries its own
/// loading / empty / error state holder, so the three data states render inside the panels exactly as the web
/// composes them. Every string resolves through the i18n facade with the web key names and the header carries a
/// Narrator name. State changes (a runtime language change) are marshalled onto the UI thread.
/// </summary>
public sealed partial class SystemPage : UserControl, IDisposable
{
    private readonly SystemPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly RateLimitStatusPanel _rateLimitPanel;
    private readonly QueueStatusPanel _queuePanel;

    private readonly StackPanel _header = new() { Spacing = 4 };
    private readonly PageTitle _titleText = new();
    private readonly Subhead _subtitleText = new()
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        MaxWidth = 760,
    };

    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the default empty sources and the shell resource localizer.</summary>
    public SystemPage()
        : this(EmptyRateLimitStatusSource.Instance, EmptyQueueStatusSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit panel data sources and a localizer (used by tests / DI / hosts).</summary>
    /// <param name="rateLimitSource">The rate-limit budget data port the embedded panel binds to.</param>
    /// <param name="queueSource">The worker-queue data port the embedded panel binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SystemPage(
        IRateLimitStatusSource rateLimitSource,
        IQueueStatusSource queueSource,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(rateLimitSource);
        ArgumentNullException.ThrowIfNull(queueSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SystemPageViewModel(localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _rateLimitPanel = new RateLimitStatusPanel(rateLimitSource, localizer);
        _queuePanel = new QueueStatusPanel(queueSource, localizer);

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>SystemPage</c>).</summary>
    public static string Slug => SystemPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public SystemPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        _titleText.Value = _viewModel.Title;
        _subtitleText.Value = _viewModel.Subtitle;

        _header.Children.Add(_titleText);
        _header.Children.Add(_subtitleText);
        AutomationProperties.SetName(_header, _viewModel.Title);

        // web <Stack className="gap-6"> — the two panels stacked with 24px gaps, under the page header.
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(_header);
        stack.Children.Add(_rateLimitPanel);
        stack.Children.Add(_queuePanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and dispose the embedded panels (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _rateLimitPanel.Dispose();
        _queuePanel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => ApplyText(e.PropertyName));
            return;
        }

        ApplyText(e.PropertyName);
    }

    private void ApplyText(string? propertyName)
    {
        if (propertyName is null or nameof(SystemPageViewModel.Title))
        {
            _titleText.Value = _viewModel.Title;
            AutomationProperties.SetName(_header, _viewModel.Title);
        }

        if (propertyName is null or nameof(SystemPageViewModel.Subtitle))
        {
            _subtitleText.Value = _viewModel.Subtitle;
        }
    }
}
