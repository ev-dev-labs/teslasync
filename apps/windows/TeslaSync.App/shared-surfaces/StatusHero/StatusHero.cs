using System.Numerics;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces.StatusHeroSurface;

/// <summary>
/// The native WinUI 3 <c>StatusHero</c> shared surface — a parity port of
/// <c>web/src/components/status/StatusHero.tsx</c>. It is the large at-a-glance health card that answers "is my
/// instance healthy?" in under a second: a translucent <see cref="TsGlassPanel"/> carrying a status-tinted icon
/// circle, a bold status-coloured headline, an optional sub-line (with an optional "Live" affordance), and an
/// optional call-to-action button. Assign a <see cref="Model"/> (the web <c>status</c> / <c>headline</c> /
/// <c>subline</c> / <c>live</c> / <c>cta</c> / <c>id</c> props) and it renders the matching state.
///
/// The web component is purely presentational and prop-driven — its parent (the System Status page hero, an
/// incident page, an embedded dashboard summary) owns any data fetching — so, exactly like React re-rendering the
/// element with already-resolved props, it has no fetch-driven loading / error / stale / offline chrome. The
/// branches it reproduces are the five status variants (each always rendered, never hidden — the
/// <see cref="HeroStatus.Unknown"/> variant is the friendly empty state), the optional subline, the optional live
/// affordance (shown only when a subline is present, mirroring the web nesting), and the optional call-to-action.
/// All derivation — the headline resolution, the accent token, the icon glyph, the live / CTA gates and the
/// accessible name — happens in the WinUI-free <see cref="StatusHeroProjection"/>.
///
/// The accent (icon foreground, icon-circle tint + ring, headline and the panel frame) is the generated design
/// token for the status, so light / dark / high-contrast all flow from the token set. The web
/// <c>boxShadow: 0 0 60px rgba(...)</c> status glow is reproduced the Windows-idiomatic way: the panel frame is
/// tinted with the status accent and the card is given a Fluent elevation shadow, rather than a literal CSS
/// blur. The icon circle is decorative (the web <c>aria-hidden</c>); the headline + subline form a polite status
/// live region (the web <c>role="status"</c> / <c>aria-live="polite"</c>) so Narrator announces status changes;
/// the call-to-action carries its own accessible name. The surface emits the <c>view.opened</c> diagnostic once
/// when it is shown.
/// </summary>
public sealed partial class StatusHero : ContentControl
{
    private const double PanelPadding = 20;        // web p-5
    private const double ColumnSpacing = 24;       // web md:gap-6
    private const double IconCircleSize = 56;      // web h-14 w-14
    private const double IconRingThickness = 2;    // web ring-2
    private const double IconFontSize = 28;        // web h-7 w-7
    private const double HeadlineFontSize = 24;    // web md:text-2xl
    private const double SublineFontSize = 14;     // web text-sm
    private const double LiveLabelFontSize = 12;   // web text-xs
    private const double TextColumnSpacing = 8;    // web space-y-2
    private const double SublineSpacing = 12;      // web gap-x-3
    private const double LiveSpacing = 6;          // web gap-1.5
    private const double LiveDotSize = 8;          // web LiveIndicator dot h-2 w-2
    private const int LiveLabelTracking = 80;      // web tracking-wider (1/1000 em)
    private const double ShadowDepth = 16;         // Fluent elevation behind the card

    private readonly ILocalizer _localizer;
    private readonly StatusHeroDiagnostics _diagnostics;

