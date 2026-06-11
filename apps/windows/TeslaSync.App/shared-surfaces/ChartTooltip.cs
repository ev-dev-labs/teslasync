using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using Windows.UI;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 ChartTooltip surface — a parity port of <c>web/src/components/charts/ChartTooltip.tsx</c>
/// in its cross-feature role as the single floating tooltip body every chart shares. It renders an elevated,
/// rounded, hairline-bordered panel (the web <c>backdrop-blur-xl</c> elevated surface) holding a header line
/// and one row per hovered series: a colour swatch with a soft glow (web <c>p.color || p.fill</c> dot with its
/// <c>box-shadow</c>), the series <c>name:</c> and the formatted value with an optional dimmed unit (web
/// <c>opacity-60</c>). It binds to a <see cref="ChartTooltipViewModel"/>, which the host chart drives with the
/// recharts hover state; when the cursor is inactive or the payload empty the surface collapses (the web
/// <c>if (!active || !payload?.length) return null</c>). It exposes the <c>role="tooltip"</c> /
/// <c>aria-live="polite"</c> contract through a tooltip automation peer + polite live region whose accessible
/// name is the flattened header/values (the swatches are decorative, the web <c>aria-hidden</c> dots), and
/// emits the <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>. There is no
/// loading / error / stale / offline chrome because the component reads no network data — its only states are
/// hidden and visible. The chart-internal, palette-keyed atomic tooltip is the separate
/// <c>TsChartTooltip</c> component and is out of scope for this surface.
/// </summary>
public sealed partial class ChartTooltip : ContentControl, IDisposable
{
    private const double FontSizeFallback = 12d;        // web text-xs
    private const double LabelBottomMargin = 6d;        // web mb-1.5
    private const double RowSpacing = 4d;               // web py-0.5 stacked
    private const double RowItemSpacing = 8d;           // web gap-2
    private const double UnitLeftMargin = 2d;           // web ml-0.5
    private const double UnitOpacity = 0.6d;            // web opacity-60
    private const double GlowScale = 1.5d;              // soft halo approximating the web box-shadow
    private const double GlowOpacity = 0.4d;            // web color60 (~0x60 alpha)
    private const double PanelElevation = 32d;          // web 0 8px 32px shadow
    private const double LabelWeight = 500d;            // web font-medium
    private const double ValueWeight = 600d;            // web font-semibold

