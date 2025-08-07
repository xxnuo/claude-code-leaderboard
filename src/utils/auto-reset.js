/**
 * Auto-reset module for seamless data synchronization
 * Automatically resets and re-uploads user data without prompts
 */

import ora from 'ora';
import chalk from 'chalk';
import { getValidAccessToken } from '../auth/tokens.js';
import { scanAllHistoricalUsage } from './usage-scanner.js';
import { uploadShardedNdjson } from './bulk-uploader.js';
import { loadConfig } from './config.js';
import { CLI_VERSION } from './constants.js';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const MIGRATION_MARKER_PATH = join(homedir(), '.claude', 'migration_v2_complete');

/**
 * Check with server if migration is needed based on CLI version
 */
async function checkVersionWithServer(tokens) {
  const config = await loadConfig();
  const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
  const url = `${base}/api/user/version-check`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OAuth-Token': tokens.oauth_token,
        'X-OAuth-Token-Secret': tokens.oauth_token_secret
      },
      body: JSON.stringify({
        cli_version: CLI_VERSION
      })
    });
    
    if (!response.ok) {
      // Only trigger migration for 404 (new user) - other errors should not trigger reset
      if (response.status === 404) {
        return { needs_migration: false, reason: 'user_not_found' };
      }
      // For other errors, don't trigger migration
      console.error(`Version check failed with status ${response.status}`);
      return { needs_migration: false, reason: 'version_check_failed' };
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    // Network errors should not trigger migration - just continue normally
    console.error('Version check error:', error.message);
    return { needs_migration: false, reason: 'version_check_error' };
  }
}

/**
 * Reset user data on backend
 */
async function resetUserData(tokens) {
  const config = await loadConfig();
  const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
  const url = `${base}/api/user/reset`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': tokens.oauth_token,
      'X-OAuth-Token-Secret': tokens.oauth_token_secret
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    
    // If user doesn't exist (404), they're probably a new user
    // Skip reset in this case
    if (response.status === 404) {
      return { skipped: true, reason: 'user_not_found' };
    }
    
    throw new Error(`Failed to reset user data: ${error}`);
  }
  
  return await response.json();
}

/**
 * Remove migration marker to allow re-running
 */
async function removeMigrationMarker() {
  if (existsSync(MIGRATION_MARKER_PATH)) {
    try {
      await unlink(MIGRATION_MARKER_PATH);
      return true;
    } catch (error) {
      // Silent fail - not critical
      return false;
    }
  }
  return false;
}

/**
 * Perform silent reset and re-upload of all user data
 * This runs automatically without any user prompts
 */
export async function performSilentReset() {
  try {
    // Check for OAuth tokens - if not authenticated, skip
    const tokens = await getValidAccessToken();
    if (!tokens) {
      return { skipped: true, reason: 'not_authenticated' };
    }
    
    // Check with server if migration is needed
    const versionCheck = await checkVersionWithServer(tokens);
    
    if (!versionCheck.needs_migration) {
      // User is already on the correct version, no need to reset
      return { skipped: true, reason: 'already_up_to_date', version: versionCheck.last_synced_version };
    }
    
    // Remove migration marker to allow re-running
    await removeMigrationMarker();
    
    // Show minimal status (no prompts)
    const resetSpinner = ora('Syncing your usage data...').start();
    
    try {
      // Step 1: Reset backend data
      const resetResult = await resetUserData(tokens);
      
      if (resetResult.skipped) {
        resetSpinner.stop();
        return { skipped: true, reason: resetResult.reason };
      }
      
      // Step 2: Scan all historical usage (silent mode)
      const { entries, totals } = await scanAllHistoricalUsage(false);
      
      if (entries.length === 0) {
        resetSpinner.succeed('No usage data to sync');
        return { success: true, imported: 0 };
      }
      
      // Step 3: Upload all data
      resetSpinner.text = `Uploading ${entries.length.toLocaleString()} usage entries...`;
      
      // Convert entries to NDJSON lines for upload
      const lines = entries.map(e => JSON.stringify({
        timestamp: e.timestamp,
        tokens: e.tokens,
        model: e.model,
        interaction_id: e.interaction_id
      }));
      
      const { processed, failed } = await uploadShardedNdjson({ 
        lines,
        tokens
      });
      
      if (failed > 0) {
        resetSpinner.warn(`Synced ${processed.toLocaleString()} entries (${failed} skipped)`);
      } else {
        resetSpinner.succeed(`Successfully synced ${processed.toLocaleString()} usage entries`);
      }
      
      return { 
        success: true, 
        imported: processed, 
        failed,
        total_tokens: totals.total
      };
      
    } catch (error) {
      resetSpinner.fail('Sync failed - will retry on next run');
      // Don't throw - we want to continue with normal flow
      return { 
        success: false, 
        error: error.message 
      };
    }
    
  } catch (error) {
    // Silent fail - don't interrupt the user's flow
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Check if auto-reset should run
 * Returns true if user has auth data
 */
export async function shouldPerformReset() {
  try {
    // Check if user is authenticated
    const tokens = await getValidAccessToken();
    if (!tokens) {
      return false;
    }
    
    // Return true if authenticated - we'll check version with server
    return true;
    
  } catch (error) {
    return false;
  }
}