const SITE_URL = 'https://lymphawareid.com';
const CONTACT_EMAIL = 'admin@lymphawareid.com';
const EMAIL_LOGO_URL = SITE_URL + '/assets/brand/LymphAwareID_Email_Logo.png';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(value) {
  let html = escapeHtml(value);
  html = html.replace(
    /(https:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#0053b7;text-decoration:underline;">$1</a>'
  );
  html = html.replace(
    /admin@lymphawareid\.com/g,
    '<a href="mailto:admin@lymphawareid.com" style="color:#0053b7;text-decoration:underline;">admin@lymphawareid.com</a>'
  );
  return html;
}

function bodyHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => {
      const content = linkify(block).replace(/\n/g, '<br>');
      const isHeading = /^[A-Z0-9 £&–—'’.,:()/-]{4,}$/.test(block.trim()) && !block.includes('\n');
      if (isHeading) {
        return '<h2 style="margin:24px 0 8px;font:700 17px/1.35 Arial,sans-serif;color:#17283d;">' + content + '</h2>';
      }
      return '<p style="margin:0 0 16px;font:400 15px/1.6 Arial,sans-serif;color:#405368;">' + content + '</p>';
    })
    .join('');
}

export function brandedEmailHtml({ title, text, preheader = '' }) {
  const safeTitle = escapeHtml(title || 'LymphAware ID');
  const safePreheader = escapeHtml(preheader || title || 'LymphAware ID');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dbe6ec;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 20px;text-align:left;">
              <img src="${EMAIL_LOGO_URL}" width="360" alt="LymphAware ID – Helping People Living with Lymphoedema Be Understood" style="display:block;width:100%;max-width:360px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              <h1 style="margin:0 0 18px;font:700 24px/1.3 Arial,sans-serif;color:#0b4f8a;">${safeTitle}</h1>
              ${bodyHtml(text)}
              <div style="margin-top:26px;padding-top:18px;border-top:1px solid #dbe6ec;font:400 13px/1.6 Arial,sans-serif;color:#667684;">
                <strong style="color:#17283d;">LymphAware ID</strong><br>
                <a href="${SITE_URL}" style="color:#0053b7;text-decoration:underline;">lymphawareid.com</a><br>
                <a href="mailto:${CONTACT_EMAIL}" style="color:#0053b7;text-decoration:underline;">${CONTACT_EMAIL}</a>
              </div>
              <p style="margin:16px 0 0;font:400 11px/1.5 Arial,sans-serif;color:#7a8893;">LymphAware ID is a communication and identification aid. It does not provide medical diagnosis or replace professional medical advice.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
