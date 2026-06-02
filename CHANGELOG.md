# CHANGELOG

所有值得记录的变更按版本倒序排列，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范。

---
## [v55] — 2026-05-19 · Milestone 14: End-to-End Bootstrap-to-Skill Acceptance

### 目标
以端到端测试验证自举层 → 灰质编译层 → 灰质执行层 → 安全层 → 白质层 → 海马层 → 元目标层的完整串联。

### 变更内容
- **测试页面 Fixture**：构建标准 HTML 测试场景，包含 input×2、submit按钮、普通按钮、high 风险按钮（Delete Account）、forbidden 风险按钮（drop table users）以及 form 容器，覆盖完整交互面元素谱。
- **T25 E2E 测试套件**（共 11 组、超过 50 个断言用例）：
  - **T25-A**: fixture 及 Raw Scan 结构验证
  - **T25-B**: Selector 10 级优先级生成策略（data-testid > aria-label > id > name > placeholder > CSS fallback）
  - **T25-C**: 环境画像生成，包括 perception/execution/feedback surfaces、elements、risk_level 分类
  - **T25-D**: task 绑定 environment_profile_id
  - **T25-E**: task_run 成功执行与 task_run_steps 字段完整性
  - **T25-F**: medium 风险步骤允许执行且记录 SafetyGate Warn、executor_called=true
  - **T25-G**: high/forbidden 步骤必须阻断、executor_called=false、error_code=SAFETY_BLOCKED（核心约束）
  - **T25-H**: blocked step 必须入库 task_run_steps，包含完整阻断证据字段
  - **T25-I**: 从成功 task_run 编译 candidate skill_card，验证 action_sequence、safety_profile、compiled_from_task_run_id
  - **T25-J**: 使用 skill_card 驱动第二次执行（重放能力）
  - **T25-K**: 全链路完整闭环验证，包括白质层对 SAFETY_BLOCKED 的 affected_steps 识别与海马层证据落盘
- **安全层触发器：evaluateSafetyGateSync**—纯函数与业务一致，可应用于单元测试，确保 high/forbidden 关键词在任何上下文中均能正确触发阻断。
- **灰质编译器 compileSkillCard**—可从模拟的 task_run_steps 推导 execution_surfaces、风险等级、safety_profile 和版本号，完全覆盖 compile-gray-skill Edge Function 的业务逻辑。

---

## [v54.1] — 2026-05-19 · Milestone 13 补充：Safety Gate Enforcement 强化

### 变更内容
- **更新数据库 schema**：`task_run_steps` 表状态枚举增加 `blocked`，增加 `blocked_reason` 和 `matched_rule` 字段。
- **完善前端执行轨迹记录**：对于被拦截的动作，写入 `status: 'blocked'` 和 `error_code: 'SAFETY_BLOCKED'`，并将拦截理由和匹配规则写入 `task_run_steps` 和 `memory_episodes` 海马层。
- **更新失败追踪索引**：在执行报错时，`task_runs.failed_step_index` 将不仅指向 `failed` 状态，也会正确指向 `blocked` 状态的步骤。
- **白质层分析增强**：更新了 `white-matter-analyze` 的 prompt 指导原则，明确要求其识别并处理 `status='blocked'` 和 `error_code='SAFETY_BLOCKED'`，在返回的 `affected_steps` 中加入 `blocked_reason` 和 `matched_rule`。
- **灰质层技能编译增强**：更新 `compile-gray-skill`，它会在生成 `skill_card` 时构建并附带 `safety_profile`（各步骤的详细风险等级与匹配规则记录），写入 `skill_card.safety` 字段，实现安全画像固化。
- **更新测试用例**：扩展了 T24 测试，新增 T24-6/T24-7 断言，覆盖新的状态和字段约束，Lint 检查已全量通过。

---

## [v54] — 2026-05-19 · Milestone 13: Safety Gate Enforcement Integrity

### 目标
保证所有灰质层任务步骤在执行前经过 SafetyGate 裁决，高风险或禁止的动作将被直接阻断，完整记录证据链，确保系统执行的安全性。

### 变更内容
- **实现 SafetyGate 模块**：新增 `src/lib/safetyGate.ts`，基于动作类型、选择器、输入值的内容进行关键字匹配和风险评估，支持四级风险（low, medium, high, forbidden）及相应裁决（allow, warn, block）。
- **执行前安全拦截**：在 `TasksPage.tsx` 的 `simulateTaskExecution` 逻辑中接入 SafetyGate。在每个 task_step 实际执行（或模拟耗时）前：
  - 对风险评估结果为 `block` (high / forbidden) 的操作，直接置为 failed，**跳过后续实际执行逻辑**，不调用真实 action executor。
  - 对评估为 `warn` (medium) 的操作允许执行，但生成告警记录。
- **完善证据链写入**：
  - 在 `task_run_steps` 表中准确记录 `safety_risk_level`；阻断时写入 `error_code: 'SAFETY_VIOLATION'` 和具体的阻断原因。
  - 同步将阻断和告警记录写入 `memory_episodes` 海马层，供后续白质层审查和系统回溯（tags 包含 safety_gate, blocked/warning 等）。
- **测试覆盖增强**：增加 T24 测试用例（T24-1 ~ T24-5），验证各等级风险控制逻辑、阻断效果和证据链（task_run_steps 及 memory_episodes）的数据记录完整性。

---

## [v52] — 2026-05-19 · Milestone 11 补充：灰质编译测试覆盖与边缘函数可靠性确认

### 目标
确保灰质层技能编译（compile-gray-skill）的所有核心验证规则、编译后数据写入逻辑均被 T23 测试套件完整覆盖，并确保数据库模型、边缘函数与测试用例三者一致。

### 变更内容
- **编译条件强校验**：边缘函数 `compile-gray-skill` 严格实现了以下校验规则：
  - 只允许 `status='success'` 且 `is_legacy_run=false` 的 `task_run` 进行编译，失败或 legacy 执行记录均返回 HTTP 422 拒绝。
  - 缺少 `task_run_steps` 或 `environment_profile` 时同样返回 422，防止空数据导致的编译结果不可靠。
  - 对每个成功步骤的 `target_selector` 进行存在性校验，若 selector 不在 `environment_profile.elements` 中，则拒绝编译并返回具体的 `invalid_steps` 列表。
- **编译产物完整性**：成功编译后系统自动执行以下操作：
  - 插入 `skill_card`（`status='candidate'`），包含 `compiled_from_task_run_id` 字段以追溯来源。
  - 写入 `skill_history` 初始版本记录，标记 `source: 'compile-gray-skill'`。
  - 写入 `memory_episodes(type='skill_compilation')`，形成编译事件的完整记录。
- **测试套件 T23 覆盖确认**：现有 T23 测试套件（共13个断言）已全量覆盖以下场景：
  - T23-1: 成功 run 可编译 / 失败 run 不可编译 / legacy run 不可编译。
  - T23-3: selector 不在 environment_profile 时拒绝。
  - T23-10: 编译后生成 skill_history。
  - T23-11: 编译后写入 skill_compilation episode。
- **数据库模型补全**：应用迁移 `00036_add_compiled_from_task_run_id_and_skill_compilation_type.sql`，为 `skill_cards` 表增加 `compiled_from_task_run_id` 字段，并为 `episode_type` 枚举添加 `skill_compilation` 值，确保数据库模型与边缘函数一致。

---

## [v53.1] — 2026-05-19 · Milestone 12 补充：技能编译完整性

### 变更内容
- **skill_cards 添加 compiled_from_task_run_id**：跟踪技能卡的编译来源，支持可追溯性
- **skill_history 初始版本写入**：编译成功后自动写入 skill_history 记录，version='1.0.0'，status='candidate'，changes_json 包含编译来源和 action sequence
- **memory_episodes(type='skill_compilation')**：编译成功后自动写入记忆事件，title 包含技能卡名称，content_json 包含 skill_card_id / task_run_id / environment_profile_id / action_sequence / selector_validation
- **拒绝条件完善**：
  - task_run 失败时拒绝编译（HTTP 422）
  - 缺少 step trace 时拒绝编译（HTTP 422）
  - 缺少 environment_profile 时拒绝编译（HTTP 404/422）
- **类型更新**：EpisodeType 新增 'skill_compilation'，SkillCard 新增 compiled_from_task_run_id
- **前端适配**：MemoryPage EPISODE_TYPE_LABELS/ICONS/DETAIL_TITLES 均添加 skill_compilation 映射
- **T23 测试扩展**：新增 T23-8 ~ T23-13，覆盖 compiled_from_task_run_id、完整字段集、skill_history、skill_compilation episode、拒绝条件

---

## [v53] — 2026-05-19 · Milestone 12: Gray Skill Compilation Integrity

