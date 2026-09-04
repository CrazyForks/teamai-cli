# TeamAI Vision / Mission / Goal / Roadmap

## 1. 我们正在解决什么问题

AI Agent 正在快速进入软件研发流程。

过去，AI 更多是一个个人工具：

**Developer + AI Tool**

现在，Claude Code、Codex、CodeBuddy 等 Agent 已经开始承担越来越完整的工程任务。

未来的软件团队会逐渐变成：

**People + AI Agents**

但今天的 AI Agent 仍然主要以“个人”为单位工作。

不同成员的 Agent：

- 使用不同的 Skills 和 Rules
- 拥有不同的 Context
- 不知道团队过去做过什么决策
- 不知道其他成员刚刚解决了什么问题
- 会重复踩团队已经踩过的坑
- 一次 Session 中获得的经验，很难成为整个团队的能力

于是出现了一个新的问题：

> **Agent 越来越强，但它们还没有真正成为一个 Team。**

TeamAI 希望解决的，就是这个问题。

---

# 2. Vision

## Every team becomes an AI-native team.

**让每一个团队都成为 AI-native Team。**

AI-native 并不是“团队里每个人都安装一个 AI 工具”。

而是 AI Agent 真正成为团队工作体系的一部分。

未来团队的基本组成会从：

**People + Tools**

逐渐变成：

**People + AI Agents + Shared Context + Shared Ways of Working**

AI 不再只是一个外部助手。

它参与执行任务、理解团队上下文、积累团队经验，并成为团队能力的一部分。

这就是 TeamAI 对未来团队形态的判断。

---

# 3. Mission

## Make every team continuously smarter with AI.

**让每个团队通过 AI 持续变得更聪明。**

今天使用 AI 最大的问题之一是：

**大量经验没有积累。**

一个工程师花两个小时和 Agent 解决了一个问题。

这个过程中可能经历：

Retry  
Failure  
Human Correction  
Prompt Refinement  
Tool Reject  
Architecture Decision

最终问题解决了。

但第二天另一个工程师遇到同样的问题，他的 Agent 很可能重新走一遍。

这意味着：

**AI 在学习一次任务，但团队没有学习。**

TeamAI 希望改变这一点。

每一次 AI Execution 都应该产生新的 Team Knowledge。

每一次新的 Team Knowledge 都应该改善下一次 AI Execution。

最终形成：

**Execute → Learn → Improve → Execute Better**

所以 TeamAI 最重要的长期判断是：

> **Every execution should make the entire team smarter.**

---

# 4. Goal

## Become the default way teams work with AI agents.

**成为团队与 AI Agents 协作的默认方式。**

我们不希望 TeamAI 只是：

一个 Skill Manager，

一个 Git Wrapper，

一个 Knowledge Base，

或者一个 Session Analytics Tool。

这些都是 TeamAI 的能力，但不是 TeamAI 的最终目标。

我们真正希望建立的是：

当一个团队开始规模化使用 AI Agents 时，TeamAI 成为它自然选择的团队协作层。

团队通过 TeamAI：

- 定义 Agent 如何工作
- 分发团队能力
- 管理团队 Context
- 沉淀 AI Execution 产生的经验
- 持续改善团队的 AI 工作方式

最终：

> **TeamAI becomes the default way teams work with AI agents.**

---

# 5. Product Proposition

## Make Every Team AI Native.

这是 TeamAI 最直接的产品主张。

今天 Claude Code、Codex、CodeBuddy 等 Agent 各自都越来越强。

TeamAI 不需要再创造一个更强的 Coding Agent。

真正缺少的是：

**如何让每一个团队都成为 AI Native。**

这也是 TeamAI 产品架构的来源。

---

# 6. Product Architecture

# Team Execution × Team Context × Team Improvement

TeamAI 的产品由三个核心能力组成。

它们不是三个独立产品，而是一个连续的闭环。

---

## 6.1 Team Execution

### Make every agent work the team's way.

**让每个 Agent 按照团队的方式工作。**

