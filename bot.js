'use strict';

require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./src/handler');

const logger = pino({ level: 'silent' });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // we handle it manually below
    browser: ['ChromaBot', 'Chrome', '10.0'],
  });

  // Save credentials whenever they update
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates (QR, open, close)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code with your WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(
        '❌ Connection closed. Reason:',
        lastDisconnect?.error?.message,
        '| Reconnecting:',
        shouldReconnect
      );

      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        console.log('🚫 Logged out. Delete auth_info_baileys/ and restart to re-link.');
        process.exit(0);
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp bot connected! Send .s with an image/video to make a sticker.');
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await handleMessage(sock, msg);
    }
  });
}

startBot().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
