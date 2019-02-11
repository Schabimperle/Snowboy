const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
var path = require('path');

const inDir = process.argv[2] || './';
const outDir = process.argv[3] || inDir;

fs.readdir(inDir, function (err, items) {
    items.forEach(item => {
        if (item.includes(path.basename(process.argv[1]))) return;

        fs.stat(inDir + '/' + item, (err, stats) => {
            if (stats.isDirectory()) return;
            console.log('converting', item);
            ffmpeg(inDir + '/' + item)
                .audioCodec('libopus')
                .on('error', function (err, stdout, stderr) {
                    console.log('Cannot process video: ' + err.message);
                })
                .save(outDir + '/' + item.substr(0, item.search(/\.[^.]+$/)) + '.ogg');
        });
    });
});