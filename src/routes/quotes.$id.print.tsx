import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import type { jsPDF as JsPDF } from "jspdf";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PrintCalibration } from "@/lib/printCalibration";
import { printCalibrationKey, readPrintCalibration, savePrintCalibration } from "@/lib/printCalibration";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { computeInclusiveVat } from "@/lib/calc";
import { fmtDate } from "@/lib/format";
import { COMPANY_PROFILE } from "@/lib/brand";
import { quotePaperForCompany } from "@/lib/quotePaper";
import { signedSignatureUrl } from "@/lib/signatureStorage";
import { downloadQuoteExcel } from "@/lib/quoteExcelExport";

export const Route = createFileRoute("/quotes/$id/print")({
  head: () => ({ meta: [{ title: `Print quotation — ${COMPANY_PROFILE.name}` }] }),
  component: PrintQuotePage,
});

type Customer = {
  customer_name: string;
  contact_person: string;
  contact_number: string;
  email: string | null;
  tin_number: string | null;
  address: string | null;
};

type QuoteLine = {
  id: string;
  description: string;
  pricing_mode: "sqft" | "fixed";
  unit_of_measure: string | null;
  width: number | null;
  height: number | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  adjustment_label: string | null;
  adjustment_amount: number | null;
  sort_order: number | null;
  is_blank?: boolean;
};

type QuotePdfData = {
  fileName: string;
  quoteNumber: string;
  quoteDate: string;
  taxType: "vatable" | "non_vat";
  projectName: string;
  approvedByName: string | null;
  approvedBySignatureUrl: string | null;
  terms: string | null;
  remarks: string | null;
  subtotal: number;
  adjustmentLabel: string | null;
  adjustmentAmount: number;
  totalAmount: number;
  vat: ReturnType<typeof computeInclusiveVat>;
  customer: Customer | null;
  lines: QuoteLine[];
  attachments: QuoteAttachment[];
};

type QuoteAttachment = {
  id: string;
  quote_line_item_id: string | null;
  file_name: string;
  signedUrl: string | null;
};

const company = {
  name: COMPANY_PROFILE.name,
  logo: COMPANY_PROFILE.logo,
};

const defaultQuoteTerms = "Full payment due within 30 days after invoice.";
const quotePaper = quotePaperForCompany(COMPANY_PROFILE.name);

