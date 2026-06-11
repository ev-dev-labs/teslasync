namespace TeslaSync.App.SharedSurfaces.KpiOverviewCardSurface;

/// <summary>
/// The data seam the <see cref="KpiOverviewCardViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>KpiOverviewCard</c> receives from its parent
/// (web/src/components/data-display/KpiOverviewCard.tsx). The web card is presentational and never fetches;
/// likewise this seam simply holds the resolved <see cref="Input"/> (the header strings, the optional-slot
/// presence flags, the KPI tile count and the grid-column override) and raises <see cref="Changed"/> when it is
/// reassigned — the analogue of the parent re-rendering with new props. The view never touches this seam or HTTP
/// directly; it observes the view-model.
/// </summary>
public interface IKpiOverviewCardSource
{
    /// <summary>The current presentational inputs; never null.</summary>
    KpiOverviewCardInput Input { get; }

    /// <summary>Raised whenever the input changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IKpiOverviewCardSource"/> — the canonical holder a page (or a test) pushes the
/// card's presentational inputs into. It mirrors a parent passing fresh props to the web
/// <c>KpiOverviewCard</c>: <see cref="SetInput"/> replaces the whole input, while the focused mutators move a
/// single facet (the header, the comparison label, each slot-presence flag, the KPI count or the column
/// override) keeping every other field, each raising <see cref="Changed"/> so the bound view-model re-projects.
/// A null assignment falls back to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class KpiOverviewCardSource : IKpiOverviewCardSource
{
    private KpiOverviewCardInput _input;

    /// <summary>Creates an empty source (an anonymous header, no slots and no tiles).</summary>
    public KpiOverviewCardSource()
        : this(new KpiOverviewCardInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input (a null falls back to the default input).</summary>
    /// <param name="input">The initial presentational inputs.</param>
    public KpiOverviewCardSource(KpiOverviewCardInput input) => _input = input ?? new KpiOverviewCardInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public KpiOverviewCardInput Input => _input;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new presentational inputs.</param>
    public void SetInput(KpiOverviewCardInput input)
    {
        _input = input ?? new KpiOverviewCardInput();
        RaiseChanged();
    }

    /// <summary>Replace just the header strings (a null falls back to an empty header) and notify.</summary>
    /// <param name="header">The new header strings.</param>
    public void SetHeader(KpiOverviewCardHeader header)
    {
        _input = _input with { Header = header ?? new KpiOverviewCardHeader() };
        RaiseChanged();
    }

    /// <summary>Move just the comparison label, keeping the title and current label, and notify.</summary>
    /// <param name="comparisonLabel">The new comparison label, or null to drop it.</param>
    public void SetComparisonLabel(string? comparisonLabel)
    {
        _input = _input with { Header = _input.Header with { ComparisonLabel = comparisonLabel } };
        RaiseChanged();
    }

    /// <summary>Toggle whether the header shows its headline delta (web <c>header.delta</c> presence) and notify.</summary>
    /// <param name="hasHeadlineDelta">Whether the headline delta is present.</param>
    public void SetHasHeadlineDelta(bool hasHeadlineDelta)
    {
        if (_input.HasHeadlineDelta == hasHeadlineDelta)
        {
            return;
        }

        _input = _input with { HasHeadlineDelta = hasHeadlineDelta };
        RaiseChanged();
    }

    /// <summary>Toggle whether the header shows its actions (web <c>header.actions</c> presence) and notify.</summary>
    /// <param name="hasActions">Whether the header actions are present.</param>
    public void SetHasActions(bool hasActions)
    {
        if (_input.HasActions == hasActions)
        {
            return;
        }

        _input = _input with { HasActions = hasActions };
        RaiseChanged();
    }

    /// <summary>Toggle whether the muted secondary stats line is shown (web <c>secondary</c> presence) and notify.</summary>
    /// <param name="hasSecondary">Whether the secondary line is present.</param>
    public void SetHasSecondary(bool hasSecondary)
    {
        if (_input.HasSecondary == hasSecondary)
        {
            return;
        }

        _input = _input with { HasSecondary = hasSecondary };
        RaiseChanged();
    }

    /// <summary>Toggle whether the footer slot is shown (web <c>footer</c> presence) and notify.</summary>
    /// <param name="hasFooter">Whether the footer is present.</param>
    public void SetHasFooter(bool hasFooter)
    {
        if (_input.HasFooter == hasFooter)
        {
            return;
        }

        _input = _input with { HasFooter = hasFooter };
        RaiseChanged();
    }

    /// <summary>Set the count of KPI tiles in the grid (web <c>kpis</c> children count) and notify.</summary>
    /// <param name="kpiCount">The number of tiles; negative values clamp to zero.</param>
    public void SetKpiCount(int kpiCount)
    {
        int safe = Math.Max(0, kpiCount);
        if (_input.KpiCount == safe)
        {
            return;
        }

        _input = _input with { KpiCount = safe };
        RaiseChanged();
    }

    /// <summary>Set the fixed column-count override (web <c>gridClassName</c>); null restores the responsive grid.</summary>
    /// <param name="gridColumns">The fixed column count, or null for the responsive 2 / 3 / 6 behaviour.</param>
    public void SetGridColumns(int? gridColumns)
    {
        if (_input.GridColumns == gridColumns)
        {
            return;
        }

        _input = _input with { GridColumns = gridColumns };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