### 目标
基于 environment_profile 和成功 task_run_steps，自动生成 candidate skill_card，实现从成功轨迹到灰质技能卡的编译闭环。

### 变更内容
- **新增 compile-gray-skill Edge Function**：接收 `{ task_id, task_run_id, environment_profile_id }`，完成以下编译流程：
  1. 校验 task_run 必须 `status='success'` 且 `is_legacy_run=false`，否则返回 HTTP 422
  2. 读取 `task_run_steps`，过滤只保留 `status='success'` 的步骤构成稳定 action sequence
  3. 读取 `environment_profile`，构建 selector 索引（包含 selector_candidates 和属性推导）
  4. 校验每个 step 的 `target_selector` 必须存在于 profile elements 中，否则返回详细的 `invalid_steps`
  5. 生成 `skill_card`（status='candidate'）：
     - `skill_id` 自动生成，基于任务名称
     - `execution_surfaces` 从 steps 的 action_type 推导
     - `tunable_params` 基于执行时间和步骤数量动态计算
     - `safety.risk_level` 取 steps 中最高风险等级
     - `metrics` 设置 success_rate=1.0, sample_count=1, avg_latency_ms 为实际执行时间
     - `policy` 包含编译来源和动作序列摘要
  6. 写入 `skill_cards` 表后，自动回写 `tasks.skill_card_id`
- **前端 TasksPage 增加编译按钮**：在展开的成功非 legacy task_run 详情中，显示"编译为技能卡"按钮，点击后调用 `compile-gray-skill` Edge Function，成功后自动刷新任务列表
- **T23 测试套件**：新增 7 个测试用例，覆盖编译条件校验、action sequence 提取、selector 验证、skill_card 状态与关联、execution_surfaces 推导、风险等级计算

---

## [v52] — 2026-05-19 · Milestone 11: 环境自举验证与白质层上下文融合

### 目标
完成 Milestone 11 最后阶段，将环境自举结果完整融入白质层失败分析流程，并通过验证器与测试完善整个自举链路的可靠性与可追溯性。

### 变更内容
- **白质层环境上下文融合**：`white-matter-analyze` Edge Function 现在检查 `environment_profile_id`，若存在则从 `environment_profiles` 表加载对应环境画像数据并注入到 LLM 分析的 user prompt 中。这使得白质层的根因推断能够结合目标页面的实际元素结构、可用执行面和风险分类信息，提升分析准确性。
- **验证器策略覆盖**：在测试层面提供了一组模拟验证器，用于确保：(1) 选择器必须存在于自举扫描结果中；(2) 仅允许已注册的 adapter；(3) 仅允许预定义的 risk_level 列表（low/medium/high/forbidden）。
- **T22 测试套件**：新增 T22 测试组（共 8 个用例），完整覆盖 Raw Scan 采集能力、Environment Profile 生成、验证器多层级校验、成功自举事件落盘 `memory_episodes`（type=environment_bootstrap）以及任务/技能卡与环境画像的绑定。

---

## [v52.1] — 2026-05-19 · Milestone 11 Phase 2 续：Validator + Memory Episode + Task 绑定

### 变更内容
- **新增 EnvironmentProfileValidator**：在 `bootstrap-environment` Edge Function 中实现完整的验证逻辑（V1–V7）：
  - 校验 `perception_surfaces` / `execution_surfaces` / `feedback_surfaces` 不为空
  - 校验 `recommended_adapters` 中的每个 adapter 必须在允许列表中
  - 校验每个 `element.selector` 必须存在于其 `selector_candidates` 中
  - 校验 `action_candidates` 中的每个 action 必须被系统支持
  - 校验 `risk_level` 必须符合枚举值（low / medium / high / forbidden）
  - 校验 `element.tag` 必须存在于原始扫描结果中
  - 校验 `url` 和 `environment_type` 非空
  - **验证失败返回 HTTP 422**，包含详细的 `validation_errors` 数组，拒绝写库
- **保存成功后双写 memory_episodes**：验证通过后，除写入 `environment_profiles` 外，同时写入 `memory_episodes`：
  - `type = 'environment_bootstrap'`
  - `content_json` 包含 `raw_scan_id`、`environment_profile_id`、`white_matter_summary`
  - `environment_profile_id` 外键关联
  - `tags = ["bootstrap", "environment", "auto-generated"]`
  - Episode 写入失败不影响主流程（仅打日志）
- **扩展 episode_type 枚举**：数据库 ENUM 和 TypeScript `EpisodeType` 均新增 `'environment_bootstrap'`
- **MemoryPage 适配**：`EPISODE_TYPE_LABELS`、`EPISODE_TYPE_ICONS`、`DETAIL_TITLES` 均添加 `environment_bootstrap` 映射
- **Task 创建绑定 environment_profile_id**：`TasksPage` 已支持在创建任务时通过下拉选择绑定 `environment_profile_id`

---

## [v52] — 2026-05-19 · Milestone 11 Phase 2: 最小 Bootloader + 白质层推理分离

### 目标
将环境自举的**事实采集**与**复杂推理**分离为两个独立层次，使得 Bootloader 只负责原始数据收集，白质层负责推导环境画像草案，提高系统的单一职责原则与可维护性。

### 变更内容
- **新增 raw_environment_scans 表**：专门存储 Bootloader 产出的原始扫描结果，包含 URL、DOM、可见文本、截屏、控制台错误、原始元素列表 (`raw_elements`)。该表只含事实不含任何推理字段。
- **重构 bootstrap-env 为最小 Bootloader**：移除所有推理逻辑（selector 生成、risk_level 推断、surfaces 判断、adapters 推荐），仅保留：Playwright 打开页面、等待 networkidle、扫描 DOM、提取 button/input/select/textarea/a/form/dialog 等元素的原始属性（text、role、name、placeholder、type、href、aria-label、data-testid、data-test、data-cy、id、class、title）。扫描结果写入 `raw_environment_scans` 表。
- **新增 bootstrap-environment 白质层 Edge Function**：接收 `raw_scan_id`，读取 `raw_environment_scans` 中的原始数据，负责所有复杂推理：
  - 判断 perception_surfaces（根据元素类型自动识别 dom、url、title、visible_text、form_fields、button_labels 等）
  - 判断 execution_surfaces（根据标签自动识别 click、fill、select、wait、screenshot、navigate 等）
  - 判断 feedback_surfaces（自动识别 url_change、dom_change、element_visible、validation_error 等）
  - 为每个元素生成语义角色 (`semantic_role`)
  - 生成 selector 候选 (`selector_candidates`)并按优先级排序（data-testid > aria-label > role+title > id > name > placeholder > text > CSS class > tag）
  - 计算 `stable_selector_score`
  - 推断 `action_candidates` 和 `risk_level`
  - 推荐 `recommended_adapters`
  - 将最终 `environment_profile` 保存至 `environment_profiles` 表
- **前端调用链路更新**：`BootstrapPage.tsx` 的扫描流程现为两步式：先调用 `bootstrap-env` 获取原始扫描，再调用 `bootstrap-environment` 生成画像。扫描进度动画分别展示 Bootloader 阶段与白质层推理阶段的状态。
- **RLS 与 Realtime 支持**：为 `raw_environment_scans` 表配置了行级安全策略和 Supabase Realtime 同步。

---

## [v51] — 2026-05-19 · Milestone 11: 自举画像系统全链路关联（End of Milestone 11）

### 目标
完成 Milestone 11 所有开发目标，实现自举画像 (`environment_profile`) 与核心业务实体（任务、技能卡、白质记忆）的双向关联与追踪支持，并在自动化测试套件中形成规范保障。

### 变更内容
- **自举画像外键延伸**：在原有任务绑定的基础上，为 `skill_cards` 和 `memory_episodes` 表扩展关联 `environment_profile_id` 的外键字段。
- **关联数据回溯**：在 `TasksPage.tsx` 和 `SkillsPage.tsx` 中，用户可以在手动创建任务与技能卡时关联指定的自举环境画像；`bootstrap-env` 生成的环境参数能直接赋能灰质层任务流。
- **白质失效分析追踪**：当任务产生错误 (`task_run` failed) 移交白质层分析时，如果对应任务已绑定自举环境画像，将一并提取 `environment_profile_id` 存入生成的 Failure Episode (`memory_episodes`)，为下一次系统调试提供包含实时扫描、动态抓取的现场复原环境。
- **T21 回归测试完备**：新增了一组涵盖 Milestone 11 系统完备性的 `T21` 测试用例（共 7 个用例），断言覆盖了从表单及容器标签的基础解析、`data-testid` 优先生效规则、动作阻断风险标记（high、forbidden）到最终模型生成的三面数据关联结构。

---

## [v50] — 2026-05-19 · Milestone 11: 环境自举节点抽取与解析策略完备化

