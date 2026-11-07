import { AppError } from './domain.js';

export interface ManualDownloadBuffer {
  append(chunk: Buffer): void;
  finish(): Buffer;
}

/** A known-length response keeps one bounded allocation, exposed only when full. */
export function createManualDownloadBuffer(contentLength: string | undefined, limit: number): ManualDownloadBuffer {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('Download limit must be a positive safe integer');
  let declared: number | undefined;
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      throw new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '资料文件声明的长度无效，请稍后重试');
    }
    declared = Number(contentLength);
    if (declared > limit) throw new AppError(413, 'MANUAL_TOO_LARGE', '资料文件超过下载限制，请改用精简的保养表图片');
  }
  let destination = declared === undefined ? undefined : Buffer.allocUnsafe(declared);
  let chunks: Buffer[] = [];
  let size = 0;
  let result: Buffer | undefined;
  let failure: AppError | undefined;

  function fail(error: AppError): never {
    failure = error;
    destination = undefined;
    chunks = [];
    throw error;
  }
  function incomplete(): AppError {
    return new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '资料文件未完整下载或长度与声明不符，请稍后重试');
  }

  return {
    append(chunk) {
      if (failure) throw failure;
      if (result) throw new Error('Download buffer is already complete');
      if (chunk.length > limit - size) fail(new AppError(413, 'MANUAL_TOO_LARGE', '资料文件超过下载限制，请改用精简的保养表图片'));
      if (declared !== undefined && chunk.length > declared - size) fail(incomplete());
      if (destination) destination.set(chunk, size);
      else chunks.push(chunk);
      size += chunk.length;
    },
    finish() {
      if (failure) throw failure;
      if (result) return result;
      if (declared !== undefined && size !== declared) fail(incomplete());
      result = destination || Buffer.concat(chunks, size);
      destination = undefined;
      chunks = [];
      return result;
    },
  };
}
