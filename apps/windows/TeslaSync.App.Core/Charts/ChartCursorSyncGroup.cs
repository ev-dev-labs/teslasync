namespace TeslaSync.App.Core.Charts;

/// <summary>Carries a synchronized cursor position (or its absence).</summary>
public readonly record struct ChartCursorChange(double DomainX, bool IsActive);

/// <summary>
/// Coordinates a synchronized cursor across a group of charts (mirrors the web
/// ChartTimeRangeContext / cursorSync). When one chart reports a hover position
/// every other subscriber receives the same domain-X so their cursors and
/// tooltips line up. UI-thread-free and testable.
/// </summary>
public sealed class ChartCursorSyncGroup
{
    private double _domainX;
    private bool _isActive;

    /// <summary>Raised whenever the shared cursor moves or clears.</summary>
    public event EventHandler<ChartCursorChange>? CursorChanged;

    /// <summary>The last broadcast domain-X position.</summary>
    public double DomainX => _domainX;

    /// <summary>True while a chart in the group is actively hovered.</summary>
    public bool IsActive => _isActive;

    /// <summary>Broadcasts a new cursor position to every subscriber.</summary>
    public void SetCursor(double domainX)
    {
        _domainX = domainX;
        _isActive = true;
        CursorChanged?.Invoke(this, new ChartCursorChange(domainX, true));
    }

    /// <summary>Clears the cursor (pointer left every chart).</summary>
    public void Clear()
    {
        if (!_isActive)
        {
            return;
        }

        _isActive = false;
        CursorChanged?.Invoke(this, new ChartCursorChange(_domainX, false));
    }
}
