#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";
import inquirer from "inquirer";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { dirname } from "path";

// 导入认证相关模块
import { startOAuth1aFlow } from "../src/auth/oauth1a.js";
import { storeOAuth1aTokens } from "../src/auth/tokens.js";
import { loadConfig, saveConfig, checkAuthStatus } from "../src/utils/config.js";

// Version constant - must match CLI_VERSION in constants.js
const CLI_VERSION = "0.2.9";
const USER_HOME_DIR = homedir();

// 创建命令行交互界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 认证功能
async function performAuth() {
  console.log(chalk.blue('🔐 Twitter 认证'));
  console.log(chalk.gray('━'.repeat(30)));
  
  // 检查认证状态
  const authStatus = await checkAuthStatus();
  
  if (authStatus.isAuthenticated) {
    console.log(chalk.green('✅ 已认证为'), chalk.cyan(authStatus.twitterHandle));
    console.log(chalk.gray(`上次认证时间: ${authStatus.lastAuthenticated}`));
    
    const { reauth } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reauth',
        message: '是否要重新认证?',
        default: false
      }
    ]);
    
    if (!reauth) {
      console.log(chalk.yellow('认证已取消'));
      return true; // 认证成功（保持现有认证）
    }
  }
  
  try {
    // 开始 OAuth 1.0a 流程
    const authResult = await startOAuth1aFlow();
    
    if (authResult.success) {
      // 更新配置
      const config = await loadConfig();
      
      config.twitterUrl = `@${authResult.username}`;
      config.twitterUserId = authResult.userId;
      config.lastAuthenticated = new Date().toISOString();
      
      // 存储 OAuth 1.0a tokens
      config.oauthVersion = '1.0a';
      await saveConfig(config);
      await storeOAuth1aTokens(authResult.oauth_token, authResult.oauth_token_secret);
      
      console.log();
      console.log(chalk.green('✅ 认证成功!'));
      console.log(chalk.green(`👋 欢迎 ${chalk.cyan(authResult.displayName)} (${chalk.cyan(authResult.username)})!`));
      console.log(chalk.gray('您的使用情况将被跟踪并添加到排行榜。'));
      
      return true;
    } else {
      throw new Error(authResult.error || '认证失败');
    }
  } catch (error) {
    console.error(chalk.red('❌ 认证失败:'), error.message);
    console.log();
    console.log(chalk.yellow('🔧 常见解决方案:'));
    console.log(chalk.gray('• 检查您的网络连接'));
    console.log(chalk.gray('• 确保浏览器允许弹出窗口'));
    console.log(chalk.gray('• 尝试重新运行命令'));
    
    return false;
  }
}

// 发送用量数据到API
async function sendToAPI(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const data = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "X-CLI-Version": CLI_VERSION,
      },
      timeout: 10000, // 10 second timeout
    };

    const lib = url.protocol === "https:" ? https : http;

    const req = lib.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        // Accept any 2xx status as success
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData));
          } catch {
            resolve({ success: true });
          }
        } else if (res.statusCode === 426) {
          // Version upgrade required - show error and exit
          try {
            const error = JSON.parse(responseData);
            console.error(
              `\n❌ ${
                error.detail?.message || error.message || "CLI 版本已过时"
              }`
            );
            process.exit(2);
          } catch {
            console.error(
              "\n❌ CLI 版本已过时。运行: npx claude-code-leaderboard@latest"
            );
            process.exit(2);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("超时"));
    });

    req.write(data);
    req.end();
  });
}

// 生成随机的交互ID
function generateInteractionHash() {
  const timestamp = new Date().toISOString();
  const randomValue = Math.random().toString();
  return crypto
    .createHash("sha256")
    .update(`${timestamp}${randomValue}`)
    .digest("hex");
}

