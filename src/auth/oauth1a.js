import open from 'open';
import express from 'express';
import chalk from 'chalk';
import { apiFetch } from '../utils/api.js';
import { scanAllHistoricalUsage } from '../utils/usage-scanner.js';
import ora from 'ora';

const REDIRECT_URI = 'http://localhost:7632/callback';

// Start OAuth 1.0a flow using backend endpoints
export async function startOAuth1aFlow() {
  return new Promise(async (resolve, reject) => {
    let requestToken;
    
    // Create Express app for handling callback
    const app = express();
    let server;
    
    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      if (server) {
        server.close();
      }
      reject(new Error('Authentication timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    
    // Handle callback
    app.get('/callback', async (req, res) => {
      try {
        const { oauth_token, oauth_verifier, denied } = req.query;
        
        if (denied) {
          res.send(`
            <html>
              <body>
                <h1>❌ Authentication Denied</h1>
                <p>You denied the authorization request.</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server.close();
          return reject(new Error('User denied authorization'));
        }
        
        if (!oauth_token || !oauth_verifier) {
          res.send(`
            <html>
              <body>
                <h1>❌ Authentication Failed</h1>
                <p>Invalid response from Twitter</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server.close();
          return reject(new Error('Invalid OAuth response'));
        }
        
        // Verify with backend
        
        const verifyResponse = await apiFetch('/api/auth/oauth/verify', {
          method: 'POST',
          body: JSON.stringify({
            oauth_token,
            oauth_verifier
          })
        });
        
        if (!verifyResponse.ok) {
          const error = await verifyResponse.text();
          throw new Error(`Verification failed: ${error}`);
        }
        
        const authData = await verifyResponse.json();
        
        res.send(`
          <html>
            <body>
              <h1>✅ Authentication Successful!</h1>
              <p>Welcome ${authData.user.twitter_display_name} (@${authData.user.twitter_username})!</p>
              <p>You can close this window and return to the terminal.</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 2000);
              </script>
            </body>
          </html>
        `);
        
        clearTimeout(timeout);
        server.close();
        
        if (authData.magic_link) {
          
          // Sync historical usage if this is a new user
          if (!authData.user.history_sync_completed) {
            
            try {
              // First, double-check with the backend if sync is really needed
              // This prevents expensive local scanning if user is already synced
              const checkResponse = await apiFetch(`/api/user/stats?twitter_user_id=${authData.user.twitter_user_id}`, {
                headers: {
                  'X-OAuth-Token': authData.user.oauth_token,
                  'X-OAuth-Token-Secret': authData.user.oauth_token_secret
                }
              });
              
              if (checkResponse.ok) {
                const userData = await checkResponse.json();
                // If user already has significant token usage, skip sync
                if (!userData.stats || userData.stats.total_tokens === 0) {
                  // Proceed with sync only if user has no token data
                  
                  const { entries } = await scanAllHistoricalUsage(true);
                  
                  if (entries.length > 0) {
                    const syncSpinner = ora('Uploading historical data...').start();
                    
                    // Use the original working bulk uploader
                    const { uploadShardedNdjson } = await import('../utils/bulk-uploader.js');
                    
                    // Convert entries to NDJSON lines
                    const lines = entries.map(e => JSON.stringify({
                      timestamp: e.timestamp,
                      tokens: e.tokens,
                      model: e.model,
                      interaction_id: e.interaction_id
                    }));
                    
                    const { processed, failed } = await uploadShardedNdjson({ 
                      lines,
                      endpointPath: '/api/usage/bulk-import-optimized',
                      tokens: {
                        oauth_token: authData.user.oauth_token,
                        oauth_token_secret: authData.user.oauth_token_secret
                      }
                    });
                    if (failed > 0) {
                      syncSpinner.warn(`Synced ${processed.toLocaleString()} entries (${failed} failed)`);
                    } else {
                      syncSpinner.succeed(`Synced ${entries.length.toLocaleString()} historical usage entries`);
                    }
                  }
                }
              }
            } catch (error) {
              // Don't fail auth if historical sync fails
            }
          }
          
          // Opening claudecount.com
          
          // Open the magic link in browser
          open(authData.magic_link).catch((err) => {
            console.log(chalk.yellow('⚠️ Could not open browser automatically'));
            console.log(chalk.gray('Visit: ' + authData.magic_link));
          });
        }
        
        resolve({
          success: true,
          oauth_token: authData.user.oauth_token,
          oauth_token_secret: authData.user.oauth_token_secret,
          userId: authData.user.twitter_user_id,
          username: authData.user.twitter_username,
          displayName: authData.user.twitter_display_name,
          oauthVersion: '1.0a',
          magicLink: authData.magic_link
        });
        
      } catch (error) {
        res.send(`
          <html>
            <body>
              <h1>❌ Authentication Failed</h1>
              <p>Error: ${error.message}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
    
    // Start server
    server = app.listen(7632, async (err) => {
      if (err) {
        clearTimeout(timeout);
        return reject(err);
      }
      
      try {
        // Step 1: Get auth URL from backend
        const requestResponse = await apiFetch('/api/auth/oauth/request');
        
        if (!requestResponse.ok) {
          const error = await requestResponse.text();
          throw new Error(`Failed to start OAuth flow: ${error}`);
        }
        
        const { auth_url, request_token } = await requestResponse.json();
        requestToken = request_token;
        
        console.log(chalk.yellow('📱 Opening browser for Twitter authentication...'));
        console.log(chalk.gray('If your browser doesn\'t open automatically, visit:'));
        console.log(chalk.cyan(auth_url));
        console.log();
        
        // Open the authenticate URL
        open(auth_url).catch((err) => {
          // Silent fail
        });
        
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
  });
}

// Create OAuth 1.0a signed request helper for API calls
export function createOAuth1aSigner(oauthToken, oauthTokenSecret) {
  // This is now handled by the backend
  // The CLI just needs to pass the tokens to the backend
  return {
    signRequest(url, method = 'GET', data = {}) {
      // Return empty header since backend handles OAuth signing
      return {};
    }
  };
}