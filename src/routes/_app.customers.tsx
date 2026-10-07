import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { AccessDenied } from "@/components/system";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { canSalesWork } from "@/lib/roles";
import { formatTin } from "@/lib/customers";
import { formatPhoneInput } from "@/lib/phone";

export const Route = createFileRoute("/_app/customers")({
  component: CustomersLayout,
});

function CustomersLayout() {
  const { role } = useAuth();
  if (canSalesWork(role)) return <Outlet />;
  return (
    <AccessDenied
      title="Limited read-only access"
      description="Customer records are available to sales, owner, and admin staff users."
    />
  );
}

export function CustomerForm({
  onSubmit,
  busy,
  initialValues,
  submitLabel = "Save customer",
}: {
  onSubmit: (v: {
    customer_name: string;
    contact_person: string;
    contact_number: string;
    email?: string;
    tin_number?: string;
    address?: string;
    notes?: string;
    additional_contacts?: Array<{ contact_name: string; phone: string }>;
  }) => void;
  busy?: boolean;
  initialValues?: {
    customer_name: string;
    contact_person: string;
    contact_number: string;
    email?: string | null;
    tin_number?: string | null;
    address?: string | null;
    notes?: string | null;
  };
  submitLabel?: string;
}) {
  const [f, setF] = useState({
    customer_name: initialValues?.customer_name ?? "",
    contact_person: initialValues?.contact_person ?? "",
    contact_number: initialValues?.contact_number ?? "",
    email: initialValues?.email ?? "",
    tin_number: formatTin(initialValues?.tin_number),
    address: initialValues?.address ?? "",
    notes: initialValues?.notes ?? "",
  });
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(initialValues?.email || initialValues?.tin_number || initialValues?.address),
  );
  const [additionalContacts, setAdditionalContacts] = useState<
    Array<{ contact_name: string; phone: string }>
  >([]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...f, additional_contacts: additionalContacts });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Company details
        </p>
        <Label htmlFor="customer-name">Company name *</Label>
        <Input
          id="customer-name"
          required
          value={f.customer_name}
          onChange={(e) => setF({ ...f, customer_name: e.target.value })}
        />
      </div>
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Contacts
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() =>
              setAdditionalContacts((contacts) => [...contacts, { contact_name: "", phone: "" }])
            }
          >
            + Add another contact
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="primary-contact-name">Contact person *</Label>
            <Input
              id="primary-contact-name"
              required
              value={f.contact_person}
              onChange={(e) => setF({ ...f, contact_person: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="primary-contact-phone">Contact number *</Label>
            <Input
              id="primary-contact-phone"
              required
              value={f.contact_number}
              onChange={(e) => setF({ ...f, contact_number: formatPhoneInput(e.target.value) })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="primary-contact-email">Email <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input
              id="primary-contact-email"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </div>
        </div>
        {additionalContacts.length > 0 ? (
          <div className="max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {additionalContacts.map((contact, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-2 sm:flex-row sm:items-start"
              >
                <Input
                  className="min-w-0 sm:flex-1"
                  required
                  placeholder="Contact name"
                  value={contact.contact_name}
                  onChange={(event) =>
                    setAdditionalContacts((contacts) =>
                      contacts.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, contact_name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  className="min-w-0 sm:flex-1"
                  placeholder="Phone number"
                  value={contact.phone}
                  onChange={(event) =>
                    setAdditionalContacts((contacts) =>
                      contacts.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, phone: formatPhoneInput(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={`Remove additional contact ${index + 1}`}
                  onClick={() =>
                    setAdditionalContacts((contacts) =>
                      contacts.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-1 py-0 text-xs"
          onClick={() => setShowAdvanced((visible) => !visible)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced
            ? "Hide optional details"
            : "+ Show optional details: TIN and address"}
        </Button>
        {showAdvanced ? (
          <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="space-y-2">
              <Label htmlFor="customer-tin">TIN number (optional)</Label>
              <Input
                id="customer-tin"
                value={f.tin_number}
                onChange={(e) => setF({ ...f, tin_number: formatTin(e.target.value) })}
                placeholder="e.g. 123-456-789-000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-address">Address (optional)</Label>
              <Textarea
                id="customer-address"
                rows={2}
                value={f.address}
                onChange={(e) => setF({ ...f, address: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
