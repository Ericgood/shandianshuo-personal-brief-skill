# 全量理解与可恢复分析

## 输入

当前新布局为 `history/transcriptions.json`，形状 `{ "version":"1.0", "records":[...] }`。timestamp为Unix秒。helper冻结授权1—365天内全部记录的original_text、voice_instruction、text、normalized_text、ai_corrected_text，保留字段标签；text可能是生成结果，不能直接当本人信念。相同文字合并来源，不同文字无损保留。所有状态均覆盖，无文字占位不作兴趣证据；超长文字无损分片。未知日期单列，不猜时间。

先inventory再prepare；最终范围以prepare为准。可用 `--end 2026-01-31T23:59:59+08:00` 固定历史锚点，必须带时区，N天向前取窗。helper默认排除并计数无日期记录，不把无法归期的私人文字自动送给模型。说明excluded.undated并询问这组处理选择；用户也授权该组后才加 `--undated include`，单列归纳、不用于时间趋势。增量沿用该用户选择。

快照在 `outputs/personal-brief/analysis/run-UUID/`。manifest保存源哈希、窗口、记录引用/ID/指纹；batch含授权的私人文本，mode 0600/目录0700在支持平台生效。它不是公开日志，不能提交或分享。原历史不改写，不打开录音、截图或Agent sidecar。

## 逐批阅读

prepare成功后立即将run写入settings.json的analysis.active_run；每轮先对active_run调用status，完成笔记合并与profile更新才推进last_completed_run并清空active_run，防止中断后又创建全年快照。next RUN返回下一未接受批次。先读columns/fieldBits，再解释紧凑数组：

```text
[part,timestampSeconds,tier,status,recordType,texts]
texts=[[字段位掩码,完整文字,可选分段编号,可选总段数],...]
```

entries约18000字符以内，工具输出上限还要留元数据余量。实际看到END_OF_BATCH才提交；截断重新读，不能只提取尾标记冒充读完。

每批保存response-N.json：

```json
{
  "hash":"实际hash","endMarker":"实际END_OF_BATCH","coverage":"complete",
  "assessment":"实际语义、表达主体与局限",
  "readings":[{"part":"r0p0","kind":"task","gist":"实际含义或排除理由"}],
  "themes":[{"statement":"候选关注及时间层","evidence":["r0p0"]}],
  "selfStatements":[],"currentNeeds":[],"conflicts":[],"excludedObservations":[]
}
```

readings恰好覆盖所有part，kind为self/task/quoted/generated/error/unclear。混合含义在gist解释，不把工作代写、虚构角色、引文或故障频率归成身份和喜好。所有观察引用本批真实part，无证据数组为空；不要复制无关隐私或大段原文。

accept的RESPONSE_FILE是工作区相对路径，如 `outputs/personal-brief/analysis/RUN/response-1.json`。status检查快照未变、片段账目及引用结构，不能证明模型理解正确。中断以后续读同一run；额度失败保持未完成，换接收方遵循宿主授权，不能静默改用第三方模型。

## 全体归纳与审计

全部批次完成以后，阅读全部note。可按分组生成中间归纳，但每组记录覆盖的note范围，逐层合并并复核冲突，不只抽样。跨批长记录连接上下文。

写analysis/RUN/coverage.json，含run、记录/片段/批次总数和接受数、各层归纳覆盖范围、实际模型/接收方、完成时间与局限。分别说明原文与归纳的阅读，不能把“主Agent复核全部笔记”说成主Agent独自重读所有原文。

profile.md按模板生成，settings.json记录profile_status和analysis.last_completed_run。首次完整建档同时初始化profile.recent_updated_at、profile.stable_reviewed_at；把稳定偏好、近期需要、新观察候选分开，再在各项保留远中近期证据。未合并笔记也算未完成。零批次complete只表示无待处理结构，空历史不证明了解用户。

## 增量

prepare --days N --since LAST_COMPLETED_RUN检查旧run完成，比较当前窗口的全部记录指纹，新增/修改完整读取；重复ID用多重集合，不吞第二条。增量命令未显式传--days或--undated时沿用前次选择，不默认扩展授权范围。无稳定ID的修改可能表现为移除+新增，仍复核旧证据。无变化零批次，不重算全年。

removedOrOutsideWindow可能是删除、修改、日期变化或滑出窗口，不能解释成不喜欢。保留旧档案与明确反馈，复核受影响事实，不因滑出365天删除长期兴趣。每日把全部增量语义合并进近期需要/候选证据，成功才推进last_completed_run与recent_updated_at；稳定层按daily.md每7天复盘，明确纠正立即处理。近期合并不能顺便标记稳定复盘完成；失败保留原层的截至时间。
