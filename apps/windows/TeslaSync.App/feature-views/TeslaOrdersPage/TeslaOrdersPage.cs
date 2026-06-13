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
/// The native WinUI 3 <c>TeslaOrdersPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/TeslaOrdersPage.tsx</c> (route <c>/tesla-orders</c>, nav name
/// <c>TeslaOrders</c>). The web page is a thin wrapper: a <see cref="PageContainer"/> header (web
/// <c>PageContainer title</c> / <c>subtitle</c> — the two parity strings) around the shared
/// <see cref="ActiveOrdersSection"/> (web <c>&lt;ActiveOrdersSection /&gt;</c>). This port reproduces that shell
/// with the native shared-surfaces <see cref="PageContainer"/> over the native <see cref="ActiveOrdersSection"/>
/// surface, which owns every order card and its loading / empty / error / populated states. The view is a thin
/// renderer — the title + subtitle resolve in the <see cref="TeslaOrdersPageViewModel"/>; the hosted section owns
/// all data flow. No HTTP touches this page; every string resolves through the i18n facade.
/// </summary>
public sealed partial class TeslaOrdersPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;

    private readonly TeslaOrdersPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly ActiveOrdersSection _ordersSection;
    private bool _disposed;

    /// <summary>Creates the page over the default local-state orders source and the shell resource localizer.</summary>
    public TeslaOrdersPage()
        : this(EmptyActiveOrdersSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit orders source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The active-orders data port the hosted section binds to (web <c>useTeslaUserOrders</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TeslaOrdersPage(IActiveOrdersSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaOrdersPageViewModel(localizer);
        _ordersSection = new ActiveOrdersSection(source, localizer);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = _ordersSection,
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

    /// <summary>The deep-link route name this page registers under (web <c>/tesla-orders</c>).</summary>
    public static string RouteName => TeslaOrdersRegistration.RouteName;

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
        _ordersSection.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaOrdersPageAutomationPeer(this);

    private sealed class TeslaOrdersPageAutomationPeer(TeslaOrdersPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
