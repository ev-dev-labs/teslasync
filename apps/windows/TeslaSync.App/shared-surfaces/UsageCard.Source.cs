namespace TeslaSync.App.SharedSurfaces.UsageCardSurface;

/// <summary>
/// The data seam the <see cref="UsageCardViewModel"/> binds to (P1/S8 state-holder seam) — the native analogue
/// of the props the web <c>UsageCard</c> receives from its parent
/// (web/src/components/data-display/UsageCard.tsx). The web card is presentational and never fetches; likewise
/// this seam simply holds the resolved <see cref="Input"/> and raises <see cref="Changed"/> when it is
/// reassigned — the analogue of the parent re-rendering with new props. The view never touches this seam or HTTP
/// directly; it observes the view-model.
/// </summary>
public interface IUsageCardSource
{
    /// <summary>The current presentational inputs; never null.</summary>
    UsageCardInput Input { get; }

    /// <summary>Raised whenever the input changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IUsageCardSource"/> — the canonical holder a page (or a test) pushes the card's
/// presentational inputs into. It mirrors a parent passing fresh props to the web <c>UsageCard</c>:
/// <see cref="SetInput"/> replaces the whole input, while the focused mutators move a single region (the budget,
/// the bands, the details, the top-lists, the banner, the footer or the empty message) keeping every other
/// field, each raising <see cref="Changed"/> so the bound view-model re-projects. A null assignment falls back
/// to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class UsageCardSource : IUsageCardSource
{
    private UsageCardInput _input;

    /// <summary>Creates an empty source (no regions — the empty-state case).</summary>
    public UsageCardSource()
        : this(new UsageCardInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input (a null falls back to the default input).</summary>
    /// <param name="input">The initial presentational inputs.</param>
    public UsageCardSource(UsageCardInput input) => _input = input ?? new UsageCardInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public UsageCardInput Input => _input;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new presentational inputs.</param>
    public void SetInput(UsageCardInput input)
    {
        _input = input ?? new UsageCardInput();
        RaiseChanged();
    }

    /// <summary>Replace just the budget section (null hides it) and notify.</summary>
    /// <param name="budget">The new budget, or null to drop the budget section.</param>
    public void SetBudget(UsageCardBudget? budget)
    {
        _input = _input with { Budget = budget };
        RaiseChanged();
    }

    /// <summary>Replace just the bands (null clears them) and notify.</summary>
    /// <param name="bands">The new bands.</param>
    public void SetBands(IReadOnlyList<UsageCardBand>? bands)
    {
        _input = _input with { Bands = bands };
        RaiseChanged();
    }

    /// <summary>Replace just the detail cells (null clears them) and notify.</summary>
    /// <param name="details">The new detail cells.</param>
    public void SetDetails(IReadOnlyList<UsageCardDetail>? details)
    {
        _input = _input with { Details = details };
        RaiseChanged();
    }

    /// <summary>Replace just the top-list blocks (null clears them) and notify.</summary>
    /// <param name="topLists">The new top-list blocks.</param>
    public void SetTopLists(IReadOnlyList<UsageCardTopList>? topLists)
    {
        _input = _input with { TopLists = topLists };
        RaiseChanged();
    }

    /// <summary>Replace just the banner (null hides it) and notify.</summary>
    /// <param name="banner">The new banner, or null to drop the banner.</param>
    public void SetBanner(UsageCardBanner? banner)
    {
        _input = _input with { Banner = banner };
        RaiseChanged();
    }

    /// <summary>Replace just the footer links (null clears them) and notify.</summary>
    /// <param name="footer">The new footer links.</param>
    public void SetFooter(IReadOnlyList<UsageCardFooterLink>? footer)
    {
        _input = _input with { Footer = footer };
        RaiseChanged();
    }

    /// <summary>Replace just the empty-state message (already-localized) and notify.</summary>
    /// <param name="emptyMessage">The new empty-state message, or null for the neutral icon alone.</param>
    public void SetEmptyMessage(string? emptyMessage)
    {
        _input = _input with { EmptyMessage = emptyMessage };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
