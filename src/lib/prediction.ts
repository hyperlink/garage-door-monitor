import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';

export interface PredictionResult {
  className: string;
  probability: number;
}

interface ModelMetadata {
  labels: string[];
  imageSize: number;
}

export class Prediction {
  private model: tf.LayersModel | null = null;
  private labels: string[] = [];

  constructor(private modelRootPath: string) {
    assert(this.modelRootPath, 'Model directory must be included');
  }

  private loadMetadata(): void {
    const metadataPath = path.join(this.modelRootPath, 'metadata.json');
    const metadataContent = fs.readFileSync(metadataPath, 'utf8');
    const metadata: ModelMetadata = JSON.parse(metadataContent);
    this.labels = metadata.labels;
  }

  private async initializeModel(): Promise<void> {
    if (this.model) {
      return;
    }

    // Load labels from metadata.json
    this.loadMetadata();

    const modelURL = `file://${this.modelRootPath}/model.json`;
    console.log('modelURL', modelURL);
    this.model = await tf.loadLayersModel(modelURL);
  }

  private readImage(filePath: string): tf.Tensor {
    const imageBuffer = fs.readFileSync(filePath);
    const tfimage = tf.node.decodeImage(imageBuffer, 3);

    // Center-crop to square
    const [height, width] = tfimage.shape;
    const side = Math.min(height, width);
    const offsetY = Math.floor((height - side) / 2);
    const offsetX = Math.floor((width - side) / 2);

    const cropped = tfimage.slice([offsetY, offsetX, 0], [side, side, 3]);
    const resized = tf.image.resizeBilinear(cropped, [224, 224]);
    const normalized = resized.div(tf.scalar(255));
    return normalized.expandDims(0);
  }

  async predict(imagePath: string): Promise<PredictionResult> {
    await this.initializeModel();

    const input = this.readImage(imagePath);
    const prediction = this.model!.predict(input) as tf.Tensor;

    const predArray = prediction.arraySync() as number[][];

    const probabilities = predArray[0];
    const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
    const className = this.labels[predictedIndex];
    const probability = probabilities[predictedIndex];

    // Clean up tensors
    input.dispose();
    prediction.dispose();

    return {
      className,
      probability
    };
  }
}
