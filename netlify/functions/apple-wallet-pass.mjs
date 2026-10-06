import { PKPass } from 'passkit-generator';
import { loadWalletMember, normalisePem, safeWalletIdentifier, walletProviderReadiness } from './_shared/wallet-member.mjs';

const ICON_1X = 'iVBORw0KGgoAAAANSUhEUgAAACYAAAAmCAYAAACoPemuAAAAf0lEQVR42mNkCN7+n2EQAiaGQQpGHTbqsFGHjTpsqDuMBZnzf43HgDqGMWTHEAsxUnyELZRVq1UJmnG79fYwSmPUAthChZjQHC0uRh026rBRh406bKiW/KSW8sM3xAi114htOQyfEKNG2qAMTB4tLkYdNuqwQeswxtGhzuHiMAB0ixa01GE3kQAAAABJRU5ErkJggg==';
const ICON_2X = 'iVBORw0KGgoAAAANSUhEUgAAAEwAAABMCAYAAADHl1ErAAAAzklEQVR42u3cwQ1EQBSAYSNa0Ys73TirQBvu9KIYTo4SkidMfP91L5svb15kbDYV7bwVulyJABgwYMCACRgwYMCACRgwYMCAARMwYMCyqDr7YJuaX8OkbjFhjiSwjHdY9Nm/uyPrvg77TuuwmjBHEpgd9mp39lDk/jNhwIABAwZMwIABAwZMwIABAwYMmC6XzY3rk7eoJgwYMDvsKOpXP5Fvq00YMGD/22Ffee55r9GEOZLAgAEDJmDAgAEDJmDAgGVQ8i+bJgwYMGDAdNIOzUQXAJHUtv4AAAAASUVORK5CYII=';
const ICON_3X = 'iVBORw0KGgoAAAANSUhEUgAAAHIAAAByCAYAAACP3YV9AAABHElEQVR42u3csQ2DMBBAURtlFXZJD9ukzgRZIz3swjBmBSSIz8Tv12nip0McQuQ0LSXp9g2OAKRACqRAghRIgRRIkAIpkAIpkCAFUiAFEqRACqRAghRIgRRIgQQpkAKpAz2O/Kh8n04qsDyvJtKlVSAFUiBBqpf1I+J2+spVaHyN1f/j9t5MpECCFEiBFEjFrx8tdWZNiFhrTKRLq0AKpECCFEiBFEiBBCmQAimQIAVSIAUSpEAKpEAKJEi1XPcvKLf0krGJFEiQAimQAmn9uLzaX5us/akUEymQIAVSIBVx1/ovD5bv28dEurQKpEAKJEiBFEiBFEiQAimQAglSIAVSIAUSpEDqF+U0LcUxmEiBFEiBBCmQAimQfbUD7tgXTCu3JIAAAAAASUVORK5CYII=';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function fetchLogo() {
  const response = await fetch('https://lymphawareid.com/assets/brand/LymphAwareID_Email_Logo.png');
  if (!response.ok) throw new Error('Wallet logo could not be loaded.');
  return Buffer.from(await response.arrayBuffer());
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const loaded = await loadWalletMember(request);
    if (loaded.response) return loaded.response;

    const readiness = walletProviderReadiness();
    if (!readiness.apple.available) {
      return json({
        available: false,
        reason: 'APPLE_WALLET_NOT_CONFIGURED',
        message: 'Apple Wallet signing is not yet configured.'
      }, 503);
    }

    const passTypeIdentifier = String(Netlify.env.get('APPLE_WALLET_PASS_TYPE_ID') || '').trim();
    const teamIdentifier = String(Netlify.env.get('APPLE_WALLET_TEAM_ID') || '').trim();
    const signerKeyPassphrase = String(Netlify.env.get('APPLE_WALLET_SIGNER_KEY_PASSPHRASE') || '');

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier,
      teamIdentifier,
      organizationName: 'LymphAware ID',
      description: 'LymphAware ID digital identification card',
      serialNumber: safeWalletIdentifier(loaded.card.lymphaware_id),
      logoText: 'LymphAware ID',
      foregroundColor: 'rgb(7, 29, 62)',
      backgroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(49, 93, 99)',
      sharingProhibited: true,
      expirationDate: loaded.card.membership_end,
      generic: {
        primaryFields: [
          {
            key: 'patient',
            label: 'LYMPHOEDEMA PATIENT',
            value: loaded.card.display_name
          }
        ],
        secondaryFields: [
          {
            key: 'lymphaware-id',
            label: 'LymphAware ID',
            value: loaded.card.lymphaware_id
          }
        ],
        auxiliaryFields: [
          {
            key: 'expires',
            label: 'Expires',
            value: loaded.card.membership_end,
            dateStyle: 'PKDateStyleMedium',
            timeStyle: 'PKDateStyleNone'
          }
        ],
        backFields: [
          {
            key: 'profile',
            label: 'LymphAware ID profile',
            value: loaded.card.profile_url
          },
          {
            key: 'profile-control',
            label: 'Profile control',
            value: 'The member controls the information made available through the QR-linked profile.'
          },
          {
            key: 'support',
            label: 'LymphAware ID support',
            value: 'admin@lymphawareid.com'
          },
          {
            key: 'disclaimer',
            label: 'Important',
            value: 'LymphAware ID is a communication and identification aid. It does not provide medical diagnosis or replace professional medical advice.'
          }
        ]
      },
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: loaded.card.profile_url,
          messageEncoding: 'iso-8859-1',
          altText: loaded.card.lymphaware_id
        }
      ]
    };

    const logo = await fetchLogo();
    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
        'icon.png': Buffer.from(ICON_1X, 'base64'),
        'icon@2x.png': Buffer.from(ICON_2X, 'base64'),
        'icon@3x.png': Buffer.from(ICON_3X, 'base64'),
        'logo.png': logo
      },
      {
        wwdr: normalisePem(Netlify.env.get('APPLE_WALLET_WWDR_CERT_PEM')),
        signerCert: normalisePem(Netlify.env.get('APPLE_WALLET_SIGNER_CERT_PEM')),
        signerKey: normalisePem(Netlify.env.get('APPLE_WALLET_SIGNER_KEY_PEM')),
        ...(signerKeyPassphrase ? { signerKeyPassphrase } : {})
      }
    );

    const buffer = pass.getAsBuffer();
    const filename = `LymphAware-ID-${safeWalletIdentifier(loaded.card.lymphaware_id)}.pkpass`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Apple Wallet pass generation failed:', error);
    return json({ error: 'Your Apple Wallet pass could not be prepared.' }, 500);
  }
};
