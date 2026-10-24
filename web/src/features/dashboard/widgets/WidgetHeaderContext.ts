import { createContext, type ReactNode } from 'react';

/** The grid supplies controls; the shell alone positions and renders the header. */
export const WidgetHeaderContext = createContext<{ actions?: ReactNode; editMode?: boolean }>({});
