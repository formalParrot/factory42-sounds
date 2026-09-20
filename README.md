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
5. Keep the default sounds as `sounds/join.mp3` and `sounds/leave.mp3`.
6. Add purchasable sounds to `sounds/` with a `c-` prefix, such as `sounds/c-airhorn.mp3` or `sounds/c-applause.wav`. Only files with this prefix can be bought.
7. Users can buy sounds with `/buy`, then equip one with `/equip`. The `c-` prefix is hidden in Discord.
8. Everyone can see `/give` and `/take`, but only members with role ID `1551232729444786187` can use them. Unauthorized attempts receive an ephemeral error. `/leaderboard` privately shows the top balances; workers can use `/leaderboard-public` to post it publicly.

## Keeping it online 24/7
Run it on an always-on machine or VPS with a process manager:
```
npm install -g pm2
pm2 start index.js --name voice-greeter
pm2 save && pm2 startup
```
The bot auto-reconnects to the channel if it's disconnected, and a 30s watchdog rejoins if needed.
