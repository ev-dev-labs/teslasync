using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Carries the destination a <see cref="LegacyNotificationsRedirect"/> asks the host to navigate to — the
/// native analogue of the web component's <c>&lt;Navigate to={to} replace /&gt;</c>
/// (web/src/features/notifications/components/LegacyNotificationsRedirect.tsx). The shell host subscribes to
/// <see cref="LegacyNotificationsRedirect.NavigationRequested"/> and performs the (replacing) navigation; the
/// surface itself stays a thin redirector.
/// </summary>
public sealed class LegacyNotificationsRedirectNavigationEventArgs(LegacyNotificationsRedirectTarget target) : EventArgs
{
    /// <summary>The resolved redirect destination (web computed <c>to</c>).</summary>
    public LegacyNotificationsRedirectTarget Target { get; } = target;

    /// <summary>The destination location string to navigate to (web <c>to</c>).</summary>
    public string Location => Target.Location;

    /// <summary>Always true — the web redirect uses <c>&lt;Navigate replace /&gt;</c>, replacing the legacy entry in history.</summary>
    public bool Replace { get; } = true;
}

/// <summary>
/// The native WinUI 3 <c>LegacyNotificationsRedirect</c> surface — a parity port of
/// web/src/features/notifications/components/LegacyNotificationsRedirect.tsx. The web component is a
/// query-aware redirect: it reads <c>useLocation()</c>, maps the legacy <c>?tab=</c> parameter to the new
/// top-level Notifications route (<c>inbox</c> / <c>archived</c> / <c>channels</c>, defaulting to inbox),
/// forwards every other query parameter, and returns <c>&lt;Navigate to={to} replace /&gt;</c>. Because a
/// WinUI control must render something (unlike a React component returning <c>&lt;Navigate&gt;</c>), this
/// surface shows a brief, accessible "Redirecting…" affordance (a <see cref="ProgressRing"/> + the localized
/// status) and, once loaded, raises <see cref="NavigationRequested"/> with the resolved destination so the
/// host performs the replacing navigation. The view never reads navigation state directly — all resolution
/// happens in the WinUI-free <see cref="LegacyNotificationsRedirectViewModel"/> /
/// <see cref="LegacyNotificationsRedirectResolver"/>. The status resolves through the i18n facade, the
/// surface carries a Narrator name and a polite live region, and it adds no custom motion beyond the platform
/// progress control (so reduced-motion is honoured by construction).
/// </summary>
public sealed partial class LegacyNotificationsRedirect : ContentControl, IDisposable
{
    private const string AutomationIdRoot = "legacy-notifications-redirect";

    private readonly LegacyNotificationsRedirectViewModel _viewModel;
    private readonly LegacyNotificationsRedirectDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _statusText = new();

    private bool _navigated;
    private bool _disposed;

    /// <summary>Creates the surface over its location source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The location state-holder seam the redirect resolves against (P1/S8).</param>
    /// <param name="localizer">The i18n facade the redirecting status resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LegacyNotificationsRedirect(
        ILegacyNotificationsLocationSource source,
        ILocalizer localizer,
        LegacyNotificationsRedirectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new LegacyNotificationsRedirectViewModel(source, localizer);
        _diagnostics = diagnostics ?? new LegacyNotificationsRedirectDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, AutomationIdRoot);

        BuildChrome();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised once the surface is loaded, asking the host to navigate to the resolved destination (web <c>&lt;Navigate replace /&gt;</c>).</summary>
    public event EventHandler<LegacyNotificationsRedirectNavigationEventArgs>? NavigationRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LegacyNotificationsRedirect</c>).</summary>
    public static string Slug => LegacyNotificationsRedirectRegistration.Slug;

    /// <summary>The resolved redirect destination (web computed <c>to</c>).</summary>
    public LegacyNotificationsRedirectTarget Target => _viewModel.Target;

    /// <summary>Convenience factory mirroring the other feature-view surfaces.</summary>
    public static LegacyNotificationsRedirect Create(
        ILegacyNotificationsLocationSource source,
        ILocalizer localizer,
        LegacyNotificationsRedirectDiagnostics? diagnostics = null) =>
        new(source, localizer, diagnostics);

    private void BuildChrome()
    {
        var ring = new ProgressRing
        {
            IsActive = true,
            IsIndeterminate = true,
            Width = 32,
            Height = 32,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(ring, AccessibilityView.Raw);

        _statusText.FontSize = 13;
        _statusText.Foreground = DisplayTokens.TextSecondary;
        _statusText.HorizontalAlignment = HorizontalAlignment.Center;
        _statusText.TextAlignment = TextAlignment.Center;
        _statusText.TextWrapping = TextWrapping.Wrap;

        var stack = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stack.Children.Add(ring);
        stack.Children.Add(_statusText);

        LiveRegion.Configure(this);
        Content = stack;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_navigated)
        {
            return;
        }

        _navigated = true;
        _diagnostics.RecordViewOpened();
        LiveRegion.Announce(this);
        NavigationRequested?.Invoke(this, new LegacyNotificationsRedirectNavigationEventArgs(_viewModel.Target));
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(Render);
        }
        else
        {
            Render();
        }
    }

    private void Render()
    {
        _statusText.Text = _viewModel.StatusMessage;
        AutomationProperties.SetName(this, _viewModel.AutomationName);
    }

    /// <summary>Detach from the view-model (idempotent).</summary>
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
}
