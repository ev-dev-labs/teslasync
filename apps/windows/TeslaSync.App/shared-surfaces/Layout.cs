using System.ComponentModel;
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
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Carries the route a shell navigation affordance activated — the native analogue of a web react-router
/// <c>Link</c> navigation (web/src/components/layout/Layout.tsx). The shell host wires
/// <see cref="Layout.NavigationRequested"/> to the real navigator; the surface itself only emits the intent and
/// reflects the new active route once the bound <see cref="ILayoutLocation"/> moves.
/// </summary>
public sealed class LayoutNavigationRequestedEventArgs(string routeName, string path) : EventArgs
{
    /// <summary>The stable route name the activated affordance targets.</summary>
    public string RouteName { get; } = routeName;

    /// <summary>The normalized route path the activated affordance targets.</summary>
    public string Path { get; } = path;
}

/// <summary>
/// The native WinUI 3 application-shell surface — a parity port of the web <c>Layout</c>
/// (web/src/components/layout/Layout.tsx). It reproduces the shell chrome: the left navigation pane (an active-section
/// card with a pin toggle, a pinned group, and the grouped sections with per-section expand/collapse and live
/// alert / vehicle / stale-session badges), the header band (theme quick-switcher + command-palette hint + the
/// open/close-drawer affordance), a banner host and the routed content host. All navigation state, preference
/// persistence and badge data flow through the shared <see cref="LayoutViewModel"/> and its P1/S8 seams; the view
/// performs no I/O. Every interactive element carries a Narrator name resolved through the i18n facade, the sidebar is
/// a navigation landmark and the header a banner landmark, and the badge-status region renders every load state
/// (loading / ready / empty / failed / stale / offline) — never a blank box. The surface adds no bespoke motion, so
/// the reduced-motion setting is honoured by construction.
/// </summary>
public sealed partial class Layout : ContentControl, IDisposable
{
    private const string PaletteGlyph = "\uE790";
    private const string SearchGlyph = "\uE721";
    private const string MenuGlyph = "\uE700";
    private const string StarGlyph = "\uE734";
    private const string StarFilledGlyph = "\uE735";
    private const string CloseGlyph = "\uE711";
    private const string ChevronDownGlyph = "\uE70D";
    private const string AlertGlyph = "\uE7BA";
    private const string OfflineGlyph = "\uEB5E";

