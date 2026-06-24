'use strict';

const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);

const PACK_NAME   = process.env.STICKER_PACK_NAME || 'made by';
const AUTHOR_NAME = process.env.STICKER_AUTHOR    || 'Chroma';

/**
 * WhatsApp animated sticker constraints:
 * - Format:     WebP
 * - Dimensions: 512×512 px
 * - File size:  ≤ 500 KB (animated), ≤ 100 KB (static)
 * - Duration:   ≤ 6 s (safe limit; official max is 10 s)
 * - Min frame duration: 8 ms
 * - No audio
 */
const MAX_DURATION_SECS     = 6;
const MAX_ANIMATED_SIZE_KB  = 500;
const STICKER_DIMENSION     = 512;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function tmpFile(ext) {
  const id = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `sticker_${id}${ext}`);
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

/**
 * Probe the duration (in seconds) of a media buffer using ffprobe.
 * Returns 0 if the duration cannot be determined.
 */
function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) return resolve(0);
      resolve(parseFloat(metadata.format.duration) || 0);
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Image → Static WebP sticker (via wa-sticker-formatter — works fine)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert any static image (JPEG, PNG, WebP, AVIF…) to a 512×512 WhatsApp sticker.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function imageToSticker(buffer) {
  return new Sticker(buffer, {
    pack      : PACK_NAME,
    author    : AUTHOR_NAME,
    type      : StickerTypes.FULL,
    categories: ['🎨'],
    quality   : 80,
  }).toBuffer();
}

// ────────────────────────────────────────────────────────────────────────────
// Video / GIF → Animated WebP sticker (direct ffmpeg, bypassing the broken
// wa-sticker-formatter video pipeline)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Use ffmpeg to convert a video/GIF buffer directly to an animated WebP
 * that meets ALL WhatsApp sticker constraints.
 *
 * Strategy:
 *   1. Write input to temp file
 *   2. Probe duration — clamp to MAX_DURATION_SECS
 *   3. Encode to animated WebP at 512×512, ≤ 500 KB
 *      - Start at quality 60, fps 15
 *      - If output > 500 KB, retry with lower quality / fps
 *   4. Inject sticker pack metadata via wa-sticker-formatter's Exif helper
 *
 * @param {Buffer} buffer    Raw media bytes
 * @param {string} mimetype  e.g. 'video/mp4' | 'image/gif' | 'video/webm'
 * @returns {Promise<Buffer>}
 */
async function videoToSticker(buffer, mimetype) {
  const isGif   = mimetype === 'image/gif';
  const inExt   = isGif ? '.gif' : '.mp4';
  const inFile  = tmpFile(inExt);
  const outFile = tmpFile('.webp');

  fs.writeFileSync(inFile, buffer);

  try {
    const duration = await probeDuration(inFile);

    // Try progressively lower quality/fps until ≤ 500 KB
    const attempts = [
      { quality: 60, fps: 15 },
      { quality: 45, fps: 12 },
      { quality: 30, fps: 10 },
      { quality: 20, fps: 8  },
      { quality: 10, fps: 6  },
    ];

    let webpBuffer = null;

    for (const { quality, fps } of attempts) {
      await encodeAnimatedWebP(inFile, outFile, {
        maxDuration : (duration > MAX_DURATION_SECS || duration === 0) ? MAX_DURATION_SECS : 0,
        fps,
        quality,
        dimension   : STICKER_DIMENSION,
      });

      webpBuffer = fs.readFileSync(outFile);
      const sizeKB = webpBuffer.length / 1024;

      console.log(`[sticker] Animated WebP: ${sizeKB.toFixed(1)} KB (q=${quality}, fps=${fps})`);

      if (sizeKB <= MAX_ANIMATED_SIZE_KB) {
        break;  // 🎉 within limit
      }

      // Will retry with lower settings
      safeUnlink(outFile);
      webpBuffer = null;
    }

    if (!webpBuffer) {
      // If all attempts failed to get under 500 KB, use the last attempt anyway
      // (better than nothing — WhatsApp may still accept slightly larger stickers)
      webpBuffer = fs.existsSync(outFile) ? fs.readFileSync(outFile) : null;
      if (!webpBuffer) {
        throw new Error('All encoding attempts failed');
      }
    }

    // Inject sticker pack metadata using wa-sticker-formatter's Exif writer
    const Exif = require('wa-sticker-formatter/dist/internal/Metadata/Exif').default;
    const exif = new Exif({
      pack      : PACK_NAME,
      author    : AUTHOR_NAME,
      categories: ['🎨'],
    });
    const finalBuffer = exif.add(webpBuffer);

    return finalBuffer;
  } finally {
    safeUnlink(inFile);
    safeUnlink(outFile);
  }
}

/**
 * Encode a media file to animated WebP using ffmpeg directly.
 *
 * @param {string} input   Input file path
 * @param {string} output  Output file path (.webp)
 * @param {object} opts
 * @param {number} opts.maxDuration  Trim to this many seconds (0 = no trim)
 * @param {number} opts.fps          Target frame rate
 * @param {number} opts.quality      WebP quality 0-100
 * @param {number} opts.dimension    Target width & height (512)
 * @returns {Promise<void>}
 */
function encodeAnimatedWebP(input, output, { maxDuration, fps, quality, dimension }) {
  return new Promise((resolve, reject) => {
    const vf = [
      `fps=${fps}`,
      `scale=${dimension}:${dimension}:force_original_aspect_ratio=decrease`,
      `pad=${dimension}:${dimension}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,  // transparent padding
    ].join(',');

    const cmd = ffmpeg(input);

    if (maxDuration > 0) {
      cmd.setDuration(maxDuration);
    }

    cmd
      .outputOptions([
        '-vf', vf,
        '-vcodec', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', String(quality),
        '-loop', '0',          // loop forever
        '-an',                 // no audio
        '-vsync', '0',
      ])
      .output(output)
      .on('error', (err) => reject(new Error(`ffmpeg encode error: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

module.exports = { imageToSticker, videoToSticker };
