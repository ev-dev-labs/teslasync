# Feature: Add Higher Trip Replay Speeds (25x, 50x, 100x)

## Problem

Trip Replay currently maxes out at 10x speed. For long drives (20+ minutes), this is still slow. Add 25x, 50x, and 100x options.

## Files to Modify

### 1. `web/src/hooks/useTripReplay.ts`

**Line 8** — Update the `ReplaySpeed` type:
```typescript
// BEFORE
export type ReplaySpeed = 1 | 2 | 5 | 10;

// AFTER
export type ReplaySpeed = 1 | 2 | 5 | 10 | 25 | 50 | 100;
```

No other changes needed in this file — the speed value is used as a multiplier in the animation interval calculation, so higher values will automatically work.

### 2. `web/src/components/ui/PlaybackControls.tsx`

**Line 32** — Update the `SPEEDS` array:
```typescript
// BEFORE
const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10];

// AFTER
const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10, 25, 50, 100];
```

The `nextSpeed()` function on line 34-36 already cycles through the array with modulo, so it will automatically wrap around from 100x back to 1x.

## Verification

```bash
cd web && npx tsc --noEmit
```

Check that `ReplaySpeed` type is consistent between both files. The speed button in PlaybackControls already renders `{speed}x` so it will display correctly.

## Risk Assessment

**Very low risk.** Only 2 lines change. The animation loop in `useTripReplay.ts` divides the base interval by the speed value, so higher speeds just mean shorter intervals between position updates. At 100x a 23-minute drive would replay in ~14 seconds.
