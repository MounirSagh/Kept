import { useEffect, useState, type FormEvent } from "react";
import type { AccountDto, ContactDto } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { cx, ui } from "../../ui";

/**
 * Add or edit a person at a client. From a company's page the company is fixed (`accountId`);
 * from the Contacts page you pick it.
 */
export function ContactDialog({
  accountId,
  contact,
  onClose,
  onSaved,
}: {
  accountId?: string;
  contact?: ContactDto;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const pickCompany = !accountId && !contact;
  const [companies, setCompanies] = useState<AccountDto[] | null>(null);
  const [company, setCompany] = useState("");
  const [f, setF] = useState({ fullName: contact?.fullName ?? "", email: contact?.email ?? "", title: contact?.title ?? "", phone: contact?.phone ?? "" });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    if (pickCompany) void api.accounts(orgId).then(setCompanies);
  }, [api, orgId, pickCompany]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const blank = (v: string) => v.trim() || null;
    const input = { fullName: blank(f.fullName), email: blank(f.email), title: blank(f.title), phone: blank(f.phone) };
    void submit(async () => {
      if (contact) await api.updateContact(orgId, contact.id, input);
      else await api.createContact(orgId, accountId ?? company, input);
      await onSaved();
      onClose();
    });
  }

  return (
    <Modal title={contact ? "Edit contact" : "Add contact"} onClose={onClose}>
      <form className="space-y-4" onSubmit={onSubmit}>
        {pickCompany && (
          <Field label="Company" htmlFor="contact-company">
            <select id="contact-company" className={cx(ui.select, "w-full")} value={company} onChange={(e) => setCompany(e.target.value)} required>
              <option value="" disabled>{companies ? "Choose a company" : "Loading…"}</option>
              {companies?.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Full name" htmlFor="contact-name">
          <input id="contact-name" className={cx(ui.input, "w-full")} value={f.fullName} onChange={set("fullName")} maxLength={200} autoFocus={!pickCompany} placeholder="Lina Park" />
        </Field>
        <Field label="Email" htmlFor="contact-email" hint="Their emails and meetings are routed to the company.">
          <input id="contact-email" type="email" className={cx(ui.input, "w-full")} value={f.email} onChange={set("email")} maxLength={320} placeholder="lina@northwind.com" />
        </Field>
        <Field label="Job title" htmlFor="contact-title">
          <input id="contact-title" className={cx(ui.input, "w-full")} value={f.title} onChange={set("title")} maxLength={200} placeholder="IT Lead" />
        </Field>
        <Field label="Phone" htmlFor="contact-phone">
          <input id="contact-phone" type="tel" className={cx(ui.input, "w-full")} value={f.phone} onChange={set("phone")} maxLength={50} />
        </Field>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending || (!f.fullName.trim() && !f.email.trim()) || (pickCompany && !company)}>
            {pending ? "Saving…" : contact ? "Save changes" : "Add contact"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
