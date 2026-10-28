# 2026-10-27 结果交付与审计职责全仓复核

基线 `e693144`，开始时工作区干净，main 比 origin/main 领先三个提交。六个分区并行审阅，主会话负责根工具、依赖、文档、集成与实际验证。本轮完整读取 148 份第一方运行时源码及各分区相关测试、注释；另审阅应用/根脚本、配置和两个 workflow。第三方压缩 Runtime 核对资产身份与许可，没有逐行重新审计上游实现；历史审计不刷新原证据。

## 范围与落实结果

| 范围                                        | 当前审阅与处理                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| browser-core，51 份源码                     | 保留 DOM/手动答案/历史/流/缓存边界；修复准备和检测的公开结果交付竞态       |
| shared，7 份源码                            | 复核答案、令牌、模型、ORT 纯契约，无源码变更                               |
| userscript，27 份源码、22 份测试、10 份脚本 | 平台实现保留；删除页面 smoke 的失效 cache fixture，同一 worker 复用构建    |
| extension，52 份源码、28 份单测及 fixtures  | 复核消息来源、Key、Offscreen、设置和 BFCache，无应用运行时变更             |
| extension scripts，45 份文件                | inventory 拒绝非普通条目；canonical/geckodriver 排队操作开始前复核取消     |
| Model Worker，11 份源码、8 份测试、8 份脚本 | pending 满槽重试期限同时考虑 UTC 月界，真实 DO/HTTP 回归覆盖普通月末与跨年 |
| 根 scripts、CI 与依赖                       | 删除重复笔记树入口及四项脚本文字断言；保留发布、供应链与安全门禁           |
| 文档                                        | 同步浏览器/服务架构、HTTP、缓存、扩展、文档维护、测试决定、AGENTS 与导航   |

实现取舍见[结果交付与审计归并决定](../decisions/implemented/bug-fix/2026-10-27-delivery-boundaries-and-audit-ownership.md)。每次点击前的控件复核、不同层的消息校验、取消与事务身份均保留，未按表面相似度删除。

## 缺陷证据

- 核心实际类的 Node 探针在修复前观察到四种失效调用仍 resolve：detect 返回前 abort/destroy，以及两种准备入口在会话就绪后 destroy。修复后四种场景分别返回取消或关闭错误；内部工作结算至公开方法交付之间再次检查，不声称能撤回已交付结果。
- 月末 `23:59:59` 填满五个 pending，旧实现建议等待 600 秒，但一秒后的新月已经可以 reserve。修改后的实际类探针返回 1 秒并恢复；workerd 回归还核对 HTTP 503、暴露的重试头、无回执，以及新月的 200、回执和完整模型字节。
- inventory 的隔离文件系统探针原先遗漏额外 symlink；现在普通文件可枚举、额外链接立即拒绝。文件链接和目录链接各有回归。
- 两个下载器原先在调用后同栈 abort 仍派发一次 fetch；修改后派发次数均为零，原 abort reason 按引用保留。探针只注入离线 fetch，没有访问生产模型服务。
- 笔记树检查原先把代码围栏中的 `[example](missing-example.md)` 当成断链，统一链接检查器已经正确忽略。删除重复入口后由格式检查器保留结构验证；断链回归归入链接检查器，笔记围栏回归同时覆盖示例链接。

## 精简与性能边界

用户脚本同一 Playwright worker 正常顺序执行的九个页面场景由逐场景构建改为一次 `beforeAll` 构建，所有场景和独立上下文保留。删除的 `E2EModelCache` 及两处构造没有当前 AppDependencies 消费者。笔记验证少一个 Node 子进程、少一次活动笔记树扫描及正文链接读取，没有新增解析依赖。

移除四项仅验证聚合脚本、benchmark 命令和 Corepack 文本的测试；根测试 383 → 380，包含新增的一项笔记链接归属回归。真实 CI 授权、已测 ZIP 复用、canonical 下载后的验证、工具链安全策略和完整检查继续执行；没有降低 coverage include/门槛或加入 skip/todo。