### 目标
完成自举系统的解析规则升级，按照严格的优先级推导高可靠性操作选择器（Selector），完善不同表单与动作节点的特征提取与动作分级，并实现测试与执行环境中绑定配置文件的能力，收官第十一里程碑。

### 变更内容
- **优先级推导生成**：Edge Function 抓取元素的 Selector 提取逻辑重构为 10 级后备优先顺序，针对 `data-testid`、`data-test` 以及 `data-cy` 提供最优先解析策略，其后依次匹配 `aria-label`、`role+title` 组合、针对 Input 的 `label` 文本以及 `id/name`，最后回退至 `xpath` 和 `text` 搜索，极大提高了前端渲染层元素的稳定性。
- **动态风险预分类**：基于节点的推测用途（删除、购买、转账、Checkout、修改密码等敏感行为）准确打上 `high` 或者 `forbidden` 的阻断级 `risk_level`；基础表单与提交状态为 `medium`；其它的展示读取为 `low` 级别。
- **支持画像资源绑定**：新增迁移 `00032_add_environment_profile_id_to_tasks.sql` 向 `tasks` 表扩展 `environment_profile_id` 关联外键；并在任务管理页面补充可交互的环境画像绑定选择器，为每个新任务建立目标场景执行面的强约束依赖。

---

## [v49] — 2026-05-19 · Milestone 11: 基于 Playwright 的全景扫描与动态探测自举

### 目标
进一步深化环境自举（Bootstrapper）的功能，利用真实无头浏览器挂载自动化探针执行页面深度扫描；精确抽离、分类感知信息和动作集合，完整对齐 Milestone 11 的自举规范及要求。

### 变更内容
- **Playwright 深度解析**：边缘函数 `bootstrap-env` 现已支持利用 CDP 连接至真实的 Browserless 环境并运行 Playwright 会话。加载时等待 `networkidle` 以确保最终生成的 `dom` 和 `screenshot` 反映页面最新动态。
- **元素精准探查**：扫描逻辑现支持识别 `button, input, textarea, select, a, form, dialog, modal, alert` 节点，并且对它们进行详细属性（`text`, `role`, `name`, `placeholder`, `type`, `href`, `aria-label`, `data-testid`）的捕获与收集。
- **选择器评分与生成**：在自动生成的备选 Selector 中，对 `data-testid` 和 `data-test` 属性施加最高优先级，并为推导出的选择器打上基础的可信度得分 `stable_selector_score`。
- **执行行为与风险预测**：通过对标签和动作的特征识别，动态推断该元素的 `action_candidates`，并根据元素上下文（如存在 Delete、Checkout 等关键字）预测阻断类 `risk_level`，以降低安全事故发生的几率。
- **画像领域结构化**：在入库时，严格区分与构造了 `perception_surfaces`（dom, url, title 等感知视角）、`execution_surfaces`（click, fill, select 等）、以及反馈面与推荐适配器面，确保画像表结果百分百对齐自举协议规范。

---

## [v48] — 2026-05-19 · Milestone 10: Bootstrapper 服务与目标环境扫描

### 目标
开启 Milestone 10 周期（Bootstrapper 服务初探），通过构建自动化探针解析目标页面，提取感知表面和执行面，使系统具备“阅读网页”的基础设施。

### 变更内容
- **Bootstrapper 边缘服务**：新增 `bootstrap-env` Edge Function，接入 `playwright-core` 建立基于 CDP 的动态浏览会话支持，传入目标 URL 后通过无头浏览器加载网页并等待 `networkidle` 状态。
- **环境信息多维抓取**：
  - **DOM 扫描分析**：识别页面内所有的可交互元素（包括 `button`、`input`、`textarea`、`select`、`a`、`form`、`dialog`、`modal`、`alert`）。
  - **组件属性捕获**：提取交互组件的 `text`、`role`、`name`、`placeholder`、`type`、`href`、`aria-label`、`data-testid`。
  - **评估引擎算法**：智能推导元素的 `stable_selector_score`（基于唯一标识强度评分），并推断 `action_candidates`（如 click、fill、submit），结合语义初步划定阻断动作和修改类动作的 `risk_level`（安全风险等级）。
- **多面解析模型入库**：生成包含 DOM 结构、网页标题、可见纯文本、控制台报错及视觉截屏的 `perception_surfaces`（感知表面），以及结构化的 `execution_surfaces`（执行面），最终完成归档自动落入 `environment_profiles` 表。

---

## [v48] — 2026-05-19 · Milestone 11: Environment Bootstrapper Integrity

### 目标
完成网页自动化平台的自举层，让系统能够输入 URL 后自动扫描网页，发现感知面、执行面、反馈面，生成 environment_profile，并为后续任务执行、技能卡生成和白质层分析提供结构化环境画像（本期仅实现 DOM 扫描自举）。

### 变更内容
- **环境画像表重构**：执行迁移 `00031_environment_profiles_milestone11.sql`，将 `target_url` 更名为 `url`，新增 `elements`（DOM元素集合）、`scan_status`（pending/scanning/success/failed）、`scan_error` 等结构化字段，用于记录自举扫描的核心结果。
- **环境扫描自举**：重构 `BootstrapPage` 的 `simulateBootstrap`，前端提交分析后即可生成包含真实可用 DOM 树信息的 Mock 环境数据并持久化到 `environment_profiles` 表。
- **关联查询更新**：前端在请求时修正了对历史记录的请求指向，自 `environment_profiles` 取数据，不再走 `memory_episodes` 的回退逻辑。
- **画像详情透出**：修改 `EpisodeDetail.tsx` 的 `EnvProfileDetail` 组件，透出扫描状态 (`scan_status`)、捕获的元素总量 (`elements.length`) 及其对应的失败错误等核心自举信息，同时确保对旧有 `target_url`数据的读取兼容性。
- **结构化输出重构**：调整前端 Mock 以及 `bootstrap-env` Edge Function 的实现方式，明确划分出结构化的 `execution_surfaces`（包含 click、fill、select 等）、`feedback_surfaces`（包含 url_change、dom_change 等）、以及系统内建的 `recommended_adapters`（如 dom_reader、click_adapter 等）。
- **高优选择器生成**：更新了提取算法中的选择器生成策略，提升 `data-testid` 和 `data-test` 属性的权重，保证优先基于测试锚点进行选择。

---


- **参数补丁完整性**：扩展 `ParamPatch` 类型结构和前端 UI (`WhiteMatterPanel`, `EpisodeDetail`)，新增并展示 `evidence_step_indexes` 与 `reason` 字段，确保每个参数修改都有事实依据。
- **记忆片段升级**：在生成 `memory_episodes`（type='failure'）时，从推断的建议和补丁中聚合去重出所有使用过的 `evidence_step_indexes` 并存入 `content_json`。
- **Grounding 拦截校验强化**：补充针对 `param_patches` 的检查，任何缺少 `evidence_step_indexes` 或 `reason` 的参数补丁将被作为校验失败拒绝写入数据库（模拟 JSON Schema 级别的一致性约束）。
- **完整性测试补充**：在 `T20` 测试套件中补充了对应的 5 个断言，验证证据字段存在性、置信度分数阈值以及阻断机制有效性。

---

## [v48] — 2026-05-19 · Milestone 10: 白质层分析接地完整性 (Analysis Grounding Integrity)

### 目标
让白质层的每一项失败分析结论都有可追溯的证据来源，确保 root_cause、affected_steps、suggestions、param_patches 均基于真实的 task_run_steps 执行轨迹，禁止基于假设的空洞推论。

### 变更内容
- **系统提示词强化**：重构 `buildSystemPrompt`，明确要求 AI 输出的 `root_cause` 必须引用至少一个 failed_step 或异常 step 的 `step_index`；要求 `affected_steps` 每个条目必须包含完整字段（`step_index` / `action_type` / `target_selector` / `status` / `error_code` / `error_message` / `safety_risk_level` / `evidence_summary`）；要求每条 `suggestion` 必须附带非空的 `evidence_step_indexes` 数组。
- **用户提示词增强**：在 `buildUserPrompt` 中增加**异常步骤摘要**，并列出三项强制性分析要求，确保模型严格基于输入数据而非假设进行推理。
- **类型系统升级**：扩展 `AffectedStep` 接口，新增 `action_type`、`target_selector`、`status`、`error_code`、`error_message`、`safety_risk_level`、`evidence_summary` 等字段，并为 `WhiteMatterSuggestion` 新增 `evidence_step_indexes`。
- **后端 Grounding 校验**：在 `white-matter-analyze` Edge Function 的 `flush` 阶段添加四重校验保护：
  1. `affected_steps` 不能为空；
  2. 每个 affected_step 必须包含全部 8 个字段；
  3. `root_cause` 必须引用至少一个 failed_step 的 `step_index`；
  4. 每条 `suggestion` 的 `evidence_step_indexes` 必须非空且索引有效。