团队应该拥有统一的 AI 工作方式，而不是每个人单独配置自己的 Agent。

Team Execution 管理：

- Skills
- Rules
- Agents
- Hooks
- MCP
- Tools
- Packages
- Model Config
- Environment
- Permissions

并把这些能力分发给：

Claude Code  
Codex  
CodeBuddy  
以及未来更多 Agents。

TeamAI 不绑定某一个 Agent。

团队定义一次自己的工作方式，然后让不同 Agent 使用。

### 核心方向

> **One Team. One Harness. Every Agent.**

---

# 6.2 Team Context

### Make every agent understand the team.

**让每个 Agent 理解整个团队。**

统一 Harness 只能告诉 Agent：

**应该怎么工作。**

但真正高质量地完成任务，还需要知道：

**我们是谁、项目是什么、过去发生过什么。**

因此 TeamAI 需要逐渐建立团队自己的 Context Layer。

包括：

- Projects
- Repositories
- Code
- Architecture
- Documents
- Decisions
- Issues
- People
- Sessions
- Knowledge
- Learnings

进一步形成：

## Team Context Graph

把原本分散的信息连接起来：

**Team ↔ Project ↔ Repo ↔ Code ↔ Issue ↔ Decision ↔ Session ↔ Skill ↔ Learning**

Agent 不应该每次 Session 都从零理解团队。

### 核心方向

> **Every agent understands how the team works.**

---

# 6.3 Team Improvement

### Make every execution improve the team.

**让每一次执行都成为团队能力的积累。**

这是 TeamAI 最重要的长期能力。

TeamAI 可以从 Agent Session 中观察：

- Retry
- Interrupt
- Tool Reject
- Failure
- Human Correction
- Repeated Prompt
- Repeated Issue
- Successful Pattern

然后识别：

什么地方 Agent 经常失败？

什么问题团队正在重复解决？

什么 Prompt 被反复使用？

什么经验值得共享？

什么应该成为新的 Skill？

什么应该成为新的 Rule？

最终形成：

**Session  
↓  
Signal  
↓  
Insight  
↓  
Learning  
↓  
Skill / Rule / Context  
↓  
Team**

### 核心方向

> **Every execution makes the entire team smarter.**

---

# 7. TeamAI Flywheel

这三个模块真正重要的地方，是它们可以形成闭环。

## Team Execution

Agent 完成真实任务。

↓

产生新的 Session、行为和反馈。

↓

## Team Context

TeamAI 知道这些执行发生在哪个：

Project  
Repo  
Code  
Issue  
Decision  
Context

之中。

↓

## Team Improvement

从执行过程中发现：

Failure  
Friction  
Pattern  
Best Practice  
Learning

↓

转化成新的：

Skill  
Rule  
Context  
Knowledge

↓

重新进入 Team Execution。

于是：

# Execution → Context → Improvement → Better Execution

形成 TeamAI 最重要的产品飞轮。

使用 TeamAI 的时间越长：

团队 Context 越完整，

团队经验越丰富，

Harness 越成熟，

Agent 越了解团队，

下一次 Execution 越好。

---

# 8. 我们今天在哪里

TeamAI 当前首先从最明确的问题开始：

## Team Harness Management & Distribution

通过 TeamAI CLI：

**teamai init**

初始化团队 AI 工作环境。

**teamai pull**

把团队最新的 Skills / Rules / Harness 同步给成员和 Agent。

**teamai push**

把个人产生的新能力提交给团队，通过 Review 后成为团队能力。

并通过 Hooks 自动完成同步。

这解决的是 Team Execution 最基础的问题：

> **团队 AI 能力如何统一管理和分发？**

但这只是起点。

从当前产品和 Issues 已经可以看到 TeamAI 正在自然向三个方向扩展：

**Execution**
→ 更多 Agent、更多 Harness 类型、更完整的团队管理

**Context**
→ Recall、Knowledge、Codebase Graph、Multi-project

**Improvement**
→ Session、Friction、Learning、Digest

