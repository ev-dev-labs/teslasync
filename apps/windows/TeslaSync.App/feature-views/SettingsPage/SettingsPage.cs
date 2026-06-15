using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>SettingsPage</c> — a parity port of the web page
/// <c>web/src/features/settings/pages/SettingsPage.tsx</c> (route <c>/settings</c>, nav name <c>Settings</c>). It
/// composes the shared <see cref="PageContainer"/> chrome (the heading-level-1 title + muted subtitle, and the
/// loading spinner the web <c>useSettings</c> query gates) wrapping a body that reproduces every region the web page
/// owns: the cross-page <see cref="SettingsSearch"/> box, the mounted-but-idle <see cref="EditConflictBanner"/> (the
/// web <c>resourceLabel</c> resolves the <c>editConflict.resource.settings</c> noun), and the three glass panels —
/// GlassPanel1 the clickable "Data Export" deep-link (web <c>&lt;a href="/data-export"&gt;</c>), GlassPanel2 the
/// "Onboarding Tour" launcher and GlassPanel3 the "Setup Checklist" restart affordance with its confirmation toast.
/// The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="SettingsDisplay"/> projection, and state changes are marshalled onto the UI thread. The four heavy
/// settings sections (general / appearance / advanced / reset) the web page also mounts are their own parity units and
/// are out of this page's scope.
/// </summary>
public sealed partial class SettingsPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;   // web layout gutter
    private const double BodySpacing = 16;      // web space between page sections
    private const double PanelPadding = 20;     // web GlassPanel p-5
    private const double RowSpacing = 16;       // web flex gap-4
    private const double IconBoxSize = 40;      // web IconBox h-10 w-10
    private const double IconGlyphSize = 20;    // web icon h-5 w-5
    private const double PanelCornerRadius = 12;

    private readonly SettingsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageContainer _container;
    private readonly SettingsSearch _search;
    private readonly EditConflictBanner _conflictBanner;

    private readonly InfoBar _checklistToast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
    };

    // GlassPanel1 — Data Export (the whole panel is a deep-link, web <a href="/data-export">).
    private readonly TsGlassPanel _exportPanel = new() { Glow = GlassGlow.None };
    private readonly Button _exportLink = new();
    private readonly PanelTitle _exportTitle = new();
    private readonly Caption _exportSubtitle = new();

    // GlassPanel2 — Onboarding Tour.
    private readonly TsGlassPanel _tourPanel = new() { Glow = GlassGlow.None };
    private readonly PanelTitle _tourTitle = new();
    private readonly Caption _tourDescription = new();
    private readonly TsButton _tourButton = new() { Variant = ButtonVariant.Subtle, IconGlyph = SettingsRegistration.TourGlyph };

    // GlassPanel3 — Setup Checklist.
    private readonly TsGlassPanel _checklistPanel = new() { Glow = GlassGlow.None };
    private readonly PanelTitle _checklistTitle = new();
    private readonly Caption _checklistDescription = new();
    private readonly TsButton _checklistButton = new() { Variant = ButtonVariant.Subtle, IconGlyph = SettingsRegistration.ChecklistGlyph };

    // Appearance — accent palette + display-mode picker (native ThemeProvider parity, applied app-wide).
    // Null when the shell mounts the full Appearance surface (which already contains the theme picker).
    private readonly TsGlassPanel? _themePanel;

    // Optional full settings surfaces (Appearance / General / Advanced) mounted by the shell with the live data layer.
    private readonly IReadOnlyList<UIElement> _extraSurfaces;

    /// <summary>Creates the page over the default (empty) settings feed and the shell resource localizer.</summary>
    public SettingsPage()
        : this(EmptySettingsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit settings feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The settings-read data port (web <c>useSettings</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SettingsPage(ISettingsFeed feed, ILocalizer localizer, IReadOnlyList<UIElement>? extraSurfaces = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _extraSurfaces = extraSurfaces ?? System.Array.Empty<UIElement>();
        _viewModel = new SettingsPageViewModel(feed, localizer);

        // Web mounts <SettingsSearch /> at the top of the page; the search forwards a deep-link the host navigates to.
        _search = SettingsSearch.Create(localizer);

        // Web mounts <EditConflictBanner resourceKey resourceLabel /> always; it stays hidden until a cross-tab edit
        // conflict occurs. An idle (no-conflict) lease keeps it mounted-but-hidden while still resolving the noun.
        _conflictBanner = new EditConflictBanner(
            localizer,
            new StaticEditLeaseSource(),
            _viewModel.Display.ConflictResourceLabel);

        BuildExportPanel();
        BuildTourPanel();
        BuildChecklistPanel();
        _themePanel = _extraSurfaces.Count == 0 ? BuildThemePanel(localizer) : null;

        _container = new PageContainer(localizer, _viewModel.Display.Title)
        {
            Subtitle = _viewModel.Display.Subtitle,
            PageContent = BuildBody(),
        };

        IsTabStop = false;

        // The PageContainer carries the page's heading-level-1 landmark, so the wrapper hides itself from Narrator.
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

        _search.NavigationRequested += OnSearchNavigation;
        _exportLink.Click += OnExportClick;
        _tourButton.Click += OnTourClick;
        _checklistButton.Click += OnChecklistClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the user chooses a deep-link affordance, asking the host to navigate (web <c>navigate(href)</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>Raised when the user opens the onboarding tour launcher (web <c>dispatchTourLauncherOpen()</c>).</summary>
    public event EventHandler? TourLauncherRequested;

    /// <summary>Raised when the user restarts the setup checklist (web <c>restartChecklist()</c>).</summary>
    public event EventHandler? ChecklistRestartRequested;

    /// <summary>The diagnostics surface slug (<c>SettingsPage</c>).</summary>
    public static string Slug => SettingsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SettingsPageViewModel ViewModel => _viewModel;

    private StackPanel BuildBody()
    {
        var stack = new StackPanel { Spacing = BodySpacing };
        stack.Children.Add(_checklistToast);
        stack.Children.Add(_search);
        stack.Children.Add(_conflictBanner);
        if (_extraSurfaces.Count > 0)
        {
            int surfaceDelay = 170;
            foreach (var surface in _extraSurfaces)
            {
                stack.Children.Add(Fade(surface, surfaceDelay));
                surfaceDelay += 20;
            }
        }
        else if (_themePanel is not null)
        {
            stack.Children.Add(Fade(_themePanel, 170));
        }

        stack.Children.Add(Fade(_exportLink, 180));
        stack.Children.Add(Fade(_tourPanel, 200));
        stack.Children.Add(Fade(_checklistPanel, 220));
        return stack;
    }

    private static TsGlassPanel BuildThemePanel(ILocalizer localizer)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new SectionTitle { Value = localizer.GetString("theme.title", "Appearance") });
        content.Children.Add(new Caption { Value = localizer.GetString("theme.subtitle", "Customize colors and display mode") });
        content.Children.Add(new TsThemeModePicker(localizer));
        return new TsGlassPanel { Glow = GlassGlow.None, Content = content };
    }

    private void BuildExportPanel()
    {
        var trailing = new FontIcon { Glyph = SettingsRegistration.ExternalLinkGlyph, FontSize = 16 };
        ApplyAccent(trailing, "TsColorTextMutedBrush");
        AutomationProperties.SetAccessibilityView(trailing, AccessibilityView.Raw);

        _exportPanel.Content = BuildPanelRow(
            BuildIconBox(SettingsRegistration.DataExportGlyph, "TsChartBatteryBrush"),
            _exportTitle,
            _exportSubtitle,
            trailing);

        // Web renders the panel inside an <a href="/data-export">; a transparent Button gives the whole card the
        // keyboard + pointer + Narrator semantics of a link without a second visible surface.
        _exportLink.Content = _exportPanel;
        _exportLink.Padding = new Thickness(0);
        _exportLink.BorderThickness = new Thickness(0);
        _exportLink.Background = new SolidColorBrush(Colors.Transparent);
        _exportLink.CornerRadius = new CornerRadius(PanelCornerRadius);
        _exportLink.HorizontalAlignment = HorizontalAlignment.Stretch;
        _exportLink.HorizontalContentAlignment = HorizontalAlignment.Stretch;
    }

    private void BuildTourPanel() =>
        _tourPanel.Content = BuildPanelRow(
            BuildIconBox(SettingsRegistration.TourGlyph, "TsChartSpeedBrush"),
            _tourTitle,
            _tourDescription,
            _tourButton);

    private void BuildChecklistPanel() =>
        _checklistPanel.Content = BuildPanelRow(
            BuildIconBox(SettingsRegistration.ChecklistGlyph, "TsChartSpeedBrush"),
            _checklistTitle,
            _checklistDescription,
            _checklistButton);

    private static Grid BuildPanelRow(
        FrameworkElement iconBox,
        FrameworkElement titleElement,
        FrameworkElement subtitleElement,
        FrameworkElement trailing)
    {
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(titleElement);
        text.Children.Add(subtitleElement);

        var grid = new Grid
        {
            ColumnSpacing = RowSpacing,
            Padding = new Thickness(PanelPadding),
            VerticalAlignment = VerticalAlignment.Center,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(iconBox, 0);
        Grid.SetColumn(text, 1);
        Grid.SetColumn(trailing, 2);
        trailing.VerticalAlignment = VerticalAlignment.Center;

        grid.Children.Add(iconBox);
        grid.Children.Add(text);
        grid.Children.Add(trailing);
        return grid;
    }

    private static Border BuildIconBox(string glyph, string accentBrushKey)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = IconGlyphSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyAccent(icon, accentBrushKey);

        var box = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = new CornerRadius(10),
            Child = icon,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (TokenBrush("TsColorSurfaceGlassBrush") is { } surface)
        {
            box.Background = surface;
        }

        AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
        return box;
    }

    private static TsFadeIn Fade(UIElement child, int delayMs) =>
        new() { DelayMs = delayMs, Content = child };

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

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

    private void Render(SettingsDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.IsLoading = display.ShowLoading;

        _exportTitle.Value = display.ExportTitle;
        _exportSubtitle.Value = display.ExportSubtitle;
        AutomationProperties.SetName(_exportLink, display.ExportTitle);
        ToolTipService.SetToolTip(_exportLink, display.ExportTitle);

        _tourTitle.Value = display.TourTitle;
        _tourDescription.Value = display.TourDescription;
        _tourButton.Text = display.TourActionLabel;
        AutomationProperties.SetName(_tourButton, display.TourActionLabel);

        _checklistTitle.Value = display.ChecklistTitle;
        _checklistDescription.Value = display.ChecklistDescription;
        _checklistButton.Text = display.ChecklistActionLabel;
        AutomationProperties.SetName(_checklistButton, display.ChecklistActionLabel);

        _checklistToast.Title = display.ChecklistTitle;
        _checklistToast.Message = display.ChecklistRestartedMessage;
    }

    private void OnSearchNavigation(object? sender, SettingsSearchNavigationEventArgs e)
    {
        var path = e.Target.Path?.TrimStart('/');
        NavigationRequested?.Invoke(this, string.IsNullOrEmpty(path) ? SettingsRegistration.RouteName : path);
    }

    private void OnExportClick(object sender, RoutedEventArgs e) =>
        NavigationRequested?.Invoke(this, SettingsRegistration.DataExportRoute);

    private void OnTourClick(object sender, RoutedEventArgs e) =>
        TourLauncherRequested?.Invoke(this, EventArgs.Empty);

    private void OnChecklistClick(object sender, RoutedEventArgs e)
    {
        ChecklistRestartRequested?.Invoke(this, EventArgs.Empty);

        // Web raises a success toast after restarting the checklist (t('checklist.settings.restarted')).
        _checklistToast.IsOpen = true;
    }

    /// <summary>Unsubscribe from and dispose the composed surfaces (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _search.NavigationRequested -= OnSearchNavigation;
        _exportLink.Click -= OnExportClick;
        _tourButton.Click -= OnTourClick;
        _checklistButton.Click -= OnChecklistClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;

        _search.Dispose();
        _conflictBanner.Dispose();
        _container.Dispose();
        _viewModel.Dispose();

        foreach (var surface in _extraSurfaces)
        {
            (surface as IDisposable)?.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private static void ApplyAccent(IconElement icon, string brushKey)
    {
        if (TokenBrush(brushKey) is { } brush)
        {
            icon.Foreground = brush;
        }
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    protected override AutomationPeer OnCreateAutomationPeer() => new SettingsPageAutomationPeer(this);

    private sealed class SettingsPageAutomationPeer(SettingsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