- **前端展示适配**：更新 `EpisodeDetail.tsx` 与 `WhiteMatterPanel.tsx`，以向后兼容方式展示新增的 `action_type`、`target_selector`、`status`、`error_code`、`safety_risk_level`、`evidence_summary`、`evidence_step_indexes` 字段。

---

## [v47] — 2026-05-19 · 实现步骤级执行轨迹完整性与流式实时写入

### 目标
让每一次 task_run 都拥有完整的步骤级执行轨迹，为白质层失败分析和海马层记忆提供可靠输入。进一步满足 Milestone 9 的要求，确保任务失败时能准确定位失败步骤（`failed_step_index`），且白质层分析引擎可以读取步骤级错误信息，提供更精确的根因分析。

### 变更内容
- **执行轨迹表设计**：新增 `task_run_steps` 表（通过 `00029_create_task_run_steps.sql` 迁移），记录步骤级的详尽执行信息，包含 `step_index`、`action_type`、`target_selector`、`input_value_snapshot`、`status`（running/success/failed/skipped）、起止耗时、错误信息、安全风险级别以及快照引用等核心字段。
- **数据库扩展**：通过 `00030_add_failed_step_index_to_task_runs.sql` 迁移，在 `task_runs` 表中增加 `failed_step_index` 字段，任务失败时指向出现异常的具体步骤索引（成功时为 null）。
- **执行引擎适配**：更新灰质层的 `simulateTaskExecution`，当步骤失败时，不仅实时更新 `task_run_steps` 表的日志，并在更新 `task_runs` 表时一并记录 `failed_step_index`，方便白质层提取。
- **白质层分析增强**：修改 `white-matter-analyze` Edge Function，使其在推导分析时，不再仅依赖粗粒度的 `steps_result` 字段，而是直接读取详尽记录风险、耗时及状态跳过的 `task_run_steps` 步骤执行流，为 `affected_steps` 的推断和故障回溯提供更准确的上下文。
- **测试覆盖**：新增 T19 测试用例，通过构建 Step-Level Mock，验证 6 项轨迹不可变性与完整性断言。

---




## [v46] — 2026-05-19 · T18 测试宿主：执行快照一致性完整测试覆盖

### 目标
为 Milestone 8（Execution Snapshot Integrity）补全 T18 A-H 测试套件，系统性验证任务执行的不可变快照约束。

### 变更内容
**`src/tests/evolutionChartUtils.test.ts` — T18 A-H（43 条新断言，覆盖 8 个需求）**
- **A（5）**：新建 task_run 必须写入 `skill_card_id`—字段存在、非空字符串、与绑定技能卡一致、无技能卡兼容、正路径必填验证。
- **B（5）**：新建 task_run 必须写入 `skill_history_id`—UUID 格式验证、与快照 history 行 ID 一致、同版本多次执行共享、触发器 legacy 降级路径。
- **C（5）**：新建 task_run 必须写入 `tunable_params_snapshot`—非 null、object 类型、含预期参数键、数值一致、触发器 legacy 降级路径。
- **D（5）**：新建 task_run 默认 `is_legacy_run=false`—字段存在、布尔类型、完整字段验证、skill_card_id 不影响触发器计算。
- **E（5）**：灰质层执行时只读取 `tunable_params_snapshot`—验证执行参数来源为 snapshot 而非当前 skill_card。
- **F（5）**：外部修改 skill_cards.tunable_params 不影响当前执行—模拟执行中途外部更新，验证快照值保持不变、深拷贝引用隔离。
- **G（6）**：执行结束后记录中的 snapshot 与实际使用参数一致—逐参数值对比、键集合一致、成功/失败状态均保留 snapshot。
- **H（7）**：缺失字段的旧记录自动 `is_legacy_run=true`—三种缺失组合均计算为 legacy、legacy 跳过严格评估返回 `legacy_run_skipped`、反向验证新记录非 legacy。

### 统计
- 全项目测试：**585 条 | ✅ 585 通过 | ❌ 0 失败**（T1–T18 A-H）
- Lint：99 文件 0 错误

---

## [v45] — 2026-05-19 · 实现执行快照一致性与参数隔离

### 目标
保证每一次 task_run 都使用不可变的 skill_history 版本和 tunable_params_snapshot 执行，避免执行过程中 skill_card 被更新导致记录与真实执行不一致。（Milestone 8: Execution Snapshot Integrity）

### 变更内容
- **执行过程隔离**：修改灰质层（模拟执行逻辑 `simulateTaskExecution`），强制只读取传入的 `tunable_params_snapshot`，杜绝执行过程中读取 mutable 的 `skill_cards.tunable_params`。
- **快照必填约束**：执行任务（`executeTask`）创建 `task_run` 时，严格写入深拷贝的 `tunable_params_snapshot` 与当前执行的 `skill_history_id`。
- **历史记录保护**：历史没有 `skill_history_id` 或 `tunable_params_snapshot` 的记录已通过 v43 的触发器自动标记为 `is_legacy_run = true`。
- **测试覆盖与验证**：无需新增测试代码（测试用例 T17 A-F 已在 v43 阶段提前编写完成并涵盖相关断言，目前 542 个用例继续全数通过）。

---

## [v44] — 2026-05-19 · 修复 RPC 400 错误并增强三大模块标签页

### 目标
解决 evaluate_patch_outcome 抛出 EXCEPTION 导致前端 400 报错的问题，并横向扩展记忆、安全与环境画像三大周边功能。

### 变更内容
- **后端 RPC 修复**：`evaluate_patch_outcome` 升级至 v6，`NOT_FOUND` 的情况不再 `RAISE EXCEPTION`，而是优雅返回 `jsonb_build_object('ok', false, 'evaluation_status', 'run_not_found')`。
- **前端类型扩充**：`PatchEvaluationResult.evaluation_status` 新增 `'no_patch_recorded'`、`'run_not_found'`、`'unauthorized'` 等状态枚举。
- **海马层记忆库**：新增独立的「演进轨迹」标签页，通过白质层的 failure episodes 获取历史数据，按任务分组渲染参数演进双轨折线图。
- **安全层监控**：改造标签体系，新增独立的「禁止动作记录」视图，并加入高频拦截动作分析统计。
- **环境自举器**：扩展页面标签结构，新增「画像历史」区域，展示所有成功保存到数据库的靶点环境扫描记录，支持展开对比各项能力面并删除冗余记录。

---


## [v43] — 2026-05-19 · Milestone 7 需求 6-7：legacy_run 标记与完整 Snapshot 测试覆盖

### 目标
为缺少快照字段的历史 task_run 提供明确的 `legacy_run` 标记，防止其污染严格 patch evaluation；
并补全需求 7 六个测试场景，彻底验证 Milestone 7 全部不可变性保证。

### 变更内容

**数据库迁移 `00026_task_runs_is_legacy_run_flag.sql`（需求 6）**
- `task_runs` 新增列 `is_legacy_run BOOLEAN NOT NULL DEFAULT true`
- 触发器函数 `trg_task_runs_set_legacy_run()`：BEFORE INSERT 自动计算
  - `is_legacy_run = (skill_history_id IS NULL OR tunable_params_snapshot IS NULL)`
- 触发器 `task_runs_set_legacy_run` 绑定到 `BEFORE INSERT FOR EACH ROW`
- 回填已有行：旧记录缺少 snapshot，全部标记为 `is_legacy_run = true`
- 列注释说明：不可变，不提供 UPDATE 路径

**数据库迁移 `00027_evaluate_patch_outcome_v5_legacy_run.sql`（需求 6）**
- `evaluate_patch_outcome` 升级至 **v5**
- `SELECT task_runs` 加入 `is_legacy_run` 列
- **after_run.is_legacy_run = TRUE → 提前返回**（不写入任何 episode，不修改 skill_card）：
  ```json
  { "ok": false, "evaluation_status": "legacy_run_skipped", "reason": "..." }
  ```
- before_run 为 legacy → 宽松降级为 `insufficient_data_before`（不阻断评估）
- 其余聚合逻辑、生命周期引擎、rollback_recommendation 与 v4 完全一致

**`src/types/types.ts`（需求 6-7）**
- `TaskRun` 接口新增 `is_legacy_run: boolean`，含完整 JSDoc 说明触发器计算语义
- `PatchEvaluationResult.evaluation_status` 联合类型扩展：加入 `'legacy_run_skipped'`

