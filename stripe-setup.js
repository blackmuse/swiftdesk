require('dotenv').config();
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

async function setup() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const plans = [
    {
      id: 'starter',
      name: 'SwiftDesk Starter',
      description: '50 AI tool uses per month — Denial Appeal Writer, CPT/ICD Suggester, Patient Statement Generator, and more.',
      amount: 9900,
    },
    {
      id: 'pro',
      name: 'SwiftDesk Pro',
      description: 'Unlimited AI tool uses — all 9 AI tools, priority support, and export features.',
      amount: 29900,
    },
    {
      id: 'agency',
      name: 'SwiftDesk Agency',
      description: 'Everything in Pro plus multi-provider support, API access, dedicated account manager, and HIPAA BAA.',
      amount: 49900,
    },
  ];

  const priceIds = {};

  console.log('Creating Stripe products and prices...\n');

  for (const plan of plans) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { swiftdesk_plan: plan.id },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { swiftdesk_plan: plan.id },
    });

    priceIds[plan.id] = price.id;
    console.log(`✅ ${plan.name}: ${price.id}`);
  }

  // Write price IDs back into .env
  const envPath = path.join(__dirname, '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/STRIPE_PRICE_STARTER=.*/, `STRIPE_PRICE_STARTER=${priceIds.starter}`);
  envContent = envContent.replace(/STRIPE_PRICE_PRO=.*/,     `STRIPE_PRICE_PRO=${priceIds.pro}`);
  envContent = envContent.replace(/STRIPE_PRICE_AGENCY=.*/,  `STRIPE_PRICE_AGENCY=${priceIds.agency}`);
  fs.writeFileSync(envPath, envContent);

  console.log('\n✅ Price IDs written to .env');
  console.log('\nSTRIPE_PRICE_STARTER=' + priceIds.starter);
  console.log('STRIPE_PRICE_PRO='     + priceIds.pro);
  console.log('STRIPE_PRICE_AGENCY='  + priceIds.agency);
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
