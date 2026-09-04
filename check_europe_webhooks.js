const Stripe = require('stripe');
require('dotenv').config();

const stripe = new Stripe(process.env.EUROPE_STRIPE_SECRET_KEY, {
  apiVersion: process.env.EUROPE_STRIPE_API_VERSION || '2026-07-29.dahlia',
});

const paidSessions = [
  'cs_live_b1EsmQNVxOQAzpCXxrybWLQ5WdvJCnKEYsf6Nzefp1ag8NJsr43cOM4myY',
  'cs_live_b1raVfMK0VLl1pOokP6CsGtk06Jsx9qs17OhWyUZ2DDWbTHUlLimqDjJCS',
];

async function main() {
  console.log('=== Webhook endpoints on Europe account ===');
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const ep of endpoints.data) {
      console.log(
        JSON.stringify(
          {
            id: ep.id,
            url: ep.url,
            status: ep.status,
            enabled_events: ep.enabled_events,
            api_version: ep.api_version,
          },
          null,
          2,
        ),
      );
    }
    if (!endpoints.data.length) console.log('(none)');
  } catch (err) {
    console.log('webhookEndpoints.list failed:', err.message);
  }

  console.log('\n=== Events for paid sessions ===');
  for (const sessionId of paidSessions) {
    const events = await stripe.events.list({
      type: 'checkout.session.completed',
      limit: 50,
    });
    const related = events.data.filter((e) => {
      const obj = e.data?.object;
      return obj && obj.id === sessionId;
    });
    console.log(
      `\nSession ${sessionId}: matched events in last 50 checkout.session.completed = ${related.length}`,
    );
    for (const e of related) {
      console.log(
        JSON.stringify(
          {
            id: e.id,
            created: new Date(e.created * 1000).toISOString(),
            livemode: e.livemode,
            pending_webhooks: e.pending_webhooks,
            request: e.request,
          },
          null,
          2,
        ),
      );
    }
  }

  // Broader: any checkout.session.completed for this user in recent events
  const all = await stripe.events.list({
    type: 'checkout.session.completed',
    limit: 100,
  });
  const userEvents = all.data.filter((e) => {
    const obj = e.data?.object || {};
    const meta = obj.metadata || {};
    return (
      meta.userId === '6a99f400188f1afa127a7af7' ||
      obj.client_reference_id === '6a99f400188f1afa127a7af7'
    );
  });
  console.log(
    `\n=== checkout.session.completed for this user in last 100 events: ${userEvents.length} ===`,
  );
  for (const e of userEvents) {
    const obj = e.data.object;
    console.log(
      JSON.stringify(
        {
          eventId: e.id,
          created: new Date(e.created * 1000).toISOString(),
          sessionId: obj.id,
          payment_status: obj.payment_status,
          pending_webhooks: e.pending_webhooks,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
