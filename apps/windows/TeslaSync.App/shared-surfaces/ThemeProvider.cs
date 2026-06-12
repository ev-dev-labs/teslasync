using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces.ThemeProviderSurface;

/// <summary>
/// The native WinUI 3 context bridge for the theme — the parity port of the React context exported by
/// <c>web/src/components/ui/ThemeProvider.tsx</c> (the value <c>useTheme()</c> reads). The web module exports a
/// context whose value is the live <see cref="IThemeContext"/>; a descendant reads it with
/// <c>useContext(ThemeContext)</c>. WinUI has no React context, so the nearest-ancestor lookup is reproduced
/// with an attached <see cref="ControllerProperty"/> the <see cref="ThemeProvider"/> sets on itself and the
/// tree-walking reader <see cref="GetNearest"/> — the exact semantics of <c>useContext</c> (nearest provider,
/// else <c>null</c>, which the web <c>useTheme</c> turns into a thrown "must be used within ThemeProvider").
/// </summary>
public static class ThemeProviderContext
{
    /// <summary>
    /// The attached context value the provider sets on itself (the React context value). Read the nearest
    /// ancestor's value with <see cref="GetNearest"/> rather than this raw accessor, which returns only an
    /// element's own local value.
    /// </summary>
    public static readonly DependencyProperty ControllerProperty = DependencyProperty.RegisterAttached(
        "Controller",
        typeof(IThemeContext),
        typeof(ThemeProviderContext),
        new PropertyMetadata(null));

    /// <summary>Set the provided theme context on <paramref name="element"/> (the provider sets this on itself).</summary>
    /// <param name="element">The element that provides the context (the provider).</param>
    /// <param name="value">The theme context to provide.</param>
    public static void SetController(DependencyObject element, IThemeContext? value)
    {
        ArgumentNullException.ThrowIfNull(element);
        element.SetValue(ControllerProperty, value);
    }

    /// <summary>Read an element's own provided theme context (its local attached value); <c>null</c> when it provides none.</summary>
    /// <param name="element">The element to read the local provided value from.</param>
    public static IThemeContext? GetController(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);
        return (IThemeContext?)element.GetValue(ControllerProperty);
    }

    /// <summary>
    /// Read the theme context from the nearest ancestor provider (web <c>useContext(ThemeContext)</c>). Walks up
    /// the visual tree, falling back to the logical parent, and returns the first provided context — or
    /// <c>null</c> when no provider is in scope (the web default context value, which <c>useTheme</c> rejects).
    /// </summary>
    /// <param name="element">The element reading the context (e.g. a settings page).</param>
    public static IThemeContext? GetNearest(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);

        DependencyObject? current = element;
        while (current is not null)
        {
            if (GetController(current) is { } controller)
            {
                return controller;
            }

            current = GetParentObject(current);
        }

        return null;
    }

    private static DependencyObject? GetParentObject(DependencyObject element)
    {
        DependencyObject? parent = VisualTreeHelper.GetParent(element);
        if (parent is not null)
        {
            return parent;
        }

        // Before the element is in the live visual tree, fall back to the logical parent so the lookup still
        // resolves the provider (e.g. during template realisation or in a detached subtree).
        return element is FrameworkElement frameworkElement ? frameworkElement.Parent : null;
    }
}

/// <summary>
/// The framework-resource keys the <see cref="ThemeProvider"/> publishes into its subtree
/// <see cref="FrameworkElement.Resources"/> — the native analogue of the CSS custom properties the web
/// <c>applyThemeCSS</c> sets on <c>document.documentElement</c>. A descendant binds a brush with
/// <c>{{ThemeResource ThemeProviderPrimaryBrush}}</c> the way web styles read <c>var(--theme-primary)</c>.
/// </summary>
public static class ThemeProviderResourceKeys
{
    /// <summary>The primary colour brush (web <c>--theme-primary</c>).</summary>
    public const string PrimaryBrush = "ThemeProviderPrimaryBrush";

    /// <summary>The accent colour brush (web <c>--theme-accent</c>).</summary>
    public const string AccentBrush = "ThemeProviderAccentBrush";

    /// <summary>The page-background brush (web <c>--bg</c>).</summary>
    public const string BackgroundBrush = "ThemeProviderBackgroundBrush";

    /// <summary>The first-surface brush (web <c>--surface-1</c>).</summary>
    public const string Surface1Brush = "ThemeProviderSurface1Brush";

    /// <summary>The second-surface brush (web <c>--surface-2</c>).</summary>
    public const string Surface2Brush = "ThemeProviderSurface2Brush";

