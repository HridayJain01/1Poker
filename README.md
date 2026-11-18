# 1Poker

Private, phone-first poker rooms for friends. Create a room, share the 5-letter code, play.

**Games:** Texas Hold'em, Omaha (4/5/6 cards, Hi-Lo, double/triple board), Irish, Pineapple, Crazy Pineapple, Short Deck, Teen Patti, Teen Patti Muflis — No-Limit / Pot-Limit / Limit.
**Rooms:** fixed game, custom (host switches games any time), or dealer's choice. 2–10 seats.
**Banks:** every rebuy is counted (bank #1, #2…), ledger with net and settle-up.
**Fun:** stickers (upload WhatsApp .webp), voice notes, sound stickers, spoken phrases, face snaps, selfie avatars.

## Run locally
```bash
npm install
npm run dev        # client on :5173, server on :3001
```

## Deploy (single Node service)
```bash
npm install && npm run build
npm start          # serves app + websockets on $PORT (default 3001)
```
Works on Render / Railway / Fly.io (or use the Dockerfile). Use **one instance** (rooms live in memory).
HTTPS is required for camera and microphone — these hosts provide it automatically.

- Render: New → Web Service → this repo. Build: `npm install && npm run build`, Start: `npm start`.
- Vercel/Netlify alone can't run it: the game needs a long-running server for live connections.

## How to play
- **Change the game (host):** ☰ menu → Host controls → pick a game (e.g. Omaha 5 cards + Hi-Lo + Double board, or Irish) → Save. It starts on the next hand. Room mode must be *Custom*.
- **Dealer's choice:** set Room mode to *Dealer's pick* — whoever has the button chooses each hand.
- **Banks:** when you bust, tap *Take bank #2*. The ☰ → Ledger shows everyone's banks, net result and who pays whom.
- **Stickers & sounds:** 😀 button for one-tap reactions; chat → Stickers to add your WhatsApp .webp stickers; chat → Sounds → Create to record a sound onto an emoji (e.g. "FAAAH").

## Tests
```bash
npm test           # engine, pots, betting rules, 7,600 random hands, server end-to-end
npm run e2e        # browser test: 3 phones play through every feature (needs: npx playwright install chromium)
```
