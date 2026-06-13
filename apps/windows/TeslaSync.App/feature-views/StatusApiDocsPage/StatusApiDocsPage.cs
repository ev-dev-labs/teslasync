using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>StatusApiDocsPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/StatusApiDocsPage.tsx</c> (route <c>/docs/status-api</c>). It documents the
/// stable <c>/api/v1/status/*</c> contract self-hosted operators wire into Grafana / Uptime Kuma / Home Assistant,
/// and is intentionally static (web "Static content — no backend round-trip"). It binds a
/// <see cref="StatusApiDocsPageViewModel"/> and renders every web region with Fluent components and design tokens:
/// the shared <see cref="PageContainer"/> header (web <c>PageContainer title</c> / <c>subtitle</c>) with a
/// chromeless "Back to System Status" link in the actions slot (web the <c>ArrowLeft</c> link); the overview panel
/// (GlassPanel2 — the <c>Server</c>-headed framing block with two prose paragraphs and the amber additive-only
/// note); one endpoint card per documented endpoint (GlassPanel1 — the method badge, the code path, the optional
/// query hint, the description and an <see cref="TsAccordion"/> disclosure revealing the verbatim example JSON);
/// and the closing muted footer panel (GlassPanel3). The view is a thin renderer: all selection, formatting and
/// i18n happen in the view-model's <see cref="StatusApiDocsDisplay"/> projection. State changes are marshalled
/// onto the UI thread; the overview and footer panels are always visible and the endpoint region falls back to a
/// friendly empty surface (never a blank box, ADR-011).
/// </summary>
public sealed partial class StatusApiDocsPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;   // web layout gutter around the page chrome.
    private const double BodyMaxWidth = 768;     // web max-w-3xl.
    private const double SectionSpacing = 20;    // web space-y-5.
    private const double PanelPadding = 16;      // web p-4.
    private const double OverviewSpacing = 12;   // web space-y-3 / mt-3.
    private const double EndpointSpacing = 12;   // web space-y-3.

    private const string ServerGlyph = "\uEDA2"; // Segoe Fluent — Server (web Server).
    private const string CodeGlyph = "\uE943";   // Segoe Fluent — Code / Braces (web Code).
    private const string BackGlyph = "\uE72B";   // Segoe Fluent — Back (web ArrowLeft).

    private readonly StatusApiDocsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly ILocalizer _localizer;
    private bool _disposed;
    private bool _opened;

    private readonly PageContainer _container;

    private readonly StackPanel _body = new()
    {
        Spacing = SectionSpacing,
        MaxWidth = BodyMaxWidth,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly StackPanel _endpointsHost = new() { Spacing = SectionSpacing };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE7C3" };

    /// <summary>Creates the page over the shell resource localizer and the default endpoint catalog.</summary>
    public StatusApiDocsPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer (used by tests / dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The documented endpoint catalog (defaults to <see cref="StatusApiEndpointCatalog.Default"/>).</param>
    public StatusApiDocsPage(ILocalizer localizer, IReadOnlyList<StatusEndpoint>? catalog = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new StatusApiDocsPageViewModel(localizer, catalog);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            Actions = BuildBackLink(),
            PageContent = _body,
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

        AutomationProperties.SetName(_endpointsHost, RouteNameLabel());
        AutomationProperties.SetLandmarkType(_endpointsHost, AutomationLandmarkType.Main);

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the header back-link requests navigation to an internal app route (web <c>Link to</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>StatusApiDocsPage</c>).</summary>
    public static string Slug => StatusApiDocsRegistration.Slug;

    private TextBlock? _backLabel;

    private HyperlinkButton BuildBackLink()
    {
        var icon = new FontIcon { Glyph = BackGlyph, FontSize = 14, Foreground = DisplayTokens.TextSecondary };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _backLabel = new TextBlock
        {
            Text = _viewModel.BackLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var inner = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        inner.Children.Add(icon);
        inner.Children.Add(_backLabel);

        var link = new HyperlinkButton { Content = inner };
        link.Click += (_, _) => RaiseNavigation(StatusApiDocsRegistration.SystemStatusRoute);
        AutomationProperties.SetName(link, _viewModel.BackLabel);
        return link;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from the view-model and dispose the hosted container (CA1001; mirrors the sibling pages).</summary>
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
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
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

    private void Render(StatusApiDocsDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);
        if (_backLabel is not null)
        {
            _backLabel.Text = display.BackLabel;
        }

        _body.Children.Clear();
        _body.Children.Add(BuildOverviewPanel(display));
        _body.Children.Add(BuildEndpointsRegion(display));
        _body.Children.Add(BuildFooterPanel(display));
    }

    private static TsGlassPanel BuildOverviewPanel(StatusApiDocsDisplay display)
    {
        var headingIcon = new FontIcon
        {
            Glyph = ServerGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(headingIcon, AccessibilityView.Raw);

        var headingText = new TextBlock
        {
            Text = display.OverviewHeading,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        heading.Children.Add(headingIcon);
        heading.Children.Add(headingText);

        var stack = new StackPanel { Spacing = OverviewSpacing };
        stack.Children.Add(heading);

        foreach (var paragraph in display.OverviewParagraphs)
        {
            if (paragraph.IsNote)
            {
                stack.Children.Add(BuildOverviewNote(paragraph.Text));
            }
            else
            {
                stack.Children.Add(BuildOverviewParagraph(paragraph.Text));
            }
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static TextBlock BuildOverviewParagraph(string text) => new()
    {
        Text = text,
        FontSize = 14,
        TextWrapping = TextWrapping.Wrap,
        Foreground = DisplayTokens.TextSecondary,
    };

    private static StackPanel BuildOverviewNote(string text)
    {
        var amber = DisplayTokens.Brush("TsColorWarningBrush");

        var icon = new FontIcon
        {
            Glyph = CodeGlyph,
            FontSize = 14,
            Foreground = amber,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new TextBlock
        {
            Text = text,
            FontSize = 14,
            TextWrapping = TextWrapping.Wrap,
            Foreground = amber,
        };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var iconColumn = new Grid { VerticalAlignment = VerticalAlignment.Top };
        iconColumn.Children.Add(icon);
        row.Children.Add(iconColumn);
        row.Children.Add(body);
        return row;
    }

    private StackPanel BuildEndpointsRegion(StatusApiDocsDisplay display)
    {
        _endpointsHost.Children.Clear();

        if (display.State == StatusApiDocsState.Empty || display.Endpoints.Count == 0)
        {
            _emptyState.Message = _viewModel.EmptyMessage;
            _endpointsHost.Children.Add(_emptyState);
            return _endpointsHost;
        }

        foreach (var endpoint in display.Endpoints)
        {
            _endpointsHost.Children.Add(BuildEndpointPanel(endpoint, display.ExampleResponseLabel));
        }

        return _endpointsHost;
    }

    private static TsGlassPanel BuildEndpointPanel(StatusEndpointItem endpoint, string exampleLabel)
    {
        var stack = new StackPanel { Spacing = EndpointSpacing };

        // Header row: method badge + code path + optional query hint (web flex flex-wrap items-center gap-2).
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new TsBadge { Status = StatusKind.Info, Content = endpoint.Method, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(badge);

        var path = new TextBlock
        {
            Text = endpoint.Path,
            FontFamily = MonoFontFamily(),
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsChartSpeedBrush"),
            IsTextSelectionEnabled = true,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(path);

        if (!string.IsNullOrEmpty(endpoint.Query))
        {
            header.Children.Add(new TextBlock
            {
                Text = $"?{endpoint.Query}",
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        stack.Children.Add(header);

        stack.Children.Add(new TextBlock
        {
            Text = endpoint.Description,
            FontSize = 14,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextSecondary,
        });

        stack.Children.Add(BuildExampleDisclosure(endpoint, exampleLabel));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        AutomationProperties.SetName(panel, endpoint.AutomationName);
        return panel;
    }

    private static TsAccordion BuildExampleDisclosure(StatusEndpointItem endpoint, string exampleLabel)
    {
        var pre = new TextBlock
        {
            Text = endpoint.ExampleJson,
            FontFamily = MonoFontFamily(),
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };

        var preBorder = new Border
        {
            Background = DisplayTokens.Brush("TsColorSurfaceBrush"),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            Padding = new Thickness(12),
            Child = pre,
        };

        var preScroll = new ScrollViewer
        {
            Content = preBorder,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        var summary = new TextBlock
        {
            Text = exampleLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
        };

        var accordion = new TsAccordion { Header = summary, Content = preScroll };
        AutomationProperties.SetName(accordion, exampleLabel);
        return accordion;
    }

    private static TsGlassPanel BuildFooterPanel(StatusApiDocsDisplay display)
    {
        var text = new TextBlock
        {
            Text = display.Footer,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextMuted,
        };

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = text };
    }

    private string RouteNameLabel() => _localizer.GetString(StatusApiDocsProjection.TitleKey, "Status API");

    private void RaiseNavigation(string route) => NavigationRequested?.Invoke(this, route);

    private static FontFamily MonoFontFamily()
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue("TsTypeFontFamilyMono", out var value) &&
            value is FontFamily family)
        {
            return family;
        }

        return new FontFamily("Consolas");
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new StatusApiDocsPageAutomationPeer(this);

    private sealed class StatusApiDocsPageAutomationPeer(StatusApiDocsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
