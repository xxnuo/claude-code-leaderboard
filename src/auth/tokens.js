import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { loadConfig, saveConfig } from '../utils/config.js';

// Derive a proper encryption key from the environment variable
const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_KEY || 'default_key_change_in_production';
const ALGORITHM = 'aes-256-gcm';
const SALT = 'codebrag-salt';

// Derive a 32-byte key from the password
function deriveKey(password) {
  return createHash('sha256').update(password + SALT).digest();
}

function encryptToken(token) {
  try {
    const key = deriveKey(ENCRYPTION_PASSWORD);
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

function decryptToken(encryptedToken) {
  try {
    // Check if token is in encrypted format
    if (!encryptedToken.includes(':')) {
      // Assume it's plain text (for backward compatibility)
      return encryptedToken;
    }
    
    const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
    
    const key = deriveKey(ENCRYPTION_PASSWORD);
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
  
  config.oauth_token = encryptToken(oauthToken);
  config.oauth_token_secret = encryptToken(oauthTokenSecret);
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
    oauth_token: decryptToken(config.oauth_token),
    oauth_token_secret: decryptToken(config.oauth_token_secret)
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