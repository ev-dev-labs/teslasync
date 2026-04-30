import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, title, size = 'md', className, children, ...props }, ref) => {
    if (!open) return null;

    const sizes = {
      sm: 'max-w-sm',
      md: 'max-w-lg',
      lg: 'max-w-2xl',
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cn(
            'relative z-10 w-full rounded-lg bg-white shadow-xl dark:bg-gray-800',
            'max-h-[90vh] flex flex-col',
            sizes[size],
            className,
          )}
          {...props}
        >
          {title && (
            <div className="px-6 pt-6 pb-4 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                ✕
              </button>
            </div>
          )}
          <div className="px-6 pb-6 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Modal.displayName = 'Modal';
