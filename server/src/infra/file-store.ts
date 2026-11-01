import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_NAME = /^[\w-]+$/;

/** JSON documents on disk. A write is atomic, so a crash never leaves a partial file. */
export class FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  read<T>(collection: string, id: string): T | undefined {
    const file = this.pathOf(collection, id);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
  }

  write(collection: string, id: string, value: unknown): void {
    const file = this.pathOf(collection, id);
    mkdirSync(join(this.root, collection), { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2));
    renameSync(temp, file);
  }

  private pathOf(collection: string, id: string): string {
    if (!SAFE_NAME.test(collection) || !SAFE_NAME.test(id)) {
      throw new Error(`Unsafe store path: ${collection}/${id}`);
    }
    return join(this.root, collection, `${id}.json`);
  }
}
