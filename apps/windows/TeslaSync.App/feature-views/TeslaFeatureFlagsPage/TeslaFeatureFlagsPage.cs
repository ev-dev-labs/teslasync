using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>TeslaFeatureFlagsPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx</c> (route <c>/tesla-features</c>, nav name
/// <c>TeslaFeatureFlags</c>). The web page is a thin <c>PageContainer</c> wrapper that renders the page title and
/// subtitle (the two parity strings <c>featureConfig.title</c> / <c>featureConfig.subtitle</c>) above the shared
/// <c>FeatureToggles</c> surface. This view mirrors that one-to-one: a <see cref="TsPageContainer"/> (the native
/// port of the web <c>PageContainer</c>) bound to the page title/subtitle from the
/// <see cref="TeslaFeatureFlagsPageViewModel"/>, hosting a live <see cref="FeatureToggles"/> control as its body.
/// The hosted surface owns the feature-config read, the refresh mutation and the loading / empty / error data
/// states; this page is pure chrome and records the PII-safe <c>view.opened</c> diagnostic on first load. The view
/// performs no HTTP and holds no business logic.
/// </summary>
public sealed partial class TeslaFeatureFlagsPage : UserControl, IDisposable
{
    private readonly TeslaFeatureFlagsPageViewModel _viewModel;
    private readonly FeatureToggles _featureToggles;
    private readonly TsPageContainer _container;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the default empty feature-toggles source and the shell resource localizer.</summary>
    public TeslaFeatureFlagsPage()
        : this(EmptyFeatureTogglesSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feature-toggles source and localizer (tests / dependency injection).</summary>
    /// <param name="source">The feature-config data port the hosted <see cref="FeatureToggles"/> surface reads through.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TeslaFeatureFlagsPage(IFeatureTogglesSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaFeatureFlagsPageViewModel(localizer);
        _featureToggles = new FeatureToggles(source, localizer);

        _container = new TsPageContainer
        {
            Title = _viewModel.Title,
            Subtitle = _viewModel.Subtitle,
            PageContent = _featureToggles,
        };

        AutomationProperties.SetName(this, _viewModel.Title);

        Content = new ScrollViewer
        {
            Content = _container,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>TeslaFeatureFlagsPage</c>).</summary>
    public static string Slug => TeslaFeatureFlagsRegistration.Slug;

    /// <summary>The backing page state holder (exposed for hosting / diagnostics).</summary>
    public TeslaFeatureFlagsPageViewModel ViewModel => _viewModel;

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

    /// <summary>Detach lifecycle handlers and dispose the hosted surface + view-model (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _featureToggles.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }
}