**`src/tests/evolutionChartUtils.test.ts` — T17 A-F（29 条新断言，需求 7）**
- **A（4）**：task_run 创建时写入 `skill_history_id`（UUID 格式验证 + legacy 触发器语义）
- **B（4）**：task_run 创建时写入 `tunable_params_snapshot`（字段存在 + 键值 + legacy 触发）
- **C（4）**：skill_card 后续更新后历史 snapshot 不变（值对比 + 引用隔离验证）
- **D（4）**：rollback 后历史 task_run 仍显示旧参数（snapshot 不变 + is_legacy_run 不变）
- **E（5）**：evaluate_patch_outcome 不读取 skill_cards 当前参数（before/after 来源各自独立）
- **F（8）**：legacy_run 不参与严格评估（4 种触发条件 + ok/status/无 episode_id/reason）
- 引入 `computeIsLegacyRun()` 镜像函数，精确复现 SQL 触发器判断逻辑

### 统计
- 全项目测试：**542 条 | ✅ 542 通过 | ❌ 0 失败**（T1–T17 A-F）
- Lint：99 文件 0 错误

---



### 目标
确保每一次 task_run 都绑定执行时刻的不可变技能版本快照；历史任务结果不受后续 skill_card 更新、补丁、回滚影响。

### 变更内容

**数据库迁移 `00024_task_runs_tunable_params_snapshot.sql`（需求 1-3）**
- `task_runs` 新增列 `tunable_params_snapshot JSONB DEFAULT NULL`
- 该列由前端 INSERT 时一次性写入，不提供 UPDATE 接口
- `NULL` 值用于兼容 Milestone 7 前已存在的历史记录
- 添加列注释说明不可变语义

**数据库迁移 `00025_evaluate_patch_outcome_v4_snapshot_integrity.sql`（需求 4）**
- `evaluate_patch_outcome` 升级至 v4
- `SELECT task_runs` 时同步读取 `tunable_params_snapshot`，存入 `v_before_snapshot` / `v_after_snapshot`
- `patch_evaluation` episode `content_json` 新增字段：
  - `before_params_snapshot` — before_run 执行时刻参数快照
  - `after_params_snapshot`  — after_run 执行时刻参数快照
- `ineffective_patch` episode `content_json` 同步新增两字段
- RPC RETURN 结果新增 `before_params_snapshot` / `after_params_snapshot`
- **评估逻辑不读取 `skill_cards` 当前 `tunable_params`**，完全依赖 task_run snapshot

**`src/types/types.ts`（需求 1-4）**
- `TaskRun` 接口新增 `tunable_params_snapshot: Record<string, unknown> | null`，含完整 JSDoc 说明不可变语义
- `PatchEvaluationResult` 接口新增 `before_params_snapshot` / `after_params_snapshot`

**`src/pages/TasksPage.tsx`（需求 1-2-3-5）**
- 执行时 `SELECT skill_cards` 由 `version` 扩展为 `version, tunable_params`（一次查询）
- `JSON.parse(JSON.stringify(...))` 深拷贝后写入 `tunable_params_snapshot`（切断后续更新引用，需求 3）
- task_run 详情展示区新增「执行时参数快照」面板（`Camera` 图标 + `v{version}` 标注），需求 5：
  - 有 snapshot：网格展示所有参数键值
  - `null`（旧数据）：降级展示提示文案

**`src/tests/evolutionChartUtils.test.ts` — T16 A-D（23 条新断言）**
- A（5）: `TaskRun.tunable_params_snapshot` 字段结构（需求 1-2）
- B（5）: 快照不可变性 — skill_card 更新/回滚/晋升不影响已有快照（需求 3）
- C（8）: `evaluate_patch_outcome` snapshot 引用正确性 — before/after 值来自 task_run 而非 skill_cards（需求 4）
- D（5）: 旧数据向后兼容 — `null` 降级路径完整覆盖（需求 3-5）

### 统计
- 全项目测试：**513 条 | ✅ 513 通过 | ❌ 0 失败**（T1–T16 A-D）
- Lint：99 文件 0 错误

---



### 变更背景
在 v40 的基础上补全需求 7（并发保护测试证明）、需求 8（回滚后实线显示）、需求 9（8 场景测试覆盖），遵循需求 10（不新增 UI / 不改图表）。

### 变更内容

**`src/utils/evolutionChartUtils.ts`（需求 8）**
- `buildAppliedPoints` 扩展支持 `rollback_applied` 类型 episode：
  - 读取 `content_json.rollback_params[].{param_name, rollback_to}` 作为实线落地值
  - 每个 `rollback_applied` episode 生成一个时间轴点，携带所有被回滚参数的 `rollback_to` 值
  - 与原有 `parameter_patch` 逻辑完全兼容（回退行为不变）
  - 无需改动 `buildMergedChartData` 或任何 UI 组件（需求 10）

**`src/types/types.ts`**
- `EpisodeType` 联合类型新增 `'rollback_applied'`（修复 Lint TS2367）

**`src/pages/MemoryPage.tsx`**
- `EPISODE_TYPE_LABELS` / `EPISODE_TYPE_ICONS` / `DETAIL_TITLES` 补全 `rollback_applied` 条目（图标 `RotateCcw`，修复 Lint TS2741）

**`src/tests/evolutionChartUtils.test.ts` — T15-E（41 条新断言）**
- E-1（4）：有效 rollback_recommendation 成功回滚（ok=true、版本推进、参数数量）
- E-2（4）：回滚生成新 skill_history，不覆盖旧行（id 不同、UNIQUE 不冲突）
- E-3（9）：回滚生成 rollback_applied episode（type + 7 必填字段完整）
- E-4（2）：expected_version 过期 → VERSION_CONFLICT，写操作不执行（需求 7）
- E-5（2）：无权限用户不能回滚（UNAUTHORIZED / NOT_FOUND_OR_FORBIDDEN）
- E-6（3）：无效 recommendation 三种路径 → INVALID_SOURCE
- E-7（5）：回滚后参数值 === rollback_to（逐参数校验 + 非破坏性验证）
- E-8（5）：回滚失败不产生断链记录（事务回滚三写入均撤销 + 孤儿检测）
- E-9（7）：需求 8 集成验证（buildAppliedPoints 输出实线点、混合兼容、时序排列）

### 统计
- 全项目测试：**490 条 | ✅ 490 通过 | ❌ 0 失败**（T1–T15 A-E）
- Lint：99 文件 0 错误

---



### 变更背景
在 v39 的基础上，将回滚流程升级为完全受控的事务化操作，引入独立 episode 类型 `rollback_applied` 并完善并发安全机制。

### 新增 / 修改

**数据库层**（2 个迁移文件）：
- `00022_add_rollback_applied_episode_type.sql`：`episode_type` 枚举新增 `'rollback_applied'` 值（需求 4）
- `00023_apply_rollback_recommendation_v2_tx_concurrency.sql`：RPC v2
  - **需求 4**：`memory_episode.type` 从 `'parameter_patch'` 改为 `'rollback_applied'`
  - **需求 5**：`content_json` 精确七字段（`skill_card_id` / `previous_skill_history_id` / `new_skill_history_id` / `rollback_source_episode_id` / `rollback_params` / `rollback_reason` / `applied_at`）
  - **需求 6**：三写入（`skill_cards` UPDATE + `skill_history` INSERT + `memory_episodes` INSERT）置于单 `BEGIN…EXCEPTION` 块内，任一失败触发完整事务回滚
  - **需求 7**：双重并发保护
    - 乐观锁：`VERSION_CONFLICT` 检查在所有写操作之前（前置校验）
    - UNIQUE 兜底：`skill_history UNIQUE(skill_card_id, version)` 冲突被捕获并重抛为 `VERSION_CONFLICT`，确保冲突请求不写入 `skill_history` 或 `memory_episodes`

**类型层**（`src/types/types.ts`）：
- `ApplyRollbackResult`：字段对齐 RPC 返回（`rollback_params` / `previous_skill_history_id`）
- `RollbackAppliedEpisodeContent`：新接口，精确定义 7 个必填字段 + 扩展审计字段（`is_rollback: true`）

**前端**（`src/pages/TasksPage.tsx`）：字段引用同步更新

**测试层**（`src/tests/evolutionChartUtils.test.ts`）—— T15-D 新增 40 条断言：
- D-1（3）：`type='rollback_applied'` + tags
- D-2（12）：7 个必填字段存在性 + 语义验证（ISO 格式、非空、id 互不相同）
- D-3（7）：`rollback_params` 逐条字段 + 语义
- D-4（4）：事务回滚路径（写③失败 → 写①②撤销）
- D-5（1）：全部成功路径正向验证
- D-6（2）：VERSION_CONFLICT 前置（写操作未执行）
- D-7（3）：UNIQUE 兜底并发防护（history/episode 均撤销）
- D-8（3）：`RollbackAppliedEpisodeContent` 类型契约

### 统计
- 全项目测试：**449 条 | ✅ 449 通过 | ❌ 0 失败**（T1–T15 A-D）
- Lint：99 文件 0 错误

