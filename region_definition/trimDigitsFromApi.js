//
// required packages
//
var fs = require('fs');


trimDigitsInRegionsJSONFile('./api_output.json', './api_output_trimmed.json', 3);


function trimDigitsInRegionsJSONFile(inputFilePath, outputFilePath, digits) {
    var input = fs.readFileSync(inputFilePath, 'utf8');
    var output = trimDigits(input, digits);
    fs.writeFileSync(outputFilePath, output, 'utf8');
}

function trimDigits(input, digits) {
    var data = JSON.parse(input);
    var regions = data.features;

    for (var i = 0; i < regions.length; i++) {
        for (var j = 0; j < regions[i].geometry.coordinates[0].length; j++) {
            regions[i].geometry.coordinates[0][j][0] = parseFloat(regions[i].geometry.coordinates[0][j][0]).toFixed(digits);
            regions[i].geometry.coordinates[0][j][1] = parseFloat(regions[i].geometry.coordinates[0][j][1]).toFixed(digits);
        }
    }

    return (JSON.stringify(data, null, 4));
}
