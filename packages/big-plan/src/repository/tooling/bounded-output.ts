import { Writable } from 'node:stream';

export class BoundedOutput extends Writable {
  private chunks: Buffer[] = [];
  private retainedBytes = 0;
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.totalBytes += chunk.length;
    this.chunks.push(Buffer.from(chunk));
    this.retainedBytes += chunk.length;
    while (this.retainedBytes > this.maxBytes && this.chunks.length > 0) {
      const first = this.chunks[0];
      if (first === undefined) break;
      const excess = this.retainedBytes - this.maxBytes;
      if (first.length <= excess) {
        this.chunks.shift();
        this.retainedBytes -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.retainedBytes -= excess;
      }
    }
    callback();
  }

  text(): string {
    const output = Buffer.concat(this.chunks, this.retainedBytes).toString(
      'utf8',
    );
    const omitted = this.totalBytes - this.retainedBytes;
    return omitted === 0
      ? output
      : `${output}\n[${omitted} earlier bytes omitted]`;
  }
}