    private StatusHeroModel _model;
    private bool _opened;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): strings
    /// resolve through the passthrough localizer and it renders the <see cref="HeroStatus.Unknown"/> state. Supply
    /// an explicit <see cref="ILocalizer"/> and a <see cref="StatusHeroModel"/> via the other constructor to drive
    /// i18n and content from the composition root.
    /// </summary>
    public StatusHero()
        : this(PassthroughLocalizer.Instance, StatusHeroModel.Unknown, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every visible string resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="StatusHeroModel.Unknown"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StatusHero(
        ILocalizer localizer,
        StatusHeroModel? model = null,
        StatusHeroDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? StatusHeroModel.Unknown;
        _diagnostics = diagnostics ?? new StatusHeroDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the call-to-action button is invoked (the web <c>cta.onClick</c>); the host wires the action.</summary>
    public event EventHandler? CtaInvoked;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StatusHero</c>).</summary>
    public static string Slug => StatusHeroRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public StatusHeroModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The polite-status accessible name the surface announces (web role="status" content).</summary>
    internal string AccessibleName => StatusHeroProjection.Project(_model, _localizer).AutomationName;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        StatusHeroDisplay display = StatusHeroProjection.Project(_model, _localizer);
        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);

        var grid = new Grid
        {
            VerticalAlignment = VerticalAlignment.Center,
            ColumnSpacing = ColumnSpacing,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Border iconCircle = BuildIconCircle(display, accent);
        Grid.SetColumn(iconCircle, 0);
        grid.Children.Add(iconCircle);

        StackPanel statusRegion = BuildStatusRegion(display, accent);
        Grid.SetColumn(statusRegion, 1);
        grid.Children.Add(statusRegion);

        if (display.HasCta)
        {
            TsButton cta = BuildCta(display);
            Grid.SetColumn(cta, 2);
            grid.Children.Add(cta);
        }

        // web GlassPanel + boxShadow glow → a token-framed glass panel: the accent tints the frame (the status
        // glow) and a Fluent elevation shadow lifts the card, the Windows-idiomatic stand-in for the CSS blur.
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            BorderBrush = accent,
            Content = grid,
            Translation = new Vector3(0, 0, (float)ShadowDepth),
            Shadow = new ThemeShadow(),
        };

        AutomationProperties.SetAutomationId(this, display.AutomationId);
        Content = panel;
    }

    private static Border BuildIconCircle(StatusHeroDisplay display, Brush accent)
    {
        // web: h-14 w-14 rounded-full ring-2, bg-{c}-500/15 tint + ring-{c}-500/40, icon text-{c}-400 h-7 w-7.
        var circle = new Border
        {
            Width = IconCircleSize,
            Height = IconCircleSize,
            CornerRadius = new CornerRadius(IconCircleSize / 2),
            Background = Tint(accent, StatusHeroRegistration.TintAlpha),
            BorderBrush = Tint(accent, StatusHeroRegistration.RingAlpha),
            BorderThickness = new Thickness(IconRingThickness),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = display.IconGlyph,
                FontSize = IconFontSize,
                Foreground = accent,
            },
        };

        // web aria-hidden: the icon circle is decorative; the status region carries the announcement.
        AutomationProperties.SetAccessibilityView(circle, AccessibilityView.Raw);
        return circle;
    }

    private static StackPanel BuildStatusRegion(StatusHeroDisplay display, Brush accent)
    {
        var column = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = TextColumnSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.Headline,
            FontSize = HeadlineFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            TextWrapping = TextWrapping.Wrap,
        });

        if (display.HasSubline)
        {
            var sublineRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = SublineSpacing,
                VerticalAlignment = VerticalAlignment.Center,
            };

            sublineRow.Children.Add(new TextBlock
            {
                Text = display.Subline,
                FontSize = SublineFontSize,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
            });

            if (display.ShowLive)
            {
                sublineRow.Children.Add(BuildLiveAffordance(display));
            }

            column.Children.Add(sublineRow);
        }

        // web role="status" (⇒ implicit aria-live="polite"): a polite live region named with the status text.
        AutomationProperties.SetLiveSetting(column, AutomationLiveSetting.Polite);
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static StackPanel BuildLiveAffordance(StatusHeroDisplay display)
    {
        // web: <LiveIndicator variant="dot" /> + an uppercase, tracked "Live" caption. StatusHero is presentational
        // (no live-connection source), so the affordance is the connected dot + label, not a bound indicator.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LiveSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new Ellipse
        {
            Width = LiveDotSize,
            Height = LiveDotSize,
            Fill = DisplayTokens.Brush(StatusHeroRegistration.LiveDotBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });

        row.Children.Add(new TextBlock
        {
            Text = display.LiveLabel.ToUpperInvariant(),
            FontSize = LiveLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = LiveLabelTracking,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // The dot + label echo the live region's name; keep them out of the Narrator control view.
        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private TsButton BuildCta(StatusHeroDisplay display)
    {
        // web Button variant="primary" size="md" with a RefreshCw icon that spins + disables while loading.
        var button = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Medium,
            Text = display.CtaLabel,
            IconGlyph = display.CtaGlyph,
            IsLoading = display.CtaLoading,
            VerticalAlignment = VerticalAlignment.Center,
        };

        button.Click += OnCtaClick;
        return button;
    }

    private void OnCtaClick(object sender, RoutedEventArgs e) => CtaInvoked?.Invoke(this, EventArgs.Empty);

    private static Brush Tint(Brush source, double alpha)
    {
        if (source is SolidColorBrush scb)
        {
            byte a = (byte)Math.Clamp(alpha * 255, 0, 255);
            return new SolidColorBrush(Windows.UI.Color.FromArgb(a, scb.Color.R, scb.Color.G, scb.Color.B));
        }

        return source;
    }
}
