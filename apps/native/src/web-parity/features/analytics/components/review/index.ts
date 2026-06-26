// Native parity port of
// web/src/features/analytics/components/review/index.ts.
//
// Barrel module for the "Year in Review" slide deck. Re-exports the same symbols
// as the web barrel (SlideRenderer, the slides data/types, and every slide
// component) from the native parity sibling modules, preserving the public
// surface 1:1 so consumers import the identical names.

export {SlideRenderer} from './SlideRenderer';
export {SLIDE_DEFS, buildSlides, type SlideDefinition} from './slides';
export {TitleSlide} from './TitleSlide';
export {StatHeroSlide} from './StatHeroSlide';
export {StatChartSlide} from './StatChartSlide';
export {DriveHighlightSlide} from './DriveHighlightSlide';
export {ChargingBreakdownSlide} from './ChargingBreakdownSlide';
export {SavingsSlide} from './SavingsSlide';
export {EnvironmentSlide} from './EnvironmentSlide';
export {PatternsSlide} from './PatternsSlide';
export {ComparisonsSlide} from './ComparisonsSlide';
export {SummarySlide} from './SummarySlide';
