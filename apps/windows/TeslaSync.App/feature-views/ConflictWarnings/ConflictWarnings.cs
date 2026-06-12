using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 <c>ConflictWarnings</c> feature surface — a parity port of
/// <c>web/src/features/automations/pages/ConflictWarnings.tsx</c>. It is a pure presentational list: assign a
/// <see cref="Model"/> (the web <c>conflicts</c> prop) and it renders exactly one of four branches —
/// <see cref="ConflictWarningsState.Loading"/> (tokenized skeleton chrome while a parent resolves the conflict
/// check), <see cref="ConflictWarningsState.Error"/> (a <see cref="TsQueryError"/> InfoBar-equivalent + Retry
/// surface the parent shows when its conflict-check mutation fails — the Retry affordance raises
/// <see cref="RetryRequested"/> so the host can re-run the check), <see cref="ConflictWarningsState.Empty"/>
/// (a friendly <see cref="TsEmptyState"/> in place of the web's bare <c>return null</c>, so the region never
/// collapses to an invisible box) or <see cref="ConflictWarningsState.Ready"/> (the web composition: a
/// vertically stacked list — the web <c>space-y-2</c> — of one <see cref="TsAlertBanner"/> per conflict, each
/// carrying the severity-mapped variant and glyph, the shared "Potential Conflict" heading and the
/// <c>"name": reason</c> body). The view never performs HTTP; all branch selection, severity parsing, variant /
/// glyph mapping and copy resolution happen in the WinUI-free <see cref="ConflictWarningsProjection"/> — the
/// hosting <c>AutomationBuilderPage</c> owns the conflict-check lifecycle (loading / failure) and re-renders this
/// control with the resolved <see cref="Model"/>. Each banner is a shared callout that mirrors the web
/// <c>AlertBanner</c> (non-dismissible, since the web usage passes no <c>onClose</c>); every string resolves
/// through the i18n facade; and the surface carries a Narrator name in each state.
/// </summary>
public sealed partial class ConflictWarnings : ContentControl
{
    private const double BannerSpacing = 8;        // web `space-y-2` (0.5rem)
    private const double SkeletonRowHeight = 56;   // banner row stand-in
    private const double SkeletonCornerRadius = 8; // web AlertBanner `rounded-xl`
    private const int SkeletonRows = 2;            // two skeleton banner rows while loading

    private readonly ILocalizer _localizer;
    private readonly ConflictWarningsDiagnostics _diagnostics;

    private ConflictWarningsModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, the conflicts to render, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The conflicts to render (the web <c>conflicts</c> prop); defaults to <see cref="ConflictWarningsModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ConflictWarnings(
        ILocalizer localizer,
        ConflictWarningsModel? model = null,
        ConflictWarningsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ConflictWarningsModel.Pending;
        _diagnostics = diagnostics ?? new ConflictWarningsDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ConflictWarnings</c>).</summary>
    public static string Slug => ConflictWarningsRegistration.Slug;

    /// <summary>
    /// Raised when the user invokes Retry on the <see cref="ConflictWarningsState.Error"/> surface. The hosting
    /// <c>AutomationBuilderPage</c> (which owns the conflict-check lifecycle) handles it by re-running the check;
    /// the presentational surface itself performs no fetch.
    /// </summary>
    public event EventHandler? RetryRequested;

    /// <summary>The render model (the conflicts); reassigning re-projects and re-renders the surface.</summary>
    public ConflictWarningsModel Model
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
        ConflictWarningsDisplay display = ConflictWarningsProjection.Project(_model, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State switch
        {
            ConflictWarningsState.Loading => BuildLoading(display),
            ConflictWarningsState.Error => BuildError(display),
            ConflictWarningsState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };
    }

    // ── Ready (the web render: a `space-y-2` stack of one AlertBanner per conflict) ───────────────────────
    private static StackPanel BuildReady(ConflictWarningsDisplay display)
    {
        var stack = new StackPanel { Spacing = BannerSpacing };
        foreach (ConflictBannerDisplay banner in display.Banners)
        {
            // The web AlertBanner here passes no `onClose`, so the native banner is non-dismissible. The leading
            // glyph is the variant's default (alert-triangle for warning, info for info), matching the explicit
            // web `icon` prop, so it is driven by the variant rather than set directly.
            stack.Children.Add(new TsAlertBanner
            {
                Variant = banner.Variant,
                Title = banner.Title,
                Message = banner.Message,
                Dismissible = false,
            });
        }

        return stack;
    }

    // ── Error (the parent's conflict-check failed — an InfoBar-equivalent surface with a Retry affordance) ──
    private TsQueryError BuildError(ConflictWarningsDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };

        // The view performs no fetch; Retry bubbles to the host (AutomationBuilderPage), which re-runs the check.
        error.ActionInvoked += OnRetryInvoked;
        AutomationProperties.SetName(error, display.ErrorTitle);
        return error;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Empty (resolved, no conflicts — a friendly surface, never the web's bare `return null`) ────────────
    private static TsEmptyState BuildEmpty(ConflictWarningsDisplay display) =>
        new() { Message = display.EmptyMessage };

    // ── Loading (a parent is still resolving the conflict check) ───────────────────────────────────────────
    private static StackPanel BuildLoading(ConflictWarningsDisplay display)
    {
        var stack = new StackPanel { Spacing = BannerSpacing };
        for (int i = 0; i < SkeletonRows; i++)
        {
            stack.Children.Add(new TsSkeleton
            {
                BlockHeight = SkeletonRowHeight,
                Radius = SkeletonCornerRadius,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        AutomationProperties.SetName(stack, display.LoadingLabel);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }
}
