using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Auth;
using TeslaSync.App.Auth.Onboarding;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Navigation;
using Windows.Graphics;
using Windows.System;

namespace TeslaSync.App.Shell;

/// <summary>
/// The application's top-level navigation shell (P2/W3-0001). Hosts a grouped WinUI
/// <see cref="NavigationView"/> built from the typed <see cref="RouteRegistry"/>, a
/// custom Mica-backed title bar (ExtendsContentIntoTitleBar via the window
/// <see cref="Microsoft.UI.Windowing.AppWindow"/>), breadcrumb + title chrome, a
/// status bar, keyboard back/forward accelerators, search, deep-link activation and
/// persisted window state. Page bodies are out of scope: routes without a generated
/// W7 page resolve to a <see cref="RoutePendingView"/> through the shell page factory.
/// </summary>
public sealed partial class ShellWindow : Window
{
    private readonly ShellViewModel _viewModel = new();
    private readonly WindowStateService _windowState = new();
    private readonly Dictionary<string, NavigationViewItem> _navItems = new(StringComparer.Ordinal);
    private readonly TsTeslaReauthBanner _authBanner = new();

    private ElementTheme _theme = ElementTheme.Default;
    private bool _navigating;
    private string? _pendingProtectedPath;

    public ShellWindow()
    {
        InitializeComponent();

        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDragRegion);

        ShellBreadcrumbs.ItemsSource = _viewModel.Breadcrumbs;
        SearchBox.PlaceholderText = Localization.Get("shell.search.placeholder", "Search"); // parity:allow PlaceholderText is the WinUI hint API

        // Onboarding / sign-in surface (P2/W4-0001) for the public onboarding route.
        _viewModel.PageFactory.Register("Onboarding", static () => new OnboardingView());
        ReauthBannerHost.Content = _authBanner;
        AppAuth.Service.StateChanged += OnAuthStateChanged;
        Closed += OnShellClosed;

        ConfigureWindow();
        BuildNavigation();
        AddNavigationAccelerators();

        RootGrid.Loaded += OnRootLoaded;

