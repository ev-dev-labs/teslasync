import type { ReactElement } from 'react';
import type { ButtonProps } from '@/components/ui';
import type { PackAppearance } from '../types';

export interface CommandActionPresentation {
  id: string;
  button: ReactElement<ButtonProps>;
  busy: boolean;
}

export interface CommandActionsPresentationProps {
  appearance: PackAppearance;
  compact: boolean;
  actions: readonly CommandActionPresentation[];
}
