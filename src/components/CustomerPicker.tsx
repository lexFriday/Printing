import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerForm } from "@/routes/_app.customers";
import { assertCustomerTinAvailable, cleanCustomer, customerErrorMessage } from "@/lib/customers";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork } from "@/lib/roles";
import { normalizePhone } from "@/lib/phone";

export function CustomerPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string, name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { role } = useAuth();
  const qc = useQueryClient();
  const canWrite = canSalesWork(role);

  const list = useQuery({
    queryKey: ["customers-picker", search],
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_name, contact_person")
        .order("customer_name")
        .limit(50);
      if (search) q = q.ilike("customer_name", `%${search}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const selected = useQuery({
    queryKey: ["customer", value],
    queryFn: async () => {
      if (!value) return null;
      const { data } = await supabase
        .from("customers")
        .select("id, customer_name")
        .eq("id", value)
        .single();
      return data;
    },
    enabled: !!value,
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const createCustomer = useMutation({
    mutationFn: async (v: {
      customer_name: string;
      contact_person: string;
      contact_number: string;
      email?: string;
      tin_number?: string;
      address?: string;
      notes?: string;
      additional_contacts?: Array<{ contact_name: string; phone: string }>;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      await assertCustomerTinAvailable(v.tin_number);
      const { data: result, error } = await supabase.rpc("create_customer_with_contacts", {
        customer_data: cleanCustomer(v),
        contacts: (v.additional_contacts ?? []).map((contact) => ({
          contact_name: contact.contact_name.trim(),
          phone: normalizePhone(contact.phone),
        })),
      });
      if (error) throw error;
      const data = (result as { customer: { id: string; customer_name: string } }).customer;
      if (!data?.id) throw new Error("Customer creation did not return a customer record.");
      return data;
    },
    onSuccess: (data) => {
      toast.success("Customer created");
      qc.invalidateQueries({ queryKey: ["customers-picker"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      onChange(data.id, data.customer_name);
      setCreateOpen(false);
    },
    onError: (error: Error) => toast.error(customerErrorMessage(error)),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal text-left font-normal"
            disabled={disabled}
          >
            {selected.data?.customer_name ?? "Select customer…"}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="p-2 border-b">
            <Input
              autoFocus
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {(list.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c.customer_name);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0 break-words">
                  {c.customer_name}{" "}
                  <span className="text-muted-foreground text-xs">· {c.contact_person}</span>
                </span>
                {value === c.id && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
            {(list.data ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground p-3 text-center">No matches</div>
            )}
          </div>
          {canWrite && !disabled ? (
            <div className="p-2 border-t">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New customer
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
          </DialogHeader>
          <CustomerForm
            onSubmit={(value) => createCustomer.mutate(value)}
            busy={createCustomer.isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
