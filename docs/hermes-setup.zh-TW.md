# Hermes Agent + cursor-bridge — 首次設定(不使用 Nous Portal)

這份手冊教你在**全新安裝**的情況下,把 [Hermes Agent](https://github.com/nousresearch/hermes-agent)
接到 **cursor-bridge** 當作 model endpoint —— **完全不走 Nous Portal**。設定完成後,
你選的每個 Cursor model 都會出現在 Hermes 的 `/model` 選單裡,並透過你本地的 Cursor 訂閱執行。
不需要 Portal OAuth,也不需要額外的 inference API key。

> English version: [hermes-setup.md](./hermes-setup.md)

---

## 運作原理

Hermes 可以對接任何 OpenAI-compatible 的 `/v1/chat/completions` endpoint。cursor-bridge
本身**就是**這樣一個 endpoint(底層 spawn Cursor CLI)。所以我們只要把 Hermes 的 model provider
指到 `http://127.0.0.1:18790/v1`,它就會把 Cursor models 當成一般 hosted provider 來呼叫。

`set-hermesagent.sh` 會寫入 `~/.hermes/config.yaml` 兩個區塊:

- `model:` —— 當前 provider(`provider: custom`、`base_url` 指向 bridge、
  `api_mode: chat_completions`、`default` 為你選的預設 model)
- `custom_providers:` —— allowlist 內每個 model 各一筆,讓它們出現在 `/model` 選單

---

## 前置需求

- 已安裝並登入 **Cursor CLI**(`cursor-agent` 或 `cursor` 在 `PATH` 上)。
- **Node.js ≥ 22**(cursor-bridge 零 npm 依賴)。
- 已安裝 **Hermes Agent**:
  ```bash
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  # Windows PowerShell：iex (irm https://hermes-agent.nousresearch.com/install.ps1)
  ```
  裝完後**不要**執行 `hermes setup --portal`。Portal 不用理它 —— 下面的腳本會改設定成 custom endpoint。

---

## 快速開始(3 行指令)

在 cursor-bridge repo 目錄下執行:

```bash
# 1. 以 background daemon 啟動 bridge(預設 port 18790)
./start.sh daemon

# 2.（建議)挑一份精簡的 model allowlist —— 讓 Hermes 的 /model 選單保持可用。
#    Cursor 有 130+ 個 model,這一步把清單收斂成你真正會用的那幾個。
node select-models.mjs

# 3. 把 Hermes 指到 bridge 並同步 model 清單
./set-hermesagent.sh
```

就這樣。`set-hermesagent.sh` 現在會在**沒有 config 時自動 bootstrap 一份全新的 Hermes config**
(它呼叫 `hermes setup --non-interactive`,完全不碰 Portal),接著改寫 `model:` 區塊與
`custom_providers:` 清單。

跑完之後:

```bash
hermes            # 開始對話;輸入 /model 切換不同 Cursor model
```

在 `/model` 裡選 **`bridge-cursor-cli`**。有 allowlist 的話,選單只會列出你挑的那幾個,
而不是全部 130+ 個。

---

## 最後寫進 `~/.hermes/config.yaml` 的內容

```yaml
model:
  default: composer-2.5
  provider: custom
  base_url: http://127.0.0.1:18790/v1
  api_mode: chat_completions

custom_providers:
- name: bridge-cursor-cli
  base_url: http://127.0.0.1:18790/v1
  api_key: ''
  api_mode: chat_completions
  model: auto
- name: bridge-cursor-cli
  base_url: http://127.0.0.1:18790/v1
  api_key: ''
  api_mode: chat_completions
  model: composer-2.5
# ... allowlist 內每個 model 各一筆
```

`api_key` 留空是因為本地 bridge 預設不需驗證。如果你在 cursor-bridge 的 `.env` 設了
`BRIDGE_API_KEY`,這裡要填同一個值(sync 腳本會自動帶過去)。

---

## 更新 model 清單

Cursor 常常改 model 名稱、汰換 model。每次調整 allowlist 後重新同步:

```bash
node select-models.mjs            # 重新互動挑選,挑完它會問要不要同步
# 或者,不重新挑、直接 push 目前的 allowlist:
node select-models.mjs --sync
# 或直接重跑:
./set-hermesagent.sh
```

同步時也會**修正失效的預設值**:如果 `model.default` 指向一個 Cursor 已經移除的 model,
它會自動切換成清單中的第一個,確保 Hermes 啟動時的預設一定選得到。

---

## 在 Hermes 內切換 model

```text
/model                       # 互動式選單
/model composer-2.5          # 切換這個 session 的當前 model
```

要永久生效,加上 `--global`(會寫回 `config.yaml`)。

---

## 疑難排解

| 症狀 | 處理方式 |
|---|---|
| `/model` 選單被 130+ 個 model 灌爆 | 跑 `node select-models.mjs` 設 allowlist,再 `./set-hermesagent.sh`。 |
| 同步後 Hermes 還是用舊 model | 重啟 gateway:`hermes gateway restart`(腳本會問你要不要重啟)。 |
| `cursor-bridge does not appear to be running` | `./start.sh daemon`,再用 `curl http://127.0.0.1:18790/health` 確認。 |
| 預設 model 是 Cursor 已移除的 id | 重跑同步 —— 它會自動把 `model.default` 換成有效的 model。 |
| 回應報錯說某個 model 名稱有問題 | 用 `curl http://127.0.0.1:18790/v1/models` 確認該 model 還在;Cursor 改名的話重新挑。 |
| 想看**全部** model、忽略 allowlist | `curl "http://127.0.0.1:18790/v1/models?all=1"` |

用 `hermes doctor` 診斷 Hermes 本身的問題。

---

## 手動設定(fallback)

如果你不想跑腳本,可以手動設定 Hermes:

```bash
hermes setup --non-interactive          # bootstrap 一份預設 config(不走 Portal)
hermes config set model.provider custom
hermes config set model.base_url http://127.0.0.1:18790/v1
hermes config set model.api_mode chat_completions
hermes config set model.default composer-2.5
```

接著同步 `custom_providers` 清單,讓 `/model` 有東西可選:

```bash
node select-models.mjs --sync
```

---

## 移除整合

```bash
./clearset-hermesagent.sh
```

如果有備份(`~/.hermes/config.yaml.bak.pre-cursor-bridge`)就還原它,否則把 `model:` 區塊
重設回 Hermes 預設值。
