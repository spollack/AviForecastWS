//
// required packages
//
var fs = require('fs');

// countPointsInRegionsJSONFile('wcmaf/wcmaf_simplified.json');
// countPointsInRegionsJSONFile('Canada_all/canada_regions_simplified.json');
countPointsInRegionsJSONFile('../public/v1/regions.json');

function countPointsInRegionsJSONFile(inputFilePath) {
    var input = fs.readFileSync(inputFilePath, 'utf8');
    countPoints(input);
}

function countPoints(input) {
    var regions = JSON.parse(input);

    var numRegions = regions.length;
    var numPoints = 0;
    for (var i = 0; i < regions.length; i++) {
        numPoints += regions[i].points.length;
        console.log('region: ' + regions[i].regionId + '; points: ' + regions[i].points.length)
    }
    var avgPointsPerRegion = numPoints / numRegions;
    console.log('total regions: ' + numRegions + '; total points: ' + numPoints + '; avg points: ' + avgPointsPerRegion);
}
