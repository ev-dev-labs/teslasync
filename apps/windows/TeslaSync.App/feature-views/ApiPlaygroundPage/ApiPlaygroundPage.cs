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

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>ApiPlaygroundPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/ApiPlaygroundPage.tsx</c> (route <c>/api-playground</c>). It lets a self-hosted
/// operator explore the TeslaSync API surface: a two-panel layout under the shared <see cref="PageContainer"/>
/// header (web <c>PageContainer title</c> / <c>subtitle</c>). The left panel (GlassPanel1 — web the <c>w-72</c>
/// sidebar) hosts a search box and the tag-grouped, selectable endpoint list, rendering a Fluent skeleton while the
/// catalog resolves (web the sidebar <c>Skeleton</c> rows), an inline error surface with retry on failure, and a
/// friendly empty surface when nothing matches (never a blank region, ADR-011). The right panel (GlassPanel2 — web
/// the main panel) shows the "select an endpoint" prompt with the available-endpoint count when no row is selected
/// (web the <c>BookOpen</c> empty state + <c>playground.endpointCount</c>) and the selected endpoint's detail
/// (method, path, summary, description and parameters) once a row is chosen. The view is a thin renderer: all
/// filtering, selection, formatting and i18n happen in the <see cref="ApiPlaygroundPageViewModel"/>'s
/// <see cref="ApiPlaygroundDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ApiPlaygroundPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;   // web layout gutter around the page chrome.
    private const double SidebarWidth = 288;     // web w-72.
    private const double ColumnSpacing = 16;     // web gap-4.
    private const double MinBodyHeight = 600;    // web min-h-[600px].
    private const double PanelPadding = 12;      // web sidebar padding.
    private const double MainPadding = 24;       // web main panel p-8 (compacted to Fluent rhythm).
    private const double SidebarSpacing = 12;    // web sidebar vertical rhythm.
    private const double DetailSpacing = 12;     // web request-builder vertical rhythm.

    private const string BookGlyph = "\uE82D";   // Segoe Fluent — Library / book (web BookOpen).
    private const string TagGlyph = "\uE8EC";    // Segoe Fluent — Tag.

    private readonly ApiPlaygroundPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly ILocalizer _localizer;
    private bool _disposed;
    private bool _opened;

    private readonly PageContainer _container;

    private readonly TsInput _searchBox = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly StackPanel _sidebarColumn = new() { Spacing = SidebarSpacing };
    private readonly StackPanel _sidebarListHost = new() { Spacing = 4 };
    private readonly StackPanel _mainHost = new() { Spacing = DetailSpacing };
    private readonly TsGlassPanel _sidebarPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly TsGlassPanel _mainPanel = new() { Padding = new Thickness(MainPadding) };

    /// <summary>Creates the page over the shell resource localizer and the default endpoint catalog feed.</summary>
    public ApiPlaygroundPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer / feed (used by tests and dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="feed">The endpoint-catalog feed (defaults to <see cref="CatalogApiPlaygroundFeed.Instance"/>).</param>
    public ApiPlaygroundPage(ILocalizer localizer, IApiPlaygroundFeed? feed = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new ApiPlaygroundPageViewModel(feed, localizer);

        _searchBox.TextChanged += OnSearchChanged;

        var listScroll = new ScrollViewer
        {
            Content = _sidebarListHost,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        _sidebarColumn.Children.Add(_searchBox);
        _sidebarColumn.Children.Add(listScroll);
        _sidebarPanel.Content = _sidebarColumn;
        _mainPanel.Content = _mainHost;

        var body = new Grid { ColumnSpacing = ColumnSpacing, MinHeight = MinBodyHeight };
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SidebarWidth) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_sidebarPanel, 0);
        Grid.SetColumn(_mainPanel, 1);
        body.Children.Add(_sidebarPanel);
        body.Children.Add(_mainPanel);

        AutomationProperties.SetName(_sidebarPanel, _viewModel.Title);
        AutomationProperties.SetLandmarkType(_sidebarPanel, AutomationLandmarkType.Navigation);
        AutomationProperties.SetLandmarkType(_mainPanel, AutomationLandmarkType.Main);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            PageContent = body,
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

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ApiPlaygroundPage</c>).</summary>
    public static string Slug => ApiPlaygroundRegistration.Slug;

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
        _searchBox.TextChanged -= OnSearchChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e) => _viewModel.SetQuery(_searchBox.Text);

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

    private void Render(ApiPlaygroundDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);
        AutomationProperties.SetName(_sidebarPanel, display.Title);

        _searchBox.PlaceholderText = display.SearchHint; // parity:allow PlaceholderText is the WinUI input hint API
        _searchBox.Visibility = display.State is ApiPlaygroundState.Success or ApiPlaygroundState.Empty
            ? Visibility.Visible
            : Visibility.Collapsed;

        RenderSidebar(display);
        RenderMain(display);
    }

    private void RenderSidebar(ApiPlaygroundDisplay display)
    {
        _sidebarListHost.Children.Clear();

        switch (display.State)
        {
            case ApiPlaygroundState.Loading:
                _sidebarListHost.Children.Add(BuildSkeleton());
                return;

            case ApiPlaygroundState.Error:
                _sidebarListHost.Children.Add(BuildError(display));
                return;

            case ApiPlaygroundState.Empty:
                _sidebarListHost.Children.Add(new TsEmptyState { Message = display.SidebarEmptyMessage });
                return;

            default:
                foreach (var group in display.Groups)
                {
                    _sidebarListHost.Children.Add(BuildGroupHeader(group.Tag));
                    foreach (var endpoint in group.Endpoints)
                    {
                        _sidebarListHost.Children.Add(BuildEndpointRow(endpoint));
                    }
                }

                return;
        }
    }

    private void RenderMain(ApiPlaygroundDisplay display)
    {
        _mainHost.Children.Clear();

        if (display.SelectedDetail is { } detail)
        {
            BuildDetail(_mainHost, detail);
            return;
        }

        var prompt = new TsEmptyState
        {
            IconGlyph = BookGlyph,
            Message = display.SelectEndpointMessage,
        };
        _mainHost.Children.Add(prompt);

        if (display.EndpointCountLabel is { Length: > 0 } countLabel)
        {
            _mainHost.Children.Add(new TextBlock
            {
                Text = countLabel,
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
        }
    }

    private static StackPanel BuildSkeleton()
    {
        var column = new StackPanel { Spacing = 8 };
        for (var i = 0; i < 10; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 24, Radius = 6 });
        }

        AutomationProperties.SetAccessibilityView(column, AccessibilityView.Raw);
        return column;
    }

    private TsErrorDisplay BuildError(ApiPlaygroundDisplay display)
    {
        var error = new TsErrorDisplay
        {
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private static TextBlock BuildGroupHeader(string tag) => new()
    {
        Text = tag,
        FontSize = 11,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.TextMuted,
        Margin = new Thickness(4, 10, 0, 2),
    };

    private TsButton BuildEndpointRow(ApiEndpointItem endpoint)
    {
        var badge = new TsBadge
        {
            Status = endpoint.MethodStatus,
            Content = endpoint.Method,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var path = new TextBlock
        {
            Text = endpoint.Path,
            FontFamily = MonoFontFamily(),
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(badge);
        row.Children.Add(path);

        var button = new TsButton
        {
            Variant = endpoint.IsSelected ? ButtonVariant.Secondary : ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = row,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
        };

        AutomationProperties.SetName(button, endpoint.AutomationName);
        if (!string.IsNullOrEmpty(endpoint.Summary))
        {
            ToolTipService.SetToolTip(button, endpoint.Summary);
        }

        var id = endpoint.Id;
        button.Click += (_, _) => _viewModel.SelectEndpoint(id);
        return button;
    }

    private void BuildDetail(StackPanel host, ApiEndpointDetail detail)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(new TsBadge
        {
            Status = detail.MethodStatus,
            Content = detail.Method,
            VerticalAlignment = VerticalAlignment.Center,
        });
        header.Children.Add(new TextBlock
        {
            Text = detail.Path,
            FontFamily = MonoFontFamily(),
            FontSize = 16,
            Foreground = DisplayTokens.TextPrimary,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        });
        host.Children.Add(header);

        var tagRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var tagIcon = new FontIcon { Glyph = TagGlyph, FontSize = 12, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(tagIcon, AccessibilityView.Raw);
        tagRow.Children.Add(tagIcon);
        tagRow.Children.Add(new TextBlock
        {
            Text = detail.Tag,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        host.Children.Add(tagRow);

        if (!string.IsNullOrEmpty(detail.Summary))
        {
            host.Children.Add(new TextBlock
            {
                Text = detail.Summary,
                FontSize = 14,
                FontWeight = FontWeights.SemiBold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.TextPrimary,
            });
        }

        if (!string.IsNullOrEmpty(detail.Description))
        {
            host.Children.Add(new TextBlock
            {
                Text = detail.Description,
                FontSize = 14,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.TextSecondary,
            });
        }

        foreach (var section in detail.ParameterSections)
        {
            host.Children.Add(BuildParameterSection(section));
        }

        AutomationProperties.SetName(_mainPanel, detail.AutomationName);
    }

    private static StackPanel BuildParameterSection(ApiEndpointParamSection section)
    {
        var column = new StackPanel { Spacing = 6, Margin = new Thickness(0, 4, 0, 0) };
        column.Children.Add(new TextBlock
        {
            Text = section.Heading,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextSecondary,
        });

        foreach (var parameter in section.Items)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
            };
            row.Children.Add(new TextBlock
            {
                Text = parameter.Name,
                FontFamily = MonoFontFamily(),
                FontSize = 13,
                Foreground = DisplayTokens.TextPrimary,
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new TextBlock
            {
                Text = parameter.Type,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new TsBadge
            {
                Status = parameter.Required ? StatusKind.Warning : StatusKind.Neutral,
                Content = parameter.RequirementLabel,
                VerticalAlignment = VerticalAlignment.Center,
            });
            column.Children.Add(row);
        }

        return column;
    }

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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ApiPlaygroundPageAutomationPeer(this);

    private sealed class ApiPlaygroundPageAutomationPeer(ApiPlaygroundPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
