using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using ShapePath = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Avatar surface — a parity port of the web <c>Avatar</c> primitive
/// (web/src/components/data-display/Avatar.tsx). It renders one of three visuals in the web priority order —
/// an image (falling back to initials/glyph on a decode failure), deterministic 2-letter initials on a
/// colour-blind-safe colour hashed from the user id/name (the shared <see cref="Core.DataDisplay.AvatarLogic"/>),
/// or a generic glyph (a person for <see cref="AvatarKind.User"/>, the Helix brand mark for
/// <see cref="AvatarKind.Bot"/>) — with an optional presence dot (green/amber/grey) and an optional tooltip.
/// The attributed-vs-anonymous background, the deterministic palette, the initials, the presence semantics and
/// every i18n string are reproduced from the web source; all state flows through <see cref="AvatarViewModel"/>
/// and the view performs no I/O beyond decoding the supplied image. The chip carries a Narrator name (the
/// display name, or the localized "Unknown user" label) and the presence dot carries its own localized name,
/// mirroring the web image <c>alt</c> and the dot <c>role="img" aria-label</c>.
///
/// <para>
/// State coverage: the web source is a presentational identity primitive driven entirely by props — its only
/// data source is <c>useTranslation</c> (the i18n facade) and it performs no network/query fetch, so it has no
/// loading / error / stale / offline chrome to reproduce. The states it actually has are reproduced in full:
/// image, image-decode-failure → initials/glyph fallback, name initials, the empty/anonymous generic glyph
/// (person and Helix-bot), the attributed (hashed colour) vs anonymous (neutral surface) backgrounds, the
/// three presence dots, and the tooltip wrapper.
/// </para>
/// </summary>
public sealed partial class Avatar : ContentControl, IDisposable
{
    // web HelixMark geometry: two intertwined quadratic strands + two horizontal rungs (viewBox 0 0 24 24).
    // Identical to the native HelixMark rendering in AIThinkingIndicator so the assistant identity is
    // consistent across every avatar surface.
    private const double HelixViewport = 24;
    private const double HelixStrokeThickness = 1.75;
    private const string PersonGlyph = "\uE77B"; // Segoe Fluent "Contact" — the generic person (web lucide User).

    private static readonly string[] HelixGeometries =
    {
        "M 8 2 Q 18 7 12 12 Q 6 17 16 22",
        "M 16 2 Q 6 7 12 12 Q 18 17 8 22",
        "M 10 7 L 14 7",
        "M 10 17 L 14 17",
    };

    private readonly AvatarViewModel _viewModel;
    private readonly AvatarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly BitmapImage? _bitmap;

    private readonly Grid _root = new();
    private readonly Border _chip = new();
    private readonly Grid _statusBadge = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly Ellipse _statusRing = new();
    private readonly Ellipse _statusDot = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe, anonymous avatar (no name / id / image) over the passthrough localizer — the
    /// native analogue of mounting the web component with no props in an isolated host / designer. Production
    /// callers use the props constructor.
    /// </summary>
    public Avatar()
        : this(new AvatarProps(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its render props, the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="props">The avatar render inputs (web props).</param>
    /// <param name="localizer">The i18n facade the unknown-user and presence labels resolve through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Avatar(AvatarProps props, ILocalizer localizer, AvatarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        var imageSource = new BitmapAvatarImageSource(props.Src);
        _bitmap = imageSource.Bitmap;
        _viewModel = new AvatarViewModel(props, localizer, imageSource);
        _diagnostics = diagnostics ?? new AvatarDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        BuildChrome();
        WireUp();
        Render();
    }

    /// <summary>
    /// Creates the surface over an explicit state holder (tests / headless hosts that inject their own image
    /// seam) and an optional diagnostics sink. When the holder's image seam is bitmap-backed the image branch
    /// renders the bitmap; otherwise the image branch shows the chip background only.
    /// </summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Avatar(AvatarViewModel viewModel, AvatarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _bitmap = null;
        _diagnostics = diagnostics ?? new AvatarDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        BuildChrome();
        WireUp();
        Render();
    }

    /// <summary>The canonical surface slug (<c>Avatar</c>).</summary>
    public static string Slug => AvatarRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AvatarViewModel ViewModel => _viewModel;

