import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSalesAgentOptions } from "@/hooks/useSalesAgentOptions";

export function SalesAgentPicker({
  value,
  userId,
  disabled,
  onChange,
}: {
  value: string;
  userId: string | null;
  disabled?: boolean;
  onChange: (name: string, userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = useSalesAgentOptions();
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const agents = options.data ?? [];
    if (!query) return agents;
    return agents.filter((agent) =>
      `${agent.name} ${agent.email ?? ""} ${agent.role ?? ""}`.toLowerCase().includes(query),
    );
  }, [options.data, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal bg-background text-left font-normal"
        >
          <span className="min-w-0 truncate">
            {value || (options.isLoading ? "Loading agents..." : "Choose or type sales agent")}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="Search saved users..."
          />
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filtered.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onChange(agent.name, agent.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{agent.name}</span>
                  {agent.role ? (
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {agent.role}
                    </span>
                  ) : null}
                </span>
                {agent.email ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {agent.email}
                  </span>
                ) : null}
              </span>
              {userId === agent.id ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-sm text-muted-foreground">
              No saved users found
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
