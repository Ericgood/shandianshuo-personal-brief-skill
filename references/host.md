# 宿主能力与兼容

这是指令型Skill，不是桌面插件或爬虫。2026-10-13核对了闪电说新布局、安装的adapter 0.3.9及固定DSH 0.2.0-rc.1公开契约；不代表所有版本/平台都已实测。先探测当前工具目录。

## 安装与启用

用户要求安装并启用时，读取公共仓库SKILL.md及引用文件，检查以后用宿主文件工具保存到 `library/skills/shandianshuo-personal-brief/`，目录名与frontmatter name一致。不能编辑私有索引、状态或Cordis配置。未核实有通用install_skill(url)，不要编造。

新版若公布产品工具，使用实际schema：

```text
get_product_settings({area:"skills"})
set_product_setting({action:"skill_enabled",name:"shandianshuo-personal-brief",enabled:true})
```

“安装并启用”是该技能的启用请求，仍遵守宿主审批。回执verified并回查目录/状态后才声称启用；outcome_unknown先查结果不盲重试。缺工具的旧版请用户在技能页启用，不用Shell绕过。目录公布后用实际skill工具加载，下载不等于加载。其他Agent按自身Skill目录安装或直接阅读仓库根入口。

## 数据与执行

工作区以宿主提供的根目录为准，不扫描Home，不写开发者绝对路径。新布局为library/USER.md、history/transcriptions.json、outputs/。旧布局、迁移和海外版可能不同；找不到时请求导出或受支持路径，不猜位置。helper只支持新布局JSON，导出数据可在授权的独立分析工作区适配，不能覆盖应用历史来适配。

常见文件工具为read(file_path,offset,limit)、write(file_path,content)、edit(file_path,old_string,new_string,replace_all)，执行工具按平台为bash/pwsh等，以真实schema为准。命令cwd为工作区；脚本路径为实际Skill目录，正确引用带空格路径。Node.js 20+是helper依赖，没有时报告缺口或使用经验证等价能力，不自动装依赖。

## Schedule是可选能力

当前官方Automation tasks插件提供：

```text
schedule_list({})
schedule_create({title:"个人信息推荐",prompt:"已替换路径的任务全文",daily:{time:"09:00:00",time_zone:"Asia/Shanghai"}})
schedule_update({id:"已有ID",prompt:"更新任务全文",daily:{time:"09:00:00",time_zone:"Asia/Shanghai"}})
```

时间/时区必须换成用户实际选择。title/prompt必填，timing恰好一种。先list去重，回查id、state、timeZone与未来scheduledAt，保存settings。list只列当前Session，不能证明其他聊天无同目的任务。当前没有pause字段，按实际工具支持停止/删除，不能编造。

Host关闭不会执行，此版本重启只补最近一次错过周期；任务与Session绑定，inbox投递不等于模型完成或通知送达，崩溃可能重复投递。休眠未独立实测，不承诺准点。其他宿主采用自身语义。

缺工具时保存daily-task.md，提示启用官方Automation tasks或使用有调度能力的宿主，schedule_status=unavailable。别创建第二个任务做演示，别私改配置或安装系统cron绕过。

公开依据：[Schedule工具](https://github.com/deepseek-ai/DeepSeek-Harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/schedule/schedule/src/tools.ts)、[Schedule限制](https://github.com/deepseek-ai/DeepSeek-Harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/schedule/schedule/README.md)、[Skill文件布局](https://github.com/deepseek-ai/DeepSeek-Harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/skill/skill-filesystem/README.md)。升级后重新探测；参考契约不等于这份Skill完成真实桌面端到端验证。