这三个方向最终汇聚成：

**Team Execution × Team Context × Team Improvement**

---

# 9. Roadmap

Roadmap 不按照单个 Feature 排列。

而按照 TeamAI 能力的成熟过程展开。

---

# Phase 1 — Team Execution

## One Team. One Harness. Every Agent.

第一阶段，把团队 AI 工作环境真正统一起来。

重点建设：

- Unified Resource Model
- Skills / Rules / Agents / Hooks
- MCP / Tools / Packages
- Model Config
- 多 Agent Adapter
- Project / User / Team Scope
- Git Backend
- TeamAI Backend
- CLI + Console
- Version / Review / Permission

从：

**“帮团队同步 Skills”**

升级到：

**“管理团队完整的 AI 工作方式。”**

### 阶段目标

> 团队愿意把自己的 AI Harness 交给 TeamAI 管理。

---

# Phase 2 — Team Context

## Every agent understands your team.

第二阶段，让 TeamAI 从 Harness Management 进一步进入团队 Context。

重点建设：

- Multi-project
- Multi-repo
- Project Context
- Codebase Graph
- Knowledge
- Decisions
- Issues
- Sessions
- Cross-project Retrieval
- Context Ranking
- Context Permissions
- Team Context Graph

TeamAI 的数据模型从：

**Repository**

逐渐升级为：

**Organization → Team → Project → Repo → Context**

### 阶段目标

> Agent 不只是拥有团队的 Rules，而是真正理解这个团队。

---

# Phase 3 — Team Improvement

## Every execution makes the team smarter.

第三阶段，建立完整的 Team Learning Loop。

重点建设：

- Session Collection
- Friction Detection
- Retry / Interrupt / Reject Detection
- Failure Clustering
- Pattern Discovery
- Learning Extraction
- Skill Recommendation
- Rule Recommendation
- Evaluation
- Team Digest
- Team AI Analytics

TeamAI 开始回答：

“团队最近在哪些问题上反复失败？”

“哪些经验值得成为 Skill？”

“哪些 Rule 已经过时？”

“哪些工作方式正在被团队重复使用？”

### 阶段目标

> TeamAI 能够把个人与 Agent 的执行经验，转化成整个团队的能力。

---

# Phase 4 — Self-improving Team

## The team improves itself.

最终，Execution、Context、Improvement 形成完整闭环。

TeamAI 可以主动发现：

“这个问题一个月已经出现了 12 次。”

“5 个工程师正在重复使用类似 Prompt。”

“这个 Skill 使用之后任务成功率明显提高。”

“这个 Rule 已经不符合当前代码结构。”

“这里应该产生一个新的 Skill。”

然后：

**Observe  
↓  
Understand  
↓  
Recommend  
↓  
Generate  
↓  
Evaluate  
↓  
Review  
↓  
Deploy**

Team Harness 开始从团队每天的真实工作中持续进化。

最终实现 TeamAI 的 Mission：

# Make every team continuously smarter with AI.

---

# 10. 整体战略

TeamAI 的演进可以浓缩成四步：

## 01 Execute

让所有 Agent 按照团队方式工作。

↓

## 02 Understand

让所有 Agent 理解团队。

↓

## 03 Learn

从所有 Agent 的执行中学习。

↓

## 04 Self-Improve

让学习结果自动改善未来执行。

因此：

# Execute → Understand → Learn → Self-Improve

---

# 11. 一句话总结

## Vision

**Every team becomes an AI-native team.**

让每个团队都成为 AI-native Team。

## Mission

**Make every team continuously smarter with AI.**

让每个团队通过 AI 持续变得更聪明。

## Goal

**Become the default way teams work with AI agents.**

成为团队与 AI Agents 协作的默认方式。

## Product Proposition

**Make Every Team AI Native.**

让每一个团队都成为 AI Native。

## Product Architecture

**Team Execution × Team Context × Team Improvement**

## Roadmap

**Execute → Understand → Learn → Self-Improve**

## North Star

**Every execution makes the entire team smarter.**