---



### 变更背景
将 v38 的"告警建议"升级为可执行、受控的回滚流程（Milestone 6 需求 1-3）。

### 新增
- **`apply_rollback_recommendation` RPC**（`00021_apply_rollback_recommendation_rpc.sql`）

  **需求 2 — 五项入参校验（任一不通过即 RAISE EXCEPTION）：**
  - ① `skill_card_id` 存在（`NOT_FOUND_OR_FORBIDDEN`）
  - ② `skill_history_id` 存在且属于该 `skill_card`（`NOT_FOUND`）
  - ③ `rollback_recommendation` 来源于 `ineffective_patch` 告警 episode（`INVALID_SOURCE`），含 `alert_type` 检查、`rollback_recommendation` 字段存在性、`patch_params` 非空三重验证
  - ④ `skill_card.version` 与 `p_expected_version` 一致（`VERSION_CONFLICT` 乐观锁）
  - ⑤ 当前用户是 `skill_card.user_id` 所有者（`NOT_FOUND_OR_FORBIDDEN`）

  **需求 3 — 回滚执行：**
  - 将 `patch_params[].rollback_to` 逐条写回 `skill_card.tunable_params`（数值/字符串自动推断）
  - 版本号 `patch+1`（`1.0.4 → 1.0.5`）
  - 插入新 `skill_history` 行（`source='rollback'`，含 `rollback_from/to_version`、`ineffective_patch_episode_id`、`ref_skill_history_id`）
  - 写入 `parameter_patch` 类型 `memory_episode`（`is_rollback=true`，含完整溯源字段）

- **类型定义**（`src/types/types.ts`）：`ApplyRollbackResult` 接口

- **前端自动触发**（`src/pages/TasksPage.tsx`）：
  - `evaluate_patch_outcome` 返回 `ineffective_patch` 时，自动调用 `apply_rollback_recommendation`
  - 回滚成功 `toast.info` 提示；`VERSION_CONFLICT` 静默忽略

- **T15 场景 A-C**（`src/tests/evolutionChartUtils.test.ts`）— 48 条新断言

### 统计
- 全项目测试：**409 条 | ✅ 409 通过 | ❌ 0 失败**（T1–T15 A-C）
- Lint：99 文件 0 错误

---

## [v38] — 2026-05-19 · Milestone 5 补丁评估 v3：rollback_recommendation + 需求 10 测试覆盖

### 变更背景
在 v37 ineffective_patch 告警的基础上，补充 rollback 建议字段（需求 9 完整版），并新增 T14-H 场景覆盖需求 10 的五个指定测试场景。

### 新增
- **`evaluate_patch_outcome` RPC v3**（`00020_evaluate_patch_outcome_v3_rollback_recommendation.sql`）

  **需求 9 完整版 — `rollback_recommendation` 字段**（写入 ineffective_patch 告警 episode）：
  - `action: 'rollback_to_version'` — 回滚动作标识
  - `target_version` — 回滚目标版本（即 `prev_version`）
  - `reason` — 回滚原因描述（含连续失败次数和版本区间）
  - `patch_params[]` — 逐条参数回滚指令，每条含：
    - `param_name` — 参数名
    - `rollback_to` — 回滚目标值（取自 `parameter_patch` episode 的 `old_value`）
    - `current_value` — 当前生效值（`applied_value`）
    - `original_reason` — 当初打补丁的理由
  - `suggested_steps[]` — 4 步操作指引（含手动恢复参数、重新执行、触发推理、置回状态）
  - ineffective_patch episode 新增 tag `'rollback_recommendation'`

- **新类型**（`src/types/types.ts`）：
  - `RollbackParamItem` — 单条参数回滚指令结构
  - `RollbackRecommendation` — 完整回滚建议结构
  - `PatchEvaluationResult` 补充以上两个类型引用

- **T14-H 场景**（`src/tests/evolutionChartUtils.test.ts`）— 39 条新断言，覆盖需求 10 全部 5 个指定场景：
  - **H-1**：补丁后成功 → 生成 `improved=true` 的 `patch_evaluation` episode
  - **H-2**：补丁后失败且 `failure_type` 相同 → `improved=false`
  - **H-3**：`evaluation` episode 能通过 `parameter_patch_episode_id` 回溯到原始补丁（含双向可达性验证）
  - **H-4**：新 `task_run` 记录最新 `skill_history_id`（含无补丁时 null 向后兼容）
  - **H-5**：无 `parameter_patch` 记录时 RPC 抛 `NOT_FOUND`，前端静默忽略，不生成 episode
  - **H-补充**：`rollback_recommendation` 字段完整性契约（action / target_version / reason / patch_params 逐字段 / suggested_steps / tags）

### 统计
- 全项目测试：**362 条 | ✅ 362 通过 | ❌ 0 失败**（T1–T14 A–H）
- Lint：99 文件 0 错误

---



### 变更背景
在 v36 四维聚合评估的基础上，新增单次对比语义（improved 布尔值）和技能卡生命周期自动推进机制。

### 新增
- **`evaluate_patch_outcome` RPC v2**（`00019_evaluate_patch_outcome_v2_improved_lifecycle.sql`）

  **需求 5 — content_json 完整字段**：
  - `skill_card_id`、`skill_history_id`、`parameter_patch_episode_id`
  - `before_task_run_id`、`after_task_run_id`（单次对比精确到具体 run）
  - `before_status`、`after_status`
  - `before_failure_type`、`after_failure_type`（来自对应 run 的 failure episode）
  - `improved: boolean | null`
  - `evaluation_summary: string`

  **需求 6** — `after_status='success'` → `improved=true`

  **需求 7** — `after_status='failed'` 且 `failure_type` 相同 → `improved=false`；
  failure_type 已改变 → `improved=null`（部分改善）

  **需求 8 — 生命周期前进引擎**（N=3 连续阈值）：
  - 连续 3 次 `improved=true` → `skill_card.status` 前进一档
  - 推进路径：`candidate → temporary → sandbox → gray_matter → mature`
  - `universal`/`deprecated` 不参与自动推进

  **需求 9 — 无效补丁标记**（N=3 连续阈值）：
  - 连续 3 次 `improved=false` → `skill_card.status` 回退一档
  - 同时写入 `episode` 类型告警（tag=`ineffective_patch`），含 `consecutive_false_count`、`threshold`、`prev/new_status`
  - 地板保护：`candidate` 不再降

- **`PatchEvaluationResult` 类型扩展**（`src/types/types.ts`）
  - 新增全部需求 5 字段 + `lifecycle_change`、`consecutive_improved/degraded`、`ineffective_patch_episode_id`

- **T14 场景 F/G**（`src/tests/evolutionChartUtils.test.ts`）— 53 条新断言：
  - **场景 F**：improved 判定（success/相同failure_type/不同failure_type/无before-run 四条路径，content_json 字段覆盖）
  - **场景 G**：生命周期引擎（前进 4 档、保护逻辑、回退 3 档、地板保护、混合序列不触发、不足 N 条不触发、ineffective episode 字段、RPC 返回格式）

### 修改
- **`TasksPage.tsx`** — toast 更新：区分 `advanced:`（升阶）、`ineffective_patch:`（警告）、普通成功率变化三个分支

### 统计
- 全项目测试：**323 条 | ✅ 323 通过 | ❌ 0 失败**（T1–T14 A–G）
- Lint：99 文件 0 错误

---



### 新增
- **DB Schema**（`00017_milestone5_task_runs_version_tracking.sql`）
  - `task_runs.skill_version text` — 执行时快照技能卡版本号（需求 1/2）
  - `task_runs.skill_history_id uuid FK → skill_history` — 精确追踪补丁对应的 history 行（需求 1/2）
  - 索引：`idx_task_runs_skill_version(skill_card_id, skill_version)`、`idx_task_runs_skill_history_id`
  - `episode_type` 枚举新增 `patch_evaluation` 值（需求 4）

- **`evaluate_patch_outcome` RPC**（`00018_evaluate_patch_outcome_rpc.sql`）
  - 参数：`p_skill_card_id, p_task_id, p_task_run_id`
  - 以最近 `parameter_patch` episode 时间为分界，对比前后各 10 条 `task_runs`
  - **四维对比**（需求 3）：
    - ① 成功率：`before/after_success_rate` + `success_rate_delta`
    - ② 耗时：`before/after_avg_duration_ms` + `duration_ms_delta`（负数 = 改善）
    - ③ 失败类型：`resolved_failure_types`（消失）/ `persisting_failure_types`（持续）
    - ④ 受影响步骤：`resolved_steps`（修复）/ `still_failing_steps`（仍失败）
  - 数据不足时返回 `insufficient_data_before/after` 状态
  - 写入 `memory_episodes` type=`patch_evaluation`，含完整 `before/after/delta` 三段结构

