import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';

const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

export async function createFile(filePath: string, File): Promise<File> {
  const { mtimeMs: lastModified } = await stat(filePath)

  return new File(
    [await readFile(filePath)],
    path.basename(filePath),
    {
      lastModified,
      type: mime.lookup(filePath) || '',
    }
  )
}
