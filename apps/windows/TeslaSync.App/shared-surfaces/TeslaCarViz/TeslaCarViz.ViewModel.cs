using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The dominant ambient-glow mode behind the car — the native analogue of the web priority ternary that picks
/// the radial-gradient glow colour (web/src/components/data-display/TeslaCarViz.tsx): sentry beats charging beats
/// driving beats the idle default.
/// </summary>
public enum TeslaCarVizAmbient
{
    /// <summary>web idle default — a faint neutral glow.</summary>
    Idle,

    /// <summary>web <c>driving</c> — a cyan glow.</summary>
    Driving,

    /// <summary>web <c>isCharging</c> — an emerald glow.</summary>
    Charging,

    /// <summary>web <c>sentryMode</c> — a red glow (the highest priority).</summary>
    Sentry,
}

/// <summary>The kind of one parsed SVG path segment (the subset the web silhouettes use).</summary>
public enum TeslaCarVizSegmentKind
{
    /// <summary>SVG <c>M</c> — start a new sub-path at the point.</summary>
    MoveTo,

    /// <summary>SVG <c>L</c> — straight line to the point.</summary>
    LineTo,

    /// <summary>SVG <c>Q</c> — quadratic Bézier (one control point + endpoint).</summary>
    QuadraticBezier,

    /// <summary>SVG <c>C</c> — cubic Bézier (two control points + endpoint).</summary>
    CubicBezier,

    /// <summary>SVG <c>A</c> — elliptical arc (rx ry rotation large-arc sweep x y).</summary>
    Arc,

    /// <summary>SVG <c>Z</c> — close the current sub-path.</summary>
    Close,
}

/// <summary>
/// One parsed SVG path segment — a kind plus its raw numeric arguments in SVG order (MoveTo / LineTo carry
/// <c>[x, y]</c>; QuadraticBezier <c>[cx, cy, x, y]</c>; CubicBezier <c>[c1x, c1y, c2x, c2y, x, y]</c>; Arc
/// <c>[rx, ry, rotation, largeArcFlag, sweepFlag, x, y]</c>; Close none). Pure data so the parser is verified
/// headlessly; the WinUI view turns these into <c>PathFigure</c> segments.
/// </summary>
/// <param name="Kind">The segment kind.</param>
/// <param name="Args">The raw numeric arguments in SVG order.</param>
public sealed record TeslaCarVizSegment(TeslaCarVizSegmentKind Kind, IReadOnlyList<double> Args);

/// <summary>
/// A minimal SVG path-data parser for the absolute commands the <c>TeslaCarViz</c> silhouettes use
/// (web/src/components/data-display/TeslaCarViz.tsx): <c>M</c>, <c>L</c>, <c>Q</c>, <c>C</c>, <c>A</c> and
/// <c>Z</c>. It tokenizes numbers (sign, decimal, exponent and the sign-packed form SVG allows, e.g.
/// <c>A3 3 0 0 1 3 -5</c>) and honours SVG's implicit-command rule (extra coordinate pairs after an <c>M</c> are
/// treated as <c>L</c>). Kept WinUI-free so the geometry math is unit-tested against the real web path strings
/// without a XAML runtime; the view performs the trivial segment-to-<c>PathFigure</c> mapping.
/// </summary>
public static class TeslaCarVizPathParser
{
    /// <summary>
    /// Parse SVG path data into an ordered list of <see cref="TeslaCarVizSegment"/>. Unrecognised input is
    /// handled defensively (a stray number before any command is skipped; a truncated command ends parsing) so
    /// the parser never throws or loops on malformed data.
    /// </summary>
    /// <param name="data">The SVG path mini-language string (the <c>d</c> attribute).</param>
    /// <returns>The parsed segments in document order.</returns>
    public static IReadOnlyList<TeslaCarVizSegment> Parse(string data)
    {
        ArgumentNullException.ThrowIfNull(data);

        var segments = new List<TeslaCarVizSegment>();
        int i = 0;
        int len = data.Length;
        char command = '\0';

        while (i < len)
        {
            char c = data[i];
            if (char.IsWhiteSpace(c) || c == ',')
            {
                i++;
                continue;
            }

            bool consumedCommand = false;
            if (IsCommand(c))
            {
                command = c;
                consumedCommand = true;
                i++;
            }
            else if (command == '\0')
            {
                // A number before any command — malformed; skip the character defensively.
                i++;
                continue;
            }

            switch (command)
            {
                case 'M':
                    if (!AddArgs(segments, data, ref i, TeslaCarVizSegmentKind.MoveTo, 2))
                    {
                        return segments;
                    }

                    // SVG: additional coordinate pairs after an M are implicit L commands.
                    command = 'L';
                    break;
                case 'L':
                    if (!AddArgs(segments, data, ref i, TeslaCarVizSegmentKind.LineTo, 2))
                    {
                        return segments;
                    }

                    break;
                case 'Q':
                    if (!AddArgs(segments, data, ref i, TeslaCarVizSegmentKind.QuadraticBezier, 4))
                    {
                        return segments;
                    }

                    break;
                case 'C':
                    if (!AddArgs(segments, data, ref i, TeslaCarVizSegmentKind.CubicBezier, 6))
                    {
                        return segments;
                    }

                    break;
                case 'A':
                    if (!AddArgs(segments, data, ref i, TeslaCarVizSegmentKind.Arc, 7))
                    {
                        return segments;
                    }

                    break;
                case 'Z':
                    if (!consumedCommand)
                    {
                        // A stray token after a close with no new command — skip it to stay in lock-step.
                        i++;
                        break;
                    }

                    segments.Add(new TeslaCarVizSegment(TeslaCarVizSegmentKind.Close, Array.Empty<double>()));
                    break;
                default:
                    return segments;
            }
        }

        return segments;
    }

