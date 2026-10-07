import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Save,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, LoadingRow, PageHeader } from "@/components/system";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/roles";
import {
  normalizeSignatureImage,
  removeUserSignature,
  signedSignatureUrl,
  uploadUserSignature,
} from "@/lib/signatureStorage";
import { signatureFileError } from "@/lib/signatureRules";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings/users")({
  head: () => ({ meta: [{ title: "Users — AutoMate PH" }] }),
  component: UsersPage,
});

type UserRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  signature_url: string | null;
  signature_preview_url: string | null;
  status: "active" | "inactive";
  created_at: string;
  role: AppRole | null;
};

type SignatureDraft = {
  user: UserRow;
  file: File;
  previewUrl: string;
};

const signatureTypes = ["image/png", "image/jpeg", "image/webp"];

function UsersPage() {
  const { role, roleLoading, user: authUser } = useAuth();
  const canManage = canManageUsers(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft | null>(null);
  const [removeTarget, setRemoveTarget] = useState<UserRow | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  useEffect(
    () => () => {
      if (signatureDraft) URL.revokeObjectURL(signatureDraft.previewUrl);
    },
    [signatureDraft],
  );

  const users = useQuery({
    queryKey: ["settings-users", search],
    enabled: Boolean(authUser?.id),
    queryFn: async () => {
      let profiles = supabase
        .from("profiles")
        .select("id, display_name, email, signature_url, status, created_at")
        .order("created_at", { ascending: false });
      if (canManage && search) profiles = profiles.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
      if (!canManage && authUser?.id) profiles = profiles.eq("id", authUser.id);
      const [{ data: profileRows, error: profileError }, roleResult] = await Promise.all([
        profiles,
        canManage ? supabase.from("user_roles").select("user_id, role") : Promise.resolve({ data: [], error: null }),
      ]);
      const { data: roleRows, error: roleError } = roleResult;
      if (profileError) throw profileError;
      if (roleError) throw roleError;
      const roleByUser = new Map((roleRows ?? []).map((r) => [r.user_id, r.role]));
      return Promise.all(
        (profileRows ?? []).map(async (p) => ({
          ...p,
          signature_preview_url: await signedSignatureUrl(p.signature_url),
          role: roleByUser.get(p.id) ?? null,
        })),
      ) as Promise<UserRow[]>;
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, nextRole }: { userId: string; nextRole: AppRole }) => {
      const current = users.data?.find((u) => u.id === userId);
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: nextRole }, { onConflict: "user_id" });
      if (error) throw error;
      await logAudit(
        "user.role_updated",
        "user",
        userId,
        { role: nextRole },
        { role: current?.role },
      );
    },
    onSuccess: () => {
      toast.success("User role updated");
      qc.invalidateQueries({ queryKey: ["settings-users"] });
      qc.invalidateQueries({ queryKey: ["pending-user-count"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "active" | "inactive" }) => {
      const current = users.data?.find((u) => u.id === userId);
      const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
      if (error) throw error;
      await logAudit(
        "user.status_updated",
        "user",
        userId,
        { status },
        { status: current?.status },
      );
    },
    onSuccess: () => {
      toast.success("User status updated");
      qc.invalidateQueries({ queryKey: ["settings-users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateName = useMutation({
    mutationFn: async ({ userId, displayName }: { userId: string; displayName: string }) => {
      const name = displayName.trim();
      if (!name) throw new Error("Name is required");
      const result = userId === authUser?.id
        ? await supabase.rpc("update_own_display_name", { p_display_name: name })
        : await supabase.from("profiles").update({ display_name: name }).eq("id", userId);
      const { error } = result;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name updated");
      qc.invalidateQueries({ queryKey: ["settings-users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateSignature = useMutation({
    mutationFn: async (change: { userId: string; file?: File }) => {
      if (change.file) return uploadUserSignature(change.userId, change.file);
      return removeUserSignature(change.userId);
    },
    onSuccess: async () => {
      toast.success("Signature updated. Finalized documents remain unchanged.");
      setSignatureDraft(null);
      setRemoveTarget(null);
      await qc.invalidateQueries({ queryKey: ["settings-users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function prepareSignature(user: UserRow, file: File | undefined) {
    if (!file) return;
    const validationError = signatureFileError(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      const normalizedFile = await normalizeSignatureImage(file);
      setSignatureDraft({
        user,
        file: normalizedFile,
        previewUrl: URL.createObjectURL(normalizedFile),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare signature");
    }
  }

  if (roleLoading) {
    return (
      <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
        <PageHeader title="Users" description="Manage staff access and roles." />
        <Card className="p-4">
          <Table className="table-fixed">
            <TableBody>
              <LoadingRow colSpan={6} />
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title={canManage ? "Users" : "My signature"}
        description={canManage ? "Manage who can run operational work in AutoMate IT Solutions." : "Upload your signature for future quotations and job orders."}
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            {canManage ? "Owner only" : "Personal settings"}
          </div>
        }
      />

      <Card className="min-w-0 max-w-full overflow-hidden p-4">
          <div className={canManage ? "mb-4 max-w-sm" : "mb-4 max-w-xl"}>
          <Input
            placeholder={canManage ? "Search by name or email…" : "Your account"}
            disabled={!canManage}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Signatures: PNG, JPG, or WEBP up to 512 KB. Images are trimmed before confirmation.
          </p>
        </div>
        <div className="min-w-0 max-h-[calc(100dvh-16rem)] max-w-full overscroll-contain overflow-y-auto [&>div]:overflow-x-hidden">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[14%]">Name</TableHead>
                <TableHead className="w-[20%]">Email</TableHead>
                <TableHead className="w-[28%]">Signature</TableHead>
                <TableHead className="w-[15%]">Role</TableHead>
                <TableHead className="w-[15%]">Status</TableHead>
                <TableHead className="w-[8%] text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isLoading ? (
                <LoadingRow colSpan={6} />
              ) : (users.data ?? []).length === 0 ? (
                <EmptyState colSpan={6} icon={Users}>
                  No users found
                </EmptyState>
              ) : (
                users.data!.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="min-w-0 font-medium">
                      {(canManage || user.id === authUser?.id) ? <div className="flex items-center gap-1">
                        <Input
                          className="h-9 min-w-0"
                          value={nameDrafts[user.id] ?? user.display_name ?? ""}
                          onChange={(event) => setNameDrafts((current) => ({ ...current, [user.id]: event.target.value }))}
                        />
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={updateName.isPending} onClick={() => updateName.mutate({ userId: user.id, displayName: nameDrafts[user.id] ?? user.display_name ?? "" })} aria-label={`Save name for ${user.email ?? "user"}`}>
                          <Save className="h-4 w-4" />
                        </Button>
                      </div> : (user.display_name ?? "Unnamed user")}
                    </TableCell>
                    <TableCell
                      className="min-w-0 truncate text-muted-foreground"
                      title={user.email ?? "—"}
                    >
                      {user.email ?? "—"}
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 overflow-hidden">
                        <div className="flex h-10 w-20 items-center justify-center rounded border bg-muted/20">
                          {user.signature_url ? (
                            <img
                              src={user.signature_preview_url ?? user.signature_url}
                              alt=""
                              className="max-h-8 max-w-[4.5rem] object-contain"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </div>
                        <label className="inline-flex max-w-full">
                          <Input
                            className="sr-only"
                            type="file"
                            accept={signatureTypes.join(",")}
                            disabled={updateSignature.isPending}
                            onChange={(event) => {
                              void prepareSignature(user, event.target.files?.[0]);
                              event.target.value = "";
                            }}
                          />
                          <span className="inline-flex h-9 max-w-full cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
                            <Upload className="h-4 w-4" />
                            {user.signature_url ? "Replace" : "Upload"}
                          </span>
                        </label>
                        {user.signature_url ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveTarget(user)}
                            disabled={updateSignature.isPending}
                            aria-label={`Remove signature for ${user.display_name ?? user.email}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    {canManage ? <TableCell className="min-w-0">
                      <Select
                        value={user.role ?? undefined}
                        onValueChange={(nextRole) =>
                          updateRole.mutate({ userId: user.id, nextRole: nextRole as AppRole })
                        }
                      >
                        <SelectTrigger className="w-full max-w-[140px]">
                          <SelectValue placeholder="Assign role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="admin">Admin Staff</SelectItem>
                          <SelectItem value="sales">Sales</SelectItem>
                          <SelectItem value="accounting">Accounting</SelectItem>
                          <SelectItem value="production">Production</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell> : null}
                    {canManage ? <TableCell className="min-w-0">
                      <Select
                        value={user.status}
                        onValueChange={(status) =>
                          updateStatus.mutate({
                            userId: user.id,
                            status: status as "active" | "inactive",
                          })
                        }
                      >
                        <SelectTrigger className="w-full max-w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell> : null}
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {fmtDate(user.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog
        open={Boolean(signatureDraft)}
        onOpenChange={(open) => {
          if (!open && !updateSignature.isPending) setSignatureDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm signature</DialogTitle>
            <DialogDescription>
              Excess whitespace was trimmed automatically. Check how this will appear on quotations
              and job orders before saving.
            </DialogDescription>
          </DialogHeader>
          {signatureDraft ? (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Document-size preview
                </div>
                <div className="flex h-[72px] w-[220px] max-w-full items-center justify-center rounded border bg-white px-3">
                  <img
                    src={signatureDraft.previewUrl}
                    alt={`Signature preview for ${signatureDraft.user.display_name ?? signatureDraft.user.email ?? "user"}`}
                    className="max-h-[56px] max-w-[196px] object-contain"
                  />
                </div>
              </div>
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>New version</AlertTitle>
                <AlertDescription>
                  Saving affects future documents only. Existing finalized documents keep their
                  original signature.
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updateSignature.isPending}
              onClick={() => setSignatureDraft(null)}
            >
              Choose another image
            </Button>
            <Button
              type="button"
              disabled={!signatureDraft || updateSignature.isPending}
              onClick={() => {
                if (signatureDraft) {
                  updateSignature.mutate({
                    userId: signatureDraft.user.id,
                    file: signatureDraft.file,
                  });
                }
              }}
            >
              {updateSignature.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save signature"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !updateSignature.isPending) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove signature?</AlertDialogTitle>
            <AlertDialogDescription>
              Future quotations and job orders cannot use this signature. Existing finalized
              documents keep their original signature.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateSignature.isPending}>
              Keep signature
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!removeTarget || updateSignature.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removeTarget) updateSignature.mutate({ userId: removeTarget.id });
              }}
            >
              {updateSignature.isPending ? "Removing…" : "Remove signature"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
