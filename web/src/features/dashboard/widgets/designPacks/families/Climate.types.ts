import type { ReactNode } from 'react';
import type { PackAppearance } from '../types';

export interface ClimatePresentationProps {
  appearance: PackAppearance;
  headline: ReactNode;
  status: ReactNode;
  airflow: ReactNode;
  outside: ReactNode;
  setpoint: ReactNode;
}