    /// <inheritdoc />
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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AvatarAutomationPeer(this);

    private static Geometry ParseGeometry(string path) =>
        (Geometry)Microsoft.UI.Xaml.Markup.XamlBindingHelper.ConvertValue(typeof(Geometry), path);

    private static SolidColorBrush HexBrush(string hex)
    {
        // AvatarLogic palette entries are "#RRGGBB"; fall back to transparent on any malformed value.
        if (hex.Length == 7 && hex[0] == '#'
            && byte.TryParse(hex.AsSpan(1, 2), System.Globalization.NumberStyles.HexNumber, null, out byte r)
            && byte.TryParse(hex.AsSpan(3, 2), System.Globalization.NumberStyles.HexNumber, null, out byte g)
            && byte.TryParse(hex.AsSpan(5, 2), System.Globalization.NumberStyles.HexNumber, null, out byte b))
        {
            return new SolidColorBrush(Windows.UI.Color.FromArgb(255, r, g, b));
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    private void BuildChrome()
    {
        _statusRing.Fill = DisplayTokens.Surface;
        _statusBadge.Children.Add(_statusRing);
        _statusBadge.Children.Add(_statusDot);

        // The presence dot is decorative chrome with its own accessible name; the chip content carries the
        // identity. The dot's name is set in Render so Narrator announces the presence state.
        AutomationProperties.SetAccessibilityView(_statusRing, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_statusDot, AccessibilityView.Raw);

        _root.Children.Add(_chip);
        _root.Children.Add(_statusBadge);

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, AvatarRegistration.RootAutomationId);
        Content = _root;
    }

    private void WireUp()
    {
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        AvatarProjection projection = _viewModel.Projection;

        _root.Width = projection.SizePx;
        _root.Height = projection.SizePx;

        _chip.Width = projection.SizePx;
        _chip.Height = projection.SizePx;
        _chip.CornerRadius = new CornerRadius(projection.CornerRadiusPx);
        _chip.Background = BackgroundBrush(projection);
        _chip.Child = BuildContent(projection);

        RenderStatus(projection);
        RenderAccessibility(projection);
    }

    private static Brush? BackgroundBrush(AvatarProjection projection) => projection.BackgroundKind switch
    {
        // web: the image covers the chip, so no fill is painted behind it.
        AvatarBackgroundKind.Image => null,

        // web: attributed avatars get the deterministic hashed palette colour.
        AvatarBackgroundKind.Color => HexBrush(projection.SeedColorHex),

        // web: truly-anonymous avatars get a neutral surface so they do not suggest a user identity.
        _ => DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
    };

    private FrameworkElement BuildContent(AvatarProjection projection) => projection.ContentMode switch
    {
        AvatarContentMode.Image => BuildImage(),
        AvatarContentMode.Initials => BuildInitials(projection),
        _ => BuildGlyph(projection),
    };

    private Image BuildImage()
    {
        var image = new Image
        {
            Stretch = Stretch.UniformToFill,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        if (_bitmap is not null)
        {
            image.Source = _bitmap;
        }

        // The image's identity is announced by the chip's accessible name (web alt), so keep the element out
        // of the Narrator tree to avoid a duplicate announcement.
        AutomationProperties.SetAccessibilityView(image, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(image, AvatarRegistration.ImageAutomationId);
        return image;
    }

    private static TextBlock BuildInitials(AvatarProjection projection)
    {
        var text = new TextBlock
        {
            Text = projection.Initials,
            FontSize = projection.FontPx,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        // web: the initials span is aria-hidden; the chip's accessible name carries the identity.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(text, AvatarRegistration.InitialsAutomationId);
        return text;
    }

    private static FrameworkElement BuildGlyph(AvatarProjection projection)
    {
        FrameworkElement glyph = projection.GlyphKind == AvatarGlyphKind.Helix
            ? BuildHelix(projection.GlyphPx)
            : BuildPersonGlyph(projection.GlyphPx);

        // web: the generic glyph is aria-hidden decoration.
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(glyph, AvatarRegistration.GlyphAutomationId);
        return glyph;
    }

    private static FontIcon BuildPersonGlyph(double glyphPx) => new FontIcon
    {
        Glyph = PersonGlyph,
        FontSize = glyphPx,
        Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Viewbox BuildHelix(double glyphPx)
    {
        var canvas = new Canvas { Width = HelixViewport, Height = HelixViewport };
        Brush accent = DisplayTokens.Accent;
        foreach (string geometry in HelixGeometries)
        {
            canvas.Children.Add(new ShapePath
            {
                Data = ParseGeometry(geometry),
                Stroke = accent,
                StrokeThickness = HelixStrokeThickness,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            });
        }

        return new Viewbox
        {
            Width = glyphPx,
            Height = glyphPx,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = canvas,
        };
    }

    private void RenderStatus(AvatarProjection projection)
    {
        if (!projection.HasStatus)
        {
            _statusBadge.Visibility = Visibility.Collapsed;
            return;
        }

        _statusBadge.Visibility = Visibility.Visible;

        // web: a 2px ring of the surface colour separates the dot from the avatar; the inner dot carries the
        // semantic presence colour (success / warning / muted).
        double dot = projection.DotPx;
        double ring = dot + 2;

        _statusRing.Width = ring;
        _statusRing.Height = ring;

        _statusDot.Width = dot;
        _statusDot.Height = dot;
        _statusDot.HorizontalAlignment = HorizontalAlignment.Center;
        _statusDot.VerticalAlignment = VerticalAlignment.Center;
        _statusDot.Fill = DisplayTokens.Brush(projection.StatusBrushKey);

        // The presence dot announces its localized state (web dot role="img" aria-label).
        AutomationProperties.SetName(_statusBadge, projection.StatusLabel);
        AutomationProperties.SetAutomationId(_statusBadge, AvatarRegistration.StatusAutomationId);
    }

    private void RenderAccessibility(AvatarProjection projection)
    {
        // The chip's accessible name is the display name, or the localized "Unknown user" label (web image
        // alt / tooltip content) — so Narrator announces who the avatar represents.
        AutomationProperties.SetName(this, projection.AccessibleName);

        if (projection.ShowTooltip)
        {
            ToolTipService.SetToolTip(this, new ToolTip { Content = projection.TooltipLabel });
            AutomationProperties.SetHelpText(this, projection.TooltipLabel);
        }
        else
        {
            ToolTipService.SetToolTip(this, null);
            AutomationProperties.SetHelpText(this, string.Empty);
        }
    }

    /// <summary>
    /// The production image seam — wraps a WinUI <see cref="BitmapImage"/> created from the avatar's
    /// <c>src</c>. <see cref="HasImage"/> starts true for a non-empty, absolute source and flips to false when
    /// the bitmap raises <c>ImageFailed</c> (the web <c>onError =&gt; setImageFailed(true)</c>), notifying the
    /// view-model so the avatar re-projects to its initials/glyph fallback.
    /// </summary>
    private sealed class BitmapAvatarImageSource : IAvatarImageSource
    {
        private readonly List<Action> _observers = new();
        private bool _hasImage;

        public BitmapAvatarImageSource(string? src)
        {
            if (!string.IsNullOrEmpty(src) && Uri.TryCreate(src, UriKind.Absolute, out Uri? uri))
            {
                Bitmap = new BitmapImage();
                Bitmap.ImageFailed += OnImageFailed;
                Bitmap.UriSource = uri;
                _hasImage = true;
            }
        }

        public BitmapImage? Bitmap { get; }

        public bool HasImage => _hasImage;

        public IDisposable Observe(Action onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        private void OnImageFailed(object sender, ExceptionRoutedEventArgs e)
        {
            if (!_hasImage)
            {
                return;
            }

            _hasImage = false;
            foreach (Action observer in _observers.ToArray())
            {
                observer();
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly BitmapAvatarImageSource _owner;
            private readonly Action _observer;
            private bool _disposed;

            public Subscription(BitmapAvatarImageSource owner, Action observer)
            {
                _owner = owner;
                _observer = observer;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _owner._observers.Remove(_observer);
            }
        }
    }

    private sealed class AvatarAutomationPeer : FrameworkElementAutomationPeer
    {
        public AvatarAutomationPeer(Avatar owner)
            : base(owner)
        {
        }

        // web: the avatar is an image-role surface (the <img> alt, or the labelled identity chip).
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Avatar)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
