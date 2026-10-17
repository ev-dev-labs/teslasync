import type { ReactNode } from 'react';
import type { DriveScorePageModel } from '../../hooks/useDriveScorePage';

export type ScoreStateRenderer = (
  height: number,
  emptyMsg: string,
  emptyIcon?: ReactNode,
) => ReactNode | null;

export interface ScoreSectionProps<K extends keyof DriveScorePageModel> {
  model: Pick<DriveScorePageModel, K>;
  driveState: ScoreStateRenderer;
  scoreState: ScoreStateRenderer;
}
