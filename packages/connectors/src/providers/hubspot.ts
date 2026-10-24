// HubSpot, connected once per portal: companies, contacts, deals and notes via the CRM
// search API, each followed by its last-modified date.

import { standardToken } from "../oauth.js";
import { clip, date, htmlToText } from "../text.js";
import type { ProviderDefinition, SourceItemInput, SourceKind, Stream } from "../types.js";

interface CrmObject {
  id: string;
  properties: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
}

interface ObjectSpec {
  type: "companies" | "contacts" | "deals" | "notes";
  kind: SourceKind;
  /** Contacts name the property differently from every other object. */
  modifiedProp: string;
  properties: string[];
  title(p: Record<string, string | null>): string;
  text?(p: Record<string, string | null>): string | undefined;
  occurredAt(o: CrmObject): Date;
}

const SPECS: ObjectSpec[] = [
  {
    type: "companies",
    kind: "crm_record",
    modifiedProp: "hs_lastmodifieddate",
    properties: [
      "name", "domain", "industry", "type", "description", "numberofemployees", "annualrevenue",
      "city", "state", "zip", "country", "timezone", "linkedin_company_page", "hubspot_owner_id", "lifecyclestage",
    ],
    title: (p) => p.name ?? p.domain ?? "Company",
    occurredAt: (o) => date(o.createdAt),
  },
  {
    type: "contacts",
    kind: "crm_record",
    modifiedProp: "lastmodifieddate",
    properties: ["firstname", "lastname", "email", "phone", "company", "jobtitle", "hubspot_owner_id", "associatedcompanyid"],
    title: (p) => [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || "Contact",
    occurredAt: (o) => date(o.createdAt),
  },
  {
    type: "deals",
    kind: "deal",
    modifiedProp: "hs_lastmodifieddate",
    properties: ["dealname", "amount", "dealstage", "pipeline", "closedate", "hubspot_owner_id"],
    title: (p) => p.dealname ?? "Deal",
    occurredAt: (o) => date(o.createdAt),
  },
  {
    type: "notes",
    kind: "document",
    modifiedProp: "hs_lastmodifieddate",
    properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id"],
    title: () => "Note",
    text: (p) => (p.hs_note_body ? htmlToText(p.hs_note_body) : undefined),
    occurredAt: (o) => date(o.properties.hs_timestamp ?? o.createdAt),
  },
];

/** The search API stops at 10,000 results per query: restart from the newest modification seen. */
const SEARCH_CAP = 9_900;

type ObjectCursor = { watermark?: string; after?: string; maxSeen?: string };

function objectStream(spec: ObjectSpec): Stream {
  return {
    name: spec.type,
    async step(client, raw, ctx) {
      const cursor = (raw as ObjectCursor | undefined) ?? {};
      const watermark = cursor.watermark ?? String(ctx.since.getTime());
      const res = await client.json<{ results: CrmObject[]; paging?: { next?: { after?: string } } }>(
        `/crm/v3/objects/${spec.type}/search`,
        {
          body: {
            filterGroups: [{ filters: [{ propertyName: spec.modifiedProp, operator: "GT", value: watermark }] }],
            sorts: [{ propertyName: spec.modifiedProp, direction: "ASCENDING" }],
            properties: [...spec.properties, spec.modifiedProp],
            limit: 100,
            after: cursor.after,
          },
        },
      );

      let maxSeen = cursor.maxSeen;
      const items: SourceItemInput[] = res.results.map((o) => {
        const modified = o.properties[spec.modifiedProp];
        const modifiedMs = modified ? String(date(modified).getTime()) : undefined;
        if (modifiedMs && (!maxSeen || Number(modifiedMs) > Number(maxSeen))) maxSeen = modifiedMs;
        const text = spec.text?.(o.properties);
        return {
          externalId: `hubspot:${spec.type}:${o.id}`,
          kind: spec.kind,
          title: spec.title(o.properties),
          occurredAt: spec.occurredAt(o),
          contentText: text ? clip(text) : undefined,
          metadata: { object: spec.type, id: o.id, ...o.properties },
        };
      });

      const after = res.paging?.next?.after;
      if (after && Number(after) < SEARCH_CAP) return { items, cursor: { watermark, after, maxSeen }, more: true };
      if (after) return { items, cursor: { watermark: maxSeen ?? watermark }, more: true };
      return { items, cursor: { watermark: maxSeen ?? watermark }, more: false };
    },
  };
}

export const hubspot: ProviderDefinition = {
  id: "hubspot",
  name: "HubSpot",
  scope: "org",
  reads: "Companies, contacts, deals and notes from your HubSpot portal.",
  oauth: {
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["oauth", "crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read"],
    clientAuth: "body",
    bodyFormat: "form",
  },
  apiBase: "https://api.hubapi.com",
  parseToken: (raw) => standardToken(raw),
  async identify(client, raw) {
    const info = await client.json<{ hub_id: number; hub_domain?: string }>(`/oauth/v1/access-tokens/${String(raw.access_token)}`);
    return { externalAccountId: String(info.hub_id), label: info.hub_domain ?? `HubSpot ${info.hub_id}` };
  },
  streams: SPECS.map(objectStream),
};
