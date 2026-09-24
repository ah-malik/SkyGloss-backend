require('dotenv').config();
const Stripe = require('stripe');
const mongoose = require('mongoose');
const axios = require('axios');

(async () => {
  const key = (process.env.EUROPE_STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    console.log('NO_EUROPE_KEY');
    process.exit(1);
  }
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  const acct = await stripe.accounts.retrieve();
  console.log(
    'stripe_account',
    JSON.stringify(
      {
        id: acct.id,
        country: acct.country,
        default_currency: acct.default_currency,
        charges_enabled: acct.charges_enabled,
        payouts_enabled: acct.payouts_enabled,
      },
      null,
      2,
    ),
  );

  let banks = { data: [] };
  try {
    banks = await stripe.accounts.listExternalAccounts(acct.id, {
      object: 'bank_account',
      limit: 20,
    });
  } catch (e) {
    console.log('listExternalAccounts_err', e.message);
    try {
      // Platform account: external accounts via /v1/account/external_accounts
      banks = await stripe.accounts.listExternalAccounts('self', {
        object: 'bank_account',
        limit: 20,
      });
    } catch (e2) {
      console.log('listExternalAccounts_self_err', e2.message);
      try {
        const res = await stripe.request({
          method: 'GET',
          path: '/v1/account/external_accounts',
          query: { object: 'bank_account', limit: 20 },
        });
        banks = res;
      } catch (e3) {
        console.log('raw_external_err', e3.message);
      }
    }
  }

  console.log(
    'external_banks',
    JSON.stringify(
      (banks.data || []).map((b) => ({
        id: b.id,
        bank_name: b.bank_name,
        last4: b.last4,
        currency: b.currency,
        country: b.country,
        status: b.status,
        default_for_currency: b.default_for_currency,
        routing_number: b.routing_number,
        account_holder_name: b.account_holder_name,
      })),
      null,
      2,
    ),
  );

  const payouts = await stripe.payouts.list({ limit: 15 });
  console.log(
    'recent_payouts',
    JSON.stringify(
      payouts.data.map((p) => ({
        id: p.id,
        amount: p.amount / 100,
        currency: p.currency,
        status: p.status,
        destination: p.destination,
        method: p.method,
        type: p.type,
        arrival_date: p.arrival_date,
        created: new Date(p.created * 1000).toISOString(),
        source_type: p.source_type,
        description: p.description,
        failure_code: p.failure_code,
        failure_message: p.failure_message,
        metadata: p.metadata,
      })),
      null,
      2,
    ),
  );

  // Resolve destination bank for each payout
  for (const p of payouts.data.slice(0, 8)) {
    if (!p.destination) continue;
    try {
      const dest = await stripe.accounts.retrieveExternalAccount(
        acct.id,
        p.destination,
      );
      console.log(
        'payout_dest',
        p.id,
        JSON.stringify({
          dest_id: dest.id,
          bank_name: dest.bank_name,
          last4: dest.last4,
          currency: dest.currency,
          routing_number: dest.routing_number,
          default_for_currency: dest.default_for_currency,
        }),
      );
    } catch (e) {
      try {
        const dest = await stripe.request({
          method: 'GET',
          path: `/v1/account/external_accounts/${p.destination}`,
        });
        console.log(
          'payout_dest',
          p.id,
          JSON.stringify({
            dest_id: dest.id,
            bank_name: dest.bank_name,
            last4: dest.last4,
            currency: dest.currency,
            routing_number: dest.routing_number,
            default_for_currency: dest.default_for_currency,
          }),
        );
      } catch (e2) {
        console.log('payout_dest_err', p.id, p.destination, e2.message);
      }
    }
  }

  const bal = await stripe.balance.retrieve();
  console.log(
    'balance',
    JSON.stringify(
      { available: bal.available, pending: bal.pending },
      null,
      2,
    ),
  );

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);
  const destDocs = await mongoose.connection.db
    .collection('stripe_wise_destinations')
    .find({})
    .toArray();
  console.log(
    'mongo_destinations',
    JSON.stringify(
      destDocs.map((d) => ({
        stripeAccountKey: d.stripeAccountKey,
        europeCurrency: d.europeCurrency,
        europeLast4: d.europeLast4,
        europeIbanLast4: (d.europeIban || '').toString().slice(-4),
        europeBankName: d.europeBankName,
        europeBic: d.europeBic,
        europeWiseAccountId: d.europeWiseAccountId,
        stripeExternalAccountId: d.stripeExternalAccountId,
        europeStripeExternalAccountId: d.europeStripeExternalAccountId,
        keys: Object.keys(d).filter((k) => /europe|stripe|wise|iban|bank|last/i.test(k)),
      })),
      null,
      2,
    ),
  );
  // full europe-related fields
  for (const d of destDocs) {
    console.log(
      'dest_full_europeish',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(d).filter(([k]) =>
            /europe|iban|bank|bic|swift|last4|external|wise|currency|account/i.test(
              k,
            ),
          ),
        ),
        null,
        2,
      ),
    );
  }

  const token = (process.env.WISE_API_TOKEN || '').trim();
  const base = (process.env.WISE_API_URL || 'https://api.wise.com').replace(
    /\/$/,
    '',
  );
  const profile = String(process.env.WISE_PROFILE_ID || '').trim();
  const headers = { Authorization: 'Bearer ' + token };
  const details = await axios.get(
    base + '/v1/profiles/' + profile + '/account-details',
    { headers },
  );
  const list = Array.isArray(details.data) ? details.data : [];
  for (const a of list) {
    const cur = String(a.currency || '').toUpperCase();
    if (cur !== 'EUR' && cur !== 'USD') continue;
    const detailMap = {};
    for (const d of a.details || []) {
      detailMap[d.type || d.label || d.name] = d.value || d.content;
    }
    console.log(
      'wise_recv',
      JSON.stringify(
        {
          id: a.id,
          currency: cur,
          title: a.title,
          status: a.status,
          bankName: a.bankName || detailMap.bankName || detailMap.bankCode,
          iban: detailMap.iban || a.iban,
          accountNumber: detailMap.accountNumber || a.accountNumber,
          bic: detailMap.bic || detailMap.swiftCode || detailMap.swift,
          receiveOptions: a.receiveOptions,
        },
        null,
        2,
      ),
    );
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.response?.data || e.stack || e.message);
  process.exit(1);
});
