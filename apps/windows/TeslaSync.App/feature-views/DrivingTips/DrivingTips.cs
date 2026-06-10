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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>DrivingTips</c> feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/DrivingTips.tsx. It is a presentational section of the
/// Driving-Dynamics experience: assign a <see cref="Model"/> (the web <c>motorStats</c> / <c>throttleStyle</c>
/// props plus the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="DrivingTipsState.Loading"/> (a skeleton panel while the query is in flight),
/// <see cref="DrivingTipsState.Empty"/> (the web <c>tipNoData</c> row, "Drive your vehicle to start collecting
/// dynamics data."), <see cref="DrivingTipsState.Error"/> (a retriable <see cref="TsQueryError"/>), or the
/// populated lightbulb panel (<see cref="DrivingTipsState.Ready"/> / <see cref="DrivingTipsState.Stale"/> /
/// <see cref="DrivingTipsState.Offline"/>) — the web composition: a lightbulb-led "Driving Style Recommendations"
/// header over one bordered row per recommendation, each led by a shield (conservative) or warning-triangle
/// (otherwise) glyph, with a stale / offline freshness chip layered beside the header. The view never performs
/// HTTP; all branch selection, threshold logic and copy resolution happen in the WinUI-free
/// <see cref="DrivingTipsProjection"/>. The entrance fades through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, and the surface plus each row carry a Narrator
/// name. A failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the
/// parent owns the query).
/// </summary>
public sealed partial class DrivingTips : ContentControl
{
    private const double PanelPadding = 24;        // web GlassPanel p-6
    private const double HeaderGap = 16;           // web mb-4 between header and the list
    private const double HeaderIconSpacing = 12;   // web gap-3 between the lightbulb and the heading
    private const double RowSpacing = 12;          // web space-y-3 between recommendation rows
    private const double RowInnerSpacing = 12;     // web gap-3 between a row's icon and its text
    private const double RowPadding = 12;          // web p-3
    private const double RowRadius = 8;            // web rounded-lg
    private const double HeaderIconSize = 20;      // web Lightbulb h-5 w-5
    private const double RowIconSize = 16;         // web ShieldCheck / AlertTriangle h-4 w-4
    private const double RowIconTopNudge = 2;      // web mt-0.5
    private const double RowTextSize = 14;         // web text-sm
    private const int FadeDelayMs = 600;           // web FadeIn delay 0.6
    private const int LoadingRowCount = 2;
    private const double LoadingRowHeight = 44;

    private readonly ILocalizer _localizer;
    private readonly DrivingTipsDiagnostics _diagnostics;

    private DrivingTipsModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="DrivingTipsModel.Loading()"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DrivingTips(
        ILocalizer localizer,
        DrivingTipsModel? model = null,
        DrivingTipsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DrivingTipsModel.Loading();
        _diagnostics = diagnostics ?? new DrivingTipsDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DrivingTips</c>).</summary>
    public static string Slug => DrivingTipsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DrivingTipsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
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

    private void Render()
    {
        DrivingTipsDisplay display = DrivingTipsProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            DrivingTipsState.Loading => BuildLoading(display),
            DrivingTipsState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Empty / Stale / Offline (the web GlassPanel: lightbulb header + recommendation rows) ─────────
    private static TsFadeIn BuildContent(DrivingTipsDisplay display)
    {
        var column = new StackPanel { Spacing = HeaderGap };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildList(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.AutomationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // web header: <div className="mb-4 flex items-center gap-3"><Lightbulb/><h2>…</h2></div>, plus the native
    // stale / offline freshness chip pinned to the trailing edge.
    private static Grid BuildHeader(DrivingTipsDisplay display)
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderIconSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(
            DrivingTipsRegistration.LightbulbGlyph,
            HeaderIconSize,
            DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)))); // web text-yellow-400
        titleRow.Children.Add(new SectionTitle
        {
            Value = display.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildFreshnessChip(display);
            Grid.SetColumn(chip, 1);
            header.Children.Add(chip);
        }

        return header;
    }

    // web list: <div className="space-y-3">{tips.map(...)}</div>
    private static StackPanel BuildList(DrivingTipsDisplay display)
    {
        var stack = new StackPanel { Spacing = RowSpacing };
        foreach (DrivingTipRow tip in display.Tips)
        {
            stack.Children.Add(BuildRow(tip, display.TipIconGlyph, display.TipIconStatus));
        }

        AutomationProperties.SetName(stack, display.Title);
        return stack;
    }

    // web row: a bordered, rounded, subtly-filled box — the icon (shield / triangle) plus the wrapping tip text.
    private static Border BuildRow(DrivingTipRow tip, string glyph, StatusKind iconStatus)
    {
        var icon = DecorativeIcon(glyph, RowIconSize, DisplayTokens.Brush(StatusResources.AccentBrushKey(iconStatus)));
        icon.VerticalAlignment = VerticalAlignment.Top;
        icon.Margin = new Thickness(0, RowIconTopNudge, 0, 0); // web mt-0.5

        var text = new TextBlock
        {
            Text = tip.Text,
            FontSize = RowTextSize,
            Foreground = DisplayTokens.TextSecondary, // web text-[var(--text-secondary)]
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);

        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = RowInnerSpacing };
        content.Children.Add(icon);
        content.Children.Add(text);

        var row = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", RowRadius),
            Background = DisplayTokens.Surface,    // web bg-white/[0.03]
            BorderBrush = DisplayTokens.Border,    // web border-white/[0.06]
            BorderThickness = new Thickness(1),
            Padding = new Thickness(RowPadding),
        };
        AutomationProperties.SetName(row, tip.AutomationName);
        return row;
    }

    // ── Loading (parent still fetching the motor history) ──────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(DrivingTipsDisplay display)
    {
        var column = new StackPanel { Spacing = HeaderGap };

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderIconSpacing,
        };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = HeaderIconSize,
            BlockHeight = HeaderIconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 220,
            BlockHeight = 18,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);

        var rows = new StackPanel { Spacing = RowSpacing };
        for (int i = 0; i < LoadingRowCount; i++)
        {
            rows.Children.Add(new TsSkeleton
            {
                BlockHeight = LoadingRowHeight,
                Radius = RowRadius,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        column.Children.Add(rows);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(DrivingTipsDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetryInvoked;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, display.ErrorTitle);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static TsBadge BuildFreshnessChip(DrivingTipsDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock { Text = display.FreshnessChipText, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the row / surface automation name already conveys the meaning to assistive tech.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DrivingTipsAutomationPeer(this);

    private sealed class DrivingTipsAutomationPeer(DrivingTips owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
