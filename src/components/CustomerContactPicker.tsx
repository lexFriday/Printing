import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { canSalesWork } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatPhoneInput, normalizePhone } from "@/lib/phone";

export type CustomerContact = {
  id: string;
  contact_name: string;
  department: string | null;
  phone: string | null;
  email: string | null;
};

type ContactDraft = { contact_name: string; phone: string; email: string };

export function CustomerContactPicker({
  customerId,
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  customerId: string | null;
  value: string | null;
  onChange: (contact: CustomerContact | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [contactDrafts, setContactDrafts] = useState<ContactDraft[]>([]);
  const [quotePhone, setQuotePhone] = useState("");
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const canWrite = canSalesWork(role);

  const contacts = useQuery({
    queryKey: ["customer-contacts", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_contacts")
        .select("id, contact_name, department, phone, email")
        .eq("customer_id", customerId!)
        .eq("is_active", true)
        .order("contact_name");
      if (error) throw error;
      return (data ?? []) as CustomerContact[];
    },
  });
  const selectedContact = contacts.data?.find((contact) => contact.id === value) ?? null;

  useEffect(() => {
    if (contactDrafts.length > 0) nameInputRef.current?.focus();
  }, [contactDrafts.length]);

  useEffect(() => {
    setQuotePhone(selectedContact?.phone ?? "");
  }, [selectedContact?.id, selectedContact?.phone]);

  function beginAddContact() {
    if (!customerId) return;
    setContactDrafts((drafts) => [...drafts, { contact_name: "", phone: "", email: "" }]);
  }

  async function saveContact(index: number) {
    const draft = contactDrafts[index];
    if (!customerId || !draft?.contact_name.trim()) {
      return toast.error("Contact name is required");
    }
    if (!draft.phone.trim() && !draft.email.trim()) {
      return toast.error("Add a phone number or email address");
    }
    if (!canWrite) return toast.error("You do not have permission to add contacts");
    const { data, error } = await supabase
      .from("customer_contacts")
      .insert({
        customer_id: customerId,
        contact_name: draft.contact_name.trim(),
        phone: normalizePhone(draft.phone) || null,
        email: draft.email.trim() || null,
        created_by: user?.id ?? null,
      })
      .select("id, contact_name, department, phone, email")
      .single();
    if (error) return toast.error(error.message);
    const contact = data as CustomerContact;
    await qc.invalidateQueries({ queryKey: ["customer-contacts", customerId] });
    onChange(contact);
    await logAudit("customer_contact.created", "customer_contact", contact.id, {
      customer_id: customerId,
      contact_name: contact.contact_name,
    });
    setContactDrafts((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index));
    toast.success("Contact added");
  }

  async function savePhoneToCustomer() {
    if (!customerId || !selectedContact || !canWrite) {
      return toast.error("You do not have permission to update contacts");
    }

    setIsSavingPhone(true);
    const { data, error } = await supabase
      .from("customer_contacts")
      .update({ phone: normalizePhone(quotePhone) || null, updated_at: new Date().toISOString() })
      .eq("id", selectedContact.id)
      .eq("customer_id", customerId)
      .select("id, contact_name, department, phone, email")
      .single();
    setIsSavingPhone(false);

    if (error) return toast.error(error.message);
    const updatedContact = data as CustomerContact;
    await qc.invalidateQueries({ queryKey: ["customer-contacts", customerId] });
    setQuotePhone(updatedContact.phone ?? "");
    onChange(updatedContact);
    await logAudit("customer_contact.updated", "customer_contact", updatedContact.id, {
      customer_id: customerId,
      changed_fields: ["phone"],
    });
    toast.success("Contact phone saved");
  }

  function updateDraft(index: number, field: keyof ContactDraft, value: string) {
    setContactDrafts((drafts) =>
      drafts.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [field]: value } : draft,
      ),
    );
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className={compact ? "flex h-5 items-center justify-between gap-3 leading-5" : "flex items-center justify-between gap-3"}>
        <Label htmlFor="customer-contact">Primary contact</Label>
        {canWrite && !disabled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!customerId}
            onClick={beginAddContact}
          >
            {contactDrafts.length > 0 ? "+ Add another contact" : "+ Add contact"}
          </Button>
        ) : null}
      </div>
      <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
        <div className="space-y-1">
          {!compact ? <Label htmlFor="customer-contact">Contact name</Label> : null}
          <select
            id="customer-contact"
            value={value ?? ""}
            disabled={!customerId || disabled}
            onChange={(event) => {
              const contact = contacts.data?.find((item) => item.id === event.target.value) ?? null;
              setQuotePhone(contact?.phone ?? "");
              onChange(contact);
            }}
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Select contact</option>
            {(contacts.data ?? []).map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.contact_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          {!compact ? <Label htmlFor="customer-contact-phone">Phone number</Label> : null}
          <Input
            id="customer-contact-phone"
            value={quotePhone}
            disabled={!selectedContact || disabled}
            placeholder={selectedContact ? "Phone number" : "Select a contact first"}
            onChange={(event) => {
              if (!selectedContact) return;
              const nextPhone = formatPhoneInput(event.target.value);
              setQuotePhone(nextPhone);
              onChange({ ...selectedContact, phone: nextPhone });
            }}
          />
          <div
            aria-hidden={!(selectedContact && !selectedContact.phone)}
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
              selectedContact && !selectedContact.phone
                ? "mt-2 grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="min-h-0 space-y-1">
              <Label htmlFor="customer-contact-email">Email address</Label>
              <Input
                id="customer-contact-email"
                value={selectedContact?.email ?? ""}
                disabled
                placeholder="No email saved"
              />
              <p className="px-1 text-xs text-muted-foreground">
                No phone number is saved for this contact.
              </p>
            </div>
          </div>
          {selectedContact ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
              {quotePhone.trim() !== (selectedContact.phone ?? "").trim() ? (
                <>
                  <p className="text-muted-foreground">
                    This changes the saved number for this company contact.
                  </p>
                  {canWrite && !disabled ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={isSavingPhone}
                      onClick={savePhoneToCustomer}
                    >
                      {isSavingPhone ? "Saving..." : "Save to customer"}
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Saved contact number.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {!customerId ? (
        <p className="text-xs text-muted-foreground">Select a company first.</p>
      ) : null}
      {contactDrafts.map((draft, index) => (
        <div
          key={index}
          className="animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
        >
          <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-2 sm:flex-row sm:flex-wrap">
            <Input
              ref={index === contactDrafts.length - 1 ? nameInputRef : undefined}
              className="min-w-0 sm:flex-1"
              placeholder="Contact name *"
              value={draft.contact_name}
              onChange={(event) => updateDraft(index, "contact_name", event.target.value)}
            />
            <Input
              className="min-w-0 sm:flex-1"
              placeholder="Phone number (optional)"
              value={draft.phone}
              onChange={(event) =>
                updateDraft(index, "phone", formatPhoneInput(event.target.value))
              }
            />
            <div className="min-w-0 sm:flex-1">
              <Input
                className="w-full min-w-0"
                type="email"
                placeholder="Email address (optional)"
                value={draft.email}
                onChange={(event) => updateDraft(index, "email", event.target.value)}
              />
            </div>
            <Button className="shrink-0" type="button" onClick={() => saveContact(index)}>
              Save contact
            </Button>
            <Button
              className="shrink-0"
              type="button"
              variant="ghost"
              onClick={() =>
                setContactDrafts((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index))
              }
            >
              Remove
            </Button>
          </div>
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            Phone or email: at least one is required.
          </p>
        </div>
      ))}
    </div>
  );
}
