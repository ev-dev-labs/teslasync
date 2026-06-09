using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>DriveDetailHeader</c> feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx. It is a presentational header:
/// assign a <see cref="Model"/> and it renders the web composition inside a <see cref="TsFadeIn"/> (the native
/// <c>FadeIn</c>) — a back affordance (the web <c>&lt;Link to="/drives"&gt;</c> ArrowLeft), a flexible title
/// block (the cyan <c>Route</c> glyph + the <c>start → end</c> route or the localized "Drive Details"
/// fallback, over a muted subtitle of <c>vehicleName · date · time[ → end time]</c> built from the shared
/// <see cref="TsDateTime"/> control), and the trailing Replay (the web <c>&lt;Link …/replay&gt;</c>) and Share
/// (the web <c>onShare</c>) ghost buttons. A live in-progress drive (no end timestamp) omits the trailing end
/// time, and a drive with no street addresses falls back to the generic title — never a blank surface. While
/// the parent has not resolved the drive the surface renders tokenized skeleton chrome. All branch selection,
/// title resolution and label resolution happen in the WinUI-free <see cref="DriveDetailHeaderProjection"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade, the decorative glyphs are
/// hidden from Narrator, every interactive affordance carries its own Narrator name, and the surface carries a
/// composed Narrator name. The motion is the system-honoured <see cref="TsFadeIn"/>, so reduced-motion is
/// respected by construction.
/// </summary>
public sealed partial class DriveDetailHeader : ContentControl
{
    private const double ColumnSpacing = 16;     // web `gap-4` between the row's columns
    private const double TitleRowSpacing = 12;    // web `gap-3` between the Route glyph and the title
    private const double TitleBlockSpacing = 2;   // web `mt-0.5` between the title and the subtitle
    private const double SubtitleSpacing = 6;     // gap between the subtitle's runs
    private const double RouteIconSize = 22;      // web Route `h-6 w-6` (24px) optical match
    private const double SubtitleFontSize = 14;   // web `text-sm`
    private const double SkeletonTitleWidth = 280;
    private const double SkeletonSubtitleWidth = 200;
    private const double SkeletonButtonWidth = 88;
    private const double BackHitSize = 32;        // web back link `p-2.5` square hit target

    private const string DotSeparator = "\u00B7";   // web "·" between the subtitle runs
    private const string ArrowSeparator = "\u2192"; // web "→" before the end time

    private readonly ILocalizer _localizer;
    private readonly IDriveDetailHeaderNavigator _navigator;
    private readonly DriveDetailHeaderDiagnostics _diagnostics;
    private readonly Action? _onShare;

    private DriveDetailHeaderModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, navigator, an initial model, the share callback and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="navigator">The outbound navigation seam the back / Replay affordances drive.</param>
    /// <param name="model">The initial render model; defaults to <see cref="DriveDetailHeaderModel.Pending"/>.</param>
    /// <param name="onShare">Invoked when Share is activated (the web <c>onShare</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DriveDetailHeader(
        ILocalizer localizer,
        IDriveDetailHeaderNavigator navigator,
        DriveDetailHeaderModel? model = null,
        Action? onShare = null,
        DriveDetailHeaderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(navigator);

