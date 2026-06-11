using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Windows.UI.Text;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>Delta</c> shared surface — a parity port of the web <c>Delta</c>
/// (web/src/components/data-display/Delta.tsx). It is a direction-aware change indicator with a single arrow,
/// a colour that encodes whether the change is a good or bad outcome (emerald/rose), a muted zero/neutral tone,
/// and an unsigned magnitude (the arrow carries the sign — "↓ 5%" never "↑ -5%"). It reproduces all three web
/// branches: the forced loading skeleton, the missing-inputs em-dash and the populated indicator across the
/// percent / absolute / both display modes, with the optional trailing comparison label. All data flows through
/// the shared <see cref="DeltaViewModel"/> (and the <see cref="IDeltaSource"/> P1/S8 seam); the view never
/// performs HTTP and never recomputes — it renders the <see cref="DeltaDisplay"/> projection. Every string
/// resolves through the i18n facade, the indicator carries a Narrator name + the comparison tooltip, and the
/// directional arrow is marked decorative (the web <c>aria-hidden</c>).
/// </summary>
public sealed partial class Delta : ContentControl, IDisposable
{
    private const double SmallFontSize = 12;
    private const double MediumFontSize = 14;
    private const double InlineSpacing = 4;
    private const double RowSpacing = 6;
    private const string MutedBrushKey = "TsColorTextMutedBrush";

    private readonly DeltaViewModel _viewModel;
    private readonly DeltaDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data seam, localizer and optional diagnostics collector.</summary>
    public Delta(IDeltaSource source, ILocalizer localizer, DeltaDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new DeltaDiagnostics();
        _viewModel = new DeltaViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>Delta</c>).</summary>
    public static string Slug => DeltaRegistration.Slug;

    /// <summary>The view-model a host can observe for the current render state.</summary>
    public DeltaViewModel ViewModel => _viewModel;

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

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(DeltaViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // A source change can be raised from a background settings/live callback; render on the UI thread.
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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AccessibleName);
        ToolTipService.SetToolTip(this, string.IsNullOrEmpty(display.Title) ? null : display.Title);

        Content = display.State switch
        {
            DeltaState.Loading => BuildSkeleton(display),
            DeltaState.Empty => BuildEmpty(display),
            _ => BuildValue(display),
        };
    }

    private static TsSkeleton BuildSkeleton(DeltaDisplay display)
    {
        // web L140-L146: <Skeleton width="60px" height={size === 'md' ? 16 : 14} />.
        var skeleton = new TsSkeleton
        {
            BlockWidth = 60,
            BlockHeight = display.Size == DeltaSize.Md ? 16 : 14,
            ReduceMotion = MotionPreference.ReduceMotion,
        };
        AutomationProperties.SetAccessibilityView(skeleton, AccessibilityView.Raw);
        return skeleton;
    }

    private static StackPanel BuildEmpty(DeltaDisplay display)
    {
        // web L153-L161: an em-dash in the muted colour, with the optional trailing comparison label.
        var row = NewRow(display);
        Brush muted = ResolveBrush(MutedBrushKey);

        row.Children.Add(ValueText(display.PrimaryText, muted, display, FontWeights.Normal));
        AppendComparedTo(row, display, muted);
        return row;
    }

    private static StackPanel BuildValue(DeltaDisplay display)
    {
        var row = NewRow(display);
        Brush accent = ResolveBrush(display.AccentBrushKey);

        if (display.HasArrow)
        {
            row.Children.Add(ArrowIcon(display, accent));
        }

        row.Children.Add(ValueText(display.PrimaryText, accent, display, FontWeights.Medium));

        if (display.HasSecondaryText)
        {
            // web L186: the parenthetical percent is dimmed (opacity-70) but keeps the accent colour.
            var secondary = ValueText(display.SecondaryText, accent, display, FontWeights.Medium);
            secondary.Opacity = 0.7;
            row.Children.Add(secondary);
        }

        AppendComparedTo(row, display, ResolveBrush(MutedBrushKey));
        return row;
    }

    private static StackPanel NewRow(DeltaDisplay display) => new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = display.Inline ? InlineSpacing : RowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static FontIcon ArrowIcon(DeltaDisplay display, Brush accent)
    {
        // web ArrowUp/ArrowDown/ArrowRight → the Segoe Fluent chevrons used by the atomic delta chip; the
        // arrow encodes the sign and is decorative for assistive tech (web aria-hidden="true").
        string glyph = display.Arrow switch
        {
            DeltaArrow.Up => "\uE70E",   // ChevronUp
            DeltaArrow.Down => "\uE70D", // ChevronDown
            _ => "\uE738",               // Remove (flat / no change)
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = display.Size == DeltaSize.Md ? MediumFontSize : SmallFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static TextBlock ValueText(string text, Brush foreground, DeltaDisplay display, FontWeight weight) => new()
    {
        Text = text,
        FontSize = display.Size == DeltaSize.Md ? MediumFontSize : SmallFontSize,
        FontWeight = weight,
        Foreground = foreground,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static void AppendComparedTo(StackPanel row, DeltaDisplay display, Brush muted)
    {
        if (!display.HasComparedTo)
        {
            return;
        }

        // web L208-L210: the trailing comparison label is muted and normal-weight.
        row.Children.Add(ValueText(display.ComparedTo, muted, display, FontWeights.Normal));
    }

    private static Brush ResolveBrush(string key) =>
        TypographyTokens.Brush(key) ?? new SolidColorBrush(Microsoft.UI.Colors.Gray);
}
