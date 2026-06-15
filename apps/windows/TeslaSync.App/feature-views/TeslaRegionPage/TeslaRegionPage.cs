using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>TeslaRegionPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/TeslaRegionPage.tsx</c> (route <c>/tesla-region</c>, nav name
/// <c>TeslaRegion</c>). The web page is a thin wrapper: a <see cref="PageContainer"/> header (web
/// <c>PageContainer title</c> / <c>subtitle</c> — the two parity strings) around the shared
/// <see cref="RegionSettings"/> component (web <c>&lt;RegionSettings /&gt;</c>). This port reproduces that shell
/// with the native shared-surfaces <see cref="PageContainer"/> over the native <see cref="RegionSettings"/>
/// surface, which owns the Tesla region / Fleet API card and its loading / empty / error / stale / offline /
/// populated states plus the Refresh action. The view is a thin renderer — the title + subtitle resolve in the
/// <see cref="TeslaRegionPageViewModel"/>; the hosted component owns all data flow. No HTTP touches this page;
/// every string resolves through the i18n facade.
/// </summary>
public sealed partial class TeslaRegionPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;

    private readonly TeslaRegionPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly RegionSettings _regionSettings;
    private bool _disposed;

    /// <summary>Creates the page over the default local-state region source and the shell resource localizer.</summary>
    public TeslaRegionPage()
        : this(EmptyRegionSettingsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit region source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The region data port the hosted component binds to (web <c>useTeslaUserRegion</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TeslaRegionPage(IRegionSettingsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaRegionPageViewModel(localizer);
        _regionSettings = new RegionSettings(source, localizer);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = _regionSettings,
        };

        IsTabStop = false;
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

        AutomationProperties.SetName(this, _viewModel.Title);

        Unloaded += OnUnloaded;
    }

    /// <summary>The deep-link route name this page registers under (web <c>/tesla-region</c>).</summary>
    public static string RouteName => TeslaRegionRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TeslaRegionPageViewModel ViewModel => _viewModel;

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Unloaded -= OnUnloaded;
        _regionSettings.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaRegionPageAutomationPeer(this);

    private sealed class TeslaRegionPageAutomationPeer(TeslaRegionPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
