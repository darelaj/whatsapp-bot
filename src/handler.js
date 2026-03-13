'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { imageToSticker, videoToSticker } = require('./sticker');

const COMMAND = '.s';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** React to a message with an emoji */
async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (_) { /* non-fatal */ }
}

/** Reply with plain text */
async function reply(sock, msg, text) {
  try {
    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
  } catch (_) { /* non-fatal */ }
}

/**
 * Build a minimal message object safe for downloadMediaMessage.
 * In personal (DM) chats, contextInfo.participant is undefined — we must
 * NOT include it in the key or Baileys will fail to decrypt the media.
 */
function buildDownloadMsg(originalMsg, quotedContent, quotedKey, mediaField) {
  const key = {
    remoteJid: originalMsg.key.remoteJid,
    id: quotedKey.stanzaId,
    fromMe: false,
  };

  // Only add participant if it actually exists (group chats)
  if (quotedKey.participant) {
    key.participant = quotedKey.participant;
  }

  return {
    key,
    message: { [mediaField]: quotedContent[mediaField] },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {import('@whiskeysockets/baileys').WAMessage} msg
 */
async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;

    // Skip sticker messages — prevents feedback loops when the bot sends stickers to itself
    if (msg.message.stickerMessage) return;

    const from = msg.key.remoteJid;

    // Unwrap ephemeral / view-once / document-with-caption wrappers
    const rawMessage =
      msg.message?.ephemeralMessage?.message ||
      msg.message?.viewOnceMessage?.message ||
      msg.message?.viewOnceMessageV2?.message ||
      msg.message?.documentWithCaptionMessage?.message ||
      msg.message;

    const msgType = Object.keys(rawMessage)[0];

    let mediaMsg = null;
    let mediaType = null; // 'image' | 'video'
    let isGif = false;

    // ── Case 1: Direct image/video/gif with .s caption ──────────────────────
    if (msgType === 'imageMessage') {
      const caption = (rawMessage.imageMessage.caption || '').trim().toLowerCase();
      if (caption === COMMAND) {
        mediaMsg = { ...msg, message: rawMessage };
        mediaType = 'image';
      }

    } else if (msgType === 'videoMessage') {
      const caption = (rawMessage.videoMessage.caption || '').trim().toLowerCase();
      if (caption === COMMAND) {
        mediaMsg = { ...msg, message: rawMessage };
        mediaType = 'video';
        isGif = !!rawMessage.videoMessage.gifPlayback;
      }

      // ── Case 2: Text ".s" as a reply to a media message ─────────────────────
    } else if (msgType === 'extendedTextMessage') {
      const text = (rawMessage.extendedTextMessage.text || '').trim().toLowerCase();

      if (text === COMMAND) {
        const ctxInfo = rawMessage.extendedTextMessage.contextInfo;
        const quoted = ctxInfo?.quotedMessage;

        if (!quoted) {
          await reply(sock, msg, '❌ Reply to an image, video, or GIF with *.s* to make a sticker.');
          return;
        }

        // Unwrap quoted wrappers too
        const quotedInner =
          quoted?.ephemeralMessage?.message ||
          quoted?.viewOnceMessage?.message ||
          quoted?.documentWithCaptionMessage?.message ||
          quoted;

        const quotedType = Object.keys(quotedInner)[0];

        if (quotedType === 'imageMessage') {
          mediaMsg = buildDownloadMsg(msg, quotedInner, ctxInfo, 'imageMessage');
          mediaType = 'image';
        } else if (quotedType === 'videoMessage') {
          mediaMsg = buildDownloadMsg(msg, quotedInner, ctxInfo, 'videoMessage');
          mediaType = 'video';
          isGif = !!quotedInner.videoMessage.gifPlayback;
        } else if (quotedType === 'stickerMessage') {
          await reply(sock, msg, '⚠️ That\'s already a sticker! Send an image or video.');
          return;
        } else {
          await reply(sock, msg, '❌ I can only convert images, videos, and GIFs to stickers.');
          return;
        }
      }

      // ── Case 3: Standalone conversation ".s help" ────────────────────────────
    } else if (msgType === 'conversation') {
      const text = (rawMessage.conversation || '').trim().toLowerCase();
      if (text === `${COMMAND} help` || text === `${COMMAND}help`) {
        await reply(sock, msg,
          `*🎨 Sticker Bot — Help*\n\n` +
          `• Send an *image* captioned \`${COMMAND}\` → static sticker\n` +
          `• Send a *video/GIF* captioned \`${COMMAND}\` → animated sticker\n` +
          `• *Reply* to any image/video/GIF with \`${COMMAND}\` → sticker from that media\n\n` +
          `_Pack: made by | Author: Chroma_`
        );
      }
      return;
    } else {
      return;
    }

    if (!mediaMsg || !mediaType) return;

    // ── Download ─────────────────────────────────────────────────────────────
    try {
      await sock.sendPresenceUpdate('composing', from);
    } catch (_) { /* presence update is non-critical */ }

    await react(sock, msg, '⏳');

    let buffer;
    try {
      buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
    } catch (downloadErr) {
      console.error('Download failed:', downloadErr.message);
      await react(sock, msg, '❌');
      await reply(sock, msg, '❌ Failed to download the media. Please try again.');
      return;
    }

    // ── Convert ───────────────────────────────────────────────────────────────
    let stickerBuffer;
    try {
      if (mediaType === 'image') {
        stickerBuffer = await imageToSticker(buffer);
      } else {
        const mime = isGif ? 'image/gif' : (mediaMsg.message?.videoMessage?.mimetype || 'video/mp4');
        stickerBuffer = await videoToSticker(buffer, mime);
      }
    } catch (convertErr) {
      console.error('Conversion failed:', convertErr.message);
      await react(sock, msg, '❌');
      await reply(sock, msg, '❌ Conversion failed. Make sure the media is a valid image/video/GIF.');
      return;
    }

    // ── Send sticker ──────────────────────────────────────────────────────────
    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
    await react(sock, msg, '✅');

    try {
      await sock.sendPresenceUpdate('paused', from);
    } catch (_) { /* non-critical */ }

  } catch (err) {
    console.error('handleMessage error:', err.message, err.stack);
  }
}

module.exports = { handleMessage };
