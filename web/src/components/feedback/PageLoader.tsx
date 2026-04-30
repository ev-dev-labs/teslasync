import { Spinner } from './Spinner';

/** Full-page spinning loader, suitable as a React Suspense fallback. */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-32">
      <Spinner size="lg" />
    </div>
  )
}