    /// <summary>The third-surface brush (web <c>--surface-3</c>).</summary>
    public const string Surface3Brush = "ThemeProviderSurface3Brush";

    /// <summary>The translucent glass-fill brush (web <c>--glass-bg</c>).</summary>
    public const string GlassBackgroundBrush = "ThemeProviderGlassBackgroundBrush";

    /// <summary>The translucent glass-border brush (web <c>--glass-border</c>).</summary>
    public const string GlassBorderBrush = "ThemeProviderGlassBorderBrush";

    /// <summary>The primary-text brush (web <c>--text-primary</c>).</summary>
    public const string TextPrimaryBrush = "ThemeProviderTextPrimaryBrush";

    /// <summary>The secondary-text brush (web <c>--text-secondary</c>).</summary>
    public const string TextSecondaryBrush = "ThemeProviderTextSecondaryBrush";

    /// <summary>The muted-text brush (web <c>--text-muted</c>).</summary>
    public const string TextMutedBrush = "ThemeProviderTextMutedBrush";
}

/// <summary>
/// The native WinUI 3 theme provider — the parity port of the web <c>ThemeProvider</c>
/// (<c>web/src/components/ui/ThemeProvider.tsx</c>). It wraps the app's content and, like the web provider:
/// <list type="bullet">
///   <item><description>resolves the active palette from a <see cref="ThemeController"/> (the
///     <c>useTheme</c> state) bound to the four P1/S8 seams;</description></item>
///   <item><description>applies that palette — the native analogue of <c>applyThemeCSS</c> — by publishing the
///     resolved brushes into its subtree <see cref="FrameworkElement.Resources"/> (keyed by
///     <see cref="ThemeProviderResourceKeys"/>), painting its <see cref="Control.Background"/> with the mode
///     background (web <c>document.body.style.background</c>) and setting
///     <see cref="FrameworkElement.RequestedTheme"/> to dark/light (web <c>color-scheme</c> + <c>dark</c> class);</description></item>
///   <item><description>kicks off the one-shot backend settings load on mount (web mount effect);</description></item>
///   <item><description>provides the live context to descendants through <see cref="ThemeProviderContext"/> so a
///     page reads it with <see cref="ThemeProviderContext.GetNearest"/> (web <c>useTheme</c>).</description></item>
/// </list>
/// Like the web provider it is a transparent wrapper: it renders its <see cref="ContentControl.Content"/>
/// unchanged and contributes no accessible node of its own (<see cref="AccessibilityView.Raw"/>), so Narrator
/// traverses straight to the hosted content. It emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class ThemeProvider : ContentControl
{
    private readonly ThemeController _controller;
    private readonly ThemeProviderDiagnostics _diagnostics;
    private readonly bool _ownsController;
    private bool _opened;
    private bool _initialized;

    /// <summary>Creates the provider over an all-local, no-backend headless seam bundle (the default host).</summary>
    public ThemeProvider()
        : this(ThemeProviderSeams.CreateHeadless())
    {
    }

    /// <summary>Creates the provider, building and owning a controller over <paramref name="seams"/>.</summary>
    /// <param name="seams">The four P1/S8 seams the controller binds to.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics collector.</param>
    public ThemeProvider(ThemeProviderSeams seams, ThemeProviderDiagnostics? diagnostics = null)
        : this(CreateOwnedController(seams, diagnostics ?? new ThemeProviderDiagnostics()), diagnostics, ownsController: true)
    {
    }

    /// <summary>
    /// Creates the provider over an externally-owned <paramref name="controller"/> (e.g. an app-wide controller
    /// shared across windows). The provider does not dispose a controller it does not own.
    /// </summary>
    /// <param name="controller">The theme controller to expose and render from.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public ThemeProvider(ThemeController controller, ThemeProviderDiagnostics? diagnostics = null)
        : this(controller, diagnostics, ownsController: false)
    {
    }

    private ThemeProvider(ThemeController controller, ThemeProviderDiagnostics? diagnostics, bool ownsController)
    {
        ArgumentNullException.ThrowIfNull(controller);

        _controller = controller;
        _diagnostics = diagnostics ?? new ThemeProviderDiagnostics();
        _ownsController = ownsController;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web provider renders a bare children fragment and adds no node of
        // its own, so hide the wrapper from Narrator and let the hosted content carry the semantics.
        AutomationProperties.SetAccessibilityView(
            this,
            ThemeProviderAccessibility.ProviderContributesAccessibleNode ? AccessibilityView.Content : AccessibilityView.Raw);

        // Expose the live context to descendants (web ThemeContext.Provider value).
        ThemeProviderContext.SetController(this, _controller);

        ApplyTokens();
        _controller.PropertyChanged += OnControllerPropertyChanged;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>ThemeProvider</c>).</summary>
    public static string Slug => ThemeProviderRegistration.Slug;

    /// <summary>The theme context this provider exposes to descendants (web <c>useTheme</c> value).</summary>
    public IThemeContext Controller => _controller;

    private static ThemeController CreateOwnedController(ThemeProviderSeams seams, ThemeProviderDiagnostics diagnostics)
    {
        ArgumentNullException.ThrowIfNull(seams);
        return new ThemeController(seams, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web provider mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (!_initialized)
        {
            _initialized = true;

            // web mount effect: fold backend settings in (best-effort, fire-and-forget).
            _ = _controller.InitializeAsync();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        Unloaded -= OnUnloaded;
        _controller.PropertyChanged -= OnControllerPropertyChanged;

        if (_ownsController)
        {
            _controller.Dispose();
        }
    }

    private void OnControllerPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (nameof(IThemeContext.AppliedTokens) or null or ""))
        {
            return;
        }

        // Seam callbacks (broadcast / OS scheme) may arrive off the UI thread; marshal the re-apply.
        if (DispatcherQueue is { } queue && !queue.HasThreadAccess)
        {
            queue.TryEnqueue(ApplyTokens);
            return;
        }

        ApplyTokens();
    }

    private void ApplyTokens()
    {
        AppliedThemeTokens tokens = _controller.AppliedTokens;

        SetBrush(ThemeProviderResourceKeys.PrimaryBrush, tokens.PrimaryHex);
        SetBrush(ThemeProviderResourceKeys.AccentBrush, tokens.AccentHex);
        SetBrush(ThemeProviderResourceKeys.BackgroundBrush, tokens.BackgroundHex);
        SetBrush(ThemeProviderResourceKeys.Surface1Brush, tokens.Surface1Hex);
        SetBrush(ThemeProviderResourceKeys.Surface2Brush, tokens.Surface2Hex);
        SetBrush(ThemeProviderResourceKeys.Surface3Brush, tokens.Surface3Hex);
        SetBrush(ThemeProviderResourceKeys.GlassBackgroundBrush, tokens.GlassBackground);
        SetBrush(ThemeProviderResourceKeys.GlassBorderBrush, tokens.GlassBorder);
        SetBrush(ThemeProviderResourceKeys.TextPrimaryBrush, tokens.TextPrimaryHex);
        SetBrush(ThemeProviderResourceKeys.TextSecondaryBrush, tokens.TextSecondaryHex);
        SetBrush(ThemeProviderResourceKeys.TextMutedBrush, tokens.TextMutedHex);

        // web: document.body.style.background = mode.bg.
        if (TryParseCssColor(tokens.BackgroundHex, out Color background))
        {
            Background = new SolidColorBrush(background);
        }

        // web: root color-scheme + dark/light-mode class toggle.
        RequestedTheme = tokens.IsDark ? ElementTheme.Dark : ElementTheme.Light;
    }

    private void SetBrush(string key, string cssColor)
    {
        if (TryParseCssColor(cssColor, out Color color))
        {
            Resources[key] = new SolidColorBrush(color);
        }
    }

    private static bool TryParseCssColor(string value, out Color color)
    {
        color = default;
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        if (value[0] == '#')
        {
            if (ThemeColor.TryParseHex(value, out byte r, out byte g, out byte b))
            {
                color = Color.FromArgb(byte.MaxValue, r, g, b);
                return true;
            }

            return false;
        }

        return TryParseRgbFunction(value, out color);
    }

    private static bool TryParseRgbFunction(string value, out Color color)
    {
        color = default;
        if (!value.StartsWith("rgb", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        int open = value.IndexOf('(', StringComparison.Ordinal);
        int close = value.IndexOf(')', StringComparison.Ordinal);
        if (open < 0 || close <= open)
        {
            return false;
        }

        string[] parts = value[(open + 1)..close].Split(',');
        if (parts.Length < 3)
        {
            return false;
        }

        if (!byte.TryParse(parts[0].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out byte r)
            || !byte.TryParse(parts[1].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out byte g)
            || !byte.TryParse(parts[2].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out byte b))
        {
            return false;
        }

        byte alpha = byte.MaxValue;
        if (parts.Length >= 4
            && double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double a))
        {
            alpha = (byte)Math.Clamp((int)Math.Round(a * byte.MaxValue, MidpointRounding.AwayFromZero), 0, byte.MaxValue);
        }

        color = Color.FromArgb(alpha, r, g, b);
        return true;
    }
}