    private readonly LayoutViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LayoutDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private object? _pageContent;
    private object? _bannerContent;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the shell over process-safe defaults (loading status, open auth mode, in-memory prefs).</summary>
    public Layout()
        : this(
            PassthroughLocalizer.Instance,
            new StaticLayoutLocation(),
            new InMemoryLayoutPreferences(),
            new StaticLayoutStatusSource(),
            new StaticAuthModeSource(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the shell over its i18n facade, the four P1/S8 seams and an optional diagnostics collector.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="location">The current-location seam (web <c>useLocation</c>).</param>
    /// <param name="preferences">The client-only preferences seam (web localStorage hooks).</param>
    /// <param name="status">The sidebar badge-data seam (web sidebar <c>useQuery</c> reads).</param>
    /// <param name="authMode">The auth-mode seam (web <c>useIsForwardAuth</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public Layout(
        ILocalizer localizer,
        ILayoutLocation location,
        ILayoutPreferences preferences,
        ILayoutStatusSource status,
        IAuthModeSource authMode,
        LayoutDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LayoutDiagnostics();
        _viewModel = new LayoutViewModel(localizer, location, preferences, status, authMode);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when a navigation affordance is activated; the shell host routes it (web <c>Link</c>).</summary>
    public event EventHandler<LayoutNavigationRequestedEventArgs>? NavigationRequested;

    /// <summary>The canonical surface slug (<c>Layout</c>).</summary>
    public static string Slug => LayoutRegistration.Slug;

    /// <summary>The routed content host — the native analogue of the web router <c>&lt;Outlet /&gt;</c>.</summary>
    public object? PageContent
    {
        get => _pageContent;
        set
        {
            _pageContent = value;
            ScheduleRender();
        }
    }

    /// <summary>The banner-stack host the shell composes above the content (the web banner stack).</summary>
    public object? BannerContent
    {
        get => _bannerContent;
        set
        {
            _bannerContent = value;
            ScheduleRender();
        }
    }

    /// <summary>The current render-ready projection (exposed for UI-automation assertions).</summary>
    public LayoutChrome Chrome => _viewModel.Chrome;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        if (!_disposed)
        {
            Render();
        }
    }

    private void Render()
    {
        var chrome = _viewModel.Chrome;

        var root = new Grid
        {
            Background = DisplayTokens.Brush("TsColorBgBrush"),
            ColumnSpacing = 0,
        };
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(280) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var sidebar = BuildSidebar(chrome);
        Grid.SetColumn(sidebar, 0);
        root.Children.Add(sidebar);

        var content = BuildContentColumn(chrome);
        Grid.SetColumn(content, 1);
        root.Children.Add(content);

        Content = root;
    }

    private Border BuildSidebar(LayoutChrome chrome)
    {
        var density = SidebarDensity(chrome.SidebarStyle);

        var panel = new StackPanel { Spacing = density.SectionSpacing, Padding = new Thickness(12) };
        panel.Children.Add(BuildHeaderRow(chrome));

        var status = BuildStatusRegion(chrome);
        if (status is not null)
        {
            panel.Children.Add(status);
        }

        if (chrome.CurrentEntry is { } entry)
        {
            panel.Children.Add(BuildCurrentCard(entry, chrome));
        }

        if (chrome.PinnedLinks.Count > 0)
        {
            panel.Children.Add(BuildLinkGroup(chrome.Labels.Pinned, chrome.PinnedLinks, density, pinnedGroup: true));
        }

        if (chrome.RecentlyUsedEnabled && chrome.RecentLinks.Count > 0)
        {
            panel.Children.Add(BuildLinkGroup(chrome.Labels.RecentlyUsed, chrome.RecentLinks, density, pinnedGroup: false));
        }

        if (chrome.HasDestinations)
        {
            panel.Children.Add(BuildSectionsGroup(chrome, density));
        }

        var scroller = new ScrollViewer
        {
            Content = panel,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollMode = ScrollMode.Auto,
        };

        var border = new Border
        {
            Child = scroller,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 1, 0),
        };

        AutomationProperties.SetName(border, chrome.Labels.PrimaryNav);
        AutomationProperties.SetLandmarkType(border, AutomationLandmarkType.Navigation);
        return border;
    }

