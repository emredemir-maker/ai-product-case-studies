import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** A JSON file holding a list. Single process; every write replaces the file atomically. */
export class JsonList<T> {
  constructor(private readonly file: string) {}

  read(): T[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as T[];
  }

  write(items: T[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export function newId(taken: { id: string }[]): string {
  let id: string;
  do id = crypto.randomBytes(3).toString("hex");
  while (taken.some((t) => t.id === id));
  return id;
}
