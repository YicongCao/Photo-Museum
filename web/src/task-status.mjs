export function taskStatus(media, jobs = [], loadError = "") {
  if (loadError) return { text: media ? "进度更新失败" : "进度加载失败", icon: "alert" };
  if (!media) return { text: "加载进度中", icon: "clock" };
  if (media.paused) return { text: "媒体已暂停", icon: "pause" };
  if (media.active?.length || jobs.some(j => ["queued", "running"].includes(j.status)))
    return { text: "任务进行中", icon: "clock" };
  const total = Object.values(media.counts || {}).reduce((sum, n) => sum + n, 0);
  if (total > (media.fully_done || 0) + (media.error_count || 0) && media.completion_events?.length)
    return { text: "任务进行中", icon: "clock" };
  if (total > (media.fully_done || 0) + (media.error_count || 0))
    return { text: "等待处理", icon: "clock" };
  if (media.error_count) return { text: "有待处理异常", icon: "alert" };
  if (total && media.fully_done >= total) return { text: "全部处理完成", icon: "check" };
  return { text: "暂无任务", icon: "clock" };
}
