using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>BrowserNotificationsPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/BrowserNotificationsPage.tsx</c> (route <c>/notifications/browser</c>,
/// nav name <c>NotificationsBrowser</c>). The web page renders a <c>PageContainer</c> (its title, the muted
/// subtitle and the "Copy link" affordance) wrapping the <c>NotificationSettings</c> component. This surface
/// reproduces that exactly: it composes the shared <see cref="PageContainer"/> surface — the parity port of
/// web/src/components/layout/PageContainer.tsx — with the same two i18n strings and the copy-link affordance,
/// and hosts the already-ported <see cref="NotificationSettings"/> surface as its body. Being a thin wrapper, the
/// page itself issues no query and therefore has no page-level loading / empty / error chrome (the embedded
/// settings surface owns its own state matrix); the container always shows its content. Every visible string
/// resolves through the i18n facade and the wrapper hides itself from Narrator so the container carries the
/// page's heading-level-1 landmark.
/// </summary>
public sealed partial class BrowserNotificationsPage : UserControl, IDisposable
{
    private const double ContentPadding = 24; // web layout gutter around the page chrome.

    private readonly PageContainer _container;
    private readonly NotificationSettings _settings;
    private bool _disposed;

    /// <summary>Creates the page over the shell localizer and the headless default notification stores.</summary>
    public BrowserNotificationsPage()
        : this(CreateDefaultSettings(ShellLocalizer.Instance), ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit settings surface and localizer (used by hosts / tests).</summary>
    /// <param name="settings">The embedded notification-settings surface (web <c>NotificationSettings</c>).</param>
    /// <param name="localizer">The i18n facade the page chrome resolves through.</param>
    public BrowserNotificationsPage(NotificationSettings settings, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(localizer);

        _settings = settings;
        _container = new PageContainer(localizer, BrowserNotificationsRegistration.Title(localizer))
        {
            Subtitle = BrowserNotificationsRegistration.Subtitle(localizer),
            CopyLink = true,
            CopyLinkText = BrowserNotificationsRegistration.CopyLinkUri(),
            PageContent = settings,
        };

        IsTabStop = false;

        // Transparent wrapper: the PageContainer carries the page's heading-level-1 title landmark and body
        // automation ids, so the wrapper hides itself from Narrator (web parity — the page IS the container).
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

        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>BrowserNotificationsPage</c>).</summary>
    public static string Slug => BrowserNotificationsRegistration.Slug;

    /// <summary>The embedded notification-settings surface (exposed for hosting / diagnostics).</summary>
    public NotificationSettings Settings => _settings;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Unloaded -= OnUnloaded;
        _settings.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private static NotificationSettings CreateDefaultSettings(ILocalizer localizer) =>
        new(
            EmptyNotificationTabSignalsSource.Instance,
            new InMemoryNotificationPermissionGateway(),
            new InMemoryWebPushPreferenceStore(),
            new InMemoryNotificationSoundPreferenceStore(),
            localizer);

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
