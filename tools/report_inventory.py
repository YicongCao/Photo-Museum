#!/usr/bin/env python3
"""Publish aggregate-only research; never publish file paths or raw EXIF."""
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def generate(inventory, media):
    n = inventory['kinds'].get('image_candidate', 0)
    mean = media['summary']['mean_combined_bytes']
    if mean is None:
        raise ValueError('No successful SDR samples; cannot estimate cache capacity')
    sampled_photos = [r for r in media['records'] if r['kind'] == 'photo']
    sampled_videos = [r for r in media['records'] if r['kind'] == 'video']
    passed = media['summary']['successful_sdr_photos']
    hdr_photos = sum(r['status'] == 'deferred_hdr' for r in sampled_photos)
    hdr_videos = sum(r['status'] == 'deferred_hdr_video' for r in sampled_videos)
    excluded = Counter(r['reason'] for r in inventory['excluded_directories'])
    start = datetime.fromisoformat(inventory['run']['started_at'])
    finish = datetime.fromisoformat(inventory['run']['finished_at'])
    minutes, seconds = divmod(round((finish-start).total_seconds()), 60)
    local_date = start.astimezone(ZoneInfo('Asia/Shanghai')).date()
    by_year = Counter()
    for event in inventory['events'].values():
        by_year[str(event['year'] or '未知')] += event['counts'].get('image_candidate', 0)
    rows = '\n'.join(f'| `{ext}` | {count:,} |' for ext,count in inventory['extensions'].items())
    years = '\n'.join(f'| {year} | {count:,} |' for year,count in sorted(by_year.items()))
    candidate_pairs=inventory['live_photo_filename_pairs']
    budget = {
        'candidate_images': n,
        'sample_successful_sdr_images':media['summary']['successful_sdr_photos'],
        'mean_combined_bytes':mean,
        'sample_extrapolation_bytes':n*mean,
        'sample_plus_20_percent_bytes':n*mean*1.2,
        'conservative_assumption_bytes_per_image':1_500_000,
        'conservative_plus_20_percent_bytes':n*1_500_000*1.2,
        'units':'GB uses 1e9 bytes; assumptions, not a full-library encoding measurement',
    }
    report=f'''# 照片库盘点与本地缓存预算

盘点日期：{local_date}（Asia/Shanghai）。这是候选文件名清单与小样本编码实验，不是已完成的全库 EXIF 刮削。私密逐文件证据只在被 Git 忽略的 `data/`。

## 一分钟读懂

- **{inventory['event_count']:,} 个活动目录，{n:,} 个图片候选。** 其中 {inventory['events_with_entries']} 个活动在排除规则后仍有文件记录；空活动也计入目录总数。
- **{inventory['kinds']['video_candidate']:,} 个视频候选**；其中 {candidate_pairs:,} 个 MOV 与同目录唯一同名图片可候选配对，另有 {inventory['ambiguous_live_photo_groups']} 组歧义。尚未验证内容标识，不能直接称为已确认 Live Photo。
- 活动中直接混有 **{inventory['kinds'].get('raw',0)} 个 RAW**。另跳过{excluded['originals_directory']}个明确原片目录和{excluded['system']}个系统项，其内部文件未计数。因此这里不是整个 NAS 的备份文件总量。
- 两档图片缓存按{passed}张成功 SDR 小样本外推 **{budget['sample_extrapolation_bytes']/1e9:.2f} GB**；加20%约 **{budget['sample_plus_20_percent_bytes']/1e9:.2f} GB**。采用每图两档合计1.5MB再加20%的保守规划场景约 **{budget['conservative_plus_20_percent_bytes']/1e9:.2f} GB**。
- 当前图片规模远未显示需要200GB缓存或SQLite按年拆表。视频原件/转码、本地模型和临时文件需要单独预算，不能据此承诺整个服务只占10GB。

## 盘点完整性与统计定义

扫描状态 `{inventory['run']['status']}`；成功列举 {inventory['directory_states'].get('done',0)} 个目录（包含根目录、活动及嵌套目录）；失败 {len(inventory['errors'])} 个。原始UTC时间为 `{inventory['run']['started_at']}` 至 `{inventory['run']['finished_at']}`，约{minutes}分{seconds}秒；计数分类修订在读取同一份清单后进行，无需再次读取媒体内容。

这是不读取每张图片字节、避免逐媒体stat的文件名盘点。已知媒体后缀先计候选，正式入库仍需验证普通文件类型、解码、成片规则、内容哈希与EXIF。`.photo`等未知格式的专项核验见媒体报告；不通过改后缀猜测它们是成片。

扫描不是原子快照。恢复操作继续既有目录队列，不重新扫描已经完成的目录；要发现期间新增文件，开启新的盘点run。生产增量适配器尚未实现。未执行去重，全年总结与原活动可能同时包含同一张照片。

{inventory['video_candidates_without_unique_pair']} 个视频未形成唯一文件名配对，其中包括待复核歧义和真实独立视频，不能将其全部认定为独立视频。LRF代理/SRT字幕单独记录，不能与成片重复计数。

## 格式分布（所有已列举非排除文件）

| 后缀（不区分大小写） | 个数 |
| --- | ---: |
{rows}

## 图片候选按活动目录年份

按目录年份归组，**不是EXIF拍摄年份**，没有从月份缺失推断具体日。

| 目录年份 | 图片候选 |
| --- | ---: |
{years}

## 缓存方案与空间

实验定义：长边3840像素的WebP（质量78）＋长边640像素的WebP（质量72），保留比例、不放大，ICC转换到sRGB/SDR，剥离EXIF/GPS。{len(sampled_photos)}张图片中{passed}张通过此路径，{hdr_photos}张HDR/gain-map单列暂缓；视频样本{len(sampled_videos)}段，其中{hdr_videos}段HDR暂缓。未把未经色调映射的帧算成功。样本按年份与格式挑选，**不是随机代表样本**，不能据此给出统计置信区间或全库HDR比例。

| 场景 | 两档图片缓存 |
| --- | ---: |
| {passed}张SDR样本均值 × 全部图片候选 | {budget['sample_extrapolation_bytes']/1e9:.2f} GB |
| 上述估计 ＋20%余量 | {budget['sample_plus_20_percent_bytes']/1e9:.2f} GB |
| 假设每张1.5MB，两档合计，再＋20% | {budget['conservative_plus_20_percent_bytes']/1e9:.2f} GB |

这些值均不含视频原件/转码、SQLite/向量、模型、地图数据库。以640封面每个100KB粗略预算，全部视频封面额外约 {inventory['kinds']['video_candidate']*100_000/1e9:.2f} GB；这是显式假设，HDR视频封面尚未实测成功。

建议先设 **80GB缓存硬上限**：照片衍生图、按需原生文件、视频转码和临时下载都在同一预算下预留/淘汰。缩略图优先保留；4K可LRU重建；原始视频按需读取，不提前全量复制。索引、人工精选和人物标签不随缓存淘汰。模型与数据库另行显示占用，未来增加离线地图数据前重新核算。

不要用文件数量直接推断NAS原始字节总量；本轮没有全量文件大小统计。首次全库转码时间也无法仅按0.9秒/张相乘承诺，NAS吞吐、HDR比例、CPU并发与解码峰值内存尚需正式管线测试。

## 重现与下一步

工具：`tools/inventory.py`、`tools/media_probe.py`、`tools/report_inventory.py`。Python依赖由`uv.lock`固定；FFmpeg/ExifTool版本见 [媒体报告](media-pipeline.md)。

下一步先选择少量代表活动，通过正式WebDAV适配器完整走通：属性发现→分类→EXIF→本地衍生图→主题展览→暂停/恢复与新增发现。选片算法先做多样性基线；后续本地模型提出建议，人工选择保留。
'''
    return report, budget


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory',type=Path,default=Path('data/research/inventory.json'))
    p.add_argument('--media',type=Path,default=Path('data/research/media-probe/results.json'))
    p.add_argument('--output',type=Path,default=Path('docs/research/library-census.md'))
    a=p.parse_args()
    report,budget=generate(json.loads(a.inventory.read_text()),json.loads(a.media.read_text()))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(report)
    a.output.with_suffix('.json').write_text(json.dumps(budget,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(budget,ensure_ascii=False))


if __name__=='__main__':
    main()
