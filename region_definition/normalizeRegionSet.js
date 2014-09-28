//
// required packages
//
var fs = require('fs');
var underscore = require('underscore');

// NOTE use this tool to compare the non-point metadata of two regions.json files

normalizeRegionSetInRegionsJSONFile('../public/v1test/regions.json', './output0.json');
normalizeRegionSetInRegionsJSONFile('../public/v1/regions.json', './output1.json');

function normalizeRegionSetInRegionsJSONFile(inputFilePath, outputFilePath) {
    var input = fs.readFileSync(inputFilePath, 'utf8');
    var output = normalizeRegionSet(input);
    fs.writeFileSync(outputFilePath, output, 'utf8');
}

function normalizeRegionSet(input) {
    var regions = JSON.parse(input);

    // remove points
    for (var i = 0; i < regions.length; i++) {
        delete regions[i].points;
    }
    
    // sort by regionId
    regions = underscore.sortBy(regions, 'regionId');

    return (JSON.stringify(regions, null, 4));
}