        // Land on the index (Dashboard) route on launch.
        NavigateTo(string.Empty);
    }

    /// <summary>The shell's navigation/state view-model (exposed for diagnostics and tests).</summary>
    internal ShellViewModel ViewModel => _viewModel;

    /// <summary>
    /// Activate the shell from an external deep link (custom <c>teslasync://</c> scheme
    /// or an https universal link), resolving redirects and extracting parameters.
    /// </summary>
    public void ActivateFromUri(Uri uri)
    {
        if (DeepLink.TryActivate(uri, _viewModel.Registry, out var match))
        {
            NavigateTo(match.MatchedPath);
        }
    }

    private void ConfigureWindow()
    {
        var appWindow = AppWindow;
        _theme = _windowState.Restore(appWindow);
        ApplyTheme(_theme);

        appWindow.Changed += OnAppWindowChanged;
        appWindow.Closing += OnAppWindowClosing;
    }

    private void OnRootLoaded(object sender, RoutedEventArgs e)
    {
        // Reserve title-bar space for the system caption buttons so the search box and
        // theme toggle never sit underneath them.
        try
        {
            double scale = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
            if (scale <= 0)
            {
                scale = 1.0;
            }

            RightInsetColumn.Width = new GridLength(AppWindow.TitleBar.RightInset / scale);
        }
        catch (Exception)
        {
            RightInsetColumn.Width = new GridLength(150);
        }
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidSizeChange)
        {
            return;
        }

        var size = sender.Size;
        int width = Math.Max(size.Width, _windowState.MinWidth);
        int height = Math.Max(size.Height, _windowState.MinHeight);
        if (width != size.Width || height != size.Height)
        {
            sender.Resize(new SizeInt32(width, height));
        }
    }

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args) =>
        _windowState.Save(sender, _theme);

    private void BuildNavigation()
    {
        foreach (var info in RouteGroups.Ordered)
        {
            var routes = _viewModel.Registry.RoutesInGroup(info.Group);
            if (routes.Count == 0)
            {
                continue;
            }

            RootNavigation.MenuItems.Add(new NavigationViewItemHeader
            {
                Content = Localization.GroupTitle(info),
            });

            foreach (var route in routes)
            {
                RootNavigation.MenuItems.Add(CreateNavItem(route));
            }
        }

        // Footer shortcuts: settings + account.
        RootNavigation.FooterMenuItems.Add(CreateFooterItem("settings", "Settings", "\uE713"));
        RootNavigation.FooterMenuItems.Add(CreateFooterItem("account/privacy", "Account", "\uE77B"));
    }

    private NavigationViewItem CreateNavItem(RouteDefinition route)
    {
        var label = Localization.Title(route);
        var item = new NavigationViewItem
        {
            Content = label,
            Tag = route.PathPattern,
            Icon = new FontIcon { Glyph = route.Glyph },
        };
        AutomationProperties.SetName(item, label);
        _navItems[RouteRegistry.Normalize(route.PathPattern)] = item;
        return item;
    }

    private NavigationViewItem CreateFooterItem(string path, string fallbackLabel, string glyph)
    {
        var route = _viewModel.Registry.Resolve(path).Route;
        var label = route.IsCatchAll ? fallbackLabel : Localization.Title(route);
        var item = new NavigationViewItem
        {
            Content = label,
            Tag = path,
            Icon = new FontIcon { Glyph = glyph },
        };
        AutomationProperties.SetName(item, label);
        return item;
    }

    private void AddNavigationAccelerators()
    {
        var back = new KeyboardAccelerator { Key = VirtualKey.Left, Modifiers = VirtualKeyModifiers.Menu };
        back.Invoked += (_, e) =>
        {
            e.Handled = true;
            GoBack();
        };

        var forward = new KeyboardAccelerator { Key = VirtualKey.Right, Modifiers = VirtualKeyModifiers.Menu };
        forward.Invoked += (_, e) =>
        {
            e.Handled = true;
            GoForward();
        };

        RootGrid.KeyboardAccelerators.Add(back);
        RootGrid.KeyboardAccelerators.Add(forward);
    }

    private void OnItemInvoked(NavigationView sender, NavigationViewItemInvokedEventArgs args)
    {
        if (args.InvokedItemContainer?.Tag is string path)
        {
            NavigateTo(path);
        }
    }

    private void OnBackRequested(NavigationView sender, NavigationViewBackRequestedEventArgs args) => GoBack();

    private void OnBreadcrumbClicked(BreadcrumbBar sender, BreadcrumbBarItemClickedEventArgs args)
    {
        if (args.Index >= 0 && args.Index < _viewModel.Breadcrumbs.Count)
        {
            NavigateTo(_viewModel.Breadcrumbs[args.Index].Key);
        }
    }

    private void GoBack()
    {
        var previous = _viewModel.History.Back();
        if (previous is not null)
        {
            NavigateTo(previous, pushHistory: false, record: false);
        }
    }

    private void GoForward()
    {
        var next = _viewModel.History.Forward();
        if (next is not null)
        {
            NavigateTo(next, pushHistory: false, record: false);
        }
    }

    private void NavigateTo(string path, bool pushHistory = true, bool record = true)
    {
        if (_navigating)
        {
            return;
        }

        _navigating = true;
        try
        {
            // Preserve the outgoing page's scroll offset for restoration on return.
            if (ContentFrame.Content is RoutePendingView outgoing)
            {
                _viewModel.Scroll.Save(_viewModel.CurrentPath, outgoing.ScrollHost.VerticalOffset);
            }

            var match = _viewModel.Registry.Resolve(path);

            // Auth gating (P2/W4-0001, ADR-008): protected routes require a live session.
            // When signed out, redirect to the public onboarding surface and surface the
            // re-authentication banner rather than rendering authenticated chrome.
            if (match.Route.AuthRequired && !AppAuth.IsAuthenticated)
            {
                _pendingProtectedPath = match.MatchedPath;
                ShowAuthBanner();
                match = _viewModel.Registry.Resolve("onboarding");
            }
            else
            {
                HideAuthBanner();
            }

            if (pushHistory)
            {
                _viewModel.History.Push(match.MatchedPath);
            }

            _viewModel.UpdateForRoute(match);

            var element = _viewModel.PageFactory.Create(match);
            ContentFrame.Content = element;

            if (record)
            {
                _viewModel.RecordVisit();
            }

            SyncChrome();
            SelectNavItem(match);
            RouteAnnouncer.AnnounceRoute(_viewModel.Title);
            RestoreScroll(element, match.MatchedPath);
        }
        finally
        {
            _navigating = false;
        }
    }

    private void RestoreScroll(UIElement element, string path)
    {
        if (element is not RoutePendingView view)
        {
            return;
        }

        double offset = _viewModel.Scroll.Restore(path);
        if (offset <= 0)
        {
            return;
        }

        void OnLoaded(object sender, RoutedEventArgs e)
        {
            view.ScrollHost.ChangeView(null, offset, null);
            view.ScrollHost.Loaded -= OnLoaded;
        }

        view.ScrollHost.Loaded += OnLoaded;
    }

    private void SyncChrome()
    {
        HeaderTitle.Text = _viewModel.Title;
        StatusText.Text = _viewModel.StatusText;
        RootNavigation.IsBackEnabled = _viewModel.CanGoBack;
        RootNavigation.IsPaneVisible = !_viewModel.IsStandalone;
        HeaderTitle.Visibility = _viewModel.IsStandalone ? Visibility.Collapsed : Visibility.Visible;

        Title = _viewModel.Title;
        try
        {
            AppWindow.Title = _viewModel.Title;
        }
        catch (Exception)
        {
            // AppWindow title is cosmetic; ignore transient failures.
        }
    }

    private void SelectNavItem(RouteMatch match)
    {
        RootNavigation.SelectedItem =
            _navItems.TryGetValue(match.MatchedPath, out var item) ? item : null;
    }

    private void OnSearchTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        var query = sender.Text?.Trim() ?? string.Empty;
        if (query.Length == 0)
        {
            sender.ItemsSource = null;
            return;
        }

        sender.ItemsSource = _viewModel.Registry.NavigableRoutes
            .Select(Localization.Title)
            .Where(t => t.Contains(query, StringComparison.OrdinalIgnoreCase))
            .OrderBy(t => t, StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToList();
    }

    private void OnSearchSubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        var query = (args.ChosenSuggestion as string ?? args.QueryText)?.Trim() ?? string.Empty;
        if (query.Length == 0)
        {
            return;
        }

        // Prefer an exact title match; otherwise hand the raw query to the search page.
        var route = _viewModel.Registry.NavigableRoutes
            .FirstOrDefault(r => string.Equals(Localization.Title(r), query, StringComparison.OrdinalIgnoreCase));

        NavigateTo(route is not null ? route.PathPattern : "search");
        sender.Text = string.Empty;
        sender.ItemsSource = null;
    }

    private void OnToggleTheme(object sender, RoutedEventArgs e)
    {
        _theme = _theme == ElementTheme.Light ? ElementTheme.Dark : ElementTheme.Light;
        ApplyTheme(_theme);
        _windowState.Save(AppWindow, _theme);
    }

    private void ApplyTheme(ElementTheme theme)
    {
        if (Content is FrameworkElement root)
        {
            root.RequestedTheme = theme;
        }
    }

    private void OnAuthStateChanged(object? sender, AuthState state)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            ApplyAuthState(state);
        }
        else
        {
            DispatcherQueue.TryEnqueue(() => ApplyAuthState(state));
        }
    }

    private void ApplyAuthState(AuthState state)
    {
        if (state.IsAuthenticated)
        {
            var target = _pendingProtectedPath ?? string.Empty;
            _pendingProtectedPath = null;
            HideAuthBanner();
            NavigateTo(target);
        }
        else if (state is AuthState.SignedOut)
        {
            // A sign-out (or expired session) must re-gate the current route immediately.
            NavigateTo(_viewModel.CurrentPath);
        }
    }

    private void ShowAuthBanner()
    {
        _authBanner.Title = Localization.Get("auth.reauth.title", "Sign in required");
        _authBanner.Message = Localization.Get(
            "auth.reauth.message",
            "Your session has ended. Sign in to access this page.");
        _authBanner.IsOpen = true;
        ReauthBannerHost.Visibility = Visibility.Visible;
    }

    private void HideAuthBanner()
    {
        _authBanner.IsOpen = false;
        ReauthBannerHost.Visibility = Visibility.Collapsed;
    }

    private void OnShellClosed(object sender, WindowEventArgs args) =>
        AppAuth.Service.StateChanged -= OnAuthStateChanged;
}
