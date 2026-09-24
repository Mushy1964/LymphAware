# LymphAware ID go-live checks

- [ ] In Stripe live mode, set and verify the customer-facing Checkout business name as **LymphAware ID**. Check the logo, business contact details and card statement descriptor separately.
- [ ] Open a live-mode Checkout session before public registration opens. Confirm the header, payment button and payment authorisation text use the intended name and the Sandbox badge is absent.
- [ ] Test a signup using a monitored address. Confirm the customer order confirmation and secure account-setup link reach that address. If `graham.rooms@lymphawareid.com` is intended to appear in `graham.rooms@gmail.com`, verify Titan external forwarding and test receipt in Gmail (including Spam).
- [ ] Confirm the production Resend API key permits sending from the verified `lymphawareid.com` domain and test both customer and administrator messages after deployment.
