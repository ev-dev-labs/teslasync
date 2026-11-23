import { createContext } from 'react';
import type { FormatOptions } from '@/lib/dateFormat';

export const WorkspaceDateFormatContext = createContext<FormatOptions | undefined>(undefined);
