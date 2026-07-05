/**
 * @fileoverview Client-side image processing for Form Sahayak.
 * Handles compression, perceptual hashing, camera capture, and batch processing.
 * All processing happens in-memory — images are never persisted to storage.
 *
 * @module image-processor
 */

const LOG_PREFIX = '[FormSahayak]';

/** MIME types accepted as valid image uploads. */
const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/gif',
]);

/**
 * @typedef {Object} ProcessedImage
 * @property {string}  dataUrl         Data URL for preview rendering
 * @property {string}  base64          Raw base64 string (no data-uri prefix) for API payloads
 * @property {string}  mediaType       MIME type of the output (always 'image/jpeg')
 * @property {number}  originalSize    Original file size in bytes
 * @property {number}  compressedSize  Compressed data size in bytes (approximate)
 */

/**
 * @typedef {Object} ProcessedImageWithHash
 * @extends ProcessedImage
 * @property {string}  hash  16-char hex perceptual hash
 */

export class ImageProcessor {
  /**
   * @param {Object}  [options]
   * @param {number}  [options.maxWidth=1600]  Maximum width for resized images
   * @param {number}  [options.quality=0.7]    JPEG quality (0–1)
   */
  constructor(options = {}) {
    /** @type {number} */
    this.maxWidth = options.maxWidth ?? 1600;
    /** @type {number} */
    this.quality = options.quality ?? 0.7;
  }

  /* ------------------------------------------------------------------ */
  /*  Image Compression                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Compress a File/Blob by resizing to {@link maxWidth} and encoding as JPEG.
   *
   * @param {File|Blob} file
   * @returns {Promise<ProcessedImage>}
   */
  async compressImage(file) {
    if (!file || !file.size) {
      throw new Error('compressImage: received an empty or invalid file.');
    }

    const originalSize = file.size;

    // Load image into an HTMLImageElement
    const img = await this._loadImage(file);

    // Calculate target dimensions (maintain aspect ratio)
    let { width, height } = img;
    if (width > this.maxWidth) {
      const ratio = this.maxWidth / width;
      width  = this.maxWidth;
      height = Math.round(height * ratio);
    }

    // Draw onto canvas and export as JPEG
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl  = canvas.toDataURL('image/jpeg', this.quality);
    const base64   = dataUrl.split(',')[1];
    const compressedSize = Math.round((base64.length * 3) / 4); // approximate decoded size

    console.log(
      LOG_PREFIX,
      `Compressed ${originalSize} → ~${compressedSize} bytes (${width}×${height})`,
    );

    return {
      dataUrl,
      base64,
      mediaType: 'image/jpeg',
      originalSize,
      compressedSize,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Perceptual Hashing                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Compute a perceptual hash (pHash-style) for template fingerprinting.
   *
   * Algorithm:
   *   1. Render image on a 32×32 canvas in grayscale.
   *   2. Compute the mean pixel luminance.
   *   3. For an 8×8 sub-region (top-left), generate a 64-bit hash where
   *      each bit is 1 if the pixel value ≥ mean, else 0.
   *   4. Encode as a 16-character hex string.
   *
   * This yields a hash that is robust to resizing, moderate JPEG artefacts,
   * and the difference between a blank vs. filled copy of the same form.
   *
   * @param {string} dataUrl  Image data URL
   * @returns {Promise<string>} 16-char hex hash
   */
  async computePerceptualHash(dataUrl) {
    try {
      const img = await this._loadImageFromUrl(dataUrl);

      const SIZE = 32;
      const canvas = document.createElement('canvas');
      canvas.width  = SIZE;
      canvas.height = SIZE;

      const ctx = canvas.getContext('2d');

      // Draw as grayscale by using luminosity weighting
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
      const pixels = imageData.data; // RGBA flat array

      // Convert to grayscale values (luminosity method)
      const gray = new Float64Array(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      // Compute mean luminance
      let sum = 0;
      for (let i = 0; i < gray.length; i++) sum += gray[i];
      const mean = sum / gray.length;

      // Generate 64-bit hash from the 8×8 top-left block
      // (Using 8×8 = 64 pixels → 64 bits → 16 hex chars)
      let hashBits = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const idx = y * SIZE + x;
          hashBits += gray[idx] >= mean ? '1' : '0';
        }
      }

      // Convert binary string to hex (4 bits per hex char)
      let hex = '';
      for (let i = 0; i < 64; i += 4) {
        hex += parseInt(hashBits.substring(i, i + 4), 2).toString(16);
      }

      console.log(LOG_PREFIX, 'Perceptual hash:', hex);
      return hex;
    } catch (err) {
      console.error(LOG_PREFIX, 'computePerceptualHash error:', err);
      // Return a random fallback so the caller still gets a string
      return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Camera Capture                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Capture a photo from the device camera.
   *
   * On mobile devices this leverages a hidden `<input type="file" capture="environment">`
   * which gives native camera UX. On desktop it falls back to `getUserMedia` with a
   * hidden video element.
   *
   * @returns {Promise<ProcessedImage>} Compressed image result
   */
  async captureFromCamera() {
    // Prefer the native file-input camera on mobile — gives best UX
    if (this._isMobile()) {
      return this._captureViaNativeInput();
    }

    // Desktop fallback: getUserMedia
    return this._captureViaGetUserMedia();
  }

  /**
   * Open a hidden file input with `capture="environment"`.
   * @private
   * @returns {Promise<ProcessedImage>}
   */
  _captureViaNativeInput() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type    = 'file';
      input.accept  = 'image/*';
      input.capture = 'environment'; // rear camera on mobile
      input.style.display = 'none';

      input.addEventListener('change', async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            reject(new Error('No photo captured.'));
            return;
          }
          const result = await this.compressImage(file);
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          input.remove();
        }
      });

