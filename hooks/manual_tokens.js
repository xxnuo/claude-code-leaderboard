#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";

// Version constant - must match CLI_VERSION in constants.js
const CLI_VERSION = "0.2.9";

const USER_HOME_DIR = homedir();

// 创建命令行交互界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 加载配置
async function loadConfig() {
  const configPath = path.join(USER_HOME_DIR, ".claude", "leaderboard.json");
  try {
    const content = await readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
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
                error.detail?.message || error.message || "CLI version outdated"
              }`
            );
            process.exit(2);
          } catch {
            console.error(
              "\n❌ CLI version outdated. Run: npx claude-code-leaderboard@latest"
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
      reject(new Error("Timeout"));
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

// 主函数
async function main() {
  try {
    // 加载配置
    const config = await loadConfig();
    if (!config || config.twitterUrl === "@your_handle") {
      console.error(
        "❌ 未找到有效的认证配置。请先运行 'npx claude-code-leaderboard auth' 进行认证。"
      );
      process.exit(1);
    }

    console.log("🚀 Claude Code 手动用量上传工具");
    console.log("━".repeat(50));
    console.log(`👤 当前用户: ${config.twitterUrl}`);
    console.log("━".repeat(50));

    // 生成随机的输入token数量 (1000-32000)
    const input = Math.floor(Math.random() * 31001) + 1000;
    // 生成随机的输出token数量 (10000-32000)
    const output = Math.floor(Math.random() * 22001) + 10000;
    // 模型名称
    const modelName = "claude-opus-4-1-20250805";

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

    try {
      console.log("\n⏳ 正在上传数据...");

      const baseEndpoint = config.endpoint || "https://api.claudecount.com";
      const endpoint = `${baseEndpoint}/api/usage/hook`;

      const result = await sendToAPI(endpoint, payload);
      console.log("✅ 数据上传成功!");
      console.log(result);
    } catch (apiError) {
      console.error(`❌ 上传失败: ${apiError.message}`);
    }
    rl.close();
  } catch (error) {
    console.error(`❌ 错误: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

// 启动程序
main();