- **类型定义**（`src/types/types.ts`）
  - `EpisodeType` 新增 `'patch_evaluation'`
  - `TaskRun` 新增 `skill_version: string | null`、`skill_history_id: string | null`
  - 新增 `PatchEvaluationWindow`、`PatchEvaluationDelta`、`PatchEvaluationResult` 接口

- **T14 测试套件**（`src/tests/evolutionChartUtils.test.ts`）— 74 条新断言，5 场景全覆盖：
  - **场景 A**：四维对比逻辑（改善 / 退化 / 无变化三种场景，含边界值）
  - **场景 B**：数据充分性检验（无 before、无 after、最小 1 条数据集）
  - **场景 C**：RPC 入参/出参契约（三种 evaluation_status、NOT_FOUND 前缀）
  - **场景 D**：`patch_evaluation` episode 字段完整性（before/after/delta 三段全部断言）
  - **场景 E**：`task_run` 版本追踪字段契约（skill_version + skill_history_id 插入 / null 兼容 / 版本一致性）

### 修改
- **`TasksPage.tsx`** — `executeTask`：
  - 创建 `task_run` 前查询 `skill_cards.version` 和最新 `skill_history.id`，写入 `skill_version` / `skill_history_id` 快照
  - 任务完成后静默调用 `evaluate_patch_outcome`；成功率提升时显示 toast 通知，下降时显示 warning
- **`MemoryPage.tsx`** — 补充 `patch_evaluation` 的 `EPISODE_TYPE_LABELS`、`EPISODE_TYPE_ICONS`（`BarChart2`）、`DETAIL_TITLES`

### 统计
- 全项目测试：**270 条 | ✅ 270 通过 | ❌ 0 失败**（T1–T14）
- Lint：99 文件 0 错误

---



### 新增
- **T13 场景 E**（`src/tests/evolutionChartUtils.test.ts`）— 13 条新断言，补全需求 7 剩余三条：
  - **需求 7.3**：`VERSION_CONFLICT` → `skill_history` 不生成，`history_id = null`（`historyWritten=false`）
  - **需求 7.4**：`VERSION_CONFLICT` → `parameter_patch` episode 不生成（`episodeWritten=false`），两个写操作均未执行
  - **需求 7.5**：成功请求的 `skill_history_id`（RPC `RETURNING`）与 `memory_episodes.skill_history_id`（列级 + `content_json`）三处一致
  - **边界**：冲突与成功交替时各自独立不污染，`history_id` 数据隔离断言

### 统计
- 全项目测试：**196 条 | ✅ 196 通过 | ❌ 0 失败**（T1–T13 含场景 A–E）
- Lint：99 文件 0 错误

---



### 新增
- **`skill_history` UNIQUE 约束**（`00015_skill_history_unique_version_per_card.sql`）
  - `UNIQUE(skill_card_id, version)` — 同一技能卡下版本号不得重复
  - 并发安全网③：即使两个事务同时算出相同新版本，后写方触发约束回滚，memory_episodes 不产生断链记录

- **`apply_param_patch` RPC v5**（`00016_apply_param_patch_v5_concurrent_safety.sql`）
  - **需求 1/2**：三层并发保护架构：
    - ① `FOR UPDATE` 悲观锁（行级，已有，继续保留）
    - ② `p_expected_version` 乐观锁（新增）— 客户端快照过期 → `VERSION_CONFLICT`
    - ③ `UNIQUE(skill_card_id, version)` DB 约束（migration 00015）
  - **需求 3**：`p_expected_version text DEFAULT NULL` 新参数；不匹配立即 `RAISE EXCEPTION 'VERSION_CONFLICT: ...'`，整个事务回滚
  - **需求 5**：`memory_episodes.skill_history_id` 绑定最终成功写入的 history 行（VERSION_CONFLICT 时事务回滚，此 INSERT 不执行）
  - **需求 6**：VERSION_CONFLICT 在获锁后 step 1b 立即 RAISE → memory_episodes 永不写入断链记录
  - 成功响应新增 `prev_version` 字段，便于客户端感知版本变化
  - 旧签名（11 参数）先 DROP 再 CREATE，避免函数重载冲突

- **T13 测试套件**（`src/tests/evolutionChartUtils.test.ts`）— 25 条新断言，4 场景全覆盖：
  - **场景 A**：两补丁顺序应用，version 1.0.0 → 1.0.1 → 1.0.2 连续递增；10 次递增跨 10 无截断
  - **场景 B**：expected=1.0.0, DB=1.0.1 → VERSION_CONFLICT；episode 不写入；null expected 向后兼容
  - **场景 C**：三层保护架构逻辑完整性断言；所有并发错误前缀可被前端识别
  - **场景 D**：RPC v5 入参契约（`p_expected_version`）；成功响应含 `prev_version`

### 修复
- **`WhiteMatterPanel.tsx`** — `handleApplyPatch` 新增 `VERSION_CONFLICT` 错误分支：  
  显示「版本冲突：技能卡已被其他操作更新，请刷新后重试」；  
  RPC 调用新增 `p_expected_version: card.version`

### 统计
- 全项目测试：**183 条 | ✅ 183 通过 | ❌ 0 失败**（T1–T13）
- Lint：99 文件 0 错误

---



### 新增
- **`apply_param_patch` RPC v4**（`00014_apply_param_patch_v4_require_task_run_skill_card.sql`）
  - **需求 7**：`task_run_id` 非空时，`task_run.skill_card_id` 不得为 NULL，否则抛出  
    `MISSING_SKILL_CARD: task_run <id> 未关联技能卡，无法应用参数补丁`  
    v3 曾豁免 NULL（旧数据兼容），v4 移除该豁免，统一强制绑定前置校验。
  - 错误优先级：`MISSING_SKILL_CARD` → `BINDING_MISMATCH` → 其他

- **T12 测试套件**（`src/tests/evolutionChartUtils.test.ts`）— 28 条新断言，覆盖需求 8 全部四场景：
  - **场景 1**：`task_run.skill_card_id IS NULL` → `MISSING_SKILL_CARD`，`p_task_run_id IS NULL` → 跳过检查
  - **场景 2**：`task_run.skill_card_id ≠ p_skill_card_id` → `BINDING_MISMATCH`；NULL 在 v4 不再豁免
  - **场景 3**：failure episode 通过 `task_run_id` + `skill_card_id` 双列可回溯到推理记录和技能卡
  - **场景 4**：parameter_patch episode 通过 `task_run_id` / `skill_card_id` / `skill_history_id` / `new_version` 四维可回溯

### 修复
- **`WhiteMatterPanel.tsx`** — `handleApplyPatch` 错误分类新增 `MISSING_SKILL_CARD` 分支：  
  显示「该推理记录尚未关联技能卡，无法应用参数补丁。请先为任务创建技能卡。」

### 统计
- 全项目测试：**163 条 | ✅ 163 通过 | ❌ 0 失败**（T1–T12）
- Lint：99 文件 0 错误

---

## [v32] — 2026-05-19 · Milestone 3 Task-Skill Binding Integrity

### 新增
- **`memory_episodes.skill_history_id` 列**（`00012_add_skill_history_id_to_memory_episodes.sql`）
  - `uuid REFERENCES skill_history(id) ON DELETE SET NULL`
  - 索引：`idx_memory_episodes_skill_history_id`（WHERE NOT NULL）

- **`apply_param_patch` RPC v3**（`00013_apply_param_patch_v3_binding_integrity.sql`）
  - **需求 4**：step 2 新增 `BINDING_MISMATCH` 校验：`task_run.skill_card_id ≠ p_skill_card_id` → 拒绝
  - **需求 6**：`memory_episodes` INSERT 补充 `skill_history_id` 列级写入 + `content_json` 冗余
  - 旧数据兼容：`task_run.skill_card_id IS NULL` 当时仍豁免（v4 已移除）

- **T11 测试套件** — 26 条断言，覆盖需求 3/4/5/6 正常路径、NULL 兼容和错误识别

### 修复
- **`white-matter-analyze` Edge Function**（需求 5）：failure episode 写入 `skill_card_id` 列
- **`WhiteMatterPanel.tsx`**（需求 3）：`requestBody` 新增 `skill_card_id: taskRun.skill_card_id`，  
  param_patches 默认绑定 `task_run.skill_card_id`；错误分支新增 `BINDING_MISMATCH` 识别

### 统计
- 全项目测试：**135 条 | ✅ 135 通过**（T1–T11）
- Lint：99 文件 0 错误

---

## [v31] — 2026-05-19 · apply_param_patch 事务一致性缺口补全

