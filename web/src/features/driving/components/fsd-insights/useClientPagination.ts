import { useMemo, useState } from 'react';

/** Same page-size choices as DataTable / list pages across the app. */
export const FSD_PAGE_SIZE_OPTIONS = [25, 50, 100];
export const FSD_DEFAULT_PAGE_SIZE = 25;

/**
 * Client-side paging for in-memory FSD lists (journal, commute stories,
 * counter-reset timeline). Matches DataTable's default page size.
 */
export function useClientPagination<T>(items: readonly T[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FSD_DEFAULT_PAGE_SIZE);
  const total = items.length;
  const safePageSize = pageSize > 0 ? pageSize : FSD_DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const slice = useMemo(
    () => items.slice((safePage - 1) * safePageSize, safePage * safePageSize),
    [items, safePage, safePageSize],
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    slice,
    onPageChange: setPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    pageSizeOptions: FSD_PAGE_SIZE_OPTIONS,
  };
}
