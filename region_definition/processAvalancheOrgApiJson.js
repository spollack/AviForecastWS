//
// required packages
//
var fs = require('fs');

var inputFile = process.argv[2] || './avalanche-org/api_output.json';
var outputFile = process.argv[3] || './avalanche-org/api_output_processed.json';

processJSONFile(inputFile, outputFile, 3);

function processJSONFile(inputFilePath, outputFilePath, digits) {
    var input = fs.readFileSync(inputFilePath, 'utf8');
    var output = processRegions(input, digits);
    fs.writeFileSync(outputFilePath, output, 'utf8');
}

function processRegions(input, digits) {
    var data = JSON.parse(input);
    var regions = data.features;

    for (var i = 0; i < regions.length; i++) {

        regions[i].points = [];

        for (var j = 0; j < regions[i].geometry.coordinates[0].length; j++) {

            // do two things:
            // 1) trim digits in the geometry
            // 2) convert from KML-style to lat/lon style

            // NOTE latitude comes after longitude in KML ... weird
            var lon = regions[i].geometry.coordinates[0][j][0] = parseFloat(regions[i].geometry.coordinates[0][j][0]).toFixed(digits);
            var lat = regions[i].geometry.coordinates[0][j][1] = parseFloat(regions[i].geometry.coordinates[0][j][1]).toFixed(digits);

            regions[i].points[j] = {'lat': lat, 'lon': lon};
        }
    }

    return (JSON.stringify(data, null, 4));
}
