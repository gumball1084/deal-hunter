require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// ============================================
// SETTINGS FILE — persists your configuration
// ============================================
const SETTINGS_FILE = './settings.json';

const DEFAULT_SETTINGS = {
  searchTerms: ['PS5', 'Xbox Series X', 'Xbox Series S'],
  minPrice: 5000,
  maxPrice: 7500,
  location: 'Stellenbosch',
  radiusKm: 50,
  whatsappTo: '',
  checkInterval: 60, // minutes
  active: false,
  twilioSid: process.env.TWILIO_SID || '',
  twilioToken: process.env.TWILIO_TOKEN || '',
  apifyToken: process.env.APIFY_TOKEN || '',
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE)) };
    }
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

// ============================================
// LISTINGS STORE
// ============================================
const LISTINGS_FILE = './listings.json';

function loadListings() {
  try {
    if (fs.existsSync(LISTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(LISTINGS_FILE));
    }
  } catch (e) {}
  return [];
}

function saveListings(listings) {
  // Keep only last 500
  const trimmed = listings.slice(-500);
  fs.writeFileSync(LISTINGS_FILE, JSON.stringify(trimmed, null, 2));
}

let allListings = loadListings();
const seenIds = new Set(allListings.map(l => l.id));

// ============================================
// APIFY — Facebook Marketplace Scraper
// ============================================
async function fetchFacebookListings(searchTerm) {
  try {
    if (!settings.apifyToken) {
      console.log('⚠️  No Apify token — using mock data for testing');
      return getMockListings(searchTerm);
    }

    // Build Facebook Marketplace URL for South Africa
    const encodedTerm = encodeURIComponent(searchTerm);
    const marketplaceUrl = `https://www.facebook.com/marketplace/stellenbosch/search?query=${encodedTerm}&minPrice=${settings.minPrice}&maxPrice=${settings.maxPrice}`;

    // Call Apify Facebook Marketplace scraper
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs?token=${settings.apifyToken}`,
      {
        startUrls: [{ url: marketplaceUrl }],
        maxItems: 50,
        proxy: { useApifyProxy: true }
      },
      { timeout: 30000 }
    );

    const runId = runResponse.data.data.id;

    // Wait for run to complete (poll every 5 seconds, max 60 seconds)
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await axios.get(
        `https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs/${runId}?token=${settings.apifyToken}`
      );
      if (statusRes.data.data.status === 'SUCCEEDED') break;
      if (statusRes.data.data.status === 'FAILED') return [];
    }

    // Get results
    const resultsRes = await axios.get(
      `https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs/${runId}/dataset/items?token=${settings.apifyToken}`
    );

    return resultsRes.data
      .filter(item => {
        const price = parseInt(item.price?.replace(/[^0-9]/g, '') || '0');
        return price >= settings.minPrice && price <= settings.maxPrice;
      })
      .map(item => {
        const rawLink = item.url || item.link || '';
        const itemId = item.id || item.listing_id || '';
        let fullLink = rawLink;
        if (itemId && !rawLink.includes('facebook.com')) {
          fullLink = `https://www.facebook.com/marketplace/item/${itemId}/`;
        } else if (rawLink && !rawLink.startsWith('http')) {
          fullLink = `https://www.facebook.com${rawLink}`;
        } else if (!rawLink) {
          fullLink = `https://www.facebook.com/marketplace/stellenbosch/search/?query=${encodeURIComponent(item.title || searchTerm)}`;
        }
        return {
          id: itemId || rawLink || `${item.title}-${item.price}`,
          title: item.title || item.name || 'Unknown',
          price: parseInt(item.price?.replace(/[^0-9]/g, '') || '0'),
          location: item.location || item.city || settings.location,
          image: item.image || item.thumbnail || item.photo || null,
          link: fullLink,
          searchTerm,
          foundAt: new Date().toISOString(),
          isNew: true,
        };
      });

  } catch (error) {
    console.error(`Apify error for "${searchTerm}":`, error.message);
    return getMockListings(searchTerm);
  }
}

// Mock data for testing without API keys
function getMockListings(searchTerm) {
  const mocks = [
    { title: `${searchTerm} Console - Good Condition`, price: Math.floor(Math.random() * 2500) + 5000, location: 'Stellenbosch, 12km away' },
    { title: `${searchTerm} + 2 Controllers`, price: Math.floor(Math.random() * 2500) + 5000, location: 'Somerset West, 28km away' },
    { title: `${searchTerm} Barely Used`, price: Math.floor(Math.random() * 2500) + 5000, location: 'Paarl, 45km away' },
  ];
  return mocks
    .filter(m => m.price >= settings.minPrice && m.price <= settings.maxPrice)
    .map((m, i) => ({
      id: `mock-${searchTerm}-${Date.now()}-${i}`,
      title: m.title,
      price: m.price,
      location: m.location,
      image: null,
      link: 'https://www.facebook.com/marketplace/',
      searchTerm,
      foundAt: new Date().toISOString(),
      isNew: true,
      isMock: true,
    }));
}

