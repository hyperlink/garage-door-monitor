# Automatic Garage Door Monitor

Our garage door was left open all night because my kids were playing outside and forgot to close it. That seemed really unsafe to me and since I don't have one of those fancy smart garage doors I created this.

## Requirements

* Security camera capable of RTSP stream (tested using Eufy camera)
* Mount the camera with visibility on the garage door
* Enable RTSP stream on your camera
  * Recommend: allocate a fixed IP address to your camera
* install `ffmpeg` to get frames of video from an RTSP stream
* Pushover.net account to receive notifications (this is ***FREE***)
  * Create an app and make note your app key and user key
* Trained TensorFlow model (also ***FREE***) https://teachablemachine.withgoogle.com/train/image
  * Capture several screenshots from your camera with your door open and closed and under different lighting conditions
  * The training model utilizes a square 224x224 view of your provided image so make sure your door is posiitoned and visible when cropped
  * Create classes for open and closed states and because my security camera have a night mode I recommend separating night and day time into different classes
  * If a vehicle is in the shot add some samples with it out of the shot
  * Classify with the keywords ___"closed"___ or ___"open"___ the module will pick up on these to determine if the door is closed or open
  * Take new screenshots (none that you submitted as samples) to verify your model in the "Preview" section
  * Click on **Export Model**
  * In `Export` panel click on `Tensorflow.js` and `Download`
  * Unpack model into your folder (make note of the location)

## Installation (Mac)

### ffmpeg

```bash
brew install ffmpeg
```

### RAMDisk (Optional)

You can setup a ramdisk to prevent unessasary wear on your SSD from images being downloaded and deleted frequently. If you're on the Mac it will automatically do this for you.

```bash
diskutil erasevolume HFS+ "RAMDisk" `hdiutil attach -nomount ram://4096`
```

## Running

There are different ways to run this app.

### PM2 file (Optional)

I used [PM2](https://pm2.keymetrics.io/) the Node Js process manager to run this service. Git clone this module and create `ecosystem.config.js`

```javascript
module.exports = {
  apps: [{
    name: 'Garage Door Monitor',
    script: 'src/index.ts',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    instances: 0,
    env: { // required environment variables
      RTSP_URL: 'rtsp://192.168.0.101/camera',
      MODEL_PATH: '<model dir>',
      PUSHOVER_TOKEN: '<PUSHOVER TOKEN>',
      PUSHOVER_USER: '<PUSHOVER USER>',
      TF_CPP_MIN_LOG_LEVEL: '3',
      // Optional defaults
      GRACE_PERIOD: '5m', // timeformat https://www.npmjs.com/package/ms
      IMAGE_PATH: '/Users/xiaoxin/dev/garage-door-monitor/last-shot.jpg', // only provide this if you don't intend to use the ramdisk
      GARAGE_CHECK_INTERVAL: '30s', // timeformat https://www.npmjs.com/package/ms
      RAM_DISK_SIZE: '2' // size in MB
    }
  }]
};
```



```bash
pm2 install typescript
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

### Node Binary

`npm install -g @hyperlink/garage-door-monitor`

Make sure you set the documented environment above when running.
