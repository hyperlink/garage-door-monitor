#!/usr/bin/env node

import del from 'del';
import { captureFrameImage } from './lib/captureFrameImage';
import { Prediction } from './lib/prediction';
import { resolve, join, dirname } from 'path';
import ms from 'ms';
import { Pushover } from './lib/Pushover';
import pRetry from 'p-retry';
import cpFile from 'cp-file';
import { existsSync } from 'fs';
import execa from 'execa';

const MAX_RETRIES = 5;
const CONFIDENCE_THRESHOLD = 75;
const DEFAULT_IMAGE_PATH = '/Volumes/RAMDisk/last-shot.jpg';
const CHECK_GARAGE_EVERY_MS = ms(process.env.GARAGE_CHECK_INTERVAL || '30s');
const modelPath = resolve(process.env.MODEL_PATH);
const imagePath = resolve(process.env.IMAGE_PATH || DEFAULT_IMAGE_PATH);
const prediction = new Prediction(modelPath);
const pushover = new Pushover(process.env.PUSHOVER_TOKEN, process.env.PUSHOVER_USER);
const RAM_DISK_SIZE_MB = process.env.RAM_DISK_SIZE || 2 ;

let previousIsClosedState = null;
let dateOfLastLowProbability = null;

const TEN_MINUTES = ms('10m');

async function checkGarageDoor() {
  try {
    await captureFrameImage(process.env.RTSP_URL, imagePath);
    const result = await prediction.predict(imagePath);
    const roundedResult = Math.round(result.probability * 100);
    let friendlyResult = '';
    let isClosed = null;

    if (result.className.toLocaleLowerCase().includes('closed')) {
      isClosed = true;
      friendlyResult = 'closed';
    } else {
      isClosed = false;
      friendlyResult = 'open';
    }

    if (roundedResult < CONFIDENCE_THRESHOLD) {
      // Save this frame off so we can retrain our model later
      const renamedImagePath = resolve(join(__dirname, `../low-score-${result.probability * 1e18}.jpg`));
      const message = `Detected low confidence score of ${roundedResult}% (${result.className}). Saved image to ${renamedImagePath}`;
      console.log(message);
      // We don't want to low probability to spam
      if (dateOfLastLowProbability == null || Date.now() - dateOfLastLowProbability >= TEN_MINUTES ) {
        await pushover.sendMessage({
          title: '🤷🏻‍♂️ I am not sure... ',
          message,
          attachment: imagePath
        });
      }
      dateOfLastLowProbability = Date.now();
      await cpFile(imagePath, renamedImagePath);
    } else {
      if ((previousIsClosedState == null && !isClosed) || (previousIsClosedState != null && previousIsClosedState !== isClosed)) {
        console.log('sending notification');
        await pushover.sendMessage({
          title: 'Garage Door is ' + friendlyResult,
          message: `Score: ${roundedResult}% (${result.className})`,
          attachment: imagePath
        });
      }
      previousIsClosedState = isClosed;
    }

    console.log(`I have ${roundedResult}% confidence the garage door is ${friendlyResult} (class: ${result.className})`);
  } catch (error) {
    console.error(error);
    await pushover.sendMessage({
      title: '⚠️ application error',
      message: error.message
    });
  }
  finally {
    await del(imagePath, { force: true, onlyFiles: true });
  }
}

function loopCheck() {
  console.log('Checking again in ' + ms(CHECK_GARAGE_EVERY_MS, { long: true }));
  setTimeout(async function () {
    await pRetry(checkGarageDoor, { retries: MAX_RETRIES } );
    loopCheck();
  }, CHECK_GARAGE_EVERY_MS as number);
}

async function start() {
  if (!existsSync(dirname(imagePath))) {
    if (process.platform === 'darwin') {
      console.log(`Image path "${imagePath}" does not exists, creating RAMDisk ${DEFAULT_IMAGE_PATH}`);
      await execa('diskutil erasevolume HFS+ "RAMDisk" `hdiutil attach -nomount ram://' + (2048 * Number(RAM_DISK_SIZE_MB)) + '`', { shell: true });
    } else {
      throw new Error(`Image path "${imagePath}" does not exists`);
    }
  }
  await pRetry(checkGarageDoor, { retries: MAX_RETRIES});
  loopCheck();
}

start();