    private static bool IsCommand(char c) => c is 'M' or 'L' or 'Q' or 'C' or 'A' or 'Z';

    private static bool AddArgs(
        List<TeslaCarVizSegment> segments,
        string data,
        ref int i,
        TeslaCarVizSegmentKind kind,
        int count)
    {
        var args = new double[count];
        for (int k = 0; k < count; k++)
        {
            if (!TryReadNumber(data, ref i, out args[k]))
            {
                return false;
            }
        }

        segments.Add(new TeslaCarVizSegment(kind, args));
        return true;
    }

    private static bool TryReadNumber(string s, ref int i, out double value)
    {
        value = 0;
        int len = s.Length;
        while (i < len && (char.IsWhiteSpace(s[i]) || s[i] == ','))
        {
            i++;
        }

        int start = i;
        if (i < len && (s[i] == '+' || s[i] == '-'))
        {
            i++;
        }

        bool anyDigit = false;
        while (i < len && char.IsAsciiDigit(s[i]))
        {
            i++;
            anyDigit = true;
        }

        if (i < len && s[i] == '.')
        {
            i++;
            while (i < len && char.IsAsciiDigit(s[i]))
            {
                i++;
                anyDigit = true;
            }
        }

        if (anyDigit && i < len && (s[i] == 'e' || s[i] == 'E'))
        {
            int save = i;
            i++;
            if (i < len && (s[i] == '+' || s[i] == '-'))
            {
                i++;
            }

            bool expDigit = false;
            while (i < len && char.IsAsciiDigit(s[i]))
            {
                i++;
                expDigit = true;
            }

            if (!expDigit)
            {
                i = save;
            }
        }

        if (!anyDigit)
        {
            i = start;
            return false;
        }

        return double.TryParse(s.AsSpan(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}

/// <summary>
/// The per-model silhouette geometry — the native analogue of the web <c>WHEEL_POS</c> table and the per-model
/// <c>bodies</c> / <c>miniPaths</c> path strings (web/src/components/data-display/TeslaCarViz.tsx). The body,
/// roof and windshield path data are ported verbatim from the web source so the native silhouette matches it
/// stroke-for-stroke; the wheel / headlight / taillight / battery-bar / lock anchor points mirror
/// <c>WHEEL_POS[model]</c>. Pure data so it is asserted headlessly.
/// </summary>
public sealed record TeslaCarVizGeometry(
    string BodyPath,
    string RoofPath,
    string WindPath,
    string MiniPath,
    double FrontWheelX,
    double RearWheelX,
    double WheelY,
    double HeadlightX,
    double HeadlightY,
    double TaillightX,
    double TaillightY,
    double BatteryX,
    double BatteryY,
    double LockX,
    double LockY)
{
    /// <summary>The shared logical battery-bar width (web <c>width="260"</c>).</summary>
    public const double BatteryBarWidth = 260;

    /// <summary>The geometry table for <paramref name="model"/>, ported verbatim from the web source.</summary>
    /// <param name="model">The model family.</param>
    public static TeslaCarVizGeometry For(TeslaModelFamily model) => model switch
    {
        TeslaModelFamily.ModelS => new TeslaCarVizGeometry(
            BodyPath: "M 112 210 Q 96 184 116 170 L 181 166 Q 201 148 228 132 Q 263 118 303 116 L 387 116 Q 418 118 446 132 Q 469 148 484 168 Q 494 180 496 194 Q 498 202 498 210 L 112 210 Z",
            RoofPath: "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 383 114 Q 414 116 440 130 L 463 150 L 461 160 Q 420 164 329 164 Q 259 164 226 162 L 216 154 Z",
            WindPath: "M 218 148 L 238 130 Q 265 118 298 116 L 380 116 L 438 132 L 432 138 C 416 132 388 124 358 120 C 328 118 298 119 274 124 L 222 148 Z",
            MiniPath: "M6 22 C6 22 7 17 11 15 L17 11 C19 10 24 8 28 7.5 C33 7 40 6.8 46 7 C50 7.2 53 8.5 55 10 L59 13 C60.5 14 61.5 15.5 61.8 17 L62 22 L6 22 Z",
            FrontWheelX: 160, RearWheelX: 432, WheelY: 210,
            HeadlightX: 108, HeadlightY: 180, TaillightX: 490, TaillightY: 178,
            BatteryX: 158, BatteryY: 172, LockX: 296, LockY: 108),
        TeslaModelFamily.ModelY => new TeslaCarVizGeometry(
            BodyPath: "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 261 116 300 114 L 375 114 Q 410 116 440 130 Q 465 146 481 168 Q 490 182 492 196 Q 494 204 494 210 L 118 210 Z",
            RoofPath: "M 210 142 Q 228 128 259 118 Q 292 114 331 112 L 372 112 Q 405 114 432 128 L 455 148 L 453 158 Q 414 162 319 162 Q 249 162 220 160 L 212 150 Z",
            WindPath: "M 214 146 L 234 128 Q 261 116 294 114 L 370 114 L 430 130 L 424 136 C 408 128 380 120 350 118 C 320 116 292 117 268 122 L 218 146 Z",
            MiniPath: "M8 23 C8 23 9 17 13 14 L19 10 C21 9 25 7 29 6.5 C33 6 40 5.8 44 6 C48 6.2 51 7.5 53 9 L57 12 C58.5 13 59.5 14.5 59.8 16 L60 23 L8 23 Z",
            FrontWheelX: 160, RearWheelX: 432, WheelY: 210,
            HeadlightX: 112, HeadlightY: 178, TaillightX: 486, TaillightY: 176,
            BatteryX: 158, BatteryY: 170, LockX: 296, LockY: 104),
        TeslaModelFamily.ModelX => new TeslaCarVizGeometry(
            BodyPath: "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 259 116 298 112 L 375 112 Q 410 114 440 130 Q 463 146 479 166 Q 488 180 492 194 Q 494 202 494 210 L 118 210 Z",
            RoofPath: "M 210 140 Q 228 126 257 118 Q 288 112 327 110 L 372 110 Q 405 112 432 126 L 455 144 L 453 156 Q 412 160 317 160 Q 247 160 218 158 L 212 150 Z",
            WindPath: "M 214 144 L 234 126 Q 259 116 290 112 L 370 112 L 430 128 L 424 134 C 408 126 380 118 350 116 C 320 114 290 115 268 120 L 218 144 Z",
            MiniPath: "M7 24 C7 24 8 17 12 14 L18 9 C20 8 24 6 28 5.5 C32 5 39 4.8 44 5 C48 5.2 51 6.5 53 8 L57 11 C58.5 12 59.5 14 59.8 16 L60 24 L7 24 Z",
            FrontWheelX: 160, RearWheelX: 432, WheelY: 210,
            HeadlightX: 112, HeadlightY: 176, TaillightX: 486, TaillightY: 174,
            BatteryX: 158, BatteryY: 168, LockX: 296, LockY: 100),
        TeslaModelFamily.Cybertruck => new TeslaCarVizGeometry(
            BodyPath: "M 104 210 L 109 200 L 121 186 L 170 166 L 220 152 L 434 152 L 468 164 L 483 182 L 487 200 L 488 210 L 104 210 Z",
            RoofPath: "M 225 156 L 259 152 L 419 152 L 439 164 L 434 178 L 234 178 L 228 168 Z",
            WindPath: "M 230 160 L 262 152 L 420 152 L 436 162 L 432 170 L 240 170 L 232 164 Z",
            MiniPath: "M7 22 L7 17 L10 16 L16 12 L26 9 L34 8 L48 8 L52 8 L58 12 L60 16 L60 22 L7 22 Z",
            FrontWheelX: 160, RearWheelX: 432, WheelY: 210,
            HeadlightX: 108, HeadlightY: 176, TaillightX: 480, TaillightY: 165,
            BatteryX: 158, BatteryY: 172, LockX: 296, LockY: 108),
        _ => new TeslaCarVizGeometry(
            BodyPath: "M 118 210 Q 104 186 122 170 L 181 166 Q 201 148 228 132 Q 263 118 304 116 L 385 116 Q 416 118 444 132 Q 467 148 483 168 Q 492 180 494 194 Q 496 202 496 210 L 118 210 Z",
            RoofPath: "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 381 114 Q 412 116 438 130 L 461 150 L 459 160 Q 418 164 329 164 Q 259 164 226 162 L 216 154 Z",
            WindPath: "M 218 148 L 238 130 Q 265 118 298 116 L 378 116 L 436 132 L 430 138 C 414 132 386 124 356 120 C 326 118 296 119 272 124 L 222 148 Z",
            MiniPath: "M8 22 C8 22 9 18 13 16 L20 12 C22 11 26 9 30 8.5 C34 8 40 7.8 44 8 C48 8.2 51 9.5 53 11 L57 14 C58.5 15 59.5 16.5 59.8 18 L60 22 L8 22 Z",
            FrontWheelX: 160, RearWheelX: 432, WheelY: 210,
            HeadlightX: 112, HeadlightY: 180, TaillightX: 488, TaillightY: 178,
            BatteryX: 158, BatteryY: 172, LockX: 296, LockY: 108),
    };
}

/// <summary>
/// The theme-aware colour palette for the car schematic — the native, headless analogue of the web
/// <c>useSvgPalette()</c> closure (web/src/components/data-display/TeslaCarViz.tsx). Every value is ported
/// verbatim from the web source's light / dark branches so the structural (non-semantic) colours of the body,
/// glass, wheels, detail lines, lighting, shadow, ambient glow, status legend and mini silhouette match exactly.
/// The view reads these named fields rather than embedding hex / rgba literals in the control layer; the
/// semantic state colours (battery, lock, charge, climate, sentry) instead resolve through generated design
/// tokens so they also adapt under high contrast. Colour strings are CSS <c>#rrggbb</c> / <c>rgba(...)</c> /
/// named, parsed to brushes by the view.
/// </summary>
public sealed record TeslaCarVizPalette(
    bool IsLight,
    string BodyFill,
    string BodyStroke,
    string GlassFill,
    string GlassStroke,
    string WindFill,
    string WindStroke,
    string WheelOuter,
    string WheelOuterStroke,
    string WheelInner,
    string WheelInnerStroke,
    string WheelHub,
    string WheelHubStroke,
    string DetailLine,
    string DetailLineFaint,
    string DetailLineSubtle,
    string BatteryBackground,
    string BatteryText,
    string Shadow,
    string HeadlightOn,
    string ProjectorOn,
    string TurnSignalOn,
    string HeadlightOff,
    string FalconWingMain,
    string FalconWingTip,
    string SpeedLine,
    string LockBackground,
    string Climate,
    string SentryRing1,
    string SentryRing2,
    string AmbientSentry,
    string AmbientCharging,
    string AmbientDriving,
    string AmbientIdle,
    string StatusInactive,
    string StatusTextInactive,
    string Tread,
    string MiniBodyFill,
    string MiniBodyStroke,
    string MiniWheelFill,
    string MiniWheelStroke,
    string MiniBatteryBackground)
{
    /// <summary>The roof shine highlight (web inline <c>rgba(255,255,255,0.06)</c>), constant across themes.</summary>
    public const string RoofHighlight = "rgba(255,255,255,0.06)";

    /// <summary>The taillight LED strip colour (web inline <c>#ef4444</c>), constant across themes.</summary>
    public const string Taillight = "#ef4444";

    /// <summary>The brighter taillight inner core (web inline <c>#ff6b6b</c>), constant across themes.</summary>
    public const string TaillightCore = "#ff6b6b";

    /// <summary>The taillight glow halo (web inline <c>rgba(239,68,68,0.08)</c>), constant across themes.</summary>
    public const string TaillightGlow = "rgba(239,68,68,0.08)";

    /// <summary>The headlight beam cone fill (web inline <c>rgba(255,251,230,0.03)</c>), constant across themes.</summary>
    public const string BeamCone = "rgba(255,251,230,0.03)";

    /// <summary>The charge cable / plug colour (web inline <c>#10b981</c>), constant across themes.</summary>
    public const string ChargeCable = "#10b981";

    /// <summary>The locked lock-glyph colour (web inline <c>#10b981</c>), constant across themes.</summary>
    public const string LockLocked = "#10b981";

    /// <summary>The unlocked lock-glyph colour (web inline <c>#f59e0b</c>), constant across themes.</summary>
    public const string LockUnlocked = "#f59e0b";

    /// <summary>The light palette (web <c>isLight</c> branch of <c>useSvgPalette</c>).</summary>
    public static TeslaCarVizPalette Light { get; } = new(
        IsLight: true,
        BodyFill: "#d4d8e0",
        BodyStroke: "rgba(0,0,0,0.2)",
        GlassFill: "rgba(0,120,200,0.15)",
        GlassStroke: "rgba(0,120,200,0.25)",
        WindFill: "rgba(0,120,200,0.12)",
        WindStroke: "rgba(0,120,200,0.2)",
        WheelOuter: "rgba(0,0,0,0.15)",
        WheelOuterStroke: "rgba(0,0,0,0.2)",
        WheelInner: "rgba(40,40,50,0.6)",
        WheelInnerStroke: "rgba(0,0,0,0.3)",
        WheelHub: "rgba(50,50,60,0.7)",
        WheelHubStroke: "rgba(0,0,0,0.25)",
        DetailLine: "rgba(0,0,0,0.1)",
        DetailLineFaint: "rgba(0,0,0,0.06)",
        DetailLineSubtle: "rgba(0,0,0,0.04)",
        BatteryBackground: "rgba(0,0,0,0.08)",
        BatteryText: "rgba(0,0,0,0.7)",
        Shadow: "rgba(0,0,0,0.08)",
        HeadlightOn: "#ffffff",
        ProjectorOn: "#fffbe6",
        TurnSignalOn: "#fbbf24",
        HeadlightOff: "rgba(0,0,0,0.1)",
        FalconWingMain: "rgba(0,120,200,0.15)",
        FalconWingTip: "rgba(0,120,200,0.1)",
        SpeedLine: "rgba(0,120,200,0.3)",
        LockBackground: "rgba(0,0,0,0.08)",
        Climate: "rgba(0,120,200,0.4)",
        SentryRing1: "rgba(239,68,68,0.2)",
        SentryRing2: "rgba(239,68,68,0.12)",
        AmbientSentry: "rgba(239,68,68,0.2)",
        AmbientCharging: "rgba(16,185,129,0.2)",
        AmbientDriving: "rgba(0,120,200,0.15)",
        AmbientIdle: "rgba(0,0,0,0.03)",
        StatusInactive: "rgba(0,0,0,0.2)",
        StatusTextInactive: "rgba(0,0,0,0.3)",
        Tread: "rgba(0,0,0,0.1)",
        MiniBodyFill: "rgba(0,0,0,0.06)",
        MiniBodyStroke: "rgba(0,0,0,0.25)",
        MiniWheelFill: "rgba(0,0,0,0.15)",
        MiniWheelStroke: "rgba(0,0,0,0.2)",
        MiniBatteryBackground: "rgba(0,0,0,0.08)");

    /// <summary>The dark palette (web else branch of <c>useSvgPalette</c>; the web app default scheme).</summary>
    public static TeslaCarVizPalette Dark { get; } = new(
        IsLight: false,
        BodyFill: "#2d3748",
        BodyStroke: "rgba(255,255,255,0.08)",
        GlassFill: "rgba(15,23,42,0.9)",
        GlassStroke: "rgba(255,255,255,0.12)",
        WindFill: "rgba(15,23,42,0.85)",
        WindStroke: "rgba(255,255,255,0.1)",
        WheelOuter: "rgba(0,0,0,0.6)",
        WheelOuterStroke: "rgba(255,255,255,0.1)",
        WheelInner: "rgba(30,30,40,0.8)",
        WheelInnerStroke: "rgba(255,255,255,0.2)",
        WheelHub: "rgba(60,60,70,0.9)",
        WheelHubStroke: "rgba(255,255,255,0.15)",
        DetailLine: "rgba(255,255,255,0.08)",
        DetailLineFaint: "rgba(255,255,255,0.06)",
        DetailLineSubtle: "rgba(255,255,255,0.04)",
        BatteryBackground: "rgba(255,255,255,0.05)",
        BatteryText: "white",
        Shadow: "rgba(0,0,0,0.3)",
        HeadlightOn: "#ffffff",
        ProjectorOn: "#fffbe6",
        TurnSignalOn: "#fbbf24",
        HeadlightOff: "rgba(255,255,255,0.08)",
        FalconWingMain: "rgba(0,240,255,0.08)",
        FalconWingTip: "rgba(0,240,255,0.06)",
        SpeedLine: "rgba(0,240,255,0.3)",
        LockBackground: "rgba(0,0,0,0.4)",
        Climate: "rgba(0,240,255,0.4)",
        SentryRing1: "rgba(239,68,68,0.15)",
        SentryRing2: "rgba(239,68,68,0.08)",
        AmbientSentry: "rgba(239,68,68,0.4)",
        AmbientCharging: "rgba(16,185,129,0.4)",
        AmbientDriving: "rgba(0,240,255,0.3)",
        AmbientIdle: "rgba(255,255,255,0.05)",
        StatusInactive: "rgba(255,255,255,0.2)",
        StatusTextInactive: "rgba(255,255,255,0.3)",
        Tread: "rgba(255,255,255,0.06)",
        MiniBodyFill: "rgba(255,255,255,0.04)",
        MiniBodyStroke: "rgba(255,255,255,0.15)",
        MiniWheelFill: "rgba(0,0,0,0.5)",
        MiniWheelStroke: "rgba(255,255,255,0.1)",
        MiniBatteryBackground: "rgba(255,255,255,0.05)");

    /// <summary>The palette for the active colour scheme (web <c>mode.colorScheme === 'light'</c>).</summary>
    /// <param name="isLight">Whether the active scheme is light.</param>
    public static TeslaCarVizPalette ForScheme(bool isLight) => isLight ? Light : Dark;

    /// <summary>The ambient-glow colour for <paramref name="mode"/> (web <c>ambient[...]</c> gradient centre).</summary>
    /// <param name="mode">The dominant ambient mode.</param>
    public string Ambient(TeslaCarVizAmbient mode) => mode switch
    {
        TeslaCarVizAmbient.Sentry => AmbientSentry,
        TeslaCarVizAmbient.Charging => AmbientCharging,
        TeslaCarVizAmbient.Driving => AmbientDriving,
        _ => AmbientIdle,
    };
}

/// <summary>
/// One status-legend chip below the car — the native analogue of one web <c>&lt;StatusDot&gt;</c>
/// (web/src/components/data-display/TeslaCarViz.tsx). When <see cref="Active"/> the dot and label take the
/// semantic <see cref="ActiveBrushKey"/> token (with a glow); when inactive they fall to the muted token, exactly
/// as the web component swaps to its <c>statusInactive</c> / <c>statusTextInactive</c> palette entries.
/// </summary>
/// <param name="Active">Whether the state the chip represents is on (web <c>active</c>).</param>
/// <param name="ActiveBrushKey">The design-token brush key used when active (web <c>color</c>).</param>
/// <param name="Label">The localized chip label (web <c>label</c>).</param>
public sealed record TeslaCarVizStatusChip(bool Active, string ActiveBrushKey, string Label);

/// <summary>
/// The fully projected, render-ready view of a <see cref="TeslaCarVizModel"/> — everything the web component
/// derives before returning JSX (web/src/components/data-display/TeslaCarViz.tsx): the resolved render size
/// (<see cref="Width"/> / <see cref="Height"/> from the web <c>sizeMap</c> and per-model <c>aspect</c>), the
/// <see cref="Driving"/> flag (web <c>speed &gt; 0</c>), the battery <see cref="BatteryFraction"/> /
/// <see cref="BatteryText"/> / token <see cref="BatteryBrushKey"/> (web <c>batteryColor</c>), the
/// <see cref="Ambient"/> priority (web sentry → charging → driving → idle), the per-model
/// <see cref="Geometry"/>, the boolean state flags the view conditionally renders against, the per-element
/// animation flags (already gated by the reduce-motion preference), the ordered status <see cref="Chips"/> (web
/// <c>StatusDot</c> row) and the composed accessible <see cref="AutomationName"/>. Pure data so every value is
/// asserted headlessly; the palette (the only theme-dependent input) is supplied separately by the view-model.
/// </summary>
public sealed record TeslaCarVizProjection
{
    private TeslaCarVizProjection()
    {
    }

    /// <summary>The model family the silhouette draws (web <c>model</c>).</summary>
    public TeslaModelFamily Model { get; private init; }

    /// <summary>The render variant — full schematic or compact mini (web <c>&lt;TeslaCarViz&gt;</c> / <c>&lt;TeslaCarMini&gt;</c>).</summary>
    public TeslaCarVizVariant Variant { get; private init; }

    /// <summary>The logical canvas width for the size (web <c>sizeMap[size]</c>).</summary>
    public double Width { get; private init; }

    /// <summary>The logical canvas height (web <c>w * aspect</c>).</summary>
    public double Height { get; private init; }

    /// <summary>Whether the car is moving (web <c>driving = speed &gt; 0</c>).</summary>
    public bool Driving { get; private init; }

    /// <summary>Whether the charge cable / plug and the charging chip are shown (web <c>isCharging</c>).</summary>
    public bool IsCharging { get; private init; }

    /// <summary>Whether the lock glyph is the locked variant (web <c>isLocked</c>).</summary>
    public bool IsLocked { get; private init; }

    /// <summary>Whether the climate waves and chip are shown (web <c>isClimateOn</c>).</summary>
    public bool IsClimateOn { get; private init; }

    /// <summary>Whether the sentry rings, red ambient glow and chip are shown (web <c>sentryMode</c>).</summary>
    public bool SentryMode { get; private init; }

    /// <summary>The raw battery percentage as supplied (web <c>batteryLevel</c>).</summary>
    public double BatteryLevel { get; private init; }

    /// <summary>The battery bar fill fraction, clamped to 0-1 (web <c>(batteryLevel / 100) * 260</c> width).</summary>
    public double BatteryFraction { get; private init; }

    /// <summary>The battery label text, e.g. "78%" (web <c>{batteryLevel}%</c>).</summary>
    public string BatteryText { get; private init; } = string.Empty;

    /// <summary>The design-token brush key for the battery colour (web <c>batteryColor(batteryLevel)</c>).</summary>
    public string BatteryBrushKey { get; private init; } = TeslaCarVizColors.Danger;

    /// <summary>The design-token brush key for the lock glyph (web <c>boolColor(isLocked)</c>).</summary>
    public string LockBrushKey { get; private init; } = TeslaCarVizColors.Warning;

    /// <summary>The dominant ambient glow mode (web sentry → charging → driving → idle priority).</summary>
    public TeslaCarVizAmbient Ambient { get; private init; }

    /// <summary>The per-model silhouette geometry (web <c>WHEEL_POS[model]</c> + body / roof / wind paths).</summary>
    public TeslaCarVizGeometry Geometry { get; private init; } = TeslaCarVizGeometry.For(TeslaModelFamily.Model3);

    /// <summary>Whether the wheels rotate (web <c>driving</c>, gated by the reduce-motion preference).</summary>
    public bool WheelsSpin { get; private init; }

    /// <summary>Whether the headlight beam streams + speed lines play (web <c>driving</c>, motion-gated).</summary>
    public bool SpeedLinesPlay { get; private init; }

    /// <summary>Whether the taillight strip pulses (web always-on pulse, motion-gated).</summary>
    public bool TaillightPulses { get; private init; }

    /// <summary>Whether the charge plug pulses (web <c>isCharging</c> pulse, motion-gated).</summary>
    public bool ChargePulses { get; private init; }

    /// <summary>Whether the sentry rings rotate (web <c>sentryMode</c> rotation, motion-gated).</summary>
    public bool SentryRingsRotate { get; private init; }

    /// <summary>Whether the climate waves animate (web <c>isClimateOn</c> rise, motion-gated).</summary>
    public bool ClimateWavesAnimate { get; private init; }

    /// <summary>Whether entrance animations (body draw-in, battery fill) play (motion-gated).</summary>
    public bool EntranceAnimates { get; private init; }

    /// <summary>The ordered status-legend chips below the car (web <c>StatusDot</c> row).</summary>
    public IReadOnlyList<TeslaCarVizStatusChip> Chips { get; private init; } = Array.Empty<TeslaCarVizStatusChip>();

    /// <summary>The composed accessible description Narrator reads (the surface has no web aria-label, so this is a native a11y enhancement).</summary>
    public string AutomationName { get; private init; } = string.Empty;

    /// <summary>
    /// Project <paramref name="model"/> into a render-ready value, reproducing the web component body exactly
    /// (web/src/components/data-display/TeslaCarViz.tsx): the size / aspect math, the driving / charging / locked
    /// / climate / sentry branches, the battery colour thresholds, the ambient priority and the status-dot row.
    /// The per-element animation flags additionally honour the OS reduce-motion preference (the native
    /// accessibility contract), so an animation-suppressed host renders the static final frame.
    /// </summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TeslaCarVizProjection Project(TeslaCarVizModel model, bool reduceMotion, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool driving = model.IsDriving;
        double width = TeslaCarVizRegistration.Width(model.Size);
        double height = width * TeslaCarVizRegistration.Aspect(model.Model);

        double fraction = double.IsFinite(model.BatteryLevel)
            ? Math.Clamp(model.BatteryLevel / 100.0, 0, 1)
            : 0;

        var ambient = model.SentryMode ? TeslaCarVizAmbient.Sentry
            : model.IsCharging ? TeslaCarVizAmbient.Charging
            : driving ? TeslaCarVizAmbient.Driving
            : TeslaCarVizAmbient.Idle;

        bool motion = !reduceMotion;

        return new TeslaCarVizProjection
        {
            Model = model.Model,
            Variant = model.Variant,
            Width = width,
            Height = height,
            Driving = driving,
            IsCharging = model.IsCharging,
            IsLocked = model.IsLocked,
            IsClimateOn = model.IsClimateOn,
            SentryMode = model.SentryMode,
            BatteryLevel = model.BatteryLevel,
            BatteryFraction = fraction,
            BatteryText = TeslaCarVizRegistration.FormatPercent(model.BatteryLevel) + TeslaCarVizRegistration.PercentSign,
            BatteryBrushKey = TeslaCarVizColors.BatteryBrushKey(model.BatteryLevel),
            LockBrushKey = TeslaCarVizColors.BoolBrushKey(model.IsLocked),
            Ambient = ambient,
            Geometry = TeslaCarVizGeometry.For(model.Model),
            WheelsSpin = driving && motion,
            SpeedLinesPlay = driving && motion,
            TaillightPulses = motion,
            ChargePulses = model.IsCharging && motion,
            SentryRingsRotate = model.SentryMode && motion,
            ClimateWavesAnimate = model.IsClimateOn && motion,
            EntranceAnimates = motion,
            Chips = BuildChips(model, localizer),
            AutomationName = BuildAutomationName(model, driving, localizer),
        };
    }

    private static List<TeslaCarVizStatusChip> BuildChips(TeslaCarVizModel model, ILocalizer localizer)
    {
        var chips = new List<TeslaCarVizStatusChip>
        {
            // web: <StatusDot active={isCharging} color="#10b981" label={isCharging ? 'Charging' : 'Not Charging'} />
            new(
                model.IsCharging,
                TeslaCarVizColors.Success,
                model.IsCharging
                    ? localizer.GetString(TeslaCarVizRegistration.ChargingKey, TeslaCarVizRegistration.ChargingFallback)
                    : localizer.GetString(TeslaCarVizRegistration.NotChargingKey, TeslaCarVizRegistration.NotChargingFallback)),

            // web: <StatusDot active={isLocked} color={boolColor(isLocked)} label={isLocked ? 'Locked' : 'Unlocked'} />
            new(
                model.IsLocked,
                TeslaCarVizColors.BoolBrushKey(true),
                model.IsLocked
                    ? localizer.GetString(TeslaCarVizRegistration.LockedKey, TeslaCarVizRegistration.LockedFallback)
                    : localizer.GetString(TeslaCarVizRegistration.UnlockedKey, TeslaCarVizRegistration.UnlockedFallback)),
        };

        // web: {isClimateOn && <StatusDot active color="#00f0ff" label="Climate" />}
        if (model.IsClimateOn)
        {
            chips.Add(new TeslaCarVizStatusChip(
                true,
                TeslaCarVizColors.Info,
                localizer.GetString(TeslaCarVizRegistration.ClimateKey, TeslaCarVizRegistration.ClimateFallback)));
        }

        // web: {sentryMode && <StatusDot active color="#ef4444" label="Sentry" />}
        if (model.SentryMode)
        {
            chips.Add(new TeslaCarVizStatusChip(
                true,
                TeslaCarVizColors.Danger,
                localizer.GetString(TeslaCarVizRegistration.SentryKey, TeslaCarVizRegistration.SentryFallback)));
        }

        return chips;
    }

    private static string BuildAutomationName(TeslaCarVizModel model, bool driving, ILocalizer localizer)
    {
        string modelLabel = TeslaCarVizRegistration.ModelLabel(model.Model, localizer);
        string battery = TeslaCarVizRegistration.FormatPercent(model.BatteryLevel);

        var parts = new List<string>
        {
            driving
                ? localizer.GetString(TeslaCarVizRegistration.DrivingKey, TeslaCarVizRegistration.DrivingFallback)
                : localizer.GetString(TeslaCarVizRegistration.ParkedKey, TeslaCarVizRegistration.ParkedFallback),
        };

        if (model.IsCharging)
        {
            parts.Add(localizer.GetString(TeslaCarVizRegistration.ChargingKey, TeslaCarVizRegistration.ChargingFallback));
        }

        parts.Add(model.IsLocked
            ? localizer.GetString(TeslaCarVizRegistration.LockedKey, TeslaCarVizRegistration.LockedFallback)
            : localizer.GetString(TeslaCarVizRegistration.UnlockedKey, TeslaCarVizRegistration.UnlockedFallback));

        if (model.IsClimateOn)
        {
            parts.Add(localizer.GetString(TeslaCarVizRegistration.ClimateKey, TeslaCarVizRegistration.ClimateFallback));
        }

        if (model.SentryMode)
        {
            parts.Add(localizer.GetString(TeslaCarVizRegistration.SentryKey, TeslaCarVizRegistration.SentryFallback));
        }

        string status = string.Join(TeslaCarVizRegistration.Separator, parts);

        // react-i18next interpolation of the resolved 'translation.vehicle.viz.aria' template.
        return localizer.GetString(TeslaCarVizRegistration.AriaKey, TeslaCarVizRegistration.AriaFallback)
            .Replace("{{model}}", modelLabel, StringComparison.Ordinal)
            .Replace("{{battery}}", battery, StringComparison.Ordinal)
            .Replace("{{status}}", status, StringComparison.Ordinal);
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TeslaCarViz"/> view — the native port of the web
/// component body (web/src/components/data-display/TeslaCarViz.tsx). It owns the current
/// <see cref="TeslaCarVizModel"/> (the props) and binds the <see cref="ITeslaCarVizThemeSource"/> (the
/// <c>useTheme</c> / <c>useSvgPalette</c> seam) and the <see cref="IMotionPreferenceSource"/> (the
/// <c>prefers-reduced-motion</c> seam). It recomputes the pure <see cref="Projection"/> whenever the model or the
/// reduce-motion preference moves and the theme-dependent <see cref="Palette"/> whenever the colour scheme flips,
/// raising <see cref="PropertyChanged"/> so the view re-renders. <see cref="Dispose"/> unsubscribes from both
/// seams (the web effect cleanups). The view performs no I/O of its own.
/// </summary>
public sealed class TeslaCarVizViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ITeslaCarVizThemeSource _theme;
    private readonly IMotionPreferenceSource _motion;
    private readonly IDisposable _motionSubscription;

    private TeslaCarVizModel _model;
    private TeslaCarVizProjection _projection;
    private TeslaCarVizPalette _palette;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, theme seam and motion-preference seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="theme">The colour-scheme seam (web <c>useTheme</c> / <c>useSvgPalette</c>).</param>
    /// <param name="motion">The reduce-motion preference source (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="model">The initial render model; defaults to <see cref="TeslaCarVizModel.Unknown"/>.</param>
    public TeslaCarVizViewModel(
        ILocalizer localizer,
        ITeslaCarVizThemeSource theme,
        IMotionPreferenceSource motion,
        TeslaCarVizModel? model = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(theme);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _theme = theme;
        _motion = motion;
        _model = model ?? TeslaCarVizModel.Unknown;

        _projection = TeslaCarVizProjection.Project(_model, _motion.ReduceMotion, _localizer);
        _palette = TeslaCarVizPalette.ForScheme(_theme.IsLight);

        _theme.Changed += OnThemeChanged;
        _motionSubscription = _motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>TeslaCarViz</c>).</summary>
    public static string Slug => TeslaCarVizRegistration.Slug;

    /// <summary>The current render projection (geometry, states, chips, accessible name, animation flags).</summary>
    public TeslaCarVizProjection Projection => _projection;

    /// <summary>The current theme-aware palette (the only theme-dependent render input).</summary>
    public TeslaCarVizPalette Palette => _palette;

    /// <summary>The bound colour-scheme seam (exposed so the view can drive its element-theme source).</summary>
    public ITeslaCarVizThemeSource ThemeSource => _theme;

    /// <summary>The composed accessible description (the surface's Narrator name).</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>The render model (the web props); reassigning re-projects and re-renders.</summary>
    public TeslaCarVizModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_model == value)
            {
                return;
            }

            _model = value;
            Reproject();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _theme.Changed -= OnThemeChanged;
        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnThemeChanged(object? sender, EventArgs e) => Recolor();

    private void OnReduceMotionChanged(bool reduceMotion) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        _projection = TeslaCarVizProjection.Project(_model, _motion.ReduceMotion, _localizer);
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }

    private void Recolor()
    {
        if (_disposed)
        {
            return;
        }

        var next = TeslaCarVizPalette.ForScheme(_theme.IsLight);
        if (next == _palette)
        {
            return;
        }

        _palette = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Palette)));
    }
}
