import { StatStrip } from './StatStrip';
import type { StatGroupProps } from './types';

/** Card-header period inheritance is explicit; never hide an unowned period. */
export function StatGroup(props: StatGroupProps) {
  return <StatStrip {...props} variant="embedded"
    periodInHeader={props.periodInHeader === true && Boolean(props.periodHeaderId)} />;
}
