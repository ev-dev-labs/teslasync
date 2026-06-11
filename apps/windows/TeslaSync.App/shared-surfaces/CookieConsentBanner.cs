using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>CookieConsentBanner</c> shared surface — a parity port of the web
/// <c>CookieConsentBanner</c> export (web/src/components/feedback/CookieConsentBanner.tsx). It is the
/// non-blocking GDPR consent dialog anchored at the bottom of the viewport: a translucent
/// <see cref="TsGlassPanel"/> card carrying a Segoe Fluent shield glyph (standing in for the web Lucide
/// <c>ShieldCheck</c>), the localized title + body, a "Manage preferences" toggle that expands two inline consent
/// categories (strictly-necessary with an "Always on" <see cref="TsBadge"/>, and performance/error reporting), and
/// the "Accept all" (<see cref="ButtonVariant.Primary"/>) / "Decline non-essential" (<see cref="ButtonVariant.Subtle"/>)
/// actions. It binds the <see cref="CookieConsentBannerViewModel"/> (over the P1/S8
/// <see cref="ICookieConsentRequirementSource"/> + <see cref="ICookieConsentStore"/>) and is shown only when
/// consent is required and the user has not yet decided (the web <c>requireConsent &amp;&amp; consent === 'unknown'</c>
/// gate); accepting or declining persists the decision through the store, which re-renders the banner away. It is
/// announced to Narrator as a non-modal dialog named by the title and described by the body (the web
/// <c>role="dialog"</c> / <c>aria-modal="false"</c> / <c>aria-labelledby</c> / <c>aria-describedby</c>), performs
/// no I/O of its own, and emits the <c>view.opened</c> diagnostic once when first shown.
///
/// <para>
/// State coverage: the web source has no loading / error / stale / offline chrome of its own — the deployment
/// requirement is consumed as a flag that defaults to "not required" (the banner hidden) while the version query
/// is loading, absent or failed (the web <c>Boolean(data?.require_cookie_consent)</c> coercion), so those
/// data-source lifecycle states collapse to the hidden state, which is reproduced and tested. The states the web
/// actually has are reproduced in full: hidden (not required, or already decided), visible (the consent prompt),
/// the collapsed vs expanded details block (the toggle), and the two consent categories. The surface uses no
/// entrance / transition animation (matching the web, which simply mounts), so the OS reduce-motion preference is
/// honoured by construction.
/// </para>
/// </summary>
public sealed partial class CookieConsentBanner : ContentControl, IDisposable
{
    private const double MaxCardWidth = 768;     // web max-w-3xl (48rem).
    private const double CardPadding = 20;       // web p-5.
    private const double CardCornerRadius = 16;  // web rounded-2xl.
    private const double IconChipSize = 36;      // web h-9 w-9.
    private const double IconChipCornerRadius = 12; // web rounded-xl.
    private const double IconFontSize = 16;      // web ShieldCheck h-4 w-4.
    private const double TitleFontSize = 14;     // web text-sm.
    private const double BodyFontSize = 12;      // web text-xs.
    private const double CategoryFontSize = 11;  // web text-[11px].
    private const double CategoryPadding = 12;   // web p-3.
    private const double CategoryCornerRadius = 8; // web rounded-lg.
    private const double IconTintOpacity = 0.10; // web bg-neon-cyan/10.
    private const double IconRingOpacity = 0.20; // web ring-neon-cyan/20.

