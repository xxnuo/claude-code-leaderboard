/**
 * Simplified auto-reset module
 * If user doesn't have a CLI version in the database, delete them and force re-auth
 */

import { loadConfig, clearAuthData, removeAllClaudeCountFiles } from './config.js';
import { CLI_VERSION } from './constants.js';

/**
 * Check if user needs a full reset (delete and re-auth)
 * Returns true if user exists but has no CLI version or old version
 */
export async function checkNeedsFullReset() {
  try {
    // Check if user has OAuth tokens in config file
    const config = await loadConfig();
    
    if (!config.oauth_token || !config.oauth_token_secret) {
      // Not authenticated, no reset needed
      return { needsReset: false, reason: 'not_authenticated' };
    }
    
    // Check with server if user has a CLI version
    const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
    const url = `${base}/api/user/version-check`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OAuth-Token': config.oauth_token,
        'X-OAuth-Token-Secret': config.oauth_token_secret,
        'X-CLI-Version': CLI_VERSION
      },
      body: JSON.stringify({
        cli_version: CLI_VERSION
      })
    });
    
    if (response.status === 404) {
      // User not found - maybe they were deleted, clear local auth
      return { needsReset: true, reason: 'user_not_found', clearLocalOnly: true };
    }
    
    if (!response.ok) {
      // Error checking version - don't reset
      console.error(`Version check failed with status ${response.status}`);
      return { needsReset: false, reason: 'version_check_failed' };
    }
    
    const result = await response.json();
    
    // If migration is needed, we need a full reset
    if (result.needs_migration) {
      return { 
        needsReset: true, 
        reason: result.reason,
        twitterHandle: config.twitterUrl
      };
    }
    
    return { needsReset: false, reason: 'up_to_date' };
    
  } catch (error) {
    // Network errors should not trigger reset
    console.error('Version check error:', error.message);
    return { needsReset: false, reason: 'version_check_error' };
  }
}

/**
 * Delete user from database
 */
export async function deleteUserFromDatabase(config) {
  const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
  const url = `${base}/api/user/delete`;
  
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-OAuth-Token': config.oauth_token,
        'X-OAuth-Token-Secret': config.oauth_token_secret
      }
    });
    
    if (response.status === 404) {
      // User already doesn't exist, that's fine
      return { success: true, alreadyDeleted: true };
    }
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to delete user:', error);
      return { success: false, error };
    }
    
    const result = await response.json();
    return { success: true, result };
    
  } catch (error) {
    console.error('Error deleting user:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Perform full reset: delete user from DB and clear local auth
 */
export async function performFullReset(config) {
  // Step 1: Delete user from database (if they exist)
  const deleteResult = await deleteUserFromDatabase(config);
  
  // Step 2: Clear local auth data regardless of delete result
  // This ensures user can re-auth even if delete failed
  await clearAuthData();
  
  return {
    deleted: deleteResult.success,
    cleared: true
  };
}