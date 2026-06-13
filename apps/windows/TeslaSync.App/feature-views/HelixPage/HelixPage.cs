using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>HelixPage</c> — a parity port of the web page
/// web/src/features/settings/pages/HelixPage.tsx (route <c>/integrations/helix</c>, nav name <c>Helix</c>). The web
/// page renders a <c>PageContainer</c> (its title, the muted subtitle, the <c>integrations</c> / <c>helix</c>
/// breadcrumb-label overrides and the page-level loading spinner driven by <c>useSettings().isLoading</c>) wrapping
/// the <c>AISettings</c> component. This surface reproduces that exactly: it composes the shared
/// <see cref="PageContainer"/> surface — the parity port of web/src/components/layout/PageContainer.tsx — with the
/// same three i18n strings and the breadcrumb overrides, binds the container's loading state to a
/// <see cref="HelixPageViewModel"/> over the settings read (web <c>useSettings</c>), and hosts the already-ported
/// <see cref="AISettings"/> surface as its body. While the first settings fetch is in flight the container shows its
/// spinner (the <em>loading</em> state); once the read resolves the container shows the Helix opt-in form (the
/// <em>success</em> state). Every visible string resolves through the i18n facade and the wrapper hides itself from
/// Narrator so the container carries the page's heading-level-1 landmark. State changes are marshalled onto the UI
/// thread.
/// </summary>
public sealed partial class HelixPage : UserControl, IDisposable
{
    private const double ContentPadding = 24; // web layout gutter around the page chrome.

    private readonly PageContainer _container;
    private readonly AISettings _settings;
    private readonly HelixPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the shell localizer and the headless default AI-settings source.</summary>
    public HelixPage()
        : this(EmptyAiSettingsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit settings source and localizer (used by hosts / tests).</summary>
    /// <param name="source">The AI-settings data port the page (web <c>useSettings</c>) and the embedded surface share.</param>
    /// <param name="localizer">The i18n facade the page chrome resolves through.</param>
    public HelixPage(IAiSettingsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _viewModel = new HelixPageViewModel(source);
        _settings = new AISettings(source, localizer);
        _container = new PageContainer(
            localizer,
            HelixPageRegistration.Title(localizer),
            breadcrumbOverrides: HelixPageRegistration.BreadcrumbOverrides(localizer))
        {
            Subtitle = HelixPageRegistration.Subtitle(localizer),
            PageContent = _settings,
        };

        IsTabStop = false;

        // Transparent wrapper: the PageContainer carries the page's heading-level-1 title landmark and body
        // automation ids, so the wrapper hides itself from Narrator (web parity — the page IS the container).
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = new ScrollViewer
        {
            Content = _container,
            Padding = new Thickness(ContentPadding),
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        SyncLoading();
    }

    /// <summary>The diagnostics surface slug (<c>HelixPage</c>).</summary>
    public static string Slug => HelixPageRegistration.Slug;

    /// <summary>The embedded Helix settings surface (exposed for hosting / diagnostics).</summary>
    public AISettings Settings => _settings;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public HelixPageViewModel ViewModel => _viewModel;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(SyncLoading);
        }
        else
        {
            SyncLoading();
        }
    }

    private void SyncLoading() => _container.IsLoading = _viewModel.IsLoading;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _settings.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }
}
