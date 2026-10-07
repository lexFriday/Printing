import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type ItemTemplate = {
  id: string;
  name: string;
  description: string;
  pricing_mode: "sqft" | "fixed";
  default_unit: "inches" | "feet" | "millimeters" | "centimeters" | "meters" | null;
  default_rate_per_sqft: number | null;
  default_unit_price: number | null;
  default_width: number | null;
  default_height: number | null;
  is_active: boolean;
  pricing_basis?: string;
  sheets_per_copy?: number | null;
  sheet_waste_percent?: number;
  sheet_pricing_profile_id?: string | null;
};

const localTemplateFallback: ItemTemplate[] = [
  ["Tarpaulin Banner", "sqft", "feet", 180],
  ["Sticker", "sqft", "feet", 130],
  ["Sintra Board", "sqft", "feet", 250],
  ["Backdrop", "sqft", "feet", 180],
].map(([name, pricing_mode, default_unit, rate]) => ({
  id: `local-${String(name).toLowerCase().replaceAll(" ", "-")}`,
  name: String(name), description: String(name), pricing_mode: pricing_mode as "sqft",
  default_unit: default_unit as "feet", default_rate_per_sqft: Number(rate),
  default_unit_price: null, default_width: null,
  default_height: null, is_active: true,
}));

export function ItemTemplatePicker({
  value,
  disabled,
  onApply,
  onCustom,
}: {
  value: string;
  disabled?: boolean;
  onApply: (template: ItemTemplate) => void;
  onCustom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const templates = useQuery({
    queryKey: ["active-item-templates"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_templates")
        // Keep this picker compatible with the canonical item-template schema.
        // Optional sheet-pricing extensions are not present in every environment.
        .select(
          "id, name, description, pricing_mode, default_unit, default_rate_per_sqft, default_unit_price, default_width, default_height, is_active",
        )
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) return localTemplateFallback;
      return (data?.length ? data : localTemplateFallback) as ItemTemplate[];
    },
  });

  const selected = useMemo(
    () => templates.data?.find((template) => template.id === value),
    [templates.data, value],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs">Item Template</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between bg-background font-normal active:scale-100"
          >
            <span className="truncate">
              {selected
                ? selected.name
                : templates.isPending
                  ? "Loading templates..."
                  : "Custom item"}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="max-h-[min(28rem,calc(100vh-8rem))] w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder="Search templates..." />
            <CommandList>
              <CommandEmpty>No templates found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="custom item"
                  onSelect={() => {
                    onCustom();
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  <span>Custom item</span>
                </CommandItem>
                {(templates.data ?? []).map((template) => (
                  <CommandItem
                    key={template.id}
                    value={`${template.name} ${template.description}`}
                    onSelect={() => {
                      onApply(template);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("h-4 w-4", value === template.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="min-w-0">
                      <div className="truncate">{template.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {template.pricing_mode === "sqft"
                          ? `Square foot · ${template.default_unit ?? "No unit"} · ${
                              template.default_rate_per_sqft ?? "-"
                            }/sq ft`
                          : `Fixed unit · ${template.default_unit_price ?? "-"} each`}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
