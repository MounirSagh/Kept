# Kept demo: "The SSO promise"

A customer was promised single sign-on before their renewal. Engineering quietly slipped it, the
customer is looking at a competitor, and nobody has connected the dots. Kept does.

**Story dates.** Today is Monday, October 26, 2026. The renewal is Friday, November 20, and SSO
was promised for Tuesday, November 3. If you record later than October 28, move every date in
this script by the same number of days, and regenerate the two documents.

## Cast

| Who | Played by |
| --- | --- |
| **Orbit Fleet**: your company, a fleet analytics SaaS | The Kept organization (renamed in prep) |
| **Mounir Saghfary**: Account Executive at Orbit Fleet | You, from `mounirsaghfary@gmail.com` |
| **Lina Park**: IT Director at Halcyon Freight | **A second email address you control** (another Gmail works). Below it's written `LINA_EMAIL` |
| **Marc Dubois**: VP Operations at Halcyon Freight | Only in HubSpot: `marc.dubois@halcyonfreight.com` |
| **Sofia Reyes**: engineering lead at Orbit Fleet | Mentioned in Slack, Linear and the plan. You post on her behalf |
| **FleetPulse**: the competitor | Mentioned in Notion |

## Files in this folder

| File | Used in | What it shows |
| --- | --- | --- |
| `Halcyon Freight - Order Form OF-2025-0412.pdf` | Act 1, attached to Lina's email | The signed contract: 3 pages, renewal Nov 20, $64,800/yr, 15 days' notice, SSO by Nov 3 (section 5.1, page 2), Okta metadata due Oct 28 (5.2) |
| `Halcyon Freight - Implementation plan.xlsx` | Prep, in a Drive folder shared with Lina | Milestones: Okta metadata Oct 28 (Halcyon), CSV export Oct 30 (Orbit), SSO Nov 3, QBR Nov 12, notice by Nov 5 |
| `reset-demo.sql` | Prep | Clears old demo data, keeps your login and connections |

---

# Part 0: Prep (off camera, about 45 minutes)

### 0.1 Reset Kept's data
Ask Claude to run `reset-demo.sql`, or run it yourself:
```sh
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -f ~/Desktop/Kept-demo/reset-demo.sql
```
Then in **HubSpot**, delete the old *Northwind Traders* company and the sample contacts, so only
Halcyon shows up.

### 0.2 Start Kept
```sh
pnpm infra:up && pnpm db:deploy && pnpm dev
ngrok http --url=granulative-rayford-unwarranted.ngrok-free.dev 5173
```
Open the app at **https://granulative-rayford-unwarranted.ngrok-free.dev**, not localhost.

### 0.3 Settings → Organization
- **Name:** Orbit Fleet
- **Time zone:** America/Toronto
- **Email signature:**
  ```
  Mounir Saghfary
  Account Executive, Orbit Fleet
  ```

### 0.4 Permissions (do these once)
| Tool | What to do |
| --- | --- |
| **Slack** | api.slack.com → your app → OAuth & Permissions → Bot Token Scopes: add `users:read.email` and `files:read` → **Reinstall to Workspace**. Then reconnect Slack in Kept (Integrations) |
| **HubSpot** | In `hubspot/`: `hs project upload`. Then reconnect HubSpot in Kept |
| **Linear** | Connect in Kept (asks for `issues:create`) |
| **Google** | Connect in Kept. **Tick every checkbox** on Google's consent screen |
| **Notion** | Do it after 0.5, so you can share the Halcyon page while connecting |
| **Resend** *(optional, for the digest on camera)* | Put `RESEND_API_KEY` in `.env` with `EMAIL_FROM=onboarding@resend.dev`; it only delivers to the address your Resend account uses. Without it, the digest is printed in the worker log |

### 0.5 Build Halcyon's world in the tools

**HubSpot.**
- Company **Halcyon Freight**
  - Domain: `halcyonfreight.com`
  - Industry: Transportation/Trucking/Railroad
  - Employees: 850
  - City, state, country: Montreal, Quebec, Canada
  - Description: "Montreal freight carrier running 120 trucks across Quebec and Ontario."
- Contacts, both associated with Halcyon Freight:
  - **Lina Park**: email `LINA_EMAIL`, job title IT Director
  - **Marc Dubois**: email `marc.dubois@halcyonfreight.com`, job title VP Operations
- **Don't** enter a renewal date anywhere. Kept should find it in the contract.

**Kept.**
1. Integrations → HubSpot → **Sync now**.
2. **Companies** shows Halcyon Freight with its profile and 2 contacts.
3. Open it → **Edit company** → **Owner:** you.

