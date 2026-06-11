using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>SessionExpiredModal</c> overlay surface — a parity port of
/// web/src/components/feedback/SessionExpiredModal.tsx. It reproduces the web component's non-dismissible hard
/// block shown once the upstream ForwardAuth session has expired: a centred lock badge, a "Session expired"
/// title, a one-line security body, and a single full-width primary "Sign in again" recovery action that hands
/// off to the IdP. Like the web source it renders nothing in open (no-auth) mode and while the session is live;
/// the only states are the suppressed/closed controller (which presents no surface, exactly as the web
/// component returns <c>null</c> / passes <c>open={false}</c>) and the active hard block — there is no
/// loading / error / stale / offline chrome because the only asynchronous read lives upstream in the monitor
/// seam. All state, the open/suppressed decision and label resolution flow through the shared
/// <see cref="SessionExpiredModalViewModel"/> / <see cref="SessionExpiredModalProjection"/>; the view never
/// performs HTTP. The modal is a <see cref="TsModal"/> (a WinUI <see cref="ContentDialog"/>), so it inherits a
/// focus trap and focus restoration; Esc / backdrop dismissal is absorbed (the only way out is the explicit
/// sign-in action or the monitor reporting a live session again), the recovery action is the shared
/// <see cref="TsButton"/>, every string resolves through the i18n facade, every interactive element carries a
/// Narrator name, fonts scale with the system text-scaling setting, and the dialog uses the system transition
/// so reduced-motion is honoured.
/// </summary>
public sealed partial class SessionExpiredModal : ContentControl, IDisposable
{
    private const double BodyMinWidth = 320;   // keep the hard-block copy readable in a small modal
    private const double BodySpacing = 16;     // gap between the badge, the text group and the action
    private const double TextSpacing = 4;       // gap between the title and the body (web `mt-1`)
    private const double BadgeSize = 48;        // web `h-12 w-12`
    private const double BadgeCornerRadius = 24; // web `rounded-full`
    private const double IconSize = 24;         // web Lucide `h-6 w-6`
    private const double BadgeTintOpacity = 0.15; // web `bg-rose-300/15`

    private readonly SessionExpiredModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private TsModal? _dialog;
    private bool _showing;
    private bool _allowProgrammaticClose;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, the session seams, the re-auth handoff and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="monitor">The session-liveness seam (web <c>useSessionMonitor</c>).</param>
    /// <param name="broadcast">The 401 hard-expiry broadcast (web <c>teslasync:session-expired</c> event).</param>
    /// <param name="reauth">The IdP re-auth handoff (web <c>navigateToReauth</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public SessionExpiredModal(
        ILocalizer localizer,
        ISessionMonitor monitor,
        ISessionExpiryBroadcast broadcast,
        IReauthHandoff reauth,
        SessionExpiredModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SessionExpiredModalViewModel(localizer, monitor, broadcast, reauth, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The surface is a controller: it renders nothing inline (like the web component when closed); the
        // modal it presents is the surface. A null Content keeps the element zero-size yet loaded (so it has a
        // XamlRoot once attached).
        IsTabStop = false;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SessionExpiredModal</c>).</summary>
    public static string Slug => SessionExpiredModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SessionExpiredModalViewModel ViewModel => _viewModel;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // The session may already be expired before the element had a XamlRoot; present now that it does.
        if (_viewModel.IsOpen && !_showing)
        {
            _ = PresentDialogAsync();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Marshal(() =>
        {
            switch (e.PropertyName)
            {
                case nameof(SessionExpiredModalViewModel.IsOpen):
                    if (_viewModel.IsOpen)
                    {
                        _ = PresentDialogAsync();
                    }
                    else
                    {
                        DismissDialog();
                    }

                    break;

                case nameof(SessionExpiredModalViewModel.Display):
                    if (_showing && _dialog is not null)
                    {
                        ApplyContent(_dialog);
                    }

                    break;
            }
        });
    }

    private async Task PresentDialogAsync()
    {
        if (_showing || _disposed || XamlRoot is not { } xamlRoot)
        {
            return;
        }

        _showing = true;
        _allowProgrammaticClose = false;

        var dialog = new TsModal
        {
            XamlRoot = xamlRoot,
        };
        ApplyContent(dialog);

        // Non-dismissible: absorb Esc / backdrop. The only programmatic close is the monitor reporting a live
        // session again (web recovery navigates the page away); the explicit sign-in action keeps it open.
        dialog.Closing += OnDialogClosing;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            dialog.Closing -= OnDialogClosing;
            dialog.Closed -= OnDialogClosed;
            _showing = false;
            _dialog = null;
        }
    }

    private void ApplyContent(TsModal dialog)
    {
        SessionExpiredModalDisplay display = _viewModel.Display;

        var badgeTint = DisplayTokens.Brush("TsColorDangerBrush") is SolidColorBrush danger
            ? new SolidColorBrush(danger.Color) { Opacity = BadgeTintOpacity }
            : new SolidColorBrush(Colors.Transparent);

        var icon = new FontIcon
        {
            Glyph = display.IconGlyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var badge = new Border
        {
            Width = BadgeSize,
            Height = BadgeSize,
            CornerRadius = new CornerRadius(BadgeCornerRadius),
            Background = badgeTint,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = icon,
        };

        var text = new StackPanel { Spacing = TextSpacing };
        text.Children.Add(new PanelTitle { Value = display.Title });
        text.Children.Add(new Text { Value = display.Body });

        var signIn = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Text = display.SignInLabel,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(signIn, display.SignInLabel);
        signIn.Click += OnSignInClick;

        var body = new StackPanel { Spacing = BodySpacing, MinWidth = BodyMinWidth };
        body.Children.Add(badge);
        body.Children.Add(text);
        body.Children.Add(signIn);

        dialog.Content = body;
        AutomationProperties.SetName(dialog, display.AutomationName);
    }

    private void OnSignInClick(object sender, RoutedEventArgs e) => _viewModel.RequestReauth();

    private void OnDialogClosing(ContentDialog sender, ContentDialogClosingEventArgs args)
    {
        // Hard block: cancel every close attempt except the programmatic dismissal we initiate when the
        // view-model leaves the active state (re-auth succeeded). Esc / backdrop are absorbed here.
        if (!_allowProgrammaticClose)
        {
            args.Cancel = true;
        }
    }

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.Closing -= OnDialogClosing;
        sender.Closed -= OnDialogClosed;
        _showing = false;
        _allowProgrammaticClose = false;
        _dialog = null;
    }

    private void DismissDialog()
    {
        if (_dialog is null)
        {
            return;
        }

        _allowProgrammaticClose = true;
        _dialog.Hide();
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    /// <summary>Dismiss any open modal, detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        DismissDialog();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SessionExpiredModalAutomationPeer(this);

    private sealed class SessionExpiredModalAutomationPeer(SessionExpiredModal owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((SessionExpiredModal)Owner)._viewModel.Display.Title : name;
        }
    }
}
