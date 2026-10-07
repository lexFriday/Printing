import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrintShell } from "@/components/print/PrintShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { formatPrintQty } from "@/lib/printFormat";
import { COMPANY_PROFILE } from "@/lib/brand";
import { signedSignatureUrl } from "@/lib/signatureStorage";

export const Route = createFileRoute("/jobs/$id/job-order/print")({
  head: () => ({ meta: [{ title: `Print job order — ${COMPANY_PROFILE.name}` }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    fromInvoiceId: typeof search.fromInvoiceId === "string" ? search.fromInvoiceId : undefined,
  }),
  component: JobOrderPrintPage,
});

type Customer = {
  customer_name: string;
  contact_person: string;
  contact_number: string;
  address: string | null;
};

type JobLine = {
  id: string;
  description: string;
  quantity: number;
  unit_of_measure: string | null;
  width: number | null;
  height: number | null;
  sort_order: number | null;
};

type JobMaterial = {
  id: string;
  planned_quantity: number;
  unit: string;
  materials: { name: string } | null;
};

const company = {
  name: COMPANY_PROFILE.name,
  logo: COMPANY_PROFILE.logo,
};

function JobOrderPrintPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  const job = useQuery({
    queryKey: ["job-order-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select(
          "*, customer:customers(*), lines:job_order_line_items(*), expenses:job_expenses(id, description, quantity, unit_of_measure, expense_type, supplier_name)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      const { data: bom, error: bomError } = await supabase
        .from("job_boms")
        .select("job_bom_items(id, planned_quantity, unit, materials(name))")
        .eq("job_order_id", id)
        .maybeSingle();
      if (bomError) throw bomError;
      return {
        ...data,
        materialPlan: (bom?.job_bom_items ?? []) as JobMaterial[],
        preparedSignatureUrl: await signedSignatureUrl(
          (data as any).prepared_by_signature_url_snapshot,
        ),
        approvedSignatureUrl: await signedSignatureUrl(
          (data as any).approved_by_signature_url_snapshot,
        ),
      };
    },
  });

  if (loading || job.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading job order...
      </div>
    );
  }

  if (job.isError || !job.data) {
    return (
      <PrintShell backTo="/jobs" backLabel="Back to jobs">
        <Alert variant="destructive">
          <AlertTitle>Job order not found.</AlertTitle>
          <AlertDescription>
            The job may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  const customer = job.data.customer as Customer | null;
  const printCustomer = customer
    ? {
        ...customer,
        contact_person: job.data.contact_name_snapshot ?? customer.contact_person,
        contact_number: job.data.contact_phone_snapshot ?? customer.contact_number,
      }
    : null;
  const lines = ((job.data.lines as JobLine[] | null) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const materials = job.data.materialPlan.map((material) => ({
    id: material.id,
    description: material.materials?.name ?? "",
    quantity: material.planned_quantity,
    unit_of_measure: material.unit,
    supplier_name: "",
  }));
  const jobDate = job.data.created_at ?? new Date();
  const backTo = search.fromInvoiceId ? "/invoices/$id" : "/jobs/$id";
  const backParams = { id: search.fromInvoiceId ?? id };
  const backLabel = search.fromInvoiceId ? "Back to invoice" : "Back to job";
  const approverName = job.data.approved_by_name ?? "";

  return (
    <PrintShell
      backTo={backTo}
      backParams={backParams}
      backLabel={backLabel}
      pdfFileName={`${job.data.job_number}-job-order.pdf`}
      calibrationDocument="job-order"
    >
      <style>{`
        @page { size: Letter; margin: 0; }
        .jo-form { font-family: Arial, Helvetica, sans-serif; }
        .jo-form td, .jo-form th { border: 0.75px solid #111; }
        .jo-form input { border: 0; }
        .jo-meta-grid { margin-top: 0.12in; row-gap: 0.04in; }
        .jo-materials thead tr { height: 0.20in; }
        .jo-materials th { vertical-align: middle; padding: 0.03in 0.01in; }
      `}</style>
      <article className="print-document jo-form mx-auto min-h-[11in] w-[8.5in] bg-white px-[0.2in] py-[0.18in] text-[7px] leading-tight text-black shadow-sm">
        <header className="grid grid-cols-[1.35in_1fr] gap-2">
          <div className="pt-1">
            <img src={company.logo} alt={company.name} className="mx-auto w-[0.82in]" />
          </div>
          <div>
            <div className="flex items-end gap-2 text-[9px] font-bold uppercase">
              <span className="whitespace-nowrap">Job Order No.</span>
              <span className="inline-flex min-h-[0.2in] min-w-[1.45in] items-center justify-center border-b border-black px-2 pb-[3px] text-center text-[10px] leading-none">
                {job.data.job_number}
              </span>
            </div>
            <div className="jo-meta-grid grid grid-cols-[1.18in_1.35fr_1.02in_1fr] gap-x-2">
              <MiniField label="Date Requested" value={fmtDate(job.data.target_completion_date)} />
              <MiniField label="J.O. Date" value={fmtDate(jobDate)} />
              <MiniField label="Date of Delivery" value={fmtDate(job.data.delivered_at)} />
              <MiniField label="DR No." value={job.data.dr_number ?? ""} />
              <MiniField label="Installation Date" value={fmtDate(job.data.installation_date)} />
              <MiniField label="P.O. No." value={job.data.client_po_number ?? ""} />
            </div>
          </div>
        </header>

        <section className="mt-1 grid grid-cols-[1fr_1fr] gap-1">
          <BoxField label="Customer Name" value={printCustomer?.customer_name ?? ""} />
          <BoxField label="Client PO No." value={job.data.client_po_number ?? ""} />
          <BoxField label="Project Description" value={job.data.project_name} />
          <BoxField label="Job In-charge" value={job.data.project_manager ?? ""} />
        </section>

        <table className="mt-1 w-full border-collapse text-[7px]">
          <thead>
            <tr className="bg-slate-100 text-center font-bold uppercase">
              <th className="h-[0.18in] w-[8%]">Qty</th>
              <th className="w-[34%]">Item to Produce</th>
              <th className="w-[18%]">Signature</th>
              <th className="w-[13%]">Mock Up</th>
              <th className="w-[13%]">Proofing</th>
              <th className="w-[14%]">Install / Deliver</th>
            </tr>
          </thead>
          <tbody>
            {formRows(lines.filter((line) => line.description !== "[BLANK_LINE]"), 7).map((line, index) => (
              <tr key={line?.id ?? `blank-line-${index}`}>
                <td className="h-[0.24in] text-center font-medium">
                  {line ? formatPrintQty(line.quantity) : ""}
                </td>
                <td className="px-1 font-medium uppercase">{line?.description ?? ""}</td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
            <tr>
              <td className="h-[0.22in]" colSpan={2} />
              <td className="px-1 text-center font-bold uppercase">DR Done</td>
              <td colSpan={3} />
            </tr>
            <tr>
              <td className="h-[0.22in]" colSpan={2} />
              <td className="px-1 text-center font-bold uppercase">New Order</td>
              <td colSpan={3} />
            </tr>
            <tr>
              <td className="h-[0.22in]" colSpan={2} />
              <td className="px-1 text-center font-bold uppercase">Reorder</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>

        <section className="mt-1 bg-[#fff2cc] px-1 py-0.5 text-[7px] font-bold uppercase">
          Estimated Material Consumption
        </section>
        <table className="jo-materials w-full table-fixed border-collapse text-[7px]">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[28%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[5%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="bg-[#92d050] text-center text-[6px] font-bold uppercase leading-tight">
              <th>Qty</th>
              <th>Unit</th>
              <th>Description</th>
              <th>Stickers</th>
              <th>Boards</th>
              <th>Ink</th>
              <th>Laminate</th>
              <th>Install</th>
              <th>Delivery</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {formRows(materials, 9).map((material, index) => (
              <tr key={material?.id ?? `blank-material-${index}`}>
                <td className="h-[0.18in] text-center">
                  {material?.quantity ? formatPrintQty(material.quantity) : ""}
                </td>
                <td className="px-1 text-center uppercase">{material?.unit_of_measure ?? ""}</td>
                <td className="px-1 uppercase">{material?.description ?? ""}</td>
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td className="px-1 uppercase">{material?.supplier_name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-2 grid grid-cols-[1fr_1fr_1fr_1.5fr] gap-3 text-[6px] uppercase">
          <SignBox label="Checked By" />
          <SignBox label="Fabrication / Material By" />
          <SignBox label="Choice Approved By" />
          <div>
            <div className="mb-1 font-bold">Additional Material or Outsourcing</div>
            <table className="w-full border-collapse">
              <tbody>
                {[0, 1, 2].map((row) => (
                  <tr key={row}>
                    <td className="h-[0.18in]" />
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox label="Checked By" />
          <SignBox
            label="Sales Agent"
            value={(job.data as any).prepared_by_name_snapshot ?? ""}
            signatureUrl={job.data.preparedSignatureUrl}
          />
          <SignBox
            label="Approved By"
            value={approverName}
            signatureUrl={job.data.approvedSignatureUrl}
          />
        </footer>
      </article>
    </PrintShell>
  );
}

function formRows<T>(items: T[], minimumRows: number) {
  return [...items, ...Array.from<T | null>({ length: Math.max(0, minimumRows - items.length) })];
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="font-bold uppercase">{label}</div>
      <div className="flex min-h-[0.13in] items-center justify-center border-b border-black px-1 text-center uppercase">
        {value || ""}
      </div>
    </>
  );
}

function BoxField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1.1in_1fr] border border-black">
      <div className="border-r border-black px-1 font-bold uppercase">{label}</div>
      <div className="min-h-[0.16in] px-1 font-medium uppercase">{value}</div>
    </div>
  );
}

function SignBox({
  label,
  value,
  signatureUrl,
}: {
  label: string;
  value?: string;
  signatureUrl?: string | null;
}) {
  return (
    <div>
      <div className="flex h-10 items-end justify-center pb-1">
        {signatureUrl ? (
          <img src={signatureUrl} alt="" className="max-h-9 max-w-[90%] object-contain" />
        ) : null}
      </div>
      <div className="border-t border-black pt-1 font-bold">{label}</div>
      {value ? <div className="mt-1 font-medium">{value}</div> : null}
    </div>
  );
}