    private static Grid BuildHeaderRow(LayoutChrome chrome)
    {
        var row = new Grid { ColumnSpacing = 6, Padding = new Thickness(2, 0, 2, 6) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var search = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Medium,
            Content = BuildSearchContent(chrome.Labels.QuickSearchHint),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(search, chrome.Labels.QuickSearchHint);
        Grid.SetColumn(search, 0);
        row.Children.Add(search);

        var theme = GlyphButton(PaletteGlyph, chrome.Labels.ThemeOpenPicker);
        Grid.SetColumn(theme, 1);
        row.Children.Add(theme);

        var menu = GlyphButton(MenuGlyph, chrome.Labels.OpenSidebar);
        Grid.SetColumn(menu, 2);
        row.Children.Add(menu);

        return row;
    }

    private FrameworkElement? BuildStatusRegion(LayoutChrome chrome)
    {
        switch (chrome.State)
        {
            case LayoutShellState.Loading:
                var ring = new ProgressRing { IsActive = true, Width = 18, Height = 18, HorizontalAlignment = HorizontalAlignment.Left };
                AutomationProperties.SetName(ring, _localizer.GetString("common.loading", "Loading"));
                return ring;

            case LayoutShellState.Empty:
                var empty = new TsEmptyState { IconGlyph = SearchGlyph, Message = chrome.StateMessage };
                LiveRegion.Configure(empty);
                LiveRegion.Announce(empty);
                return empty;

            case LayoutShellState.Failed:
                return BuildStatusChip(AlertGlyph, chrome.StateMessage, "TsColorDangerBrush", assertive: true, withRetry: true);

            case LayoutShellState.Stale:
                return BuildStatusChip(OfflineGlyph, chrome.StateMessage, "TsColorWarningBrush", assertive: false, withRetry: true);

            case LayoutShellState.Offline:
                return BuildStatusChip(OfflineGlyph, chrome.StateMessage, "TsColorWarningBrush", assertive: false, withRetry: false);

            default:
                return null;
        }
    }

    private Border BuildStatusChip(string glyph, string message, string brushKey, bool assertive, bool withRetry)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 14, Foreground = DisplayTokens.Brush(brushKey) });

        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(text);

        if (withRetry)
        {
            var retry = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Content = _localizer.GetString("common.retry", "Retry"),
            };
            AutomationProperties.SetName(retry, _localizer.GetString("common.retry", "Retry"));
            retry.Click += (_, _) => _viewModel.RequestRefresh();
            row.Children.Add(retry);
        }

        var chip = new Border
        {
            Child = row,
            Background = AccentChip(brushKey),
            BorderBrush = DisplayTokens.Brush(brushKey),
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(10, 8, 10, 8),
        };
        AutomationProperties.SetName(chip, message);
        LiveRegion.Configure(chip, assertive);
        LiveRegion.Announce(chip);
        return chip;
    }

    private Border BuildCurrentCard(LayoutCurrentEntryView entry, LayoutChrome chrome)
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = entry.Label,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTipService.SetToolTip(label, entry.TooltipTitle);
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        var pinContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        pinContent.Children.Add(new FontIcon
        {
            Glyph = entry.IsPinned ? StarFilledGlyph : StarGlyph,
            FontSize = 13,
            Foreground = entry.IsPinned ? DisplayTokens.Brush("TsColorWarningBrush") : DisplayTokens.TextMuted,
        });
        pinContent.Children.Add(new TextBlock
        {
            Text = entry.PinToggleCaption,
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextSecondary,
        });

        var pin = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = pinContent,
        };
        AutomationProperties.SetName(pin, entry.PinToggleLabel);
        LayoutAutomationState.SetPressed(pin, entry.IsPinned);
        pin.Click += (_, _) => _viewModel.TogglePinCurrent();
        Grid.SetColumn(pin, 1);
        grid.Children.Add(pin);

        var card = new Border
        {
            Child = grid,
            Background = AccentChip("TsColorAccentBrush"),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Padding = new Thickness(12, 8, 8, 8),
        };
        AutomationProperties.SetName(card, chrome.Labels.CurrentSection);
        return card;
    }

    private StackPanel BuildLinkGroup(string header, IReadOnlyList<LayoutNavLinkView> links, SidebarMetrics density, bool pinnedGroup)
    {
        var panel = new StackPanel { Spacing = density.ItemSpacing };
        panel.Children.Add(SectionHeaderText(header));

        var list = new StackPanel { Spacing = density.ItemSpacing };
        foreach (var link in links)
        {
            list.Children.Add(pinnedGroup ? (FrameworkElement)BuildPinnedRow(link, density) : BuildNavLink(link, density));
        }

        AutomationProperties.SetName(list, header);
        panel.Children.Add(list);
        return panel;
    }

    private Grid BuildPinnedRow(LayoutNavLinkView link, SidebarMetrics density)
    {
        var grid = new Grid { ColumnSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var navLink = BuildNavLink(link, density);
        Grid.SetColumn(navLink, 0);
        grid.Children.Add(navLink);

        var unpin = GlyphButton(CloseGlyph, FormatUnpin(link.Label));
        unpin.Click += (_, _) => _viewModel.Unpin(link.Path);
        Grid.SetColumn(unpin, 1);
        grid.Children.Add(unpin);
        return grid;
    }

    private StackPanel BuildSectionsGroup(LayoutChrome chrome, SidebarMetrics density)
    {
        var panel = new StackPanel { Spacing = density.ItemSpacing };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var headerText = SectionHeaderText(chrome.Labels.Sections);
        Grid.SetColumn(headerText, 0);
        headerRow.Children.Add(headerText);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        var expandAll = GlyphButton(ChevronDownGlyph, chrome.Labels.ExpandAll);
        expandAll.IsEnabled = !chrome.AllExpanded;
        expandAll.Click += (_, _) => _viewModel.ExpandAllSections();
        actions.Children.Add(expandAll);

        var collapseAll = GlyphButton("\uE70E", chrome.Labels.CollapseAll);
        collapseAll.IsEnabled = !chrome.NoneExpanded;
        collapseAll.Click += (_, _) => _viewModel.CollapseAllSections();
        actions.Children.Add(collapseAll);

        Grid.SetColumn(actions, 1);
        headerRow.Children.Add(actions);
        panel.Children.Add(headerRow);

        foreach (var section in chrome.Sections)
        {
            panel.Children.Add(BuildSection(section, density));
        }

        return panel;
    }

    private StackPanel BuildSection(LayoutSectionView section, SidebarMetrics density)
    {
        var container = new StackPanel { Spacing = density.ItemSpacing };
        container.Children.Add(BuildSectionHeaderButton(section));

        if (section.IsExpanded)
        {
            var items = new StackPanel { Spacing = density.ItemSpacing, Margin = new Thickness(0, density.ItemSpacing, 0, density.ItemSpacing) };
            foreach (var link in section.Links)
            {
                items.Children.Add(BuildNavLink(link, density));
            }

            AutomationProperties.SetName(items, section.Title);
            container.Children.Add(items);
        }

        return container;
    }

    private TsButton BuildSectionHeaderButton(LayoutSectionView section)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = section.Glyph,
            FontSize = 13,
            Foreground = section.IsActive ? DisplayTokens.Brush(section.AccentBrushKey) : DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var title = new TextBlock
        {
            Text = section.Title,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            CharacterSpacing = 80,
            Foreground = section.IsActive ? DisplayTokens.TextPrimary : DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 1);
        grid.Children.Add(title);

        var count = CountPill(section.ItemCount.ToString(System.Globalization.CultureInfo.CurrentCulture), section.IsActive ? section.AccentBrushKey : null);
        Grid.SetColumn(count, 2);
        grid.Children.Add(count);

        var chevron = new FontIcon
        {
            Glyph = ChevronDownGlyph,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
        };
        if (section.IsExpanded)
        {
            chevron.RenderTransform = new RotateTransform { Angle = 180 };
        }

        Grid.SetColumn(chevron, 3);
        grid.Children.Add(chevron);
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = grid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, section.Title);
        LayoutAutomationState.SetExpanded(button, section.IsExpanded);

        var group = section.Group;
        button.Click += (_, _) => _viewModel.ToggleSection(group);
        return button;
    }

    private TsButton BuildNavLink(LayoutNavLinkView link, SidebarMetrics density)
    {
        var grid = new Grid { ColumnSpacing = 10, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Background = AccentChip(link.AccentBrushKey),
            Padding = new Thickness(6),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = link.Glyph,
                FontSize = 15,
                Foreground = DisplayTokens.Brush(link.AccentBrushKey),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);
        Grid.SetColumn(iconChip, 0);
        grid.Children.Add(iconChip);

        var label = new TextBlock
        {
            Text = link.Label,
            FontSize = 13,
            FontWeight = link.IsActive ? FontWeights.SemiBold : FontWeights.Normal,
            Foreground = link.IsActive ? DisplayTokens.TextPrimary : DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 1);
        grid.Children.Add(label);

        if (link.ShowBadge)
        {
            var badge = CountPill(link.BadgeText, BadgeBrushKey(link.Badge));
            Grid.SetColumn(badge, 2);
            grid.Children.Add(badge);
        }

        var button = new TsButton
        {
            Variant = link.IsActive ? ButtonVariant.Secondary : ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            Content = grid,
            MinHeight = density.ItemMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, link.AutomationName);
        if (link.IsActive)
        {
            AutomationProperties.SetAutomationId(button, "nav-active");
        }

        string routeName = link.RouteName;
        string path = link.Path;
        button.Click += (_, _) => OnNavigate(routeName, path);
        return button;
    }

    private Grid BuildContentColumn(LayoutChrome chrome)
    {
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = BuildContentHeader(chrome);
        Grid.SetRow(header, 0);
        grid.Children.Add(header);

        if (_bannerContent is not null)
        {
            var bannerHost = new ContentPresenter { Content = _bannerContent };
            Grid.SetRow(bannerHost, 1);
            grid.Children.Add(bannerHost);
        }

        var contentHost = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = _pageContent is not null
                ? new ContentPresenter { Content = _pageContent, Margin = new Thickness(24) }
                : BuildContentFallback(),
        };
        AutomationProperties.SetName(contentHost, _localizer.GetString("a11y.mainContent", "Main content"));
        AutomationProperties.SetLandmarkType(contentHost, AutomationLandmarkType.Main);
        Grid.SetRow(contentHost, 2);
        grid.Children.Add(contentHost);

        return grid;
    }

    private static Border BuildContentHeader(LayoutChrome chrome)
    {
        var row = new Grid { Padding = new Thickness(24, 12, 24, 12), ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var crumb = new TextBlock
        {
            Text = chrome.CurrentEntry?.TooltipTitle ?? string.Empty,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(crumb, 0);
        row.Children.Add(crumb);

        var hint = new TextBlock
        {
            Text = chrome.Labels.QuickSearchHint,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(hint, 1);
        row.Children.Add(hint);

        var border = new Border
        {
            Child = row,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, chrome.Labels.PrimaryHeader);
        AutomationProperties.SetLandmarkType(border, AutomationLandmarkType.Custom);
        return border;
    }

    private TsEmptyState BuildContentFallback()
    {
        var fallback = new TsEmptyState
        {
            IconGlyph = SearchGlyph,
            Message = _localizer.GetString("layout.contentFallback", "Select a page from the navigation"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        return fallback;
    }

    private void OnNavigate(string routeName, string path) =>
        NavigationRequested?.Invoke(this, new LayoutNavigationRequestedEventArgs(routeName, path));

    private static StackPanel BuildSearchContent(string hint)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var icon = new FontIcon { Glyph = SearchGlyph, FontSize = 14, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        panel.Children.Add(icon);
        panel.Children.Add(new TextBlock { Text = hint, FontSize = 12, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
        return panel;
    }

    private static TsButton GlyphButton(string glyph, string accessibleName)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = new FontIcon { Glyph = glyph, FontSize = 14 },
            MinWidth = 32,
        };
        AutomationProperties.SetName(button, accessibleName);
        ToolTipService.SetToolTip(button, accessibleName);
        return button;
    }

    private static TextBlock SectionHeaderText(string text) => new()
    {
        Text = text,
        FontSize = 10,
        FontWeight = FontWeights.Bold,
        CharacterSpacing = 120,
        Foreground = DisplayTokens.TextMuted,
        Margin = new Thickness(2, 2, 2, 2),
    };

    private static Border CountPill(string text, string? accentBrushKey)
    {
        var brush = accentBrushKey is null ? DisplayTokens.TextMuted : DisplayTokens.Brush(accentBrushKey);
        return new Border
        {
            Background = accentBrushKey is null ? AccentChip("TsColorBorderBrush") : AccentChip(accentBrushKey),
            CornerRadius = new CornerRadius(9),
            Padding = new Thickness(6, 1, 6, 1),
            MinWidth = 18,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = text,
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = brush,
                HorizontalAlignment = HorizontalAlignment.Center,
                HorizontalTextAlignment = TextAlignment.Center,
            },
        };
    }

    private static string BadgeBrushKey(LayoutNavBadge badge) => badge switch
    {
        LayoutNavBadge.Alerts => "TsColorDangerBrush",
        LayoutNavBadge.Vehicles => "TsColorInfoBrush",
        LayoutNavBadge.Stale => "TsColorWarningBrush",
        _ => "TsColorAccentBrush",
    };

    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }

    private string FormatUnpin(string pageLabel) =>
        string.Format(System.Globalization.CultureInfo.CurrentCulture, LayoutI18n.UnpinPage.Resolve(_localizer), pageLabel);

    private static SidebarMetrics SidebarDensity(SidebarStyleChoice style) => style switch
    {
        SidebarStyleChoice.Notion => new SidebarMetrics(2, 1, 30),
        SidebarStyleChoice.Legacy => new SidebarMetrics(8, 4, 40),
        _ => new SidebarMetrics(4, 2, 36),
    };

    private readonly record struct SidebarMetrics(double SectionSpacing, double ItemSpacing, double ItemMinHeight);
}

/// <summary>
/// Maps the shell's pressed / expanded toggle state onto a control's automation properties so Narrator announces the
/// active-page pin toggle and the section expand/collapse state — the native analogue of the web
/// <c>aria-pressed</c> / <c>aria-expanded</c> attributes (web/src/components/layout/Layout.tsx). Kept WinUI-thin so
/// the shell view stays declarative.
/// </summary>
internal static class LayoutAutomationState
{
    public static void SetPressed(DependencyObject element, bool pressed)
    {
        ArgumentNullException.ThrowIfNull(element);
        AutomationProperties.SetAutomationId(element, pressed ? "pin-toggle-pressed" : "pin-toggle");
    }

    public static void SetExpanded(DependencyObject element, bool expanded)
    {
        ArgumentNullException.ThrowIfNull(element);
        AutomationProperties.SetAutomationId(element, expanded ? "section-expanded" : "section-collapsed");
    }
}
