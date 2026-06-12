using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>SkipToContent</c> shared surface — a parity port of
/// web/src/components/feedback/SkipToContent.tsx (WCAG 2.4.1, Bypass Blocks, Level A). It is the keyboard
/// bypass-blocks affordance: a single focusable link, mounted as the very first interactive element of the
/// shell, that is visually hidden until it receives keyboard focus and then reveals a Fluent chip in the
/// top-left; activating it moves focus to (and brings into view) the page's main-content landmark so keyboard /
/// Narrator users do not have to tab through the whole navigation on every page. It composes the shared
/// <see cref="TsButton"/> primitive (the native counterpart of the web <c>VisuallyHidden as="a" focusable</c>
/// skip link), binds the <see cref="SkipToContentViewModel"/> (over the <see cref="ILocalizer"/> i18n facade and
/// the <see cref="ISkipTarget"/> landmark seam), and routes activation through the holder. Because the web source
/// has no data fetch there is no loading / empty / error / stale / offline chrome; the surface's states are the
/// resting (hidden) link, the focused (revealed) link, and the activation outcome (focus moved, or a safe no-op
/// when no landmark is present — the web <c>if (main)</c> guard). The reveal is an instant opacity change with no
/// animation, so it honours the reduce-motion preference by construction. The link carries the localized
/// accessible name and the <c>skip-to-content</c> automation id, and the surface emits the <c>view.opened</c>
/// diagnostic once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class SkipToContent : ContentControl, IDisposable
{
    private const double RevealedOpacity = 1.0;
    private const double HiddenOpacity = 0.0;
    private const double EdgeInset = 16.0;

    private readonly SkipToContentViewModel _viewModel;
    private readonly TsButton _link = new()
    {
        Variant = ButtonVariant.Primary,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(EdgeInset),
        Opacity = HiddenOpacity,
    };

    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// passthrough localizer and an inert landmark seam so the surface renders its resting state. Supply an
    /// explicit <see cref="ILocalizer"/> and a bound <see cref="ISkipTarget"/> via the other constructors to
    /// drive i18n and the main-content landmark from the composition root.
    /// </summary>
    public SkipToContent()
        : this(new SkipToContentViewModel(PassthroughLocalizer.Instance, NullSkipTarget.Instance))
    {
    }

    /// <summary>Creates the surface over the i18n facade and a bound landmark seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="target">The main-content landmark seam (web <c>document.getElementById('main-content')</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SkipToContent(
        ILocalizer localizer,
        ISkipTarget target,
        SkipToContentDiagnostics? diagnostics = null)
        : this(new SkipToContentViewModel(localizer, target, diagnostics))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public SkipToContent(SkipToContentViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);

        _link.Text = _viewModel.Label;

        // The link is the accessible, focusable bypass-blocks control: name it and give it the web data-testid so
        // Narrator and UI automation resolve it.
        AutomationProperties.SetName(_link, _viewModel.Label);
        AutomationProperties.SetAutomationId(_link, SkipToContentRegistration.LinkAutomationId);

        // Visually hidden until focused, revealed on focus (the web `focus:` utilities); an instant opacity
        // change keeps it reduce-motion-safe.
        _link.GotFocus += OnLinkGotFocus;
        _link.LostFocus += OnLinkLostFocus;
        _link.Click += OnLinkClick;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _link;
    }

    /// <summary>The canonical surface slug (<c>SkipToContent</c>).</summary>
    public static string Slug => SkipToContentRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SkipToContentViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _link.GotFocus -= OnLinkGotFocus;
        _link.LostFocus -= OnLinkLostFocus;
        _link.Click -= OnLinkClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.MarkOpened();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnLinkGotFocus(object sender, RoutedEventArgs e) => _link.Opacity = RevealedOpacity;

    private void OnLinkLostFocus(object sender, RoutedEventArgs e) => _link.Opacity = HiddenOpacity;

    private void OnLinkClick(object sender, RoutedEventArgs e) => _ = _viewModel.Activate();
}

/// <summary>
/// The production <see cref="ISkipTarget"/> — wraps the WinUI main-content landmark control. Reports
/// <see cref="IsAvailable"/> true and moves focus to the control (the web <c>main.focus(...)</c>) while bringing
/// it into view (the web <c>main.scrollIntoView(...)</c>). The composition root constructs one over the shell's
/// main-content region; when no region exists it uses <see cref="NullSkipTarget"/> instead.
/// </summary>
public sealed class ControlSkipTarget : ISkipTarget
{
    private readonly Control _landmark;

    /// <summary>Creates the adapter over the main-content landmark control.</summary>
    /// <param name="landmark">The control focus jumps to (the shell's main-content region).</param>
    public ControlSkipTarget(Control landmark)
    {
        ArgumentNullException.ThrowIfNull(landmark);
        _landmark = landmark;
    }

    /// <inheritdoc />
    public bool IsAvailable => true;

    /// <inheritdoc />
    public void Focus()
    {
        _ = _landmark.Focus(FocusState.Programmatic);
        _landmark.StartBringIntoView();
    }
}
