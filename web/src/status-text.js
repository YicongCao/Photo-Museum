// Public UI copy is an allowlist, never a rendering of an exception or response body.
export const failureCopy = {
  connection: ['暂时无法连接服务', '检查网络或服务状态后重试', 'connection'],
  timeout: ['请求超时', '请先检查当前状态', 'clock'],
  response: ['服务响应暂不可用', '稍后重新读取', 'server'],
  authentication: ['需要重新解锁', '请使用馆主密码解锁', 'lock'],
  password: ['密码不正确', '请重新输入馆主密码', 'lock'],
  permission: ['无法执行此操作', '请检查访问权限', 'lock'],
  missing: ['内容暂不可用', '可能已更新或不在当前范围内', 'photo'],
  conflict: ['数据已更新', '重新读取后再操作', 'refresh'],
  validation: ['请检查输入内容', '', 'alert'],
  oversized: ['文件超过处理上限', '保留索引与占位预览', 'file'],
  rate_limit: ['请求过于频繁', '稍后再试', 'clock'],
  unknown: ['操作未完成', '请稍后重试', 'alert'],
};
export const domainFailures = {
  credentials_or_permission:'NAS 拒绝访问，请检查凭据与目录权限',
  network_unavailable:'暂时无法连接 NAS',
  tls_verification_failed:'HTTPS 证书未通过验证，请检查受信 CA',
  partial_listing:'目录读取不完整，保留已有索引',
  media_DecompressionBombError:'图像尺寸超过安全上限',
  pq_or_hlg_transfer:'HDR 传递函数待适配',
  gainmap_requires_sdr_base_validation:'增益图 SDR 基底待复验',
  unknown_color_profile:'缺少色域标记',
  unknown_video_color:'视频色域待适配',
  hdr_metadata_requires_sdr_base_or_tonemap_validation:'HDR 编码待适配',
  codec_timeout:'转码超时',
  source_exceeds_2gib_limit:'原文件超过 2 GiB',
  cache_budget_exceeded:'缓存空间不足',
};
const messages = [
  '检索已过期，请重新检索','照片已更新，请重新检索','该照片没有此有效候选','标记已改变，请刷新后操作','标记已改变，无法撤销',
  '确认记录已变化，请重新读取','面孔或人物已变化，请重新读取','已有后续人工修订，无法直接撤销',
  '请选择不同的人物分组','人物分组已变化，请刷新后重选','合并后的分组已被修改，无法直接撤销',
  '设置已在其他页面更新，请重新读取','照片源不存在','离线地址数据或分析进程未就绪','请先启用离线地址解析',
  '策展任务不存在','展览未准备好或不存在','展厅无效','请输入策展想法','请先配置Provider',
  '已有策展进行中，请等待或取消','上一轮任务不可续写','请先结束或取消当前策展','首次设置只允许本机访问',
  '该源已存在；请使用更新凭据','扫描范围超出照片根目录','只扫描一级主题目录，不进入二级目录',
  '原片或系统目录不纳入照片库','任务已结束','照片不存在或不在当前刮削范围','推断已经更新',
  '源版本已变更','源版本已变更，请刷新索引','NAS 文件版本变化，请重新扫描','原文件校验标记不匹配',
  '活动已不可用','照片已失效或不属于当前展览','当前文件数据暂不可用','预览解码失败',
  '底图未载入','请求超时','原图暂不可用','原图无法解码',
  'NAS 原图读取失败','原图转换忙，请稍后重试','原图超过单次转换上限','原图色彩格式待适配',
  '馆主密码需要 12–256 个字符','已初始化，请登录','尝试过多，请稍后重试','密码不正确',
  'Provider地址无效','Provider需要HTTPS','更换Provider地址时请重新输入API key','请输入API key',
  'Provider响应过大','模型输出超过本次上限','工具调用格式无效','工具调用超过本次上限',
  'Provider连接或流式响应中断','模型未完整结束，未发布展览','工具调用标识无效',
  '工具结果过大，请缩小筛选','工具连续3次未通过校验，已停止重复尝试；请查看工具错误中的字段提示',
  '达到本次推理轮次上限，未发布展览','本次策展超时，未自动重试','本次策展中断，未自动重试',
  '服务已重启，本次未自动重发','本地检索工具执行失败，本次未发布展览',
  'API key未通过验证','Provider拒绝请求','Provider配额或速率限制','页面暂不可用','预览暂不可用','词库已更新或分页条件已变化，请重新查询','词库查询参数无效','关键词 ID 无效或已过期，请先查询词库',
];
const approved = new Set([...messages,...Object.values(domainFailures),...Object.values(failureCopy).map(value=>value[0])]);
export function failureInfo(error) {
  if(!error)return null;
  const raw=typeof error==='string'?error:error?.message || '';
  if(error?.name==='AbortError')return null;
  let code=Object.hasOwn(failureCopy,error?.code)?error.code:Object.keys(failureCopy).find(key=>failureCopy[key][0]===raw);
  if(!code){
    if(/Failed to fetch|Load failed|NetworkError|network request failed/i.test(raw))code='connection';
    else if(error?.name==='TimeoutError'||raw==='请求超时')code='timeout';
    else code=({401:'authentication',403:'permission',404:'missing',409:'conflict',413:'oversized',422:'validation',429:'rate_limit'})[error?.status] || (error?.status>=500?'response':'unknown');
  }
  const [fallback,detail,icon]=failureCopy[code];
  const title=(Object.hasOwn(domainFailures,raw)?domainFailures[raw]:null) || (raw&&approved.has(raw)?raw:fallback);
  return {code,title,detail: title===fallback?detail:'',icon};
}
export function failureText(error){return failureInfo(error)?.title || ''}
export function failureCode(error){return failureInfo(error)?.code || ''}
