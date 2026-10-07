import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/CustomerPicker";
import { CustomerContactPicker, type CustomerContact } from "@/components/CustomerContactPicker";
import { ItemTemplatePicker, type ItemTemplate } from "@/components/ItemTemplatePicker";
import { QuoteAttachmentsSection } from "@/components/QuoteAttachmentsSection";
import { SalesAgentPicker } from "@/components/SalesAgentPicker";
import { useAuth } from "@/hooks/useAuth";
import { useStickySummary } from "@/hooks/useStickySummary";
import { logAudit } from "@/lib/audit";
import { computeInclusiveVat, computeLine, type Uom } from "@/lib/calc";
import { peso } from "@/lib/format";
import { canSalesWork } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatTin } from "@/lib/customers";
import {
  buildQuoteDraftKey,
  clearQuoteDraft,
  isQuoteDraftValidForSystemSave,
  loadQuoteDraft,
  saveQuoteDraft,
  type QuoteDraftLine,
  type QuoteDraftState,
} from "@/lib/quoteDraftRecovery";
import {
  quoteReferenceImageTypes,
  uploadQuoteReferenceImage,
  validateQuoteReferenceImage,
} from "@/lib/quoteReferenceImages";

export const Route = createFileRoute("/_app/quotes/$id/edit")({
  head: () => ({ meta: [{ title: "Edit quote — AutoMate PH" }] }),
  component: EditQuote,
});

interface LineDraft {
  id: string | null;
  template_id: string;
  description: string;
  pricing_mode: "sqft" | "fixed";
  unit_of_measure: Uom;
  width: string;
  height: string;
  quantity: string;
  rate_per_sqft: string;
  unit_price: string;
  adjustment_label: string;
  adjustment_amount: string;
  show_adjustment: boolean;
  is_blank?: boolean;
  reference_file?: File | null;
  reference_preview_url?: string | null;
}

const emptyLine: LineDraft = {
  id: null,
  template_id: "",
  description: "",
  pricing_mode: "sqft",
  unit_of_measure: "feet",
  width: "",
  height: "",
  quantity: "1",
  rate_per_sqft: "",
  unit_price: "",
  adjustment_label: "Adjustment",
  adjustment_amount: "",
  show_adjustment: false,
  is_blank: false,
};

const termsPresets = [
  "COD",
  "50% downpayment, balance upon completion",
  "Full payment upon completion",
  "30 days after invoice",
];

const AUTO_SAVE_DELAY_MS = 5000;

