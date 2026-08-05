const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns/promises');
const net = require('net');

const outputDirectory = path.join(__dirname, '..', 'public', 'images', 'menu');
const maxBytes = 3 * 1024 * 1024;
const allowedTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const validateImageBytes = (bytes, contentType) => {
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Image must be smaller than 3 MB');
  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!allowedTypes[normalizedType]) throw new Error('Use a JPG, PNG, or WebP image');

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const signatureMatches = (normalizedType === 'image/jpeg' && isJpeg)
    || (normalizedType === 'image/png' && isPng)
    || (normalizedType === 'image/webp' && isWebp);
  if (!signatureMatches) throw new Error('The selected file is not a valid image');
  return { bytes, extension: allowedTypes[normalizedType] };
};

const decodeProductImage = (dataUrl) => {
  if (typeof dataUrl !== 'string') throw new Error('Select an image to upload');
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || !allowedTypes[match[1]]) {
    throw new Error('Upload a JPG, PNG, or WebP image');
  }
  const bytes = Buffer.from(match[2], 'base64');
  return validateImageBytes(bytes, match[1]);
};

const isPrivateAddress = (address) => {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  const value = address.toLowerCase();
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
};

const downloadProductImage = async (value) => {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter a valid HTTPS image URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Image URL must use HTTPS');
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) {
    throw new Error('This image URL is not allowed');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'AIBill/1.0' }
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Image URL took too long to respond');
    throw new Error('Could not download the image URL');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Image URL returned ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw new Error('Image must be smaller than 3 MB');
  const bytes = Buffer.from(await response.arrayBuffer());
  return validateImageBytes(bytes, response.headers.get('content-type'));
};

const saveProductImage = async (productId, decoded) => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const fileName = `upload-${productId}-${crypto.randomUUID()}.${decoded.extension}`;
  await fs.writeFile(path.join(outputDirectory, fileName), decoded.bytes, { flag: 'wx' });
  return `/images/menu/${fileName}`;
};

const removeUploadedProductImage = async (imagePath) => {
  if (typeof imagePath !== 'string' || !/^\/images\/menu\/upload-[A-Za-z0-9.-]+$/.test(imagePath)) return;
  const fileName = path.basename(imagePath);
  await fs.unlink(path.join(outputDirectory, fileName)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
};

module.exports = {
  decodeProductImage,
  downloadProductImage,
  saveProductImage,
  removeUploadedProductImage
};
