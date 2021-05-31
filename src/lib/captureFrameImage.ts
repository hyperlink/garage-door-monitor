import execa from 'execa';
import assert from 'assert';

export async function captureFrameImage(url: string, filePath: string): Promise<void> {
  assert(url, 'url is empty');
  assert(filePath, 'path is empty');
  const args = [
    '-loglevel',
    'error',
    '-y',
    '-rtsp_transport',
    'tcp',
    '-i',
    url,
    '-frames:v',
    '1',
    filePath
  ];
  // console.log(`ffmpeg ${args.join(' ')}`);
  try {
    await execa('ffmpeg', args);
  } catch (error) {
    console.error('ffmpeg error', error);
    throw error;
  }
}
