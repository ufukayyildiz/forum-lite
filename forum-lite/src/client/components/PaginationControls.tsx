import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
};

export function PaginationControls({ page, totalPages, onPage }: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <nav className="gb-pagination" aria-label="Pagination">
      <button
        type="button"
        className="gb-btn gb-page-btn"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(previousPage)}
      >
        <ChevronLeft size={14} />
        <span>prev</span>
      </button>
      <span className="gb-page-count" aria-current="page">
        {page}<span>/</span>{totalPages}
      </span>
      <button
        type="button"
        className="gb-btn gb-page-btn"
        aria-label="Next page"
        disabled={page >= totalPages}
        onClick={() => onPage(nextPage)}
      >
        <span>next</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