// ============================================
// WHATSAPP ALERT
// ============================================
async function sendWhatsAppAlert(listing) {
  try {
    if (!settings.twilioSid || !settings.twilioToken || !settings.whatsappTo) {
      console.log('📱 WhatsApp not configured — alert would be:');
      console.log(formatWhatsApp(listing));
      return false;
    }

    const client = twilio(settings.twilioSid, settings.twilioToken);
    await client.messages.create({
      body: formatWhatsApp(listing),
      from: 'whatsapp:+14155238886',
      to: `whatsapp:${settings.whatsappTo}`,
    });
    console.log(`✅ WhatsApp alert sent: ${listing.title}`);
    return true;
  } catch (error) {
    console.error('WhatsApp error:', error.message);
    return false;
  }
}

function formatWhatsApp(listing) {
  const retailPrice = listing.title.toLowerCase().includes('series s') ? 7999 :
                     listing.title.toLowerCase().includes('xbox') ? 14999 : 13699;
  const flipPrice = Math.round(listing.price * 1.35);

  return `🎮 *DEAL ALERT — DealHunter*

*${listing.title}*
💰 Price: R${listing.price.toLocaleString()}
📍 ${listing.location}
🕐 ${new Date(listing.foundAt).toLocaleTimeString('en-ZA')}

🏪 Retail: ~R${retailPrice.toLocaleString()}
💵 Flip target: R${flipPrice.toLocaleString()}+
📈 Potential profit: R${(flipPrice - listing.price).toLocaleString()}

🔗 ${listing.link}`;
}

// ============================================
// MAIN SCAN FUNCTION
// ============================================
let isScanning = false;
let lastScan = null;
let scheduledJob = null;

async function runScan() {
  if (isScanning) return;
  isScanning = true;
  lastScan = new Date().toISOString();

  console.log(`\n🔍 Scanning Facebook Marketplace — ${new Date().toLocaleTimeString()}`);

  let newCount = 0;

  for (const term of settings.searchTerms) {
    console.log(`   Searching: "${term}"`);
    const listings = await fetchFacebookListings(term);

    for (const listing of listings) {
      if (!seenIds.has(listing.id)) {
        seenIds.add(listing.id);
        allListings.unshift(listing); // Add to front
        newCount++;
        await sendWhatsAppAlert(listing);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  saveListings(allListings);
  isScanning = false;
  console.log(`   ✅ Scan complete — ${newCount} new listings found`);
  return newCount;
}

function restartScheduler() {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }
  if (settings.active) {
    const mins = settings.checkInterval || 60;
    const cronExpr = mins < 60 ? `*/${mins} * * * *` : `0 */${Math.floor(mins/60)} * * *`;
    scheduledJob = cron.schedule(cronExpr, runScan);
    console.log(`⏰ Scheduler started — every ${mins} minutes`);
  }
}

// ============================================
// API ROUTES
// ============================================

// Get current settings
app.get('/api/settings', (req, res) => {
  res.json({
    ...settings,
    twilioToken: settings.twilioToken ? '••••••••' : '',
    apifyToken: settings.apifyToken ? '••••••••' : '',
  });
});

// Save settings
app.post('/api/settings', (req, res) => {
  const updates = req.body;
  // Don't overwrite tokens if they're masked
  if (updates.twilioToken === '••••••••') delete updates.twilioToken;
  if (updates.apifyToken === '••••••••') delete updates.apifyToken;

  settings = { ...settings, ...updates };
  saveSettings(settings);
  restartScheduler();
  res.json({ success: true, message: 'Settings saved' });
});

// Get listings
app.get('/api/listings', (req, res) => {
  res.json({
    listings: allListings.slice(0, 100),
    total: allListings.length,
    lastScan,
    isScanning,
    active: settings.active,
  });
});

// Manual scan trigger
app.post('/api/scan', async (req, res) => {
  res.json({ success: true, message: 'Scan started' });
  runScan();
});

// Stop scanning
app.post('/api/scan/stop', (req, res) => {
  isScanning = false;
  res.json({ success: true, message: 'Scan stopped' });
});

// Clear listings
app.delete('/api/listings', (req, res) => {
  allListings = [];
  seenIds.clear();
  saveListings([]);
  res.json({ success: true });
});

// Status
app.get('/api/status', (req, res) => {
  res.json({
    isScanning,
    lastScan,
    active: settings.active,
    totalListings: allListings.length,
    newToday: allListings.filter(l => {
      const today = new Date();
      const found = new Date(l.foundAt);
      return found.toDateString() === today.toDateString();
    }).length,
  });
});

// Serve dashboard
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🎮 DealHunter Dashboard`);
  console.log(`================================`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📍 Location: ${settings.location}`);
  console.log(`💰 Price: R${settings.minPrice.toLocaleString()} - R${settings.maxPrice.toLocaleString()}`);
  console.log(`================================\n`);
  restartScheduler();
});
