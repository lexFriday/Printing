import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerPicker } from "@/components/CustomerPicker";
import { CustomerContactPicker, type CustomerContact } from "@/components/CustomerContactPicker";
import { ItemTemplatePicker, type ItemTemplate } from "@/components/ItemTemplatePicker";
import { SalesAgentPicker } from "@/components/SalesAgentPicker";
import { Trash2, Plus, Save, Upload } from "lucide-react";
import { computeInclusiveVat, computeLine, type Uom } from "@/lib/calc";
import { peso } from "@/lib/format";
import { canSalesWork } from "@/lib/roles";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";
import { useStickySummary } from "@/hooks/useStickySummary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatTin } from "@/lib/customers";
import {
  buildQuoteDraftKey,
  clearQuoteDraft,
  loadQuoteDraft,
  saveQuoteDraft,
  type QuoteDraftState,
} from "@/lib/quoteDraftRecovery";
import {
  quoteReferenceImageTypes,
  uploadQuoteReferenceImage,
  validateQuoteReferenceImage,
} from "@/lib/quoteReferenceImages";

export const Route = createFileRoute("/_app/quotes/new")({
  head: () => ({ meta: [{ title: "New quote — AutoMate PH" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  component: NewQuote,
});

interface LineDraft {
  template_id: string;
  description: string;
  pricing_mode: "sqft" | "fixed";
  unit_of_measure: Uom;
  width: string;
  height: string;
  depth: string;
  quantity: string;
  rate_per_sqft: string;
  unit_price: string;
  adjustment_label: string;
  adjustment_amount: string;
  show_adjustment: boolean;
  no_charge?: boolean;
  is_blank?: boolean;
  reference_file?: File | null;
  reference_preview_url?: string | null;
  pricing_basis: "manual" | "per_sheet";
  pages_per_copy: string;
  sheets_per_copy: string;
  sheet_waste_percent: string;
  sheet_price: string;
}

const emptyLine: LineDraft = {
  template_id: "",
  description: "",
  pricing_mode: "sqft",
  unit_of_measure: "feet",
  width: "",
  height: "",
  depth: "",
  quantity: "1",
  rate_per_sqft: "",
  unit_price: "",
  adjustment_label: "Adjustment",
  adjustment_amount: "",
  show_adjustment: false,
  no_charge: false,
  is_blank: false,
  pricing_basis: "manual",
  pages_per_copy: "",
  sheets_per_copy: "",
  sheet_waste_percent: "0",
  sheet_price: "",
};

const termsPresets = [
  "COD",
  "50% downpayment, balance upon completion",
  "Full payment upon completion",
  "30 days after invoice",
];

// Sheet-pricing profiles are intentionally not part of this worktree.
const formatSheetTier = (_tier?: unknown) => "Manual pricing";

function NewQuote() {
  const nav = useNavigate();
  const { customerId: initialCustomerId } = Route.useSearch();
  const { role, user } = useAuth();
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId ?? null);
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
  const [noChargeReason, setNoChargeReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const isNoCharge = lines.length > 0 && lines.every((line) => line.no_charge === true);
  const [expandedLineIndex, setExpandedLineIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved-local" | "saved-server" | "recovered" | "offline" | "sync-error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [secondsUntilSave, setSecondsUntilSave] = useState(30);
  const recoveredRef = useRef(false);
  const serverDraftSessionKey = `automate-ph:quote-draft:new:session-id:${user?.id ?? "anonymous"}`;
  const serverDraftIdRef = useRef<string>(typeof window !== "undefined" ? (sessionStorage.getItem(serverDraftSessionKey) ?? crypto.randomUUID()) : crypto.randomUUID());
  const serverDraftVersionRef = useRef(1);
  const serverSaveInFlightRef = useRef(false);
  const serverSavePendingRef = useRef(false);
  const [draftListOpen, setDraftListOpen] = useState(true);
  const [draftToDelete, setDraftToDelete] = useState<ServerQuoteDraft | null>(null);
  const localDraftKey = buildQuoteDraftKey("new");
  if (typeof window !== "undefined") sessionStorage.setItem(serverDraftSessionKey, serverDraftIdRef.current);
  const { slotRef: summarySlotRef, pinned: summaryPinned, style: summaryStyle } = useStickySummary();

  const serverDrafts = useQuery({
    queryKey: ["workflow-drafts", "quotation"],
    queryFn: async (): Promise<ServerQuoteDraft[]> => {
      const { data, error } = await supabase.from("workflow_drafts").select("id,payload,project_name,customer_id,updated_at,version").eq("workflow", "quotation").is("deleted_at", null).gte("updated_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).order("updated_at", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as ServerQuoteDraft[];
    },
    enabled: canSalesWork(role),
  });

  function continueServerDraft(draft: ServerQuoteDraft) {
    const saved = draft.payload;
    serverDraftIdRef.current = draft.id;
    serverDraftVersionRef.current = draft.version;
    setCustomerId(saved.customerId);
    setCustomerContact(saved.customerContactId ? ({ id: saved.customerContactId, contact_name: saved.customerContactName ?? "", department: null, phone: saved.customerContactPhone ?? null, email: saved.customerContactEmail ?? null } as CustomerContact) : null);
    setProjectName(saved.projectName);
    setQuoteDate(saved.quoteDate);
    setTaxType(saved.taxType);
    setSalesAgent(saved.salesAgent);
    setSalesAgentUserId(saved.salesAgentUserId);
    setAdjustmentLabel(saved.adjustmentLabel);
    setAdjustmentAmount(saved.adjustmentAmount);
    setTerms(saved.terms);
    setRemarks(saved.remarks);
    setNoChargeReason(saved.noChargeReason ?? "");
    if (saved.lines.length) setLines(saved.lines as LineDraft[]);
    setSaveState("recovered");
    setLastSavedAt(new Date(draft.updated_at).getTime());
    setDraftListOpen(false);
    toast.success("Draft loaded. Continue your quotation.");
  }

  async function deleteServerDraft(id: string) {
    const { error } = await supabase.from("workflow_drafts").delete().eq("id", id);
    if (error) toast.error(error.message); else { await serverDrafts.refetch(); toast.success("Draft deleted"); }
  }

  async function confirmDeleteDraft() {
    if (!draftToDelete) return;
    const id = draftToDelete.id;
    setDraftToDelete(null);
    await deleteServerDraft(id);
  }

  function startNewQuote() {
    clearQuoteDraft(localDraftKey);
    serverDraftIdRef.current = crypto.randomUUID();
    sessionStorage.setItem(serverDraftSessionKey, serverDraftIdRef.current);
    serverDraftVersionRef.current = 1;
    setCustomerId(initialCustomerId ?? null);
    setCustomerContact(null);
    setProjectName("");
    setQuoteDate(new Date().toISOString().slice(0, 10));
    setTaxType("non_vat");
    setSalesAgent(currentProfile.data?.display_name ?? "");
    setSalesAgentUserId(currentProfile.data?.user_id ?? null);
    setAdjustmentLabel("Adjustment");
    setAdjustmentAmount("");
    setTerms("");
    setRemarks("");
    setLines([{ ...emptyLine }]);
    setSaveState("idle");
    setLastSavedAt(null);
    setDraftListOpen(false);
    toast.success("Started a new quote. Your saved drafts are unchanged.");
  }

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
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
      pricing_basis: "manual",
      sheets_per_copy: template.sheets_per_copy?.toString() ?? "",
      sheet_waste_percent: template.sheet_waste_percent?.toString() ?? "0",
    });
    toast.success(`${template.name} template applied`);
  }

  function computed(l: LineDraft) {
    if (l.pricing_mode === "sqft") {
      return computeLine({
        pricing_mode: "sqft",
        width: Number(l.width || 0),
        height: Number(l.height || 0),
        unit_of_measure: l.unit_of_measure,
        rate_per_sqft: Number(l.rate_per_sqft || 0),
        quantity: Number(l.quantity || 0),
        adjustment_amount: Number(l.adjustment_amount || 0),
      });
    }
    return computeLine({
      pricing_mode: "fixed",
      unit_price: Number(l.unit_price || 0),
      quantity: Number(l.quantity || 0),
      adjustment_amount: Number(l.adjustment_amount || 0),
    });
  }

  const total = lines.reduce((s, l) => s + computed(l).line_total, 0);
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
  const canWrite = canSalesWork(role);
  const currentProfile = useQuery({
    queryKey: ["current-user-profile"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_current_user_profile");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
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
  useEffect(() => {
    if (!currentProfile.data || salesAgent) return;
    setSalesAgent(currentProfile.data.display_name ?? "");
    setSalesAgentUserId(currentProfile.data.user_id ?? null);
  }, [currentProfile.data, salesAgent]);

  useEffect(() => {
    const saved = loadQuoteDraft(localDraftKey);
    if (saved && Date.now() - saved.savedAt < 7 * 24 * 60 * 60 * 1000) {
      setCustomerId(saved.customerId);
      setCustomerContact(saved.customerContactId ? ({ id: saved.customerContactId, contact_name: saved.customerContactName ?? "", department: null, phone: saved.customerContactPhone ?? null, email: saved.customerContactEmail ?? null } as CustomerContact) : null);
      setProjectName(saved.projectName);
      setQuoteDate(saved.quoteDate);
      setTaxType(saved.taxType);
      setSalesAgent(saved.salesAgent);
      setSalesAgentUserId(saved.salesAgentUserId);
      setAdjustmentLabel(saved.adjustmentLabel);
      setAdjustmentAmount(saved.adjustmentAmount);
      setTerms(saved.terms);
      setRemarks(saved.remarks);
      if (saved.lines.length) setLines(saved.lines as LineDraft[]);
      setSaveState("recovered");
      setLastSavedAt(saved.savedAt);
      toast.info("Recovered your unfinished quotation draft.");
    }
    recoveredRef.current = true;
  }, [localDraftKey]);

  useEffect(() => {
    if (!recoveredRef.current || busy) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveQuoteDraft(localDraftKey, buildDraft());
      void saveServerDraft().catch((error) => { setSaveState(navigator.onLine ? "sync-error" : "offline"); if (navigator.onLine) toast.error(`Draft sync failed: ${(error as Error).message}`); });
    }, 750);
    return () => window.clearTimeout(timer);
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
    noChargeReason,
    lines,
    customerContact,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busy) {
        setSaveState("saving");
        saveQuoteDraft(localDraftKey, buildDraft());
        void saveServerDraft().then(async () => { await serverDrafts.refetch(); toast.info("Draft saved on this device and server"); }).catch((error) => { setSaveState(navigator.onLine ? "sync-error" : "offline"); toast.info(navigator.onLine ? `Could not sync draft: ${(error as Error).message}. Your entries are still saved on this device.` : "Offline: draft saved on this device"); });
      }
    }, 30_000);
    const saveBeforeLeave = () => {
      if (!busy) saveQuoteDraft(localDraftKey, buildDraft());
    };
    window.addEventListener("pagehide", saveBeforeLeave);
    window.addEventListener("beforeunload", saveBeforeLeave);
    return () => { saveBeforeLeave(); window.clearInterval(timer); window.removeEventListener("pagehide", saveBeforeLeave); window.removeEventListener("beforeunload", saveBeforeLeave); };
    // The field-change effect handles immediate local recovery; this timer provides the explicit 30-second checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDraftKey, busy, customerId, projectName, quoteDate, taxType, salesAgent, salesAgentUserId, adjustmentLabel, adjustmentAmount, terms, remarks, lines, customerContact]);

  useEffect(() => {
    const onOffline = () => setSaveState("offline");
    const onOnline = () => {
      setSaveState("saved-local");
      void saveServerDraft().catch((error) => { setSaveState("sync-error"); toast.error(`Draft sync failed: ${(error as Error).message}`); });
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); };
  }, []);

  useEffect(() => {
    const tick = () => setSecondsUntilSave(Math.max(0, 30 - Math.floor((Date.now() - (lastSavedAt ?? Date.now())) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lastSavedAt]);

  function buildDraft(): Omit<QuoteDraftState, "savedAt"> {
    return {
      customerId,
      customerContactId: customerContact?.id ?? null,
      customerContactName: customerContact?.contact_name ?? null,
      customerContactPhone: customerContact?.phone ?? null,
      customerContactEmail: customerContact?.email ?? null,
      serverDraftId: serverDraftIdRef.current,
      projectName,
      quoteDate,
      taxType,
      salesAgent,
      salesAgentUserId,
      adjustmentLabel,
      adjustmentAmount,
      terms,
    remarks,
    noChargeReason,
    lines: lines.map(({ reference_file, reference_preview_url, ...line }) => line),
    };
  }

  async function saveServerDraft() {
    if (serverSaveInFlightRef.current) {
      serverSavePendingRef.current = true;
      return;
    }
    serverSaveInFlightRef.current = true;
    try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Sign in to sync this draft.");
    const draft = buildDraft();
    const row = { id: serverDraftIdRef.current, user_id: auth.user.id, workflow: "quotation", payload: draft as unknown as Json, customer_id: draft.customerId, project_name: draft.projectName || null, version: serverDraftVersionRef.current, deleted_at: null };
    if (serverDraftVersionRef.current === 1) {
      const { error } = await supabase.from("workflow_drafts").upsert(row);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("workflow_drafts").update({ payload: draft as unknown as Json, customer_id: draft.customerId, project_name: draft.projectName || null, version: serverDraftVersionRef.current + 1, updated_at: new Date().toISOString() }).eq("id", serverDraftIdRef.current).eq("version", serverDraftVersionRef.current).select("id").maybeSingle();
      if (error) throw error;
      if (!data) {
        const latest = await supabase.from("workflow_drafts").select("version").eq("id", serverDraftIdRef.current).maybeSingle();
        if (latest.error || !latest.data) throw new Error("This draft changed in another tab. Choose which copy to keep.");
        serverDraftVersionRef.current = latest.data.version;
        const retry = await supabase.from("workflow_drafts").update({ payload: draft as unknown as Json, customer_id: draft.customerId, project_name: draft.projectName || null, version: latest.data.version + 1, updated_at: new Date().toISOString() }).eq("id", serverDraftIdRef.current).select("id").maybeSingle();
        if (retry.error || !retry.data) throw new Error("This draft changed again. Please retry once.");
      }
    }
    serverDraftVersionRef.current += 1;
    setSaveState("saved-server");
    setLastSavedAt(Date.now());
    } finally {
      serverSaveInFlightRef.current = false;
      if (serverSavePendingRef.current) {
        serverSavePendingRef.current = false;
        void saveServerDraft().catch((error) => { setSaveState("sync-error"); toast.error(`Draft sync failed: ${(error as Error).message}`); });
      }
    }
  }

  async function save(submitForApproval: boolean) {
    if (!canWrite) return toast.error("You do not have permission to perform this action.");
    if (!customerId) return toast.error("Pick a customer");
    if (!projectName.trim()) return toast.error("Project name required");
    if (!salesAgentUserId) return toast.error("Choose a saved sales agent");
    if (lines.length === 0) return toast.error("Add at least one line");
    if (quoteTotal <= 0 && !isNoCharge) return toast.error("Choose ‘No-charge quote’ if this quote is intentionally ₱0.00.");
    if (quoteTotal <= 0 && !noChargeReason.trim()) return toast.error("Add a reason for this no-charge quote.");
    if (quoteTotal <= 0 && submitForApproval) return toast.error("No-charge quotes can be saved as drafts, but cannot be submitted for approval.");
    for (const l of lines) {
      if (l.is_blank) continue;
      if (!l.description.trim()) return toast.error("Each line needs a description");
      if (Number(l.quantity) <= 0) return toast.error("Quantity must be > 0");
      if (
        l.pricing_basis !== "per_sheet" &&
        l.pricing_mode === "sqft" &&
        (Number(l.width) <= 0 || Number(l.height) <= 0 || (Number(l.rate_per_sqft) <= 0 && !l.no_charge))
      ) {
        return toast.error("Sq ft lines need width, height, and rate");
      }
      if (l.pricing_basis !== "per_sheet" && l.pricing_mode === "fixed" && Number(l.unit_price) <= 0 && !l.no_charge)
        return toast.error("Fixed lines need a unit price");
      if (computed(l).line_total <= 0 && !l.no_charge) return toast.error("Line total must be greater than zero");
    }

    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const quoteInsert = {
          customer_id: customerId,
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
          remarks: remarks || null,
          adjustment_label: adjustmentLabel.trim() || "Adjustment",
          adjustment_amount: adjustment,
          status: "draft",
          is_no_charge: isNoCharge,
          no_charge_reason: isNoCharge ? noChargeReason.trim() : null,
          sent_at: null,
          created_by: user?.id,
        } as any;
      const { data: quote, error } = await supabase
        .from("quotations")
        .insert(quoteInsert)
        .select()
        .single();
      if (error) throw error;

      const payload = lines.map((l, idx) => {
        const c = computed(l);
        return {
          item_template_id: l.template_id || null,
          description: l.is_blank ? "[BLANK_LINE]" : l.description.trim(),
          pricing_mode: l.pricing_mode,
          unit_of_measure: l.pricing_mode === "sqft" && l.pricing_basis !== "per_sheet" ? l.unit_of_measure : null,
          width: l.pricing_mode === "sqft" && l.pricing_basis !== "per_sheet" ? Number(l.width) : null,
          height: l.pricing_mode === "sqft" && l.pricing_basis !== "per_sheet" ? Number(l.height) : null,
          rate_per_sqft: l.pricing_mode === "sqft" && l.pricing_basis !== "per_sheet" ? Number(l.rate_per_sqft) : null,
          quantity: Number(l.quantity),
          computed_sqft: l.pricing_mode === "sqft" ? c.computed_sqft : null,
          unit_price: c.unit_price,
          line_total: c.line_total,
          pricing_basis: "manual",
          pages_per_copy: null,
          sheets_per_copy: null,
          sheet_waste_percent: 0,
          estimated_sheets: null,
          applied_sheet_price: null,
          sheet_pricing_profile_id: null,
          applied_sheet_tier_min: null,
          no_charge: l.no_charge === true,
          is_blank: l.is_blank === true,
          adjustment_label: l.adjustment_label.trim() || "Adjustment",
          adjustment_amount: Number(l.adjustment_amount || 0),
          sort_order: idx,
        };
      });
      const { data: savedLines, error: liErr } = (await supabase.rpc(
        "replace_quote_lines_and_snapshot" as never,
        { p_quotation_id: quote.id, p_lines: payload } as never,
      )) as { data: Array<{ sort_order?: number; id: string }> | null; error: Error | null };
      if (liErr) throw liErr;

      const savedIdsByOrder = new Map(
        (savedLines ?? []).map((line) => [line.sort_order ?? 0, line.id]),
      );
      const imageUploads = lines.flatMap((line, idx) => {
        const lineId = savedIdsByOrder.get(idx);
        if (!line.reference_file || !lineId) return [];
        return [
          uploadQuoteReferenceImage({
            quotationId: quote.id,
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

      if (submitForApproval) {
        const { error: sendErr } = await supabase
          .from("quotations")
          .update({
            status: "pending_manager_approval",
            sent_at: new Date().toISOString(),
          })
          .eq("id", quote.id);
        if (sendErr) throw sendErr;
      }

      await logAudit("quotation.created", "quotation", quote.id, {
        quote_number: quote.quote_number,
      });
      if (submitForApproval) {
        await logAudit("quotation.sent", "quotation", quote.id);
      }
      clearQuoteDraft(localDraftKey);
      await supabase.from("workflow_drafts").update({ committed_record_id: quote.id, deleted_at: new Date().toISOString() }).eq("id", serverDraftIdRef.current);
      toast.success(`Quote ${quote.quote_number} created`);
      nav({
        to: submitForApproval ? "/quotes/$id" : "/quotes/$id/edit",
        params: { id: quote.id },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">New quote</h1>
        <p className="text-muted-foreground mt-1">
          Customer details, tax mode, sales terms, and line pricing for this quotation.
        </p>
        <QuoteSaveState state={saveState} savedAt={lastSavedAt} secondsUntilSave={secondsUntilSave} onRetry={() => void saveServerDraft().catch((error) => { toast.error((error as Error).message); setSaveState("sync-error"); })} />
      </div>

      {!canWrite ? (
        <Alert>
          <AlertTitle>You do not have permission to perform this action.</AlertTitle>
          <AlertDescription>
            Viewer access can review quotations but cannot create or edit them.
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite && serverDrafts.data?.length ? (
        <Card className="space-y-3 rounded-xl border-primary/10 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Continue saved progress</h2>
              <p className="mt-1 text-sm text-muted-foreground">These are unfinished drafts, not quotations. Reference images must be uploaded again on this device.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" onClick={startNewQuote}>Start new quote</Button>
              <Button type="button" variant="outline" onClick={() => setDraftListOpen((open) => !open)}>{draftListOpen ? "Hide" : "Show"}</Button>
            </div>
          </div>
          {draftListOpen ? <div className="space-y-2">
            {serverDrafts.data.length === 5 ? <p className="text-xs text-muted-foreground">Showing the 5 newest drafts.</p> : null}
            {serverDrafts.data.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{draft.project_name || "Untitled quote"}</p>
                  <p className="text-sm text-muted-foreground">{draft.customer_id ? "Customer selected" : "Customer not selected"} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updated_at))}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => continueServerDraft(draft)}>Continue</Button>
                  <Button type="button" variant="outline" onClick={() => setDraftToDelete(draft)}>Delete</Button>
                </div>
              </div>
            ))}
          </div> : null}
        </Card>
      ) : null}

      <AlertDialog open={!!draftToDelete} onOpenChange={(open) => { if (!open) setDraftToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete unfinished draft?</AlertDialogTitle>
            <AlertDialogDescription>
              “{draftToDelete?.project_name || "Untitled quote"}” will be removed from your saved progress. This does not delete a quotation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteDraft()}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              onChange={(id) => {
                setCustomerId(id);
                setCustomerContact(null);
              }}
              disabled={!canWrite}
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
              disabled={!canWrite}
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
              onChange={(e) => setQuoteDate(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-2">
            <Label>VAT mode</Label>
            <Select
              value={taxType}
              onValueChange={(value) => setTaxType(value as "vatable" | "non_vat")}
              disabled={!canWrite}
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
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Storefront tarpaulin"
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-2">
            <Label>Sales Agent</Label>
            <SalesAgentPicker
              value={salesAgent}
              userId={salesAgentUserId}
              disabled={!canWrite}
              onChange={(name, nextUserId) => {
                setSalesAgent(name);
                setSalesAgentUserId(nextUserId);
              }}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <TermsField value={terms} onChange={setTerms} disabled={!canWrite} />
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
                    disabled={!canWrite}
                  >
                    Remove remarks
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRemarks(true)}
                disabled={!canWrite}
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
            disabled={!canWrite}
          >
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>
        <div className="space-y-1">
          {lines.map((l, i) => {
            const c = computed(l);
            return (
              <div key={i} className="min-w-0 space-y-1 border-b pb-2 last:border-b-0 sm:pb-3">
                {expandedLineIndex !== i ? (
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
                    onClick={() => setExpandedLineIndex(i)}
                    aria-label={`Edit line ${i + 1}: ${l.description.trim() || "Untitled item"}`}
                  >
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {i + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate font-medium"
                      title={l.description.trim() || "Untitled item"}
                    >
                      {l.description.trim() || "Untitled item"}
                    </span>
                    <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
                      {l.quantity} {l.pricing_mode === "sqft" ? l.unit_of_measure : "unit"}
                    </span>
                    {l.show_adjustment ? (
                      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                        Adjusted
                      </span>
                    ) : null}
                    <span className="shrink-0 font-medium tabular-nums">{peso(c.line_total)}</span>
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
                        title={l.description || "Untitled item"}
                      >
                        {l.description.trim() || "Untitled item"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveLine(i, -1)} disabled={!canWrite || i === 0}>↑</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveLine(i, 1)} disabled={!canWrite || i === lines.length - 1}>↓</Button>
                      <span className="ml-1 text-xs text-muted-foreground">Move line</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 items-start sm:flex-row">
                    <div className="min-w-0 flex-1 space-y-2">
                      <ItemTemplatePicker
                        value={l.template_id}
                        disabled={!canWrite}
                        onApply={(template) => applyTemplate(i, template)}
                        onCustom={() => updateLine(i, { template_id: "" })}
                      />
                      <Label className="text-xs">Description *</Label>
                      <Input
                        value={l.description}
                        disabled={!canWrite}
                        onChange={(e) =>
                          updateLine(i, { template_id: "", description: e.target.value })
                        }
                        placeholder="e.g. Tarpaulin banner"
                      />
                    </div>
                    <div className="w-full shrink-0 space-y-2 sm:w-40">
                      <Label className="text-xs">Pricing</Label>
                      <Select
                        value={l.pricing_mode}
                        onValueChange={(v) =>
                          updateLine(i, { template_id: "", pricing_mode: v as "sqft" | "fixed" })
                        }
                        disabled={!canWrite}
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
                    {lines.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mt-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(i)}
                        disabled={!canWrite}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {l.pricing_basis === "per_sheet" ? (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                      <div className="mb-3">
                        <p className="text-sm font-medium">Production quantity</p>
                        <p className="text-xs text-muted-foreground">Enter finished copies. We calculate the sheets for you.</p>
                      </div>
                      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="space-y-2"><Label className="text-xs">Finished copies</Label><Input type="number" min="1" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></div>
                        <div className="space-y-2"><Label className="text-xs">Pages per copy</Label><Input type="number" min="1" value={l.pages_per_copy} placeholder="24" onChange={(e) => updateLine(i, { pages_per_copy: e.target.value })} /></div>
                        <div className="space-y-2"><Label className="text-xs">Sheets per copy</Label><Input type="number" min="0.01" step="0.01" value={l.sheets_per_copy} placeholder="12" onChange={(e) => updateLine(i, { sheets_per_copy: e.target.value })} /></div>
                        <div className="space-y-2"><Label className="text-xs">Price per sheet</Label><Input type="number" min="0" step="0.01" value={l.sheet_price} placeholder="Set price" onChange={(e) => updateLine(i, { sheet_price: e.target.value })} /></div>
                      </div>
                      {Number(l.quantity) > 0 && Number(l.sheets_per_copy) > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-primary">
                          <span>{(c as any).sheet?.estimatedSheets?.toLocaleString() ?? "0"} estimated sheets</span>
                          <span>{formatSheetTier((c as any).sheet?.tier)}</span>
                          <span>{peso((c as ReturnType<typeof computed>).unit_price)} per copy</span>
                        </div>
                      ) : <p className="mt-3 text-xs text-muted-foreground">Add sheets per copy and price per sheet to calculate this line.</p>}
                    </div>
                  ) : l.pricing_mode === "sqft" ? (
                    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Unit</Label>
                        <Select
                          value={l.unit_of_measure}
                          onValueChange={(v) =>
                            updateLine(i, { template_id: "", unit_of_measure: v as Uom })
                          }
                          disabled={!canWrite}
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
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Width</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.width}
                          placeholder="0.00"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", width: e.target.value })
                          }
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Height</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.height}
                          placeholder="0.00"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", height: e.target.value })
                          }
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs text-muted-foreground">Depth <span className="font-normal">(optional)</span></Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.depth ?? ""}
                          placeholder="Optional"
                          disabled={!canWrite}
                          onChange={(e) => updateLine(i, { template_id: "", depth: e.target.value })}
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Rate / sq ft</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.rate_per_sqft}
                          placeholder="0.00"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", rate_per_sqft: e.target.value })
                          }
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.quantity}
                          placeholder="0"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", quantity: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-w-0 grid-cols-2 gap-3">
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.quantity}
                          placeholder="0"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", quantity: e.target.value })
                          }
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label className="text-xs">Unit price</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.unit_price}
                          placeholder="0.00"
                          disabled={!canWrite}
                          onChange={(e) =>
                            updateLine(i, { template_id: "", unit_price: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  )}

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={l.is_blank === true} onChange={(event) => updateLine(i, { template_id: "", is_blank: event.target.checked })} disabled={!canWrite} /><span>Blank line (hide from print)</span></label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={l.no_charge === true} onChange={(event) => updateLine(i, { template_id: "", no_charge: event.target.checked })} disabled={!canWrite} />
                      <span>No charge for this item</span>
                    </label>
                    {l.show_adjustment ? (
                      <div className="mt-4 grid gap-3 border-t border-primary/25 pt-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-xs">Item adjustment</Label>
                          <Input
                            value={l.adjustment_label}
                            disabled={!canWrite}
                            onChange={(e) => updateLine(i, { adjustment_label: e.target.value })}
                            placeholder="Discount"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Amount (+ extra / - discount)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={l.adjustment_amount}
                            disabled={!canWrite}
                            onChange={(e) => updateLine(i, { adjustment_amount: e.target.value })}
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
                            disabled={!canWrite}
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
                        disabled={!canWrite}
                      >
                        <Plus className="h-4 w-4" /> Adjust this item
                      </Button>
                    )}

                    <LineReferenceImagePicker
                      fileName={l.reference_file?.name ?? null}
                      previewUrl={l.reference_preview_url ?? null}
                      disabled={!canWrite}
                      onPick={(file) => setLineReferenceImage(i, file)}
                      onRemove={() => {
                        if (l.reference_preview_url) URL.revokeObjectURL(l.reference_preview_url);
                        updateLine(i, { reference_file: null, reference_preview_url: null });
                      }}
                    />
                  </div>

                  <div className="flex justify-between text-sm pt-2 border-t">
                    <span className="text-muted-foreground">
                      {l.pricing_mode === "sqft" && c.computed_sqft != null
                        ? `${c.computed_sqft.toFixed(2)} sq ft · ${peso(c.unit_price)} unit`
                        : `${peso(c.unit_price)} unit`}
                      {Number(l.adjustment_amount || 0) !== 0 ? (
                        <span className="ml-2">
                          {l.adjustment_label.trim() || "Adjustment"}:{" "}
                          {peso(Number(l.adjustment_amount || 0))}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-medium tabular-nums">{peso(c.line_total)}</span>
                  </div>
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
                    disabled={!canWrite}
                  >
                    Remove adjustment
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]">
                  <div className="space-y-2">
                    <Label>Adjustment label</Label>
                    <Input
                      value={adjustmentLabel}
                      onChange={(e) => setAdjustmentLabel(e.target.value)}
                      placeholder="Discount"
                      disabled={!canWrite}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={!canWrite}
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
                disabled={!canWrite}
              >
                <Plus className="h-4 w-4" /> Add discount / round-off
              </Button>
            )}
        </div>
      </Card>

        </div>
        <div ref={summarySlotRef} className="min-w-0 self-start" style={summaryPinned ? { minHeight: 1 } : undefined}>
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
            {isNoCharge ? (
              <div className="space-y-1">
                <Label htmlFor="no-charge-reason">Reason required</Label>
                <Input id="no-charge-reason" value={noChargeReason} onChange={(event) => setNoChargeReason(event.target.value)} placeholder="e.g. Sample or warranty" disabled={!canWrite} />
              </div>
            ) : null}
          </div>
          <div className="mt-4 space-y-2">
            <Button className="h-10 w-full" onClick={() => save(true)} disabled={busy || !canWrite}>
              <Save className="h-4 w-4" />
              {busy ? "Saving..." : "Submit for approval"}
            </Button>
            <Button
              className="h-10 w-full"
              variant="outline"
              onClick={() => save(false)}
              disabled={busy || !canWrite}
            >
              Save draft & add images
            </Button>
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ children }: { children: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
      {children}
    </span>
  );
}

function QuoteSaveState({ state, savedAt, secondsUntilSave, onRetry }: { state: "idle" | "saving" | "saved-local" | "saved-server" | "recovered" | "offline" | "sync-error"; savedAt: number | null; secondsUntilSave: number; onRetry?: () => void }) {
  if (state === "idle") return null;
  const time = savedAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(savedAt) : "now";
  const label = state === "saving" ? `Saving… · next checkpoint in ${secondsUntilSave}s` : state === "recovered" ? `Recovered draft · saved ${time} · next save in ${secondsUntilSave}s` : state === "offline" ? `Offline · saved on this device; server sync pending` : state === "sync-error" ? "Could not sync · Retry" : state === "saved-server" ? `Saved on this device and server · ${time} · next save in ${secondsUntilSave}s` : `Saved on this device · ${time} · next save in ${secondsUntilSave}s`;
  return state === "sync-error" ? <button type="button" className="mt-2 inline-flex rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onRetry} role="status">{label}</button> : <span className="mt-2 inline-flex rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground" role="status">{label}</span>;
}

interface ServerQuoteDraft {
  id: string;
  payload: QuoteDraftState;
  project_name: string | null;
  customer_id: string | null;
  updated_at: string;
  version: number;
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
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type custom terms"
          disabled={disabled}
        />
      ) : null}
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
