import Button from './Button';

interface PaginationProps {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function Pagination({ hasPrev, hasNext, onPrev, onNext }: PaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className="flex border-t border-stone-200 pt-4 md:items-center md:justify-end"
    >
      <div className="flex w-full gap-2 md:w-auto">
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            if (hasPrev) onPrev();
          }}
          disabled={!hasPrev}
          tabIndex={hasPrev ? 0 : -1}
          className="flex-1 md:flex-none"
        >
          ← Previous
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            if (hasNext) onNext();
          }}
          disabled={!hasNext}
          tabIndex={hasNext ? 0 : -1}
          className="flex-1 md:flex-none"
        >
          Next →
        </Button>
      </div>
    </nav>
  );
}
