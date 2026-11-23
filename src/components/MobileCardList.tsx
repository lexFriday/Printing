import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function MobileCardList<T>({
  items,
  getKey,
  loading,
  loadingText = "Loading…",
  empty,
  renderSummary,
  getDetailTitle,
  getDetailSubtitle,
  renderDetail,
}: {
  items: T[];
  getKey: (item: T) => string;
  loading?: boolean;
  loadingText?: string;
  empty: ReactNode;
  renderSummary: (item: T) => ReactNode;
  getDetailTitle: (item: T) => string;
  getDetailSubtitle?: (item: T) => string | undefined;
  renderDetail: (item: T, close: () => void) => ReactNode;
}) {
  const [selected, setSelected] = useState<T | null>(null);

  return (
    <div className="md:hidden">
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{loadingText}</p>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <button
              key={getKey(item)}
              type="button"
              onClick={() => setSelected(item)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background p-3.5 text-left transition-colors active:bg-muted/60"
            >
              <div className="min-w-0 flex-1">{renderSummary(item)}</div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5"
        >
          {selected ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>{getDetailTitle(selected)}</SheetTitle>
                {getDetailSubtitle?.(selected) ? (
                  <SheetDescription>{getDetailSubtitle(selected)}</SheetDescription>
                ) : null}
              </SheetHeader>
              <div className="mt-4 space-y-3">{renderDetail(selected, () => setSelected(null))}</div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function MobileDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  );
}
