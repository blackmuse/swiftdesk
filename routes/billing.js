const express = require('express');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const USERS_FILE = process.env.VERCEL
  ? '/tmp/users.json'
  : path.join(__dirname, '../data/users.json');

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function planFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  if (priceId === process.env.STRIPE_PRICE_PRO)     return 'pro';
  if (priceId === process.env.STRIPE_PRICE_AGENCY)  return 'agency';
  return 'free';
}

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 99,
    interval: 'month',
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
    features: [
      '50 AI tool uses per month',
      'Denial Appeal Writer',
      'CPT/ICD Code Suggester',
      'Patient Statement Generator',
      'EOB Interpreter',
      'Email support',
    ],
    limits: { monthlyUses: 50 },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 299,
    interval: 'month',
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    features: [
      'Unlimited AI tool uses',
      'All 9 AI tools',
      'Prior Auth Assistant',
      'Charge Capture Check',
      'Credentialing Helper',
      'Priority support',
      'Export to PDF/Word',
    ],
    limits: { monthlyUses: -1 },
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 499,
    interval: 'month',
    stripePriceId: process.env.STRIPE_PRICE_AGENCY,
    features: [
      'Everything in Pro',
      'Multi-provider support (up to 20)',
      'Dedicated account manager',
      'HIPAA BAA included',
      'API access',
      'White-label options',
      'Custom AI fine-tuning',
    ],
    limits: { monthlyUses: -1 },
  },
];

// GET /api/billing/plans
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// GET /api/billing/config  — exposes publishable key to frontend
router.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// POST /api/billing/create-checkout-session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS.find(p => p.id === planId);
    if (!plan || !plan.stripePriceId) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const stripe = getStripe();
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cancel.html`,
      customer_email: user.email,
      metadata: { userId: user.id, planId },
      subscription_data: { metadata: { userId: user.id, planId } },
    };

    // Reuse existing Stripe customer if they have one
    if (user.stripeCustomerId) {
      delete sessionParams.customer_email;
      sessionParams.customer = user.stripeCustomerId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/billing/portal  — Stripe Customer Portal for managing subscription
router.post('/portal', authenticateToken, async (req, res) => {
  try {
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);

    if (!user || !user.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription found. Please subscribe to a plan first.' });
    }

    const stripe = getStripe();
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/dashboard.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

// POST /api/billing/webhook  — Stripe sends events here
// Note: body is raw Buffer because of express.raw() in server.js
router.post('/webhook', async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;

  // Verify signature if webhook secret is configured
  if (webhookSecret && webhookSecret !== 'whsec_your_webhook_secret_here' && sig) {
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Dev mode: parse raw body without signature check
    try {
      event = JSON.parse(req.body.toString());
    } catch {
      return res.status(400).send('Invalid JSON');
    }
  }

  const stripe = getStripe();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (!userId) break;

      // Retrieve the subscription to get the price ID
      let planId = session.metadata?.planId || 'starter';
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price?.id;
        if (priceId) planId = planFromPriceId(priceId);
      }

      const users = readUsers();
      const idx = users.findIndex(u => u.id === userId);
      if (idx !== -1) {
        users[idx].plan = planId;
        users[idx].stripeCustomerId = session.customer;
        users[idx].stripeSubscriptionId = session.subscription;
        writeUsers(users);
        console.log(`Plan updated: user ${userId} → ${planId}`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) break;

      const priceId = sub.items.data[0]?.price?.id;
      const planId = planFromPriceId(priceId);
      const status = sub.status;

      const users = readUsers();
      const idx = users.findIndex(u => u.id === userId);
      if (idx !== -1) {
        users[idx].plan = (status === 'active' || status === 'trialing') ? planId : 'free';
        users[idx].stripeSubscriptionId = sub.id;
        writeUsers(users);
        console.log(`Subscription updated: user ${userId} → ${planId} (${status})`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) break;

      const users = readUsers();
      const idx = users.findIndex(u => u.id === userId);
      if (idx !== -1) {
        users[idx].plan = 'free';
        users[idx].stripeSubscriptionId = null;
        writeUsers(users);
        console.log(`Subscription cancelled: user ${userId} → free`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for customer ${invoice.customer}`);
      break;
    }

    default:
      // Unhandled event — ignore
  }

  res.json({ received: true });
});

module.exports = router;