    private readonly CookieConsentBannerViewModel _viewModel;
    private readonly CookieConsentBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly TsGlassPanel _card = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Bottom,
        MaxWidth = MaxCardWidth,
        Padding = new Thickness(CardPadding),
        CornerRadius = new CornerRadius(CardCornerRadius),
    };

    private readonly Border _iconChip = new()
    {
        Width = IconChipSize,
        Height = IconChipSize,
        CornerRadius = new CornerRadius(IconChipCornerRadius),
        BorderThickness = new Thickness(1),
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = CookieConsentBannerRegistration.ShieldGlyph,
        FontSize = IconFontSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private readonly HyperlinkButton _toggle = new()
    {
        Padding = new Thickness(0, 4, 0, 0),
        Margin = new Thickness(0, 8, 0, 0),
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private readonly StackPanel _details = new()
    {
        Spacing = 8,
        Margin = new Thickness(0, 12, 0, 0),
        Visibility = Visibility.Collapsed,
    };

    private readonly Border _essentialCard = new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(CategoryCornerRadius),
        Padding = new Thickness(CategoryPadding),
    };

    private readonly TextBlock _essentialTitle = new()
    {
        FontSize = CategoryFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _essentialBadge = new()
    {
        Status = StatusKind.Success,
        Margin = new Thickness(8, 0, 0, 0),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _essentialBody = new()
    {
        FontSize = CategoryFontSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private readonly Border _analyticsCard = new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(CategoryCornerRadius),
        Padding = new Thickness(CategoryPadding),
    };

    private readonly TextBlock _analyticsTitle = new()
    {
        FontSize = CategoryFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _analyticsBody = new()
    {
        FontSize = CategoryFontSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private readonly TsButton _accept = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Medium,
    };

    private readonly TsButton _decline = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Medium,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe banner with no composition root (the designer / parameterless host entry point): it
    /// binds a static "consent required" requirement and an unknown-decision store over the passthrough localizer
    /// so the surface renders its visible prompt state. Supply explicit seams via the other constructors to drive
    /// i18n, the deployment requirement and the stored decision from the composition root.
    /// </summary>
    public CookieConsentBanner()
        : this(
            PassthroughLocalizer.Instance,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            new InMemoryCookieConsentStore(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and the two bound P1/S8 seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="requirement">The deployment consent-requirement seam (web <c>useVersionInfo()</c>).</param>
    /// <param name="store">The consent-decision storage seam (web <c>cookieConsent</c> helper).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CookieConsentBanner(
        ILocalizer localizer,
        ICookieConsentRequirementSource requirement,
        ICookieConsentStore store,
        CookieConsentBannerDiagnostics? diagnostics = null)
        : this(new CookieConsentBannerViewModel(localizer, requirement, store), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CookieConsentBanner(CookieConsentBannerViewModel viewModel, CookieConsentBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new CookieConsentBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Padding = new Thickness(16, 0, 16, 16); // web px-4 pb-4.
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, CookieConsentBannerRegistration.BannerAutomationId);

        _toggle.Click += OnToggleClicked;
        _accept.Click += OnAcceptClicked;
        _decline.Click += OnDeclineClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>CookieConsentBanner</c>).</summary>
    public static string Slug => CookieConsentBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public CookieConsentBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the banner title).</summary>
    internal string AccessibleName => _viewModel.Projection.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _toggle.Click -= OnToggleClicked;
        _accept.Click -= OnAcceptClicked;
        _decline.Click -= OnDeclineClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new CookieConsentBannerAutomationPeer(this);

    private void BuildTree()
    {
        _iconChip.Background = AccentTint(IconTintOpacity);
        _iconChip.BorderBrush = AccentTint(IconRingOpacity);
        _icon.Foreground = DisplayTokens.Accent;
        _iconChip.Child = _icon;

        _title.Foreground = DisplayTokens.TextPrimary;
        _body.Foreground = DisplayTokens.TextSecondary;

        // Essential category card (web surface-2 panel with the "Always on" chip).
        var essentialHeader = new StackPanel { Orientation = Orientation.Horizontal };
        _essentialTitle.Foreground = DisplayTokens.TextPrimary;
        essentialHeader.Children.Add(_essentialTitle);
        essentialHeader.Children.Add(_essentialBadge);
        _essentialBody.Foreground = DisplayTokens.TextMuted;
        var essentialStack = new StackPanel();
        essentialStack.Children.Add(essentialHeader);
        essentialStack.Children.Add(_essentialBody);
        _essentialCard.Background = DisplayTokens.Brush("TsColorBgBrush");
        _essentialCard.BorderBrush = DisplayTokens.Border;
        _essentialCard.Child = essentialStack;

        // Analytics category card (web surface-2 panel).
        _analyticsTitle.Foreground = DisplayTokens.TextPrimary;
        _analyticsBody.Foreground = DisplayTokens.TextMuted;
        var analyticsStack = new StackPanel();
        analyticsStack.Children.Add(_analyticsTitle);
        analyticsStack.Children.Add(_analyticsBody);
        _analyticsCard.Background = DisplayTokens.Brush("TsColorBgBrush");
        _analyticsCard.BorderBrush = DisplayTokens.Border;
        _analyticsCard.Child = analyticsStack;

        _details.Children.Add(_essentialCard);
        _details.Children.Add(_analyticsCard);
        AutomationProperties.SetAutomationId(_details, CookieConsentBannerRegistration.DetailsAutomationId);

        // Action row (web Accept all + Decline non-essential).
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(0, 16, 0, 0),
        };
        AutomationProperties.SetAutomationId(_accept, CookieConsentBannerRegistration.AcceptAutomationId);
        AutomationProperties.SetAutomationId(_decline, CookieConsentBannerRegistration.DeclineAutomationId);
        actions.Children.Add(_accept);
        actions.Children.Add(_decline);

        AutomationProperties.SetAutomationId(_toggle, CookieConsentBannerRegistration.ToggleDetailsAutomationId);

        // Content column to the right of the shield chip (web flex-1 min-w-0 stack).
        var column = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(_title);
        column.Children.Add(_body);
        column.Children.Add(_toggle);
        column.Children.Add(_details);
        column.Children.Add(actions);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
        };
        row.Children.Add(_iconChip);
        row.Children.Add(column);

        // The shield chip is decorative; the dialog's Narrator name (the title) is authoritative.
        AutomationProperties.SetAccessibilityView(_iconChip, AccessibilityView.Raw);

        _card.Content = row;
    }

    private void OnToggleClicked(object sender, RoutedEventArgs e) => _viewModel.ToggleDetails();

    private void OnAcceptClicked(object sender, RoutedEventArgs e) => _viewModel.Accept();

    private void OnDeclineClicked(object sender, RoutedEventArgs e) => _viewModel.Decline();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.IsVisible)
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

        _title.Text = projection.Title;
        _body.Text = projection.Body;

        _toggle.Content = projection.ToggleLabel;
        AutomationProperties.SetName(_toggle, projection.ToggleLabel);

        _details.Visibility = projection.ShowDetails ? Visibility.Visible : Visibility.Collapsed;

        _essentialTitle.Text = projection.EssentialTitle;
        _essentialBadge.Content = projection.EssentialAlwaysOnLabel;
        AutomationProperties.SetName(_essentialBadge, projection.EssentialAlwaysOnLabel);
        _essentialBody.Text = projection.EssentialBody;

        _analyticsTitle.Text = projection.AnalyticsTitle;
        _analyticsBody.Text = projection.AnalyticsBody;

        _accept.Text = projection.AcceptLabel;
        AutomationProperties.SetName(_accept, projection.AcceptLabel);
        _decline.Text = projection.DeclineLabel;
        AutomationProperties.SetName(_decline, projection.DeclineLabel);

        // web role="dialog" aria-labelledby={title} aria-describedby={body}.
        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetFullDescription(this, projection.Description);

        // web: returns null when not (requireConsent && consent === 'unknown'); the surface collapses entirely.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;
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

    private static SolidColorBrush AccentTint(double opacity) =>
        new(ResolveAccentColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveAccentColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue("TsColorAccentColor", out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the accent brush's colour so the chip still tints when the colour token is absent.
        return DisplayTokens.Accent is SolidColorBrush brush ? brush.Color : Microsoft.UI.Colors.SteelBlue;
    }

    private sealed class CookieConsentBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public CookieConsentBannerAutomationPeer(CookieConsentBanner owner)
            : base(owner)
        {
        }

        private CookieConsentBanner Surface => (CookieConsentBanner)Owner;

        // web role="dialog": surfaced as a named landmark group (WinUI has no dedicated dialog control type for
        // an in-page, non-modal region); the title is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
