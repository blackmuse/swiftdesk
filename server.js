require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const toolsRoutes = require('./routes/tools');
const billingRoutes = require('./routes/billing');

const app = express();
const PORT = process.env.PORT || 3000;

// On Vercel the filesystem is read-only except /tmp; use that for user data
const dataDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, 'data');
const usersFile = process.env.VERCEL
  ? '/tmp/users.json'
  : path.join(__dirname, 'data', 'users.json');

// Make data directory and seed users file if missing
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify([]));

// Export resolved paths so routes can import them
app.locals.usersFile = usersFile;

app.use(cors());

// Stripe webhook needs the raw body BEFORE express.json() parses it
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/billing', billingRoutes);

// Fallback — serve index.html for unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server only when run directly (not when imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SwiftDesk running at http://localhost:${PORT}`);
  });
}

module.exports = app;
