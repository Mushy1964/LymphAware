function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function cleanSingleLine(value, maxLength) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMessage(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export default async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));

    // Quietly accept honeypot submissions so automated senders receive no clues.
    if (String(body.botField || '').trim()) {
      return jsonResponse({ ok: true });
    }

    const name = cleanSingleLine(body.name, 120);
    const email = cleanSingleLine(body.email, 254).toLowerCase();
    const enquiryType = cleanSingleLine(body.enquiryType, 100);
    const message = cleanMessage(body.message, 4000);

    if (
      name.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !enquiryType ||
      message.length < 10
    ) {
      return jsonResponse(
        { error: 'Please complete your name, email address, enquiry type and message.' },
        400
      );
    }

    const apiKey = env('RESEND_API_KEY');
    if (!apiKey) {
      console.error('Contact enquiry failed: RESEND_API_KEY is not configured.');
      return jsonResponse({ error: 'Email delivery is not currently available.' }, 500);
    }

    const to =
      env('CONTACT_NOTIFICATION_EMAIL') ||
      env('ORDER_NOTIFICATION_EMAIL') ||
      'admin@lymphaware.com';

    const from =
      env('CONTACT_NOTIFICATION_FROM') ||
      env('ORDER_NOTIFICATION_FROM') ||
      'LymphAware <notifications@lymphaware.com>';

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: [email],
        subject: `LymphAware website enquiry – ${enquiryType}`,
        text:
          `A new enquiry has been submitted through lymphaware.com.\n\n` +
          `Name: ${name}\n` +
          `Email: ${email}\n` +
          `Enquiry type: ${enquiryType}\n\n` +
          `Message:\n${message}\n`
      })
    });

    if (!resendResponse.ok) {
      const detail = await resendResponse.text();
      console.error('Resend contact enquiry error:', detail.slice(0, 1000));
      return jsonResponse({ error: 'The enquiry could not be emailed.' }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(
      'Contact enquiry error:',
      error instanceof Error ? error.message : String(error)
    );
    return jsonResponse({ error: 'The enquiry could not be sent.' }, 500);
  }
};

export const config = {
  path: '/api/contact-enquiry'
};