推理继续使用现有 Float32 LUT、固定 top-N、稳定同分顺序与逐行完整校验，本轮未改数值算法。当前 Node 24.22.1 基准为 RGBA 转换 2.2736 ms/op、输出解析 0.0162 ms/op，均为七批中位数；没有同环境前后对照，不据此声称整题推理加速。transport smoke 在 Chromium 151.0.7922.34 下执行四场景、1600 次操作，测量样本 1200 次成功、0 错误；其范围仅为 Blob 复制和 digest，不是扩展推理基准。

## 依赖复核

冻结安装成功。含开发依赖的 `pnpm audit --json` 覆盖 363 项依赖，所有严重度的已知公告均为 0。实际导入/命令用途确认 ORT、esbuild、fflate、jsdom/Playwright、Cloudflare 工具、TypeScript CLI/API、Vitest/coverage、ESLint 与 Prettier 均有消费者；没有新增可安全删除的直接依赖，清单与锁文件不变。

Python 哈希锁的 flatbuffers 25.9.23、ml-dtypes 0.5.4、numpy 2.5.2、onnx 1.22.0、onnxruntime 1.27.0、packaging 26.3、protobuf 7.35.1、typing-extensions 4.16.0，以及 bootstrap pip 26.2.0，逐版本查询 PyPI JSON 的 `vulnerabilities` 均为空（接口示例：[ONNX](https://pypi.org/pypi/onnx/1.22.0/json)、[pip](https://pypi.org/pypi/pip/26.2.0/json)）。这是对应公告接口的结果，不是无未知漏洞的证明。

另核对 [Node 官方安全公告](https://nodejs.org/en/blog/vulnerability)及 [24.22.1 安全发布](https://nodejs.org/en/blog/release/v24.22.1)，当前固定版本对应最新列出的安全批次。Actions 完整 SHA/digest 与凭据门禁通过。保留七天等待和 trust policy；已弃用 Cloudflare pool 仍是当前测试集成的实际依赖，未混入跨工具链迁移。未重新编译 ORT、生成 Python 模型或更换任何固定资产。

## 当前验证

先执行定向回归：核心推理 40 项、Worker 51 项、扩展构建/下载 Node 97 项通过。然后执行一次完整检查：

```bash
PNPM_CONFIG_WORKSPACE_CONCURRENCY=1 taskset -c 0-2 mise exec -- pnpm check
```

完整检查通过 1411 项 Vitest、380 项根级 Node 测试及包内 Node/覆盖率、格式、lint、类型、文档、架构、危险调用、产物审计与构建。本机资源设置不改仓库默认并发或超时，没有先运行 check:quick 重复整套测试。

| 验证                  | 本轮实际结果                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Node 离线探针         | 核心四种交付竞态、两种月界、inventory 链接、两个下载器取消均通过                                |
| 用户脚本双 profile    | default 未压缩 206770 字节；bundled 压缩 156660 字节，各自预算通过                              |
| 用户脚本 E2E          | Chromium 10 项通过，包含 external Blob Worker/JSEP fixture                                      |
| 扩展 content fixture  | 自动/手动、单次推理/提交、历史、fieldset/action、BFCache 与 JPX 连续三轮通过                    |
| remote load-only      | Chromium 156.0.8078.47、Firefox 153.0 加载与设置通过                                            |
| packaged fixture      | 双浏览器真实 ORT、确定性 oracle、会话重建通过；Chromium 另覆盖后台重启、旧 epoch 取消和空闲重建 |
| packaged canonical    | 复用本地固定模型，两浏览器各两次成功非随机推理及会话重建                                        |
| 固定 geckodriver 安装 | 仓库安装器实际下载并校验 0.37.1，Firefox smoke 核对版本                                         |

四份 packaged schema 2 证据均为 passed，绑定实际 ZIP、模型与正整数 tree.fileCount。canonical 使用合成透明图片，只证明推理链路，不能证明真实验证码准确率。ZIP/证据保存在仓库外 `/tmp/hv-project-audit-25q36jyj`；仓库 dist 保留 remote 扩展与 bundled 用户脚本。Worker 使用 test-kv/test-bucket，结束按备份字节恢复原生成配置，并删除敏感备份。

未运行生产 Key 鉴权、远程 CI/CodeQL、精确最低浏览器或 Firefox Android 验收；本轮只使用上述已安装桌面浏览器与离线 fixture。未提交、推送、发布或部署。
