'use strict';

const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);

const PACK_NAME   = process.env.STICKER_PACK_NAME || 'made by';
const AUTHOR_NAME = process.env.STICKER_AUTHOR    || 'Chroma';

/**
 * Maximum animated sticker duration in seconds.
 * WhatsApp's official WebP spec allows up to 10 s, but the in-app sticker
 * creator trims to 6 s — so we match that to stay on the safe side.
 */
const MAX_DURATION_SECS = 6;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Probe the duration (in seconds) of a media buffer using ffprobe.
 * Returns 0 if the duration cannot be determined.
 * @param {string} inputPath  Path to the temp file
 * @returns {Promise<number>}
 */
function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) return resolve(0);
      resolve(parseFloat(metadata.format.duration) || 0);
    });
  });
}

/**
 * Trim a media buffer to `maxSecs` seconds using ffmpeg.
 * Returns the original buffer unchanged if within the limit.
 * @param {Buffer} buffer
 * @param {string} inputExt   e.g. '.mp4' | '.gif' | '.webm'
 * @param {string} outputExt  e.g. '.mp4' | '.gif'
 * @param {number} [maxSecs]
 * @returns {Promise<Buffer>}
 */
function trimBuffer(buffer, inputExt, outputExt, maxSecs = MAX_DURATION_SECS) {
  return new Promise((resolve, reject) => {
    const id      = crypto.randomBytes(8).toString('hex');
    const tmpDir  = os.tmpdir();
    const inFile  = path.join(tmpDir, `sticker_in_${id}${inputExt}`);
    const outFile = path.join(tmpDir, `sticker_out_${id}${outputExt}`);

    fs.writeFileSync(inFile, buffer);

    probeDuration(inFile).then((duration) => {
      if (duration > 0 && duration <= maxSecs) {
        // Already within limit — no trimming needed
        fs.unlinkSync(inFile);
        return resolve(buffer);
      }

      const cmd = ffmpeg(inFile)
        .setDuration(maxSecs)
        .outputOptions('-an')          // drop audio — stickers are muted
        .output(outFile);

      // For GIF output keep the palette-based encoding
      if (outputExt === '.gif') {
        cmd.outputOptions(['-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=decrease']);
      } else {
        // MP4: re-encode quickly
        cmd.videoCodec('libx264').outputOptions(['-preset', 'ultrafast', '-crf', '28']);
      }

      cmd
        .on('error', (err) => {
          safeUnlink(inFile);
          safeUnlink(outFile);
          reject(new Error(`ffmpeg trim error: ${err.message}`));
        })
        .on('end', () => {
          let out;
          try {
            out = fs.readFileSync(outFile);
          } catch (e) {
            safeUnlink(inFile);
            safeUnlink(outFile);
            return reject(new Error('Failed to read trimmed output'));
          }
          safeUnlink(inFile);
          safeUnlink(outFile);
          resolve(out);
        })
        .run();
    });
  });
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// ────────────────────────────────────────────────────────────────────────────
// Image → Static WebP sticker
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
// Video / GIF → Animated WebP sticker (with auto-trim)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a video or GIF buffer to an animated WhatsApp sticker.
 * Automatically trims to MAX_DURATION_SECS if the media is too long.
 * @param {Buffer} buffer
 * @param {string} mimetype  e.g. 'video/mp4' | 'image/gif' | 'video/webm'
 * @returns {Promise<Buffer>}
 */
async function videoToSticker(buffer, mimetype) {
  const isGif = mimetype === 'image/gif';
  const inputExt  = isGif ? '.gif' : '.mp4';
  const outputExt = isGif ? '.gif' : '.mp4';

  // Trim to limit before converting — if already short enough this is a no-op
  const trimmed = await trimBuffer(buffer, inputExt, outputExt);

  return new Sticker(trimmed, {
    pack      : PACK_NAME,
    author    : AUTHOR_NAME,
    type      : StickerTypes.FULL,
    categories: ['🎨'],
    quality   : 80,
  }).toBuffer();
}

module.exports = { imageToSticker, videoToSticker };