function EditQuote() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { role, user } = useAuth();
  const canWrite = canSalesWork(role);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerContact, setCustomerContact] = useState<CustomerContact | null>(null);
  const [projectName, setProjectName] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxType, setTaxType] = useState<"vatable" | "non_vat">("non_vat");
  const [salesAgent, setSalesAgent] = useState("");
  const [salesAgentUserId, setSalesAgentUserId] = useState<string | null>(null);
  const [adjustmentLabel, setAdjustmentLabel] = useState("Adjustment");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [terms, setTerms] = useState("");
  const [remarks, setRemarks] = useState("");
  const [showRemarks, setShowRemarks] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [expandedLineIndex, setExpandedLineIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "saved-local" | "recovered" | "failed" | "stale"
  >("idle");
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const {
    slotRef: summarySlotRef,
    pinned: summaryPinned,
    style: summaryStyle,
  } = useStickySummary();
  const loadedUpdatedAtRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const hydratedRef = useRef(false);
  const skipLocalSaveRef = useRef(false);
  const localDraftKey = buildQuoteDraftKey("edit", id);

  const quote = useQuery({
    queryKey: ["quote-edit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*, lines:quote_line_items(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const selectedCustomer = useQuery({
    queryKey: ["quote-customer-details", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("customer_name, tin_number, address")
        .eq("id", customerId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const restoreDraft = useCallback(
    (draft: Omit<QuoteDraftState, "savedAt">) => {
      setCustomerId(draft.customerId);
      if (draft.customerContactId !== quote.data?.customer_contact_id) setCustomerContact(null);
      setProjectName(draft.projectName);
      setQuoteDate(draft.quoteDate);
      setTaxType(draft.taxType);
      setSalesAgent(draft.salesAgent);
      setSalesAgentUserId(draft.salesAgentUserId);
      setAdjustmentLabel(draft.adjustmentLabel || "Adjustment");
      setAdjustmentAmount(draft.adjustmentAmount);
      setShowAdjustment(Number(draft.adjustmentAmount || 0) !== 0);
      setTerms(draft.terms);
      setRemarks(draft.remarks);
      setShowRemarks(Boolean(draft.remarks?.trim()));
      setLines(
        draft.lines.length
          ? draft.lines.map((line) => ({
              id: line.id ?? null,
              ...line,
              adjustment_label: line.adjustment_label ?? "Adjustment",
              adjustment_amount: line.adjustment_amount ?? "",
              show_adjustment: Boolean(line.show_adjustment),
            }))
          : [{ ...emptyLine }],
      );
    },
    [quote.data?.customer_contact_id],
  );

  useEffect(() => {
    if (!quote.data) return;
    setCustomerContact(
      quote.data.customer_contact_id && quote.data.contact_name_snapshot
        ? {
            id: quote.data.customer_contact_id,
            contact_name: quote.data.contact_name_snapshot,
            department: quote.data.contact_department_snapshot ?? null,
            phone: quote.data.contact_phone_snapshot ?? null,
            email: quote.data.contact_email_snapshot ?? null,
          }
        : null,
    );
    const loadedLines = (
      quote.data.lines as Array<{
        description: string;
        pricing_mode: "sqft" | "fixed";
        unit_of_measure: Uom | null;
        width: number | null;
        height: number | null;
        quantity: number;
        rate_per_sqft: number | null;
        unit_price: number;
        adjustment_label?: string | null;
        adjustment_amount?: number | null;
        sort_order: number | null;
        id: string;
        item_template_id?: string | null;
      }>
    )
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((line) => ({
        id: line.id,
        template_id: line.item_template_id ?? "",
        description: line.description === "[BLANK_LINE]" ? "" : line.description,
        is_blank: line.description === "[BLANK_LINE]",
        pricing_mode: line.pricing_mode,
        unit_of_measure: line.unit_of_measure ?? "feet",
        width: line.width?.toString() ?? "",
        height: line.height?.toString() ?? "",
        quantity: line.quantity.toString(),
        rate_per_sqft: line.rate_per_sqft?.toString() ?? "",
        unit_price: line.unit_price.toString(),
        adjustment_label: line.adjustment_label ?? "Adjustment",
        adjustment_amount:
          Number(line.adjustment_amount ?? 0) === 0 ? "" : String(line.adjustment_amount),
        show_adjustment: Number(line.adjustment_amount ?? 0) !== 0,
      }));
    const serverDraft: Omit<QuoteDraftState, "savedAt"> = {
      customerId: quote.data.customer_id,
      customerContactId: quote.data.customer_contact_id ?? null,
      projectName: quote.data.project_name,
      quoteDate: quote.data.quote_date,
      taxType: quote.data.tax_type ?? "non_vat",
      salesAgent: quote.data.sales_agent ?? "",
      salesAgentUserId: quote.data.sales_agent_user_id ?? null,
      adjustmentLabel: quote.data.adjustment_label ?? "Adjustment",
      adjustmentAmount:
        Number(quote.data.adjustment_amount ?? 0) === 0 ? "" : String(quote.data.adjustment_amount),
      terms: quote.data.terms ?? "",
      remarks: quote.data.remarks ?? "",
      lines: loadedLines.length > 0 ? loadedLines : [{ ...emptyLine }],
    };
    const localDraft = quote.data.status === "draft" ? loadQuoteDraft(localDraftKey) : null;
    const serverUpdatedAt = Date.parse(quote.data.updated_at);
    const shouldRestoreLocal = localDraft && localDraft.savedAt > serverUpdatedAt;
    const draftToRestore =
      shouldRestoreLocal && localDraft
        ? {
            ...localDraft,
            customerId: localDraft.customerId ?? serverDraft.customerId,
            projectName: safeDraftText(localDraft.projectName) || serverDraft.projectName,
            quoteDate: safeDraftText(localDraft.quoteDate) || serverDraft.quoteDate,
            salesAgent: safeDraftText(localDraft.salesAgent) || serverDraft.salesAgent,
            salesAgentUserId: localDraft.salesAgentUserId ?? serverDraft.salesAgentUserId,
            terms: safeDraftText(localDraft.terms) || serverDraft.terms,
            lines: hasMeaningfulLines(localDraft.lines) ? localDraft.lines : serverDraft.lines,
          }
        : serverDraft;

    restoreDraft(draftToRestore);
    if (shouldRestoreLocal) skipLocalSaveRef.current = true;
    loadedUpdatedAtRef.current = quote.data.updated_at;
    setLoadedUpdatedAt(quote.data.updated_at);
    setSaveState(shouldRestoreLocal ? "recovered" : "idle");
    hydratedRef.current = true;
  }, [localDraftKey, quote.data, restoreDraft]);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));
  }

  function removeLine(i: number) {
    setLines((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      setExpandedLineIndex((current) => {
        if (next.length === 0) return 0;
        if (i < current) return current - 1;
        return Math.min(current, next.length - 1);
      });
      return next.length > 0 ? next : [{ ...emptyLine }];
    });
  }

  function moveLine(i: number, direction: -1 | 1) {
    setLines((prev) => {
      const target = i + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[target]] = [next[target], next[i]];
      setExpandedLineIndex(target);
      return next;
    });
  }

  function setLineReferenceImage(i: number, file: File | undefined) {
    if (!file) return;
    const validationError = validateQuoteReferenceImage(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const previousPreview = lines[i]?.reference_preview_url;
    if (previousPreview) URL.revokeObjectURL(previousPreview);
    updateLine(i, {
      reference_file: file,
      reference_preview_url: URL.createObjectURL(file),
    });
  }

  function applyTemplate(i: number, template: ItemTemplate) {
    updateLine(i, {
      template_id: template.id,
      description: template.description,
      pricing_mode: template.pricing_mode,
      unit_of_measure: template.default_unit ?? "feet",
      width: template.pricing_mode === "sqft" ? (template.default_width?.toString() ?? "") : "",
      height: template.pricing_mode === "sqft" ? (template.default_height?.toString() ?? "") : "",
      rate_per_sqft: template.default_rate_per_sqft?.toString() ?? "",
      unit_price: template.default_unit_price?.toString() ?? "",
    });
    toast.success(`${template.name} template applied`);
  }

  function computed(line: LineDraft) {
    if (line.pricing_mode === "sqft") {
      return computeLine({
        pricing_mode: "sqft",
        width: Number(line.width || 0),
        height: Number(line.height || 0),
        unit_of_measure: line.unit_of_measure,
        rate_per_sqft: Number(line.rate_per_sqft || 0),
        quantity: Number(line.quantity || 0),
        adjustment_amount: Number(line.adjustment_amount || 0),
      });
    }
    return computeLine({
      pricing_mode: "fixed",
      unit_price: Number(line.unit_price || 0),
      quantity: Number(line.quantity || 0),
      adjustment_amount: Number(line.adjustment_amount || 0),
    });
  }

  const total = lines.reduce((sum, line) => sum + computed(line).line_total, 0);
  const itemAdjustmentTotal = lines.reduce(
    (sum, line) => sum + Number(line.adjustment_amount || 0),
    0,
  );
  const displaySubtotal = total - itemAdjustmentTotal;
  const adjustment = Number(adjustmentAmount || 0);
  const displayAdjustment = itemAdjustmentTotal + adjustment;
  const quoteBaseTotal = total + adjustment;
  const vat = computeInclusiveVat(quoteBaseTotal);
  const quoteTotal = taxType === "vatable" ? vat.grossTotal : quoteBaseTotal;
  const editableStatuses = ["draft"] as const;
  const locked = quote.data ? quote.data.status !== "draft" : true;

  useEffect(() => {
    if (!hydratedRef.current || busy) return;
    if (skipLocalSaveRef.current) {
      skipLocalSaveRef.current = false;
      return;
    }
    saveQuoteDraft(localDraftKey, buildDraft());
    setSaveState("saved-local");
    // buildDraft is intentionally route-local; the concrete form fields below are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    localDraftKey,
    busy,
    customerId,
    projectName,
    quoteDate,
    taxType,
    salesAgent,
    salesAgentUserId,
    adjustmentLabel,
    adjustmentAmount,
    terms,
    remarks,
    lines,
  ]);

  useEffect(() => {
    if (!quote.data || quote.data.status !== "draft" || locked || !canWrite) return;
    if (!hydratedRef.current) return;
    const draft = { ...buildDraft(), savedAt: Date.now() };
    if (!isQuoteDraftValidForSystemSave(draft, quoteTotal)) return;

    const timeout = window.setTimeout(() => {
      void save({ silent: true });
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
    // save/buildDraft are route-local helpers; the concrete form fields below are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    quote.data,
    locked,
    canWrite,
    customerId,
    projectName,
    quoteDate,
    taxType,
    salesAgent,
    salesAgentUserId,
    adjustmentLabel,
    adjustmentAmount,
    terms,
    remarks,
    lines,
    quoteTotal,
  ]);

  useEffect(() => {
    if (!quote.data || quote.data.status !== "draft" || locked || !canWrite) return;
    const saveNow = () => {
      const draft = { ...buildDraft(), savedAt: Date.now() };
      if (isQuoteDraftValidForSystemSave(draft, quoteTotal)) {
        void save({ silent: true });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveNow();
    };

    window.addEventListener("blur", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // save/buildDraft are route-local helpers; the concrete form fields below are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    quote.data,
    locked,
    canWrite,
    customerId,
    projectName,
    quoteDate,
    taxType,
    salesAgent,
    salesAgentUserId,
    adjustmentLabel,
    adjustmentAmount,
    terms,
    remarks,
    lines,
    quoteTotal,
  ]);

  function buildDraft(): Omit<QuoteDraftState, "savedAt"> {
    return {
      customerId,
      customerContactId: customerContact?.id ?? null,
      projectName,
      quoteDate,
      taxType,
      salesAgent,
      salesAgentUserId,
      adjustmentLabel,
      adjustmentAmount,
      terms,
      remarks,
      lines: lines.map(({ reference_file, reference_preview_url, ...line }) => line),
    };
  }

  function validateForManualSave() {
    if (!customerId) return "Pick a customer";
    if (!projectName.trim()) return "Project name required";
    if (!salesAgentUserId) return "Choose a saved sales agent";
    if (lines.length === 0) return "Add at least one line";
    if (quoteTotal <= 0) return "Add a price to at least one line item before submitting.";
    for (const line of lines) {
      if (line.is_blank) continue;
      if (!line.description.trim()) return "Each line needs a description";
      if (Number(line.quantity) <= 0) return "Quantity must be > 0";
      if (
        line.pricing_mode === "sqft" &&
        (Number(line.width) <= 0 || Number(line.height) <= 0 || Number(line.rate_per_sqft) <= 0)
      ) {
        return "Sq ft lines need width, height, and rate";
      }
      if (line.pricing_mode === "fixed" && Number(line.unit_price) <= 0) {
        return "Fixed lines need a unit price";
      }
      if (computed(line).line_total <= 0) return "Line total must be greater than zero";
    }
    return null;
  }

  async function save(options: { silent?: boolean } = {}) {
    if (!canWrite) {
      if (!options.silent) toast.error("You do not have permission to perform this action.");
      return false;
    }
    if (locked || quote.data?.status !== "draft") {
      if (!options.silent) toast.error("Only draft quotes can be edited.");
      return false;
    }
    const validationError = validateForManualSave();
    if (validationError) {
      if (!options.silent) toast.error(validationError);
      return false;
    }
    const expectedUpdatedAt = loadedUpdatedAtRef.current ?? loadedUpdatedAt;
    if (!expectedUpdatedAt) return false;
    if (saveInFlightRef.current) return false;

    if (options.silent) {
      setSaveState("saving");
    } else {
      setBusy(true);
    }
    saveInFlightRef.current = true;
    try {
      const { data: updatedQuote, error: quoteError } = await supabase
        .from("quotations")
        .update({
          customer_id: customerId!,
          customer_contact_id: customerContact?.id ?? null,
          contact_name_snapshot: customerContact?.contact_name ?? null,
          contact_department_snapshot: customerContact?.department ?? null,
          contact_phone_snapshot: customerContact?.phone ?? null,
          contact_email_snapshot: customerContact?.email ?? null,
          project_name: projectName.trim(),
          quote_date: quoteDate,
          tax_type: taxType,
          sales_agent: salesAgent.trim() || null,
          sales_agent_user_id: salesAgentUserId,
          terms: terms.trim() || null,
          remarks: remarks.trim() || null,
          adjustment_label: adjustmentLabel.trim() || "Adjustment",
          adjustment_amount: adjustment,
        })
        .eq("id", id)
        .in("status", editableStatuses)
        .eq("updated_at", expectedUpdatedAt)
        .select("id, updated_at")
        .maybeSingle();
      if (quoteError) throw quoteError;
      if (!updatedQuote) {
        throw new Error("This quote was updated by someone else. Reload before continuing.");
      }

      const linePayloads = lines.map((line, idx) => {
        const result = computed(line);
        return {
          id: line.id,
          sort_order: idx,
          values: {
            item_template_id: line.template_id || null,
            description: line.is_blank ? "[BLANK_LINE]" : line.description.trim(),
            pricing_mode: line.pricing_mode,
            unit_of_measure: line.pricing_mode === "sqft" ? line.unit_of_measure : null,
            width: line.pricing_mode === "sqft" ? Number(line.width) : null,
            height: line.pricing_mode === "sqft" ? Number(line.height) : null,
            rate_per_sqft: line.pricing_mode === "sqft" ? Number(line.rate_per_sqft) : null,
            quantity: Number(line.quantity),
            computed_sqft: line.pricing_mode === "sqft" ? result.computed_sqft : null,
            unit_price: result.unit_price,
            line_total: result.line_total,
            adjustment_label: line.adjustment_label.trim() || "Adjustment",
            adjustment_amount: Number(line.adjustment_amount || 0),
            is_blank: line.is_blank === true,
            sort_order: idx,
          },
        };
      });
      const { data: savedLines, error: lineError } = await supabase.rpc(
        "replace_quote_lines_and_snapshot" as never,
        {
          p_quotation_id: id,
          p_lines: linePayloads.map((line) => ({ id: line.id, ...line.values })),
        } as never,
      );
      if (lineError) throw lineError;
      if (savedLines) {
        const savedIdsByOrder = new Map(savedLines.map((line) => [line.sort_order ?? 0, line.id]));
        const imageUploads = lines.flatMap((line, index) => {
          const lineId = line.id ?? savedIdsByOrder.get(index);
          if (!line.reference_file || !lineId) return [];
          return [
            uploadQuoteReferenceImage({
              quotationId: id,
              quoteLineItemId: lineId,
              file: line.reference_file,
              uploadedBy: user?.id,
            }),
          ];
        });
        if (imageUploads.length > 0) {
          const uploadResults = await Promise.allSettled(imageUploads);
          if (uploadResults.some((result) => result.status === "rejected")) {
            toast.error("Quote saved, but some reference images did not upload.");
          }
        }
        setLines((current) =>
          current.map((line, index) => ({
            ...line,
            id: line.id ?? savedIdsByOrder.get(index) ?? null,
            reference_file: null,
            reference_preview_url: null,
          })),
        );
      }

      const { data: freshQuote, error: freshQuoteError } = await supabase
        .from("quotations")
        .select("updated_at")
        .eq("id", id)
        .single();
      if (freshQuoteError) throw freshQuoteError;

      const nextUpdatedAt = freshQuote.updated_at ?? updatedQuote.updated_at;
      loadedUpdatedAtRef.current = nextUpdatedAt;
      setLoadedUpdatedAt(nextUpdatedAt);
      clearQuoteDraft(localDraftKey);
      if (options.silent) {
        setSaveState("saved");
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["quote", id] }),
          qc.invalidateQueries({ queryKey: ["quotes"] }),
        ]);
      } else {
        await logAudit("quotation.updated", "quotation", id, {
          project_name: projectName.trim(),
          total_amount: quoteTotal,
        });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["quote", id] }),
          qc.invalidateQueries({ queryKey: ["quote-edit", id] }),
          qc.invalidateQueries({ queryKey: ["quotes"] }),
        ]);
        toast.success("Quote updated");
        nav({ to: "/quotes/$id", params: { id } });
      }
      return true;
    } catch (error) {
      const message = (error as Error).message;
      setSaveState(message.includes("updated by someone else") ? "stale" : "failed");
      if (!options.silent) toast.error(message);
      return false;
    } finally {
      saveInFlightRef.current = false;
      if (!options.silent) setBusy(false);
    }
  }

  if (quote.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!quote.data) return <div>Not found</div>;
  if (locked) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/quotes/$id" params={{ id }}>
            <ArrowLeft className="h-4 w-4" /> Back to quote
          </Link>
        </Button>

        <div>
          <h1 className="text-3xl font-semibold">Edit quote</h1>
          <p className="text-muted-foreground mt-1">
            Pricing can be changed until the quotation is sent.
          </p>
        </div>

        <Alert>
          <AlertTitle>This quote is locked.</AlertTitle>
          <AlertDescription>
            Only Draft quotes can be edited. Once sent, the quote is waiting for the customer
            decision and pricing changes need a new quote.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/quotes/$id" params={{ id }}>
          <ArrowLeft className="h-4 w-4" /> Back to quote
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-semibold">Edit quote</h1>
        <p className="text-muted-foreground mt-1">
          Update this draft quote, then save the changes from the Quote total card.
        </p>
        <QuoteSaveState state={saveState} />
      </div>

      {!canWrite ? (
        <Alert>
          <AlertTitle>You do not have permission to perform this action.</AlertTitle>
          <AlertDescription>
            Viewer access can review quotations but cannot edit them.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-3">
          <Card className="min-w-0 space-y-4 rounded-xl border-primary/10 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <StepBadge>1</StepBadge>
              <div>
                <h2 className="font-semibold">Customer and tax details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick the customer once. TIN and address stay on the customer record.
                </p>
              </div>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <CustomerPicker
                  value={customerId}
                  onChange={(nextId) => {
                    setCustomerId(nextId);
                    setCustomerContact(null);
                  }}
                  disabled={locked || !canWrite}
                />
              </div>
              <CustomerDetailBox
                label="TIN number"
                value={formatTin(selectedCustomer.data?.tin_number)}
                fallback={customerId ? "No TIN saved" : "Select a customer"}
              />
              <div className="space-y-2 md:col-span-2">
                <CustomerContactPicker
                  customerId={customerId}
                  value={customerContact?.id ?? null}
                  onChange={setCustomerContact}
                  disabled={locked || !canWrite}
                />
              </div>
              <CustomerDetailBox
                className="md:col-span-2"
                label="Address"
                value={selectedCustomer.data?.address}
                fallback={customerId ? "No address saved" : "Select a customer"}
              />
              <div className="space-y-2">
                <Label>Quote date</Label>
                <Input
                  type="date"
                  value={quoteDate}
                  onChange={(event) => setQuoteDate(event.target.value)}
                  disabled={locked || !canWrite}
                />
              </div>
              <div className="space-y-2">
                <Label>VAT mode</Label>
                <Select
                  value={taxType}
                  onValueChange={(value) => setTaxType(value as "vatable" | "non_vat")}
                  disabled={locked || !canWrite}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="non_vat">Non-VAT</SelectItem>
                    <SelectItem value="vatable">VATable</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This will be copied to the job order and invoice.
                </p>
              </div>
            </div>
          </Card>

          <Card className="min-w-0 space-y-4 rounded-xl border-primary/10 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <StepBadge>2</StepBadge>
              <div>
                <h2 className="font-semibold">Sales details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Set the project, agent, and terms before pricing the line items.
                </p>
              </div>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Project name *</Label>
                <Input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  disabled={locked || !canWrite}
                />
              </div>
              <div className="space-y-2">
                <Label>Sales Agent</Label>
                <SalesAgentPicker
                  value={salesAgent}
                  userId={salesAgentUserId}
                  disabled={locked || !canWrite}
                  onChange={(name, nextUserId) => {
                    setSalesAgent(name);
                    setSalesAgentUserId(nextUserId);
                  }}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <TermsField value={terms} onChange={setTerms} disabled={locked || !canWrite} />
              </div>
              <div className="md:col-span-2">
                {showRemarks || remarks.trim() ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Remarks</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRemarks("");
                          setShowRemarks(false);
                        }}
                        disabled={locked || !canWrite}
                      >
                        Remove remarks
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      value={remarks}
                      onChange={(event) => setRemarks(event.target.value)}
                      disabled={locked || !canWrite}
                    />
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRemarks(true)}
                    disabled={locked || !canWrite}
                  >
                    <Plus className="h-4 w-4" /> Add remarks
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card className="min-w-0 space-y-4 rounded-xl border-primary/10 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Line items</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pricing entered here becomes the quotation total.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLines((prev) => {
                    setExpandedLineIndex(prev.length);
                    return [...prev, { ...emptyLine }];
                  });
                }}
                disabled={locked || !canWrite}
              >
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            <div className="space-y-1">
              {lines.map((line, i) => {
                const result = computed(line);
                return (
                  <div key={i} className="min-w-0 space-y-1 border-b pb-2 last:border-b-0 sm:pb-3">
                    {expandedLineIndex !== i ? (
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
                        onClick={() => setExpandedLineIndex(i)}
                        aria-label={`Edit line ${i + 1}: ${line.description.trim() || "Untitled item"}`}
                      >
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {i + 1}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate font-medium"
                          title={line.description.trim() || "Untitled item"}
                        >
                          {line.description.trim() || "Untitled item"}
                        </span>
                        <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
                          {line.quantity}{" "}
                          {line.pricing_mode === "sqft" ? line.unit_of_measure : "unit"}
                        </span>
                        {line.show_adjustment ? (
                          <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                            Adjusted
                          </span>
                        ) : null}
                        <span className="shrink-0 font-medium tabular-nums">
                          {peso(result.line_total)}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">Edit</span>
                      </button>
                    ) : null}
                    <div
                      className={
                        expandedLineIndex === i
                          ? "rounded-lg bg-muted/20 px-3 py-3 ring-1 ring-primary/20 sm:px-4"
                          : "hidden"
                      }
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                            Editing item {i + 1}
                          </p>
                          <p
                            className="mt-1 truncate text-sm font-medium"
                            title={line.description || "Untitled item"}
                          >
                            {line.description.trim() || "Untitled item"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveLine(i, -1)} disabled={!canWrite || i === 0}>↑</Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveLine(i, 1)} disabled={!canWrite || i === lines.length - 1}>↓</Button>
                          <span className="ml-1 text-xs text-muted-foreground">Move line</span>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start">
                        <div className="min-w-0 flex-1 space-y-2">
                          <ItemTemplatePicker
                            value={line.template_id}
                            disabled={locked || !canWrite}
                            onApply={(template) => applyTemplate(i, template)}
                            onCustom={() => updateLine(i, { template_id: "" })}
                          />
                          <Label className="text-xs">Description *</Label>
                          <Input
                            value={line.description}
                            onChange={(event) =>
                              updateLine(i, { template_id: "", description: event.target.value })
                            }
                            disabled={locked || !canWrite}
                          />
                        </div>
                        <div className="w-full shrink-0 space-y-2 md:w-40">
                          <Label className="text-xs">Pricing</Label>
                          <Select
                            value={line.pricing_mode}
                            onValueChange={(value) =>
                              updateLine(i, {
                                template_id: "",
                                pricing_mode: value as "sqft" | "fixed",
                              })
                            }
                            disabled={locked || !canWrite}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sqft">Square foot</SelectItem>
                              <SelectItem value="fixed">Fixed unit</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {lines.length > 1 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="md:mt-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLine(i)}
                            disabled={locked || !canWrite}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>

                      {line.pricing_mode === "sqft" ? (
                        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-5">
                          <div className="min-w-0 space-y-2">
                            <Label className="text-xs">Unit</Label>
                            <Select
                              value={line.unit_of_measure}
                              onValueChange={(value) =>
                                updateLine(i, { template_id: "", unit_of_measure: value as Uom })
                              }
                              disabled={locked || !canWrite}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="feet">Feet</SelectItem>
                                <SelectItem value="inches">Inches</SelectItem>
                                <SelectItem value="meters">Meters</SelectItem>
                                <SelectItem value="centimeters">Centimeters</SelectItem>
                                <SelectItem value="millimeters">Millimeters</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <LineNumberField
                            label="Width"
                            value={line.width}
                            disabled={locked || !canWrite}
                            onChange={(value) => updateLine(i, { template_id: "", width: value })}
                          />
                          <LineNumberField
                            label="Height"
                            value={line.height}
                            disabled={locked || !canWrite}
                            onChange={(value) => updateLine(i, { template_id: "", height: value })}
                          />
                          <LineNumberField
                            label="Rate / sq ft"
                            value={line.rate_per_sqft}
                            disabled={locked || !canWrite}
                            onChange={(value) =>
                              updateLine(i, { template_id: "", rate_per_sqft: value })
                            }
                          />
                          <LineNumberField
                            label="Quantity"
                            value={line.quantity}
                            disabled={locked || !canWrite}
                            onChange={(value) =>
                              updateLine(i, { template_id: "", quantity: value })
                            }
                          />
                        </div>
                      ) : (
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                          <LineNumberField
                            label="Quantity"
                            value={line.quantity}
                            disabled={locked || !canWrite}
                            onChange={(value) =>
                              updateLine(i, { template_id: "", quantity: value })
                            }
                          />
                          <LineNumberField
                            label="Unit price"
                            value={line.unit_price}
                            disabled={locked || !canWrite}
                            onChange={(value) =>
                              updateLine(i, { template_id: "", unit_price: value })
                            }
                          />
                        </div>
                      )}

                      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={line.is_blank === true} onChange={(event) => updateLine(i, { template_id: "", is_blank: event.target.checked })} disabled={!canWrite} /><span>Blank line (hide from print)</span></label>

                      {line.show_adjustment ? (
                        <div className="mt-4 grid gap-3 border-t border-primary/25 pt-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs">Item adjustment</Label>
                            <Input
                              value={line.adjustment_label}
                              disabled={locked || !canWrite}
                              onChange={(event) =>
                                updateLine(i, { adjustment_label: event.target.value })
                              }
                              placeholder="Discount"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Amount (+ extra / - discount)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={line.adjustment_amount}
                              disabled={locked || !canWrite}
                              onChange={(event) =>
                                updateLine(i, { adjustment_amount: event.target.value })
                              }
                              placeholder="-150.00"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3 sm:col-span-2">
                            <p className="text-xs text-muted-foreground">
                              This adjustment applies to this item only.
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="px-0 text-muted-foreground"
                              onClick={() =>
                                updateLine(i, {
                                  adjustment_label: "Adjustment",
                                  adjustment_amount: "",
                                  show_adjustment: false,
                                })
                              }
                              disabled={locked || !canWrite}
                            >
                              Remove line adjustment
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="px-0 text-muted-foreground"
                          onClick={() =>
                            updateLine(i, { adjustment_amount: "0", show_adjustment: true })
                          }
                          disabled={locked || !canWrite}
                        >
                          <Plus className="h-4 w-4" /> Adjust this item
                        </Button>
                      )}

                      <div className="flex justify-between text-sm pt-2 border-t">
                        <span className="text-muted-foreground">
                          {line.pricing_mode === "sqft" && result.computed_sqft != null
                            ? `${result.computed_sqft.toFixed(2)} sq ft · ${peso(result.unit_price)} unit`
                            : `${peso(result.unit_price)} unit`}
                          {Number(line.adjustment_amount || 0) !== 0 ? (
                            <span className="ml-2">
                              {line.adjustment_label.trim() || "Adjustment"}:{" "}
                              {peso(Number(line.adjustment_amount || 0))}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-medium tabular-nums">{peso(result.line_total)}</span>
                      </div>
                      {line.id ? (
                        <QuoteAttachmentsSection
                          quotationId={id}
                          quoteLineItemId={line.id}
                          title="Item reference image"
                          description="Attach design references for this line item."
                          compact
                        />
                      ) : (
                        <LineReferenceImagePicker
                          fileName={line.reference_file?.name ?? null}
                          previewUrl={line.reference_preview_url ?? null}
                          disabled={locked || !canWrite}
                          onPick={(file) => setLineReferenceImage(i, file)}
                          onRemove={() => {
                            if (line.reference_preview_url) {
                              URL.revokeObjectURL(line.reference_preview_url);
                            }
                            updateLine(i, { reference_file: null, reference_preview_url: null });
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t pt-4">
              {showAdjustment || adjustment !== 0 ? (
                <div className="rounded-lg border bg-muted/25 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-medium">Discount / round-off</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Use a positive or negative amount to adjust the quote total.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAdjustmentLabel("Adjustment");
                        setAdjustmentAmount("");
                        setShowAdjustment(false);
                      }}
                      disabled={locked || !canWrite}
                    >
                      Remove adjustment
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]">
                    <div className="space-y-2">
                      <Label>Adjustment label</Label>
                      <Input
                        value={adjustmentLabel}
                        onChange={(event) => setAdjustmentLabel(event.target.value)}
                        placeholder="Discount"
                        disabled={locked || !canWrite}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={adjustmentAmount}
                        onChange={(event) => setAdjustmentAmount(event.target.value)}
                        placeholder="0.00"
                        disabled={locked || !canWrite}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdjustment(true)}
                  disabled={locked || !canWrite}
                >
                  <Plus className="h-4 w-4" /> Add discount / round-off
                </Button>
              )}
            </div>
          </Card>
        </div>
        <div
          ref={summarySlotRef}
          className="min-w-0 self-start"
          style={summaryPinned ? { minHeight: 1 } : undefined}
        >
          <Card
            className="z-10 h-fit w-full self-start rounded-xl border-primary/10 p-4 shadow-sm"
            style={summaryStyle}
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-semibold">Quote total</h2>
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular-nums">{peso(displaySubtotal)}</span>
              </div>
              {displayAdjustment !== 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Adjustment</span>
                  <span className="font-medium tabular-nums">{peso(displayAdjustment)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4 border-t pt-3">
                <span className="font-semibold">Amount due</span>
                <span className="text-lg font-semibold tabular-nums">{peso(quoteTotal)}</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Button
                className="h-10 w-full"
                onClick={() => save()}
                disabled={busy || locked || !canWrite}
              >
                <Save className="h-4 w-4" />
                {busy ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function safeDraftText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasMeaningfulLines(lines: QuoteDraftLine[]) {
  return lines.some((line) => {
    if (line.description.trim()) return true;
    if (Number(line.quantity || 0) > 1) return true;
    if (Number(line.width || 0) > 0) return true;
    if (Number(line.height || 0) > 0) return true;
    if (Number(line.rate_per_sqft || 0) > 0) return true;
    return Number(line.unit_price || 0) > 0;
  });
}

function StepBadge({ children }: { children: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
      {children}
    </span>
  );
}

function QuoteSaveState({
  state,
}: {
  state: "idle" | "saving" | "saved" | "saved-local" | "recovered" | "failed" | "stale";
}) {
  if (state === "idle") return null;
  const labels = {
    saving: "Saving...",
    saved: "Saved",
    "saved-local": "Saved locally",
    recovered: "Recovered draft",
    failed: "Save failed",
    stale: "This quote was updated by someone else. Reload before continuing.",
  };
  return (
    <p
      className={`mt-2 text-sm ${
        state === "failed" || state === "stale" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {labels[state]}
    </p>
  );
}

function TermsField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const selected = termsPresets.includes(value) ? value : "custom";
  const isCustom = selected === "custom";

  return (
    <div className="space-y-2">
      <Label>Terms</Label>
      <Select
        value={selected}
        onValueChange={(next) => onChange(next === "custom" ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select terms" />
        </SelectTrigger>
        <SelectContent>
          {termsPresets.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {preset}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type custom terms"
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

function CustomerDetailBox({
  label,
  value,
  fallback,
  className,
}: {
  label: string;
  value?: string | null;
  fallback: string;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      <div className="min-h-10 rounded-md border bg-background px-3 py-2 text-sm shadow-sm">
        <span className={value ? "whitespace-pre-wrap" : "text-muted-foreground"}>
          {value || fallback}
        </span>
      </div>
    </div>
  );
}

function LineNumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function LineReferenceImagePicker({
  fileName,
  previewUrl,
  disabled,
  onPick,
  onRemove,
}: {
  fileName: string | null;
  previewUrl: string | null;
  disabled: boolean;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const [showImagePicker, setShowImagePicker] = useState(Boolean(fileName || previewUrl));

  if (!showImagePicker && !fileName && !previewUrl) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-0 text-muted-foreground"
        onClick={() => setShowImagePicker(true)}
        disabled={disabled}
      >
        <Upload className="h-4 w-4" /> Add reference image
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-dashed bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Item reference image</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {fileName ?? "Optional. This appears in the measurement cell on print/PDF."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fileName ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onRemove();
                setShowImagePicker(false);
              }}
              disabled={disabled}
            >
              Remove
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowImagePicker(false)}
              disabled={disabled}
            >
              Close
            </Button>
          )}
          <label className="inline-flex">
            <Input
              className="sr-only"
              type="file"
              accept={quoteReferenceImageTypes.join(",")}
              disabled={disabled}
              onChange={(event) => {
                onPick(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
              <Upload className="h-3.5 w-3.5" />
              {fileName ? "Change image" : "Add image"}
            </span>
          </label>
        </div>
      </div>
      {previewUrl ? (
        <div className="mt-3 w-52 max-w-full overflow-hidden rounded border bg-muted/20">
          <img
            src={previewUrl}
            alt={fileName ?? "Item reference"}
            className="h-28 w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
