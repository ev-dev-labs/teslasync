using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>VehicleConfigSection</c> feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx. It is a presentational section
/// of the Vehicle-Detail experience: assign a <see cref="Model"/> (the web <c>vehicleConfig</c> +
/// <c>softwareVersion</c> props, plus the parent-supplied lifecycle status) and it renders one of the
/// contract's states — <see cref="VehicleConfigSectionState.Loading"/> (the web skeleton while the query is in
/// flight), <see cref="VehicleConfigSectionState.Empty"/> (a friendly empty state when there is no
/// configuration), <see cref="VehicleConfigSectionState.Error"/> (a retriable <see cref="TsQueryError"/>), or
/// the populated section (<see cref="VehicleConfigSectionState.Ready"/> / <see cref="VehicleConfigSectionState.Stale"/>
/// / <see cref="VehicleConfigSectionState.Offline"/>) — the glass panel the web renders: the Settings-icon
/// title and the twelve configuration rows laid out as the web's two-column key/value list, with a stale /
/// offline freshness chip layered on the cached snapshot. The view never performs HTTP; all branch selection,
/// label resolution and value formatting happen in the WinUI-free <see cref="VehicleConfigSectionProjection"/>.
/// Entrances fade through <see cref="TsFadeIn"/> (honouring reduce-motion), every string resolves through the
/// i18n facade, and the surface carries a Narrator name covering all twelve rows. A failed snapshot's retry
/// affordance raises <see cref="RetryRequested"/> for the host to act on (the parent owns the query).
/// </summary>
public sealed partial class VehicleConfigSection : ContentControl
{
    private const string SettingsGlyph = "\uE713"; // Segoe Fluent — Setting (web lucide Settings)

    private const double ContentSpacing = 16;     // web mb-4 between header and body
    private const double HeaderSpacing = 8;        // web gap-2
    private const double PanelPadding = 24;        // web p-6
    private const double ColumnGap = 24;           // web KVList columns=2 gap-x-6
    private const double IconSize = 18;
    private const double SkeletonSpacing = 12;
    private const double SkeletonLineHeight = 16;  // web Skeleton height=16
    private const int SkeletonLines = 4;           // web Skeleton lines=4
    private const int FadeDelayMs = 100;

    private readonly ILocalizer _localizer;
    private readonly VehicleConfigSectionDiagnostics _diagnostics;

    private VehicleConfigSectionModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="VehicleConfigSectionModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleConfigSection(
        ILocalizer localizer,
        VehicleConfigSectionModel? model = null,
        VehicleConfigSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? VehicleConfigSectionModel.Loading;
        _diagnostics = diagnostics ?? new VehicleConfigSectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>VehicleConfigSection</c>).</summary>
    public static string Slug => VehicleConfigSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public VehicleConfigSectionModel Model
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
        var display = VehicleConfigSectionProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            VehicleConfigSectionState.Loading => BuildLoading(display),
            VehicleConfigSectionState.Empty => BuildEmpty(display),
            VehicleConfigSectionState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web truthy branch: title + two-column KVList) ──────────────────────────
    private static TsFadeIn BuildContent(VehicleConfigSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildItemsGrid(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // web header: <Settings/> + "Vehicle Configuration"; always rendered above the body.
    private static Grid BuildHeader(VehicleConfigSectionDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(SettingsGlyph, IconSize, DisplayTokens.Accent));
        titleRow.Children.Add(new SectionTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(VehicleConfigSectionDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    // web <KVList columns={2} />: a two-column grid filled row-major (left = even rows, right = odd rows),
    // reusing the shared TsKVList for each column so a missing value still renders the em dash.
    private static Grid BuildItemsGrid(VehicleConfigSectionDisplay display)
    {
        var left = new List<TsKeyValue>();
        var right = new List<TsKeyValue>();
        for (int i = 0; i < display.Items.Count; i++)
        {
            var item = display.Items[i];
            (i % 2 == 0 ? left : right).Add(new TsKeyValue(item.Label, item.Value));
        }

        var grid = new Grid { ColumnSpacing = ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftList = new TsKVList { Items = left };
        Grid.SetColumn(leftList, 0);
        grid.Children.Add(leftList);

        var rightList = new TsKVList { Items = right };
        Grid.SetColumn(rightList, 1);
        grid.Children.Add(rightList);

        return grid;
    }

    // ── Loading (web else branch: Skeleton lines=4 height=16, header still shown) ─────────────────────────
    private static TsGlassPanel BuildLoading(VehicleConfigSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var lines = new StackPanel { Spacing = SkeletonSpacing };
        for (int i = 0; i < SkeletonLines; i++)
        {
            lines.Children.Add(new TsSkeleton { BlockHeight = SkeletonLineHeight });
        }

        stack.Children.Add(lines);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    // ── Empty (data resolved with no configuration: a friendly empty state, never a blank box) ───────────
    private static TsFadeIn BuildEmpty(VehicleConfigSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState { IconGlyph = SettingsGlyph, Message = display.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ────────────────────────────────────────
    private TsFadeIn BuildError(VehicleConfigSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the surface automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