        _localizer = localizer;
        _navigator = navigator;
        _model = model ?? DriveDetailHeaderModel.Pending;
        _onShare = onShare;
        _diagnostics = diagnostics ?? new DriveDetailHeaderDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DriveDetailHeader</c>).</summary>
    public static string Slug => DriveDetailHeaderRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DriveDetailHeaderModel Model
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
        var display = DriveDetailHeaderProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        UIElement body = display.State == DriveDetailHeaderState.Loading
            ? BuildLoading(display)
            : BuildReady(display);

        // web `<FadeIn>` wrapper — system-honoured entrance (reduced-motion shows the content immediately).
        Content = new TsFadeIn { Content = body };
    }

    // ── Ready (the web header composition) ───────────────────────────────────────────────────────────────
    private Grid BuildReady(DriveDetailHeaderDisplay display)
    {
        // web `flex items-center gap-4`: back | flex-1 title block | Replay | Share.
        var grid = BuildRow();

        var back = BuildBackButton(display);
        Grid.SetColumn(back, 0);
        grid.Children.Add(back);

        var titleBlock = BuildTitleBlock(display);
        Grid.SetColumn(titleBlock, 1);
        grid.Children.Add(titleBlock);

        var replay = BuildReplayButton(display);
        Grid.SetColumn(replay, 2);
        grid.Children.Add(replay);

        var share = BuildShareButton(display);
        Grid.SetColumn(share, 3);
        grid.Children.Add(share);

        return grid;
    }

    private TsButton BuildBackButton(DriveDetailHeaderDisplay display)
    {
        // web `<Link to="/drives" className="rounded-xl p-2.5 …">` — an icon-only ghost affordance.
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = DriveDetailHeaderRegistration.BackGlyph,
            MinWidth = BackHitSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.BackLabel);
        button.Click += (_, _) =>
        {
            _diagnostics.RecordBackToList();
            _navigator.OpenDriveList();
        };
        return button;
    }

    private static StackPanel BuildTitleBlock(DriveDetailHeaderDisplay display)
    {
        // web `<div className="flex-1">` — the title row over the subtitle row.
        var block = new StackPanel
        {
            Spacing = TitleBlockSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        block.Children.Add(BuildTitleRow(display));
        block.Children.Add(BuildSubtitleRow(display));
        return block;
    }

    private static StackPanel BuildTitleRow(DriveDetailHeaderDisplay display)
    {
        // web `<h1 className="text-2xl font-bold … flex items-center gap-3">`.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web `<Route className="h-6 w-6 text-cyan-400" />` — decorative; the title text carries the meaning.
        var icon = new FontIcon
        {
            Glyph = DriveDetailHeaderRegistration.RouteGlyph,
            FontSize = RouteIconSize,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);

        // web `text-2xl font-bold` heading → the tokenized Heading role, tinted with the primary text token.
        var heading = new Heading
        {
            Value = display.Title,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(heading);

        return row;
    }

    private static StackPanel BuildSubtitleRow(DriveDetailHeaderDisplay display)
    {
        // web `<p className="text-sm text-muted">{vehicleName} · {date} · {time}[ → {endTime}]</p>`.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = SubtitleSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(SubtitleText(display.VehicleName));
        row.Children.Add(SubtitleText(DotSeparator));
        row.Children.Add(SubtitleDate(display.StartTimestamp, DateTimeVariant.Date));
        row.Children.Add(SubtitleText(DotSeparator));
        row.Children.Add(SubtitleDate(display.StartTimestamp, DateTimeVariant.Time));

        if (display.ShowEndTime)
        {
            row.Children.Add(SubtitleText(ArrowSeparator));
            row.Children.Add(SubtitleDate(display.EndTimestamp, DateTimeVariant.Time));
        }

        return row;
    }

    private static TextBlock SubtitleText(string text) => new()
    {
        Text = text,
        FontSize = SubtitleFontSize,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // web `<DateTime value=… variant=… in="vehicle" />` → the shared TsDateTime control (the native counterpart).
    private static TsDateTime SubtitleDate(DateTimeOffset? value, DateTimeVariant variant) => new()
    {
        Value = value,
        Variant = variant,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsButton BuildReplayButton(DriveDetailHeaderDisplay display)
    {
        // web `<Link to={`/drives/${driveId}/replay`}><Button variant="ghost" size="sm" icon={<Play/>}>`.
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = DriveDetailHeaderRegistration.PlayGlyph,
            Text = display.ReplayLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.ReplayLabel);
        button.Click += (_, _) =>
        {
            _diagnostics.RecordReplayOpened();
            _navigator.OpenReplay(display.DriveId);
        };
        return button;
    }

    private TsButton BuildShareButton(DriveDetailHeaderDisplay display)
    {
        // web `<Button variant="ghost" size="sm" onClick={onShare} icon={<Share2/>}>`.
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = DriveDetailHeaderRegistration.ShareGlyph,
            Text = display.ShareLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.ShareLabel);
        button.Click += (_, _) =>
        {
            _diagnostics.RecordShared();
            _onShare?.Invoke();
        };
        return button;
    }

    // ── Loading (parent still resolving the drive) ───────────────────────────────────────────────────────
    private static Grid BuildLoading(DriveDetailHeaderDisplay display)
    {
        var grid = BuildRow();

        var back = new TsSkeleton { BlockWidth = BackHitSize, BlockHeight = BackHitSize, Radius = 8 };
        Grid.SetColumn(back, 0);
        grid.Children.Add(back);

        var titleBlock = new StackPanel
        {
            Spacing = TitleBlockSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleBlock.Children.Add(new TsSkeleton { BlockWidth = SkeletonTitleWidth, BlockHeight = 24, Radius = 6 });
        titleBlock.Children.Add(new TsSkeleton { BlockWidth = SkeletonSubtitleWidth, BlockHeight = 14, Radius = 6 });
        Grid.SetColumn(titleBlock, 1);
        grid.Children.Add(titleBlock);

        var replay = new TsSkeleton { BlockWidth = SkeletonButtonWidth, BlockHeight = BackHitSize, Radius = 8 };
        Grid.SetColumn(replay, 2);
        grid.Children.Add(replay);

        var share = new TsSkeleton { BlockWidth = SkeletonButtonWidth, BlockHeight = BackHitSize, Radius = 8 };
        Grid.SetColumn(share, 3);
        grid.Children.Add(share);

        AutomationProperties.SetName(grid, display.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static Grid BuildRow()
    {
        var grid = new Grid { ColumnSpacing = ColumnSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // back
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });  // flex-1 title block
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // Replay
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // Share
        return grid;
    }
}
