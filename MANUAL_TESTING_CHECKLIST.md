# 📋 Nandibaag Bot — Manual Testing Checklist

> **Before you start:** Run the automated tests first and make sure both pass cleanly:
>
> ```bash
> cd backend
> npm run smoke-test    # API endpoints + auth + rate limiting
> npm run test-ai       # AI reply quality for 10 scenarios
> ```
>
> Only proceed with this manual checklist once both scripts report success.

---

## 🧪 Local Testing with Ollama (Dev/Test Mode Only)

> **⚠️ IMPORTANT:** This mode is for local development and testing ONLY. Never use AI_TEST_MODE=true with the live resort WhatsApp number.

- [ ] **Set AI_TEST_MODE environment variable**
  Add to your `.env` file:
  ```
  AI_TEST_MODE=true
  OLLAMA_MODEL=llama3.2  # Or whatever model you have pulled locally
  ```
  (OLLAMA_BASE_URL defaults to `http://localhost:11434/v1`)

- [ ] **Start Ollama server**
  Make sure Ollama is running locally:
  ```bash
  ollama serve
  ```
  Verify it's accessible at `http://localhost:11434`

- [ ] **Pull the required model**
  If you haven't already:
  ```bash
  ollama pull llama3.2  # Or your preferred model
  ```

- [ ] **Verify AI_TEST_MODE warning appears on startup**
  Start the backend and check logs for the warning:
  ```
  ⚠️  AI_TEST_MODE IS ON — using local Ollama only, NOT connected to real AI providers.
  ⚠️  Do not use this mode with the live resort WhatsApp number.
  ```

- [ ] **Run through full booking-flow checklist locally**
  Complete all booking flow tests (Couple, Group, Picnic) using the test dashboard or a test WhatsApp number.
  Verify that:
  - All AI responses come from local Ollama (no cloud API calls)
  - Booking flow logic works correctly
  - System prompt behavior is as expected
  - No quota is burned on cloud providers

- [ ] **Turn off AI_TEST_MODE after testing**
  Set `AI_TEST_MODE=false` in `.env` before connecting to the live WhatsApp number.

---

## 🔌 WhatsApp Connection

- [ ] **Scan QR / Enter pairing code**
  Open the dashboard, go to WhatsApp settings, add your number, and scan the QR code (or use the pairing code flow).
  Confirm the dashboard shows **"Connected"** status within 30 seconds.

- [ ] **Send a real WhatsApp message from your personal phone**
  Send a message like "Hi" to the bot's WhatsApp number from a different phone.
  Confirm the message appears in the `/chats` section of the dashboard within a few seconds.

- [ ] **Confirm AI reply arrives on WhatsApp**
  After sending the message above, wait and verify the AI reply arrives on your phone within **~15–20 seconds**.
  Read the reply — it should be warm, natural, and relevant.

---

## 🏨 End-to-End Booking Flows

Complete each booking type as a **separate test conversation** (send from your phone, monitor on dashboard):

- [ ] **Couple booking flow (end-to-end)**
  Start with "Couple booking chahiye" → give date → give guest count → confirm married → get price quote → give name → give phone → confirm.
  Verify the AI follows the correct step-by-step flow and quotes the right price.

- [ ] **Group booking flow (end-to-end)**
  Start with "Group booking chahiye" → provide all required info step by step.
  Verify correct per-person pricing and all steps completed.

- [ ] **Picnic booking flow (end-to-end)**
  Start with "Picnic booking chahiye" → complete all steps.
  Verify correct pricing (Rs 1000 morning-evening / Rs 1250 full day).

---

## 🔀 Mode Switching (Live)

- [ ] **Per-chat mode toggle**
  While in an active conversation, toggle the chat mode from "AI" to "Human" in the dashboard.
  Send another message from your phone — confirm the AI does **NOT** reply (human mode).
  Toggle back to "AI" — send a message — confirm the AI **does** reply.

- [ ] **Global mode toggle**
  Switch the global mode to "Human" in Settings.
  Send a message from a new number or new chat — confirm no AI reply.
  Switch back to "AI" — confirm AI replies resume.

---

## 🔔 Follow-Up System

- [ ] **Manual follow-up trigger**
  Using MongoDB Compass or `mongosh`, insert a FollowUp document with a **past** `scheduledFor` date:
  ```js
  db.followups.insertOne({
    chatId: "<an_existing_chat_ObjectId>",
    type: "reminder_1",
    scheduledFor: new Date(Date.now() - 60000),  // 1 minute in the past
    status: "pending",
    createdAt: new Date()
  })
  ```
  Confirm the follow-up message is sent to the customer's WhatsApp within **~5 minutes** (next cron cycle).

- [ ] **Follow-up cancellation via "stop"**
  Send the word **"stop"** from the test phone.
  Confirm that any pending follow-ups for that chat are cancelled (check the DB — status should change to `"cancelled"`).

---

## 🔄 Resilience

- [ ] **Backend restart — WhatsApp reconnects without re-scanning**
  Stop the backend (`Ctrl+C` or `pm2 stop`).
  Start it again (`npm run dev` or `pm2 start`).
  Confirm the WhatsApp session reconnects automatically — the dashboard should show "Connected" again **without** requiring a new QR scan.

---

## 🛡️ AI Fallback Tiers (Groq, Cerebras, Cloudflare, Gemini, OpenRouter)

- [ ] **Verify Fallback Provider Tiers**
  Ensure all fallback credentials are set in your `.env` file (or keep them blank to test dynamic skipping).
  - TIER 1: Groq (`GROQ_API_KEY`)
  - TIER 2: Cerebras (`CEREBRAS_API_KEY`)
  - TIER 3: Cloudflare (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`)
  - TIER 4: Google Gemini (`GEMINI_API_KEY`)
  - TIER 5: OpenRouter (`OPENROUTER_API_KEY`)
  
- [ ] **Test Fallback Transition (Simulated)**
  Run the automated test suite `npm run test-ai` to see how the system handles failovers when some providers hit quotas or fail validation. Check logs for transition flows (e.g. `[TIER X - ...] invalid/failed, falling to TIER Y`).

---

## 📱 PWA / Mobile

- [ ] **Mobile browser — "Add to Home Screen"**
  Open the dashboard URL on a mobile browser (Chrome on Android or Safari on iOS).
  Verify the "Add to Home Screen" prompt appears (or can be triggered from the browser menu).
  Add it and open from the home screen — confirm it loads correctly in standalone mode.

---

## ✅ Sign-Off

| Area                  | Tester | Date | Pass/Fail | Notes |
|-----------------------|--------|------|-----------|-------|
| WhatsApp Connection   |        |      |           |       |
| Couple Booking Flow   |        |      |           |       |
| Group Booking Flow    |        |      |           |       |
| Picnic Booking Flow   |        |      |           |       |
| Per-Chat Mode         |        |      |           |       |
| Global Mode           |        |      |           |       |
| Follow-Up Trigger     |        |      |           |       |
| Follow-Up Stop        |        |      |           |       |
| Groq / Cerebras Tiers |        |      |           |       |
| Cloudflare Tier        |        |      |           |       |
| Backend Restart       |        |      |           |       |
| PWA Mobile            |        |      |           |       |

