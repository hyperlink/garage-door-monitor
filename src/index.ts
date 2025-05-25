#!/usr/bin/env node

import del from 'del';
import { captureFrameImage } from './lib/captureFrameImage.js';
import { Prediction, PredictionResult } from './lib/prediction.js';
import { resolve, join, dirname } from 'path';
import ms from 'ms';
import { Pushover } from './lib/Pushover.js';
import pRetry from 'p-retry';
import cpFile from 'cp-file';
import { existsSync } from 'fs';
import execa from 'execa';
import _ from 'lodash';
import ipc from 'node-ipc';

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

ipc.config.id = 'garagedoorstatus';
ipc.config.retry = 1500;

const IpcEventName = 'stateChange';
const connectedSockets = new Set();
let isClosed = null;

function sendStateToConnectedIPCSockets(state: boolean): void {
  for (const socket of connectedSockets) {
    ipc.server.emit(socket, IpcEventName, state);
  }
}

ipc.serve(function () {
  ipc.server.on('connect', function (connectedSocket) {
    ipc.log('socket connected!');
    connectedSockets.add(connectedSocket);
    sendStateToConnectedIPCSockets(isClosed);
  })

  ipc.server.on(
    'socket.disconnected',
    function (socket) {
      ipc.log('client disconnected!');
      const removed = connectedSockets.delete(socket);
      ipc.log('client has been removed', removed);
    }
  );
});

ipc.server.start();

const MAX_RETRIES = 5;
const CONFIDENCE_THRESHOLD = 65;
const DEFAULT_IMAGE_PATH = '/Volumes/RAMDisk/last-shot.jpg';
const CHECK_GARAGE_EVERY_MS = ms(process.env.GARAGE_CHECK_INTERVAL || '30s');
const modelPath = process.env.MODEL_PATH;
const imagePath = resolve(process.env.IMAGE_PATH || DEFAULT_IMAGE_PATH);
const prediction = new Prediction(modelPath);
const pushover = new Pushover(process.env.PUSHOVER_TOKEN, process.env.PUSHOVER_USER);
const RAM_DISK_SIZE_MB = process.env.RAM_DISK_SIZE || 2;
const RTSP_URL = process.env.RTSP_URL;
const isGracePeriodEnabled = !!process.env.GRACE_PERIOD;
const GRACE_PERIOD = ms(process.env.GRACE_PERIOD ?? '5m');

let previousIsClosedState = null;
let lastOpenTime = null;

function isGracePeriod () {
  return lastOpenTime != null && (Date.now() - lastOpenTime) < GRACE_PERIOD;
}

const TEN_MINUTES = ms('10m');

async function checkGarageDoor() {
  try {
    await captureFrameImage(RTSP_URL, imagePath);
    const result = await prediction.predict(imagePath);
    const roundedResult = Math.round(result.probability * 100);
    let friendlyResult = '';

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
      await cpFile(imagePath, renamedImagePath);
      await throttledLowProbabilityPush(message, renamedImagePath);
    } else {
      throttledLowProbabilityPush.cancel();
      if ((previousIsClosedState == null && !isClosed) || (previousIsClosedState != null && previousIsClosedState !== isClosed)) {
        if (isGracePeriodEnabled) {
          if (lastOpenTime == null) {
            if (isClosed) {
              console.log('door is closed notify right away');
              sendStateToConnectedIPCSockets(isClosed);
              await notifyDoorState(friendlyResult, roundedResult, result);
            } else {
              console.log('Door is open starting grace period.');
              lastOpenTime = Date.now();
            }
          } else if (isGracePeriod() && isClosed) {
            console.log('door was closed within grace period.');
            lastOpenTime = null;
          }
        } else {
          sendStateToConnectedIPCSockets(isClosed);
          await notifyDoorState(friendlyResult, roundedResult, result);
        }
      }
      if (isGracePeriodEnabled && lastOpenTime != null && !isGracePeriod() && !isClosed) {
        console.log('not in grace period and door is open notify');
        sendStateToConnectedIPCSockets(false);
        await notifyDoorState(friendlyResult, roundedResult, result);
        lastOpenTime = null;
      }
      previousIsClosedState = isClosed;
    }

    console.log(`I have ${roundedResult}% confidence the garage door is ${friendlyResult} (class: ${result.className})`);
    throttledPushError.cancel();
  } catch (error) {
    console.error(error);
    await throttledPushError(error);
  }
  finally {
    await del(imagePath, { force: true, onlyFiles: true });
  }

  async function notifyDoorState(friendlyResult: string, roundedResult: number, result: PredictionResult) {
    await pushover.sendMessage({
      title: 'Garage Door is ' + friendlyResult,
      message: `Score: ${roundedResult}% (${result.className})`,
      attachment: imagePath
    });
  }
}

async function lowProbabilityPush(message: string, attachment: string): Promise<void> {
  await pushover.sendMessage({
    title: '🤷🏻‍♂️ I am not sure... ',
    message,
    attachment
  });
}

const throttledLowProbabilityPush = _.debounce(lowProbabilityPush, TEN_MINUTES, { leading: true });

async function notifyError(error: Error): Promise<void> {
  await pushover.sendMessage({
    title: '⚠️ application error',
    message: error.message
  });
}

const throttledPushError = _.throttle(notifyError, TEN_MINUTES, { leading: true });

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
