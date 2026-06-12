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
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Theme;
using TeslaSync.App.Notifications;
using TeslaSync.App.Platform.Lifecycle;
using TeslaSync.App.Push;
using TeslaSync.App.Settings;
using Windows.Graphics;
using Windows.System;
using Windows.UI.ViewManagement;

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
    private readonly TsAlertBanner _pushBanner = new() { IsOpen = false, Dismissible = true };

    private ElementTheme _theme = ElementTheme.Default;
    private AccessibilitySettings? _accessibility;
    private bool _navigating;
    private string? _pendingProtectedPath;
    private bool _startupRouteApplied;

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

        // Battery / Energy page (P2/W7) — parity port of web EnergyPage at route /energy.
        _viewModel.PageFactory.Register("Energy", static () => new FeatureViews.Battery.EnergyPage());

        // Admin / API Logs page (P2/W7) — parity port of web ApiLogsPage at route /api-logs.
        _viewModel.PageFactory.Register("ApiLogs", static () => new FeatureViews.Admin.ApiLogsPage());

        // Admin / Feedback queue page (P2/W7) — parity port of web FeedbackQueuePage at route /admin/feedback.
        _viewModel.PageFactory.Register("FeedbackQueue", static () => new FeatureViews.Admin.FeedbackQueuePage());

        // Admin / Schema drift page (P2/W7) — parity port of web SchemaDriftPage at route /admin/schema-drift.
        _viewModel.PageFactory.Register("SchemaDrift", static () => new FeatureViews.Admin.SchemaDriftPage());

        // Admin / Vehicle cost page (P2/W7) — parity port of web VehicleCostPage at route /admin/vehicle-cost.
        _viewModel.PageFactory.Register("VehicleCost", static () => new FeatureViews.Admin.VehicleCostPage());
        // Battery / Energy flow page (P2/W7) — parity port of web EnergyFlowPage at route /energy-flow.
        _viewModel.PageFactory.Register("EnergyFlow", static () => new FeatureViews.Battery.EnergyFlowPage());
        // Battery / Energy products page (P2/W7) — parity port of web EnergyProductsPage at route /energy-products.
        _viewModel.PageFactory.Register("EnergyProducts", static () => new FeatureViews.Battery.EnergyProductsPage());
        // Analytics / Timeline page (P2/W7) — parity port of web TimelinePage at route /timeline.
        _viewModel.PageFactory.Register("Timeline", static () => new FeatureViews.Analytics.TimelinePage());
        // Analytics / True Cost of Ownership page (P2/W7) — parity port of web TrueCostPage at route /analytics/tco.
        _viewModel.PageFactory.Register("TrueCostOwnership", static () => new FeatureViews.Analytics.TrueCostPage());
        // Analytics / Weekly digest page (P2/W7) — parity port of web WeeklyDigestPage at route /weekly-digest.
        _viewModel.PageFactory.Register("WeeklyDigest", static () => new FeatureViews.Analytics.WeeklyDigestPage());

        // Analytics / Year-in-Review story player (P2/W7) — parity port of web YearReviewPage at route
        // /year-review/:year. The route year is read from the live match and close/Esc maps to back-navigation
        // (web navigate(-1)).
        _viewModel.PageFactory.Register("YearReview", () =>
        {
            var page = new FeatureViews.Review.YearReviewPage(ParseYearParam(_viewModel.Current.Param("year")));
            page.CloseRequested += (_, _) => GoBack();
            return page;
        });

        // Automations / list page (P2/W7) — parity port of web AutomationListPage at route /automations/list.
        _viewModel.PageFactory.Register("AutomationList", () =>
        {
            var page = new FeatureViews.Automations.AutomationListPage();
            page.NavigationRequested += (_, e) => NavigateTo(e.Route);
            return page;
        });

        // Automations hub page (P2/W7) — parity port of web AutomationsListPage at route /automations.
        _viewModel.PageFactory.Register("Automations", () =>
        {
            var page = new FeatureViews.Automations.AutomationsListPage();
            page.NavigationRequested += (_, e) => NavigateTo(e.Path);
            return page;
        });

        // Automations / AutomationBuilder page (P2/W7) — parity port of web AutomationBuilderPage at routes
        // automations/new + automations/:id/edit.
        _viewModel.PageFactory.Register("AutomationBuilder", static () => new FeatureViews.Automations.AutomationBuilderPage());
        // Battery / Degradation page (P2/W7) — parity port of web BatteryDegradationPage at route /battery-degradation.
        _viewModel.PageFactory.Register("BatteryDegradation", static () => new FeatureViews.Battery.BatteryDegradationPage());
        // Battery / Projected Range page (P2/W7) — parity port of web ProjectedRangePage at route /analytics/range
        // (visible nav item /projected-range; /analytics/range is the hidden deep-link alias). Both resolve to the
        // "ProjectedRange" route name.
        _viewModel.PageFactory.Register("ProjectedRange", static () => new FeatureViews.Battery.ProjectedRangePage());

        // Driving / DriveDetail page (P2/W7) — parity port of web DriveDetailPage at route /drives/:id.
        // The route drive id is read from the live match and the back affordance maps to the drives list.
        _viewModel.PageFactory.Register("DriveDetail", () =>
        {
            var page = new FeatureViews.Driving.DriveDetailPage(ParseSessionId(_viewModel.Current.Param("id")));
            page.BackRequested += (_, _) => NavigateTo("drives");
            return page;
        });

        // Charging / ChargingDetail page (P2/W7) — parity port of web ChargingDetailPage at route /charging/:id.
        // The route session id is read from the live match and the back affordance maps to the charging list.
        _viewModel.PageFactory.Register("ChargeDetail", () =>
        {
            var page = new FeatureViews.Charging.ChargingDetailPage(ParseSessionId(_viewModel.Current.Param("id")));
            page.BackRequested += (_, _) => NavigateTo("charging");
            return page;
        });
        // Charging / Charging Curve page (P2/W7) — parity port of web ChargingCurvePage at route /charging-curve.
        _viewModel.PageFactory.Register("ChargingCurve", static () => new FeatureViews.Charging.ChargingCurvePage());
        // Charging / Powershare page (P2/W7) — parity port of web PowersharePage at route /powershare.
        _viewModel.PageFactory.Register("Powershare", static () => new FeatureViews.Charging.PowersharePage());
        ReauthBannerHost.Content = _authBanner;
        PushBannerHost.Content = _pushBanner;
        AppAuth.Service.StateChanged += OnAuthStateChanged;
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        Closed += OnShellClosed;

        // Foreground push registration + notification routing (P2/W6-0002). Best-effort: an
        // unpackaged dev run without WNS/package identity simply leaves push inactive. The W8
        // notification graph (actionable toasts, taskbar, jump list) starts first so it provides the
        // foreground push router; push registration then follows the auth session.
        AppNotifications.Start(this, DispatcherQueue, _pushBanner);
        AppPush.Start(DispatcherQueue, _pushBanner);

        ConfigureWindow();
        BuildNavigation();
        AddNavigationAccelerators();

        RootGrid.Loaded += OnRootLoaded;

        // Land on the index (Dashboard) route on launch.
        NavigateTo(string.Empty);

        // Signal the lifecycle coordinator that launch activation is complete (Launching -> Running).
        // Theme/density/startup-route are applied by OnSettingsChanged once the async settings load
        // raises Changed; first paint keeps the fast-cached theme restored in ConfigureWindow (no flash).
        AppLifecycle.MarkLaunched();
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

        // P2/W8-0002 — compose app lifecycle: the window's foreground/background and the system
        // network state drive suspend/resume, and a crash-safe persist flushes settings + window
        // state on suspend, window close, or a fatal unhandled exception.
        AppLifecycle.Start(this, AppSettingsHost.Service, AppSettingsHost.Cache, PersistWindowState);
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
        // Flush settings + window state through the coordinator's crash-safe persist path.
        AppLifecycle.RequestShutdownPersist(LifecycleShutdownReason.WindowClosing);

    private void PersistWindowState(LifecycleShutdownReason reason)
    {
        try
        {
            _windowState.Save(AppWindow, _theme);

            // On a fatal teardown keep the work minimal; otherwise remember the active route so the
            // "open last visited" startup option can restore it.
            if (reason != LifecycleShutdownReason.FatalError)
            {
                WindowStateService.SaveLastRoute(_viewModel.CurrentPath);
            }
        }
        catch (Exception)
        {
            // Persistence is best-effort; never let a teardown save crash the app.
        }
    }

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
        // Cycle System -> Light -> Dark -> System through the settings service, which persists the
        // choice and raises Changed; OnSettingsChanged then applies it to the live window.
        var next = NextTheme(AppSettingsHost.Current.Theme);
        _ = AppSettingsHost.Service.UpdateAsync(s => s with { Theme = next });
    }

    private void ApplyTheme(ElementTheme theme)
    {
        if (Content is FrameworkElement root)
        {
            root.RequestedTheme = theme;
        }
    }

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            ApplySettings(settings);
        }
        else
        {
            DispatcherQueue.TryEnqueue(() => ApplySettings(settings));
        }
    }

    private void ApplySettings(AppSettings settings)
    {
        _theme = ToElementTheme(settings.Theme);
        ApplyTheme(_theme);
        ApplyDensity(settings.Density);
        MaybeApplyStartupRoute(settings);
    }

    private void ApplyDensity(InterfaceDensity density) =>
        RootNavigation.OpenPaneLength = density == InterfaceDensity.Compact ? 220 : 280;

    private void MaybeApplyStartupRoute(AppSettings settings)
    {
        // Honour the "open last visited" preference exactly once, after the first settings load.
        if (_startupRouteApplied)
        {
            return;
        }

        _startupRouteApplied = true;
        if (settings.StartupPage != AppStartupPage.LastVisited)
        {
            return;
        }

        var last = WindowStateService.ReadLastRoute();
        if (!string.IsNullOrEmpty(last) && !string.Equals(last, _viewModel.CurrentPath, StringComparison.Ordinal))
        {
            NavigateTo(last);
        }
    }

    private ElementTheme ToElementTheme(AppThemePreference preference) =>
        ThemeResolver.Resolve(preference, SystemHighContrast()) switch
        {
            ThemeVariant.Light => ElementTheme.Light,
            ThemeVariant.Dark => ElementTheme.Dark,
            _ => ElementTheme.Default,
        };

    /// <summary>
    /// Reads the OS high-contrast flag defensively. The packaged host always exposes it, but a
    /// non-packaged or headless launch must never crash theme application, so any failure reports
    /// "not high contrast" and the persisted light/dark preference is honoured unchanged.
    /// </summary>
    private bool SystemHighContrast()
    {
        try
        {
            _accessibility ??= new AccessibilitySettings();
            return _accessibility.HighContrast;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static AppThemePreference NextTheme(AppThemePreference preference) => preference switch
    {
        AppThemePreference.System => AppThemePreference.Light,
        AppThemePreference.Light => AppThemePreference.Dark,
        _ => AppThemePreference.System,
    };

    // Parse the /year-review/:year route param (web Number(yearParam) || new Date().getFullYear()).
    private static int ParseYearParam(string? year) =>
        int.TryParse(year, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : DateTime.Now.Year;

    // Parse the /charging/:id route param (web Number(id)); 0 when absent so the page renders its empty state.
    private static long ParseSessionId(string? id) =>
        long.TryParse(id, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : 0;

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

    private void OnShellClosed(object sender, WindowEventArgs args)
    {
        AppAuth.Service.StateChanged -= OnAuthStateChanged;
        AppSettingsHost.Service.Changed -= OnSettingsChanged;
        AppPush.Stop();
        AppNotifications.Stop();
        AppLifecycle.Stop();
    }
}
