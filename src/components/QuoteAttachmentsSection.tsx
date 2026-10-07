import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canDeleteQuoteAttachments, canSalesWork, canViewSensitiveOperations } from "@/lib/roles";

const bucketName = "quote-attachments";
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
const maxFileSize = 10 * 1024 * 1024;

interface QuoteAttachment {
  id: string;
  quotation_id: string;
  quote_line_item_id: string | null;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface AttachmentWithUrl extends QuoteAttachment {
  signedUrl: string | null;
}

export function QuoteAttachmentsSection({
  quotationId,
  quoteLineItemId,
  title = "Reference images",
  description = "Internal quote references only. These images are not included in quotation printouts.",
  compact = false,
  allowUpload = true,
  hideWhenEmpty = false,
}: {
  quotationId: string;
  quoteLineItemId?: string | null;
  title?: string;
  description?: string;
  compact?: boolean;
  allowUpload?: boolean;
  hideWhenEmpty?: boolean;
}) {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const canView = canViewSensitiveOperations(role);
  const canUpload = allowUpload && canSalesWork(role);
  const canDelete = canDeleteQuoteAttachments(role);

  const attachments = useQuery({
    queryKey: ["quote-attachments", quotationId, quoteLineItemId ?? "general"],
    enabled: canView,
    queryFn: async (): Promise<AttachmentWithUrl[]> => {
      let query = supabase
        .from("quote_attachments")
        .select("*")
        .eq("quotation_id", quotationId)
        .is("deleted_at", null);

      query = quoteLineItemId
        ? query.eq("quote_line_item_id", quoteLineItemId)
        : query.is("quote_line_item_id", null);

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      return Promise.all(
        (data as QuoteAttachment[]).map(async (attachment) => {
          const { data: signed } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(attachment.storage_path, 60 * 10);
          return { ...attachment, signedUrl: signed?.signedUrl ?? null };
        }),
      );
    },
  });

  const countLabel = useMemo(() => {
    const count = attachments.data?.length ?? 0;
    return `${count} ${count === 1 ? "image" : "images"}`;
  }, [attachments.data]);

  if (!canView) return null;
  if (hideWhenEmpty && attachments.isLoading) return null;
  if (hideWhenEmpty && !attachments.data?.length) return null;

  async function handleUpload(file: File | undefined) {
    if (!file || !user) return;
    if (!allowedTypes.includes(file.type)) {
      toast.error("Upload JPG, PNG, or WEBP images only.");
      return;
    }
    if (file.size > maxFileSize) {
      toast.error("Image must be 10MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const storagePath = `${quotationId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("quote_attachments").insert({
        quotation_id: quotationId,
        quote_line_item_id: quoteLineItemId ?? null,
        storage_path: storagePath,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: user.id,
      });
      if (insertError) throw insertError;

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["quote-attachments", quotationId] }),
        qc.invalidateQueries({
          queryKey: ["quote-attachments", quotationId, quoteLineItemId ?? "general"],
        }),
      ]);
      toast.success("Reference image uploaded");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function softDeleteAttachment(attachment: QuoteAttachment) {
    try {
      const { error } = await supabase
        .from("quote_attachments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", attachment.id);
      if (error) throw error;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["quote-attachments", quotationId] }),
        qc.invalidateQueries({
          queryKey: ["quote-attachments", quotationId, quoteLineItemId ?? "general"],
        }),
      ]);
      toast.success("Reference image removed");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const uploadControl = canUpload ? (
    <label className="inline-flex">
      <Input
        className="sr-only"
        type="file"
        accept={allowedTypes.join(",")}
        disabled={uploading}
        onChange={(event) => {
          void handleUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <span
        className={
          compact
            ? "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            : "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
        }
      >
        <Upload className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {uploading ? "Uploading..." : compact ? "Add image" : "Upload image"}
      </span>
    </label>
  ) : null;

  if (compact) {
    return (
      <div className="space-y-2 rounded-md border border-dashed bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {title}: {attachments.isLoading ? "Loading..." : countLabel}
            </p>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {uploadControl}
        </div>

        {attachments.data?.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {attachments.data.map((attachment) => (
              <div key={attachment.id} className="rounded-md border bg-muted/20 p-2">
                <div className="aspect-video overflow-hidden rounded border bg-background">
                  {attachment.signedUrl ? (
                    <img
                      src={attachment.signedUrl}
                      alt={attachment.file_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium" title={attachment.file_name}>
                    {attachment.file_name}
                  </p>
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void softDeleteAttachment(attachment)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {uploadControl}
      </div>

      {attachments.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reference images...</p>
      ) : attachments.data?.length ? (
        <div
          className={
            compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {attachments.data.map((attachment) => (
            <div key={attachment.id} className="rounded-md border bg-muted/20 p-3">
              <div className="aspect-video overflow-hidden rounded border bg-background">
                {attachment.signedUrl ? (
                  <img
                    src={attachment.signedUrl}
                    alt={attachment.file_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium" title={attachment.file_name}>
                  {attachment.file_name}
                </p>
                {canDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void softDeleteAttachment(attachment)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No reference images yet. {canUpload ? "Upload JPG, PNG, or WEBP up to 10MB." : countLabel}
        </div>
      )}
    </Card>
  );
}