**Slack.**
1. Create the channel **#ext-halcyon-freight**.
2. Type `/invite @Kept` in it.

**Linear.**
1. Create a team **Halcyon Freight** (key `HAL`).
2. Create the issue **"SAML SSO (Okta) for Halcyon Freight"**:
   - due date Nov 3
   - assignee: you
   - description: "Halcyon's contract (Order Form 5.1) requires Okta SAML SSO for all users by Nov 3. Their security team won't approve the Nov 20 renewal without it."

**Notion.**
1. Create a page **Halcyon Freight**, and inside it an empty page **QBR prep – October 2026**.
2. Connect Notion in Kept. On Notion's screen, choose **Select pages** and pick **Halcyon Freight**.

**Google Drive.**
1. Create a folder **Halcyon Freight**.
2. Upload `Halcyon Freight - Implementation plan.xlsx` into it.
3. Share the file with `LINA_EMAIL` as a viewer, without sending a notification.

**Check the prep:**
1. Integrations → **Sync now** on Google, Linear and Notion.
2. Routing → **Route automatically** is on.
3. Kept should have routed, under *Routed automatically*, **Linear › Halcyon Freight** and
   **Drive › Halcyon Freight**. The Notion page appears once it has content, in Act 1.

---

# Part 1: Recording

Recording tip: run Act 1 for real but cut the waits. Each **Sync now** takes about 1 minute, reading
takes 1 to 3 minutes, and the agents' review takes 2 to 4 minutes.

## Act 1: "Promises are made everywhere" (about 3 minutes on camera)

Narration: *"A normal week on a normal account. Watch where the promises end up."*

**1. Lina emails the signed order form.** Send it from `LINA_EMAIL` to `mounirsaghfary@gmail.com`,
with the PDF attached.
> **Subject:** Signed order form + SSO before our renewal
>
> Hi Mounir,
>
> Attaching our signed order form for reference ahead of the renewal on November 20.
>
> Our security team has made single sign-on a hard requirement: they won't approve renewing any
> system that isn't on Okta SSO. Can you confirm SSO will be live for all our users by November 3,
> as the contract says? I'll send our Okta metadata this week.
>
> Thanks,
> Lina

**2. You reply** from Gmail (reply to the same thread):
> Hi Lina,
>
> Confirmed: we'll have Okta SSO live for all your users by Tuesday, November 3.
>
> I'll also send you the Q3 usage export by Friday, October 30, for your renewal review.
>
> Mounir

**3. Calendar.** Create an event:
- **Title:** Halcyon Freight × Orbit Fleet: SSO check-in
- **When:** Thursday, Oct 29, 10:00–10:30
- **Guests:** `LINA_EMAIL`
- **Description:**
  > Agenda: confirm the SSO go-live on Nov 3, and Halcyon's Okta metadata (due Oct 28). Mounir will bring the usage export.
- **Attachment:** the Implementation plan, from Drive.

**4. Slack, in #ext-halcyon-freight:**
> Heads up: I confirmed to Lina that Okta SSO will be live for Halcyon by Nov 3. It's in their contract (5.1) and their security team won't renew on Nov 20 without it. @Sofia are we on track?

Then **reply in that message's thread**:
> Just talked to Sofia: SAML is blocked on the identity provider upgrade. Realistically it's mid-November, not Nov 3.

**5. Linear.** Add a comment on the HAL issue:
> Blocked on the IdP library upgrade (AUTH-212). Moving to next sprint, new ETA Nov 17.

**6. Notion.** Write the "QBR prep – October 2026" page:
> Call with Marc Dubois (VP Ops), Oct 26.
>
> - Marc said they're evaluating FleetPulse as an alternative. If SSO isn't live before the renewal, their security team won't sign off and they'll switch.
> - Marc wants the usage numbers before the QBR on Nov 12.
> - Action: Mounir sends the Q3 usage export.

**7. In Kept:** Integrations → **Sync now** on Google, Slack, Linear and Notion. *(Cut until things appear.)*

## Act 2: "Kept connects the dots" (about 5 minutes)

**Routing.** *"I never told Kept which channel belongs to whom."*
1. Under *Routed automatically*, show the reasons:
   - **#ext-halcyon-freight**: "Its name matches Halcyon Freight"
   - **Linear › Halcyon Freight**
   - **Notion › Halcyon Freight**
   - **Drive › Halcyon Freight**
2. Click **Confirm** on one.

