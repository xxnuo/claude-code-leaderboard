import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { loadConfig, saveConfig, ensureConfigDir, CLAUDE_DIR } from '../utils/config.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { chmod } from 'fs/promises';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_PATH = join(CLAUDE_DIR, '.encryption_key');

// Generate a secure random encryption key
function generateEncryptionKey() {
  return randomBytes(32);
}

// Load or create encryption key
async function getOrCreateEncryptionKey() {
  await ensureConfigDir();
  
  if (existsSync(ENCRYPTION_KEY_PATH)) {
    try {
      const keyBuffer = await readFile(ENCRYPTION_KEY_PATH);
      return keyBuffer;
    } catch (error) {
      console.error('Error reading encryption key:', error);
    }
  }
  
  // Generate new key
  const newKey = generateEncryptionKey();
  
  try {
    // Write key with restricted permissions
    await writeFile(ENCRYPTION_KEY_PATH, newKey);
    await chmod(ENCRYPTION_KEY_PATH, 0o600); // Read/write for owner only
    return newKey;
  } catch (error) {
    console.error('Error saving encryption key:', error);
    // Fallback to in-memory key (not ideal but prevents total failure)
    return newKey;
  }
}

async function encryptToken(token) {
  try {
    const key = await getOrCreateEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV, authTag, and encrypted data
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (error) {
    // If encryption fails, return token as-is (not recommended for production)
    console.warn('Token encryption failed, storing as plain text');
    return token;
  }
}

async function decryptToken(encryptedToken) {
  try {
    // Check if token is in encrypted format
    if (!encryptedToken.includes(':')) {
      // Assume it's plain text (for backward compatibility)
      return encryptedToken;
    }
    
    const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
    
    const key = await getOrCreateEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails, assume token is plain text
    return encryptedToken;
  }
}


// Store OAuth 1.0a tokens
export async function storeOAuth1aTokens(oauthToken, oauthTokenSecret) {
  const config = await loadConfig();
  
  config.oauth_token = await encryptToken(oauthToken);
  config.oauth_token_secret = await encryptToken(oauthTokenSecret);
  config.oauthVersion = '1.0a';
  
  await saveConfig(config);
}

export async function getTokens() {
  const config = await loadConfig();
  
  // Check for OAuth 1.0a tokens
  if (!config.oauth_token || !config.oauth_token_secret) {
    return null;
  }
  
  return {
    oauthVersion: '1.0a',
    oauth_token: await decryptToken(config.oauth_token),
    oauth_token_secret: await decryptToken(config.oauth_token_secret)
  };
}

export async function isTokenExpired() {
  const tokens = await getTokens();
  
  if (!tokens) {
    return true;
  }
  
  // OAuth 1.0a tokens never expire
  return false;
}

export async function refreshAccessToken() {
  const tokens = await getTokens();
  
  if (!tokens) {
    throw new Error('No tokens available');
  }
  
  // OAuth 1.0a tokens don't need refreshing
  return tokens;
}

export async function getValidAccessToken() {
  const tokens = await getTokens();
  
  if (!tokens) {
    throw new Error('No tokens available - please authenticate first');
  }
  
  // OAuth 1.0a tokens are always valid (unless revoked)
  return tokens;
}