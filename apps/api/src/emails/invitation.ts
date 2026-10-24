import type { EmailJobData } from "@kept/shared";

interface InvitationEmail {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  teamName: string | null;
  acceptUrl: string;
  expiresAt: Date;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function invitationEmail(i: InvitationEmail): EmailJobData {
  const as = i.teamName ? `${article(i.role)} ${i.role} on ${i.teamName}` : `${article(i.role)} ${i.role}`;
  const expires = i.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const subject = `${i.inviterName} invited you to ${i.orgName} on Kept`;

  const text = [
    `${i.inviterName} invited you to join ${i.orgName} on Kept as ${as}.`,
    "",
    `Accept the invitation: ${i.acceptUrl}`,
    "",
    `The link works once and expires on ${expires}. Sign in with ${i.to} to accept it.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");

  // Inline styles only: most email clients ignore <style> blocks.
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2b2a27">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#fdfdfb;border:1px solid #e6e4df;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:15px;font-weight:600">Kept</p>
        <p style="margin:0 0 8px;font-size:18px;font-weight:600">Join ${escape(i.orgName)} on Kept</p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b6a66">
          ${escape(i.inviterName)} invited you to join as ${escape(as)}.
        </p>
        <a href="${escape(i.acceptUrl)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#155aa7;color:#fafcfe;font-size:14px;font-weight:500;text-decoration:none">Accept invitation</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6a66">
          The link works once and expires on ${escape(expires)}. Sign in with ${escape(i.to)} to accept it.
          If you weren't expecting this, you can ignore this email.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { to: i.to, subject, html, text };
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
