using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>RequiresAuth</c> shared surface — a parity port of the web <c>RequiresAuth</c> wrapper
/// (web/src/components/feedback/RequiresAuth.tsx). It wraps an auth-coupled section and mounts the section's content
/// only when the deployment is in forward-auth mode AND the section's capability flag is enabled (the web
/// <c>mode === 'forward_auth' &amp;&amp; capabilities[capability]</c> branch); otherwise — open mode, the capability
/// disabled, OR a still-unresolved contract (the web <c>isLoading || !data</c> guard, which never flashes the
/// children before hiding them) — it renders a centred, Fluent-styled gated notice: a muted Segoe Fluent lock glyph
/// (standing in for the web Lucide <c>LockKeyhole</c>), the localized "{feature} requires authentication mode" title,
/// and the vendor-neutral body explaining what to configure (surfacing the operator-supplied provider hint verbatim
/// when present). All contract state flows through the shared <see cref="RequiresAuthViewModel"/> over the P1/S8
/// <see cref="IAuthModeSource"/> seam — the view issues no HTTP. The gated notice is a polite status live region
/// carrying the stable per-capability automation id (the web <c>requires-auth-empty-{capability}</c> test id) and
/// named with the title + body so Narrator announces it. The surface has no entrance animation (mirroring the web
/// wrapper), so the OS reduce-motion preference is honoured by construction. It emits the <c>view.opened</c>
/// diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class RequiresAuth : ContentControl, IDisposable
{
    private const double IconFontSize = 28;             // web LockKeyhole h-8 w-8
    private const double TitleFontSize = 16;            // web panelTitle (text-base)
    private const double BodyFontSize = 12;             // web bodySm (text-xs)
    private const double SectionSpacing = 12;           // web gap-3
    private const double NoticePadH = 24;               // web px-6
    private const double NoticePadV = 48;               // web py-12
    private const double NoticeCornerRadius = 8;        // web rounded-lg
    private const double NoticeBorderThickness = 1;     // web border
    private const double BodyMaxWidth = 448;            // web max-w-md (28rem)
    private const double NoticeBackgroundOpacity = 0.4; // web bg-[var(--bg-elevated)]/40

    private readonly RequiresAuthViewModel _viewModel;
    private readonly RequiresAuthDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _notice = new()
    {
        Padding = new Thickness(NoticePadH, NoticePadV, NoticePadH, NoticePadV),
        BorderThickness = new Thickness(NoticeBorderThickness),
        CornerRadius = new CornerRadius(NoticeCornerRadius),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly StackPanel _column = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = SectionSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = RequiresAuthRegistration.LockGlyph,
        FontSize = IconFontSize,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        MaxWidth = BodyMaxWidth,
    };

    private UIElement? _child;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the wrapper over the i18n facade, the auth-mode seam, the capability, and the gated content.</summary>
    /// <param name="localizer">The i18n facade the title / body / feature-name strings resolve through.</param>
    /// <param name="source">The auth-mode contract seam (web <c>useAuthMode()</c>).</param>
    /// <param name="capability">The capability the wrapped section needs (web <c>capability</c>).</param>
    /// <param name="feature">An already-localized feature name, or null to resolve it from the catalogue.</param>
    /// <param name="child">The section content rendered when the capability is available (web <c>children</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RequiresAuth(
        ILocalizer localizer,
        IAuthModeSource source,
        RequiresAuthCapability capability,
        string? feature = null,
        UIElement? child = null,
        RequiresAuthDiagnostics? diagnostics = null)
        : this(new RequiresAuthViewModel(localizer, source, capability, feature), child, diagnostics)
    {
    }

    /// <summary>Creates the wrapper over an explicit state holder (tests / headless hosts), gated content, and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="child">The section content rendered when the capability is available (web <c>children</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RequiresAuth(
        RequiresAuthViewModel viewModel,
        UIElement? child = null,
        RequiresAuthDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new RequiresAuthDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _child = child;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Padding = new Thickness(0);

        _column.Children.Add(_icon);
        _column.Children.Add(_title);
        _column.Children.Add(_body);
        _notice.Child = _column;

        // The lock glyph is decorative (web aria-hidden); the control's name (title + body) is authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        // web role="status": a polite status live region for the gated notice.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Compose the wrapper over the gated content — the native analogue of <c>&lt;RequiresAuth&gt;{children}&lt;/RequiresAuth&gt;</c>.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="source">The auth-mode contract seam.</param>
    /// <param name="capability">The capability the wrapped section needs.</param>
    /// <param name="child">The section content rendered when the capability is available.</param>
    /// <param name="feature">An already-localized feature name, or null to resolve it from the catalogue.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A composed wrapper surface.</returns>
    public static RequiresAuth Wrap(
        ILocalizer localizer,
        IAuthModeSource source,
        RequiresAuthCapability capability,
        UIElement child,
        string? feature = null,
        RequiresAuthDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(child);
        return new RequiresAuth(localizer, source, capability, feature, child, diagnostics);
    }

    /// <summary>The canonical surface slug (<c>RequiresAuth</c>).</summary>
    public static string Slug => RequiresAuthRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RequiresAuthViewModel ViewModel => _viewModel;

    /// <summary>The capability the wrapped section needs (web <c>capability</c>).</summary>
    public RequiresAuthCapability Capability => _viewModel.Capability;

    /// <summary>The composed accessible name the automation peer reports for the gated notice (title + body).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>
    /// The section content guarded by the capability gate (web <c>children</c>). Reassigning re-renders, so a host
    /// can supply the content after construction; it is only attached while the gate is open.
    /// </summary>
    public UIElement? Child
    {
        get => _child;
        set
        {
            if (ReferenceEquals(_child, value))
            {
                return;
            }

            _child = value;
            Render();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RequiresAuthAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        _ready = true;

        if (!_viewModel.ShowChildren)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        if (projection.ShowChildren)
        {
            // forward-auth + capability enabled → mount the section; the wrapper stays transparent so the inner
            // content carries every visual + accessible semantic (the web returns <>{children}</>).
            if (!ReferenceEquals(Content, _child))
            {
                Content = _child;
            }

            AutomationProperties.SetAutomationId(this, string.Empty);
            AutomationProperties.SetName(this, string.Empty);
            return;
        }

        // Gated: render the notice (open mode, the capability disabled, or a still-unresolved contract).
        _icon.Foreground = DisplayTokens.TextMuted;
        _title.Foreground = DisplayTokens.TextPrimary;
        _title.Text = projection.Title;
        _body.Foreground = DisplayTokens.TextSecondary;
        _body.Text = projection.Body;
        _notice.Background = BuildNoticeBackground();
        _notice.BorderBrush = DisplayTokens.Border;

        if (!ReferenceEquals(Content, _notice))
        {
            Content = _notice;
        }

        AutomationProperties.SetAutomationId(this, projection.EmptyAutomationId);
        AutomationProperties.SetName(this, projection.AccessibleName);

        if (_ready)
        {
            LiveRegion.Announce(this);
        }
    }

    private static SolidColorBrush BuildNoticeBackground()
    {
        // web bg-[var(--bg-elevated)]/40: the elevated surface token at 40% alpha. Derive from the resolved surface
        // brush so light / dark / high-contrast all flow from the W1 token dictionary; fall back to transparent.
        if (DisplayTokens.Surface is SolidColorBrush surface)
        {
            return new SolidColorBrush(surface.Color) { Opacity = NoticeBackgroundOpacity };
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
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

    /// <summary>
    /// The automation peer: a named read-only Text region while the gated notice is shown (so Narrator announces the
    /// title + body), and a transparent, nameless group while the wrapped children are mounted (the inner content
    /// then carries the accessible semantics, mirroring the web bare fragment).
    /// </summary>
    private sealed class RequiresAuthAutomationPeer : FrameworkElementAutomationPeer
    {
        public RequiresAuthAutomationPeer(RequiresAuth owner)
            : base(owner)
        {
        }

        private RequiresAuth Surface => (RequiresAuth)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            Surface.ViewModel.ShowChildren ? AutomationControlType.Group : AutomationControlType.Text;

        protected override string GetNameCore()
        {
            if (Surface.ViewModel.ShowChildren)
            {
                return base.GetNameCore();
            }

            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
