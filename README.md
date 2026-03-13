# WhatsApp Sticker Bot

A WhatsApp bot that converts **images and videos** into **stickers** automatically when you send `.s`.

Built with [Baileys](https://github.com/WhiskeySockets/Baileys), [sharp](https://sharp.pixelplumbing.com/), and [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg).

---

## ✨ How to Use

| Scenario | What to do |
|---|---|
| Send an image as sticker | Send image with caption `.s` |
| Send a video as animated sticker | Send video with caption `.s` |
| Convert someone else's image | Reply to the image with `.s` |

---

## 🚀 Local Development

### Prerequisites
- Node.js ≥ 20
- (Optional) ffmpeg installed globally if not using Docker

### Steps

```bash
# 1. Clone / copy project
cd wa-sticker-bot

# 2. Install dependencies
npm install

# 3. Copy env file
cp .env.example .env

# 4. Start the bot
npm start
```

A **QR code** will appear in the terminal. Scan it with your WhatsApp → Linked Devices.

> ⚠️ Use a **secondary WhatsApp number** — bot automation may violate WhatsApp TOS.

---

## 🐳 Docker (Local)

```bash
docker-compose up --build
```

The first time, a QR code will appear in the container logs:

```bash
docker-compose logs -f
```

Scan the QR. Your session is saved in `./auth_info_baileys/` and persists across restarts.

---

## ☁️ Coolify Deployment

1. **Push this project to a Git repository** (GitHub, GitLab, Gitea, etc.)
2. In **Coolify**, create a new **Application** → choose your repo.
3. Set build pack to **Dockerfile**.
4. Add a **Persistent Storage** volume:
   - Container path: `/app/auth_info_baileys`
5. Under **Environment Variables**, add:
   ```
   STICKER_PACK_NAME=made by
   STICKER_AUTHOR=Chroma
   ```
6. Deploy → open **Logs** and scan the QR code that appears.
7. Done! The bot will auto-restart if it disconnects.

---

## 📁 Project Structure

```
.
├── bot.js                  # Entry point — Baileys connection & event loop
├── src/
│   ├── handler.js          # Message handling logic
│   └── sticker.js          # Image/video → WebP conversion
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```
