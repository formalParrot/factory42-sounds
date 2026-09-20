# Discord Voice Greeter

Sits in one voice channel 24/7 and plays a sound when someone joins or leaves it.

## Setup
1. Create a bot at https://discord.com/developers/applications → Bot → copy the token.
   No privileged intents needed.
2. Invite it with the scopes `bot` and permissions **View Channel, Connect, Speak**.
3. Enable Developer Mode in Discord, then right-click your server / voice channel → **Copy ID**.
4. Run:
   ```
   cp .env.example .env    # fill in the 3 values
   npm install
   npm start
   ```
5. Replace `sounds/join.wav` and `sounds/leave.wav` with your own (mp3, wav or ogg, named `join.*` / `leave.*`).

## Keeping it online 24/7
Run it on an always-on machine or VPS with a process manager:
```
npm install -g pm2
pm2 start index.js --name voice-greeter
pm2 save && pm2 startup
```
The bot auto-reconnects to the channel if it's disconnected, and a 30s watchdog rejoins if needed.
