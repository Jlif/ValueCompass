export const BACKUP_FORMAT = 'valuecompass-backup';
export const BACKUP_VERSION = 3;

export type BackupData = Record<string, unknown>;

export interface BackupPart {
  capture: () => BackupData;
  hasData: (data: BackupData) => boolean;
  prepare: (data: BackupData) => () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createBackupArchive(parts: BackupPart[]): string {
  const data = parts.reduce<BackupData>((result, part) => {
    for (const [key, value] of Object.entries(part.capture())) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new Error(`备份字段重复: ${key}`);
      }
      result[key] = value;
    }
    return result;
  }, {});

  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      ...data,
    },
    null,
    2
  );
}

export function parseBackupArchive(text: string): BackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!isRecord(parsed)) throw new Error('JSON 结构无效');
  return parsed;
}

export function restoreBackupArchive(text: string, parts: BackupPart[]): number {
  const data = parseBackupArchive(text);
  // 先完整校验并准备所有模块，避免后一个模块报错时前一个模块已修改本地数据。
  const commits = parts
    .filter((part) => part.hasData(data))
    .map((part) => part.prepare(data));

  if (commits.length === 0) throw new Error('备份中没有可恢复的数据');
  for (const commit of commits) commit();
  return commits.length;
}