// 手动上传功能
async function performUpload() {
  try {
    // 加载配置
    const config = await loadConfig();
    if (!config || config.twitterUrl === "@your_handle") {
      console.error(
        "❌ 未找到有效的认证配置。请先进行认证。"
      );
      return false;
    }

    console.log("\n🚀 Claude Code 手动用量上传工具");
    console.log("━".repeat(50));
    console.log(`👤 当前用户: ${config.twitterUrl}`);
    console.log("━".repeat(50));

    // 询问用户是否要自定义 token 数量
    const { useCustomTokens } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useCustomTokens',
        message: '是否要自定义 token 数量?',
        default: false
      }
    ]);
    
    let input, output;
    
    if (useCustomTokens) {
      // 让用户输入自定义 token 数量
      const tokenInputs = await inquirer.prompt([
        {
          type: 'number',
          name: 'input',
          message: '输入 tokens 数量 (1000-32000):',
          default: 5000,
          validate: (value) => value >= 1000 && value <= 32000 ? true : '请输入 1000-32000 之间的数字'
        },
        {
          type: 'number',
          name: 'output',
          message: '输出 tokens 数量 (1000-32000):',
          default: 15000,
          validate: (value) => value >= 1000 && value <= 32000 ? true : '请输入 1000-32000 之间的数字'
        }
      ]);
      
      input = tokenInputs.input;
      output = tokenInputs.output;
    } else {
      // 生成随机的输入输出token数量
      input = Math.floor(Math.random() * 31001) + 1000; // 输入范围: 1000-32000
      output = Math.floor(Math.random() * 22001) + 10000; // 输出范围: 10000-32000
    }
    
    // 选择模型
    const { modelName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelName',
        message: '选择模型:',
        choices: [
          'claude-opus-4-1-20250805',
          'claude-3-opus-20240229',
          'claude-3-sonnet-20240229',
          'claude-3-haiku-20240307'
        ],
        default: 'claude-opus-4-1-20250805'
      }
    ]);

    // 准备API负载
    const timestamp = new Date().toISOString();
    const interactionHash = generateInteractionHash();

    const payload = {
      twitter_handle: config.twitterUrl,
      twitter_user_id: config.twitterUserId || config.twitterUrl,
      timestamp: timestamp,
      tokens: {
        input: input,
        output: output,
        cache_creation: 0,
        cache_read: 0,
      },
      model: modelName,
      interaction_id: interactionHash,
      interaction_hash: interactionHash,
    };

    console.log("\n📊 准备上传以下用量数据:");
    console.log(`   输入tokens: ${input}`);
    console.log(`   输出tokens: ${output}`);
    console.log(`   模型: ${modelName}`);

    const { confirmUpload } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmUpload',
        message: '确认上传这些数据?',
        default: true
      }
    ]);
    
    if (!confirmUpload) {
      console.log(chalk.yellow('上传已取消'));
      return false;
    }

    try {
      console.log("\n⏳ 正在上传数据...");

      const baseEndpoint = config.endpoint || "https://api.claudecount.com";
      const endpoint = `${baseEndpoint}/api/usage/hook`;

      const result = await sendToAPI(endpoint, payload);
      console.log(chalk.green("✅ 数据上传成功!"));
      console.log(result);
      return true;
    } catch (apiError) {
      console.error(chalk.red(`❌ 上传失败: ${apiError.message}`));
      return false;
    }
  } catch (error) {
    console.error(chalk.red(`❌ 错误: ${error.message}`));
    return false;
  }
}

// 主函数
async function main() {
  try {
    console.log(chalk.blue('🚀 Claude Code 认证与上传工具'));
    console.log(chalk.gray('━'.repeat(50)));
    
    // 显示菜单
    let exit = false;
    
    while (!exit) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '请选择操作:',
          choices: [
            { name: '1. 认证 Twitter 账号', value: 'auth' },
            { name: '2. 上传使用数据', value: 'upload' },
            { name: '3. 认证并上传', value: 'both' },
            { name: '4. 退出', value: 'exit' }
          ]
        }
      ]);
      
      switch (action) {
        case 'auth':
          await performAuth();
          break;
        case 'upload':
          await performUpload();
          break;
        case 'both':
          const authSuccess = await performAuth();
          if (authSuccess) {
            await performUpload();
          }
          break;
        case 'exit':
          exit = true;
          break;
      }
      
      if (!exit) {
        console.log(chalk.gray('━'.repeat(50)));
      }
    }
    
    console.log(chalk.green('👋 感谢使用!'));
    rl.close();
    
  } catch (error) {
    console.error(chalk.red(`❌ 错误: ${error.message}`));
    rl.close();
    process.exit(1);
  }
}

// 启动程序
main(); 