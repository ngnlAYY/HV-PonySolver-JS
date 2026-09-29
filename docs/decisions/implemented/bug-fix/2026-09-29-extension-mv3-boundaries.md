# Agent Note: 收紧扩展发送者与 MV3 产物审计边界

Status: implemented

## Problem

Broker 在 sender.url 缺失时使用 sender.tab.url，而后者属于标签页，不一定属于实际发送消息的 frame。内容来源只比较 HTTPS 与 hostname，未核对端口、origin 和 frameId，因此含非标准端口或矛盾来源元数据的连接仍能通过准入。

产物审计只核对部分清单入口，没有覆盖内容脚本的完整注入声明、action、可选权限与外部连接。HTML 只检查普通 script/link，未检查事件属性、javascript URL、srcdoc、base 和 template 内部内容。当前生成器并未输出这些危险配置，现有 CSP 也会阻止内联执行；问题是门禁不能防止后续变更混入不可运行或超出产品边界的产物，不等于已证明外部网页可利用的提权。

## Decision

Broker 必须使用实际 sender.url，保持扩展 ID 与具名 Port 校验，拒绝 URL 凭据。内容来源按两个 Hentaiverse 的完整 HTTPS 标准端口 origin 匹配；设置页保留自身精确路径及 query/hash。sender.origin 存在时必须与发送页面一致且非 opaque，frameId 存在时必须为 0。可选元数据缺省时继续验证 URL 与扩展 ID，不以 tab URL 兜底。拒绝发生在挂载 Port 消息监听器及进入 Host 之前。

产物审计比较策略生成器声明的完整 background、options_ui、action、content_scripts 和 CSP，要求 MV3 与当前扩展包版本，拒绝 optional_permissions、optional_host_permissions、externally_connectable 和 sandbox。权限数组保持严格类型与内容校验，键顺序不影响对象比较。四种浏览器/模型模式仍生成原有清单，不增加权限、不改变最低版本、不新增商店交付。

HTML 审计用现有 JSDOM 解析属性，遍历包括嵌套 template 的所有元素；事件属性、javascript URL、srcdoc 和 base 覆写失败关闭。可执行 URL 使用 URL 解析处理大小写、实体、制表符和换行，普通文本、注释与 data 属性不当作代码。script/link 的本地文件存在性检查继续保留，SVG script 的 href 也检查。

文档同步补全已有 remote/packaged connect-src 策略。漂移检查要求安全契约出现在扩展专题，根 README 的同名词不能掩盖专题缺项。

## Existing record audit

检索全部非归档决定中的来源、sender、Port、清单和 CSP，没有已有同主题记录。[Port 断连错误决定](2026-09-18-extension-port-disconnect-errors.md)处理准入之后的取消与错误读取，本篇不改变它；[构建安全与可重复性决定](2026-09-22-build-safety-and-reproducibility.md)处理输出目录与 ZIP 时间，本篇补充产物语义审计，不取代原决定。未发现需要吸收或废弃的相关 proposed/rejected 记录。

## Alternatives considered

- 仅核对 sender.id 与 tab.url：无需平台类型改动，但不能区分实际发送 frame，也无法拒绝显式矛盾的 origin，故不采用。
- 强制所有浏览器提供 origin/frameId：规则更短，但这两个字段在跨浏览器 API 中是可选元数据。选择有值必须一致、缺值仍严格验证 URL 与扩展 ID。
- 增加 tabs 权限或扩大 Host 权限：可以获取更多标签信息，但不能使 tab URL 成为 frame 身份证明，反而扩大权限；维持现有最小权限。
- 仅依赖 CSP 与清单生成器：实现成本最低，但不能提前发现被 CSP 阻止的代码，也无法发现后续清单扩权。增加独立故障注入，保留正常产物行为。
- 全文正则扫描 HTML：执行更轻，但易漏掉实体、混合大小写及 template，也会误报注释和普通文字。复用已有 DOM 解析依赖，不引入新包。

## Verification

先运行新负向测试，确认旧 Broker 与产物审计接受了应拒绝的输入；修复后运行 Broker 单元测试、四种清单的逐字段故障注入、嵌套 template/SVG/编码 URL 测试与惰性文本正例。文档测试移除专题事实并将同名文本加入 README，确认不能跨文档补足。

扩展类型检查、工作区与 Node 测试、remote 构建、Chromium content fixture 及 Chromium/Firefox load-only 覆盖正常准入与现有使用流程。内置 fixture 和完整本地检查独立验证；这些检查不证明生产模型准确率、受保护远程 Key 鉴权、最低版本或 Android 支持，也不构成商店审核或发布。

## Consequences

过去仅能借助 tab URL 或矛盾元数据通过的连接现在被拒绝；当前合法顶层内容页与独立设置页行为不变。运行时仅增加准入时的 URL/元数据检查，无新依赖或权限。

构建审计更严格，新增后台字段、popup、frame 注入、sandbox 或额外权限必须同时修改产品策略、负向测试与文档；不应删除断言让变更通过。该门禁不是通用 JavaScript/HTML 安全证明，不替代消息 schema、CSP、资产完整性、浏览器 E2E 或安全扫描。
