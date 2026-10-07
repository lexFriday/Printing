import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, LoadingRow, PageHeader } from "@/components/system";
import { Plus, Search, ShieldAlert, Users } from "lucide-react";
import { CustomerForm } from "./_app.customers";
import {
  assertCustomerTinAvailable,
  cleanCustomer,
  customerErrorMessage,
  formatTin,
} from "@/lib/customers";
import { useAuth } from "@/hooks/useAuth";
import { canManageUsers, canSalesWork } from "@/lib/roles";
import { toast } from "sonner";
import { normalizePhone } from "@/lib/phone";

export const Route = createFileRoute("/_app/customers/")({
  head: () => ({ meta: [{ title: "Customers — AutoMate PH" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const canWrite = canSalesWork(role);
  const canManageSuppliers = canManageUsers(role);

  const list = useQuery({
    queryKey: ["customers", search],
    queryFn: async () => {
      let q = supabase.from("customers").select("*").order("created_at", { ascending: false });
      if (search)
        q = q.or(
          `customer_name.ilike.%${search}%,contact_person.ilike.%${search}%,customer_code.ilike.%${search}%`,
        );
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (f: {
      customer_name: string;
      contact_person: string;
      contact_number: string;
      email?: string;
      tin_number?: string;
      address?: string;
      notes?: string;
      additional_contacts?: Array<{
        contact_name: string;
        phone: string;
      }>;
    }) => {
      if (!canWrite) throw new Error("You do not have permission to perform this action.");
      await assertCustomerTinAvailable(f.tin_number);
      const payload = cleanCustomer(f);
      const { data: result, error } = await supabase.rpc("create_customer_with_contacts", {
        customer_data: payload,
        contacts: (f.additional_contacts ?? []).map((contact) => ({
          contact_name: contact.contact_name.trim(),
          phone: normalizePhone(contact.phone),
        })),
      });
      if (error) throw error;
      const data = (
        result as {
          customer: { id: string; customer_code: string; customer_name: string };
        }
      ).customer;
      if (!data?.id) throw new Error("Customer creation did not return a customer record.");
      return data;
    },
    onSuccess: () => {
      toast.success("Customer created");
      qc.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(customerErrorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Directory"
        description="Master records used across quotes and invoices."
        actions={
          canWrite ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" /> New customer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New customer</DialogTitle>
                </DialogHeader>
                <CustomerForm onSubmit={(v) => create.mutate(v)} busy={create.isPending} />
              </DialogContent>
            </Dialog>
          ) : null
        }
      />
      <div className="inline-flex rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Business category">
        <Button type="button" size="sm" variant="default" role="tab" aria-selected="true">Customers</Button>
        {canManageSuppliers ? <Button type="button" size="sm" variant="ghost" role="tab" onClick={() => navigate({ to: "/settings/suppliers" })}>Suppliers</Button> : null}
      </div>

      {!canWrite ? (
        <Alert className="-mt-2">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>
            Ask a sales or admin user to add a customer before creating a quotation.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search customers"
              placeholder="Search name, contact, or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-9"
            />
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {list.isLoading ? "Loading customers..." : `${list.data?.length ?? 0} customer records`}
          </p>
        </div>
        <div className="max-h-[calc(100dvh-16rem)] overscroll-contain overflow-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Contact person</TableHead>
                <TableHead>TIN</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={Users}>
                  No customers yet
                </EmptyState>
              ) : (
                list.data!.map((c) => (
                  <TableRow
                    key={c.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open customer ${c.customer_name}`}
                    className="cursor-pointer outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35"
                    onClick={() => navigate({ to: "/customers/$id", params: { id: c.id } })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      navigate({ to: "/customers/$id", params: { id: c.id } });
                    }}
                  >
                    <TableCell className="font-mono text-xs">{c.customer_code}</TableCell>
                    <TableCell className="max-w-[18rem] whitespace-nowrap font-medium">
                      <div className="truncate" title={c.customer_name}>
                        {c.customer_name}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[14rem] whitespace-nowrap">
                      <div className="truncate" title={c.contact_person}>
                        {c.contact_person}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatTin(c.tin_number) || "-"}
                    </TableCell>
                    <TableCell>{c.contact_number}</TableCell>
                    <TableCell className="max-w-[16rem] text-muted-foreground">
                      <div className="truncate" title={c.email ?? ""}>
                        {c.email ?? "-"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