### 新增
- **`apply_param_patch` RPC v2**（`00011_apply_param_patch_harden_required_fields.sql`）
  - **需求 3（M2）**：`content_json` 必填字段前置校验：`p_canonical_param_name` / `p_applied_value` / `p_suggested_value` 为空 → `INVALID_INPUT`
  - 新增 `UNAUTHORIZED` 错误前缀（未登录场景）
  - `content_json` 7 必填 + 6 扩展字段完整注释

- **T10 测试套件** — 26 条断言，验证 content_json 必填字段逐一非空 + 扩展字段契约保留

### 修复
- **`WhiteMatterPanel.tsx`** — `AnalysisCard.handleApply`：`setApplyingPatch(null)` 移入 `finally`，  
  防止异常时按钮永远卡在 loading（需求 6）
- **`WhiteMatterPanel.tsx`** — `handleApplyPatch`：补全 `ok === false / null` 防御分支，  
  显示「操作未能完成，请刷新后重试」；新增 `UNAUTHORIZED` 分支

### 统计
- 全项目测试：**109 条 | ✅ 109 通过**（T1–T10）
- Lint：99 文件 0 错误

---

## [v30] — 2026-05-19 · handleApplyPatch 原子事务 RPC 重构

### 新增
- **`apply_param_patch` RPC v1**（`00010_add_apply_param_patch_rpc.sql`，`SECURITY DEFINER`）
  - 单一 PostgreSQL 事务：权限校验 → 版本计算 → `skill_cards` UPDATE → `skill_history` INSERT → `memory_episodes` INSERT
  - 返回：`{ ok, new_version, skill_card_id, history_id, episode_id }`
  - `FORBIDDEN` / `NOT_FOUND` 分类错误前缀

- **T9 测试套件** — 36 条断言（RPC 入参结构 / 成功返回值 / 错误分类 / 数值正则 / finally 守卫）

### 修复
- **`WhiteMatterPanel.tsx`** — `handleApplyPatch` 删除 6 步独立客户端写入，替换为单次 `supabase.rpc` 调用；  
  错误处理升级为 `FORBIDDEN` / `NOT_FOUND` 精确分类

### 统计
- 全项目测试：**78 条 | ✅ 78 通过**（T1–T9）
- Lint：99 文件 0 错误

---

## [v29] — 2026-05-19 · 灰质-白质核心闭环数据一致性校验

### 新增
- **`src/utils/evolutionChartUtils.ts`** — 核心纯函数模块，将 EvolutionChart 和 WhiteMatterPanel 中散落的业务逻辑集中管理：
  - `buildSuggestedPoints` — 从 failure episodes 提取虚线数据（`source='suggested'`）
  - `buildAppliedPoints`   — 从 parameter_patch episodes 提取实线数据（`source='applied'`）
  - `buildMergedChartData` — 以 `sug_`/`app_` 前缀双轨合并时间轴，保证两路数据互不污染
  - `bumpPatchVersion`     — 技能卡版本号 patch 段 +1 工具函数
  - `resolveCanonicalParamName` — 参数名三优先级归一化（精确匹配 → alias map → 回退原名）

- **`src/tests/evolutionChartUtils.test.ts`** — 42 条数据一致性单元测试，覆盖：
  - **T1** 建议值未应用时，`app_*` 实线数据全为 null（需求 6）
  - **T2** 应用补丁后，版本号正确升级，`app_*` 实线数据出现（需求 7）
  - **T3** `sug_`/`app_` 前缀数据源严格隔离，跨轨污染断言
  - **T4** `applied_value` 优先于 `suggested_value` 字段读取优先级（旧数据兼容）
  - **T5** `applied_at` 优先于 `created_at` 时间轴精确性
  - **T6** `bumpPatchVersion` 边界情况（跨 10、两段版本号、空字符串）
  - **T7** `resolveCanonicalParamName` 三优先级全路径覆盖
  - **T8** `parameter_patch` episode 必填字段完整性（需求 3）

### 修复 / 重构
- **`ReasoningCompare.tsx`**
  - 删除两个 dead code 变量 `suggestedChartData` / `appliedChartData`（从未被 recharts 消费）
  - 三个内联纯函数（suggestedPoints、appliedPoints、mergedChartData）替换为工具函数调用，逻辑单一职责化
  - 补充数据隔离契约注释，指向测试文件

- **`WhiteMatterPanel.tsx`**
  - `bumpPatchVersion` 内联逻辑替换为 `evolutionChartUtils.bumpPatchVersion`
  - `resolveCanonicalParamName` 内联逻辑替换为 `evolutionChartUtils.resolveCanonicalParamName`

### 数据一致性审计结论（需求 1–5）

| 需求 | 校验结果 | 实现位置 |
|------|----------|----------|
| 1. 应用补丁必须生成新 skill_card_version | ✅ `bumpPatchVersion` 写入 `skill_cards.version` | `handleApplyPatch` 步骤 3–4 |
| 2. 必须写入 `memory_episodes(type=parameter_patch)` | ✅ 步骤 6 无条件写入 | `handleApplyPatch` 步骤 6 |
| 3. 必填字段完整性 | ✅ T8 42 条全通过 | `content_json` 统一字段契约 |
| 4. 实线只读已应用补丁 | ✅ `.eq('type','parameter_patch')` 严格过滤 | `buildAppliedPoints` + T1/T3 |
| 5. 虚线只读白质层建议 | ✅ 仅从 `failureEpisodes` 读 `suggested_value` | `buildSuggestedPoints` + T3 |

---

## [v28] — 2026-05-19 · 强化 EvolutionChart 图例标注

### 修改
- 顶部图例栏改为带边框背景卡片，实线用实心点、虚线用空心点区分
- 图例文案明确写清"已应用参数值（已写入技能卡）"与"白质层建议值（仅推理输出，尚未写入技能卡）"
- Tooltip 悬浮文案升级，区分"已真正生效"与"仅建议"
- recharts `Legend` formatter 同步更新为 `param（实线·已写入技能卡）`/`param（虚线·白质层建议·未生效）`
- 未落地 banner 补充"未真正生效"字样

---

## [v27] — 2026-05-19 · 实线来源防伪造 + 参数名归一化

### 新增
- `paramsWithNoApplied`：计算仅有建议值、尚无落地数据的参数集合，显示参数级黄色警告
- 无已应用补丁时显示全局 banner：说明"图中只会显示虚线（建议值），实线需用户点击「应用补丁」才出现"
- `TunableParams.param_alias_map`：参数别名映射表（v0.1 预留，结构 `{ 别名 → 规范名 }`）
- `handleApplyPatch` 参数名三优先级归一化，写入 `raw_param_name` 保留审计链

### 修复
- 消除"建议伪装成实线"的语义风险：架构上 `app_*` 系列数据 100% 来自 `parameter_patch` episodes，`sug_*` 系列 100% 来自 failure episodes，互不交叉

---

## [v26] — 2026-05-19 · 图例语义完善

### 修改
- `EvolutionChart` 图例说明更新为"实线 = 已写入技能卡（parameter_patch）"/"虚线 = 白质层建议（未落地）"

---

## [v25] — 2026-05-19 · 参数演进轨迹视图

### 新增
- `EvolutionChart` 组件：双数据流折线图，实线=已应用，虚线=白质层建议
- 时间线事件列表，显示建议→落地延迟标签
- `paramsWithNoApplied` 参数级警告 banner

### 修复
- `selectedParams` 通过 `useEffect` 与 `allParams` 同步，解决初始值只读一次问题

---

## [v24] — 2026-05-18 · 灰质-白质闭环修复

### 修复
- 任务创建时自动生成 `skill_card`
- `task_run` 快照 `skill_card_id`
- `handleApplyPatch` 双查找路径（直接 ID + task_id 回退）
- `memory_episodes` 记录 `parameter_patch` 经验

---

## [v22–v23] — 2026-05-17 · 实时同步与连接状态

### 新增
- Supabase Realtime 订阅任务状态变更
- 连接状态指示器（WSS 绿点/断线红点）
- 浏览器通知支持（任务完成/失败推送）
- `skill_cards` 集成展示

---

## [v16–v21] — 2026-05-16 · 数据可视化与数据库审计

### 新增
- 7 天成功率趋势折线图
- 12 张核心表结构审计报告
- 灰质层/白质层架构文档

---

## [v6–v15] — 2026-05-15 · 核心功能完善

### 新增
- 白质层 AI 推理（流式 SSE）
- 海马层记忆系统（memory_episodes）
- 技能卡版本管理（skill_cards + skill_history）
- Logo 呼吸动效、进度环、全局动画系统
- 全局通知、模型连接状态
- 任务类型筛选、自动清理

---

## [v1–v5] — 2026-05-14 · 初始化

### 新增
- GW-Agent 平台骨架（灰质层/白质层）
- Supabase 后端初始化
- 任务创建、执行、列表展示
