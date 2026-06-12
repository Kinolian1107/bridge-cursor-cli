**[English](integrations.md)** | **[繁體中文](integrations.zh-TW.md)** · [← README](../README.zh-TW.md)

# 整合

## Hermes Agent

如果你使用 [Hermes Agent](https://github.com/nousresearch/hermes-agent)，執行 `./set-hermesagent.sh` — 它會設定 Hermes 使用 cursor-bridge，並同步 bridge 的模型清單到 Hermes 的 `/model` 選單。

**第一次安裝、不想走 Nous Portal？** `./set-hermesagent.sh` 會在指到 bridge 之前，先幫你 bootstrap 一份全新的 Hermes config（透過 `hermes setup --non-interactive`，完全不碰 Portal）— 所以全新安裝的 Hermes 也是同一行指令搞定。完整手冊：**[hermes-setup.zh-TW.md](hermes-setup.zh-TW.md)**（[English](hermes-setup.md)）。

```bash
# 先確認 cursor-bridge 已啟動
./start.sh daemon

# 建議先用 allowlist 縮減模型清單（見 docs/models.zh-TW.md）
node select-models.mjs

# 設定 Hermes 並同步模型
./set-hermesagent.sh
```

執行後，在 Hermes 中選擇 `/model` → `bridge-cursor-cli`。有設 allowlist 的話，選單只會顯示你實際在用的模型，而不是全部 130+ 個。

隨時重新執行 `./set-hermesagent.sh`（或 `node select-models.mjs --sync`）刷新模型清單。要移除整合，執行 `./clearset-hermesagent.sh`。

## OpenClaw

如果你使用 [OpenClaw](https://github.com/openclaw/openclaw)，執行 `./install.sh` — 它會偵測 OpenClaw 並詢問是否自動設定。

若要手動設定，編輯 `~/.openclaw/openclaw.json`：

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "cursor-cli/claude-fable-5-thinking-medium" }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [{
          "id": "claude-fable-5-thinking-medium",
          "name": "Cursor CLI (claude-fable-5-thinking-medium)",
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 200000,
          "maxTokens": 65536
        }]
      }
    }
  }
}
```

然後重啟 OpenClaw gateway：

```bash
openclaw gateway stop && openclaw gateway
```

## Anthropic SDK / Claude Code

把 `ANTHROPIC_BASE_URL` 指向 bridge 即可，不需要任何設定檔。見 [api.zh-TW.md — Anthropic Messages API](api.zh-TW.md#anthropic-messages-apiv22)。
