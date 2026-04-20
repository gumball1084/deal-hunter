# 🎮 DealHunter — Facebook Marketplace Console Tracker

Automatically scans Facebook Marketplace for PS5 and Xbox deals near Stellenbosch and alerts you instantly on WhatsApp.

---

## Features
- 🔍 Scans Facebook Marketplace via Apify
- 💰 Filters by your price range
- 📍 Location + radius filtering
- 📱 WhatsApp alerts via Twilio
- 📊 Live dashboard with all settings
- ⏰ Auto-scan on schedule
- 💵 Shows estimated flip profit per listing

---

## Setup — 3 Steps

### Step 1 — Get Apify Token (Free)
1. Go to https://apify.com and create a free account
2. Go to Settings → Integrations → API Token
3. Copy your token
4. You get $5 free credits monthly = ~1,000 listings free

### Step 2 — Get Twilio WhatsApp (Free)
1. Go to https://twilio.com and create a free account
2. Go to Messaging → Try it out → Send a WhatsApp message
3. Follow the sandbox setup (send a WhatsApp to their number once)
4. Copy your Account SID and Auth Token from the dashboard

### Step 3 — Deploy to Railway
1. Push this folder to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway:
   - APIFY_TOKEN
   - TWILIO_SID  
   - TWILIO_AUTH_TOKEN
4. Deploy — your dashboard will be live at your Railway URL

---

## Using the Dashboard

Once deployed, open your Railway URL to access the dashboard.

**Settings Panel (left side):**
- Add/remove search terms (PS5, Xbox Series X, etc)
- Set your price range in ZAR
- Set your location and radius
- Enter your WhatsApp number (+27XXXXXXXXX)
- Enter your API keys
- Set auto-scan interval
- Toggle auto-scan on/off

**Listings Panel (right side):**
- See all found listings in real time
- Filter by PS5, Xbox, or new only
- See estimated flip profit per listing
- Click listing to open on Facebook

**Scan Now button:**
Triggers an immediate scan outside the schedule.

---

## WhatsApp Alert Format

🎮 DEAL ALERT — DealHunter

PS5 Console Disc Edition
💰 Price: R6,500
📍 Stellenbosch, 12km away
🕐 14:32

🏪 Retail: ~R13,699
💵 Flip target: R8,775+
📈 Potential profit: R2,275

🔗 https://facebook.com/marketplace/...

---

## Customising Profit Estimates

Edit server.js line with retailPrice to adjust retail prices as they change:
- PS5 Disc: R13,699
- Xbox Series X: R14,999  
- Xbox Series S: R7,999
