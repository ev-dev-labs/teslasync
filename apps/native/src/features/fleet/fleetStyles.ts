import {StyleSheet} from 'react-native';

import {spacing} from '../../theme/tokens';

export const fleetStyles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  detailStack: {
    gap: spacing.lg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
});