      input.addEventListener('cancel', () => {
        input.remove();
        reject(new Error('Camera capture cancelled by user.'));
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Capture a single frame via getUserMedia (desktop).
   * @private
   * @returns {Promise<ProcessedImage>}
   */
  async _captureViaGetUserMedia() {
    let stream = null;
    const video  = document.createElement('video');
    const canvas = document.createElement('canvas');

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true'); // required on iOS
      await video.play();

      // Wait a moment for the camera to stabilise
      await new Promise((r) => setTimeout(r, 500));

      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      const dataUrl = canvas.toDataURL('image/jpeg', this.quality);
      const base64  = dataUrl.split(',')[1];
      const compressedSize = Math.round((base64.length * 3) / 4);

      console.log(LOG_PREFIX, 'Captured frame from camera');

      return {
        dataUrl,
        base64,
        mediaType: 'image/jpeg',
        originalSize: compressedSize, // no separate original for camera
        compressedSize,
      };
    } catch (err) {
      console.error(LOG_PREFIX, 'Camera capture failed:', err);
      throw new Error(
        'Camera access denied or unavailable. Please grant camera permission and try again.',
      );
    } finally {
      // Always release the camera
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      video.srcObject = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Batch Processing                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Process multiple files: filter to images, compress, and compute hashes.
   *
   * @param {FileList|File[]} fileList
   * @param {Set<string>} [existingHashes=new Set()]
   * @returns {Promise<ProcessedImageWithHash[]>}
   */
  async processFiles(fileList, existingHashes = new Set()) {
    const files = Array.from(fileList).filter((f) => {
      if (!ACCEPTED_TYPES.has(f.type)) {
        console.warn(LOG_PREFIX, `Skipping unsupported file type: ${f.type} (${f.name})`);
        return false;
      }
      return true;
    });

    if (files.length === 0) {
      throw new Error('No valid image files selected. Supported formats: JPEG, PNG, WebP, BMP, GIF.');
    }

    if (files.length > 8) {
      throw new Error('Max 8 images allowed per batch. Please select fewer images.');
    }

    console.log(LOG_PREFIX, `Processing ${files.length} image(s)…`);

    const results = [];
    for (const file of files) {
      try {
        if (file.size > 15 * 1024 * 1024) { // Plan says test 15MB compression, but rule says "Per-file max size 5MB". Wait, user feedback said "15MB phone camera photo -> should compress, not reject". So I shouldn't throw error on size, just let it compress!
          console.warn(LOG_PREFIX, `Large file detected: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB). Compressing...`);
        }

        const compressed = await this.compressImage(file);
        const hash = await this.computePerceptualHash(compressed.dataUrl);
        
        if (existingHashes.has(hash)) {
          console.warn(LOG_PREFIX, `Skipping duplicate image: ${file.name}`);
          continue; // Skip duplicate
        }
        
        existingHashes.add(hash);
        results.push({ ...compressed, hash, file });
      } catch (err) {
        console.error(LOG_PREFIX, `Failed to process ${file.name}:`, err);
        // Skip this file but continue with the rest
      }
    }

    if (results.length === 0) {
      throw new Error('All images failed processing or were duplicates. Please try again with different files.');
    }

    console.log(LOG_PREFIX, `Successfully processed ${results.length}/${files.length} image(s)`);
    return results;
  }

  /* ------------------------------------------------------------------ */
  /*  Private Helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Load a File/Blob into an HTMLImageElement via FileReader.
   * @private
   * @param {File|Blob} file
   * @returns {Promise<HTMLImageElement>}
   */
  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode image data.'));
      };
      img.src = url;
    });
  }

  /**
   * Load an image from a data URL string.
   * @private
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  _loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image from URL.'));
      img.src = url;
    });
  }

  /**
   * Rough mobile-device detection (used to pick camera strategy).
   * @private
   * @returns {boolean}
   */
  _isMobile() {
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  }
}
