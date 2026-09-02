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
EUROPE_STRIPE_SECRET_KEY=
EUROPE_STRIPE_WEBHOOK_SECRET=
STRIPE_API_VERSION=2025-01-27.acacia
EUROPE_STRIPE_API_VERSION=2026-07-29.dahlia

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
EUROPE_STRIPE_WISE_PAYOUT_WEBHOOK_SECRET=
```

If these are unset, the existing `STRIPE_WEBHOOK_SECRET` / `USA_STRIPE_WEBHOOK_SECRET` / `EUROPE_STRIPE_WEBHOOK_SECRET` values are used.

### Stripe webhook endpoints to register

Add these URLs in the Stripe Dashboard (payout events only: `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`):

- Global: `https://<backend-host>/webhooks/stripe-wise-payouts`
- USA: `https://<backend-host>/webhooks/stripe-wise-payouts-usa`
- Europe: `https://<backend-host>/webhooks/stripe-wise-payouts-europe`

Do **not** point these at `/orders/webhook`. Order payment webhooks stay unchanged.

A 2-minute sync job also refreshes open payouts if the webhook is not registered yet.

## Automatic order commission transfers

When a shop order is marked **PAID**, the backend queues a commission transfer equal to the sum of partner commission lines on that order (`order.commissions[].amount`). A cron job then sends that amount from Stripe to the configured Wise receiving account (Financial Account outbound by default, with payments-balance fallback when FA balance is insufficient).

Admin list: **Stripe → Wise** page (`/stripe-wise` in admin UI), section **Order commission transfers**. API: `GET /order-commission-transfers`.

Duplicate protection: one transfer record per order (`orderId` unique) and stable idempotency key `order-commission:<orderId>`.

```
# Enable/disable automatic processing (default: enabled)
AUTO_COMMISSION_STRIPE_TO_WISE=true

# Source for automated transfers: financial_account | payments_balance
AUTO_COMMISSION_SOURCE_TYPE=financial_account

# Optional: admin user id used as createdBy on linked stripe_wise_payouts rows
AUTO_COMMISSION_ADMIN_USER_ID=
```

If `AUTO_COMMISSION_STRIPE_TO_WISE=false`, pending records are still created but not sent until re-enabled or retried manually from the admin page.

Funds may not be available on Stripe immediately after checkout; transfers stay **Pending** and retry every 2 minutes until balance is sufficient.

## Wise receiving details

Wise bank/account numbers are stored in MongoDB (`stripe_wise_destinations`) by an admin. They are not read from environment variables and are never sent in full to the frontend (masked).

Stripe API tokens and Wise API tokens stay in environment/secrets only.

## Stripe eligibility notes

Stripe can only pay out to bank accounts attached to that Stripe account (Dashboard → Settings → Payouts), for a supported currency. If the configured Wise details do not match a Stripe payout bank, the admin UI shows a configuration error and does **not** mark the transfer as successful.