    private readonly ChartTooltipViewModel _viewModel;
    private readonly ChartTooltipDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _body = new();
    private readonly TextBlock _label = new()
    {
        FontWeight = TypographyTokens.Weight(LabelWeight),
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, LabelBottomMargin),
    };

    private readonly StackPanel _rows = new() { Spacing = RowSpacing };
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over a fresh state holder with the web default formatting (host/designer entry point).</summary>
    public ChartTooltip()
        : this(new ChartTooltipViewModel(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and an optional diagnostics sink.</summary>
    /// <param name="viewModel">The backing state holder the host drives with the recharts hover state.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChartTooltip(ChartTooltipViewModel viewModel, ChartTooltipDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ChartTooltipDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        IsHitTestVisible = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;

        BuildChrome();

        // web role="tooltip" aria-live="polite": a polite live region the host positions near the cursor.
        AutomationProperties.SetAutomationId(this, ChartTooltipRegistration.RootAutomationId);
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ChartTooltip</c>).</summary>
    public static string Slug => ChartTooltipRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ChartTooltipViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TooltipAutomationPeer(this);

    private void BuildChrome()
    {
        _body.Children.Add(_label);
        _body.Children.Add(_rows);

        var panel = new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(ChartTooltipRegistration.CornerRadius),
            Padding = new Thickness(16, 12, 16, 12),
            Child = _body,
            Shadow = new ThemeShadow(),
            Translation = new System.Numerics.Vector3(0, 0, (float)PanelElevation),
        };

        // The header carries the live-region content; the swatches are decorative (the web aria-hidden dots).
        AutomationProperties.SetAccessibilityView(_rows, AccessibilityView.Raw);

        Content = panel;
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
        Marshal(Render);

    private void Render()
    {
        ChartTooltipProjection projection = _viewModel.Projection;

        // web: if (!active || !payload?.length) return null
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        // The surface's accessible name is the flattened header + values the screen reader announces.
        AutomationProperties.SetName(this, projection.AccessibleText);

        if (!projection.IsVisible)
        {
            _rows.Children.Clear();
            return;
        }

        _label.Foreground = DisplayTokens.TextSecondary;
        _label.FontSize = BodyFontSize();
        _label.Text = projection.Label;

        BuildRows(projection.Rows);
    }

    private void BuildRows(System.Collections.Generic.IReadOnlyList<ChartTooltipSeriesRow> rows)
    {
        _rows.Children.Clear();
        double fontSize = BodyFontSize();

        foreach (ChartTooltipSeriesRow row in rows)
        {
            var line = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = RowItemSpacing,
                VerticalAlignment = VerticalAlignment.Center,
            };

            line.Children.Add(BuildSwatch(row.SwatchColorHex));

            line.Children.Add(new TextBlock
            {
                Text = $"{row.Name}:",
                Foreground = DisplayTokens.TextSecondary,
                FontSize = fontSize,
                VerticalAlignment = VerticalAlignment.Center,
            });

            line.Children.Add(BuildValue(row, fontSize));
            _rows.Children.Add(line);
        }
    }

    private static FrameworkElement BuildValue(ChartTooltipSeriesRow row, double fontSize)
    {
        var value = new TextBlock
        {
            Text = row.ValueText,
            Foreground = DisplayTokens.TextPrimary,
            FontWeight = TypographyTokens.Weight(ValueWeight),
            FontSize = fontSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyMonoFamily(value);

        if (string.IsNullOrEmpty(row.Unit))
        {
            return value;
        }

        // web: the unit is a trailing dimmed span inside the (mono) value — opacity-60, ml-0.5.
        var unit = new TextBlock
        {
            Text = row.Unit,
            Foreground = DisplayTokens.TextPrimary,
            FontSize = fontSize,
            Opacity = UnitOpacity,
            Margin = new Thickness(UnitLeftMargin, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyMonoFamily(unit);

        var group = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        group.Children.Add(value);
        group.Children.Add(unit);
        return group;
    }

    private static void ApplyMonoFamily(TextBlock target)
    {
        if (TypographyTokens.Mono is { } mono)
        {
            target.FontFamily = mono;
        }
    }

    private static Grid BuildSwatch(string? colorHex)
    {
        Brush fill = TryParseHexColor(colorHex, out Color color)
            ? new SolidColorBrush(color)
            : DisplayTokens.TextMuted;

        double diameter = ChartTooltipRegistration.SwatchDiameter;
        var swatch = new Grid
        {
            Width = diameter,
            Height = diameter,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Soft halo approximating the web box-shadow glow around the dot.
        swatch.Children.Add(new Ellipse
        {
            Width = diameter,
            Height = diameter,
            Fill = fill,
            Opacity = GlowOpacity,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
            RenderTransform = new ScaleTransform { ScaleX = GlowScale, ScaleY = GlowScale },
        });

        swatch.Children.Add(new Ellipse
        {
            Width = diameter,
            Height = diameter,
            Fill = fill,
        });

        AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);
        return swatch;
    }

    private static double BodyFontSize() => TypographyTokens.Size("TsTypeBodySmFontSize", FontSizeFallback);

    private static bool TryParseHexColor(string? hex, out Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(hex))
        {
            return false;
        }

        ReadOnlySpan<char> s = hex.AsSpan().Trim();
        if (s.Length > 0 && s[0] == '#')
        {
            s = s[1..];
        }

        switch (s.Length)
        {
            case 3:
                if (TryNibble(s[0], out byte sr) && TryNibble(s[1], out byte sg) && TryNibble(s[2], out byte sb))
                {
                    color = new Color { A = 0xFF, R = (byte)(sr * 0x11), G = (byte)(sg * 0x11), B = (byte)(sb * 0x11) };
                    return true;
                }

                return false;
            case 6:
                if (TryByte(s.Slice(0, 2), out byte r) && TryByte(s.Slice(2, 2), out byte g) && TryByte(s.Slice(4, 2), out byte b))
                {
                    color = new Color { A = 0xFF, R = r, G = g, B = b };
                    return true;
                }

                return false;
            case 8:
                if (TryByte(s.Slice(0, 2), out byte a8) && TryByte(s.Slice(2, 2), out byte r8)
                    && TryByte(s.Slice(4, 2), out byte g8) && TryByte(s.Slice(6, 2), out byte b8))
                {
                    color = new Color { A = a8, R = r8, G = g8, B = b8 };
                    return true;
                }

                return false;
            default:
                return false;
        }
    }

    private static bool TryByte(ReadOnlySpan<char> span, out byte value) =>
        byte.TryParse(span, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);

    private static bool TryNibble(char c, out byte value)
    {
        Span<char> one = stackalloc char[1];
        one[0] = c;
        return byte.TryParse(one, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);
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

    private sealed class TooltipAutomationPeer : FrameworkElementAutomationPeer
    {
        public TooltipAutomationPeer(ChartTooltip owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.ToolTip;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ChartTooltip)Owner).ViewModel.AccessibleText
                : name;
        }
    }
}
