import crypto from 'node:crypto';
import { loadWalletMember, normalisePem, safeWalletIdentifier, walletProviderReadiness } from './_shared/wallet-member.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function localized(value) {
  return {
    defaultValue: {
      language: 'en-GB',
      value: String(value || '')
    }
  };
}

function base64url(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return input.toString('base64url');
}

function signJwt(claims, privateKey, keyId = '') {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(keyId ? { kid: keyId } : {})
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const loaded = await loadWalletMember(request);
    if (loaded.response) return loaded.response;

    const readiness = walletProviderReadiness();
    if (!readiness.google.private_pass_approved) {
      return json({
        available: false,
        reason: 'GOOGLE_PRIVATE_PASS_APPROVAL_REQUIRED',
        message: 'Google Wallet private-pass approval has not yet been confirmed.'
      }, 503);
    }
    if (!readiness.google.available) {
      return json({
        available: false,
        reason: 'GOOGLE_WALLET_NOT_CONFIGURED',
        message: 'Google Wallet signing is not yet configured.'
      }, 503);
    }

    const issuerId = String(Netlify.env.get('GOOGLE_WALLET_ISSUER_ID') || '').trim();
    const serviceAccountEmail = String(Netlify.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL') || '').trim();
    const privateKey = normalisePem(Netlify.env.get('GOOGLE_WALLET_PRIVATE_KEY_PEM'));
    const privateKeyId = String(Netlify.env.get('GOOGLE_WALLET_PRIVATE_KEY_ID') || '').trim();

    const objectId = `${issuerId}.${safeWalletIdentifier(loaded.card.lymphaware_id).toLowerCase()}`;
    const privatePass = {
      type: 'GENERIC_PRIVATE_PASS_TYPE_UNSPECIFIED',
      id: objectId,
      hexBackgroundColor: '#ffffff',
      headerLogo: {
        sourceUri: {
          uri: 'https://lymphawareid.com/assets/brand/LymphAwareID_Email_Logo.png'
        },
        contentDescription: localized('LymphAware ID')
      },
      header: localized('LymphAware ID'),
      titleLabel: localized('LYMPHOEDEMA PATIENT'),
      title: localized(loaded.card.display_name),
      barcode: {
        type: 'QR_CODE',
        value: loaded.card.profile_url,
        alternateText: loaded.card.lymphaware_id
      },
      textModulesData: [
        {
          id: 'lymphaware_id',
          header: 'LymphAware ID',
          body: loaded.card.lymphaware_id
        },
        {
          id: 'expires',
          header: 'Expires',
          body: loaded.card.expiry_label
        }
      ],
      linksModuleData: {
        uris: [
          {
            uri: loaded.card.profile_url,
            description: 'View LymphAware ID profile',
            id: 'profile'
          }
        ]
      }
    };

    const claims = {
      iss: serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: ['https://lymphawareid.com'],
      payload: {
        genericPrivatePasses: [privatePass]
      }
    };

    const token = signJwt(claims, privateKey, privateKeyId);
    const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

    return json({
      available: true,
      save_url: saveUrl,
      object_id: objectId
    });
  } catch (error) {
    console.error('Google Wallet private pass generation failed:', error);
    return json({ error: 'Your Google Wallet pass could not be prepared.' }, 500);
  }
};
