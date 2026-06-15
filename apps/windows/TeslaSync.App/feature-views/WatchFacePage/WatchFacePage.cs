using System.Runtime.CompilerServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;
using Windows.UI;

namespace TeslaSync.App.FeatureViews.Watch;

/// <summary>
/// The native WinUI 3 <c>WatchFacePage</c> — a parity port of the web page
/// web/src/features/watch/pages/WatchFacePage.tsx (route <c>/watch</c>, nav name <c>WatchFace</c>). It binds to a
/// <see cref="WatchFacePageViewModel"/> and reproduces every region of the chrome-less wearable shell: the centred
/// OLED watch face (the web <c>WatchShell</c>) carrying the vehicle name, the big battery ring (a native
/// <see cref="Canvas"/> ring tinted by the web <c>getBatteryColor</c> threshold), the optional "⚡ &lt;n&gt;m to full"
/// charging line, the state badge (web <c>watchStateVariant</c>), the three 44px tap icons (lock/unlock, climate,
/// sentry) and the "last updated" freshness caption — followed by the opt-in Helix narrator
/// (<see cref="AIWatchFaceNLResponse"/>) as a sibling below, exactly as the web renders the narrator after the
/// shell. The four data states are distinct surfaces inside the OLED face — a busy spinner, the "No vehicle found"
/// empty message, an error message + retry, and the watch face — so a region never collapses silently. The view is
/// a thin renderer; all branch selection, unit conversion and i18n happen in the view-model's
/// <see cref="WatchFaceDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class WatchFacePage : UserControl, IDisposable
{
    private const double GaugeSize = 128;       // web BatteryGauge w-32 h-32
    private const double StrokeWidth = 8;       // web SVG strokeWidth 8
    private const double WatchFaceWidth = 240;  // a 40-45mm wearable face on a desktop surface
    private const double WatchFaceMinHeight = 320;
    private const double IconChipSize = 44;     // web StatusIcon h-11 w-11 (44px tap target)
    private const string ChargingGlyph = "\uE945"; // Segoe Fluent LightningBolt (web Zap)
    private const string EmptyGlyph = "\uE83F";    // Battery (the empty-surface mark)
    private const string ErrorGlyph = "\uEA39";    // ErrorBadge

    // OLED wearable exception: the web WatchShell is `bg-black text-white` — chrome-less and theme-independent to
    // fit a 40-45mm wearable display (web WatchFacePage.tsx L24 EXCEPTION). These fixed brushes reproduce that OLED
    // contract on both the light and dark app theme; the value-arc tint and the Helix narrator below still use the
    // design-token brushes.
    private static readonly Brush OledBackground = new SolidColorBrush(Colors.Black);
    private static readonly Brush OledTextPrimary = new SolidColorBrush(Colors.White);
    private static readonly Brush OledTextSecondary = new SolidColorBrush(Color.FromArgb(0xB3, 0xFF, 0xFF, 0xFF));
    private static readonly Brush OledTextMuted = new SolidColorBrush(Color.FromArgb(0x73, 0xFF, 0xFF, 0xFF));
    private static readonly Brush OledTrack = new SolidColorBrush(Color.FromArgb(0x1A, 0xFF, 0xFF, 0xFF)); // web rgba(255,255,255,0.1)
    private static readonly Brush OledChip = new SolidColorBrush(Color.FromArgb(0xFF, 0x1F, 0x29, 0x37));  // web --surface-2 on black

    private readonly WatchFacePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly WatchFaceDiagnostics _diagnostics;
    private readonly AIWatchFaceNLResponse _aiNarrator;
    private readonly Border _watchHost;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the default empty local-state source, a no-op command sender and the shell localizer.</summary>
    public WatchFacePage()
        : this(
            EmptyWatchFaceSummarySource.Instance,
            NoopWatchFaceCommandSender.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports, a localizer, an optional unit preference, deep-link vehicle, Helix narrator and diagnostics.</summary>
    /// <param name="summarySource">The cache-then-network watch-summary port (native <c>useWatchSummary</c>).</param>
    /// <param name="commandSender">The one-shot command mutation port (native <c>useWatchCommand</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="vehicleId">The optional <c>?vehicle_id=</c> deep-link target forwarded to commands.</param>
    /// <param name="aiNarrator">The opt-in Helix narrator sibling; a gated-off instance is built when null (the wearable invariant).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WatchFacePage(
        IWatchFaceSummarySource summarySource,
        IWatchFaceCommandSender commandSender,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        AIWatchFaceNLResponse? aiNarrator = null,
        WatchFaceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(summarySource);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WatchFaceDiagnostics();
        _viewModel = new WatchFacePageViewModel(summarySource, commandSender, localizer, units, vehicleId, _diagnostics);

        // The opt-in Helix narrator renders as a sibling AFTER the shell (web). When null we build a gated-off
        // instance, which collapses itself — preserving the chrome-less wearable invariant (web withAiFeature → null).
        _aiNarrator = aiNarrator ?? new AIWatchFaceNLResponse(EmptyAiWatchStreamTransport.Instance, StaticAiFeatureGate.Off, localizer);

        _watchHost = new Border
        {
            Background = OledBackground,
            CornerRadius = new CornerRadius(28),
            Width = WatchFaceWidth,
            MinHeight = WatchFaceMinHeight,
            Padding = new Thickness(16),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        var column = new StackPanel
        {
            Spacing = 16,
            Padding = new Thickness(24),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(_watchHost);
        column.Children.Add(_aiNarrator);

        Content = new ScrollViewer
        {
            Content = column,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug (<c>WatchFacePage</c>).</summary>
    public static string Slug => WatchFaceRegistration.Slug;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model, dispose the narrator and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        _aiNarrator.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        _watchHost.Child = _viewModel.State switch
        {
            WatchFaceState.Loading => BuildLoading(),
            WatchFaceState.Error => BuildError(_viewModel.Display),
            WatchFaceState.Empty => BuildMessage(_viewModel.Display.Message, EmptyGlyph),
            _ => BuildSuccess(_viewModel.Display),
        };
    }

    // ── States ───────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        // web: <Spinner size="lg" /> centred on the black shell.
        var spinner = new TsSpinner
        {
            Size = ControlSize.Large,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(spinner, _viewModel.Title);
        return Centered(spinner);
    }

    private static Grid BuildMessage(string message, string glyph)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 28,
            Foreground = OledTextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = message,
            FontSize = 13,
            Foreground = OledTextSecondary,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        return Centered(column);
    }

    private Grid BuildError(WatchFaceDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new FontIcon
        {
            Glyph = ErrorGlyph,
            FontSize = 28,
            Foreground = OledTextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = string.IsNullOrEmpty(_viewModel.ErrorMessage) ? display.Message : _viewModel.ErrorMessage!,
            FontSize = 13,
            Foreground = OledTextSecondary,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var retry = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = display.RetryLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
            // Local-value brushes override the themed style setters so the affordance stays legible on the OLED face.
            Foreground = OledTextPrimary,
            BorderBrush = OledTextMuted,
        };
        AutomationProperties.SetName(retry, display.RetryLabel);
        retry.Click += (_, _) => _ = _viewModel.RetryAsync();
        column.Children.Add(retry);

        return Centered(column);
    }

    // ── Success watch face ───────────────────────────────────────────────

    private Grid BuildSuccess(WatchFaceDisplay display)
    {
        var grid = new Grid { RowSpacing = 8 };
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var name = new TextBlock
        {
            Text = display.VehicleName,
            FontSize = 11,
            Foreground = OledTextMuted,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        Grid.SetRow(name, 0);
        grid.Children.Add(name);

        var center = BuildGaugeBlock(display);
        Grid.SetRow(center, 1);
        grid.Children.Add(center);

        var actions = BuildQuickActions(display);
        Grid.SetRow(actions, 2);
        grid.Children.Add(actions);

        var updated = new TextBlock
        {
            Text = display.LastUpdatedText,
            FontSize = 9,
            Foreground = OledTextMuted,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        Grid.SetRow(updated, 3);
        grid.Children.Add(updated);

        return grid;
    }

    private static StackPanel BuildGaugeBlock(WatchFaceDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(BuildGauge(display));

        if (display.IsCharging)
        {
            var chargeBrush = ChartBrushes.ForStatus(StatusKind.Success);
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            row.Children.Add(new FontIcon
            {
                Glyph = ChargingGlyph,
                FontSize = 12,
                Foreground = chargeBrush,
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new TextBlock
            {
                Text = display.ChargingText,
                FontSize = 12,
                Foreground = chargeBrush,
                VerticalAlignment = VerticalAlignment.Center,
            });
            AutomationProperties.SetName(row, display.ChargingText);
            column.Children.Add(row);
        }

        if (!string.IsNullOrEmpty(display.StateText))
        {
            var badge = new TsBadge
            {
                Status = display.StateStatus,
                Dot = false,
                Content = display.StateText,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetName(badge, display.StateText);
            column.Children.Add(badge);
        }

        return column;
    }

    // The battery ring — a native WinUI ring built from the same W3 chart primitives the TsRadialGauge wrapper uses
    // (ChartShapes.ArcPath + ChartGeometry.RingArc/GaugeFraction), the value arc tinted by the web getBatteryColor
    // threshold via ChartBrushes.ForStatus; the state-of-charge percent + rated range are centred (web BatteryGauge).
    private static Grid BuildGauge(WatchFaceDisplay display)
    {
        double radius = (GaugeSize - StrokeWidth) / 2;
        var center = new PointD(GaugeSize / 2, GaugeSize / 2);

        var canvas = new Canvas { Width = GaugeSize, Height = GaugeSize };
        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        // Track (full faint white ring — web rgba(255,255,255,0.1)).
        canvas.Children.Add(ChartShapes.ArcPath(ChartGeometry.RingArc(center, radius, 0.9999), OledTrack, StrokeWidth));

        // Value arc, tinted by the battery threshold status (web getBatteryColor); absent when there's no reading.
        double fraction = ChartGeometry.GaugeFraction(display.BatteryValue, display.BatteryMax);
        if (display.HasBatteryReading && fraction > 0)
        {
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                ChartBrushes.ForStatus(display.BatteryStatus),
                StrokeWidth));
        }

        var percent = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 30,
            FontWeight = FontWeights.Bold,
            Foreground = OledTextPrimary,
            Text = string.Concat(display.BatteryValueText, display.BatteryUnit),
        };
        AutomationProperties.SetAccessibilityView(percent, AccessibilityView.Raw);

        var range = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 11,
            Foreground = OledTextSecondary,
            Text = display.RangeText,
        };
        AutomationProperties.SetAccessibilityView(range, AccessibilityView.Raw);

        var centerHost = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        centerHost.Children.Add(percent);
        centerHost.Children.Add(range);

        var ring = new Grid { Width = GaugeSize, Height = GaugeSize, HorizontalAlignment = HorizontalAlignment.Center };
        ring.Children.Add(canvas);
        ring.Children.Add(centerHost);
        AutomationProperties.SetName(ring, $"{display.GaugeAutomationName} · {display.RangeText}");
        return ring;
    }

    private StackPanel BuildQuickActions(WatchFaceDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var action in display.QuickActions)
        {
            row.Children.Add(BuildQuickAction(action));
        }

        return row;
    }

    private StackPanel BuildQuickAction(WatchFaceQuickAction action)
    {
        var column = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var accent = action.Active ? ChartBrushes.ForStatus(action.Accent) : OledTextMuted;
        column.Children.Add(action.Interactive
            ? BuildTapIcon(action, accent)
            : BuildIndicatorIcon(action, accent));

        if (!string.IsNullOrEmpty(action.Caption))
        {
            column.Children.Add(new TextBlock
            {
                Text = action.Caption,
                FontSize = 9,
                Foreground = action.Active ? accent : OledTextMuted,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        return column;
    }

    private TsButton BuildTapIcon(WatchFaceQuickAction action, Brush accent)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            IconGlyph = action.Glyph,
            IsLoading = action.IsLoading,
            IsEnabled = !action.Disabled,
            Width = IconChipSize,
            Height = IconChipSize,
            MinWidth = IconChipSize,
            MinHeight = IconChipSize,
            Padding = new Thickness(0),
            CornerRadius = new CornerRadius(IconChipSize / 2),
            // Local-value brushes override the themed style setters for the OLED chip (web bg-surface-2 + tint).
            Background = OledChip,
            Foreground = accent,
        };
        AutomationProperties.SetName(button, action.Label);

        string? command = action.Command;
        if (!string.IsNullOrEmpty(command))
        {
            button.Click += (_, _) => _ = _viewModel.SendCommandAsync(command);
        }

        return button;
    }

    private static Border BuildIndicatorIcon(WatchFaceQuickAction action, Brush accent)
    {
        var chip = new Border
        {
            Background = OledChip,
            Width = IconChipSize,
            Height = IconChipSize,
            CornerRadius = new CornerRadius(IconChipSize / 2),
            Child = new FontIcon
            {
                Glyph = action.Glyph,
                FontSize = 18,
                Foreground = accent,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
        AutomationProperties.SetName(chip, action.Label);
        return chip;
    }

    private static Grid Centered(UIElement child)
    {
        var host = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            MinHeight = WatchFaceMinHeight - 32,
        };
        host.Children.Add(child);
        return host;
    }

    /// <summary>
    /// The default Helix narrator transport used by the headless / off-mode page — it opens no stream and yields no
    /// events. The gated-off narrator never invokes it (the gate short-circuits <c>Start</c>), so it exists only to
    /// satisfy the non-null transport contract without any network access.
    /// </summary>
    private sealed class EmptyAiWatchStreamTransport : IAiWatchStreamTransport
    {
        public static EmptyAiWatchStreamTransport Instance { get; } = new();

        private EmptyAiWatchStreamTransport()
        {
        }

        public async IAsyncEnumerable<AiWatchStreamEvent> StreamAsync(
            AiWatchRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Task.CompletedTask.ConfigureAwait(false);
            yield break;
        }
    }
}
