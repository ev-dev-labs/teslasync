import SharedLibraryCompletionReference from '../components/shared-library-completion/SharedLibraryCompletionReference';
import { RemainingEvidenceReference } from './RemainingEvidenceReference';
import { RemainingTransportReference } from './RemainingTransportReference';

export default function SharedLibraryCompletionPage() {
  return (
    <div data-shared-library-gallery className="flex min-w-0 flex-col gap-6">
      <SharedLibraryCompletionReference />
      <RemainingEvidenceReference />
      <RemainingTransportReference />
    </div>
  );
}
