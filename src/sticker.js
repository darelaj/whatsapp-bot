'use strict';

const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const PACK_NAME   = process.env.STICKER_PACK_NAME || 'made by';
const AUTHOR_NAME = process.env.STICKER_AUTHOR    || 'Chroma';

// ────────────────────────────────────────────────────────────────────────────
// Image → Static WebP sticker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert any static image (JPEG, PNG, WebP, AVIF…) to a 512×512 WhatsApp sticker.
 * Uses wa-sticker-formatter which handles VP8X + EXIF chunk injection correctly.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function imageToSticker(buffer) {
  return new Sticker(buffer, {
    pack      : PACK_NAME,
    author    : AUTHOR_NAME,
    type      : StickerTypes.FULL,   // fit/fill to 512×512
    categories: ['🎨'],
    quality   : 80,
  }).toBuffer();
}

// ────────────────────────────────────────────────────────────────────────────
// Video / GIF → Animated WebP sticker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a video or GIF buffer to an animated WhatsApp sticker.
 * wa-sticker-formatter uses ffmpeg internally for video → animated WebP.
 * @param {Buffer} buffer
 * @param {string} mimetype  e.g. 'video/mp4' | 'image/gif' | 'video/webm'
 * @returns {Promise<Buffer>}
 */
async function videoToSticker(buffer, mimetype) {
  return new Sticker(buffer, {
    pack      : PACK_NAME,
    author    : AUTHOR_NAME,
    type      : StickerTypes.FULL,
    categories: ['🎨'],
    quality   : 80,
  }).toBuffer();
}

module.exports = { imageToSticker, videoToSticker };
