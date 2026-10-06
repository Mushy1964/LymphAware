# LymphAware ID native Wallet setup

The native Wallet functions are deliberately credential-gated. The member preview remains available for eligible Plus and Multilingual members, but no native Add-to-Wallet control is shown until the relevant provider is fully configured.

## Apple Wallet

Required Netlify environment variables:

- `APPLE_WALLET_PASS_TYPE_ID` — Apple Pass Type ID, for example `pass.com.lymphawareid.member`
- `APPLE_WALLET_TEAM_ID` — Apple Developer Team ID
- `APPLE_WALLET_SIGNER_CERT_PEM` — PEM-encoded Pass Type ID certificate
- `APPLE_WALLET_SIGNER_KEY_PEM` — PEM-encoded private key for the Pass Type ID certificate
- `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` — optional, only when the key is encrypted
- `APPLE_WALLET_WWDR_CERT_PEM` — current Apple Worldwide Developer Relations certificate in PEM format

Apple Developer setup:

1. Enrol the LymphAware ID business in the Apple Developer Program.
2. Register a Pass Type ID.
3. Create a Pass Type ID certificate for that identifier.
4. Convert the certificate/private key and Apple WWDR certificate to PEM for server-side signing.
5. Store all secrets only in Netlify environment variables.

The Apple function returns a signed `.pkpass` with the member's name, LymphAware ID, QR profile link and membership expiry date. The pass uses a stable serial number based on the LymphAware ID, so reissuing after renewal replaces the previous pass rather than creating a different identity.

## Google Wallet

Because the card identifies the holder as a lymphoedema patient, treat it as a Google Generic Private Pass rather than an ordinary Generic Pass.

Required Netlify environment variables:

- `GOOGLE_WALLET_PRIVATE_PASS_APPROVED=true` — only set after Google has explicitly approved the private-pass use case
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_WALLET_PRIVATE_KEY_PEM`
- `GOOGLE_WALLET_PRIVATE_KEY_ID` — optional

Google setup:

1. Create a Google Wallet API Issuer account.
2. Request Generic Private Pass access in the Google Pay and Wallet Console.
3. Provide the required entity/eligibility evidence, LymphAware ID website URL and logo URL.
4. Create/authorize a Google Cloud service account for the issuer.
5. Store the service-account signing values only in Netlify environment variables.
6. Set `GOOGLE_WALLET_PRIVATE_PASS_APPROVED=true` only after Google confirms approval.

The Google function uses a signed `savetowallet` JWT containing a `genericPrivatePasses` payload. It includes only the minimum Wallet data: member name, LymphAware ID, expiry date, and the existing QR profile link. The member photograph is intentionally not inserted into Google Wallet because Google's Generic Private Pass reference states that the hero image should not contain PII.

## Membership and privacy controls

Both providers reuse the existing LymphAware ID QR URL. They do not create a second health record.

A pass is issued only when:

- the member is currently entitled;
- the package is Plus or Multilingual;
- a valid membership expiry date exists;
- display name, LymphAware ID, QR token and photograph are present.

Scanning the Wallet QR remains subject to the live membership, QR visibility, consent and profile-availability controls already enforced by the public-profile function.

## Renewal

The Wallet card always uses the current database `membership_end` value when generated.

Until provider-specific push/update services are added, a member whose expiry date changes after renewal should reopen the Digital Wallet ID page and re-add/refresh the pass. Apple uses the same Pass Type ID + serial number, which replaces the existing pass identity when reissued.