function PrintQuotePage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth", replace: true });
  }, [loading, nav, user]);

  const quote = useQuery({
    queryKey: ["quote-print", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*, customer:customers(*), lines:quote_line_items(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      let draftSignatureUrl: string | null = null;
      const signatureUserId = data.status === "draft" ? data.sales_agent_user_id : null;
      if (signatureUserId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("signature_url")
          .eq("id", signatureUserId)
          .maybeSingle();
        draftSignatureUrl = await signedSignatureUrl(profile?.signature_url);
      }
      const finalizedSignatureUrl =
        data.status === "draft" ? null : await signedSignatureUrl(data.sales_agent_signature_url_snapshot);
      const { data: attachments, error: attachmentsError } = await supabase
        .from("quote_attachments")
        .select("id, quote_line_item_id, file_name, storage_path")
        .eq("quotation_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (attachmentsError) throw attachmentsError;

      const signedAttachments = await Promise.all(
        (attachments ?? []).map(async (attachment) => {
          const { data: signed } = await supabase.storage
            .from("quote-attachments")
            .createSignedUrl(attachment.storage_path, 60 * 10);
          return {
            id: attachment.id,
            quote_line_item_id: attachment.quote_line_item_id,
            file_name: attachment.file_name,
            signedUrl: signed?.signedUrl ?? null,
          };
        }),
      );

      return { ...data, draftSignatureUrl, finalizedSignatureUrl, attachments: signedAttachments };
    },
  });

  if (loading || (!user && !quote.isError)) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading quotation...
      </div>
    );
  }

  if (quote.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Loading quotation...
      </div>
    );
  }

  if (quote.isError || !quote.data) {
    return (
      <PrintShell>
        <Alert variant="destructive">
          <AlertTitle>Quotation not found.</AlertTitle>
          <AlertDescription>
            The quotation may have been deleted or you may not have permission to view it.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  const customer = quote.data.customer as Customer | null;
  const printCustomer = customer
    ? {
        ...customer,
        contact_person: quote.data.contact_name_snapshot ?? customer.contact_person,
        contact_number: quote.data.contact_phone_snapshot ?? customer.contact_number,
        email: quote.data.contact_email_snapshot ?? customer.email,
      }
    : null;
  const lines = ((quote.data.lines as QuoteLine[] | null) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const attachments = (quote.data.attachments as QuoteAttachment[] | null) ?? [];
  const quoteBaseTotal =
    Number(quote.data.subtotal || 0) + Number(quote.data.adjustment_amount || 0);
  const vat = computeInclusiveVat(quoteBaseTotal);
  const printTotal =
    quote.data.tax_type === "vatable" ? vat.grossTotal : Number(quote.data.total_amount || 0);
  const approvedBySignatureUrl =
    quote.data.status === "draft"
      ? quote.data.draftSignatureUrl
      : quote.data.finalizedSignatureUrl;
  const attachmentsByLineId = new Map<string, QuoteAttachment[]>();
  for (const attachment of attachments) {
    if (!attachment.quote_line_item_id) continue;
    const current = attachmentsByLineId.get(attachment.quote_line_item_id) ?? [];
    current.push(attachment);
    attachmentsByLineId.set(attachment.quote_line_item_id, current);
  }

  if (lines.length === 0) {
    return (
      <PrintShell quoteId={id}>
        <Alert>
          <AlertTitle>This quotation has no line items.</AlertTitle>
          <AlertDescription>
            Add at least one quote line before printing a customer-facing quotation.
          </AlertDescription>
        </Alert>
      </PrintShell>
    );
  }

  return (
    <PrintShell
      quoteId={id}
      pdfData={{
        fileName: `${quote.data.quote_number}-${quote.data.project_name}.pdf`,
        quoteNumber: quote.data.quote_number,
        quoteDate: quote.data.quote_date,
        taxType: quote.data.tax_type ?? "non_vat",
        projectName: quote.data.project_name,
        approvedByName: quote.data.sales_agent,
        approvedBySignatureUrl,
        terms: quote.data.terms,
        remarks: quote.data.remarks,
        subtotal: quote.data.subtotal,
        adjustmentLabel: null,
        adjustmentAmount: 0,
        totalAmount: printTotal,
        vat,
        customer: printCustomer,
        lines,
        attachments,
      }}
    >
      <article
        data-letterhead={quotePaper ? "njl" : undefined}
        className="quotation-print-document relative mx-auto min-h-[11in] w-[8.5in] max-w-[8.5in] overflow-hidden bg-white px-[0.46in] text-[12px] leading-tight text-black shadow-sm"
        style={{ paddingTop: quotePaper?.topInset ?? "0.42in", paddingBottom: quotePaper?.bottomInset ?? "0.42in" }}
      >
        {quotePaper ? (
          <img src={quotePaper.letterhead} alt="NJL Advertising letterhead" className="pointer-events-none absolute inset-0 h-[11in] w-[8.5in] object-fill" />
        ) : (
          <div className="mb-4 flex justify-center">
            <img src={company.logo} alt={company.name} className="h-[1.05in] object-contain" />
          </div>
        )}
        <div className="relative z-10">

        <div className="print-title-bar bg-[#332f91] py-1 text-center text-[15px] font-bold uppercase text-white underline">
          Quotation
        </div>

        <section className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-[13px]">
          <div className="font-bold">QTN#</div>
          <div className="font-bold">{quote.data.quote_number}</div>
          <div className="font-bold">Date</div>
          <div>{fmtDate(quote.data.quote_date)}</div>
          <div className="font-bold">Project</div>
          <div className="uppercase">{quote.data.project_name}</div>
          <div className="font-bold">Company Name</div>
          <div className="uppercase">{printCustomer?.customer_name ?? "Customer"}</div>
          <div className="font-bold">Address</div>
          <div className="uppercase">{printCustomer?.address ?? "N/A"}</div>
          <div className="font-bold">Attention</div>
          <div className="font-bold uppercase">{printCustomer?.contact_person ?? "N/A"}</div>
        </section>

        <section className="mt-6">
          <table className="quotation-table w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="w-[10%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Item
                </th>
                <th className="w-[14%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Qty
                </th>
                <th className="w-[26%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Item
                </th>
                <th className="w-[22%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Measurement
                </th>
                <th className="w-[14%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Unit Price
                </th>
                <th className="w-[14%] bg-black px-4 py-2 text-center font-normal uppercase text-white">
                  Total Price
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id} className="align-middle">
                  <td className="px-4 py-7 text-center font-bold">{line.is_blank || line.description === "[BLANK_LINE]" ? "" : index + 1}</td>
                  <td className="px-4 py-7 text-center font-bold tabular-nums">{line.is_blank || line.description === "[BLANK_LINE]" ? "" : formatQty(line.quantity)}</td>
                  <td className="quotation-table-cell px-4 py-5 text-center font-bold uppercase" style={printItemTextStyle(line.description)}>{line.is_blank || line.description === "[BLANK_LINE]" ? "" : line.description}</td>
                  <td className="quotation-table-cell px-4 py-7 text-center font-bold uppercase">{line.is_blank || line.description === "[BLANK_LINE]" ? "" : <LineMeasurementCell line={line} attachments={attachmentsByLineId.get(line.id) ?? []} />}</td>
                  <td className="px-4 py-7 text-right font-bold tabular-nums">{line.is_blank || line.description === "[BLANK_LINE]" ? "" : formatCurrencyForPrint(line.quantity > 0 ? line.line_total / line.quantity : line.unit_price)}</td>
                  <td className="px-4 py-7 text-right font-bold tabular-nums">{line.is_blank || line.description === "[BLANK_LINE]" ? "" : formatCurrencyForPrint(line.line_total)}</td>
                </tr>
              ))}
              <tr>
                <td className="border-0" colSpan={4} />
                <td className="border-0 px-4 py-2 text-right font-bold uppercase">Subtotal</td>
                <td className="border-0 px-4 py-2 text-right font-bold tabular-nums">
                  {formatCurrencyForPrint(quote.data.subtotal)}
                </td>
              </tr>
              {quote.data.tax_type === "vatable" ? (
                <>
                  <tr>
                    <td className="border-0" colSpan={4} />
                    <td className="border-0 px-4 py-1 text-right font-bold uppercase">
                      VATable Sales
                    </td>
                    <td className="border-0 px-4 py-1 text-right font-bold tabular-nums">
                      {formatCurrencyForPrint(vat.vatableSales)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border-0" colSpan={4} />
                    <td className="border-0 px-4 py-1 text-right font-bold uppercase">VAT</td>
                    <td className="border-0 px-4 py-1 text-right font-bold tabular-nums">
                      {formatCurrencyForPrint(vat.vat)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <td className="border-0" colSpan={4} />
                <td className="border-0 px-4 py-1 text-right font-bold uppercase">Total</td>
                <td className="border-0 px-4 py-1 text-right font-bold tabular-nums">
                  {formatCurrencyForPrint(printTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="mt-12 grid grid-cols-2 gap-10 text-[12px]">
          <div>
            <h2 className="font-bold">Terms:</h2>
            <div className="mt-1 whitespace-pre-wrap uppercase">
              {quote.data.terms || defaultQuoteTerms}
            </div>
          </div>
          {quote.data.remarks ? (
            <div>
              <h2 className="font-bold">Remarks:</h2>
              <div className="mt-1 whitespace-pre-wrap">{quote.data.remarks}</div>
            </div>
          ) : null}
        </section>

        <footer className="quotation-print-footer mt-16 grid grid-cols-2 gap-32 text-[12px]">
          <SignatureBlock
            label="Approved By:"
            name={quote.data.sales_agent || "Sales representative"}
            signatureUrl={approvedBySignatureUrl}
          />
          <SignatureBlock
            label="Conforme:"
            name={printCustomer?.contact_person ?? printCustomer?.customer_name ?? "Customer"}
            helper={printCustomer?.customer_name ?? "Customer"}
          />
        </footer>
        </div>
      </article>
    </PrintShell>
  );
}

function PrintShell({
  children,
  quoteId,
  pdfData,
}: {
  children: ReactNode;
  quoteId?: string;
  pdfData?: QuotePdfData;
}) {
  const [downloading, setDownloading] = useState(false);
  const [calibration, setCalibration] = useState<PrintCalibration>(() => readPrintCalibration(printCalibrationKey("quotation")));

  async function downloadPdf() {
    if (!pdfData) {
      toast.error("No quotation data found.");
      return;
    }

    setDownloading(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF("p", "pt", quotePaper?.format ?? "letter");
      try {
        const { default: html2canvas } = await import("html2canvas");
        const element = document.querySelector(".quotation-print-document") as HTMLElement | null;
        if (!element) throw new Error("Quotation print layout was not found.");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const restoreImages = await inlinePrintImages(element);
        const captureFrame = preparePdfCaptureFrame(element);
        try {
          const canvas = await html2canvas(captureFrame.target, {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
            logging: false,
          });
          addCanvasToPdf(pdf, canvas);
        } finally {
          captureFrame.cleanup();
          restoreImages();
        }
      } catch (captureError) {
        console.error(captureError);
        toast.error(pdfDownloadErrorMessage(captureError));
        return;
      }
      pdf.save(safePdfName(pdfData.fileName));
    } catch (error) {
      console.error(error);
      toast.error(pdfDownloadErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  const [downloadingExcel, setDownloadingExcel] = useState(false);

  async function downloadExcel() {
    if (!pdfData) {
      toast.error("No quotation data found.");
      return;
    }
    setDownloadingExcel(true);
    try {
      await downloadQuoteExcel({
        quoteNumber: pdfData.quoteNumber,
        quoteDate: pdfData.quoteDate,
        projectName: pdfData.projectName,
        customerName: pdfData.customer?.customer_name,
        customerAddress: pdfData.customer?.address,
        contactPerson: pdfData.customer?.contact_person,
        contactNumber: pdfData.customer?.contact_number,
        email: pdfData.customer?.email,
        tinNumber: pdfData.customer?.tin_number,
        taxType: pdfData.taxType,
        terms: pdfData.terms,
        remarks: pdfData.remarks,
        salesAgent: pdfData.approvedByName,
        subtotal: pdfData.subtotal,
        adjustmentAmount: pdfData.adjustmentAmount,
        totalAmount: pdfData.totalAmount,
        lines: pdfData.lines,
        companyLogoUrl: company.logo,
        approvedBySignatureUrl: pdfData.approvedBySignatureUrl,
        attachments: pdfData.attachments,
      });
      toast.success("Quotation Excel downloaded.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate Quotation Excel.");
    } finally {
      setDownloadingExcel(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6 quotation-print-shell">
      <style>{`
        @page {
          size: Letter;
          margin: 0;
        }

        .quotation-print-document,
        .quotation-print-document * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .quotation-print-document {
          letter-spacing: 0 !important;
          word-spacing: 0.04em !important;
          transform: translate(calc(var(--print-calibration-x, 0) * 1mm), calc(var(--print-calibration-y, 0) * 1mm));
        }

        .quotation-table th,
        .quotation-table td {
          border: 1px solid #000;
        }

        .quotation-table td {
          line-height: 1.35 !important;
        }

        .quotation-table-cell {
          overflow-wrap: anywhere;
        }

        .quotation-table tr {
          break-inside: avoid;
        }

        .quotation-print-footer,
        .quotation-print-footer > div {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        @media print {
          html,
          body {
            background: white !important;
          }

          .quotation-print-shell {
            min-height: auto !important;
            padding: 0 !important;
            background: white !important;
          }

          .quotation-print-actions {
            display: none !important;
          }

          .quotation-print-document {
            max-width: none !important;
            min-height: 11in !important;
            box-shadow: none !important;
          }
        }
      `}</style>
      <div className="quotation-print-actions mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-3">
        {quoteId ? (
          <Button asChild variant="ghost">
            <Link to="/quotes/$id" params={{ id: quoteId }}>
              <ArrowLeft className="h-4 w-4" /> Back to quote
            </Link>
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <Link to="/quotes">
              <ArrowLeft className="h-4 w-4" /> Back to quotes
            </Link>
          </Button>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={downloadExcel} disabled={downloadingExcel || !pdfData}>
            <FileSpreadsheet className="h-4 w-4" /> {downloadingExcel ? "Preparing Excel..." : "Download Excel"}
          </Button>
          <Button variant="outline" onClick={downloadPdf} disabled={downloading || !pdfData}>
            <Download className="h-4 w-4" /> {downloading ? "Preparing..." : "Download PDF"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>
      <section className="mx-auto mb-4 grid max-w-[8.5in] gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 print:hidden"><label className="text-sm">Horizontal (mm)<Input type="number" value={calibration.page.xMm} onChange={(event)=>{const next={...calibration,page:{...calibration.page,xMm:Number(event.target.value)}};setCalibration(next);savePrintCalibration(printCalibrationKey("quotation"),next);}}/></label><label className="text-sm">Vertical (mm)<Input type="number" value={calibration.page.yMm} onChange={(event)=>{const next={...calibration,page:{...calibration.page,yMm:Number(event.target.value)}};setCalibration(next);savePrintCalibration(printCalibrationKey("quotation"),next);}}/></label></section>
      <div
        style={{ "--print-calibration-x": calibration.page.xMm, "--print-calibration-y": calibration.page.yMm } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

function addCanvasToPdf(pdf: JsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageCanvasHeight = Math.floor((canvas.width * pageHeight) / pageWidth);
  const pageCanvas = document.createElement("canvas");
  const context = pageCanvas.getContext("2d");
  if (!context) throw new Error("Could not prepare PDF canvas.");

  pageCanvas.width = canvas.width;

  let sourceY = 0;
  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(pageCanvasHeight, canvas.height - sourceY);
    pageCanvas.height = sliceHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );

    if (sourceY > 0) pdf.addPage();
    const imageHeight = (sliceHeight * pageWidth) / canvas.width;
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, imageHeight);
    sourceY += sliceHeight;
  }
}

function LineMeasurementCell({
  line,
  attachments,
}: {
  line: QuoteLine;
  attachments: QuoteAttachment[];
}) {
  const measurement = formatMeasurement(line);
  const showMeasurement = measurement !== "N/A" || attachments.length === 0;

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      {showMeasurement ? <span>{measurement}</span> : null}
      {attachments.length > 0
        ? attachments.map((attachment) => (
            <div key={attachment.id} className="flex w-full justify-center">
              {attachment.signedUrl ? (
                <img
                  src={attachment.signedUrl}
                  alt={attachment.file_name}
                  className="max-h-[1.35in] max-w-full object-contain"
                />
              ) : null}
            </div>
          ))
        : null}
    </div>
  );
}

function SignatureBlock({
  label,
  name,
  helper,
  signatureUrl,
}: {
  label: string;
  name: string;
  helper?: ReactNode;
  signatureUrl?: string | null;
}) {
  return (
    <div className="min-h-24">
      <div className="font-bold uppercase tracking-normal">{label}</div>
      <div className="mt-4 flex h-10 w-40 items-end">
        {signatureUrl ? (
          <img src={signatureUrl} alt="" className="max-h-10 max-w-40 object-contain" />
        ) : null}
      </div>
      <div className="w-40 border-t border-black pt-1" />
      <div className="font-bold uppercase tracking-normal">{name}</div>
      {helper ? <div className="mt-1 uppercase tracking-normal">{helper}</div> : null}
    </div>
  );
}

function formatMeasurement(line: QuoteLine) {
  if (line.width && line.height && line.unit_of_measure) {
    return `${formatNumber(line.width)} × ${formatNumber(line.height)} ${titleCase(
      line.unit_of_measure,
    )}`;
  }
  return "N/A";
}

function formatQty(value: number) {
  return Number(value).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function formatNumber(value: number) {
  return Number(value).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function formatCurrencyForPrint(value: number) {
  return Number(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function drawQuotePdf(pdf: JsPDF, data: QuotePdfData, includeReferenceImages: boolean) {
  const margin = 36;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - margin) return;
    pdf.addPage();
    y = margin;
  };

  pdf.setFillColor(51, 47, 145);
  pdf.rect(margin, y, contentWidth, 20, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("QUOTATION", pageWidth / 2, y + 14, { align: "center" });
  pdf.setTextColor(0, 0, 0);
  y += 34;

  const rows: Array<[string, string]> = [
    ["QTN#", data.quoteNumber],
    ["Date", fmtDate(data.quoteDate)],
    ["Project", data.projectName],
    ["Company Name", data.customer?.customer_name ?? "Customer"],
    ["Address", data.customer?.address ?? "N/A"],
    ["Attention", data.customer?.contact_person ?? "N/A"],
  ];
  if (data.remarks) rows.push(["Remarks", data.remarks]);

  pdf.setFontSize(10);
  rows.forEach(([label, value]) => {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, margin, y);
    pdf.setFont("helvetica", label === "Attention" ? "bold" : "normal");
    const lines = pdf.splitTextToSize(value.toUpperCase(), 230);
    pdf.text(lines, margin + 95, y);
    y += Math.max(14, lines.length * 12);
  });
  y += 18;

  const widths = [40, 48, 150, 108, 86, 88];
  const headers = ["Item", "Qty", "Item", "Measurement", "Unit Price", "Total Price"];
  drawTableHeader();

  data.lines.forEach((line, index) => {
    addPageIfNeeded(48);
    let x = margin;
    const cells = [
      String(index + 1),
      formatQty(line.quantity),
      line.description.toUpperCase(),
      formatMeasurement(line).toUpperCase(),
      formatCurrencyForPrint(
        line.quantity > 0 ? line.line_total / line.quantity : line.unit_price,
      ),
      formatCurrencyForPrint(line.line_total),
    ];
    const rowHeight = 58;

    cells.forEach((cell, cellIndex) => {
      pdf.rect(x, y, widths[cellIndex], rowHeight);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      const text = pdf.splitTextToSize(cell, widths[cellIndex] - 8);
      const align = cellIndex >= 4 ? "right" : "center";
      const textX = align === "right" ? x + widths[cellIndex] - 4 : x + widths[cellIndex] / 2;
      pdf.text(text, textX, y + 18, { align, lineHeightFactor: 1.25 });
      x += widths[cellIndex];
    });

    y += rowHeight;
  });

  y += 10;
  drawTotalRow("Subtotal", data.subtotal);
  if (data.taxType === "vatable") {
    drawTotalRow("VATable Sales", data.vat.vatableSales);
    drawTotalRow("VAT", data.vat.vat);
  }
  drawTotalRow("Total", data.totalAmount);

  y += 16;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("TERMS:", margin, y);
  y += 13;
  pdf.setFont("helvetica", "normal");
  const termLines = pdf.splitTextToSize(
    (data.terms || defaultQuoteTerms).toUpperCase(),
    contentWidth,
  );
  pdf.text(termLines, margin, y);
  y += Math.max(14, termLines.length * 12);

  if (includeReferenceImages && data.attachments.length > 0) {
    pdf.addPage();
    y = margin;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text("REFERENCE IMAGES", margin, y);
    y += 22;
    const lineById = new Map(
      data.lines.map((line, index) => [line.id, `Item ${index + 1}: ${line.description}`]),
    );
    for (const attachment of data.attachments) {
      addPageIfNeeded(210);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text(
        attachment.quote_line_item_id
          ? lineById.get(attachment.quote_line_item_id) || "Line item"
          : "General reference",
        margin,
        y,
      );
      pdf.setFont("helvetica", "normal");
      pdf.text(attachment.file_name, margin, y + 13);
      if (attachment.signedUrl) {
        try {
          const image = await imageToDataUrl(attachment.signedUrl);
          pdf.addImage(image, imageFormatFromDataUrl(image), margin, y + 24, 220, 150);
        } catch {
          pdf.text("Image could not be loaded.", margin, y + 38);
        }
      }
      y += 195;
    }
  }

  y += 105;

  await drawSignature(
    margin,
    "Approved By:",
    data.approvedByName || "Sales representative",
    [],
    data.approvedBySignatureUrl,
  );
  await drawSignature(
    margin + 300,
    "Conforme:",
    data.customer?.contact_person ?? data.customer?.customer_name ?? "Customer",
    [data.customer?.customer_name ?? "Customer"],
  );

  function drawTableHeader() {
    addPageIfNeeded(26);
    let x = margin;
    headers.forEach((header, index) => {
      pdf.setFillColor(0, 0, 0);
      pdf.rect(x, y, widths[index], 24, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(header.toUpperCase(), x + widths[index] / 2, y + 15, { align: "center" });
      pdf.setTextColor(0, 0, 0);
      x += widths[index];
    });
    y += 24;
  }

  function drawTotalRow(label: string, value: number) {
    addPageIfNeeded(18);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(label.toUpperCase(), margin + contentWidth - 170, y);
    pdf.text(formatCurrencyForPrint(value), margin + contentWidth, y, { align: "right" });
    y += 15;
  }

  async function drawSignature(
    x: number,
    label: string,
    name: string,
    helper: string[],
    signatureUrl?: string | null,
  ) {
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text(label.toUpperCase(), x, y);
    if (signatureUrl) {
      try {
        const signature = await imageToDataUrl(signatureUrl);
        pdf.addImage(signature, "PNG", x, y + 10, 105, 28);
      } catch {
        // Keep the signature line even if the image fails to load.
      }
    }
    pdf.line(x, y + 46, x + 130, y + 46);
    pdf.text(name.toUpperCase(), x, y + 58);
    pdf.setFont("helvetica", "normal");
    helper.forEach((line, index) => {
      pdf.text(line.toUpperCase(), x, y + 70 + index * 12);
    });
  }
}

async function imageToDataUrl(src: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Unable to load image.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function inlinePrintImages(root: HTMLElement) {
  const originals = new Map<HTMLImageElement, string>();
  const images = Array.from(root.querySelectorAll("img"));

  await Promise.all(
    images.map(async (image) => {
      const source = image.currentSrc || image.src;
      if (!source || source.startsWith("data:")) return;

      originals.set(image, image.src);
      const dataUrl = await imageToDataUrl(source);
      image.src = dataUrl;
      await waitForImage(image);
    }),
  );

  return () => {
    originals.forEach((src, image) => {
      image.src = src;
    });
  };
}

async function waitForImage(image: HTMLImageElement) {
  if (image.complete) return;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to render image."));
  });
}

function preparePdfCaptureFrame(source: HTMLElement) {
  const width = Math.ceil(source.getBoundingClientRect().width);
  const height = Math.ceil(source.scrollHeight);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.border = "0";
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;
  if (!frameDocument) {
    frame.remove();
    throw new Error("Unable to prepare PDF capture frame.");
  }

  frameDocument.open();
  frameDocument.write(
    '<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>',
  );
  frameDocument.close();
  frameDocument.body.style.margin = "0";
  frameDocument.body.style.background = "#ffffff";

  const clone = source.cloneNode(true) as HTMLElement;
  copyRenderedStyles(source, clone);
  forcePdfCaptureBounds(clone, width, height);
  forcePdfSafeTextRendering(clone);
  forcePrintCaptureColors(clone);
  frameDocument.body.appendChild(clone);

  return {
    target: clone,
    cleanup: () => frame.remove(),
  };
}

function forcePdfCaptureBounds(root: HTMLElement, width: number, height: number) {
  root.style.position = "relative";
  root.style.display = "block";
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.minWidth = `${width}px`;
  root.style.minHeight = `${height}px`;
  root.style.margin = "0";
  root.style.transform = "none";
  root.style.boxShadow = "none";
}

function copyRenderedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  for (const property of computed) {
    target.setAttribute("style", target.getAttribute("style") ?? "");
    (target as HTMLElement).style.setProperty(
      property,
      sanitizeCaptureStyle(property, computed.getPropertyValue(property)),
      computed.getPropertyPriority(property),
    );
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) copyRenderedStyles(child, targetChild);
  });
}

function sanitizeCaptureStyle(property: string, value: string) {
  if (!/\b(?:lab|lch|oklab|oklch)\(/i.test(value)) return value;
  if (property.includes("background")) return "transparent";
  if (property.includes("border")) return "#000000";
  return "#000000";
}

function forcePrintCaptureColors(root: HTMLElement) {
  root.style.background = "#ffffff";
  root.style.color = "#000000";
  root.style.boxShadow = "none";

  root.querySelectorAll<HTMLElement>(".print-title-bar").forEach((element) => {
    element.style.background = "#332f91";
    element.style.color = "#ffffff";
  });

  root.querySelectorAll<HTMLElement>(".quotation-table th").forEach((element) => {
    element.style.background = "#000000";
    element.style.color = "#ffffff";
  });
}

function forcePdfSafeTextRendering(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    element.style.fontFamily = "Arial, Helvetica, sans-serif";
    element.style.fontKerning = "none";
    element.style.letterSpacing = "0";
    element.style.textRendering = "auto";
    element.style.wordSpacing = "normal";
  });
}

function pdfDownloadErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : "";
  return detail
    ? `Could not download PDF: ${detail}`
    : "Could not download PDF. Please use Print / Save PDF.";
}

function imageFormatFromDataUrl(value: string) {
  if (value.startsWith("data:image/jpeg")) return "JPEG";
  if (value.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

function printItemTextStyle(value: string): React.CSSProperties {
  const length = value.trim().length;
  if (length > 120) return { fontSize: "8px", lineHeight: 1.15 };
  if (length > 80) return { fontSize: "9px", lineHeight: 1.2 };
  if (length > 45) return { fontSize: "10px", lineHeight: 1.25 };
  return { fontSize: "12px" };
}

function safePdfName(value: string) {
  const normalized = value
    .replace(/\.pdf$/i, "")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalized || "quotation"}.pdf`;
}
