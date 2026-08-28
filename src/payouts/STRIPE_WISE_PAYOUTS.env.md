# Stripe → Wise payouts (environment)

This feature pays a specified amount from the **Stripe available balance** or a **Stripe Financial Account** to the **configured Wise receiving bank account**. It does **not** change checkout, order payments, refunds, coupons, or partner Wise withdrawals.

## Financial Accounts (Global Stripe)

Admin **Stripe → Wise** lists Financial Accounts via Stripe Money Management API (`/v2/money_management/financial_accounts`) using preview API version `2026-04-22.preview`.

Sending from a Financial Account creates an **Outbound Payment** to the Wise recipient payout method already set up in Stripe (matched by account last4 / routing).

Required Stripe permissions on the secret key:
- Money Management Financial Accounts: Read
- Money Management Payout Methods: Read
- Money Management Outbound Payments: Write
- Accounts v2: Read

## Existing secrets (already used by the app)

Keep using the current Stripe and Wise keys. Do not put them in the admin frontend.

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
USA_STRIPE_SECRET_KEY=
USA_STRIPE_WEBHOOK_SECRET=
STRIPE_API_VERSION=2025-01-27.acacia

WISE_API_TOKEN=
WISE_PROFILE_ID=
WISE_API_URL=https://api.wise.com
WISE_SOURCE_CURRENCY=USD
```

## Optional webhook secrets for this feature

If you add a dedicated Stripe webhook endpoint, you can set:

```
STRIPE_WISE_PAYOUT_WEBHOOK_SECRET=
USA_STRIPE_WISE_PAYOUT_WEBHOOK_SECRET=
```

If these are unset, the existing `STRIPE_WEBHOOK_SECRET` / `USA_STRIPE_WEBHOOK_SECRET` values are used.

### Stripe webhook endpoints to register

Add these URLs in the Stripe Dashboard (payout events only: `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`):

- Global: `https://<backend-host>/webhooks/stripe-wise-payouts`
- USA: `https://<backend-host>/webhooks/stripe-wise-payouts-usa`

Do **not** point these at `/orders/webhook`. Order payment webhooks stay unchanged.

A 2-minute sync job also refreshes open payouts if the webhook is not registered yet.

## Wise receiving details

Wise bank/account numbers are stored in MongoDB (`stripe_wise_destinations`) by an admin. They are not read from environment variables and are never sent in full to the frontend (masked).

Stripe API tokens and Wise API tokens stay in environment/secrets only.

## Stripe eligibility notes

Stripe can only pay out to bank accounts attached to that Stripe account (Dashboard → Settings → Payouts), for a supported currency. If the configured Wise details do not match a Stripe payout bank, the admin UI shows a configuration error and does **not** mark the transfer as successful.
