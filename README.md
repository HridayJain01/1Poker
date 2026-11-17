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

## Tests
```bash
npm test
```
