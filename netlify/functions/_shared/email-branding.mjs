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

function actionButtonHtml(actionUrl = '', actionLabel = '') {
  if (!actionUrl) return '';
  return '<p style="margin:20px 0 24px;"><a href="' + escapeHtml(actionUrl) + '" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#0053b7;color:#ffffff;text-decoration:none;font:700 16px/1.3 Arial,sans-serif;">' + escapeHtml(actionLabel || 'Continue') + '</a></p>';
}

function detailRowsHtml(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const items = rows.map((row) =>
    '<tr><td style="padding:9px 12px;border-bottom:1px solid #d8e8ef;font:600 14px/1.4 Arial,sans-serif;color:#405368;">' +
    escapeHtml(row?.label || '') +
    '</td><td align="right" style="padding:9px 12px;border-bottom:1px solid #d8e8ef;font:700 14px/1.4 Arial,sans-serif;color:#17283d;">' +
    escapeHtml(row?.value || '') +
    '</td></tr>'
  ).join('');
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 18px;background:#eef8fc;border:1px solid #d8e8ef;border-radius:12px;border-collapse:separate;overflow:hidden;">' + items + '</table>';
}

function heroImageHtml({ heroImageUrl = '', heroImageAlt = '', heroLinkUrl = '' } = {}) {
  if (!heroImageUrl) return '';
  const image = '<img src="' + escapeHtml(heroImageUrl) + '" width="640" alt="' + escapeHtml(heroImageAlt || '') + '" style="display:block;width:100%;max-width:640px;height:auto;border:0;">';
  return '<tr><td style="padding:0;">' + (heroLinkUrl ? '<a href="' + escapeHtml(heroLinkUrl) + '" style="display:block;text-decoration:none;">' + image + '</a>' : image) + '</td></tr>';
}

function bodyHtml(text, actionUrl = '', actionLabel = '') {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => {
      if (actionUrl && block.trim() === actionUrl) {
        return actionButtonHtml(actionUrl, actionLabel || 'Confirm email');
      }
      const content = linkify(block).replace(/\n/g, '<br>');
      const isHeading = /^[A-Z0-9 £&–—'’.,:()/-]{4,}$/.test(block.trim()) && !block.includes('\n');
      if (isHeading) {
        return '<h2 style="margin:24px 0 8px;font:700 17px/1.35 Arial,sans-serif;color:#17283d;">' + content + '</h2>';
      }
      return '<p style="margin:0 0 16px;font:400 15px/1.6 Arial,sans-serif;color:#405368;">' + content + '</p>';
    })
    .join('');
}

export function brandedEmailHtml({
  title,
  text,
  preheader = '',
  actionUrl = '',
  actionLabel = '',
  heroImageUrl = '',
  heroImageAlt = '',
  heroLinkUrl = '',
  showHeaderLogo = true,
  detailRows = []
}) {
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
          ${showHeaderLogo ? `<tr><td style="padding:28px 32px 20px;text-align:left;"><img src="${EMAIL_LOGO_URL}" width="360" alt="LymphAware ID – Helping People Living with Lymphoedema Be Understood" style="display:block;width:100%;max-width:360px;height:auto;border:0;"></td></tr>` : ''}
          ${heroImageHtml({ heroImageUrl, heroImageAlt, heroLinkUrl })}
          <tr>
            <td style="padding:${showHeaderLogo || heroImageUrl ? '24px 32px 28px' : '28px 32px'};">
              <h1 style="margin:0 0 18px;font:700 24px/1.3 Arial,sans-serif;color:#0053b7;">${safeTitle}</h1>
              ${detailRows.length
                ? bodyHtml(text) + detailRowsHtml(detailRows) + actionButtonHtml(actionUrl, actionLabel)
                : bodyHtml(text, actionUrl, actionLabel)}
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
