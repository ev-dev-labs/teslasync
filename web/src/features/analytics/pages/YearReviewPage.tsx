import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { Spinner } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { SlideRenderer, SLIDE_DEFS } from '../components/review';

export default function YearReviewPage() {
  const { t } = useTranslation();
  const { year: yearParam } = useParams<{ year: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const year = Number(yearParam) || new Date().getFullYear();
  usePageTitle(t('yearReview.pageTitle', `${year} Year in Review`));

  // Vehicle selection from URL query param
  const vehicleIdParam = searchParams.get('vehicle_id') ?? '';
  const { data: vehicles } = useVehicles();
  const vehicleList = vehicles ?? [];

  // Auto-select first vehicle if none specified
  useEffect(() => {
    if (!vehicleIdParam && vehicleList.length > 0) {
      setSearchParams({ vehicle_id: String(vehicleList[0].id) }, { replace: true });
    }
  }, [vehicleIdParam, vehicleList, setSearchParams]);

  const { data, isLoading } = useYearReview(year, vehicleIdParam || undefined);

  const [slideIndex, setSlideIndex] = useState(0);
  const slides = useMemo(() => SLIDE_DEFS, []);

  const goNext = useCallback(() => {
    setSlideIndex((prev) => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setSlideIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Escape') {
        navigate(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, navigate]);

  // Loading state
  if (isLoading || !data) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-center">
          <Spinner className="h-8 w-8 text-white/60 mx-auto mb-4" />
          <p className="text-white/40">{t('yearReview.loading', 'Building your year in review...')}</p>
        </div>
      </div>
    );
  }

  // No data for this year
  if (data.total_drives === 0 && data.total_charge_sessions === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-center px-8">
          <span className="text-6xl mb-4 block">🚗</span>
          <p className="text-xl text-white/60 mb-2">
            {t('yearReview.noData', `No driving data for ${year}`)}
          </p>
          <p className="text-white/30 mb-6">
            {t('yearReview.noDataHint', 'Start driving and charging to build your annual review!')}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          >
            {t('yearReview.goBack', 'Go Back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black select-none">
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 flex gap-0.5 px-4 pt-3 z-20">
        {slides.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 rounded-full bg-white/20 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                i < slideIndex ? 'w-full bg-white/80' : '',
                i === slideIndex ? 'w-full bg-white/80 animate-pulse' : '',
                i > slideIndex ? 'w-0' : '',
              )}
            />
          </div>
        ))}
      </div>

      {/* Vehicle selector (if multiple) */}
      {vehicleList.length > 1 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
          <select
            value={vehicleIdParam}
            onChange={(e) => {
              setSearchParams({ vehicle_id: e.target.value }, { replace: true });
              setSlideIndex(0);
            }}
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white/70 backdrop-blur-sm appearance-none cursor-pointer"
          >
            {vehicleList.map((v) => (
              <option key={v.id} value={String(v.id)} className="bg-gray-900 text-white">
                {v.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Slide content */}
      <SlideRenderer
        slideIndex={slideIndex}
        slide={slides[slideIndex]}
        data={data}
      />

      {/* Tap navigation zones */}
      <div className="absolute inset-0 flex z-10">
        <div className="w-1/3 cursor-pointer" onClick={goPrev} aria-label={t('yearReview.prev', 'Previous slide')} />
        <div className="w-1/3" />
        <div className="w-1/3 cursor-pointer" onClick={goNext} aria-label={t('yearReview.next', 'Next slide')} />
      </div>

      {/* Navigation arrows (desktop hint) */}
      {slideIndex > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors hidden md:block"
          aria-label={t('yearReview.prev', 'Previous')}
        >
          <ChevronLeft className="h-5 w-5 text-white/40" />
        </button>
      )}
      {slideIndex < slides.length - 1 && (
        <button
          onClick={goNext}
          className="absolute right-14 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors hidden md:block"
          aria-label={t('yearReview.next', 'Next')}
        >
          <ChevronRight className="h-5 w-5 text-white/40" />
        </button>
      )}

      {/* Close button */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-3 right-4 z-20 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
        aria-label={t('yearReview.close', 'Close')}
      >
        <X className="h-5 w-5 text-white/60" />
      </button>

      {/* Slide counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-xs text-white/30">
        {slideIndex + 1} / {slides.length}
      </div>
    </div>
  );
}
