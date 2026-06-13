using System.Net.Http;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>DevToolsPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/DevToolsPage.tsx</c> (route <c>/dev-tools</c>). The web page is a thin shell:
/// a <see cref="PageContainer"/> header (web <c>PageContainer title</c> / <c>subtitle</c> — the two parity
/// strings) over a five-tab navigator (web <c>TabNav</c>) that swaps between the developer sections in the same
/// order (Fleet API → Telemetry → Infrastructure → Utilities → Reference). This port reproduces that shell with a
/// Fluent <see cref="TabView"/> and mounts each tab's real section surface on demand: the Fleet API onboarding
/// wizard + tool grid (<see cref="DevToolsFleetApiSection"/>), the Fleet Telemetry health surface, the backend
/// Infrastructure tools, the client Utilities catalog and the Tesla Fleet API Reference links. The data-backed
/// sections bind through the shared data layer; with no reachable origin they render their own honest loading /
/// empty / error states. The view is a thin renderer — title, subtitle and tab labels resolve in the
/// <see cref="DevToolsPageViewModel"/>; selection and i18n drive the rest.
/// </summary>
public sealed partial class DevToolsPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;

    private readonly ILocalizer _localizer;
    private readonly DevToolsPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly TabView _tabs;
    private readonly List<IDisposable> _sections = new();

    private HttpClient? _http;
    private IApiClient? _apiClient;
    private CacheThenNetworkEngine? _engine;
    private ApiClientOptions? _options;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the page over the shell resource localizer.</summary>
    public DevToolsPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer (used by tests and dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DevToolsPage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new DevToolsPageViewModel(localizer);

        _tabs = new TsTabs { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var tab in _viewModel.Tabs)
        {
            _tabs.TabItems.Add(new TabViewItem
            {
                Header = BuildTabHeader(tab),
                IsClosable = false,
                Tag = tab.Key,
            });
        }

        _tabs.SelectedIndex = IndexOf(DevToolsCatalog.DefaultTab);
        _tabs.SelectionChanged += OnTabSelectionChanged;

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = _tabs,
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

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        MountSelected();
    }

    /// <summary>The deep-link route name this page registers under (web <c>/dev-tools</c>).</summary>
    public static string RouteName => "DevTools";

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        MountSelected();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _tabs.SelectionChanged -= OnTabSelectionChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        foreach (var section in _sections)
        {
            section.Dispose();
        }

        _sections.Clear();
        _container.Dispose();
        _http?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e) => MountSelected();

    private void MountSelected()
    {
        if (_disposed || _tabs.SelectedItem is not TabViewItem item || item.Content is not null)
        {
            return;
        }

        if (item.Tag is not DevToolsTabKey key)
        {
            return;
        }

        var section = BuildSection(key);
        if (section is IDisposable disposable)
        {
            _sections.Add(disposable);
        }

        item.Content = new ScrollViewer
        {
            Content = section,
            Padding = new Thickness(0, ContentPadding, 0, 0),
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private FrameworkElement BuildSection(DevToolsTabKey key) => key switch
    {
        DevToolsTabKey.FleetApi => new DevToolsFleetApiSection(_localizer),
        DevToolsTabKey.Telemetry => FleetTelemetryHealth.Create(ApiClient(), Engine(), Options(), _localizer),
        DevToolsTabKey.Infrastructure => Infrastructure.InfrastructureSection.Create(ApiClient(), _localizer),
        DevToolsTabKey.Utilities => ClientUtilities.ClientUtilitiesSection.Create(_localizer),
        _ => new ReferenceLinksSection(_localizer),
    };

    private IApiClient ApiClient()
    {
        if (_apiClient is not null)
        {
            return _apiClient;
        }

        _options = new ApiClientOptions();
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        _apiClient = new GeneratedApiClient(_http, _options);
        return _apiClient;
    }

    private CacheThenNetworkEngine Engine() => _engine ??= new CacheThenNetworkEngine(new DevToolsMemoryCacheStore());

    private ApiClientOptions Options()
    {
        _ = ApiClient();
        return _options!;
    }

    private int IndexOf(DevToolsTabKey key)
    {
        for (int i = 0; i < _viewModel.Tabs.Count; i++)
        {
            if (_viewModel.Tabs[i].Key == key)
            {
                return i;
            }
        }

        return 0;
    }

    private StackPanel BuildTabHeader(DevToolsTab tab)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon { Glyph = tab.Glyph, FontSize = 16 };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        header.Children.Add(icon);

        header.Children.Add(new TextBlock
        {
            Text = _viewModel.Label(tab),
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return header;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DevToolsPageAutomationPeer(this);

    private sealed class DevToolsPageAutomationPeer(DevToolsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
