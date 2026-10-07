import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "./PageHeader";

export function AccessDenied({
  title = "Limited read-only access",
  description = "Your role does not have permission to view this workspace area.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>You do not have permission to view this page.</AlertTitle>
        <AlertDescription>
          Ask an owner or admin if your workflow requires access here.
        </AlertDescription>
      </Alert>
    </div>
  );
}
