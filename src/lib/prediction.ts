import { createCanvas, loadImage } from 'canvas';
import { createFile } from './createFile';
import { JSDOM } from 'jsdom';
import { loadLayersModel, io } from '@tensorflow/tfjs-node';
import { CustomMobileNet } from '@teachablemachine/image';
import * as _ from 'lodash';
import assert from 'assert';

const window = global.window = new JSDOM('<!doctype html><html><body></body></html>').window;
const { File, FileReader } = window;
global.document = window.document;
global.HTMLVideoElement = window.HTMLVideoElement;
global.fetch = require('node-fetch');

const originalCreateElement = window.document.createElement;

window.document.createElement = function (element) {
  if (element === 'canvas') {
    // console.log('override called');
    return createCanvas(2304, 1296);
  }
  return originalCreateElement(element);
}

global.FileReader = FileReader; // needed by tfjs-core

const IMAGE_SIZE = 224

export interface PredictionResult {
  className: string;
  probability: number;
}

export class Prediction {
  private model: CustomMobileNet;
  constructor(private modelRootPath: string) {
    assert(this.modelRootPath, 'Model directory must be included');
  }

  private async initializeModel() {
    if (this.model) {
      return;
    }
    console.log('loading model files');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const metadata = require(`${this.modelRootPath}/metadata.json`);
    metadata.imageSize = IMAGE_SIZE; // tm image sizes are the same square dimensions
    const [modelFile, weightsFile] = await Promise.all([
      createFile(`${this.modelRootPath}/model.json`, File),
      createFile(`${this.modelRootPath}/weights.bin`, File)
    ]);
    const customModel = await loadLayersModel(io.browserFiles([modelFile, weightsFile]));
    this.model = new CustomMobileNet(customModel, metadata);
  }

  async predict(imagePath: string): Promise<PredictionResult> {
    await this.initializeModel();

    // const maxPredictions = model.getTotalClasses();
    // console.log('maxPredictions', maxPredictions);
    const testImage = await loadImage(imagePath);
    const predictions = await this.model.predict(testImage as any);
    console.log(predictions);
    const result = _.last(_.sortBy(predictions, 'probability'));
    return result;
  }
}
