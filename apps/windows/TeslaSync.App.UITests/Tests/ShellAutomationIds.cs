namespace TeslaSync.App.UITests.Tests;

/// <summary>
/// The <c>x:Name</c> / <c>AutomationId</c> values WinUI assigns to the shell chrome in
/// <c>ShellWindow.xaml</c>. WinUI projects each named control's <c>x:Name</c> as its
/// <c>AutomationProperties.AutomationId</c>, so these are the stable locators the UI automation suite
/// uses to reach the shell. Keeping them in one place means a XAML rename is a single-line fix here.
/// </summary>
public static class ShellAutomationIds
{
    /// <summary>The root layout grid hosting title bar, navigation and status bar.</summary>
    public const string RootGrid = "RootGrid";

    /// <summary>The custom title bar grid.</summary>
    public const string AppTitleBar = "AppTitleBar";

    /// <summary>The title text shown in the custom title bar.</summary>
    public const string AppTitleText = "AppTitleText";

    /// <summary>The command-palette / search box (AutoSuggestBox) in the title bar.</summary>
    public const string SearchBox = "SearchBox";

    /// <summary>The light/dark theme toggle button.</summary>
    public const string ThemeToggle = "ThemeToggle";

    /// <summary>The grouped NavigationView that drives shell navigation.</summary>
    public const string RootNavigation = "RootNavigation";

    /// <summary>The breadcrumb trail above the content frame.</summary>
    public const string ShellBreadcrumbs = "ShellBreadcrumbs";

    /// <summary>The large header title for the active route.</summary>
    public const string HeaderTitle = "HeaderTitle";

    /// <summary>The host for the re-authentication / sign-in-required banner.</summary>
    public const string ReauthBannerHost = "ReauthBannerHost";

    /// <summary>The host for the foreground push notice banner.</summary>
    public const string PushBannerHost = "PushBannerHost";

    /// <summary>The content frame the active page (or pending-route view) is shown in.</summary>
    public const string ContentFrame = "ContentFrame";

    /// <summary>The status bar at the bottom of the shell.</summary>
    public const string StatusBar = "StatusBar";

    /// <summary>The status text inside the status bar.</summary>
    public const string StatusText = "StatusText";

    /// <summary>The 1x1, visually-hidden screen-reader route announcer.</summary>
    public const string RouteAnnouncer = "RouteAnnouncer";
}