**Company page: Halcyon Freight.**
- **Profile:** the HubSpot profile and 2 contacts.
- **Documents:**
  - *Order Form OF-2025-0412.pdf*, "Gmail attachment · 3 pages"
  - *Implementation plan.xlsx*, from Drive
  - *"Kept read these for commitments and contract terms."*
- **Open commitments**, and *What they owe us*: Lina's Okta metadata, due Oct 28.

**Commitments page.**
1. Show:
   - **SSO live by Nov 3**, from the email and from the contract, "source, p. 2"
   - **Usage export by Oct 30**
   - **99.9% uptime**, p. 2
   - **Last day to give notice: Nov 5**
2. Click "source, p. 2": it opens the PDF.
3. Switch to **Their promises**: the Okta metadata by Oct 28.

**Approvals: Company update.**
1. *"Kept read the contract and suggests the renewal date and the value."*
2. Show the quote "It renews automatically… on November 20, 2026", $64,800/yr and 15 days' notice.
3. **Approve and update**. On the company page, **Renewal** and **Contract value** are now filled in.

**Back on the company page:** click **Review now**. *(Cut about 3 minutes.)*

**Flags.** You should see two:
- **High:** "SSO promised for Nov 3 will slip to mid-November, before the Nov 20 renewal". Its evidence:
  - Lina's email ("hard requirement")
  - your "Confirmed… by Tuesday, November 3"
  - the Slack thread ("Realistically it's mid-November")
  - the Linear comment ("new ETA Nov 17")
  - the contract, p. 2
  - *"Four tools, one story, every line quoted."*
- **Churn signal:** "Halcyon evaluating FleetPulse if SSO misses the renewal", from Notion.

**Approvals: what Kept drafted.** The suggestions you can expect:
- **Email to Lina**, from your Gmail, resetting the SSO date honestly. Edit a line, then
  **Approve and send**. Switch to Lina's inbox: it arrived from you.
- **HubSpot task** for you, for example "Call Marc before the Nov 5 notice deadline". Approve it,
  then show it on the company in HubSpot, assigned to you.
- **Linear issue**, for example "Send Halcyon Q3 usage export" in HAL. Approve it and click the
  HAL-2 link.
- **Team alert or reminder.** Reject one with a reason, for example "We already discussed this in
  standup". *"Kept learns from that."*

The wording varies from run to run. The structure is what you show.

## Act 3: "Kept promises close themselves" (about 2 minutes)

**1. Deliver the export.** From your Gmail to Lina:
> Hi Lina, here's the Q3 usage export for your renewal review (attached). Mounir

Attach any small CSV.

**2. Lina confirms** (from `LINA_EMAIL`, reply to that thread):
> Got the usage export, thanks Mounir. Okta metadata attached as promised.

Attach any small XML or text file named `halcyon-okta-metadata.xml`.

**3. SSO ships.** In Slack, in the same thread as before:
> Update: SSO is live in production for Halcyon as of today ✅ Lina's team confirmed they can log in.

**4. Sync now** on Google and Slack. *(Cut 2 minutes.)*

**5. Commitments** now shows:
- *Usage export*: **Fulfilled** ("Got the usage export")
- *Okta metadata* (their promise): **Fulfilled**
- *SSO by Nov 3*: **Fulfilled**

**6. Flags:** the SSO flag is **Resolved by itself**, with the reason "Promise kept: …". Its leftover
suggestions were withdrawn from Approvals.

*"Nobody closed anything by hand."*

## Act 4: the morning email (30 seconds, optional)
After 8:00 Toronto time, within the hour, the **daily digest** arrives (or appears in the worker
log without Resend). It has what's at risk, promises due, what customers owe you, and approvals
waiting. *"Nobody has to open a dashboard."*

---

# If something doesn't show up

| Symptom | Check |
| --- | --- |
| Lina's email isn't on Halcyon | The HubSpot contact's email must be exactly `LINA_EMAIL`, and HubSpot must sync **before** the email arrives. Otherwise go to Routing; or delete and re-send |
| A channel or page isn't routed automatically | Its name must contain "Halcyon Freight" (or "halcyonfreight"). "Halcyon" alone isn't enough. Otherwise route it on Routing |
| No Company update | The renewal date must be empty on the company before the PDF is read |
| No flags after Review now | Wait 3 to 4 minutes and refresh. The worker log (`pnpm dev` terminal) shows the run |
| Notion page missing | The page must be shared with Kept (Notion → ••• → Connections) and have content |
| A document says "No access" | Reconnect the tool (see 0.4) |
| HubSpot task fails | `hs project upload`, then reconnect HubSpot |
